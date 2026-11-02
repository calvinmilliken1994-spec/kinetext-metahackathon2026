// Library tidy (docs/specs/LIBRARY-TIDY.md): GET /api/jobs archivedAt/pinned, POST /api/jobs/:id/archive, POST /api/archive.
// Ephemeral servers on 127.0.0.1:0 and job directories written straight into a temp storage dir. No network beyond
// localhost, no credits, nothing under storage/runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { archiveFilePath, readArchive, writeArchive } from './archive.ts';
import { writeReview } from './review.ts';

const CODE = 'judge-code-for-archive-tests-9Qw2';
const SECRET = 'session-secret-for-archive-tests-7Lm4';
const NOW = '2026-11-02T12:30:00.000Z';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'library-tidy-server-'));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** `<hhmm>` makes a job id whose time sorts with the minutes after midnight. */
const id = (minute: number, tail: string): string => `job-202611020${String(Math.floor(minute / 60)).padStart(1, '0')}${String(minute % 60).padStart(2, '0')}00-${tail}`;

function seedJob(storageDir: string, jobId: string, o: { source?: string; status?: string; flow?: string; minute: number }): string {
  const dir = join(storageDir, 'runs', jobId);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'job.json'), {
    jobId,
    sourceId: o.source ?? 'page-a',
    status: o.status ?? 'succeeded',
    purpose: 'test-live',
    createdAt: new Date(Date.UTC(2026, 10, 2, 0, o.minute)).toISOString(),
    flow: o.flow ?? 'lesson',
    model: 'muse-spark-1.3',
    provider: 'meta-api',
    totalCostUSD: 0.1,
    revisions: 0,
    repairs: [],
    analysisRepairs: [],
  });
  return jobId;
}

function publishRun(storageDir: string, jobId: string): void {
  writeReview(storageDir, jobId, { status: 'published', publishedAt: '2026-11-02T01:00:00.000Z', hiddenParts: [], checkedParts: ['quiz-cards-v1'] });
}

interface Harness { base: string; storageDir: string }

