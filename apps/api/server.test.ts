// TASK-005 API tests — ephemeral server on 127.0.0.1:0, real repo sources (read-only),
// a FAKE MetaClient for the worker-backed routes and a fake startJob for the POST gate.
// No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;
const unsupportedFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-unsupported-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

function fakeClient(analysis: unknown = analysisFixture, gen: unknown = genFixture): MetaClient {
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysis as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      return { data: gen as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task005-api-'));
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

async function getJson(base: string, path: string): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as unknown, headers: res.headers };
}

function assertSecurityHeaders(headers: Headers): void {
  assert.equal(headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(headers.get('x-content-type-options'), 'nosniff');
  assert.equal(headers.get('cache-control'), 'no-store');
}

const noStart: ApiOptions['startJob'] = null;

test('GET /api/health reports ok and the live flag', async () => {
  await withServer({ storageDir: tempStorage(), startJob: noStart }, async base => {
    const off = await getJson(base, '/api/health');
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { ok: true, live: false });
    assertSecurityHeaders(off.headers);
  });
  const fakeStart = (sourceId: string) => ({
    jobId: 'job-x',
    done: Promise.resolve({
      jobId: 'job-x',
      sourceId,
      status: 'succeeded' as const,
      purpose: 'test-live' as const,
      createdAt: new Date().toISOString(),
      totalCostUSD: 0,
    }),
  });
  await withServer({ storageDir: tempStorage(), startJob: fakeStart }, async base => {
    const on = await getJson(base, '/api/health');
    assert.equal(on.status, 200);
    assert.deepEqual(on.body, { ok: true, live: true });
  });
});

test('GET /api/sources lists metadata without text; detail route adds hash-checked text', async () => {
  await withServer({ storageDir: tempStorage(), startJob: noStart }, async base => {
    const list = await getJson(base, '/api/sources');
    assert.equal(list.status, 200);
    const sources = list.body as Record<string, unknown>[];
    assert.ok(Array.isArray(sources));
    const ids = sources.map(s => s['id']);
    assert.ok(ids.includes('nasa-grc-equations-of-motion'));
    assert.ok(ids.includes('nasa-grc-speed-of-sound'));
    for (const s of sources) {
      for (const field of ['id', 'title', 'locator', 'license', 'attribution', 'sha256', 'purpose']) {
        assert.equal(typeof s[field], 'string', `${field} present`);
      }
      assert.ok(!('text' in s), 'list never exposes source text');
    }

    const detail = await getJson(base, '/api/sources/nasa-grc-equations-of-motion');
    assert.equal(detail.status, 200);
    const doc = detail.body as Record<string, unknown>;
    assert.equal(doc['id'], 'nasa-grc-equations-of-motion');
    assert.equal(typeof doc['text'], 'string');
    assert.ok((doc['text'] as string).length > 0);
    assert.equal(doc['sha256'], '1f43ca9d8a7097f7898a56c0eef367132de6ac7e5fe28605b5504b696324dbf0');
    assert.equal(typeof doc['purpose'], 'string');

    const missing = await getJson(base, '/api/sources/no-such-source');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'NOT_FOUND' });
    const invalid = await getJson(base, '/api/sources/BAD');
    assert.equal(invalid.status, 404);
    assert.deepEqual(invalid.body, { error: 'NOT_FOUND' });
  });
});

test('POST /api/jobs answers 503 LIVE_DISABLED when generation is off', async () => {
  await withServer({ storageDir: tempStorage(), startJob: noStart }, async base => {
    const res = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: 'nasa-grc-equations-of-motion' }),
    });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'LIVE_DISABLED' });
    assertSecurityHeaders(res.headers);
  });
});

test('POST /api/jobs validates body, content-type, size and source existence', async () => {
  const started: string[] = [];
  const fakeStart = (sourceId: string) => {
    started.push(sourceId);
    return {
      jobId: `job-${started.length}`,
      done: Promise.resolve<JobSummary>({
        jobId: `job-${started.length}`,
        sourceId,
        status: 'succeeded',
        purpose: 'test-live',
        createdAt: new Date().toISOString(),
        totalCostUSD: 0,
      }),
    };
  };
  await withServer({ storageDir: tempStorage(), startJob: fakeStart }, async base => {
    const post = (body: string, contentType = 'application/json') =>
      fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': contentType }, body });

    const badJson = await post('{not json');
    assert.equal(badJson.status, 400);
    assert.deepEqual(await badJson.json(), { error: 'BAD_REQUEST' });

    const missingField = await post('{}');
    assert.equal(missingField.status, 400);

    const wrongType = await post('{"sourceId": 42}');
    assert.equal(wrongType.status, 400);

    const wrongCt = await post('{}', 'text/plain');
    assert.equal(wrongCt.status, 415);
    assert.deepEqual(await wrongCt.json(), { error: 'UNSUPPORTED_MEDIA_TYPE' });

    const big = await post(JSON.stringify({ sourceId: 'nasa-grc-equations-of-motion', pad: 'x'.repeat(11 * 1024) }));
    assert.equal(big.status, 413);
    assert.deepEqual(await big.json(), { error: 'PAYLOAD_TOO_LARGE' });

    const unknown = await post(JSON.stringify({ sourceId: 'no-such-source' }));
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'SOURCE_NOT_FOUND' });

    assert.deepEqual(started, [], 'nothing was started for rejected requests');
  });
});

