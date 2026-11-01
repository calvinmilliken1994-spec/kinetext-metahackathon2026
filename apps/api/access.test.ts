// Stage 10 slice A — judge access code (docs/specs/STAGE-10-navigation-and-access.md section A).
// Ephemeral servers on 127.0.0.1:0, a FAKE startJob, job records written straight into a temp
// storage dir. No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import {
  ACCESS_COOKIE_NAME,
  ACCESS_COOKIE_MAX_AGE_S,
  DEFAULT_JUDGE_CAP_USD,
  JUDGE_MIN_HEADROOM_USD,
  safeEqual,
  signSession,
  verifySession,
} from './access.ts';

const CODE = 'judge-code-for-tests-7Q2x';
const SECRET = 'session-secret-for-tests-9fL3';
const SOURCE_ID = 'bls-cpi-escalation'; // a real library page (read-only)
const SOURCE_TEXT = 'The runway is long enough for the plane to stop safely. '.repeat(12);

type StartOpts = Parameters<NonNullable<ApiOptions['startJob']>>[1];
interface StartCall {
  sourceId: string;
  opts: StartOpts;
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'stage10-access-'));
}

function fakeStart(calls: StartCall[]): NonNullable<ApiOptions['startJob']> {
  let n = 0;
  return (sourceId, opts) => {
    calls.push({ sourceId, opts });
    n += 1;
    return { jobId: `job-fake-${n}`, done: new Promise(() => {}) as never };
  };
}

interface Harness {
  base: string;
  storageDir: string;
  calls: StartCall[];
}

async function withServer(
  over: Partial<ApiOptions> & { live?: boolean },
  run: (h: Harness) => Promise<void>,
): Promise<void> {
  const storageDir = over.storageDir ?? tempStorage();
  const calls: StartCall[] = [];
  const { live, ...rest } = over;
  const server: Server = createApiServer({
    storageDir,
    startJob: live === false ? null : fakeStart(calls),
    maxConcurrentJobs: 8,
    ...rest,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({ base, storageDir, calls });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

/** Gate-on access options with the env kill switch pinned off (tests stay independent of process.env). */
function gate(extra: Partial<NonNullable<ApiOptions['access']>> = {}): NonNullable<ApiOptions['access']> {
  return { code: CODE, sessionSecret: SECRET, buildsPaused: () => false, ...extra };
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
  setCookie: string[];
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
  const text = await res.text();
  return {
    status: res.status,
    body: (text === '' ? {} : JSON.parse(text)) as Record<string, unknown>,
    headers: res.headers,
    setCookie: res.headers.getSetCookie(),
  };
}

/** The name=value part of a Set-Cookie, ready for a Cookie request header. */
function cookieHeader(reply: Reply): string {
  const first = reply.setCookie[0];
  assert.ok(first !== undefined, 'a Set-Cookie header was sent');
  return first.split(';')[0] as string;
}

async function signIn(base: string, headers: Record<string, string> = {}): Promise<string> {
  const reply = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers });
  assert.equal(reply.status, 200);
  return cookieHeader(reply);
}

/** Write a stored job record the way the worker does (job.json + events.jsonl). */
function writeJob(
  storageDir: string,
  jobId: string,
  fields: Record<string, unknown>,
  eventCosts: number[] = [],
): void {
  const dir = join(storageDir, 'runs', jobId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'job.json'),
    JSON.stringify({
      jobId,
      sourceId: SOURCE_ID,
      status: 'succeeded',
      purpose: 'demo',
      createdAt: '2026-11-02T00:00:00.000Z',
      totalCostUSD: 0,
      reservedUnknownUSD: 0,
      engine: null,
      revisions: 0,
      repairs: [],
      sourceKind: 'library',
      ...fields,
    }),
  );
  writeFileSync(
    join(dir, 'events.jsonl'),
    eventCosts
      .map((c, i) => JSON.stringify({ jobId, seq: i, stage: 'component', status: 'completed', at: 'x', estCostUSD: c }))
      .join('\n') + (eventCosts.length > 0 ? '\n' : ''),
  );
}

