// S6R-07 — concurrent fatal component errors must not lose paid charges.
//
// Two components run at once (plan concurrency 2). When BOTH reject with separately
// charged provider errors (TIMEOUT / NETWORK_ERROR after the client settled a
// reservation), every charge must reach the ONE job accumulator exactly once, at its own
// catch boundary, before any fallible event/artifact write — and the terminal cause is
// the FIRST fatal error. Same when one task fails with a paid fatal error while the
// other throws during persistence (the last-resort INTERNAL path).
//
// Fake MetaClient with a fake ledger (no network, no credits, no .env); a second test
// drives the REAL client + REAL ledger through an injected fetchImpl, with the ledger
// lock on an OS-assigned free port (never the live 47853).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { createMetaClient, MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysisText = readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8');
const usableAnalysis = JSON.parse(usableAnalysisText) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));
const LIMITS = JSON.parse(
  readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
) as { maxInputTokensV2: number; maxOutputTokens: number; maxJobWallTimeMs: number };

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

/** A paid provider failure as the real client throws it after settling a reservation.
 *  (Timeout partial-publish fix: TIMEOUT/DEADLINE_EXCEEDED are component-level in the
 *  lesson flow now — covered by lesson.timeout-partial.test.ts — so these concurrent-fatal
 *  accounting tests use two codes that remain job-fatal.) */
function paidError(code: 'SERVER_ERROR' | 'NETWORK_ERROR', usd: number): MetaError {
  return new MetaError(code, undefined, { chargedUSD: usd, reservedUnknownUSD: usd, costBasis: 'reservation' });
}

interface FakeLedger {
  committedUSD: number;
  unknownUSD: number;
}

type Outcome = { kind: 'ok'; data: unknown; usd: number } | { kind: 'throw'; err: MetaError; usd: number; unknown: number };

/**
 * A fake client whose two kit GENERATION calls are held until both have arrived, then
 * settled in the given order (so both are genuinely in flight at once). Every settled
 * call is booked into the fake ledger exactly like the real client would book it.
 */
function concurrentClient(
  outcomes: Record<string, Outcome>,
  order: string[],
  onSettle?: (name: string) => void,
): MetaClient & { ledger: FakeLedger; calls: string[] } {
  const ledger: FakeLedger = { committedUSD: 0, unknownUSD: 0 };
  const calls: string[] = [];
  const waiting = new Map<string, () => void>();
  const release = (): void => {
    for (const name of order) {
      waiting.get(name)?.();
    }
  };
  return {
    ledger,
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      if (name === 'source_analysis_v2') {
        ledger.committedUSD += 0.01;
        return { data: structuredClone(usableAnalysis) as T, receipt: fakeReceipt('analysis', 0.01) };
      }
      const outcome = outcomes[name];
      if (outcome === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      await new Promise<void>(resolve => {
        waiting.set(name, resolve);
        if (order.every(n => waiting.has(n))) {
          release();
        }
      });
      // Settle in the requested order: each later call waits one macrotask per position.
      const position = order.indexOf(name);
      for (let i = 0; i < position; i += 1) {
        await new Promise<void>(r => setImmediate(r));
      }
      onSettle?.(name);
      if (outcome.kind === 'throw') {
        ledger.committedUSD += outcome.usd;
        ledger.unknownUSD += outcome.unknown;
        throw outcome.err;
      }
      ledger.committedUSD += outcome.usd;
      return { data: structuredClone(outcome.data) as T, receipt: fakeReceipt(name, outcome.usd) };
    },
  };
}

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

