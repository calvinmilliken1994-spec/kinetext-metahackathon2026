// Stage 11 slice L — relay mode in the API server (docs/specs/STAGE-11-judge-relay.md, "Local relay mode").
// Ephemeral servers on 127.0.0.1:0, a FAKE relay (injected fetch), a FAKE startJob, a temp storage dir.
// No network beyond localhost, no credits, no .env access. The access code is an inert marker, so a
// leak into any response, header, storage file or console line is detectable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { createRelayControl } from './relay.ts';
import type { RelayControl, RelayStatus } from './relay.ts';
import { ACCESS_ATTEMPTS_PER_WINDOW } from './access.ts';

const RELAY_URL = 'https://mki-relay.example.modal.run';
const CODE = 'relay-code-MARKER-for-tests-7Q2xZ9';
const SOURCE_ID = 'bls-cpi-escalation'; // a real library page (read-only)

const STATUS: RelayStatus = { enabled: true, capUSD: 50, spentUSD: 2.5, remainingUSD: 47.5 };

interface FakeRelay {
  fetchImpl: typeof fetch;
  calls: number;
  status: RelayStatus;
  down: boolean;
  http: number | null; // force a status code (e.g. 429)
}

function fakeRelay(): FakeRelay {
  const relay: FakeRelay = {
    calls: 0,
    status: STATUS,
    down: false,
    http: null,
    fetchImpl: (async (_input: unknown, init?: RequestInit): Promise<Response> => {
      relay.calls += 1;
      if (relay.down) {
        throw new TypeError('fetch failed');
      }
      if (relay.http !== null) {
        return new Response('{}', { status: relay.http });
      }
      const auth = new Headers(init?.headers).get('authorization');
      if (auth !== `Bearer ${CODE}`) {
        return new Response(JSON.stringify({ error: { code: 'RELAY_CODE_INVALID' } }), { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true, ...relay.status }), { status: 200 });
    }) as typeof fetch,
  };
  return relay;
}

type StartOpts = Parameters<NonNullable<ApiOptions['startJob']>>[1];
interface StartCall {
  sourceId: string;
  opts: StartOpts;
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
  relay: FakeRelay;
  control: RelayControl;
  setClock: (ms: number) => void;
}

async function withRelayServer(
  over: Partial<ApiOptions> & { sessionSecret?: string; fake?: FakeRelay },
  run: (h: Harness) => Promise<void>,
): Promise<void> {
  const storageDir = mkdtempSync(join(tmpdir(), 'stage11-relay-'));
  const calls: StartCall[] = [];
  const relay = over.fake ?? fakeRelay();
  let clock = 1_000_000;
  const control = createRelayControl({ url: RELAY_URL, fetchImpl: relay.fetchImpl, now: () => clock });
  const { sessionSecret, fake: _f, ...rest } = over;
  const server: Server = createApiServer({
    storageDir,
    startJob: fakeStart(calls),
    maxConcurrentJobs: 8,
    relay: control,
    access: { buildsPaused: () => false, ...(sessionSecret !== undefined ? { sessionSecret } : {}) },
    ...rest,
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await run({ base, storageDir, calls, relay, control, setClock: ms => { clock = ms; } });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  raw: string;
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
  const raw = await res.text();
  return {
    status: res.status,
    body: (raw === '' ? {} : JSON.parse(raw)) as Record<string, unknown>,
    raw,
    headers: res.headers,
    setCookie: res.headers.getSetCookie(),
  };
}

function cookieHeader(reply: Reply): string {
  const first = reply.setCookie[0];
  assert.ok(first !== undefined, 'a Set-Cookie header was sent');
  return first.split(';')[0] as string;
}

async function signIn(base: string): Promise<string> {
  const reply = await call(base, 'POST', '/api/access', { body: { code: CODE } });
  assert.equal(reply.status, 200);
  return cookieHeader(reply);
}

const JOB_BODY = { sourceId: SOURCE_ID };

/* ------------------------------------------------------------------ */
/* before any code                                                      */
/* ------------------------------------------------------------------ */

test('L: relay mode starts locked and read-only: gate on, not granted, live false, no model available', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    const access = await call(base, 'GET', '/api/access');
    assert.equal(access.status, 200);
    assert.deepEqual(Object.keys(access.body).sort(), ['buildsEnabled', 'capUSD', 'gate', 'granted', 'remainingUSD', 'spentUSD']);
    assert.equal(access.body['gate'], true);
    assert.equal(access.body['granted'], false);
    assert.equal(access.body['buildsEnabled'], false, 'no code yet: nothing can be built');
    const health = await call(base, 'GET', '/api/health');
    assert.equal(health.body['live'], false);
    assert.deepEqual(health.body['models'], { 'muse-spark-1.3': false, 'muse-spark-open': false });
    const models = await call(base, 'GET', '/api/models');
    assert.deepEqual((models.body as unknown as Array<{ available: boolean }>).map(m => m.available), [false, false]);
    assert.equal(relay.calls, 0, 'GET routes never call the relay without a code');
  });
});