const JOB_BODY = { sourceId: SOURCE_ID };
const SOURCE_BODY = {
  title: 'Runway physics notes',
  text: SOURCE_TEXT,
  license: 'own-work',
  attribution: 'Written by the teacher for this class.',
  rightsConfirmed: true,
};

/* ------------------------------------------------------------------ */
/* pure helpers                                                         */
/* ------------------------------------------------------------------ */

test('safeEqual: equal strings match, any difference or length mismatch does not (constant-time digests)', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
  assert.equal(safeEqual('abc', ''), false);
});

test('session cookie: sign/verify round-trips, rejects tampering, a wrong key, expiry and future stamps', () => {
  const key = Buffer.from('k'.repeat(32));
  const now = 1_800_000_000_000;
  const value = signSession(key, 'sess-1', now);
  assert.deepEqual(verifySession(key, value, now + 1000), { sessionId: 'sess-1', issuedAt: now });
  // wrong key
  assert.equal(verifySession(Buffer.from('z'.repeat(32)), value, now), null);
  // tampered payload and tampered signature
  const [payload, sig] = value.split('.') as [string, string];
  const flip = (s: string): string => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
  assert.equal(verifySession(key, `${flip(payload)}.${sig}`, now), null);
  assert.equal(verifySession(key, `${payload}.${flip(sig)}`, now), null);
  assert.equal(verifySession(key, 'garbage', now), null);
  assert.equal(verifySession(key, '', now), null);
  assert.equal(verifySession(key, `${payload}.`, now), null);
  // Max-Age boundary: valid just inside the week, invalid at/after it
  assert.ok(verifySession(key, value, now + ACCESS_COOKIE_MAX_AGE_S * 1000 - 1) !== null);
  assert.equal(verifySession(key, value, now + ACCESS_COOKIE_MAX_AGE_S * 1000), null);
  // issued in the future (beyond a small clock skew) is rejected
  assert.equal(verifySession(key, signSession(key, 's', now + 10 * 60_000), now), null);
  assert.equal(ACCESS_COOKIE_MAX_AGE_S, 604800);
  assert.equal(ACCESS_COOKIE_NAME, 'mki_access');
});

/* ------------------------------------------------------------------ */
/* gate off: unchanged                                                  */
/* ------------------------------------------------------------------ */

test('gate off: GET /api/access reports granted, the default cap and judge spend only', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-a', { access: 'judge', totalCostUSD: 2.5 });
  writeJob(storageDir, 'job-b', { totalCostUSD: 40 }); // not a judge job
  await withServer({ storageDir }, async ({ base }) => {
    const r = await call(base, 'GET', '/api/access');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      gate: false,
      granted: true,
      capUSD: DEFAULT_JUDGE_CAP_USD,
      spentUSD: 2.5,
      remainingUSD: DEFAULT_JUDGE_CAP_USD - 2.5,
      buildsEnabled: true,
    });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  });
});

test('gate off (and an empty code counts as off): POST /api/jobs and /api/sources work without any session and record no access tag', async () => {
  for (const access of [undefined, { code: '' }, { code: '', sessionSecret: SECRET }]) {
    await withServer({ ...(access !== undefined ? { access } : {}) }, async ({ base, calls }) => {
      const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY });
      assert.equal(job.status, 202);
      assert.equal(calls.length, 1);
      assert.equal('access' in calls[0]!.opts!, false, 'gate off: startJob opts are exactly what they were before');
      const src = await call(base, 'POST', '/api/sources', { body: SOURCE_BODY });
      assert.equal(src.status, 201);
    });
  }
});

