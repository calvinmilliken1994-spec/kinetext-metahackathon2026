// OW-2 — per-job model choice: Modal proxy-token handling and per-job client selection.
// FAKE ledger + FAKE fetch only; no network, no credits, no .env access. Token values here
// are inert markers chosen so any leak into a response/event/job file/log is detectable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import {
  buildModalClient,
  missingModalTokenClient,
  modalTokenAvailable,
  MODEL_INFO,
  PROVIDER_FOR_MODEL,
  splitModalProxyToken,
} from './model-clients.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import { MetaError, MODAL_MUSE_SPARK_OPEN_MODEL } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';

const MARKER_KEY = ['wk-', 'MARKER', 'KEY', '31337'].join('');
const MARKER_SECRET = ['ws-', 'MARKER', 'SECRET', '9271'].join('');
const MODAL_BASE = 'https://example-endpoint.us-west.modal.direct/v1';
const SOURCE_ID = 'nasa-grc-equations-of-motion';

function fakeLedger(): Ledger & { reserves: number; reconciles: number } {
  const state = {
    reserves: 0,
    reconciles: 0,
    capUSD: 50,
    reserve: (): string => {
      state.reserves += 1;
      return `res-${state.reserves}`;
    },
    reconcile: (): void => {
      state.reconciles += 1;
    },
    committedUSD: (): number => 0,
    close: (): void => {},
  };
  return state;
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'ow2-modal-'));
}

/* ------------------------------------------------------------------ */
/* splitModalProxyToken                                                 */
/* ------------------------------------------------------------------ */

test('OW-2: splitModalProxyToken splits at the ws- boundary and strips separators', () => {
  assert.deepEqual(splitModalProxyToken(`${MARKER_KEY}${MARKER_SECRET}`), {
    proxyKey: MARKER_KEY,
    proxySecret: MARKER_SECRET,
  });
  for (const sep of [':', '|', ';', ',', ' ', '\t', '\n']) {
    assert.deepEqual(
      splitModalProxyToken(`${MARKER_KEY}${sep}${MARKER_SECRET}`),
      { proxyKey: MARKER_KEY, proxySecret: MARKER_SECRET },
      `separator ${JSON.stringify(sep)} is stripped`,
    );
  }
  // Surrounding whitespace (e.g. a trailing newline from the launcher) is ignored.
  assert.deepEqual(splitModalProxyToken(`  ${MARKER_KEY}:${MARKER_SECRET}\n`), {
    proxyKey: MARKER_KEY,
    proxySecret: MARKER_SECRET,
  });
});

test('OW-2: splitModalProxyToken fails closed (null) on missing/malformed tokens', () => {
  for (const bad of [
    undefined,
    '',
    '   ',
    MARKER_KEY, // no secret part
    MARKER_SECRET, // no key part
    `:${MARKER_SECRET}`, // nothing before the boundary
    'wk-:ws-', // empty secret payload
    `LLM_something${MARKER_SECRET.replace('ws-', 'xs-')}`, // no ws- boundary at all
  ]) {
    assert.equal(splitModalProxyToken(bad), null, `${JSON.stringify(bad)} must not split`);
  }
  // A key part that is not a wk- token fails closed even when ws- exists.
  assert.equal(splitModalProxyToken('FOO' + MARKER_KEY.slice(3) + ':' + MARKER_SECRET), null);
});

test('OW-2: modalTokenAvailable reports a boolean only, never the value', () => {
  assert.equal(modalTokenAvailable({ MODAL_PROXY_TOKEN: `${MARKER_KEY}:${MARKER_SECRET}` }), true);
  assert.equal(modalTokenAvailable({ MODAL_PROXY_TOKEN: '' }), false);
  assert.equal(modalTokenAvailable({}), false);
  assert.equal(modalTokenAvailable({ MODAL_PROXY_TOKEN: 'wk-no-secret' }), false);
});

/* ------------------------------------------------------------------ */
/* buildModalClient: per-job client selection                           */
/* ------------------------------------------------------------------ */

