// TASK-009 Round 3 (F-01) — end-to-end regressions through the REAL stack:
// createMetaClient (fake fetch, loopback-free) → real openLedger in a temp dir
// (explicit free lockPort per test, never the shared/default port) → real
// pipeline → worker startJob → persisted job.json → real createApiServer GET.
//
// Reproduces the reviewer's P3 generated-content cases with the reviewer's numbers:
//   analysis message.content 'null', absent usage   → ledger retains $0.0326875
//   recorded analysis + spec 'null'/'{}'/'{"simulation":null}', absent usage
//                                                   → ledger retains $0.0788125
//   valid usage {prompt_tokens: 10, completion_tokens: 20} → $0.0000975 per call
// In every case the job total must equal ledger.committedUSD() within 1e-6 and the
// job must be persisted (and served) as failed/OUTPUT_INVALID — never 'running'.
//
// No network beyond loopback, no credits, no .env access, no live Meta calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import { startJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import { createMetaClient } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type { MetaReceipt, StageEvent } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const FAKE_KEY = 'LLM_F…_KEY'; // synthetic; never a real credential
/** Reviewer P3 valid usage: $0.0000975 per call at muse-spark-1.3 prices. */
const USAGE_REVIEWER = { prompt_tokens: 10, completion_tokens: 20 };
const USAGE_COST_PER_CALL = 0.0000975;
/** Reviewer P3 absent-usage reservations for this source/prompt/schema set. */
// Reservations follow the input bound (UTF-8 bytes of prompt + schema), so they change with prompts/schemas.
// Stage 5 analysis prompt (v4): four engines with appliesWhen texts, metadata in an untrusted JSON block.
const ANALYSIS_RESERVATION = 0.03759;
const BOTH_RESERVATIONS = 0.08471125;
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
const OUTPUT_INVALID_MESSAGE = 'The model returned output that does not match the required structure.';

interface Queued {
  status: number;
  body: unknown;
}