test('gate off: POST /api/access answers 200 with no cookie and DELETE is harmless', async () => {
  await withServer({}, async ({ base }) => {
    const post = await call(base, 'POST', '/api/access', { body: { code: 'whatever' } });
    assert.equal(post.status, 200);
    assert.equal(post.body['gate'], false);
    assert.equal(post.body['granted'], true);
    assert.deepEqual(post.setCookie, []);
    const del = await call(base, 'DELETE', '/api/access');
    assert.equal(del.status, 200);
    assert.equal(del.body['granted'], true);
  });
});

test('gate off: the kill switch does not touch POST /api/jobs (behaviour unchanged) but buildsEnabled reports it', async () => {
  const storageDir = tempStorage();
  writeFileSync(join(storageDir, 'BUILDS_PAUSED'), '');
  await withServer({ storageDir }, async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/access')).body['buildsEnabled'], false);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY })).status, 202);
  });
});

/* ------------------------------------------------------------------ */
/* GET / POST / DELETE /api/access with the gate on                      */
/* ------------------------------------------------------------------ */

test('gate on: GET /api/access without a session is read-only: gate true, granted false, full body', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const r = await call(base, 'GET', '/api/access');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, {
      gate: true,
      granted: false,
      capUSD: 50,
      spentUSD: 0,
      remainingUSD: 50,
      buildsEnabled: true,
    });
    assert.deepEqual(r.setCookie, []);
    // the code and secret never appear in any body
    assert.ok(!JSON.stringify(r.body).includes(CODE));
  });
});

test('gate on: a wrong code is 401 ACCESS_CODE_INVALID with no cookie; a non-string code is 400', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const wrong = await call(base, 'POST', '/api/access', { body: { code: 'nope' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, { error: 'ACCESS_CODE_INVALID' });
    assert.deepEqual(wrong.setCookie, []);
    // a prefix and a longer string are wrong too (equal-length digests are compared, never the raw strings)
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE.slice(0, -1) } })).status, 401);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: `${CODE}x` } })).status, 401);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: '' } })).status, 401);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: 12345 } })).status, 400);
    assert.equal((await call(base, 'POST', '/api/access', { body: {} })).status, 400);
    assert.equal((await call(base, 'POST', '/api/access', { body: 'not json' })).status, 400);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { 'content-type': 'text/plain' } })).status, 415);
  });
});

test('gate on: the right code is 200 with granted true and an HttpOnly SameSite=Strict signed cookie (no Secure over http)', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const r = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { gate: true, granted: true, capUSD: 50, spentUSD: 0, remainingUSD: 50, buildsEnabled: true });
    assert.equal(r.setCookie.length, 1);
    const sc = r.setCookie[0]!;
    assert.match(sc, new RegExp(`^${ACCESS_COOKIE_NAME}=[A-Za-z0-9_.-]+;`));
    assert.match(sc, /; HttpOnly/);
    assert.match(sc, /; SameSite=Strict/);
    assert.match(sc, /; Path=\//);
    assert.match(sc, /; Max-Age=604800(;|$)/);
    assert.doesNotMatch(sc, /Secure/);
    assert.ok(!sc.includes(CODE) && !sc.includes(SECRET), 'the cookie carries neither the code nor the secret');
    // the session then reads as granted
    const me = await call(base, 'GET', '/api/access', { headers: { cookie: cookieHeader(r) } });
    assert.equal(me.body['granted'], true);
    assert.equal(me.body['gate'], true);
  });
});

test('gate on: Secure is added when the request is https via X-Forwarded-Proto', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const https = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.setCookie[0]!, /; Secure/);
    const chained = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { 'x-forwarded-proto': 'https, http' } });
    assert.match(chained.setCookie[0]!, /; Secure/);
    const plain = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { 'x-forwarded-proto': 'http' } });
    assert.doesNotMatch(plain.setCookie[0]!, /Secure/);
    // DELETE mirrors the flag so the browser accepts the clearing cookie
    const del = await call(base, 'DELETE', '/api/access', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(del.setCookie[0]!, /; Secure/);
  });
});

