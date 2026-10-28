// Stage 5 review S5-05 — every repair failure event carries the attempted
// revision. Reproduced through the REAL stack: createMetaClient (fake fetch,
// no network) → real openLedger in a temp dir (explicit free lockPort) → real
// pipeline → worker startJob → persisted events, exactly like the reviewer's
// repair-400 probe plus deadline and budget-refusal variants.
// No network beyond loopback, no credits, no .env access, no live Meta calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { createMetaClient } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { buildAnalysisMessages, buildSpecMessages } from '../../packages/meta/prompts.ts';
import { inputTokenBound, reservationUSD } from '../../packages/meta/pricing.ts';
import { genSchemaFor, sourceAnalysisGenSchema } from '../../packages/contracts/schemas.ts';
import { loadSource } from '../../packages/sources/index.ts';
import type { GeneratedSpec, SourceAnalysis, StageEvent } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const LIMITS = JSON.parse(readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8')) as { maxInputTokens: number };
const FAKE_KEY = 'synthetic-test-key-not-a-credential'; // never a real credential
const MODEL = 'muse-spark-1.3';
/** Reviewer P3 valid usage: $0.0000975 per call at muse-spark-1.3 prices. */
const USAGE_SMALL = { prompt_tokens: 10, completion_tokens: 20 };
const USAGE_COST_SMALL = 0.0000975;

/** genFixture with a wrong first behavioral-test answer → 'behavior.tests' fails → a repair runs. */
function wrongFirstAnswer(): GeneratedSpec {
  const bad = structuredClone(genFixture) as GeneratedSpec & { behavioralTests: Record<string, unknown>[] };
  bad.behavioralTests[0]['expectedAccelerationMps2'] = 99;
  return bad as unknown as GeneratedSpec;
}

function envelope(id: string, content: string, usage: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id,
    model: MODEL,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  };
  if (usage !== undefined) {
    body['usage'] = usage;
  }
  return body;
}

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

interface RunOptions {
  capUSD?: number;
  maxJobWallTimeMs?: number;
}

async function runWithFetch(
  fetchImpl: typeof fetch,
  opts: RunOptions = {},
): Promise<{ summary: JobSummary; events: StageEvent[]; committedUSD: number }> {
  const storageDir = mkdtempSync(join(tmpdir(), 's5-repairfail-'));
  const lockPort = await freeLockPort();
  const ledger: Ledger = await openLedger({
    path: join(storageDir, 'ledger.jsonl'),
    capUSD: opts.capUSD ?? 10,
    lockPort,
  });
  try {
    const client: MetaClient = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      maxInputTokens: LIMITS.maxInputTokens,
      fetchImpl,
      sleep: async () => {},
    });
    const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
      client,
      storageDir,
      purpose: 'test-live',
      ...(opts.maxJobWallTimeMs !== undefined ? { limits: { maxJobWallTimeMs: opts.maxJobWallTimeMs } } : {}),
    });
    const summary: JobSummary = await done;
    const events: StageEvent[] = readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter(line => line.trim() !== '')
      .map(line => JSON.parse(line) as StageEvent);
    return { summary, events, committedUSD: ledger.committedUSD() };
  } finally {
    ledger.close();
  }
}

function repairFailedEvent(events: StageEvent[]): StageEvent {
  const ev = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(ev !== undefined, 'a failed repair event exists');
  return ev;
}

test('S5-05 repair-400: a BAD_REQUEST repair failure carries revision 2 and never leaks provider text', async () => {
  const responses: unknown[] = [
    envelope('resp-analysis', JSON.stringify(analysisFixture), USAGE_SMALL),
    envelope('resp-bad-spec', JSON.stringify(wrongFirstAnswer()), USAGE_SMALL),
  ];
  let sends = 0;
  const fetchImpl: typeof fetch = async () => {
    sends += 1;
    if (sends >= 3) {
      return new Response(JSON.stringify({ error: { message: 'SYNTHETIC_PRIVATE_MARKER' } }), { status: 400 });
    }
    const next = responses.shift();
    assert.ok(next !== undefined);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const { summary, events, committedUSD } = await runWithFetch(fetchImpl);

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'BAD_REQUEST', message: 'bad request' });
  assert.equal(summary.revisions, 1, 'the refused repair produced no revision');
  assert.deepEqual(summary.repairs, []);

  const failed = repairFailedEvent(events);
  assert.equal(failed.revision, 2, 'the failed repair event names the attempted revision (S5-05)');
  assert.equal(failed.detail, 'BAD_REQUEST');
  assert.ok(
    !JSON.stringify(events).includes('SYNTHETIC_PRIVATE_MARKER'),
    'R-01: provider text never reaches the persisted events',
  );
  assert.ok(
    Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
    `job total ${summary.totalCostUSD} equals ledger committed ${committedUSD}`,
  );
  assert.ok(!events.some(e => e.stage === 'done'), 'a failed job emits no done event');
  assert.equal(events.at(-1)?.stage, 'repair');
  assert.equal(events.at(-1)?.status, 'failed');
});

