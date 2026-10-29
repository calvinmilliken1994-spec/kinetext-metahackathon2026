// S6-W — lesson-flow cost discipline (S5B-06 mirror for Stage 6): EVERY charge of the lesson
// pipeline (analysis, components, repairs, premium) funnels through the ONE worker cost
// accumulator, which updates the summary BEFORE any fallible event/artifact write. Here the
// events.jsonl append is sabotaged (replaced with a directory) so the last-resort INTERNAL
// path must still persist job.json totals equal to the ledger's committed spend.
//
// Real client, real ledger, FAKE transport (injected fetchImpl — the network is never
// touched). No credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { readJob, startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { createMetaClient } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';

const LIMITS = JSON.parse(
  readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
) as { maxInputTokensV2: number; maxOutputTokens: number; maxJobWallTimeMs: number };
const FAKE_KEY = 'syntac…s-only'; // never a real credential
const JOB_ID = 's6w-lesson-cost-01';
const declinedAnalysis = readFileSync(
  new URL('../../tests/fixtures/stage6/source-analysis-v2.declined.json', import.meta.url),
  'utf8',
);

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

/** The reviewer's sabotage: events.jsonl becomes a directory, so every later append throws. job.json stays writable. */
function breakEventsFile(storageDir: string): void {
  const p = join(storageDir, 'runs', JOB_ID, 'events.jsonl');
  try {
    if (statSync(p).isDirectory()) {
      return; // already sabotaged
    }
    unlinkSync(p);
  } catch {
    // not created yet
  }
  mkdirSync(p);
}

type Mode = 'paid-truncation' | 'declined-then-event-fail' | 'timeout';

async function runLessonEventWriteFailure(mode: Mode): Promise<{
  summary: JobSummary;
  jobJson: JobSummary;
  committedUSD: number;
  persistedBlob: string;
}> {
  const storageDir = mkdtempSync(join(tmpdir(), 's6w-cost-'));
  const lockPort = await freeLockPort();
  const ledger: Ledger = await openLedger({
    path: join(storageDir, 'ledger.jsonl'),
    capUSD: 50,
    lockPort,
  });
  const stderrLines: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]): void => {
    stderrLines.push(args.map(a => String(a)).join(' '));
  };
  try {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      breakEventsFile(storageDir);
      if (mode === 'timeout') {
        throw new DOMException('PRIVATE_PROVIDER_MESSAGE', 'TimeoutError');
      }
      return new Response(
        JSON.stringify({
          id: `fake-${calls}`,
          model: 'muse-spark-1.3',
          choices: [
            {
              index: 0,
              finish_reason: mode === 'paid-truncation' ? 'length' : 'stop',
              message: { role: 'assistant', content: declinedAnalysis },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 2000 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
    const client: MetaClient = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      // S6-W: lesson jobs run on the v2 input bound (main.ts wiring).
      maxInputTokens: LIMITS.maxInputTokensV2,
      fetchImpl,
      sleep: async () => {},
    });
    const { jobId, done } = startJob('nrc-glossary-half-life', {
      client,
      storageDir,
      purpose: 'test-live',
      flow: 'lesson',
      newJobId: () => JOB_ID,
      limits: {
        specMaxOutputTokens: LIMITS.maxOutputTokens,
        maxJobWallTimeMs: LIMITS.maxJobWallTimeMs,
      },
    });
    const summary = await done;
    assert.equal(jobId, JOB_ID);
    const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', JOB_ID, 'job.json'), 'utf8')) as JobSummary;
    const view = readJob(storageDir, JOB_ID);
    return {
      summary,
      jobJson,
      committedUSD: ledger.committedUSD(),
      persistedBlob: JSON.stringify({ jobJson, view }),
    };
  } finally {
    console.error = realError;
    ledger.close();
  }
}

test('S6-W: lesson analysis paid-truncation + failing event write — job.json totals equal the ledger committed cost', async () => {
  const { summary, jobJson, committedUSD, persistedBlob } = await runLessonEventWriteFailure('paid-truncation');
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL', 'the broken event append surfaces as the last-resort INTERNAL');
  assert.ok(committedUSD > 0, `the ledger committed the truncated call (got ${committedUSD})`);
  assert.ok(
    Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
    `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD}`,
  );
  assert.equal(jobJson.totalCostUSD, summary.totalCostUSD);
  assert.equal(
    jobJson.reservedUnknownUSD,
    0,
    'the truncated call carried valid usage, so it reconciled usage-based with no unknown portion',
  );
  assert.ok(!persistedBlob.includes('PRIVATE_PROVIDER_MESSAGE'), 'no provider text is persisted (R-01)');
});

test('S6-W: lesson analysis timeout + failing event write — the reservation-charged unknown amount survives in job.json', async () => {
  const { summary, jobJson, committedUSD, persistedBlob } = await runLessonEventWriteFailure('timeout');
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL');
  assert.ok(committedUSD > 0, `the ledger committed the timeout reservation (got ${committedUSD})`);
  assert.ok(
    Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
    `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD}`,
  );
  assert.ok(
    Math.abs(jobJson.reservedUnknownUSD - committedUSD) <= 1e-6,
    `a timeout reconciles at the reservation: unknown ${jobJson.reservedUnknownUSD} of total ${jobJson.totalCostUSD}`,
  );
  assert.ok(!persistedBlob.includes('PRIVATE_PROVIDER_MESSAGE'), 'no provider text is persisted (R-01)');
});

test('S6-W: lesson declined analysis billed by usage + failing event write — the accounted receipt survives in job.json', async () => {
  const { summary, jobJson, committedUSD, persistedBlob } = await runLessonEventWriteFailure('declined-then-event-fail');
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL');
  assert.equal(summary.flow, 'lesson');
  assert.ok(committedUSD > 0, `the ledger committed the analysis call (got ${committedUSD})`);
  assert.ok(
    Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
    `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD}`,
  );
  assert.equal(jobJson.reservedUnknownUSD, 0, 'the usage-based charge has no unknown portion');
  assert.ok(!persistedBlob.includes('PRIVATE_PROVIDER_MESSAGE'), 'no provider text is persisted (R-01)');
});