function queueFetch(queue: Queued[]): typeof fetch {
  return async (): Promise<Response> => {
    const next: Queued | undefined = queue.shift();
    if (next === undefined) {
      throw new Error('no queued response');
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

/** A structurally valid provider envelope whose content string is the test payload. */
function envelope(id: string, content: string, usage: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id,
    model: 'muse-spark-1.3',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
  };
  if (usage !== undefined) {
    body['usage'] = usage;
  }
  return body;
}

/**
 * An explicit free lockPort per test: listen on port 0, read the assigned port,
 * close. The ledger is then opened on that port so no test ever shares (or races
 * over) the configured 47853 or the path-hash default (F-02 debt rule).
 */
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

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

/** Serve the persisted run through the real API and return the GET /api/jobs/:id payload. */
async function getServedJob(
  storageDir: string,
  jobId: string,
): Promise<{ summary: JobSummary; events: StageEvent[] }> {
  const server: Server = createApiServer({ storageDir, startJob: null });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  try {
    const res = await fetch(`http://127.0.0.1:${(address as AddressInfo).port}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    return (await res.json()) as { summary: JobSummary; events: StageEvent[] };
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

interface RunResult {
  committedUSD: number;
  summary: JobSummary;
}

async function runInvalidOutputJob(opts: {
  responses: Queued[];
  expectStage: 'analyze' | 'specify';
  usagePresent: boolean;
}): Promise<RunResult> {
  const storageDir = mkdtempSync(join(tmpdir(), 'f01-e2e-'));
  const lockPort = await freeLockPort();
  const ledger: Ledger = await openLedger({
    path: join(storageDir, 'ledger.jsonl'),
    capUSD: 10,
    lockPort,
  });
  try {
    const client: MetaClient = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl: queueFetch(opts.responses),
      sleep: async () => {},
    });
    const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
      client,
      storageDir,
      purpose: 'test-live',
    });
    const summary: JobSummary = await done;
    const committedUSD: number = ledger.committedUSD();

    // The reviewer's core equality: the job total IS the ledger's committed amount.
    assert.equal(summary.status, 'failed');
    assert.deepEqual(summary.error, { code: 'OUTPUT_INVALID', message: OUTPUT_INVALID_MESSAGE });
    assert.ok(
      Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
      `job total ${summary.totalCostUSD} must equal ledger committed ${committedUSD} within 1e-6`,
    );
    if (opts.usagePresent) {
      assert.equal(summary.reservedUnknownUSD, 0, 'valid usage bills known amounts only');
    } else {
      assert.ok(
        Math.abs(summary.reservedUnknownUSD - committedUSD) <= 1e-6,
        `absent usage: the whole committed ${committedUSD} is reservation-unknown, got ${summary.reservedUnknownUSD}`,
      );
    }

    // Persisted job.json — a settled job is never left 'running' (F-01/R-10).
    const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
    assert.equal(jobJson.status, 'failed');
    assert.equal(jobJson.error?.code, 'OUTPUT_INVALID');
    assert.ok(jobJson.finishedAt !== undefined);
    assert.ok(
      Math.abs(jobJson.totalCostUSD - committedUSD) <= 1e-6,
      `job.json total ${jobJson.totalCostUSD} must equal ledger committed ${committedUSD}`,
    );

    // The failed-stage event carries the receipt fields and the fixed detail.
    const events = readEvents(storageDir, jobId);
    const failedEvent = events.find(e => e.stage === opts.expectStage && e.status === 'failed');
    assert.ok(failedEvent !== undefined, `${opts.expectStage} failed event exists`);
    assert.equal(
      failedEvent.detail,
      opts.usagePresent ? 'OUTPUT_INVALID' : 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)',
    );
    assert.equal(failedEvent.model, 'muse-spark-1.3');
    assert.equal(typeof failedEvent.latencyMs, 'number');
    assert.equal(typeof failedEvent.estCostUSD, 'number');
    assert.ok(!events.some(e => e.stage === 'done'), 'a failed job emits no done event');

    // The real API GET serves the same terminal state.
    const served = await getServedJob(storageDir, jobId);
    assert.equal(served.summary.status, 'failed');
    assert.deepEqual(served.summary.error, { code: 'OUTPUT_INVALID', message: OUTPUT_INVALID_MESSAGE });
    assert.ok(
      Math.abs(served.summary.totalCostUSD - committedUSD) <= 1e-6,
      `served total ${served.summary.totalCostUSD} must equal ledger committed ${committedUSD}`,
    );
    if (!opts.usagePresent) {
      assert.ok(Math.abs(served.summary.reservedUnknownUSD - committedUSD) <= 1e-6);
    }

    return { committedUSD, summary };
  } finally {
    ledger.close();
  }
}

test('F-01 P3(a): analysis content "null" with valid usage fails OUTPUT_INVALID; job total equals ledger ($0.0000975)', async () => {
  const { committedUSD } = await runInvalidOutputJob({
    responses: [{ status: 200, body: envelope('resp-null-analysis-usage', 'null', USAGE_REVIEWER) }],
    expectStage: 'analyze',
    usagePresent: true,
  });
  assert.ok(
    Math.abs(committedUSD - USAGE_COST_PER_CALL) < 1e-9,
    `reviewer per-call usage cost expected ${USAGE_COST_PER_CALL}, ledger committed ${committedUSD}`,
  );
});

test('F-01 P3(a): analysis content "null" with absent usage retains the reservation ($0.0326875)', async () => {
  const { committedUSD, summary } = await runInvalidOutputJob({
    responses: [{ status: 200, body: envelope('resp-null-analysis-reserved', 'null', undefined) }],
    expectStage: 'analyze',
    usagePresent: false,
  });
  assert.ok(
    Math.abs(committedUSD - ANALYSIS_RESERVATION) < 1e-9,
    `reviewer reservation expected ${ANALYSIS_RESERVATION}, ledger committed ${committedUSD}`,
  );
  assert.equal(summary.totalCostUSD, round6(ANALYSIS_RESERVATION), 'rounded to 1e-6 in job.json');
  assert.equal(summary.reservedUnknownUSD, round6(ANALYSIS_RESERVATION));
});

const specCases = ['null', '{}', '{"simulation":null}'] as const;
for (const specContent of specCases) {
  test(`F-01 P3(b): recorded analysis then spec content '${specContent}' with valid usage fails OUTPUT_INVALID; job total equals ledger ($0.000195)`, async () => {
    const { committedUSD } = await runInvalidOutputJob({
      responses: [
        { status: 200, body: envelope('resp-analysis-ok', JSON.stringify(analysisFixture), USAGE_REVIEWER) },
        { status: 200, body: envelope('resp-bad-spec', specContent, USAGE_REVIEWER) },
      ],
      expectStage: 'specify',
      usagePresent: true,
    });
    assert.ok(
      Math.abs(committedUSD - 2 * USAGE_COST_PER_CALL) < 1e-9,
      `reviewer two-call usage cost expected ${2 * USAGE_COST_PER_CALL}, ledger committed ${committedUSD}`,
    );
  });

  test(`F-01 P3(b): recorded analysis then spec content '${specContent}' with absent usage retains both reservations ($0.0788125)`, async () => {
    const { committedUSD, summary } = await runInvalidOutputJob({
      responses: [
        { status: 200, body: envelope('resp-analysis-ok-r', JSON.stringify(analysisFixture), undefined) },
        { status: 200, body: envelope('resp-bad-spec-r', specContent, undefined) },
      ],
      expectStage: 'specify',
      usagePresent: false,
    });
    assert.ok(
      Math.abs(committedUSD - BOTH_RESERVATIONS) < 1e-9,
      `reviewer reservations total expected ${BOTH_RESERVATIONS}, ledger committed ${committedUSD}`,
    );
    assert.equal(summary.totalCostUSD, round6(BOTH_RESERVATIONS), 'rounded to 1e-6 in job.json');
    assert.equal(summary.reservedUnknownUSD, round6(BOTH_RESERVATIONS));
  });
}

test('F-01: an unexpected exception after start persists failed/INTERNAL — job.json and GET never show running', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'f01-internal-'));
  // A receipt with a circular reference makes JSON.stringify throw when the worker
  // persists analysis.json — an unexpected exception AFTER the job started, which
  // reaches startJob's last-resort catch. That catch must still persist a terminal
  // state: the job may never stay 'running' after its promise settles.
  const receipt = {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: 'fake-circular',
    usage: null,
    latencyMs: 1,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  } as MetaReceipt;
  (receipt as unknown as Record<string, unknown>)['self'] = receipt;
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as unknown as T, receipt };
      }
      throw new Error('specify must not be reached');
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'INTERNAL', message: 'Unexpected internal error' });

  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.status, 'failed', 'job.json must not stay running after the promise settles');
  assert.equal(jobJson.error?.code, 'INTERNAL');
  assert.ok(jobJson.finishedAt !== undefined);

  const events = readEvents(storageDir, jobId);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'done');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.detail, 'INTERNAL; during analyze; cause TypeError', 'BUG-002: stage + sanitised cause');
  assert.equal(last?.seq, events.length - 1, 'the last-resort event continues the sequence');

  const served = await getServedJob(storageDir, jobId);
  assert.equal(served.summary.status, 'failed');
  assert.equal(served.summary.error?.code, 'INTERNAL');
});