test('gate on: forged, tampered, wrong-secret and expired cookies are not sessions', async () => {
  let clock = 1_800_000_000_000;
  await withServer({ access: gate({ now: () => clock }) }, async ({ base }) => {
    const good = await signIn(base);
    const granted = async (cookie: string): Promise<unknown> =>
      (await call(base, 'GET', '/api/access', { headers: { cookie } })).body['granted'];
    assert.equal(await granted(good), true);

    const value = good.slice(`${ACCESS_COOKIE_NAME}=`.length);
    const [payload, sig] = value.split('.') as [string, string];
    const flip = (s: string): string => s.slice(0, -1) + (s.endsWith('A') ? 'B' : 'A');
    assert.equal(await granted(`${ACCESS_COOKIE_NAME}=${payload}.${flip(sig)}`), false);
    assert.equal(await granted(`${ACCESS_COOKIE_NAME}=${flip(payload)}.${sig}`), false);
    assert.equal(await granted(`${ACCESS_COOKIE_NAME}=garbage`), false);
    assert.equal(await granted(`${ACCESS_COOKIE_NAME}=`), false);
    assert.equal(await granted(`other=1; ${ACCESS_COOKIE_NAME}=${payload}.${flip(sig)}`), false);
    // signed with another key
    const forged = signSession(Buffer.from('attacker-key-'.repeat(3)), 'x', clock);
    assert.equal(await granted(`${ACCESS_COOKIE_NAME}=${forged}`), false);
    // the cookie among others still works
    assert.equal(await granted(`a=1; ${good}; b=2`), true);
    // Max-Age is enforced by the server, not only the browser
    clock += (ACCESS_COOKIE_MAX_AGE_S + 1) * 1000;
    assert.equal(await granted(good), false);
  });
});

test('gate on: a cookie minted under another ACCESS_CODE or secret is not a session', async () => {
  let cookie = '';
  await withServer({ access: gate() }, async ({ base }) => {
    cookie = await signIn(base);
  });
  await withServer({ access: gate({ code: `${CODE}-rotated` }) }, async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie } })).body['granted'], false, 'code rotation ends sessions');
  });
  await withServer({ access: gate({ sessionSecret: `${SECRET}-rotated` }) }, async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie } })).body['granted'], false, 'secret rotation ends sessions');
  });
  // no sessionSecret: a random per-process key, so sessions end on restart, but work within one process
  let randomCookie = '';
  await withServer({ access: { code: CODE, buildsPaused: () => false } }, async ({ base }) => {
    randomCookie = await signIn(base);
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie: randomCookie } })).body['granted'], true);
  });
  await withServer({ access: { code: CODE, buildsPaused: () => false } }, async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie: randomCookie } })).body['granted'], false);
  });
});

test('gate on: DELETE /api/access clears the cookie, returns the GET body and revokes that session server-side', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const cookie = await signIn(base);
    const del = await call(base, 'DELETE', '/api/access', { headers: { cookie } });
    assert.equal(del.status, 200);
    assert.equal(del.body['gate'], true);
    assert.equal(del.body['granted'], false);
    const sc = del.setCookie[0]!;
    assert.match(sc, new RegExp(`^${ACCESS_COOKIE_NAME}=;`));
    assert.match(sc, /; Max-Age=0/);
    assert.match(sc, /; HttpOnly/);
    assert.match(sc, /; SameSite=Strict/);
    assert.match(sc, /; Path=\//);
    // a copy of the old cookie no longer works
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie } })).body['granted'], false);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 403);
    // DELETE without any cookie is fine too
    assert.equal((await call(base, 'DELETE', '/api/access')).status, 200);
  });
});