async function withServer(over: Partial<ApiOptions>, run: (h: Harness) => Promise<void>): Promise<void> {
  const storageDir = over.storageDir ?? tempDir();
  const server: Server = createApiServer({
    storageDir,
    startJob: null,
    now: () => new Date(NOW),
    // an absent file: no pins unless a test writes one
    pinnedRunsFile: join(storageDir, 'no-pins.json'),
    ...over,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({ base, storageDir });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

const gate = (): NonNullable<ApiOptions['access']> => ({ code: CODE, sessionSecret: SECRET, buildsPaused: () => false });

interface Reply { status: number; body: unknown }

async function call(
  base: string,
  method: string,
  path: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  let body: string | undefined;
  if (init.body !== undefined) {
    headers['content-type'] ??= 'application/json';
    body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await res.text();
  return { status: res.status, body: text === '' ? {} : (JSON.parse(text) as unknown) };
}

const one = (base: string, jobId: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
  call(base, 'POST', `/api/jobs/${jobId}/archive`, { body, headers });
const bulk = (base: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
  call(base, 'POST', '/api/archive', { body, headers });

async function listing(base: string): Promise<Array<Record<string, unknown>>> {
  return (await call(base, 'GET', '/api/jobs')).body as Array<Record<string, unknown>>;
}

const A_NEW = id(300, 'aaaa0001');
const A_OLD = id(100, 'aaaa0002');

// ---- GET /api/jobs ------------------------------------------------------------------------------------------------

test('GET /api/jobs: archivedAt and pinned appear only when they apply; stored fields are unchanged', async () => {
  const storageDir = tempDir();
  const pins = join(storageDir, 'pins.json');
  writeJson(pins, { note: 'n', runs: [{ jobId: A_NEW, why: 'Demo' }] });
  await withServer({ storageDir, pinnedRunsFile: pins }, async ({ base }) => {
    seedJob(storageDir, A_NEW, { minute: 300 });
    seedJob(storageDir, A_OLD, { minute: 100 });
    const plain = id(200, 'aaaa0003');
    seedJob(storageDir, plain, { minute: 200 });
    writeArchive(storageDir, A_OLD, '2026-11-02T09:00:00.000Z');
    const byId = new Map((await listing(base)).map(j => [j['jobId'] as string, j]));
    assert.equal(byId.get(A_NEW)?.['pinned'], true);
    assert.equal('archivedAt' in (byId.get(A_NEW) ?? {}), false);
    assert.equal(byId.get(A_OLD)?.['archivedAt'], '2026-11-02T09:00:00.000Z');
    assert.equal('pinned' in (byId.get(A_OLD) ?? {}), false, 'pinned is true or absent, never false');
    assert.equal('archivedAt' in (byId.get(plain) ?? {}), false);
    assert.equal('pinned' in (byId.get(plain) ?? {}), false);
    assert.equal(byId.get(A_OLD)?.['status'], 'succeeded');
  });
});

test('GET /api/jobs: reviewPublishedAt, archivedAt and pinned can sit on one run; the order stays newest first', async () => {
  const storageDir = tempDir();
  const pins = join(storageDir, 'pins.json');
  writeJson(pins, { runs: [{ jobId: A_OLD, why: 'x' }] });
  await withServer({ storageDir, pinnedRunsFile: pins }, async ({ base }) => {
    seedJob(storageDir, A_NEW, { minute: 300 });
    seedJob(storageDir, A_OLD, { minute: 100 });
    publishRun(storageDir, A_OLD);
    writeArchive(storageDir, A_OLD, NOW);
    const list = await listing(base);
    assert.deepEqual(list.map(j => j['jobId']), [A_NEW, A_OLD]);
    assert.equal(list[1]?.['reviewPublishedAt'], '2026-11-02T01:00:00.000Z');
    assert.equal(list[1]?.['archivedAt'], NOW);
    assert.equal(list[1]?.['pinned'], true);
  });
});

test('GET /api/jobs: a damaged archive.json or pinned file is "not archived" / "no pins"', async () => {
  const storageDir = tempDir();
  const pins = join(storageDir, 'pins.json');
  writeFileSync(pins, '{ damaged', 'utf8');
  await withServer({ storageDir, pinnedRunsFile: pins }, async ({ base }) => {
    seedJob(storageDir, A_NEW, { minute: 300 });
    writeFileSync(archiveFilePath(storageDir, A_NEW), '{"archivedAt":', 'utf8');
    const [job] = await listing(base);
    assert.equal(job?.['jobId'], A_NEW);
    assert.equal('archivedAt' in (job ?? {}), false);
    assert.equal('pinned' in (job ?? {}), false);
  });
});

test('the default pinned list (config/pinned-runs.json) is loaded when no file is given', async () => {
  const storageDir = tempDir();
  const server: Server = createApiServer({ storageDir, startJob: null });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const tour = 'job-20261101234914-97ba271b'; // DEMO_PINS.tour, which the real list must hold
    seedJob(storageDir, tour, { minute: 10 });
    const [job] = await listing(base);
    assert.equal(job?.['pinned'], true);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

// ---- POST /api/jobs/:id/archive -----------------------------------------------------------------------------------

test('archive then restore: the side file appears and goes, the run files stay byte for byte', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    const jobFile = join(storageDir, 'runs', A_OLD, 'job.json');
    const before = readFileSync(jobFile, 'utf8');
    const res = await one(base, A_OLD, { action: 'archive' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { archivedAt: NOW });
    assert.deepEqual(JSON.parse(readFileSync(archiveFilePath(storageDir, A_OLD), 'utf8')), { archivedAt: NOW });
    assert.deepEqual(readdirSync(join(storageDir, 'runs', A_OLD)).sort(), ['archive.json', 'job.json'], 'no temp file is left');
    assert.equal(readFileSync(jobFile, 'utf8'), before, 'the stored run is never rewritten');
    assert.equal((await listing(base))[0]?.['archivedAt'], NOW);

    const back = await one(base, A_OLD, { action: 'restore' });
    assert.equal(back.status, 200);
    assert.deepEqual(back.body, { archivedAt: null });
    assert.equal(existsSync(archiveFilePath(storageDir, A_OLD)), false);
    assert.equal('archivedAt' in ((await listing(base))[0] ?? {}), false);
    // restore is idempotent
    assert.deepEqual((await one(base, A_OLD, { action: 'restore' })).body, { archivedAt: null });
  });
});

test('archiving an archived run keeps its first time', async () => {
  let clock = new Date('2026-11-02T10:00:00.000Z');
  await withServer({ now: () => clock }, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    assert.deepEqual((await one(base, A_OLD, { action: 'archive' })).body, { archivedAt: '2026-11-02T10:00:00.000Z' });
    clock = new Date('2026-11-02T11:00:00.000Z');
    assert.deepEqual((await one(base, A_OLD, { action: 'archive' })).body, { archivedAt: '2026-11-02T10:00:00.000Z' });
    assert.equal(readArchive(storageDir, A_OLD)?.archivedAt, '2026-11-02T10:00:00.000Z');
  });
});

test('archive refusals: pinned, published and still-running runs are 409; restore of them still works', async () => {
  const storageDir = tempDir();
  const pinned = id(400, 'bbbb0001');
  const pins = join(storageDir, 'pins.json');
  writeJson(pins, { runs: [{ jobId: pinned, why: 'x' }] });
  await withServer({ storageDir, pinnedRunsFile: pins }, async ({ base }) => {
    seedJob(storageDir, pinned, { minute: 400 });
    const published = seedJob(storageDir, id(401, 'bbbb0002'), { minute: 401 });
    publishRun(storageDir, published);
    const active = seedJob(storageDir, id(402, 'bbbb0003'), { minute: 402, status: 'running' });
    const r1 = await one(base, pinned, { action: 'archive' });
    assert.equal(r1.status, 409);
    assert.deepEqual(r1.body, { error: 'RUN_PINNED' });
    assert.deepEqual((await one(base, published, { action: 'archive' })).body, { error: 'RUN_PUBLISHED' });
    const r3 = await one(base, active, { action: 'archive' });
    assert.equal(r3.status, 409);
    assert.deepEqual(r3.body, { error: 'RUN_ACTIVE' });
    for (const jobId of [pinned, published, active]) assert.equal(existsSync(archiveFilePath(storageDir, jobId)), false);
    assert.equal((await one(base, pinned, { action: 'restore' })).status, 200);
  });
});

test('failed and unsupported runs and activity runs can be archived', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    for (const [i, o] of [{ status: 'failed' }, { status: 'unsupported' }, { flow: 'activity' }].entries()) {
      const jobId = seedJob(storageDir, id(10 + i, 'cccc000' + String(i)), { minute: 10 + i, ...o });
      assert.equal((await one(base, jobId, { action: 'archive' })).status, 200, JSON.stringify(o));
    }
  });
});

test('single route: 404 for an unknown or malformed id (including a path that escapes), after the gate', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    assert.deepEqual((await one(base, 'job-does-not-exist', { action: 'archive' })).body, { error: 'NOT_FOUND' });
    assert.equal((await call(base, 'POST', '/api/jobs/..%2Fescape/archive', { body: { action: 'archive' } })).status, 404);
    assert.equal((await call(base, 'POST', '/api/jobs/a%2Fb/archive', { body: { action: 'archive' } })).status, 404);
    assert.equal((await call(base, 'POST', '/api/jobs//archive', { body: { action: 'archive' } })).status, 404);
  });
});

