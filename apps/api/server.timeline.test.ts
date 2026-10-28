// TASK-023a — API integration for timeline-v1: the API serves a worker-produced timeline
// job unchanged in shape (job.engine = 'timeline-v1') and accepts demo-fault job bodies for
// timeline sources. Ephemeral server on 127.0.0.1:0, FAKE MetaClients, real repo sources
// read-only. No network beyond localhost, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt, SourceAnalysis, TimelineGeneratedSpec } from '../../packages/contracts/index.ts';

const SOURCE_ID = 'nara-declaration-of-independence';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.analysis.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
) as TimelineGeneratedSpec;

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

/** Fake client: clean timeline analysis + spec (publishable on revision 1), or one repair when asked. */
function timelineClient(opts: { badRev1?: boolean } = {}): MetaClient {
  const bad = structuredClone(genFixture);
  const e1 = bad.simulation.events[0];
  if (e1 !== undefined) {
    e1.year = 1775; // a year the quote and title do not state → timeline.date-grounded fails
  }
  let repairs = 0;
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: structuredClone(analysisFixture) as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      if (req.schemaName === 'activity_spec') {
        return {
          data: (opts.badRev1 === true ? bad : structuredClone(genFixture)) as unknown as T,
          receipt: fakeReceipt('fake-gen-1'),
        };
      }
      repairs += 1;
      return { data: structuredClone(genFixture) as unknown as T, receipt: fakeReceipt(`fake-repair-${repairs}`) };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task023a-api-'));
}

async function withServer(opts: ApiOptions, run: (base: string) => Promise<void>): Promise<void> {
  const server: Server = createApiServer(opts);
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

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

interface JobDetailBody {
  summary: JobSummary;
  events: { stage: string; status: string; revision?: number; detail?: string }[];
  analysis?: { analysis: { activity: string } };
  revisions: { revision: number; spec: any; report?: any }[];
  spec?: any;
  report?: any;
}

test('GET /api/jobs/:id serves a timeline job with engine timeline-v1, unchanged in shape', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob(SOURCE_ID, {
    client: timelineClient(),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.engine, 'timeline-v1');
  assert.equal(summary.publishedRevision, 1);

  await withServer({ storageDir, startJob: null }, async base => {
    const res = await fetch(`${base}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = (await res.json()) as JobDetailBody;
    assert.equal(job.summary.engine, 'timeline-v1');
    assert.equal(job.summary.status, 'succeeded');
    assert.equal(job.summary.publishable, true);
    assert.equal(job.summary.publishedRevision, 1);
    assert.equal(job.summary.sourceId, SOURCE_ID);
    assert.equal(job.summary.sourceKind, 'library');
    assert.equal(job.summary.checksPassed, job.summary.checksTotal);
    assert.equal(job.analysis?.analysis.activity, 'timeline-v1');
    assert.equal(job.revisions.length, 1);
    assert.equal(job.revisions[0]?.revision, 1);
    assert.equal(job.spec?.simulation?.engine, 'timeline-v1');
    assert.equal(job.spec?.simulation?.events?.length, 6);
    assert.equal(job.report?.publishable, true);
    assert.deepEqual(job.spec, job.revisions[0]?.spec, 'compatibility field points at the published revision');
    assert.ok(job.events.some(e => e.stage === 'done' && e.status === 'succeeded'));

    const list = (await (await fetch(`${base}/api/jobs`)).json()) as JobSummary[];
    const listed = list.find(j => j.jobId === jobId);
    assert.ok(listed !== undefined, 'the timeline job appears in GET /api/jobs');
    assert.equal(listed.engine, 'timeline-v1');
  });
});

test('POST /api/jobs with demoFault runs a timeline job end to end and the API serves the labelled fault', async () => {
  const storageDir = tempStorage();
  let donePromise: Promise<JobSummary> | null = null;
  const start: NonNullable<ApiOptions['startJob']> = (sourceId, opts) => {
    const started = realStartJob(sourceId, {
      client: timelineClient(),
      storageDir,
      purpose: 'demo',
      ...(opts?.demoFault !== undefined ? { demoFault: opts.demoFault } : {}),
    });
    donePromise = started.done;
    return started;
  };
  await withServer({ storageDir, startJob: start }, async base => {
    const post = await postJson(base, '/api/jobs', { sourceId: SOURCE_ID, demoFault: 'wrong-answer' });
    assert.equal(post.status, 202);
    const jobId = post.body.jobId as string;
    assert.ok(donePromise !== null);
    const summary = await (donePromise as Promise<JobSummary>);
    assert.equal(summary.status, 'succeeded');
    assert.equal(summary.publishedRevision, 2, 'the injected fault forces the repair path');

    const res = await fetch(`${base}/api/jobs/${jobId}`);
    assert.equal(res.status, 200);
    const job = (await res.json()) as JobDetailBody;
    assert.equal(job.summary.engine, 'timeline-v1');
    assert.equal(job.summary.demoFault?.kind, 'wrong-answer');
    assert.equal(job.summary.demoFault?.effective, true, 'the catch is demonstrated, not just injected');
    assert.equal(job.summary.demoFault?.revision, 1);
    assert.equal(job.summary.repairs.length, 1);
    assert.equal(job.summary.repairs[0]?.afterInjectedFault, true);
    assert.deepEqual(job.summary.repairs[0]?.targeted, ['timeline.case-order']);
    assert.equal(job.revisions.length, 2);
    assert.ok(job.events.some(e => e.stage === 'inject' && e.status === 'succeeded' && e.revision === 1));
  });
});