test('/api/access: other methods are 405, and POST/DELETE keep the Origin check', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    assert.equal((await call(base, 'PUT', '/api/access', { body: {} })).status, 405);
    assert.equal((await call(base, 'PATCH', '/api/access', { body: {} })).status, 405);
    const evil = { origin: 'http://attacker.example' };
    const post = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: evil });
    assert.equal(post.status, 403);
    assert.deepEqual(post.body, { error: 'ORIGIN_NOT_ALLOWED' });
    assert.deepEqual(post.setCookie, []);
    const del = await call(base, 'DELETE', '/api/access', { headers: evil });
    assert.equal(del.status, 403);
    assert.deepEqual(del.body, { error: 'ORIGIN_NOT_ALLOWED' });
    // GET stays open whatever the Origin
    assert.equal((await call(base, 'GET', '/api/access', { headers: evil })).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* rate limit                                                           */
/* ------------------------------------------------------------------ */

test('rate limit: the 6th POST /api/access in a minute is 429 TOO_MANY_ATTEMPTS, even with the right code; it recovers after the window', async () => {
  let clock = 1_800_000_000_000;
  await withServer({ access: gate({ now: () => clock }) }, async ({ base }) => {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call(base, 'POST', '/api/access', { body: { code: `wrong-${i}` } })).status, 401);
    }
    const blocked = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, { error: 'TOO_MANY_ATTEMPTS' });
    assert.deepEqual(blocked.setCookie, [], 'a blocked attempt never mints a session');
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    // GET stays open while blocked
    assert.equal((await call(base, 'GET', '/api/access')).status, 200);
    clock += 61_000;
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE } })).status, 200);
  });
});

test('rate limit: per client address; X-Forwarded-For is honoured only with trustProxy (rightmost entry)', async () => {
  const clock = 1_800_000_000_000;
  // without trustProxy a forged header changes nothing: the limit follows the socket address
  await withServer({ access: gate({ now: () => clock }) }, async ({ base }) => {
    for (let i = 0; i < 5; i += 1) {
      await call(base, 'POST', '/api/access', { body: { code: 'x' }, headers: { 'x-forwarded-for': `10.0.0.${i}` } });
    }
    const r = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { 'x-forwarded-for': '10.9.9.9' } });
    assert.equal(r.status, 429);
  });
  // behind a trusted proxy each client address has its own budget
  await withServer({ access: gate({ now: () => clock, trustProxy: true }) }, async ({ base }) => {
    const from = (ip: string): Record<string, string> => ({ 'x-forwarded-for': `198.51.100.77, ${ip}` });
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call(base, 'POST', '/api/access', { body: { code: 'x' }, headers: from('203.0.113.1') })).status, 401);
    }
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: from('203.0.113.1') })).status, 429);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: from('203.0.113.2') })).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* gated writes                                                         */
/* ------------------------------------------------------------------ */

test('gate on: POST /api/jobs and /api/sources without a session are 403 ACCESS_REQUIRED and nothing starts or is stored', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, access: gate() }, async ({ base, calls }) => {
    const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY });
    assert.equal(job.status, 403);
    assert.deepEqual(job.body, { error: 'ACCESS_REQUIRED' });
    const src = await call(base, 'POST', '/api/sources', { body: SOURCE_BODY });
    assert.equal(src.status, 403);
    assert.deepEqual(src.body, { error: 'ACCESS_REQUIRED' });
    assert.equal(calls.length, 0);
    assert.equal(existsSync(join(storageDir, 'user-sources')), false, 'no source was written');
    // a bad cookie is the same as none
    const bad = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie: `${ACCESS_COOKIE_NAME}=a.b` } });
    assert.equal(bad.status, 403);
  });
});

test('gate on: the Origin check still comes first on gated writes', async () => {
  await withServer({ access: gate() }, async ({ base, calls }) => {
    const cookie = await signIn(base);
    const evil = { origin: 'http://attacker.example', cookie };
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: evil })).body['error'], 'ORIGIN_NOT_ALLOWED');
    assert.equal((await call(base, 'POST', '/api/sources', { body: SOURCE_BODY, headers: evil })).body['error'], 'ORIGIN_NOT_ALLOWED');
    assert.equal(calls.length, 0);
  });
});