test('L: without a code, builds and source writes return the existing locked error; recorded GETs work', async () => {
  await withRelayServer({}, async ({ base, calls }) => {
    const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY });
    assert.equal(job.status, 403);
    assert.deepEqual(job.body, { error: 'ACCESS_REQUIRED' });
    const src = await call(base, 'POST', '/api/sources', { body: { title: 't', text: 'x' } });
    assert.equal(src.status, 403);
    assert.equal(calls.length, 0);
    assert.equal((await call(base, 'GET', '/api/jobs')).status, 200);
    assert.equal((await call(base, 'GET', '/api/sources')).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* POST /api/access against the relay                                    */
/* ------------------------------------------------------------------ */

test('L: a code the relay accepts starts the existing signed session and reports the relay budget', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    const reply = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(reply.status, 200);
    assert.equal(relay.calls, 1);
    assert.equal(reply.body['gate'], true);
    assert.equal(reply.body['granted'], true);
    assert.equal(reply.body['capUSD'], 50);
    assert.equal(reply.body['spentUSD'], 2.5);
    assert.equal(reply.body['remainingUSD'], 47.5);
    assert.equal(reply.body['buildsEnabled'], true);
    assert.deepEqual(Object.keys(reply.body).sort(), ['buildsEnabled', 'capUSD', 'gate', 'granted', 'remainingUSD', 'spentUSD']);
    const cookie = reply.setCookie[0] ?? '';
    assert.match(cookie, /^mki_access=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=604800/);
    const again = await call(base, 'GET', '/api/access', { headers: { cookie: cookieHeader(reply) } });
    assert.equal(again.body['granted'], true);
    assert.equal(again.body['remainingUSD'], 47.5);
  });
});

test('L: a wrong code is the same error as today (401 ACCESS_CODE_INVALID) and sets no cookie', async () => {
  await withRelayServer({}, async ({ base, control }) => {
    const reply = await call(base, 'POST', '/api/access', { body: { code: 'wrong-code-wrong-code-0000' } });
    assert.equal(reply.status, 401);
    assert.deepEqual(reply.body, { error: 'ACCESS_CODE_INVALID' });
    assert.deepEqual(reply.setCookie, []);
    assert.equal(control.hasCode(), false);
  });
});

test('L: a code that cannot be a header value is rejected as invalid without calling the relay', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    for (const code of ['', 'has space in it', 'caf\u00e9-code-with-accent-xxxx', 'x'.repeat(400)]) {
      const reply = await call(base, 'POST', '/api/access', { body: { code } });
      assert.equal(reply.status, 401, JSON.stringify(code.slice(0, 20)));
      assert.deepEqual(reply.body, { error: 'ACCESS_CODE_INVALID' });
    }
    assert.equal(relay.calls, 0);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: 7 } })).status, 400);
    assert.equal((await call(base, 'POST', '/api/access', { body: 'not json' })).status, 400);
  });
});

test('L: an unreachable relay is 502 RELAY_UNREACHABLE and grants nothing', async () => {
  await withRelayServer({}, async ({ base, relay, control }) => {
    relay.down = true;
    const reply = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(reply.status, 502);
    assert.deepEqual(reply.body, { error: 'RELAY_UNREACHABLE' });
    assert.deepEqual(reply.setCookie, []);
    assert.equal(control.hasCode(), false);
    relay.down = false;
    relay.http = 500;
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE } })).status, 502);
  });
});

test('L: the relay rate-limiting a code check is the existing 429 TOO_MANY_ATTEMPTS', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    relay.http = 429;
    const reply = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(reply.status, 429);
    assert.deepEqual(reply.body, { error: 'TOO_MANY_ATTEMPTS' });
    assert.ok(reply.headers.get('retry-after') !== null);
  });
});

test('L: the local attempt limit still applies in relay mode (5 per minute per client)', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    for (let i = 0; i < ACCESS_ATTEMPTS_PER_WINDOW; i += 1) {
      assert.equal((await call(base, 'POST', '/api/access', { body: { code: 'wrong-code-wrong-code-0000' } })).status, 401);
    }
    const blocked = await call(base, 'POST', '/api/access', { body: { code: CODE } });
    assert.equal(blocked.status, 429);
    assert.equal(relay.calls, ACCESS_ATTEMPTS_PER_WINDOW, 'the blocked attempt never reached the relay');
  });
});

