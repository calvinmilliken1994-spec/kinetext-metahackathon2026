// Teacher diagram (beta), docs/specs/TEACHER-FIGURE.md section 2: POST /api/sources/:id/figure, GET /api/figures for
// uf- ids, and the optional figureId on POST /api/jobs. Ephemeral servers on 127.0.0.1:0, temp storage, a FAKE
// startJob, hand-built PNG/JPEG bytes. No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { userFigureId } from '../../packages/sources/index.ts';
import { jpeg, png } from '../../packages/sources/testing/image-fixtures.ts';

const CODE = 'judge-code-for-tests-tf01';
const SECRET = 'session-secret-for-tests-tf01';
const LIBRARY_SOURCE = 'medlineplus-what-is-dna'; // a real library page (read-only)
const ORIGIN = 'http://localhost:5173';
const PAGE = 'The water cycle moves water between the oceans, the air and the land. '.repeat(6);

type StartOpts = Parameters<NonNullable<ApiOptions['startJob']>>[1];
interface StartCall {
  sourceId: string;
  opts: StartOpts;
}

interface Harness {
  base: string;
  storageDir: string;
  calls: StartCall[];
}

async function withServer(over: Partial<ApiOptions>, run: (h: Harness) => Promise<void>): Promise<void> {
  const storageDir = mkdtempSync(join(tmpdir(), 'tf-api-'));
  const calls: StartCall[] = [];
  let n = 0;
  const server: Server = createApiServer({
    storageDir,
    startJob: (sourceId, opts) => {
      calls.push({ sourceId, opts });
      n += 1;
      return { jobId: `job-fake-${n}`, done: new Promise(() => {}) as never };
    },
    maxConcurrentJobs: 8,
    ...over,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({ base, storageDir, calls });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  raw: Buffer;
}

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
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: Record<string, unknown> = {};
  if ((res.headers.get('content-type') ?? '').startsWith('application/json') && raw.length > 0) {
    parsed = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
  }
  return { status: res.status, body: parsed, headers: res.headers, raw };
}

async function createSource(base: string, text = PAGE, headers: Record<string, string> = {}): Promise<string> {
  const r = await call(base, 'POST', '/api/sources', {
    body: { title: 'Water cycle notes', text, license: 'cc-by', attribution: 'Ms Example', rightsConfirmed: true },
    headers,
  });
  assert.ok(r.status === 201 || r.status === 200, `source stored: ${r.status}`);
  return r.body['id'] as string;
}

const figureBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  mime: 'image/png',
  base64: png(640, 480).toString('base64'),
  rights: true,
  ...over,
});
const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');

/* ------------------------------------------------------------------ */
/* POST /api/sources/:id/figure                                          */
/* ------------------------------------------------------------------ */

test('upload: 201 {figureId, width, height, created:true}, then 200 created:false for the same image; another image is a new id', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    const sourceId = await createSource(base);
    const first = await call(base, 'POST', `/api/sources/${sourceId}/figure`, {
      body: figureBody({ caption: '  The water   cycle ' }),
      headers: { origin: ORIGIN },
    });
    assert.equal(first.status, 201);
    const figureId = userFigureId(sourceId, sha(png(640, 480)));
    assert.deepEqual(first.body, { figureId, width: 640, height: 480, created: true });
    const sidecar = JSON.parse(readFileSync(join(storageDir, 'user-figures', `${figureId}.json`), 'utf8'));
    assert.equal(sidecar.caption, 'The water cycle');
    assert.equal(sidecar.sourceId, sourceId);
    assert.equal(sidecar.provided, 'teacher');
    assert.equal(sidecar.credit, 'Ms Example');
    assert.equal(sidecar.license, 'CC BY 4.0');

    const again = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: figureBody({ caption: 'other' }) });
    assert.equal(again.status, 200);
    assert.deepEqual(again.body, { figureId, width: 640, height: 480, created: false });

    const jpg = await call(base, 'POST', `/api/sources/${sourceId}/figure`, {
      body: figureBody({ mime: 'image/jpeg', base64: jpeg(800, 600, 0xc2).toString('base64') }),
    });
    assert.equal(jpg.status, 201);
    assert.notEqual(jpg.body['figureId'], figureId);
    assert.equal(jpg.body['width'], 800);
    assert.equal(jpg.body['height'], 600);
  });
});

