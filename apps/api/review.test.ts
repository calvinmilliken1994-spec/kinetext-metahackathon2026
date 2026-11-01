// Stage 10b slice R: teacher review and publish (docs/specs/STAGE-10b-review-and-results.md, section R).
// Ephemeral servers on 127.0.0.1:0, job directories written straight into a temp storage dir, a FAKE startJob that
// is never called. No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { publishedPartIds, readReview, reviewFilePath, validatePublishBody } from './review.ts';

const CODE = 'judge-code-for-review-tests-3Kp8';
const SECRET = 'session-secret-for-review-tests-5Zn1';
const JOB = 'job-20261102000000-aaaa1111';

interface PartSeed { componentId: string; status?: string; recheck?: { publishable: boolean } }

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'stage10b-review-'));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/** A stored job record: `parts` become the lesson's components (default status 'passed'). */
function seedJob(
  storageDir: string,
  o: { jobId?: string; status?: string; flow?: string; parts?: PartSeed[]; omitLesson?: boolean; createdAt?: string } = {},
): string {
  const jobId = o.jobId ?? JOB;
  const dir = join(storageDir, 'runs', jobId);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'job.json'), {
    jobId,
    sourceId: 'bls-cpi-escalation',
    status: o.status ?? 'succeeded',
    purpose: 'test-live',
    createdAt: o.createdAt ?? '2026-11-02T00:00:00.000Z',
    flow: o.flow ?? 'lesson',
    model: 'muse-spark-1.3',
    provider: 'meta-api',
    totalCostUSD: 0.1,
    revisions: 0,
    repairs: [],
    analysisRepairs: [],
  });
  if (o.omitLesson !== true) {
    const parts = o.parts ?? [{ componentId: 'quiz-cards-v1' }, { componentId: 'sequence-v1' }, { componentId: 'sort-groups-v1' }];
    writeJson(join(dir, 'lesson.json'), {
      jobId,
      analysisRef: `${jobId}/analysis-v2.r1.json`,
      overview: null,
      components: parts.map(p => ({
        componentId: p.componentId,
        specId: `${jobId}:${p.componentId}:r1`,
        status: p.status ?? 'passed',
        reason: '',
        revision: 1,
      })),
    });
  }
  return jobId;
}

interface Harness { base: string; storageDir: string }

