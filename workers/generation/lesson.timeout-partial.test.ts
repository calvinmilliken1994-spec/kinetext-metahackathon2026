// Timeout partial publish — the final-evaluation loss (docs/evidence/final-eval/timeouts.md):
// 12 jobs ended failed/TIMEOUT although a part had ALREADY passed, because a TIMEOUT (the
// client's per-call timeout) or DEADLINE_EXCEEDED (the job's wall-time budget) in ONE
// component call was job-fatal. The fix:
//   - after the analysis succeeded, a TIMEOUT/DEADLINE_EXCEEDED in a component generate or
//     repair call fails ONLY that component (fixed plain reason TIMEOUT_REASON, allow-listed
//     detail), its charge is accounted at its own catch exactly as before (errorCharge,
//     reservedUnknownUSD), and the job ends succeeded with a partial publish;
//   - a repair call is never STARTED when the remaining job budget is below
//     MIN_REPAIR_BUDGET_MS (the component fails with the same timeout reason, no paid call);
//   - a timeout during the analysis stage (nothing usable yet) still fails the whole job;
//   - NETWORK_ERROR stays job-fatal (unchanged).
//
// Fake MetaClient with controllable delays/abort (no network, no credits, no .env).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import {
  enoughBudgetForRepair,
  MIN_REPAIR_BUDGET_MS,
  TIMEOUT_REASON,
} from './lesson.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';