test('upload: 400 FIGURE_INVALID with plain problems[] (rights, mime, base64, magic, size, caption)', async () => {
  await withServer({}, async ({ base }) => {
    const sourceId = await createSource(base);
    const cases: [Record<string, unknown>, string[]][] = [
      [figureBody({ rights: false }), ['RIGHTS_NOT_CONFIRMED']],
      [figureBody({ mime: 'image/webp' }), ['MIME_INVALID']],
      [figureBody({ base64: '%%%' }), ['BASE64_INVALID']],
      [figureBody({ mime: 'image/jpeg' }), ['IMAGE_TYPE_MISMATCH']],
      [figureBody({ base64: png(32, 32).toString('base64') }), ['IMAGE_DIMENSIONS']],
      [figureBody({ base64: png(64, 64, 4 * 1024 * 1024 + 1).toString('base64') }), ['IMAGE_TOO_LARGE']],
      [figureBody({ caption: 'c'.repeat(301) }), ['CAPTION_LENGTH']],
    ];
    for (const [body, problems] of cases) {
      const r = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body });
      assert.equal(r.status, 400, JSON.stringify(problems));
      assert.deepEqual(r.body, { error: 'FIGURE_INVALID', problems });
    }
    const notJson = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: '{nope' });
    assert.equal(notJson.status, 400);
    assert.deepEqual(notJson.body, { error: 'BAD_REQUEST' });
  });
});

test('upload: 404 for an unknown or malformed source id; a library source is 400 FIGURE_SOURCE_NOT_USER', async () => {
  await withServer({}, async ({ base }) => {
    for (const id of ['user-0123456789ab', 'no-such-page', 'USER-x']) {
      const r = await call(base, 'POST', `/api/sources/${id}/figure`, { body: figureBody() });
      assert.equal(r.status, 404, id);
      assert.deepEqual(r.body, { error: 'NOT_FOUND' });
    }
    const lib = await call(base, 'POST', `/api/sources/${LIBRARY_SOURCE}/figure`, { body: figureBody() });
    assert.equal(lib.status, 400);
    assert.deepEqual(lib.body, { error: 'FIGURE_SOURCE_NOT_USER' });
    // other sub-paths stay 404 and the source detail route keeps answering 405 for POST
    const sourceId = await createSource(base);
    assert.equal((await call(base, 'POST', `/api/sources/${sourceId}/figures`, { body: figureBody() })).status, 404);
    assert.equal((await call(base, 'POST', `/api/sources/${sourceId}`, { body: figureBody() })).status, 405);
    assert.equal((await call(base, 'GET', `/api/sources/${sourceId}/figure`)).status, 405);
  });
});

test('upload: 415 without JSON, 413 over 6 MB raw', async () => {
  await withServer({}, async ({ base }) => {
    const sourceId = await createSource(base);
    const text = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: 'x', headers: { 'content-type': 'text/plain' } });
    assert.equal(text.status, 415);
    const big = await call(base, 'POST', `/api/sources/${sourceId}/figure`, {
      body: JSON.stringify(figureBody({ caption: 'x'.repeat(6 * 1024 * 1024) })),
    });
    assert.equal(big.status, 413);
    assert.deepEqual(big.body, { error: 'PAYLOAD_TOO_LARGE' });
  });
});

test('upload: gated exactly like POST /api/sources (403 ACCESS_REQUIRED without a session, 403 ORIGIN_NOT_ALLOWED)', async () => {
  await withServer({ access: { code: CODE, sessionSecret: SECRET, buildsPaused: () => false } }, async ({ base }) => {
    const signIn = await fetch(`${base}/api/access`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: CODE }),
    });
    assert.equal(signIn.status, 200);
    const cookie = (signIn.headers.getSetCookie()[0] ?? '').split(';')[0] as string;
    const sourceId = await createSource(base, PAGE, { cookie });

    const noSession = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: figureBody() });
    assert.equal(noSession.status, 403);
    assert.deepEqual(noSession.body, { error: 'ACCESS_REQUIRED' });
    // the gate answers before anything about the source is revealed
    const unknown = await call(base, 'POST', '/api/sources/user-0123456789ab/figure', { body: figureBody() });
    assert.equal(unknown.status, 403);

    const badOrigin = await call(base, 'POST', `/api/sources/${sourceId}/figure`, {
      body: figureBody(),
      headers: { cookie, origin: 'https://attacker.example' },
    });
    assert.equal(badOrigin.status, 403);
    assert.deepEqual(badOrigin.body, { error: 'ORIGIN_NOT_ALLOWED' });

    const ok = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: figureBody(), headers: { cookie, origin: ORIGIN } });
    assert.equal(ok.status, 201);
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/figures for uf- ids                                          */
/* ------------------------------------------------------------------ */