test('gate on: with a session POST /api/jobs is 202 and the job is started with access: judge', async () => {
  await withServer({ access: gate() }, async ({ base, calls }) => {
    const cookie = await signIn(base);
    const r = await call(base, 'POST', '/api/jobs', {
      body: { sourceId: SOURCE_ID, model: 'muse-spark-1.3', flow: 'lesson' },
      headers: { cookie },
    });
    assert.equal(r.status, 202);
    assert.equal(r.body['jobId'], 'job-fake-1');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.opts!.access, 'judge');
    assert.equal(calls[0]!.opts!.model, 'muse-spark-1.3');
    assert.equal(calls[0]!.opts!.flow, 'lesson');
    // a demo fault is still forwarded as before
    const fault = await call(base, 'POST', '/api/jobs', { body: { sourceId: SOURCE_ID, demoFault: 'wrong-answer' }, headers: { cookie } });
    assert.equal(fault.status, 202);
    assert.equal(calls[1]!.opts!.demoFault, 'wrong-answer');
    assert.equal(calls[1]!.opts!.access, 'judge');
  });
});

test('gate on: with a session POST /api/sources stores the page (201), and validation errors keep their codes', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const cookie = await signIn(base);
    const ok = await call(base, 'POST', '/api/sources', { body: SOURCE_BODY, headers: { cookie } });
    assert.equal(ok.status, 201);
    const bad = await call(base, 'POST', '/api/sources', { body: { ...SOURCE_BODY, rightsConfirmed: false }, headers: { cookie } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body['error'], 'SOURCE_INVALID');
  });
});

test('gate on: every GET stays open without a session (browsing, replays and presenting are read-only for everyone)', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-open', { totalCostUSD: 0.1 });
  await withServer({ storageDir, access: gate() }, async ({ base }) => {
    for (const path of ['/api/health', '/api/models', '/api/sources', `/api/sources/${SOURCE_ID}`, '/api/jobs', '/api/jobs/job-open', '/api/access']) {
      const r = await call(base, 'GET', path);
      assert.equal(r.status, 200, `GET ${path} is open with the gate on`);
    }
  });
});

test('gate on: the Host allowlist still applies to /api/access', async () => {
  await withServer({ access: gate() }, async ({ base }) => {
    const port = Number(new URL(base).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/access', method: 'GET', headers: { host: 'evil.example' } }, res => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403);
  });
});

/* ------------------------------------------------------------------ */
/* cap, spend and headroom                                              */
/* ------------------------------------------------------------------ */

test('spent sums only judge-tagged jobs: finished ones by cost, running ones by live estimate or floor, others never', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-j1', { access: 'judge', status: 'succeeded', totalCostUSD: 3.25 }, [1, 2, 0.25]);
  writeJob(storageDir, 'job-j2', { access: 'judge', status: 'failed', totalCostUSD: 0.75 });
  // an interrupted job whose job.json never got its cost but whose events did
  writeJob(storageDir, 'job-j3', { access: 'judge', status: 'failed', totalCostUSD: 0 }, [0.5, 0.5]);
  // running: live accumulated estimate from the events (above the floor)
  writeJob(storageDir, 'job-j4', { access: 'judge', status: 'running', totalCostUSD: 0 }, [1.5, 0.5]);
  // running with nothing charged yet: counts the reserved floor
  writeJob(storageDir, 'job-j5', { access: 'judge', status: 'running', totalCostUSD: 0 });
  // not judge jobs: ignored whatever they cost (pre-existing runs, operator runs)
  writeJob(storageDir, 'job-o1', { status: 'succeeded', totalCostUSD: 20 });
  writeJob(storageDir, 'job-o2', { status: 'running', totalCostUSD: 5 }, [4]);
  writeJob(storageDir, 'job-o3', { access: 'operator', status: 'succeeded', totalCostUSD: 9 });
  await withServer({ storageDir, access: gate() }, async ({ base }) => {
    const r = await call(base, 'GET', '/api/access');
    // j1 3.25 (max of total and events 3.25) + j2 0.75 + j3 1.0 + j4 2.0 + j5 1.0 floor = 8.0
    assert.equal(JUDGE_MIN_HEADROOM_USD, 1);
    assert.equal(r.body['spentUSD'], 8);
    assert.equal(r.body['remainingUSD'], 42);
    assert.equal(r.body['capUSD'], 50);
  });
});