test('check order: 405, 403 origin, 403 access, 404, 415, 413, 400', async () => {
  await withServer({ access: gate() }, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    const signIn = await fetch(`${base}/api/access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
    const cookie = (signIn.headers.getSetCookie()[0] as string).split(';')[0] as string;
    const ok = { cookie };
    const ARCH = `/api/jobs/${A_OLD}/archive`;

    // 405 beats everything
    assert.equal((await call(base, 'GET', ARCH)).status, 405);
    assert.equal((await call(base, 'DELETE', ARCH, { headers: ok })).status, 405);
    assert.equal((await call(base, 'PUT', ARCH, { body: { action: 'archive' }, headers: { origin: 'http://evil.example' } })).status, 405);
    // origin beats the gate
    const evil = await one(base, A_OLD, { action: 'archive' }, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403);
    assert.deepEqual(evil.body, { error: 'ORIGIN_NOT_ALLOWED' });
    // the gate beats an unknown job, a bad type, a huge body and bad JSON: a visitor learns nothing
    for (const r of [
      await one(base, A_OLD, { action: 'archive' }),
      await one(base, 'job-does-not-exist', { action: 'archive' }),
      await call(base, 'POST', ARCH, { body: 'x', headers: { 'content-type': 'text/plain' } }),
      await one(base, A_OLD, '{nope'),
      await one(base, A_OLD, { action: 'archive', pad: 'x'.repeat(2000) }),
      await one(base, A_OLD, { action: 'archive' }, { cookie: 'mki_access=forged.value' }),
    ]) {
      assert.equal(r.status, 403);
      assert.deepEqual(r.body, { error: 'ACCESS_REQUIRED' });
    }
    assert.equal(existsSync(archiveFilePath(storageDir, A_OLD)), false, 'nothing was written without a session');
    // then 404 beats 415
    assert.deepEqual((await call(base, 'POST', '/api/jobs/job-does-not-exist/archive', { body: 'x', headers: { ...ok, 'content-type': 'text/plain' } })).body, { error: 'NOT_FOUND' });
    // 415 beats 413 and 400
    const media = await call(base, 'POST', ARCH, { body: 'x'.repeat(2000), headers: { ...ok, 'content-type': 'text/plain' } });
    assert.equal(media.status, 415);
    assert.deepEqual(media.body, { error: 'UNSUPPORTED_MEDIA_TYPE' });
    // 413 over 1 KB, 400 for everything else wrong
    const big = await one(base, A_OLD, { action: 'archive', pad: 'x'.repeat(2000) }, ok);
    assert.equal(big.status, 413);
    assert.deepEqual(big.body, { error: 'PAYLOAD_TOO_LARGE' });
    for (const body of ['{nope', '', 'null', '[]', '"archive"', { action: 'delete' }, { action: 'archive-older' }, {}, { action: 7 }]) {
      const r = await one(base, A_OLD, body, ok);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.deepEqual(r.body, { error: 'BAD_REQUEST' });
    }
    assert.equal(existsSync(archiveFilePath(storageDir, A_OLD)), false);
    // and with a session it works
    assert.equal((await one(base, A_OLD, { action: 'archive' }, ok)).status, 200);
    assert.equal((await listing(base))[0]?.['archivedAt'], NOW, 'GET stays open without a session');
  });
});

test('an Origin on the allowed host passes', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    assert.equal((await one(base, A_OLD, { action: 'archive' }, { origin: base })).status, 200);
    const https = await one(base, A_OLD, { action: 'restore' }, { origin: `https://${new URL(base).host}` });
    assert.equal(https.status, 403);
  });
});

