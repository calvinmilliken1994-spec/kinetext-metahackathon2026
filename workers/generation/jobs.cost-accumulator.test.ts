// S5B-06 (Stage 5b review, Wave C) — EVERY charge/unknown amount must funnel through
// one accumulator that updates summary.totalCostUSD/reservedUnknownUSD BEFORE any
// fallible event/artifact write, so even the last-resort INTERNAL path (here: the
// events.jsonl append fails because the reviewer's probe replaced it with a directory)
// persists a job.json whose totals equal the ledger's committed spend.
//
// Reviewer evidence (cost-results.json, 'paid-error-event-write-fails'): real client +
// real scratch ledger + fake 2xx truncated output with valid usage; job.json said
// totalCostUSD 0 while the ledger committed USD 0.068125.
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
) as { maxInputTokens: number; maxOutputTokens: number; analysisMaxOutputTokens: number; maxJobWallTimeMs: number };
const FAKE_KEY = 'syntac…s-only'; // never a real credential
const JOB_ID = 's5b06-job';
const DECLINE = JSON.stringify({
  supported: false,
  activity: 'none',
  unsupportedReason: 'Synthetic source is outside supported activities.',
  concepts: [],
  objectives: [],
});

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

type Mode = 'paid-truncation' | 'timeout' | 'uncertain-retry';

interface Outcome {
  summary: JobSummary;
  jobJson: JobSummary;
  committedUSD: number;
  persistedBlob: string;
  stderr: string;
}

async function runEventWriteFailure(mode: Mode): Promise<Outcome> {
  const storageDir = mkdtempSync(join(tmpdir(), 's5b06-cost-'));
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
      if (mode === 'uncertain-retry' && calls === 1) {
        return new Response(JSON.stringify({ error: { message: 'PRIVATE_PROVIDER_MESSAGE' } }), { status: 503 });
      }
      // A 2xx whose finish_reason is 'length' (truncated) except on the uncertain-retry success.
      return new Response(
        JSON.stringify({
          id: `fake-${calls}`,
          model: 'muse-spark-1.3',
          choices: [
            {
              index: 0,
              finish_reason: mode === 'uncertain-retry' ? 'stop' : 'length',
              message: { role: 'assistant', content: DECLINE },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 16000 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };
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
      newJobId: () => JOB_ID,
      limits: {
        analysisMaxOutputTokens: LIMITS.analysisMaxOutputTokens,
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
      stderr: stderrLines.join('\n'),
    };
  } finally {
    console.error = realError;
    ledger.close();
  }
}

test('S5B-06: paid truncation + failing event write — job.json totals equal the ledger committed cost', async () => {
  // The reviewer's exact 'paid-error-event-write-fails' case.
  const { summary, jobJson, committedUSD, persistedBlob } = await runEventWriteFailure('paid-truncation');
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL', 'the broken event append surfaces as the last-resort INTERNAL');
  assert.ok(committedUSD > 0, `the ledger committed the truncated call (got ${committedUSD})`);
  assert.ok(
    Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
    `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD} (reviewer saw 0)`,
  );
  assert.equal(jobJson.totalCostUSD, summary.totalCostUSD);
  assert.equal(jobJson.reservedUnknownUSD, 0, 'the usage-based charge has no unknown portion');
  assert.ok(!persistedBlob.includes('PRIVATE_PROVIDER_MESSAGE'), 'no provider text is persisted (R-01)');
});

test('S5B-06: timeout + failing event write — the reservation-charged unknown amount survives in job.json', async () => {
  const { summary, jobJson, committedUSD, persistedBlob } = await runEventWriteFailure('timeout');
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

test('S5B-06: uncertain retry then success + failing event write — both attempts stay in job.json', async () => {
  const { summary, jobJson, committedUSD, persistedBlob } = await runEventWriteFailure('uncertain-retry');
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL');
  assert.ok(committedUSD > 0, `the ledger committed both attempts (got ${committedUSD})`);
  assert.ok(
    Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
    `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD}`,
  );
  assert.ok(jobJson.reservedUnknownUSD > 0, 'the 503 attempt reconciled at its reservation is unknown-outcome spend');
  assert.ok(
    jobJson.reservedUnknownUSD < jobJson.totalCostUSD,
    `unknown ${jobJson.reservedUnknownUSD} is only part of total ${jobJson.totalCostUSD}`,
  );
  assert.ok(!persistedBlob.includes('PRIVATE_PROVIDER_MESSAGE'), 'no provider text is persisted (R-01)');
});