test('spent is re-read as jobs settle (a running judge job that finishes cheaper stops counting the floor)', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-run', { access: 'judge', status: 'running' });
  await withServer({ storageDir, access: gate() }, async ({ base }) => {
    assert.equal((await call(base, 'GET', '/api/access')).body['spentUSD'], 1);
    writeJob(storageDir, 'job-run', { access: 'judge', status: 'succeeded', totalCostUSD: 0.4 }, [0.4]);
    assert.equal((await call(base, 'GET', '/api/access')).body['spentUSD'], 0.4);
    // and a new judge job appearing later is picked up
    writeJob(storageDir, 'job-new', { access: 'judge', status: 'succeeded', totalCostUSD: 1.1 });
    assert.equal((await call(base, 'GET', '/api/access')).body['spentUSD'], 1.5);
  });
});

test('the cap comes from access.judgeCapUSD; remaining never goes below zero', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-big', { access: 'judge', status: 'succeeded', totalCostUSD: 12 });
  await withServer({ storageDir, access: gate({ judgeCapUSD: 10 }) }, async ({ base }) => {
    const r = await call(base, 'GET', '/api/access');
    assert.equal(r.body['capUSD'], 10);
    assert.equal(r.body['spentUSD'], 12);
    assert.equal(r.body['remainingUSD'], 0);
    assert.equal(r.body['buildsEnabled'], false);
  });
});

test('POST /api/jobs is 402 JUDGE_BUDGET_REACHED when remaining < the 1.00 headroom, 202 at exactly the headroom', async () => {
  const storageDir = tempStorage();
  writeJob(storageDir, 'job-spend', { access: 'judge', status: 'succeeded', totalCostUSD: 49.5 });
  await withServer({ storageDir, access: gate() }, async ({ base, calls }) => {
    const cookie = await signIn(base);
    const me = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(me.body['remainingUSD'], 0.5);
    assert.equal(me.body['buildsEnabled'], false);
    const r = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(r.status, 402);
    assert.deepEqual(r.body, { error: 'JUDGE_BUDGET_REACHED' });
    assert.equal(calls.length, 0);
    // pasted sources are free of the budget (they cost nothing)
    assert.equal((await call(base, 'POST', '/api/sources', { body: SOURCE_BODY, headers: { cookie } })).status, 201);
    // exactly the headroom left: allowed
    writeJob(storageDir, 'job-spend', { access: 'judge', status: 'succeeded', totalCostUSD: 49 });
    assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie } })).body['buildsEnabled'], true);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 202);
  });
});

test('running judge jobs count against the cap, so a burst cannot start more jobs than the budget has headroom for', async () => {
  await withServer({ access: gate({ judgeCapUSD: 2.5 }) }, async ({ base, calls, storageDir }) => {
    const cookie = await signIn(base);
    // the fake job runs forever; mirror what the worker writes at start
    const start = async (): Promise<number> => {
      const r = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
      if (r.status === 202) {
        writeJob(storageDir, String(r.body['jobId']), { access: 'judge', status: 'running' });
      }
      return r.status;
    };
    assert.equal(await start(), 202); // spent 1.0 (floor), remaining 1.5
    assert.equal(await start(), 202); // spent 2.0, remaining 0.5
    assert.equal(await start(), 402);
    assert.equal(calls.length, 2);
  });
});