function fakeReceipt(responseId: string, estCostUSD: number): MetaReceipt {
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

/** A paid provider timeout as the real client throws it (settled at reservation). */
function timeoutError(code: 'TIMEOUT' | 'DEADLINE_EXCEEDED', usd: number): MetaError {
  return new MetaError(code, undefined, { chargedUSD: usd, reservedUnknownUSD: usd, costBasis: 'reservation' });
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

function readJobJson(storageDir: string, jobId: string): JobSummary {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
}

function readLesson(storageDir: string, jobId: string): {
  components: { componentId: string; status: string; reason: string; revision: number }[];
} {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8'));
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9;

/** A broken formula-explorer gen (fails its checks) so the repair loop is reached. */
function brokenFeGen(): { expression: string } {
  const broken = structuredClone(feGen) as { expression: string };
  broken.expression = `(${feGen.expression as string}) + 1`;
  return broken;
}

interface FakeOpts {
  /** Thrown (after `repairWaitsForAbort`, if set) by the formula-explorer repair call. */
  repairError?: MetaError;
  /** The repair call waits for the job signal to abort, then throws `repairError`. */
  repairWaitsForAbort?: boolean;
  /** Thrown by the formula-explorer GENERATION call. */
  feGenError?: MetaError;
  /** The analysis call waits for the job signal to abort, then throws this. */
  analysisError?: MetaError;
  /** Delay before the formula-explorer generation call returns (ms). */
  feGenDelayMs?: number;
}

/**
 * Fake client for the DRAG fixture plan (formula-explorer-v1, then quiz-cards-v1):
 * analysis + quiz always pass; the formula explorer is broken (or errors) so the
 * repair path is exercised. Every completed call books 0.01 into `ledger`.
 */
function fakeClient(opts: FakeOpts): MetaClient & { calls: string[]; ledger: { committedUSD: number; unknownUSD: number } } {
  const calls: string[] = [];
  const ledger = { committedUSD: 0, unknownUSD: 0 };
  return {
    calls,
    ledger,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      if (name === 'source_analysis_v2') {
        if (opts.analysisError !== undefined) {
          const err = opts.analysisError;
          await new Promise<void>((resolve, reject) => {
            const onAbort = (): void => {
              ledger.committedUSD += err.chargedUSD ?? 0;
              ledger.unknownUSD += err.reservedUnknownUSD ?? 0;
              reject(err);
            };
            if (req.signal?.aborted) {
              onAbort();
              return;
            }
            req.signal?.addEventListener('abort', onAbort, { once: true });
          });
          throw new Error('unreachable');
        }
        ledger.committedUSD += 0.01;
        return { data: structuredClone(usableAnalysis) as T, receipt: fakeReceipt('analysis', 0.01) };
      }
      if (name === 'quiz_cards') {
        ledger.committedUSD += 0.01;
        return { data: structuredClone(quizGen) as T, receipt: fakeReceipt('quiz', 0.01) };
      }
      if (name === 'formula_explorer') {
        if (opts.feGenError !== undefined) {
          const err = opts.feGenError;
          ledger.committedUSD += err.chargedUSD ?? 0;
          ledger.unknownUSD += err.reservedUnknownUSD ?? 0;
          throw err;
        }
        if (opts.feGenDelayMs !== undefined) {
          await delay(opts.feGenDelayMs);
        }
        ledger.committedUSD += 0.01;
        return { data: brokenFeGen() as T, receipt: fakeReceipt('fe-gen', 0.01) };
      }
      if (name === 'formula_explorer_repair') {
        const err = opts.repairError ?? timeoutError('TIMEOUT', 0.2);
        if (opts.repairWaitsForAbort === true) {
          await new Promise<void>((resolve, reject) => {
            const onAbort = (): void => {
              ledger.committedUSD += err.chargedUSD ?? 0;
              ledger.unknownUSD += err.reservedUnknownUSD ?? 0;
              reject(err);
            };
            if (req.signal?.aborted) {
              onAbort();
              return;
            }
            req.signal?.addEventListener('abort', onAbort, { once: true });
          });
          throw new Error('unreachable');
        }
        ledger.committedUSD += err.chargedUSD ?? 0;
        ledger.unknownUSD += err.reservedUnknownUSD ?? 0;
        throw err;
      }
      throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
    },
  };
}

/* ------------------------------------------------------------------ */
/* The threshold constant and its pure boundary                        */
/* ------------------------------------------------------------------ */

test('MIN_REPAIR_BUDGET_MS is 60 s and enoughBudgetForRepair is false strictly below it', () => {
  assert.equal(MIN_REPAIR_BUDGET_MS, 60_000);
  assert.equal(enoughBudgetForRepair(60_000), true, 'exactly the threshold may start');
  assert.equal(enoughBudgetForRepair(59_999), false);
  assert.equal(enoughBudgetForRepair(0), false);
  assert.equal(enoughBudgetForRepair(-1), false);
  assert.equal(enoughBudgetForRepair(Number.POSITIVE_INFINITY), true, 'no deadline wired: never blocked');
});

/* ------------------------------------------------------------------ */
/* Budget ends while one component is still repairing → partial publish */
/* ------------------------------------------------------------------ */

test('the job budget kills a component repair call (DEADLINE_EXCEEDED): the passed part publishes, the job succeeds as a partial publish, the charge is kept', async () => {
  // The real client throws MetaError DEADLINE_EXCEEDED (settled at reservation) when the
  // job's AbortSignal.timeout fires mid-call; the fake throws the identical error. The
  // budget here is ample so the repair-start guard passes and the repair call is the one
  // that "ran out of time", exactly like the live path. (A real 60 s+ wait would only
  // re-test the OS timer; the analysis-timeout test below covers the live abort path.)
  const client = fakeClient({
    repairError: timeoutError('DEADLINE_EXCEEDED', 0.2),
  });
  const storageDir = mkdtempSync(join(tmpdir(), 'lesson-tmo-partial-'));
  const jobId = 'lesson-tmo-partial-0001';
  const { done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => jobId,
    limits: { maxJobWallTimeMs: 120_000 },
  });
  const summary = await done;

  // The job survives: the passed quiz publishes, the timed-out part fails alone.
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.equal(summary.lesson?.componentsPublished, 1);
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.equal(summary.lesson?.partialPublish, true);

  const lesson = readLesson(storageDir, jobId);
  const quiz = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  const fe = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(quiz?.status, 'passed');
  assert.equal(fe?.status, 'failed');
  assert.equal(fe?.reason, TIMEOUT_REASON);

  // Money: analysis 0.01 + quiz 0.01 + broken fe gen 0.01 + the timed-out repair 0.2,
  // accounted exactly once, with the uncertain part kept.
  assert.ok(close(summary.totalCostUSD, 0.23), `total ${summary.totalCostUSD}`);
  assert.ok(close(summary.reservedUnknownUSD, 0.2), `unknown ${summary.reservedUnknownUSD}`);
  assert.ok(close(client.ledger.committedUSD, summary.totalCostUSD));
  assert.ok(close(client.ledger.unknownUSD, summary.reservedUnknownUSD));
  const jobJson = readJobJson(storageDir, jobId);
  assert.ok(close(jobJson.totalCostUSD, 0.23));
  assert.ok(close(jobJson.reservedUnknownUSD, 0.2));

  // The repair attempt ran, was paid and did not pass.
  const repairs = summary.componentRepairs ?? [];
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0]?.componentId, 'formula-explorer-v1');
  assert.equal(repairs[0]?.passed, false);

  // Events: the repair failure carries the allow-listed fixed code, and the job ends done.
  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.equal(repairFailed?.target, 'component');
  assert.equal(repairFailed?.componentId, 'formula-explorer-v1');
  assert.equal(repairFailed?.revision, 2);
  assert.match(repairFailed?.detail ?? '', /^DEADLINE_EXCEEDED/);
  assert.equal(repairFailed?.estCostUSD, 0.2);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'done');
  assert.equal(last?.status, 'succeeded');
  assert.match(last?.detail ?? '', /partial publish/);
  // Only ONE repair call was made: after the abort no further attempt starts.
  assert.equal(client.calls.filter(n => n === 'formula_explorer_repair').length, 1);
});