test('archiving never calls startJob', async () => {
  let started = 0;
  await withServer({ startJob: () => { started += 1; throw new Error('must not start'); } }, async ({ base, storageDir }) => {
    seedJob(storageDir, A_OLD, { minute: 100 });
    await one(base, A_OLD, { action: 'archive' });
    await bulk(base, { action: 'archive-older' });
    assert.equal(started, 0);
  });
});

// ---- POST /api/archive --------------------------------------------------------------------------------------------

/** Two pages. Page A: new lesson (keeper), old lesson, failed, published old, pinned old, running. Page B: one lesson and an older one. */
function seedLibrary(storageDir: string): Record<string, string> {
  const ids = {
    aKeeper: seedJob(storageDir, id(500, 'a0000001'), { source: 'page-a', minute: 500 }),
    aOld: seedJob(storageDir, id(400, 'a0000002'), { source: 'page-a', minute: 400 }),
    aFailed: seedJob(storageDir, id(450, 'a0000003'), { source: 'page-a', minute: 450, status: 'failed' }),
    aPublished: seedJob(storageDir, id(300, 'a0000004'), { source: 'page-a', minute: 300 }),
    aPinned: seedJob(storageDir, id(200, 'a0000005'), { source: 'page-a', minute: 200 }),
    aRunning: seedJob(storageDir, id(550, 'a0000006'), { source: 'page-a', minute: 550, status: 'running' }),
    bKeeper: seedJob(storageDir, id(520, 'b0000001'), { source: 'page-b', minute: 520 }),
    bOld: seedJob(storageDir, id(120, 'b0000002'), { source: 'page-b', minute: 120 }),
  } as Record<string, string>;
  publishRun(storageDir, ids['aPublished'] as string);
  return ids;
}

const withPin = (storageDir: string, jobId: string): string => {
  const file = join(storageDir, 'pins.json');
  writeJson(file, { runs: [{ jobId, why: 'x' }] });
  return file;
};