test('the kill switch file makes POST /api/jobs 503 BUILDS_PAUSED and buildsEnabled false; removing it restores builds', async () => {
  const storageDir = tempStorage();
  await withServer({ storageDir, access: gate() }, async ({ base, calls }) => {
    const cookie = await signIn(base);
    const flag = join(storageDir, 'BUILDS_PAUSED');
    writeFileSync(flag, 'paused for maintenance\n');
    const me = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(me.body['buildsEnabled'], false);
    assert.equal(me.body['granted'], true);
    const r = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'BUILDS_PAUSED' });
    assert.equal(calls.length, 0);
    // checked on every gated POST: no restart needed either way
    rmSync(flag);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 202);
    // unauthenticated callers still get ACCESS_REQUIRED, not a hint about the switch
    writeFileSync(flag, '');
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY })).status, 403);
  });
});

test('the BUILDS_PAUSED=1 environment switch pauses builds at runtime (default reader, no restart)', async () => {
  const prior = process.env['BUILDS_PAUSED'];
  try {
    await withServer({ access: { code: CODE, sessionSecret: SECRET } }, async ({ base }) => {
      const cookie = await signIn(base);
      delete process.env['BUILDS_PAUSED'];
      assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 202);
      process.env['BUILDS_PAUSED'] = '1';
      assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 503);
      assert.equal((await call(base, 'GET', '/api/access', { headers: { cookie } })).body['buildsEnabled'], false);
      process.env['BUILDS_PAUSED'] = '0';
      assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 202);
    });
  } finally {
    if (prior === undefined) delete process.env['BUILDS_PAUSED'];
    else process.env['BUILDS_PAUSED'] = prior;
  }
});

test('live generation off: buildsEnabled is false and a session gets the existing 503 LIVE_DISABLED', async () => {
  await withServer({ live: false, access: gate() }, async ({ base }) => {
    const cookie = await signIn(base);
    const me = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(me.body['buildsEnabled'], false);
    const r = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'LIVE_DISABLED' });
  });
});

test('existing job errors keep their codes for a granted session (400/404/409 unchanged)', async () => {
  await withServer({ access: gate(), maxConcurrentJobs: 1 }, async ({ base }) => {
    const cookie = await signIn(base);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: {}, headers: { cookie } })).status, 400);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: { sourceId: 'no-such-page' }, headers: { cookie } })).status, 404);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: { sourceId: SOURCE_ID, model: 'x' }, headers: { cookie } })).body['error'], 'MODEL_INVALID');
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 202);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 409);
  });
});

/* ------------------------------------------------------------------ */
/* secrecy                                                              */
/* ------------------------------------------------------------------ */

test('the code, the secret and cookie values are never written to stdout or stderr', async () => {
  const seen: string[] = [];
  const realLog = console.log;
  const realErr = console.error;
  const realWarn = console.warn;
  const capture = (...a: unknown[]): void => {
    seen.push(a.map(String).join(' '));
  };
  console.log = capture;
  console.error = capture;
  console.warn = capture;
  let cookie = '';
  try {
    await withServer({ access: gate() }, async ({ base }) => {
      await call(base, 'POST', '/api/access', { body: { code: 'wrong-code-value' } });
      cookie = await signIn(base);
      await call(base, 'GET', '/api/access', { headers: { cookie } });
      await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
      await call(base, 'POST', '/api/access', { body: 'not json' });
      await call(base, 'DELETE', '/api/access', { headers: { cookie } });
    });
  } finally {
    console.log = realLog;
    console.error = realErr;
    console.warn = realWarn;
  }
  const out = seen.join('\n');
  for (const secret of [CODE, SECRET, 'wrong-code-value', cookie.slice(`${ACCESS_COOKIE_NAME}=`.length)]) {
    assert.ok(!out.includes(secret), 'nothing secret reached the console');
  }
});