/* ------------------------------------------------------------------ */
/* A per-call TIMEOUT during generation (the actual evaluation loss)    */
/* ------------------------------------------------------------------ */

test('a per-call TIMEOUT in a component GENERATION call fails only that component (job budget NOT exhausted)', async () => {
  // Mirrors the final-evaluation evidence: the timeline/fe generation call passed the
  // client's 120 s per-call timeout while the 420 s job budget had room to spare; the
  // MetaError code is TIMEOUT and the job signal is NOT aborted.
  const client = fakeClient({ feGenError: timeoutError('TIMEOUT', 0.15) });
  const storageDir = mkdtempSync(join(tmpdir(), 'lesson-tmo-gen-'));
  const jobId = 'lesson-tmo-gen-000001';
  const { done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => jobId,
    limits: { maxJobWallTimeMs: 60_000 },
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.equal(summary.lesson?.componentsPublished, 1);
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.equal(summary.lesson?.partialPublish, true);

  const lesson = readLesson(storageDir, jobId);
  const fe = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(fe?.status, 'failed');
  assert.equal(fe?.reason, TIMEOUT_REASON);
  assert.equal(fe?.revision, 1);

  assert.ok(close(summary.totalCostUSD, 0.17), `analysis 0.01 + quiz 0.01 + timeout reservation 0.15 = ${summary.totalCostUSD}`);
  assert.ok(close(summary.reservedUnknownUSD, 0.15));
  assert.ok(close(client.ledger.committedUSD, summary.totalCostUSD));

  const events = readEvents(storageDir, jobId);
  const failed = events.find(e => e.stage === 'component' && e.status === 'failed' && e.componentId === 'formula-explorer-v1');
  assert.match(failed?.detail ?? '', /^TIMEOUT/);
  assert.equal(failed?.estCostUSD, 0.15);
  // No repair call was attempted for the component whose generation timed out.
  assert.equal(client.calls.includes('formula_explorer_repair'), false);
});

/* ------------------------------------------------------------------ */
/* Timeout during the analysis stage still fails the whole job          */
/* ------------------------------------------------------------------ */

test('a timeout during the ANALYSIS call still fails the job (nothing usable yet)', async () => {
  const client = fakeClient({ analysisError: timeoutError('DEADLINE_EXCEEDED', 0.1) });
  const storageDir = mkdtempSync(join(tmpdir(), 'lesson-tmo-analysis-'));
  const jobId = 'lesson-tmo-analysis-01';
  const { done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => jobId,
    limits: { maxJobWallTimeMs: 400 },
  });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'DEADLINE_EXCEEDED');
  assert.ok(close(summary.totalCostUSD, 0.1));
  assert.ok(close(summary.reservedUnknownUSD, 0.1));
  assert.equal(summary.lesson?.overviewReady, false);
  assert.equal(summary.lesson?.componentsPublished, 0);
  const events = readEvents(storageDir, jobId);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'analyze');
  assert.equal(last?.status, 'failed');
  assert.match(last?.detail ?? '', /^DEADLINE_EXCEEDED/);
});

