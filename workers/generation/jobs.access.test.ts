// Stage 10 slice A — the optional `access: 'judge'` tag on the stored job record.
// Written from the FIRST job.json write, survives the terminal rewrite, and is absent
// (key not even present) for every job started without it. FAKE MetaClient; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob, listJobs } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

function receipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

function fakeClient(): MetaClient {
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: receipt('fake-analysis-1') };
      }
      return { data: genFixture as T, receipt: receipt('fake-gen-1') };
    },
  };
}

function readJobFile(storageDir: string, jobId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as Record<string, unknown>;
}

test("deps.access 'judge' is recorded in the very first job.json write and kept at the end", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'stage10-jobs-access-'));
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
    access: 'judge',
  });
  // startJob writes job.json synchronously before returning, so this is the first write
  assert.equal(readJobFile(storageDir, jobId)['access'], 'judge');
  assert.equal(readJobFile(storageDir, jobId)['status'], 'running');
  const summary = await done;
  assert.equal(summary.access, 'judge');
  assert.equal(readJobFile(storageDir, jobId)['access'], 'judge');
  assert.equal(listJobs(storageDir)[0]?.access, 'judge');
});

test('without deps.access the stored record has no access key at all (unchanged shape)', async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'stage10-jobs-noaccess-'));
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
  });
  await done;
  assert.equal('access' in readJobFile(storageDir, jobId), false);
});

test("only the literal 'judge' is ever stored; any other value is ignored", async () => {
  const storageDir = mkdtempSync(join(tmpdir(), 'stage10-jobs-badaccess-'));
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
    access: 'operator' as unknown as 'judge',
  });
  await done;
  assert.equal('access' in readJobFile(storageDir, jobId), false);
});