test('L: the Origin check protects POST /api/access in relay mode', async () => {
  await withRelayServer({}, async ({ base, relay }) => {
    const reply = await call(base, 'POST', '/api/access', { body: { code: CODE }, headers: { origin: 'http://evil.example' } });
    assert.equal(reply.status, 403);
    assert.equal(relay.calls, 0);
  });
});

/* ------------------------------------------------------------------ */
/* after a code                                                         */
/* ------------------------------------------------------------------ */

test('L: once granted, health says live and both models are available', async () => {
  await withRelayServer({}, async ({ base }) => {
    await signIn(base);
    const health = await call(base, 'GET', '/api/health');
    assert.equal(health.body['live'], true);
    assert.deepEqual(health.body['models'], { 'muse-spark-1.3': true, 'muse-spark-open': true });
    assert.equal(health.body['remainingUSD'], 47.5);
    const models = await call(base, 'GET', '/api/models');
    assert.deepEqual((models.body as unknown as Array<{ id: string; available: boolean }>).map(m => [m.id, m.available]), [
      ['muse-spark-1.3', true],
      ['muse-spark-open', true],
    ]);
  });
});

test('L: a granted session starts jobs tagged judge, for either model', async () => {
  await withRelayServer({}, async ({ base, calls }) => {
    const cookie = await signIn(base);
    for (const model of ['muse-spark-1.3', 'muse-spark-open']) {
      const res = await call(base, 'POST', '/api/jobs', { body: { ...JOB_BODY, model }, headers: { cookie } });
      assert.equal(res.status, 202, model);
    }
    assert.deepEqual(calls.map(c => [c.opts?.model, c.opts?.access]), [
      ['muse-spark-1.3', 'judge'],
      ['muse-spark-open', 'judge'],
    ]);
    // a client without the cookie is still locked out
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY })).status, 403);
  });
});

test('L: access and health report the relay budget cached for at most 10 seconds', async () => {
  await withRelayServer({}, async ({ base, relay, setClock }) => {
    const cookie = await signIn(base);
    assert.equal(relay.calls, 1);
    await call(base, 'GET', '/api/access', { headers: { cookie } });
    await call(base, 'GET', '/api/health');
    assert.equal(relay.calls, 1, 'within 10 s every read comes from the cache');
    relay.status = { enabled: true, capUSD: 50, spentUSD: 20, remainingUSD: 30 };
    setClock(1_000_000 + 10_001);
    const refreshed = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(relay.calls, 2);
    assert.equal(refreshed.body['remainingUSD'], 30);
    assert.equal(refreshed.body['spentUSD'], 20);
    assert.equal((await call(base, 'GET', '/api/health')).body['remainingUSD'], 30);
    assert.equal(relay.calls, 2);
  });
});

test('L: a relay outage after sign-in keeps the session and the last known budget', async () => {
  await withRelayServer({}, async ({ base, relay, setClock }) => {
    const cookie = await signIn(base);
    relay.down = true;
    setClock(1_000_000 + 60_000);
    const access = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(access.status, 200);
    assert.equal(access.body['granted'], true);
    assert.equal(access.body['remainingUSD'], 47.5);
  });
});

test('L: the relay kill switch (enabled false) is 503 BUILDS_PAUSED and buildsEnabled false', async () => {
  await withRelayServer({}, async ({ base, relay, setClock, calls }) => {
    const cookie = await signIn(base);
    relay.status = { ...STATUS, enabled: false };
    setClock(1_000_000 + 11_000);
    const access = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(access.body['buildsEnabled'], false);
    const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(job.status, 503);
    assert.deepEqual(job.body, { error: 'BUILDS_PAUSED' });
    assert.equal(calls.length, 0);
  });
});

test('L: the local BUILDS_PAUSED file still pauses builds in relay mode', async () => {
  await withRelayServer({}, async ({ base, storageDir, calls }) => {
    const cookie = await signIn(base);
    writeFileSync(join(storageDir, 'BUILDS_PAUSED'), '');
    const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(job.status, 503);
    assert.equal(calls.length, 0);
  });
});

test('L: a spent relay budget is 402 JUDGE_BUDGET_REACHED', async () => {
  await withRelayServer({}, async ({ base, relay, setClock, calls }) => {
    const cookie = await signIn(base);
    relay.status = { enabled: true, capUSD: 50, spentUSD: 49.5, remainingUSD: 0.5 };
    setClock(1_000_000 + 11_000);
    const access = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(access.body['remainingUSD'], 0.5);
    assert.equal(access.body['buildsEnabled'], false);
    const job = await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } });
    assert.equal(job.status, 402);
    assert.deepEqual(job.body, { error: 'JUDGE_BUDGET_REACHED' });
    assert.equal(calls.length, 0);
  });
});