/* ------------------------------------------------------------------ */
/* No repair starts below the threshold                                 */
/* ------------------------------------------------------------------ */

test('no repair call starts when the remaining budget is below MIN_REPAIR_BUDGET_MS: the component fails with the timeout reason, unpaid', async () => {
  // Wall budget 61.5 s; the broken generation returns after ~1.6 s, so ~59.9 s remain —
  // strictly below the 60 s threshold. The job must NOT spend a repair reservation.
  const client = fakeClient({ feGenDelayMs: 1_600, repairError: timeoutError('TIMEOUT', 0.2) });
  const storageDir = mkdtempSync(join(tmpdir(), 'lesson-tmo-guard-'));
  const jobId = 'lesson-tmo-guard-0001';
  const { done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => jobId,
    limits: { maxJobWallTimeMs: 61_500 },
  });
  const summary = await done;

  assert.equal(client.calls.includes('formula_explorer_repair'), false, 'no repair call was started');
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.lesson?.componentsPublished, 1, 'the quiz still publishes');
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.equal(summary.lesson?.partialPublish, true);

  const lesson = readLesson(storageDir, jobId);
  const fe = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(fe?.status, 'failed');
  assert.equal(fe?.reason, TIMEOUT_REASON);

  // Money: analysis 0.01 + quiz 0.01 + broken fe gen 0.01 — the repair never ran.
  assert.ok(close(summary.totalCostUSD, 0.03), `total ${summary.totalCostUSD}`);
  assert.ok(close(summary.reservedUnknownUSD, 0));
  assert.ok(close(client.ledger.committedUSD, summary.totalCostUSD));
  assert.equal((summary.componentRepairs ?? []).length, 0, 'an attempt that never started is not a repair record');

  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(repairFailed, 'the skipped repair is visible in the timeline');
  assert.equal(repairFailed?.target, 'component');
  assert.equal(repairFailed?.componentId, 'formula-explorer-v1');
  assert.match(repairFailed?.detail ?? '', /^TIMEOUT/);
  assert.equal(repairFailed?.estCostUSD, undefined, 'nothing was charged');
  assert.equal(events.some(e => e.stage === 'repair' && e.status === 'started'), false, 'never announced as started');
});

/* ------------------------------------------------------------------ */
/* NETWORK_ERROR is unchanged (still job-fatal in a component call)     */
/* ------------------------------------------------------------------ */

test('NETWORK_ERROR in a component call stays job-fatal (unchanged behaviour)', async () => {
  const networkError = new MetaError('NETWORK_ERROR', undefined, {
    chargedUSD: 0.3,
    reservedUnknownUSD: 0.3,
    costBasis: 'reservation',
  });
  const client = fakeClient({ feGenError: networkError });
  const storageDir = mkdtempSync(join(tmpdir(), 'lesson-tmo-network-'));
  const jobId = 'lesson-tmo-network-01';
  const { done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => jobId,
    limits: { maxJobWallTimeMs: 60_000 },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'NETWORK_ERROR');
  assert.ok(close(summary.totalCostUSD, client.ledger.committedUSD));
  assert.ok(close(summary.reservedUnknownUSD, 0.3));
});
