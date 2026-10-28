// BUG-002 — an unexpected exception AFTER billed model calls must keep the
// job's cost and record a diagnosable (but sanitised) cause.
//
// Live evidence: job-20261028093358-32686a4c failed INTERNAL right after the
// spec call returned; the ledger reconciled USD 0.0496 for its two calls but
// job.json reported totalCostUSD 0, and nothing recorded what had thrown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt, StageEvent } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function receipt(id: string, estCostUSD: number, usage: unknown): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: id,
    usage,
    latencyMs: 1,
    estCostUSD,
    finishReason: 'stop',
    attempts: 1,
  } as MetaReceipt;
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

/**
 * The spec receipt's usage is circular, so persisting the 'specify succeeded'
 * event throws — after both calls were billed and accounted.
 */
function clientThatBreaksAfterSpec(): MetaClient {
  const circularUsage: Record<string, unknown> = { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cachedTokens: 0 };
  circularUsage['self'] = circularUsage;
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as unknown as T, receipt: receipt('a1', 0.0129, { promptTokens: 1, completionTokens: 1, reasoningTokens: 0, cachedTokens: 0 }) };
      }
      return { data: genFixture as unknown as T, receipt: receipt('s1', 0.0367, circularUsage) };
    },
  };
}

test('BUG-002: an unexpected exception after billed calls keeps the accounted cost in job.json', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'bug002-cost-'));
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client: clientThatBreaksAfterSpec(), storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'INTERNAL');
  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.totalCostUSD, 0.0496, 'both billed receipts stay in the job summary');
  assert.equal(summary.totalCostUSD, 0.0496);
});

test('BUG-002: the last-resort event names the stage and a sanitised cause, never the raw message', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'bug002-cause-'));
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client: clientThatBreaksAfterSpec(), storageDir, purpose: 'test-live' });
  await done;
  const events = readEvents(storageDir, jobId);
  const last = events[events.length - 1];
  assert.equal(last?.stage, 'done');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.detail, 'INTERNAL; during specify; cause TypeError');
  assert.ok(!/circular|Converting/i.test(JSON.stringify(events)), 'no raw exception text is persisted (R-01)');
});