function readJobJson(storageDir: string, jobId: string): JobSummary {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9;

test('S6R-07: two concurrent kit calls BOTH reject with separately charged errors — both charges land exactly once and match the ledger; the first error is the terminal cause', async () => {
  const client = concurrentClient(
    {
      formula_explorer: { kind: 'throw', err: paidError('SERVER_ERROR', 0.2), usd: 0.2, unknown: 0.2 },
      quiz_cards: { kind: 'throw', err: paidError('NETWORK_ERROR', 0.3), usd: 0.3, unknown: 0.3 },
    },
    ['formula_explorer', 'quiz_cards'],
  );
  const storageDir = mkdtempSync(join(tmpdir(), 's6r07-both-'));
  const jobId = 's6r07-both-000001';
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => jobId });
  const summary = await done;

  assert.deepEqual(client.calls.slice().sort(), ['formula_explorer', 'quiz_cards', 'source_analysis_v2']);
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'SERVER_ERROR', 'the FIRST fatal error is the terminal cause');
  assert.ok(close(summary.totalCostUSD, client.ledger.committedUSD), `total ${summary.totalCostUSD} must equal ledger ${client.ledger.committedUSD}`);
  assert.ok(close(summary.totalCostUSD, 0.51), 'analysis 0.01 + SERVER_ERROR 0.2 + NETWORK_ERROR 0.3, each once');
  assert.ok(close(summary.reservedUnknownUSD, client.ledger.unknownUSD));
  assert.ok(close(summary.reservedUnknownUSD, 0.5));

  const jobJson = readJobJson(storageDir, jobId);
  assert.ok(close(jobJson.totalCostUSD, 0.51));
  assert.ok(close(jobJson.reservedUnknownUSD, 0.5));

  // One terminal failed event for the first cause carrying its own charge; the second
  // error's charge is visible on its own failed event (never folded into the first).
  const events = readEvents(storageDir, jobId);
  const failed = events.filter(e => e.status === 'failed');
  const last = events[events.length - 1];
  assert.equal(last?.status, 'failed');
  assert.equal(last?.componentId, 'formula-explorer-v1');
  assert.match(last?.detail ?? '', /^SERVER_ERROR/);
  assert.equal(last?.estCostUSD, 0.2);
  const second = failed.find(e => e.componentId === 'quiz-cards-v1');
  assert.ok(second, 'the second fatal error is recorded on its own event');
  assert.match(second?.detail ?? '', /^NETWORK_ERROR/);
  assert.equal(second?.estCostUSD, 0.3);
  const eventCost = failed.reduce((s, e) => s + (typeof e.estCostUSD === 'number' ? e.estCostUSD : 0), 0);
  assert.ok(close(eventCost, 0.5), 'no event double-books a charge');
});

test('S6R-07: the settle order decides the terminal cause, never the accounting', async () => {
  const client = concurrentClient(
    {
      formula_explorer: { kind: 'throw', err: paidError('SERVER_ERROR', 0.2), usd: 0.2, unknown: 0.2 },
      quiz_cards: { kind: 'throw', err: paidError('NETWORK_ERROR', 0.3), usd: 0.3, unknown: 0.3 },
    },
    ['quiz_cards', 'formula_explorer'],
  );
  const storageDir = mkdtempSync(join(tmpdir(), 's6r07-order-'));
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 's6r07-order-000001' });
  const summary = await done;
  assert.equal(summary.error?.code, 'NETWORK_ERROR');
  assert.ok(close(summary.totalCostUSD, 0.51));
  assert.ok(close(summary.reservedUnknownUSD, 0.5));
});

test('S6R-07: one paid fatal error + the other task throwing during persistence — the fatal charge still lands (last-resort INTERNAL)', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 's6r07-crash-'));
  const jobId = 's6r07-crash-000001';
  const client = concurrentClient(
    {
      formula_explorer: { kind: 'throw', err: paidError('SERVER_ERROR', 0.2), usd: 0.2, unknown: 0.2 },
      quiz_cards: { kind: 'ok', data: quizGen, usd: 0.04 },
    },
    ['formula_explorer', 'quiz_cards'],
    name => {
      if (name === 'quiz_cards') {
        // Sabotage the quiz revision-1 artifact: a directory at its path makes the
        // atomic rename throw — an unexpected persistence crash in the second task.
        mkdirSync(join(storageDir, 'runs', jobId, 'quiz-cards-v1.r1.json'), { recursive: true });
      }
    },
  );
  const realError = console.error;
  console.error = (): void => {};
  let summary: JobSummary;
  try {
    const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => jobId });
    summary = await done;
  } finally {
    console.error = realError;
  }
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL', 'the persistence crash takes the last-resort path');
  assert.ok(close(client.ledger.committedUSD, 0.25));
  assert.ok(close(summary.totalCostUSD, client.ledger.committedUSD), `total ${summary.totalCostUSD} must equal ledger ${client.ledger.committedUSD}`);
  assert.ok(close(summary.reservedUnknownUSD, 0.2));
  const jobJson = readJobJson(storageDir, jobId);
  assert.ok(close(jobJson.totalCostUSD, 0.25));
  assert.ok(close(jobJson.reservedUnknownUSD, 0.2));
});

