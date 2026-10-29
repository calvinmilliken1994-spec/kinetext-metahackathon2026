// OW-2 — API surface for per-job model choice: POST /api/jobs `model` validation,
// GET /api/models and the model availability booleans on GET /api/health.
// Fake startJob only; no network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import type { ModelChoice } from '../../packages/meta/pricing.ts';

const SOURCE_ID = 'nasa-grc-equations-of-motion';

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'ow2-models-'));
}

function fakeSummary(sourceId: string): JobSummary {
  return {
    jobId: 'job-x',
    sourceId,
    status: 'succeeded',
    purpose: 'test-live',
    createdAt: new Date().toISOString(),
    totalCostUSD: 0,
    reservedUnknownUSD: 0,
    engine: null,
    revisions: 0,
    repairs: [],
    sourceKind: 'library',
  };
}

interface StartedCall {
  sourceId: string;
  opts?: { demoFault?: string; model?: ModelChoice };
}

function recordingStart(): { start: NonNullable<ApiOptions['startJob']>; calls: StartedCall[] } {
  const calls: StartedCall[] = [];
  const start: NonNullable<ApiOptions['startJob']> = (sourceId, opts) => {
    calls.push({ sourceId, opts });
    return { jobId: 'job-x', done: Promise.resolve(fakeSummary(sourceId)) };
  };
  return { start, calls };
}

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

async function getJson(base: string, path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as unknown };
}

async function postJob(base: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

/* ------------------------------------------------------------------ */
/* POST /api/jobs model validation                                      */
/* ------------------------------------------------------------------ */

test('OW-2: POST /api/jobs without a model defaults to muse-spark-1.3', async () => {
  const { start, calls } = recordingStart();
  await withServer({ storageDir: tempStorage(), startJob: start }, async base => {
    const res = await postJob(base, { sourceId: SOURCE_ID });
    assert.equal(res.status, 202);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts?.model, 'muse-spark-1.3');
  });
});

test('OW-2: POST /api/jobs passes a valid model (and demoFault) through', async () => {
  const { start, calls } = recordingStart();
  await withServer({ storageDir: tempStorage(), startJob: start }, async base => {
    const open = await postJob(base, { sourceId: SOURCE_ID, model: 'muse-spark-open' });
    assert.equal(open.status, 202);
    assert.equal(calls[0].opts?.model, 'muse-spark-open');
    const hosted = await postJob(base, { sourceId: SOURCE_ID, model: 'muse-spark-1.3' });
    assert.equal(hosted.status, 202);
    assert.equal(calls[1].opts?.model, 'muse-spark-1.3');
    const faulty = await postJob(base, { sourceId: SOURCE_ID, model: 'muse-spark-open', demoFault: 'wrong-answer' });
    assert.equal(faulty.status, 202);
    assert.equal(calls[2].opts?.model, 'muse-spark-open');
    assert.equal(calls[2].opts?.demoFault, 'wrong-answer');
  });
});

test('OW-2: any other model value is a 400 with the fixed MODEL_INVALID message', async () => {
  const { start, calls } = recordingStart();
  await withServer({ storageDir: tempStorage(), startJob: start }, async base => {
    for (const bad of ['muse-spark-2.0', 'MUSE-SPARK-OPEN', 'muse-spark-open ', '', 'meta-models/Muse-Spark-Open-816B-A42B', 123, null, true, ['muse-spark-open'], {}]) {
      const res = await postJob(base, { sourceId: SOURCE_ID, model: bad });
      assert.equal(res.status, 400, `model=${JSON.stringify(bad)} must be rejected`);
      assert.deepEqual(res.body, { error: 'MODEL_INVALID' });
    }
    assert.equal(calls.length, 0, 'a rejected model never starts a job');
  });
});

/* ------------------------------------------------------------------ */
/* GET /api/health model availability                                   */
/* ------------------------------------------------------------------ */

test('OW-2: GET /api/health reports per-model availability booleans only', async () => {
  await withServer({ storageDir: tempStorage(), startJob: null }, async base => {
    const off = await getJson(base, '/api/health');
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, {
      ok: true,
      live: false,
      busy: false,
      running: 0,
      maxConcurrentJobs: 1,
      models: { 'muse-spark-1.3': false, 'muse-spark-open': false },
    });
  });
  const { start } = recordingStart();
  await withServer({ storageDir: tempStorage(), startJob: start }, async base => {
    // No explicit list: a live server has historically meant the Meta API model.
    const on = await getJson(base, '/api/health');
    assert.deepEqual(on.body, {
      ok: true,
      live: true,
      busy: false,
      running: 0,
      maxConcurrentJobs: 1,
      models: { 'muse-spark-1.3': true, 'muse-spark-open': false },
    });
  });
  await withServer(
    { storageDir: tempStorage(), startJob: start, availableModels: ['muse-spark-open'] },
    async base => {
      const onlyOpen = await getJson(base, '/api/health');
      assert.deepEqual(onlyOpen.body, {
        ok: true,
        live: true,
        busy: false,
        running: 0,
        maxConcurrentJobs: 1,
        models: { 'muse-spark-1.3': false, 'muse-spark-open': true },
      });
    },
  );
  // The function form is re-evaluated per request (env presence may change).
  let flip = false;
  await withServer(
    { storageDir: tempStorage(), startJob: start, availableModels: () => (flip ? ['muse-spark-1.3', 'muse-spark-open'] : ['muse-spark-1.3']) },
    async base => {
      const before = await getJson(base, '/api/health');
      assert.deepEqual((before.body as { models: unknown }).models, { 'muse-spark-1.3': true, 'muse-spark-open': false });
      flip = true;
      const after = await getJson(base, '/api/health');
      assert.deepEqual((after.body as { models: unknown }).models, { 'muse-spark-1.3': true, 'muse-spark-open': true });
    },
  );
});

/* ------------------------------------------------------------------ */
/* GET /api/models                                                      */
/* ------------------------------------------------------------------ */

test('OW-2: GET /api/models lists the picker entries with labels, providers and availability', async () => {
  const { start } = recordingStart();
  await withServer(
    { storageDir: tempStorage(), startJob: start, availableModels: ['muse-spark-1.3', 'muse-spark-open'] },
    async base => {
      const res = await getJson(base, '/api/models');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, [
        { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 — Meta API', provider: 'meta-api', available: true },
        {
          id: 'muse-spark-open',
          label: 'Muse Spark Open — open weights, hosted on Modal',
          provider: 'modal',
          available: true,
        },
      ]);
    },
  );
  await withServer({ storageDir: tempStorage(), startJob: null }, async base => {
    const res = await getJson(base, '/api/models');
    assert.equal(res.status, 200);
    const body = res.body as { available: boolean }[];
    assert.deepEqual(body.map(m => m.available), [false, false]);
    const post = await fetch(`${base}/api/models`, { method: 'POST' });
    assert.equal(post.status, 405);
  });
});