test('L: when the relay stops accepting the code the session is no longer granted', async () => {
  await withRelayServer({}, async ({ base, relay, setClock, control }) => {
    const cookie = await signIn(base);
    relay.http = 401; // code rotated
    setClock(1_000_000 + 11_000);
    const access = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(access.body['granted'], false);
    assert.equal(control.hasCode(), false);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 403);
    assert.equal((await call(base, 'GET', '/api/health')).body['live'], false);
  });
});

test('L: sign-out ends the session and forgets the code in memory', async () => {
  await withRelayServer({}, async ({ base, control, calls }) => {
    const cookie = await signIn(base);
    assert.equal(control.hasCode(), true);
    const out = await call(base, 'DELETE', '/api/access', { headers: { cookie } });
    assert.equal(out.status, 200);
    assert.equal(out.body['granted'], false);
    assert.equal(control.hasCode(), false);
    assert.equal((await call(base, 'GET', '/api/health')).body['live'], false);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 403);
    assert.equal(calls.length, 0);
  });
});

test('L: a session cookie alone is not enough after a restart: the code lives in memory only', async () => {
  const relay = fakeRelay();
  let cookie = '';
  await withRelayServer({ fake: relay, sessionSecret: 'fixed-session-secret-for-tests' }, async ({ base }) => {
    cookie = await signIn(base);
  });
  // a new process: same cookie key material, but no code in memory
  await withRelayServer({ fake: relay, sessionSecret: 'fixed-session-secret-for-tests' }, async ({ base, calls }) => {
    const access = await call(base, 'GET', '/api/access', { headers: { cookie } });
    assert.equal(access.body['granted'], false);
    assert.equal((await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } })).status, 403);
    assert.equal(calls.length, 0);
  });
});

test('L: ACCESS_CODE in the environment does not replace the relay as the judge of the code', async () => {
  await withRelayServer({ access: { code: 'local-code-should-be-ignored-123', buildsPaused: () => false } }, async ({ base }) => {
    const local = await call(base, 'POST', '/api/access', { body: { code: 'local-code-should-be-ignored-123' } });
    assert.equal(local.status, 401);
    assert.equal((await call(base, 'POST', '/api/access', { body: { code: CODE } })).status, 200);
  });
});

/* ------------------------------------------------------------------ */
/* the code never leaves memory                                          */
/* ------------------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

test('L: the access code never appears in a response, a header, a storage file or console output', async () => {
  const lines: string[] = [];
  const saved = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  for (const key of Object.keys(saved) as Array<keyof typeof saved>) {
    console[key] = (...args: unknown[]): void => {
      lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    };
  }
  const seen: string[] = [];
  try {
    await withRelayServer({}, async ({ base, relay, storageDir, setClock }) => {
      const remember = (r: Reply): Reply => {
        seen.push(r.raw, JSON.stringify([...r.headers.entries()]), r.setCookie.join('\n'));
        return r;
      };
      remember(await call(base, 'POST', '/api/access', { body: { code: 'wrong-code-wrong-code-0000' } }));
      relay.down = true;
      remember(await call(base, 'POST', '/api/access', { body: { code: CODE } }));
      relay.down = false;
      const ok = remember(await call(base, 'POST', '/api/access', { body: { code: CODE } }));
      const cookie = cookieHeader(ok);
      // The code is signed-in state: look at every route a browser would read.
      for (const path of ['/api/access', '/api/health', '/api/models', '/api/jobs', '/api/sources']) {
        remember(await call(base, 'GET', path, { headers: { cookie } }));
      }
      relay.status = { ...STATUS, enabled: false };
      setClock(1_000_000 + 11_000);
      remember(await call(base, 'GET', '/api/access', { headers: { cookie } }));
      remember(await call(base, 'POST', '/api/jobs', { body: JOB_BODY, headers: { cookie } }));
      remember(await call(base, 'POST', '/api/jobs', { body: 'garbage', headers: { cookie } }));
      remember(await call(base, 'DELETE', '/api/access', { headers: { cookie } }));
      if (existsSync(storageDir)) {
        for (const file of walk(storageDir)) {
          seen.push(readFileSync(file, 'utf8'));
        }
      }
    });
  } finally {
    Object.assign(console, saved);
  }
  assert.ok(seen.length > 10, 'the probe looked at real output');
  for (const text of seen) {
    assert.equal(text.includes(CODE), false, 'the code is in a response, header or stored file');
  }
  assert.equal(lines.join('\n').includes(CODE), false, 'the code reached the console');
});