test('archive-older: the whole library, answer lists ids newest first and only what this call changed', async () => {
  const storageDir = tempDir();
  const ids = seedLibrary(storageDir);
  await withServer({ storageDir, pinnedRunsFile: withPin(storageDir, ids['aPinned'] as string) }, async ({ base }) => {
    const res = await bulk(base, { action: 'archive-older' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { archived: [ids['aFailed'], ids['aOld'], ids['bOld']], restored: [] });
    for (const key of ['aFailed', 'aOld', 'bOld']) assert.deepEqual(readArchive(storageDir, ids[key] as string), { archivedAt: NOW }, key);
    for (const key of ['aKeeper', 'aPublished', 'aPinned', 'aRunning', 'bKeeper']) assert.equal(readArchive(storageDir, ids[key] as string), null, key);
    // a second call has nothing left to do
    assert.deepEqual((await bulk(base, { action: 'archive-older' })).body, { archived: [], restored: [] });
  });
});

test('archive-older with sourceId touches only that page; an unknown sourceId matches nothing', async () => {
  const storageDir = tempDir();
  const ids = seedLibrary(storageDir);
  await withServer({ storageDir, pinnedRunsFile: withPin(storageDir, ids['aPinned'] as string) }, async ({ base }) => {
    assert.deepEqual((await bulk(base, { action: 'archive-older', sourceId: 'no-such-page' })).body, { archived: [], restored: [] });
    assert.deepEqual((await bulk(base, { action: 'archive-older', sourceId: 'page-b' })).body, { archived: [ids['bOld']], restored: [] });
    assert.equal(readArchive(storageDir, ids['aOld'] as string), null, 'page A is untouched');
    assert.deepEqual((await bulk(base, { action: 'archive-older', sourceId: 'page-a' })).body, { archived: [ids['aFailed'], ids['aOld']], restored: [] });
  });
});

test('archive-older: the keeper is picked among runs not archived yet', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    const newest = seedJob(storageDir, id(500, 'd0000001'), { minute: 500 });
    const next = seedJob(storageDir, id(400, 'd0000002'), { minute: 400 });
    const oldest = seedJob(storageDir, id(300, 'd0000003'), { minute: 300 });
    writeArchive(storageDir, newest, '2026-11-02T09:00:00.000Z');
    assert.deepEqual((await bulk(base, { action: 'archive-older' })).body, { archived: [oldest], restored: [] });
    assert.equal(readArchive(storageDir, next), null);
    assert.equal(readArchive(storageDir, newest)?.archivedAt, '2026-11-02T09:00:00.000Z', 'an earlier archive time is kept');
  });
});

test('restore-all: every archived run, or one page’s; the answer is the ids restored', async () => {
  const storageDir = tempDir();
  const ids = seedLibrary(storageDir);
  await withServer({ storageDir }, async ({ base }) => {
    for (const key of ['aOld', 'aFailed', 'bOld']) writeArchive(storageDir, ids[key] as string, NOW);
    const part = await bulk(base, { action: 'restore-all', sourceId: 'page-b' });
    assert.deepEqual(part.body, { archived: [], restored: [ids['bOld']] });
    assert.equal(readArchive(storageDir, ids['aOld'] as string)?.archivedAt, NOW);
    assert.deepEqual((await bulk(base, { action: 'restore-all', sourceId: 'no-such-page' })).body, { archived: [], restored: [] });
    const all = await bulk(base, { action: 'restore-all' });
    assert.deepEqual(all.body, { archived: [], restored: [ids['aFailed'], ids['aOld']] });
    assert.equal(existsSync(archiveFilePath(storageDir, ids['aOld'] as string)), false);
    assert.deepEqual((await bulk(base, { action: 'restore-all' })).body, { archived: [], restored: [] });
  });
});

test('restore-all also frees a run that is now pinned or published (restore always succeeds)', async () => {
  const storageDir = tempDir();
  await withServer({ storageDir }, async ({ base }) => {
    const j = seedJob(storageDir, A_OLD, { minute: 100 });
    publishRun(storageDir, j);
    writeArchive(storageDir, j, NOW);
    assert.deepEqual((await bulk(base, { action: 'restore-all' })).body, { archived: [], restored: [j] });
  });
});