test('S6R-07 + timeout fix: a single paid repair TIMEOUT is accounted exactly once and fails only its component (partial publish, no double count)', async () => {
  const broken = structuredClone(feGen) as { expression: string };
  broken.expression = `(${feGen.expression as string}) + 1`;
  const ledger: FakeLedger = { committedUSD: 0, unknownUSD: 0 };
  const client: MetaClient = {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      if (name === 'formula_explorer_repair') {
        ledger.committedUSD += 0.2;
        ledger.unknownUSD += 0.2;
        throw new MetaError('TIMEOUT', undefined, { chargedUSD: 0.2, reservedUnknownUSD: 0.2, costBasis: 'reservation' });
      }
      const data = name === 'source_analysis_v2' ? usableAnalysis : name === 'formula_explorer' ? broken : name === 'quiz_cards' ? quizGen : undefined;
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      ledger.committedUSD += 0.01;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(name, 0.01) };
    },
  };
  const storageDir = mkdtempSync(join(tmpdir(), 's6r07-single-'));
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 's6r07-single-00001' });
  const summary = await done;
  // Timeout partial-publish fix: the repair TIMEOUT is component-level — the job survives,
  // the passed quiz publishes, and the charge is accounted exactly once.
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.equal(summary.lesson?.partialPublish, true);
  assert.equal(summary.lesson?.componentsPublished, 1);
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.ok(close(summary.totalCostUSD, ledger.committedUSD), `total ${summary.totalCostUSD} vs ledger ${ledger.committedUSD}`);
  assert.ok(close(summary.totalCostUSD, 0.23));
  assert.ok(close(summary.reservedUnknownUSD, 0.2));
  const events = readEvents(storageDir, 's6r07-single-00001');
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.equal(repairFailed?.target, 'component');
  assert.equal(repairFailed?.componentId, 'formula-explorer-v1');
  assert.equal(repairFailed?.revision, 2);
  assert.equal(repairFailed?.detail, 'TIMEOUT; cost basis: reservation (outcome uncertain)');
  assert.equal(repairFailed?.estCostUSD, 0.2);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'done');
  assert.equal(last?.status, 'succeeded');
});

/* ------------------------------------------------------------------ */
/* Real client + real ledger (fake transport) — job totals == ledger    */
/* ------------------------------------------------------------------ */

function freeLockPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address !== 'object') {
        probe.close();
        reject(new Error('NO_PORT'));
        return;
      }
      const port: number = (address as AddressInfo).port;
      probe.close(() => resolve(port));
    });
  });
}

test('S6R-07: real ledger — two concurrent kit calls both time out (settled at reservation); the job survives as an overview-only publish and job.json totals equal the ledger committed spend', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 's6r07-ledger-'));
  const lockPort = await freeLockPort();
  assert.notEqual(lockPort, 47853, 'never the live evaluation ledger port');
  const ledger: Ledger = await openLedger({ path: join(storageDir, 'ledger.jsonl'), capUSD: 50, lockPort });
  try {
    let kitArrivals = 0;
    let releaseKit: () => void = () => {};
    const kitBarrier = new Promise<void>(resolve => {
      releaseKit = resolve;
    });
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: string }[] };
      const user = body.messages?.find(m => m.role === 'user')?.content ?? '';
      if (user.startsWith('Design a ')) {
        kitArrivals += 1;
        if (kitArrivals >= 2) {
          releaseKit();
        }
        await kitBarrier;
        throw new DOMException('PRIVATE_PROVIDER_MESSAGE', 'TimeoutError');
      }
      return new Response(
        JSON.stringify({
          id: 'fake-analysis',
          model: 'muse-spark-1.3',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: usableAnalysisText } }],
          usage: { prompt_tokens: 100, completion_tokens: 2000 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const client: MetaClient = createMetaClient({
      apiKey: 'synthetic-tests-only', // never a real credential
      ledger,
      allowLive: true,
      maxInputTokens: LIMITS.maxInputTokensV2,
      fetchImpl,
      sleep: async () => {},
    });
    const jobId = 's6r07-ledger-00001';
    const { done } = startJob(DRAG, {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => jobId,
      limits: { specMaxOutputTokens: LIMITS.maxOutputTokens, maxJobWallTimeMs: LIMITS.maxJobWallTimeMs },
    });
    const summary = await done;
    // Timeout partial-publish fix: two component-level timeouts no longer kill the job —
    // the overview publishes, both components fail alone with the timeout reason, and the
    // reservation charges still equal the ledger exactly.
    assert.equal(summary.status, 'succeeded');
    assert.equal(summary.error, undefined);
    assert.equal(summary.lesson?.componentsPublished, 0);
    assert.equal(summary.lesson?.componentsFailed, 2);
    assert.ok(kitArrivals >= 2, 'both kit calls were in flight together');
    const committed = ledger.committedUSD();
    const jobJson = readJobJson(storageDir, jobId);
    assert.ok(committed > 0);
    assert.ok(Math.abs(jobJson.totalCostUSD - committed) <= 1e-6, `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committed}`);
    assert.ok(jobJson.reservedUnknownUSD > 0, 'the timeouts settled at reservation with an unknown outcome');
    assert.ok(!readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8').includes('PRIVATE_PROVIDER_MESSAGE'));
  } finally {
    ledger.close();
  }
});
