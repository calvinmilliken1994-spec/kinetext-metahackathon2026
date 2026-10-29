// Concurrency (BUG-006 wave, part B) — several jobs may run at once in ONE process.
// Each job keeps its OWN abort/wall-time budget and its OWN cost accumulator: one job's
// deadline or spend never leaks into another's, and job.json totals equal each job's own
// receipts. Fake MetaClients only — no network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const SOURCE = 'nasa-grc-equations-of-motion';

function receipt(responseId: string, estCostUSD: number): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD,
    finishReason: 'stop',
    attempts: 1,
  };
}

/** A fake client whose calls take `delayMs` and cost `costUSD` per call (2 calls per v1 job). */
function slowFakeClient(delayMs: number, costUSD: number, tag: string): MetaClient {
  let n = 0;
  return {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      n += 1;
      const data = req.schemaName === 'source_analysis' ? analysisFixture : genFixture;
      return { data: structuredClone(data) as T, receipt: receipt(`${tag}-${n}`, costUSD) };
    },
  };
}

/** A fake client that never answers on its own — it fails when the job's own signal aborts. */
function abortsOnDeadlineClient(): MetaClient {
  return {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      await new Promise<void>((resolve, reject) => {
        const signal = req.signal;
        if (signal?.aborted) {
          reject(new MetaError('DEADLINE_EXCEEDED', undefined, { chargedUSD: 0, reservedUnknownUSD: 0, costBasis: 'usage' }));
          return;
        }
        const onAbort = (): void => {
          reject(
            new MetaError('DEADLINE_EXCEEDED', undefined, {
              chargedUSD: 0,
              reservedUnknownUSD: 0,
              costBasis: 'usage',
            }),
          );
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        // Never resolves by itself: only the job's own wall-time signal ends the call.
        void resolve;
      });
      throw new Error('unreachable');
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'jobs-concurrency-'));
}

function readJobJson(storageDir: string, jobId: string): JobSummary {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
}

test('concurrency: two interleaved jobs keep SEPARATE cost accumulators — each job.json equals its own receipts', async () => {
  const storageDir = tempStorage();
  // Job A is fast and cheap; job B is slower and pricier — they overlap in flight.
  const a = startJob(SOURCE, {
    client: slowFakeClient(0, 0.01, 'a'),
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'concurrent-job-a',
  });
  const b = startJob(SOURCE, {
    client: slowFakeClient(25, 0.03, 'b'),
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'concurrent-job-b',
  });
  const [sumA, sumB] = await Promise.all([a.done, b.done]);

  assert.equal(sumA.status, 'succeeded');
  assert.equal(sumB.status, 'succeeded');
  // A: 2 calls × 0.01; B: 2 calls × 0.03 — never mixed, never merged.
  assert.equal(sumA.totalCostUSD, 0.02);
  assert.equal(sumB.totalCostUSD, 0.06);
  assert.equal(readJobJson(storageDir, 'concurrent-job-a').totalCostUSD, 0.02);
  assert.equal(readJobJson(storageDir, 'concurrent-job-b').totalCostUSD, 0.06);
  // Each job kept its own artifacts.
  assert.equal(readJobJson(storageDir, 'concurrent-job-a').specId, `${SOURCE}-concurrent-job-a`.slice(0, 64));
  assert.equal(readJobJson(storageDir, 'concurrent-job-b').specId, `${SOURCE}-concurrent-job-b`.slice(0, 64));
});

test('concurrency: one job hitting ITS wall-time deadline fails alone while the other still succeeds', async () => {
  const storageDir = tempStorage();
  // C has a 30 ms wall time and a client that only ends when C's own signal aborts.
  const c = startJob(SOURCE, {
    client: abortsOnDeadlineClient(),
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'concurrent-job-c',
    limits: { maxJobWallTimeMs: 30 },
  });
  // D runs longer than C's whole lifetime with the normal wall time and succeeds.
  const d = startJob(SOURCE, {
    client: slowFakeClient(60, 0.02, 'd'),
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'concurrent-job-d',
  });
  const [sumC, sumD] = await Promise.all([c.done, d.done]);

  assert.equal(sumC.status, 'failed');
  assert.deepEqual(sumC.error, { code: 'DEADLINE_EXCEEDED', message: 'job deadline exceeded' });
  assert.equal(sumD.status, 'succeeded', "C's deadline never touched D");
  assert.equal(sumD.totalCostUSD, 0.04);
  assert.equal(readJobJson(storageDir, 'concurrent-job-d').status, 'succeeded');
  assert.equal(readJobJson(storageDir, 'concurrent-job-c').status, 'failed');
});