test('bulk route: method, origin, access, size, type and body checks (no 404)', async () => {
  await withServer({ access: gate() }, async ({ base, storageDir }) => {
    seedJob(storageDir, A_NEW, { minute: 300 });
    seedJob(storageDir, A_OLD, { minute: 100 });
    const signIn = await fetch(`${base}/api/access`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: CODE }) });
    const ok = { cookie: (signIn.headers.getSetCookie()[0] as string).split(';')[0] as string };

    assert.equal((await call(base, 'GET', '/api/archive')).status, 405);
    assert.equal((await call(base, 'DELETE', '/api/archive', { headers: ok })).status, 405);
    const evil = await bulk(base, { action: 'archive-older' }, { origin: 'http://evil.example' });
    assert.deepEqual([evil.status, evil.body], [403, { error: 'ORIGIN_NOT_ALLOWED' }]);
    for (const r of [
      await bulk(base, { action: 'archive-older' }),
      await bulk(base, '{nope'),
      await bulk(base, { action: 'archive-older', pad: 'x'.repeat(2000) }),
      await bulk(base, { action: 'archive-older' }, { cookie: 'mki_access=forged.value' }),
    ]) {
      assert.deepEqual([r.status, r.body], [403, { error: 'ACCESS_REQUIRED' }]);
    }
    assert.equal(existsSync(archiveFilePath(storageDir, A_OLD)), false);
    const media = await call(base, 'POST', '/api/archive', { body: 'x', headers: { ...ok, 'content-type': 'text/plain' } });
    assert.deepEqual([media.status, media.body], [415, { error: 'UNSUPPORTED_MEDIA_TYPE' }]);
    const big = await bulk(base, { action: 'archive-older', sourceId: 'x'.repeat(2000) }, ok);
    assert.deepEqual([big.status, big.body], [413, { error: 'PAYLOAD_TOO_LARGE' }]);
    for (const body of ['{nope', 'null', '[]', {}, { action: 'archive' }, { action: 'restore' }, { action: 'archive-older', sourceId: 5 }, { action: 'restore-all', sourceId: null }]) {
      const r = await bulk(base, body, ok);
      assert.deepEqual([r.status, r.body], [400, { error: 'BAD_REQUEST' }], JSON.stringify(body));
    }
    // an empty sourceId is just an unknown page: it matches nothing (never the whole library)
    assert.deepEqual((await bulk(base, { action: 'archive-older', sourceId: '' }, ok)).body, { archived: [], restored: [] });
    assert.equal(existsSync(archiveFilePath(storageDir, A_OLD)), false);
    assert.deepEqual((await bulk(base, { action: 'archive-older' }, ok)).body, { archived: [A_OLD], restored: [] });
    assert.deepEqual((await bulk(base, { action: 'restore-all' }, ok)).body, { archived: [], restored: [A_OLD] });
  });
});

test('/api/archive/ with a trailing path is 404, and the bulk route needs no job', async () => {
  await withServer({}, async ({ base }) => {
    assert.equal((await call(base, 'POST', '/api/archive/x', { body: { action: 'archive-older' } })).status, 404);
    assert.deepEqual((await bulk(base, { action: 'archive-older' })).body, { archived: [], restored: [] }, 'an empty library is fine');
  });
});

test('GET /api/jobs: a published lesson whose kept label diagram SAM outlined carries samUsed; an unpublished one does not', async () => {
  const storageDir = tempDir();
  await withServer({ storageDir }, async ({ base }) => {
    seedJob(storageDir, A_NEW, { minute: 300 });
    seedJob(storageDir, A_OLD, { minute: 100 });
    for (const id of [A_NEW, A_OLD]) {
      writeJson(join(storageDir, 'runs', id, 'lesson.json'), { components: [{ componentId: 'label-diagram-v1', status: 'passed', revision: 1 }] });
      writeJson(join(storageDir, 'runs', id, 'label-diagram-v1.r1.json'), { regions: [{ partId: 'p1', confidence: 0.8 }] });
    }
    publishRun(storageDir, A_OLD);
    const byId = new Map((await listing(base)).map(j => [j['jobId'] as string, j]));
    assert.equal(byId.get(A_OLD)?.['samUsed'], true);
    assert.equal('samUsed' in (byId.get(A_NEW) ?? {}), false, 'only published lessons are looked at');
  });
});