test('GET /api/figures/:uf-id and /image serve the teacher figure with the same sha256 checks', async () => {
  await withServer({}, async ({ base, storageDir }) => {
    const sourceId = await createSource(base);
    const bytes = png(640, 480);
    const up = await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: figureBody() });
    const figureId = up.body['figureId'] as string;

    const meta = await call(base, 'GET', `/api/figures/${figureId}`);
    assert.equal(meta.status, 200);
    assert.equal(meta.body['id'], figureId);
    assert.equal(meta.body['provided'], 'teacher');
    assert.equal(meta.body['sha256'], sha(bytes));

    const img = await call(base, 'GET', `/api/figures/${figureId}/image`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal(img.headers.get('etag'), `"${sha(bytes)}"`);
    assert.ok(img.raw.equals(bytes), 'the exact stored bytes');

    // an unknown uf- id is 404; tampered bytes are refused like a library figure
    assert.equal((await call(base, 'GET', '/api/figures/uf-000000000000')).status, 404);
    writeFileSync(join(storageDir, 'user-figures', `${figureId}.png`), png(641, 480));
    const tampered = await call(base, 'GET', `/api/figures/${figureId}/image`);
    assert.equal(tampered.status, 500);
    assert.deepEqual(tampered.body, { error: 'FIGURE_UNAVAILABLE' });
    // library figures are unchanged
    assert.equal((await call(base, 'GET', '/api/figures/medlineplus-dna-structure-1')).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/jobs figureId                                               */
/* ------------------------------------------------------------------ */

test('POST /api/jobs: a figureId of the user source travels to startJob; every other figureId is 400 FIGURE_INVALID', async () => {
  await withServer({}, async ({ base, calls }) => {
    const sourceId = await createSource(base);
    const otherSource = await createSource(base, `${PAGE} Another page about clouds and rain.`);
    assert.notEqual(otherSource, sourceId);
    const figureId = (await call(base, 'POST', `/api/sources/${sourceId}/figure`, { body: figureBody() })).body['figureId'] as string;
    const otherFigure = (await call(base, 'POST', `/api/sources/${otherSource}/figure`, { body: figureBody() })).body['figureId'] as string;

    const ok = await call(base, 'POST', '/api/jobs', { body: { sourceId, figureId } });
    assert.equal(ok.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.sourceId, sourceId);
    assert.equal(calls[0]!.opts?.figureId, figureId);

    const bad: [string, Record<string, unknown>][] = [
      ['wrong pattern', { sourceId, figureId: 'medlineplus-dna-structure-1' }],
      ['not a string', { sourceId, figureId: 12 }],
      ['empty', { sourceId, figureId: '' }],
      ['missing figure', { sourceId, figureId: 'uf-000000000000' }],
      ['another source\'s figure', { sourceId, figureId: otherFigure }],
      ['library source', { sourceId: LIBRARY_SOURCE, figureId }],
    ];
    for (const [why, body] of bad) {
      const r = await call(base, 'POST', '/api/jobs', { body });
      assert.equal(r.status, 400, why);
      assert.deepEqual(r.body, { error: 'FIGURE_INVALID' }, why);
    }
    assert.equal(calls.length, 1, 'no job started for a refused figure');

    // without a figureId nothing changes (no key on the start options)
    const plain = await call(base, 'POST', '/api/jobs', { body: { sourceId } });
    assert.equal(plain.status, 202);
    assert.ok(!('figureId' in (calls[1]!.opts ?? {})));
    // an unknown source is still the 404 it always was
    const unknown = await call(base, 'POST', '/api/jobs', { body: { sourceId: 'user-0123456789ab', figureId } });
    assert.equal(unknown.status, 404);
  });
});