test('OW-2: buildModalClient returns a modal-provider client when the token is present', () => {
  const ledger = fakeLedger();
  let fetched = 0;
  const client = buildModalClient({
    ledger,
    maxInputTokens: 32000,
    modalBaseUrl: MODAL_BASE,
    env: { MODAL_PROXY_TOKEN: `${MARKER_KEY}:${MARKER_SECRET}` },
    fetchImpl: (async () => {
      fetched += 1;
      throw new Error('no live calls in tests');
    }) as unknown as typeof fetch,
  });
  assert.equal(client.provider, 'modal');
  assert.equal(client.model, 'muse-spark-open');
  assert.equal(client.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  assert.equal(fetched, 0, 'constructing the client makes no request');
  assert.equal(ledger.reserves, 0);
});

test('OW-2: a missing token yields a client that fails MODAL_PROXY_TOKEN_MISSING before any reservation', async () => {
  for (const env of [{}, { MODAL_PROXY_TOKEN: '' }, { MODAL_PROXY_TOKEN: 'wk-broken-no-secret' }]) {
    const ledger = fakeLedger();
    const client = buildModalClient({ ledger, maxInputTokens: 32000, modalBaseUrl: MODAL_BASE, env });
    assert.equal(client.provider, 'modal');
    assert.equal(client.model, 'muse-spark-open');
    await assert.rejects(
      () =>
        client.complete({
          purpose: 'test-live',
          schemaName: 'source_analysis',
          jsonSchema: {},
          messages: [{ role: 'user', content: 'x' }],
          maxOutputTokens: 100,
        }),
      (err: unknown) => err instanceof MetaError && err.code === 'MODAL_PROXY_TOKEN_MISSING',
    );
    assert.equal(ledger.reserves, 0, 'no reservation is made when the token is missing');
    assert.equal(ledger.reconciles, 0);
  }
  // The same holds for the standalone failing client.
  const failing = missingModalTokenClient();
  assert.equal(failing.provider, 'modal');
  assert.equal(failing.model, 'muse-spark-open');
  assert.equal(failing.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
});

/* ------------------------------------------------------------------ */
/* Marker test: the token never appears in responses/events/job files/logs */
/* ------------------------------------------------------------------ */

async function withServer(
  opts: ApiOptions,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const server: Server = createApiServer(opts);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

async function waitForSettled(base: string, jobId: string): Promise<Record<string, unknown>> {
  for (let i = 0; i < 200; i++) {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    const body = (await res.json()) as Record<string, unknown>;
    const summary = body['summary'] as { status?: string } | undefined;
    if (summary !== undefined && summary.status !== undefined && summary.status !== 'running') {
      return body;
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('job did not settle');
}

function runDirTexts(storageDir: string, jobId: string): string[] {
  const dir = join(storageDir, 'runs', jobId);
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    out.push(readFileSync(join(dir, name), 'utf8'));
  }
  return out;
}

interface CapturedLogs {
  texts: string[];
  restore: () => void;
}

function captureConsole(): CapturedLogs {
  const texts: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args: unknown[]): void => {
    texts.push(args.map(String).join(' '));
  };
  console.error = (...args: unknown[]): void => {
    texts.push(args.map(String).join(' '));
  };
  return {
    texts,
    restore: () => {
      console.log = origLog;
      console.error = origError;
    },
  };
}

function assertNoTokenText(haystacks: readonly string[], label: string): void {
  for (const marker of [MARKER_KEY, MARKER_SECRET, 'MARKERKEY31337', 'MARKERSECRET9271']) {
    for (const hay of haystacks) {
      assert.ok(!hay.includes(marker), `${label}: token marker ${marker.slice(0, 6)}… must never appear`);
    }
  }
}

test('OW-2 marker test: the proxy token is used on the transport only — never in responses, events, job files or logs', async () => {
  const storageDir = tempStorage();
  const ledger = fakeLedger();
  const seenRequests: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    seenRequests.push({ url: String(url), headers, body: String(init?.body ?? '') });
    // 401 ends the job quickly via the fixed AUTH_FAILED path (no retry on 401).
    return new Response(JSON.stringify({ error: { type: 'authentication_error' } }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;

  const logs = captureConsole();
  const responseTexts: string[] = [];
  try {
    const startJob: NonNullable<ApiOptions['startJob']> = (sourceId, jobOpts) => {
      const client = buildModalClient({
        ledger,
        maxInputTokens: 32000,
        modalBaseUrl: MODAL_BASE,
        env: { MODAL_PROXY_TOKEN: `${MARKER_KEY}:${MARKER_SECRET}` },
        fetchImpl: fakeFetch,
      });
      assert.equal(jobOpts?.model, 'muse-spark-open');
      return realStartJob(sourceId, {
        client,
        storageDir,
        purpose: 'test-live',
        limits: { maxJobWallTimeMs: 60000, analysisMaxOutputTokens: 16000, specMaxOutputTokens: 32000, maxRepairAttempts: 0 },
      });
    };
    await withServer({ storageDir, startJob }, async base => {
      const post = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: SOURCE_ID, model: 'muse-spark-open' }),
      });
      responseTexts.push(await post.text());
      assert.equal(post.status, 202);
      const jobId = String((JSON.parse(responseTexts[0]) as { jobId: string }).jobId);
      const view = await waitForSettled(base, jobId);
      responseTexts.push(JSON.stringify(view));
      const summary = view['summary'] as JobSummary & { error?: { code: string; message: string } };
      assert.equal(summary.status, 'failed', 'the fake 401 fails the job through the fixed error path');
      assert.equal(summary.error?.code, 'AUTH_FAILED');
      assert.equal(summary.model, 'muse-spark-open');
      assert.equal(summary.provider, 'modal');
      assert.equal(summary.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
      const listRes = await fetch(`${base}/api/jobs`);
      responseTexts.push(await listRes.text());

      // The secret reached the transport ONLY, split correctly, with no Authorization header.
      assert.equal(seenRequests.length, 1);
      assert.equal(seenRequests[0].url, `${MODAL_BASE}/chat/completions`);
      assert.equal(seenRequests[0].headers['modal-key'], MARKER_KEY);
      assert.equal(seenRequests[0].headers['modal-secret'], MARKER_SECRET);
      assert.equal(seenRequests[0].headers['authorization'], undefined);

      // No token text in any job artifact, HTTP response or captured log.
      assertNoTokenText(runDirTexts(storageDir, jobId), 'run dir artifacts');
      assertNoTokenText(responseTexts, 'HTTP responses');
      assertNoTokenText(seenRequests.map(r => r.body), 'request bodies');
    });
    assertNoTokenText(logs.texts, 'console output');
  } finally {
    logs.restore();
  }
});

test('OW-2 marker test: a missing token fails the job MODAL_PROXY_TOKEN_MISSING with no reservation and no token text anywhere', async () => {
  const storageDir = tempStorage();
  const ledger = fakeLedger();
  let fetched = 0;
  const logs = captureConsole();
  const responseTexts: string[] = [];
  try {
    const startJob: NonNullable<ApiOptions['startJob']> = (sourceId, jobOpts) => {
      const client = buildModalClient({
        ledger,
        maxInputTokens: 32000,
        modalBaseUrl: MODAL_BASE,
        env: {}, // no MODAL_PROXY_TOKEN
        fetchImpl: (async () => {
          fetched += 1;
          throw new Error('no live calls in tests');
        }) as unknown as typeof fetch,
      });
      assert.equal(jobOpts?.model, 'muse-spark-open');
      return realStartJob(sourceId, {
        client,
        storageDir,
        purpose: 'test-live',
        limits: { maxJobWallTimeMs: 60000, analysisMaxOutputTokens: 16000, specMaxOutputTokens: 32000, maxRepairAttempts: 0 },
      });
    };
    await withServer({ storageDir, startJob }, async base => {
      const post = await fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: SOURCE_ID, model: 'muse-spark-open' }),
      });
      responseTexts.push(await post.text());
      assert.equal(post.status, 202);
      const jobId = String((JSON.parse(responseTexts[0]) as { jobId: string }).jobId);
      const view = await waitForSettled(base, jobId);
      responseTexts.push(JSON.stringify(view));
      const summary = view['summary'] as JobSummary & { error?: { code: string; message: string } };
      assert.equal(summary.status, 'failed');
      assert.equal(summary.error?.code, 'MODAL_PROXY_TOKEN_MISSING');
      assert.equal(summary.error?.message, 'modal proxy token missing');
      assert.equal(summary.totalCostUSD, 0);
      assert.equal(summary.model, 'muse-spark-open');
      assert.equal(summary.provider, 'modal');
      assert.equal(fetched, 0, 'no transport call is attempted');
      assert.equal(ledger.reserves, 0, 'the job fails BEFORE any reservation');
      assertNoTokenText(runDirTexts(storageDir, jobId), 'run dir artifacts');
      assertNoTokenText(responseTexts, 'HTTP responses');
    });
    assertNoTokenText(logs.texts, 'console output');
  } finally {
    logs.restore();
  }
});

/* ------------------------------------------------------------------ */
/* Catalog constants                                                    */
/* ------------------------------------------------------------------ */

test('OW-2: the model catalog carries the frozen labels and provider mapping', () => {
  assert.deepEqual(
    MODEL_INFO.map(m => ({ id: m.id, label: m.label, provider: m.provider })),
    [
      { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 — Meta API', provider: 'meta-api' },
      { id: 'muse-spark-open', label: 'Muse Spark Open — open weights, hosted on Modal', provider: 'modal' },
    ],
  );
  assert.deepEqual(PROVIDER_FOR_MODEL, { 'muse-spark-1.3': 'meta-api', 'muse-spark-open': 'modal' });
});