async function withServer(over: Partial<ApiOptions>, run: (h: Harness) => Promise<void>): Promise<void> {
  const storageDir = over.storageDir ?? tempStorage();
  const server: Server = createApiServer({
    storageDir,
    startJob: null,
    now: () => new Date('2026-11-02T12:30:00.000Z'),
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

interface Reply { status: number; body: Record<string, unknown>; setCookie: string[] }

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
  return { status: res.status, body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>, setCookie: res.headers.getSetCookie() };
}

const publish = (base: string, jobId: string, body: unknown, headers: Record<string, string> = {}): Promise<Reply> =>
  call(base, 'POST', `/api/jobs/${jobId}/review`, { body, headers });

const ALL = ['quiz-cards-v1', 'sequence-v1', 'sort-groups-v1'];

// ---- pure helpers -------------------------------------------------------------------------------------------------

test('publishedPartIds: passed parts only, minus those today’s re-check or a review hold withheld', () => {
  const lesson = {
    components: [
      { componentId: 'label-diagram-v1', status: 'passed' },
      { componentId: 'sequence-v1', status: 'failed' },
      { componentId: 'quiz-cards-v1', status: 'skipped' },
      { componentId: 'threshold-v1', status: 'passed', recheck: { publishable: false, failedChecks: ['x'] } },
      { componentId: 'log-ladder-v1', status: 'passed', recheck: { publishable: true, failedChecks: [] } },
      { componentId: 'sort-groups-v1', status: 'passed' },
    ],
  };
  assert.deepEqual(publishedPartIds({ lesson }), ['label-diagram-v1', 'log-ladder-v1', 'sort-groups-v1']);
  assert.deepEqual(publishedPartIds({ lesson: null }), []);
  assert.deepEqual(publishedPartIds({}), []);
});

test('validatePublishBody: each refusal has its own code', () => {
  const parts = ['a', 'b', 'c'];
  assert.deepEqual(validatePublishBody({ action: 'publish', checkedParts: ['a', 'b', 'c'], hiddenParts: [] }, parts), {
    ok: true, value: { checkedParts: ['a', 'b', 'c'], hiddenParts: [] },
  });
  const code = (body: unknown): string => { const r = validatePublishBody(body, parts); return r.ok ? 'ok' : r.code; };
  assert.equal(code({ action: 'publish', checkedParts: ['a', 'b'], hiddenParts: [] }), 'REVIEW_INCOMPLETE');
  assert.equal(code({ action: 'publish', checkedParts: ['a', 'b'], hiddenParts: ['c'] }), 'ok');
  assert.equal(code({ action: 'publish', checkedParts: [], hiddenParts: ['a', 'b', 'c'] }), 'NOTHING_TO_PUBLISH');
  assert.equal(code({ action: 'publish', checkedParts: ['a', 'b', 'c'], hiddenParts: ['a', 'b', 'c'] }), 'NOTHING_TO_PUBLISH');
  assert.equal(code({ action: 'publish', checkedParts: ['a', 'zzz'], hiddenParts: [] }), 'BAD_REQUEST');
  assert.equal(code({ action: 'publish', checkedParts: ['a'], hiddenParts: ['zzz'] }), 'BAD_REQUEST');
  assert.equal(code({ action: 'publish', checkedParts: 'a', hiddenParts: [] }), 'BAD_REQUEST');
  assert.equal(code({ action: 'publish', checkedParts: ['a', 1], hiddenParts: [] }), 'BAD_REQUEST');
  assert.equal(code({ action: 'publish', checkedParts: ['a', 'b', 'c'] }), 'BAD_REQUEST', 'both lists are required');
  assert.equal(code({ action: 'publish' }), 'BAD_REQUEST');
  assert.equal(code({ action: 'approve' }), 'BAD_REQUEST');
  assert.equal(code(null), 'BAD_REQUEST');
  assert.equal(code([]), 'BAD_REQUEST');
  assert.equal(code({ action: 'publish', checkedParts: ['a'], hiddenParts: [] }), 'REVIEW_INCOMPLETE');
  assert.equal(validatePublishBody({ action: 'publish', checkedParts: [], hiddenParts: [] }, []).ok, false, 'nothing to publish at all');
});

test('validatePublishBody: duplicates collapse and the lists keep the lesson’s order', () => {
  const r = validatePublishBody({ action: 'publish', checkedParts: ['c', 'a', 'a', 'b'], hiddenParts: ['b', 'b'] }, ['a', 'b', 'c']);
  assert.deepEqual(r, { ok: true, value: { checkedParts: ['a', 'b', 'c'], hiddenParts: ['b'] } });
});

// ---- publish, read back, unpublish -------------------------------------------------------------------------------

test('publish writes review.json and GET /api/jobs/:id carries it; unpublish removes it', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
    assert.equal(((await call(base, 'GET', `/api/jobs/${JOB}`)).body as Record<string, unknown>)['review'], undefined, 'no file means not reviewed');

    const res = await publish(base, JOB, { action: 'publish', checkedParts: ['quiz-cards-v1', 'sequence-v1'], hiddenParts: ['sort-groups-v1'] });
    assert.equal(res.status, 200);
    const expected = {
      status: 'published',
      publishedAt: '2026-11-02T12:30:00.000Z',
      hiddenParts: ['sort-groups-v1'],
      checkedParts: ['quiz-cards-v1', 'sequence-v1'],
    };
    assert.deepEqual(res.body, { review: expected }, 'the answer is always { review: record | null }');
    assert.deepEqual(JSON.parse(readFileSync(reviewFilePath(storageDir, JOB), 'utf8')), expected);
    assert.deepEqual(readReview(storageDir, JOB), expected);

    const detail = await call(base, 'GET', `/api/jobs/${JOB}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body['review'], expected, 'the detail carries the bare record');
    assert.equal((detail.body['summary'] as Record<string, unknown>)['jobId'], JOB, 'the rest of the detail is unchanged');

    const off = await publish(base, JOB, { action: 'unpublish' });
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { review: null });
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
    assert.equal(((await call(base, 'GET', `/api/jobs/${JOB}`)).body as Record<string, unknown>)['review'], undefined);
    // unpublishing a lesson that is not published is harmless
    assert.equal((await publish(base, JOB, { action: 'unpublish' })).status, 200);
  });
});

test('the write is atomic: no temp files are left beside review.json', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    assert.equal((await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] })).status, 200);
    assert.equal((await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] })).status, 200, 'publishing again replaces it');
    const files = readdirSync(join(storageDir, 'runs', JOB)).sort();
    assert.ok(files.includes('review.json'));
    assert.deepEqual(files.filter(f => f.includes('tmp') || f.endsWith('.new')), []);
  });
});

test('a damaged review.json reads as not reviewed (never a half-published lesson)', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    writeFileSync(reviewFilePath(storageDir, JOB), '{"status":"published","publishedAt":', 'utf8');
    assert.equal(readReview(storageDir, JOB), null);
    assert.equal((await call(base, 'GET', `/api/jobs/${JOB}`)).body['review'], undefined);
    writeJson(reviewFilePath(storageDir, JOB), { status: 'draft', publishedAt: 'x', hiddenParts: [], checkedParts: [] });
    assert.equal(readReview(storageDir, JOB), null);
    writeJson(reviewFilePath(storageDir, JOB), { status: 'published', publishedAt: 'not a date', hiddenParts: [], checkedParts: [] });
    assert.equal(readReview(storageDir, JOB), null);
    writeJson(reviewFilePath(storageDir, JOB), { status: 'published', publishedAt: '2026-11-02T12:30:00.000Z', hiddenParts: 'x', checkedParts: [] });
    assert.equal(readReview(storageDir, JOB), null);
  });
});

test('the job list marks published lessons (reviewPublishedAt) and leaves the others alone', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const other = seedJob(storageDir, { jobId: 'job-20261102000100-bbbb2222', createdAt: '2026-11-02T00:01:00.000Z' });
    await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] });
    const list = (await (await fetch(`${base}/api/jobs`)).json()) as Record<string, unknown>[];
    const byId = new Map(list.map(j => [j['jobId'], j]));
    assert.equal(byId.get(JOB)?.['reviewPublishedAt'], '2026-11-02T12:30:00.000Z');
    assert.equal(byId.get(other)?.['reviewPublishedAt'], undefined);
    assert.equal('reviewPublishedAt' in (byId.get(other) as object), false);
  });
});

test('a new job (a rebuild) starts unreviewed: review belongs to one job directory', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] });
    const rebuilt = seedJob(storageDir, { jobId: 'job-20261102010000-cccc3333', createdAt: '2026-11-02T01:00:00.000Z' });
    assert.equal(existsSync(reviewFilePath(storageDir, rebuilt)), false);
    assert.equal((await call(base, 'GET', `/api/jobs/${rebuilt}`)).body['review'], undefined);
  });
});

// ---- refusals ----------------------------------------------------------------------------------------------------

test('REVIEW_INCOMPLETE: every visible part must be ticked', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const r = await publish(base, JOB, { action: 'publish', checkedParts: ['quiz-cards-v1'], hiddenParts: ['sort-groups-v1'] });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'REVIEW_INCOMPLETE' });
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false, 'nothing is stored');
  });
});

test('NOTHING_TO_PUBLISH: at least one part must stay visible', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const r = await publish(base, JOB, { action: 'publish', checkedParts: [], hiddenParts: ALL });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, { error: 'NOTHING_TO_PUBLISH' });
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
  });
});

test('BAD_REQUEST: unknown part ids, a part the lesson left out, wrong shapes, bad JSON', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir, { parts: [{ componentId: 'quiz-cards-v1' }, { componentId: 'sequence-v1', status: 'failed' }] });
    const bad = async (body: unknown): Promise<number> => (await publish(base, JOB, body)).status;
    assert.equal(await bad({ action: 'publish', checkedParts: ['quiz-cards-v1', 'made-up-v1'], hiddenParts: [] }), 400);
    assert.equal(await bad({ action: 'publish', checkedParts: ['quiz-cards-v1', 'sequence-v1'], hiddenParts: [] }), 400, 'a failed part is not a published part');
    assert.equal(await bad({ action: 'publish', checkedParts: ['quiz-cards-v1'], hiddenParts: ['made-up-v1'] }), 400);
    assert.equal(await bad({ action: 'bless' }), 400);
    assert.equal(await bad([1, 2]), 400);
    assert.equal(await bad('{not json'), 400);
    assert.equal((await publish(base, JOB, { action: 'publish', checkedParts: ['quiz-cards-v1'], hiddenParts: [] })).status, 200, 'the failed part does not block publishing the rest');
    const stored = readReview(storageDir, JOB);
    assert.deepEqual(stored?.checkedParts, ['quiz-cards-v1']);
  });
});

test('NOT_REVIEWABLE: running, failed and classic-activity jobs; unknown jobs are 404', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    const body = { action: 'publish', checkedParts: ['quiz-cards-v1'], hiddenParts: [] };
    const running = seedJob(storageDir, { jobId: 'job-run-1', status: 'running' });
    const failed = seedJob(storageDir, { jobId: 'job-fail-1', status: 'failed' });
    const declined = seedJob(storageDir, { jobId: 'job-decl-1', status: 'unsupported' });
    const activity = seedJob(storageDir, { jobId: 'job-act-1', flow: 'activity', omitLesson: true });
    for (const id of [running, failed, declined, activity]) {
      const r = await publish(base, id, body);
      assert.equal(r.status, 409, id);
      assert.deepEqual(r.body, { error: 'NOT_REVIEWABLE' }, id);
      assert.equal(existsSync(reviewFilePath(storageDir, id)), false);
      assert.equal((await publish(base, id, { action: 'unpublish' })).status, 409, `${id} unpublish`);
    }
    assert.equal((await publish(base, 'job-does-not-exist', body)).status, 404);
    assert.equal((await call(base, 'POST', '/api/jobs/..%2Fescape/review', { body })).status, 404);
    assert.equal((await call(base, 'POST', '/api/jobs/a%2Fb/review', { body })).status, 404);
  });
});

test('only POST reaches the route; the content type and size are checked', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    assert.equal((await call(base, 'GET', `/api/jobs/${JOB}/review`)).status, 405);
    assert.equal((await call(base, 'DELETE', `/api/jobs/${JOB}/review`)).status, 405);
    assert.equal((await call(base, 'POST', `/api/jobs/${JOB}/review`, { body: 'action=publish', headers: { 'content-type': 'text/plain' } })).status, 415);
    const huge = { action: 'publish', checkedParts: Array.from({ length: 5000 }, (_, i) => `part-${i}`), hiddenParts: [] };
    assert.equal((await publish(base, JOB, huge)).status, 413);
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
  });
});

test('the same Origin check as every POST', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const body = { action: 'publish', checkedParts: ALL, hiddenParts: [] };
    const evil = await publish(base, JOB, body, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403);
    assert.deepEqual(evil.body, { error: 'ORIGIN_NOT_ALLOWED' });
    const https = await publish(base, JOB, body, { origin: `https://${new URL(base).host}` });
    assert.equal(https.status, 403);
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
    assert.equal((await publish(base, JOB, body, { origin: base })).status, 200);
  });
});

