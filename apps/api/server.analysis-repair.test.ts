// TASK-024b API tests — GET /api/jobs/:id exposes analysis revisions and
// summary.analysisRepairs after an analysis repair. Ephemeral server on
// 127.0.0.1:0, FAKE MetaClients, real repo sources read-only.
// No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const LONG_ID = 'velocity-and-displacement-under-constant-acceleration';

function badAnalysis(): SourceAnalysis {
  const bad = structuredClone(analysisFixture);
  const first = bad.concepts[0];
  assert.ok(first !== undefined);
  first.id = LONG_ID;
  return bad;
}

function fakeReceipt(responseId: string): MetaReceipt {
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

/** Analysis fails analysis.concept-ids; the first repair attempt returns the fixed fixture. */
function repairOnceAnalysisClient(): MetaClient {
  let repairs = 0;
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: badAnalysis() as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      if (req.schemaName === 'source_analysis_repair') {
        repairs += 1;
        return { data: analysisFixture as T, receipt: fakeReceipt(`fake-analysis-repair-${repairs}`) };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task024b-api-'));
}

async function withServer(storageDir: string, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApiServer({ storageDir, startJob: null });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
  try {
    await run(base);
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  }
}

interface AnalysisRevisionView {
  revision: number;
  analysis: unknown;
  report?: unknown;
  receipt?: unknown;
}

test('GET /api/jobs/:id serves analysis revisions and analysisRepairs after an analysis repair', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', {
    client: repairOnceAnalysisClient(),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishedRevision, 1);

  await withServer(storageDir, async base => {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = (await res.json()) as {
      summary: JobSummary;
      events: { stage: string; status: string; target?: string; revision?: number }[];
      analysis?: { analysis: SourceAnalysis };
      analysisRevisions: AnalysisRevisionView[];
    };
    // summary carries the analysis repair records
    assert.equal(job.summary.analysisRepairs?.length, 1);
    assert.deepEqual(job.summary.analysisRepairs?.[0], {
      attempt: 1,
      revision: 2,
      targeted: ['analysis.concept-ids'],
      fixed: ['analysis.concept-ids'],
      remaining: [],
      passed: true,
    });
    // every analysis revision is served, in order, with analysis + report + receipt
    assert.deepEqual(
      job.analysisRevisions.map(r => r.revision),
      [1, 2],
    );
    assert.deepEqual((job.analysisRevisions[0]?.analysis as SourceAnalysis).concepts[0]?.id, LONG_ID);
    assert.ok(job.analysisRevisions[0]?.report !== undefined);
    assert.ok(job.analysisRevisions[1]?.receipt !== undefined);
    // the analysis of record is the repaired one
    assert.deepEqual(job.analysis?.analysis, analysisFixture);
    // the timeline shows the analysis repair, tagged target=analysis
    assert.ok(job.events.some(e => e.stage === 'repair' && e.status === 'started' && e.target === 'analysis' && e.revision === 2));
    assert.ok(job.events.some(e => e.stage === 'repair' && e.status === 'succeeded' && e.target === 'analysis'));

    // The job list also carries analysisRepairs on the summary.
    const list = await fetch(`${base}/api/jobs`);
    const jobs = (await list.json()) as JobSummary[];
    const listed = jobs.find(j => j.jobId === jobId);
    assert.ok(listed !== undefined);
    assert.equal(listed.analysisRepairs?.length, 1);
  });
});

test('GET /api/jobs/:id for a first-try analysis keeps the old shape (no analysisRevisions files)', async () => {
  const storageDir = tempStorage();
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  await withServer(storageDir, async base => {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    const job = (await res.json()) as {
      summary: JobSummary;
      analysisRevisions: AnalysisRevisionView[];
      revisions: { revision: number }[];
    };
    assert.deepEqual(job.analysisRevisions, [], 'no analysis revisions were persisted');
    assert.deepEqual(job.summary.analysisRepairs, []);
    assert.equal(job.revisions.length, 1);
  });
});