test('S5-05 deadline: a DEADLINE_EXCEEDED repair failure carries revision 2 and accounts the reservation', async () => {
  const responses: unknown[] = [
    envelope('resp-analysis-d', JSON.stringify(analysisFixture), USAGE_SMALL),
    envelope('resp-bad-spec-d', JSON.stringify(wrongFirstAnswer()), USAGE_SMALL),
  ];
  let sends = 0;
  const fetchImpl: typeof fetch = (_url, init) => {
    sends += 1;
    if (sends >= 3) {
      // The repair call hangs; the job-wide deadline aborts it (shared signal).
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal ?? undefined;
        const onAbort = (): void => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        };
        if (signal === undefined) {
          reject(new Error('NO_SIGNAL_PASSED'));
          return;
        }
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    const next = responses.shift();
    assert.ok(next !== undefined);
    return Promise.resolve(
      new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
  const { summary, events, committedUSD } = await runWithFetch(fetchImpl, { maxJobWallTimeMs: 150 });

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'DEADLINE_EXCEEDED', message: 'job deadline exceeded' });
  const failed = repairFailedEvent(events);
  assert.equal(failed.revision, 2, 'the failed repair event names the attempted revision (S5-05)');
  assert.equal(failed.detail, 'DEADLINE_EXCEEDED; cost basis: reservation (outcome uncertain)');
  assert.ok(summary.reservedUnknownUSD > 0, 'the uncertain repair reservation is accounted as unknown');
  assert.ok(
    Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
    `job total ${summary.totalCostUSD} equals ledger committed ${committedUSD}`,
  );
});

test('S5-05 budget: a BUDGET_EXCEEDED repair refusal carries revision 2 and distinguishes a refused call', async () => {
  // The spec call bills a large-but-valid usage so the committed spend sits just
  // below the cap: the repair RESERVATION (never a sent request) is refused.
  const usageBig = { prompt_tokens: 20000, completion_tokens: 2000 }; // $0.0335
  const responses: unknown[] = [
    envelope('resp-analysis-b', JSON.stringify(analysisFixture), USAGE_SMALL),
    envelope('resp-spec-b', JSON.stringify(wrongFirstAnswer()), usageBig),
  ];
  let sends = 0;
  const fetchImpl: typeof fetch = async () => {
    sends += 1;
    assert.ok(sends <= 2, 'the refused repair call must never reach the provider');
    const next = responses.shift();
    assert.ok(next !== undefined);
    return new Response(JSON.stringify(next), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  // Compute the exact caps the client will use, then place the ledger cap between
  // "spec reserve succeeds" and "repair reserve succeeds" (repair reservation is
  // always ≥ 8000 output tokens × $4.25/M = $0.034).
  const source = loadSource('nasa-grc-equations-of-motion');
  const boundAnalysis = inputTokenBound(buildAnalysisMessages(source), sourceAnalysisGenSchema as Record<string, unknown>);
  const boundSpec = inputTokenBound(buildSpecMessages(source, analysisFixture), genSchemaFor('forces-1d-v1'));
  const reserveAnalysis = reservationUSD(MODEL, boundAnalysis, 6000);
  const reserveSpec = reservationUSD(MODEL, boundSpec, 8000);
  const committedAfterSpec = USAGE_COST_SMALL + 0.0335;
  const capUSD = Math.max(reserveAnalysis, USAGE_COST_SMALL + reserveSpec) + 0.005;
  assert.ok(capUSD < committedAfterSpec + 0.034, 'the repair reservation must exceed the remaining cap');

  const { summary, events, committedUSD } = await runWithFetch(fetchImpl, { capUSD });

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'BUDGET_EXCEEDED', message: 'budget exceeded' });
  assert.equal(sends, 2, 'a refused reservation is never sent as an HTTP request');
  const failed = repairFailedEvent(events);
  assert.equal(failed.revision, 2, 'the failed repair event names the attempted revision (S5-05)');
  assert.equal(failed.detail, 'BUDGET_EXCEEDED');
  assert.ok(
    Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
    `job total ${summary.totalCostUSD} equals ledger committed ${committedUSD}`,
  );
  assert.equal(summary.reservedUnknownUSD, 0, 'a refused reservation charges nothing');
});
