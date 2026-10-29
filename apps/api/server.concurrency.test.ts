// Concurrency (BUG-006 wave, part B) — the API admits up to `maxConcurrentJobs` live jobs
// (config/resource-limits.json, validated positive integer ≤ 8, product default 3) and only
// answers the busy 409 JOB_RUNNING when that many are running. Health reports the running
// count and the limit, and keeps `busy` = running >= limit for compatibility. The
// createApiServer OPTION defaults to 1 so direct embedders (e2e harness) keep the
// pre-concurrency single-job behaviour; main.ts passes the validated config value.
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

const SOURCE = 'nasa-grc-equations-of-motion';

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'api-concurrency-'));
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

async function getJson(base: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json()) as any };
}

async function postJob(base: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceId: SOURCE }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

interface GatedJob {
  jobId: string;
  release: (status?: JobSummary['status']) => void;
}

/** A startJob fake whose `done` promises stay pending until released, one gate per job. */
function gatedStart(): { start: NonNullable<ApiOptions['startJob']>; gates: GatedJob[] } {
  const gates: GatedJob[] = [];
  let n = 0;
  const start: NonNullable<ApiOptions['startJob']> = sourceId => {
    n += 1;
    const jobId = `job-gated-${n}`;
    let release!: (status?: JobSummary['status']) => void;
    const done = new Promise<JobSummary>(resolve => {
      release = (status: JobSummary['status'] = 'succeeded') => {
        resolve({
          jobId,
          sourceId,
          status,
          purpose: 'test-live',
          createdAt: new Date().toISOString(),
          totalCostUSD: 0,
          reservedUnknownUSD: 0,
          engine: null,
          revisions: 0,
          repairs: [],
          sourceKind: 'library',
        });
      };
    });
    gates.push({ jobId, release });
    return { jobId, done };
  };
  return { start, gates };
}

test('concurrency: maxConcurrentJobs 3 admits three live jobs and 409s the fourth, health reports running + limit', async () => {
  const { start, gates } = gatedStart();
  await withServer({ storageDir: tempStorage(), startJob: start, maxConcurrentJobs: 3 }, async base => {
    const first = await postJob(base);
    const second = await postJob(base);
    const third = await postJob(base);
    assert.deepEqual([first.status, second.status, third.status], [202, 202, 202]);
    assert.deepEqual([first.body.jobId, second.body.jobId, third.body.jobId], [
      'job-gated-1',
      'job-gated-2',
      'job-gated-3',
    ]);

    const during = await getJson(base, '/api/health');
    assert.equal(during.status, 200);
    assert.equal(during.body.running, 3);
    assert.equal(during.body.maxConcurrentJobs, 3);
    assert.equal(during.body.busy, true, 'busy stays running >= limit for compatibility');
    assert.equal(during.body.live, true);

    const fourth = await postJob(base);
    assert.equal(fourth.status, 409);
    assert.deepEqual(fourth.body, { error: 'JOB_RUNNING' }, 'the busy error code/shape is unchanged');
    assert.equal(gates.length, 3, 'the refused POST never started a job');

    // One job settles → a slot frees; health and admission follow.
    gates[0]!.release();
    await new Promise(resolve => setTimeout(resolve, 20));
    const after = await getJson(base, '/api/health');
    assert.equal(after.body.running, 2);
    assert.equal(after.body.busy, false, 'below the limit is not busy');
    const fifth = await postJob(base);
    assert.equal(fifth.status, 202);
    assert.equal(fifth.body.jobId, 'job-gated-4');
  });
});

test('concurrency: the option default stays 1 — a second POST while one job runs is 409 (e2e-compatible)', async () => {
  const { start, gates } = gatedStart();
  await withServer({ storageDir: tempStorage(), startJob: start }, async base => {
    const health0 = await getJson(base, '/api/health');
    assert.equal(health0.body.running, 0);
    assert.equal(health0.body.maxConcurrentJobs, 1);
    assert.equal(health0.body.busy, false);

    const first = await postJob(base);
    assert.equal(first.status, 202);
    const during = await getJson(base, '/api/health');
    assert.equal(during.body.running, 1);
    assert.equal(during.body.busy, true);

    const blocked = await postJob(base);
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.body, { error: 'JOB_RUNNING' });

    gates[0]!.release();
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = await postJob(base);
    assert.equal(second.status, 202, 'the slot is released once the job settles');
  });
});

test('concurrency: maxConcurrentJobs 8 is allowed, 0/9/fractions/non-numbers fail closed at construction', async () => {
  const { start } = gatedStart();
  await withServer({ storageDir: tempStorage(), startJob: start, maxConcurrentJobs: 8 }, async base => {
    const health = await getJson(base, '/api/health');
    assert.equal(health.body.maxConcurrentJobs, 8);
    assert.equal(health.body.busy, false);
  });
  for (const bad of [0, 9, -1, 1.5, Number.NaN, '3', null]) {
    assert.throws(
      () =>
        createApiServer({
          storageDir: tempStorage(),
          startJob: null,
          maxConcurrentJobs: bad as unknown as number,
        }),
      (err: unknown) => err instanceof Error && err.message === 'MAX_CONCURRENT_JOBS_INVALID',
      `maxConcurrentJobs=${String(bad)} must fail closed`,
    );
  }
});

test('concurrency: a settled-and-rejected job does not hold a slot (the gate clears on rejection too)', async () => {
  const gates: { release: (s?: JobSummary['status']) => void }[] = [];
  let n = 0;
  const start: NonNullable<ApiOptions['startJob']> = sourceId => {
    n += 1;
    const jobId = `job-rej-${n}`;
    let release!: (s?: JobSummary['status']) => void;
    const done = new Promise<JobSummary>((_resolve, reject) => {
      release = () => {
        reject(new Error('settled badly'));
      };
    });
    // Keep the rejection handled so the test process stays clean; the server must
    // free the slot on rejection exactly like on resolution.
    void done.catch(() => {});
    gates.push({ release });
    return { jobId, done };
  };
  await withServer({ storageDir: tempStorage(), startJob: start, maxConcurrentJobs: 1 }, async base => {
    const first = await postJob(base);
    assert.equal(first.status, 202);
    gates[0]!.release();
    await new Promise(resolve => setTimeout(resolve, 20));
    const health = await getJson(base, '/api/health');
    assert.equal(health.body.running, 0);
    const second = await postJob(base);
    assert.equal(second.status, 202);
  });
});