// ---- the access gate ---------------------------------------------------------------------------------------------

test('gate off: publishing works without any session (today’s local behaviour)', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    seedJob(storageDir);
    assert.equal((await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] })).status, 200);
  });
});

test('gate on: no session is 403 ACCESS_REQUIRED, for publish and unpublish, before anything else is read', async () => {
  await withServer({ access: gate() }, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const body = { action: 'publish', checkedParts: ALL, hiddenParts: [] };
    const r = await publish(base, JOB, body);
    assert.equal(r.status, 403);
    assert.deepEqual(r.body, { error: 'ACCESS_REQUIRED' });
    assert.equal(existsSync(reviewFilePath(storageDir, JOB)), false);
    // no session also beats a bad body and an unknown job: nothing leaks to a visitor
    assert.equal((await publish(base, JOB, '{not json')).status, 403);
    assert.equal((await publish(base, 'job-does-not-exist', body)).status, 403);
    assert.equal((await publish(base, JOB, { action: 'unpublish' })).status, 403);
    // a forged cookie is no session either
    assert.equal((await publish(base, JOB, body, { cookie: 'mki_access=forged.value' })).status, 403);
  });
});

test('gate on: a signed-in judge publishes; the cap and builds-paused state do not matter (publishing is free)', async () => {
  await withServer({ access: { ...gate(), buildsPaused: () => true } }, async ({ base, storageDir }) => {
    seedJob(storageDir);
    const signIn = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(signIn.status, 200);
    const cookie = (signIn.setCookie[0] as string).split(';')[0] as string;
    const ok = await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: ['sort-groups-v1'] }, { cookie });
    assert.equal(ok.status, 200);
    assert.deepEqual((await call(base, 'GET', `/api/jobs/${JOB}`)).body['review'], ok.body['review'], 'every GET stays open');
    assert.equal((await publish(base, JOB, { action: 'unpublish' }, { cookie })).status, 200);
    // the cookie from a signed-out session stops working
    await call(base, 'DELETE', '/api/access', { headers: { cookie } });
    assert.equal((await publish(base, JOB, { action: 'unpublish' }, { cookie })).status, 403);
  });
});

test('publishing never calls startJob and writes no ledger entry', async () => {
  let started = 0;
  await withServer({ startJob: () => { started += 1; throw new Error('must not start'); } }, async ({ base, storageDir }) => {
    seedJob(storageDir);
    await publish(base, JOB, { action: 'publish', checkedParts: ALL, hiddenParts: [] });
    assert.equal(started, 0);
    assert.equal(existsSync(join(storageDir, 'ledger.jsonl')), false);
  });
});