test('POST /api/jobs accepts one job, blocks while it runs, then accepts again', async () => {
  let release!: (s: JobSummary) => void;
  const gate = new Promise<JobSummary>(resolve => {
    release = resolve;
  });
  let calls = 0;
  const fakeStart = (sourceId: string) => {
    calls += 1;
    const jobId = `job-fake-${calls}`;
    const done =
      calls === 1
        ? gate
        : Promise.resolve<JobSummary>({
            jobId,
            sourceId,
            status: 'succeeded',
            purpose: 'test-live',
            createdAt: new Date().toISOString(),
            totalCostUSD: 0,
          });
    return { jobId, done };
  };
  await withServer({ storageDir: tempStorage(), startJob: fakeStart }, async base => {
    const post = () =>
      fetch(`${base}/api/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceId: 'nasa-grc-equations-of-motion' }),
      });

    const first = await post();
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { jobId: 'job-fake-1' });

    const blocked = await post();
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { error: 'JOB_RUNNING' });

    release({
      jobId: 'job-fake-1',
      sourceId: 'nasa-grc-equations-of-motion',
      status: 'succeeded',
      purpose: 'test-live',
      createdAt: new Date().toISOString(),
      totalCostUSD: 0,
    });
    await new Promise(resolve => setTimeout(resolve, 20));

    const second = await post();
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), { jobId: 'job-fake-2' });
  });
});

test('GET /api/jobs and /api/jobs/:id serve worker-persisted runs', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');

  await withServer({ storageDir, startJob: noStart }, async base => {
    const list = await getJson(base, '/api/jobs');
    assert.equal(list.status, 200);
    const jobs = list.body as JobSummary[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.jobId, jobId);
    assert.equal(jobs[0]?.status, 'succeeded');
    assert.equal(jobs[0]?.checksPassed, 13);

    const detail = await getJson(base, `/api/jobs/${jobId}`);
    assert.equal(detail.status, 200);
    const job = detail.body as {
      summary: JobSummary;
      events: { stage: string; status: string }[];
      analysis?: unknown;
      spec?: unknown;
      report?: unknown;
    };
    assert.equal(job.summary.jobId, jobId);
    assert.equal(job.events.length, 9);
    assert.deepEqual(
      job.events.map(e => e.stage),
      ['ingest', 'ingest', 'analyze', 'analyze', 'specify', 'specify', 'validate', 'validate', 'done'],
    );
    assert.ok(job.analysis !== undefined);
    assert.ok(job.spec !== undefined);
    assert.ok(job.report !== undefined);

    const missing = await getJson(base, '/api/jobs/job-does-not-exist');
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.body, { error: 'NOT_FOUND' });

    const invalid = await getJson(base, '/api/jobs/..%2Fetc');
    assert.equal(invalid.status, 404);
  });
});

test('unsupported-source run is visible through the API', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob('nasa-grc-speed-of-sound', {
    client: fakeClient(unsupportedFixture),
    storageDir,
    purpose: 'test-live',
  });
  await done;
  await withServer({ storageDir, startJob: noStart }, async base => {
    const detail = await getJson(base, `/api/jobs/${jobId}`);
    assert.equal(detail.status, 200);
    const job = detail.body as { summary: JobSummary; events: { stage: string; status: string }[] };
    assert.equal(job.summary.status, 'unsupported');
    assert.equal(
      job.events.find(e => e.stage === 'done')?.status,
      'succeeded',
    );
  });
});

test('MetaError surfaces as a failed job through the API', async () => {
  const storageDir = tempStorage();
  const failing: MetaClient = {
    complete: async () => {
      throw new MetaError('RATE_LIMITED', 'rate limited', { status: 429 });
    },
  };
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', {
    client: failing,
    storageDir,
    purpose: 'test-live',
  });
  await done;
  await withServer({ storageDir, startJob: noStart }, async base => {
    const detail = await getJson(base, `/api/jobs/${jobId}`);
    const job = detail.body as { summary: JobSummary };
    assert.equal(job.summary.status, 'failed');
    assert.equal(job.summary.error?.code, 'RATE_LIMITED');
  });
});

test('wrong method on known paths is 405; unknown paths are 404', async () => {
  await withServer({ storageDir: tempStorage(), startJob: noStart }, async base => {
    for (const [method, path] of [
      ['POST', '/api/health'],
      ['DELETE', '/api/sources'],
      ['PUT', '/api/sources/nasa-grc-equations-of-motion'],
      ['DELETE', '/api/jobs'],
      ['POST', '/api/jobs/job-x'],
    ] as const) {
      const res = await fetch(`${base}${path}`, { method });
      assert.equal(res.status, 405, `${method} ${path}`);
      assert.deepEqual(await res.json(), { error: 'METHOD_NOT_ALLOWED' });
    }
    for (const path of ['/', '/api', '/api/nope', '/api/health/extra', '/api/sources/a/b']) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, `GET ${path}`);
      assert.deepEqual(await res.json(), { error: 'NOT_FOUND' });
    }
  });
});

test('error responses never leak internals', async () => {
  await withServer({ storageDir: tempStorage(), startJob: noStart }, async base => {
    const res = await fetch(`${base}/api/sources/..%2F..%2Fpackage`);
    assert.equal(res.status, 404);
    const text = await res.text();
    assert.ok(!text.includes('at '), 'no stack frames');
    assert.ok(!text.includes('ENOENT'), 'no fs internals');
  });
});
