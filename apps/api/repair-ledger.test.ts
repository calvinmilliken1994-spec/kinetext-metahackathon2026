// Stage 5 TASK-015 — repair-loop cost accounting through the REAL stack:
// createMetaClient (fake fetch, loopback-free) → real openLedger in a temp dir
// (explicit free lockPort) → real pipeline (analyze → specify → repairSpec) →
// worker startJob → persisted job.json. The job total must equal the ledger's
// committed amount within 1e-6, both for a repair that publishes and for a
// repair whose OUTPUT is invalid (GeneratedOutputError on 'repair', F-01).
//
// No network beyond loopback, no credits, no .env access, no live Meta calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { startJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import { createMetaClient } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type { GeneratedSpec, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const LIMITS = JSON.parse(readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8')) as { maxInputTokens: number };
const FAKE_KEY = 'LLM_F…_KEY'; // synthetic; never a real credential
/** Reviewer P3 valid usage: $0.0000975 per call at muse-spark-1.3 prices. */
const USAGE_REVIEWER = { prompt_tokens: 10, completion_tokens: 20 };
const USAGE_COST_PER_CALL = 0.0000975;

/** genFixture with a wrong first behavioral-test answer → 'behavior.tests' fails. */
function wrongFirstAnswer(): GeneratedSpec {
  const bad = structuredClone(genFixture) as GeneratedSpec & { behavioralTests: Record<string, unknown>[] };
  bad.behavioralTests[0]['expectedAccelerationMps2'] = 99;
  return bad as unknown as GeneratedSpec;
}

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

/** An explicit free lockPort per test so nothing ever shares the configured 47853. */
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

async function runRepairJob(responses: Queued[]): Promise<{ summary: JobSummary; committedUSD: number }> {
  const storageDir = mkdtempSync(join(tmpdir(), 'task015-ledger-'));
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
      // Same input cap as apps/api/main.ts: repair prompts exceed the client's 16000 default.
      maxInputTokens: LIMITS.maxInputTokens,
      fetchImpl: queueFetch(responses),
      sleep: async () => {},
    });
    const { done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
    const summary: JobSummary = await done;
    return { summary, committedUSD: ledger.committedUSD() };
  } finally {
    ledger.close();
  }
}

test('repair that publishes: job total equals the real ledger across analysis + spec + repair', async () => {
  const { summary, committedUSD } = await runRepairJob([
    { status: 200, body: envelope('resp-analysis-ok', JSON.stringify(analysisFixture), USAGE_REVIEWER) },
    { status: 200, body: envelope('resp-bad-spec', JSON.stringify(wrongFirstAnswer()), USAGE_REVIEWER) },
    { status: 200, body: envelope('resp-good-repair', JSON.stringify(genFixture), USAGE_REVIEWER) },
  ]);
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 2);
  assert.equal(summary.revisions, 2);
  assert.equal(summary.repairs.length, 1);
  assert.equal(summary.repairs[0]?.publishable, true);
  assert.ok(
    Math.abs(committedUSD - 3 * USAGE_COST_PER_CALL) < 1e-9,
    `three usage-billed calls expected ${3 * USAGE_COST_PER_CALL}, ledger committed ${committedUSD}`,
  );
  assert.ok(
    Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
    `job total ${summary.totalCostUSD} must equal ledger committed ${committedUSD} within 1e-6`,
  );
  assert.equal(summary.reservedUnknownUSD, 0, 'valid usage bills known amounts only');
});

test('repair with invalid output: the repair receipt still lands in the ledger and the job fails VALIDATION_FAILED', async () => {
  const { summary, committedUSD } = await runRepairJob([
    { status: 200, body: envelope('resp-analysis-ok-2', JSON.stringify(analysisFixture), USAGE_REVIEWER) },
    { status: 200, body: envelope('resp-bad-spec-2', JSON.stringify(wrongFirstAnswer()), USAGE_REVIEWER) },
    // The repair call completes but its content fails the gen schema → GeneratedOutputError('repair').
    { status: 200, body: envelope('resp-bad-repair', '{}', USAGE_REVIEWER) },
  ]);
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, {
    code: 'VALIDATION_FAILED',
    message: 'generated spec failed validation',
  });
  assert.equal(summary.revisions, 1, 'the invalid repair produced no revision');
  assert.equal(summary.bestRevision, 1);
  assert.ok(
    Math.abs(committedUSD - 3 * USAGE_COST_PER_CALL) < 1e-9,
    `the completed repair call is committed to the ledger: ${committedUSD}`,
  );
  assert.ok(
    Math.abs(summary.totalCostUSD - committedUSD) <= 1e-6,
    `job total ${summary.totalCostUSD} must equal ledger committed ${committedUSD} (F-01 accounting)`,
  );
  assert.equal(summary.reservedUnknownUSD, 0);
});
