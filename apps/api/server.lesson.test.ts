// S6-W — lesson-flow API contract tests: POST /api/jobs `flow` (default 'lesson', 'activity'
// = v1, anything else 400 FLOW_INVALID), GET /api/jobs/:id lesson detail fields, and list
// summaries carrying flow + lesson progress. Ephemeral server on 127.0.0.1:0, real worker
// with a FAKE MetaClient and the Stage 6 goldens. No network beyond localhost, no credits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApiServer } from './server.ts';
import type { ApiOptions } from './server.ts';
import { startJob as realStartJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';

const usableAnalysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/source-analysis-v2.usable.json', import.meta.url), 'utf8'),
);
const quizGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/quiz-cards.gen.json', import.meta.url), 'utf8'),
);
const feGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/stage6/formula-explorer.gen.json', import.meta.url), 'utf8'),
);
const v1Analysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
);
const v1Gen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
);

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

function fakeClient(): MetaClient {
  return {
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      let data: unknown;
      switch (req.schemaName) {
        case 'source_analysis_v2': data = usableAnalysis; break;
        case 'quiz_cards': data = quizGen; break;
        case 'formula_explorer': data = feGen; break;
        case 'source_analysis': data = v1Analysis; break;
        default: data = v1Gen;
      }
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`resp-${req.schemaName}`) };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's6w-api-'));
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

async function getJson(base: string, path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

async function postJson(base: string, path: string, body: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/* ------------------------------------------------------------------ */
/* POST /api/jobs flow                                                  */
/* ------------------------------------------------------------------ */

test('POST /api/jobs: flow defaults to lesson, accepts activity, rejects anything else with 400 FLOW_INVALID', async () => {
  const started: { sourceId: string; opts?: { demoFault?: string; model?: string; flow?: string } }[] = [];
  const fakeStart: NonNullable<ApiOptions['startJob']> = (sourceId, opts) => {
    started.push({ sourceId, opts });
    return { jobId: `job-fake-${started.length}`, done: Promise.resolve({} as JobSummary) };
  };
  await withServer({ storageDir: tempStorage(), startJob: fakeStart }, async base => {
    // Absent → the frozen product default 'lesson'.
    const dflt = await postJson(base, '/api/jobs', { sourceId: 'nasa-grc-drag-equation' });
    assert.equal(dflt.status, 202);
    assert.equal(started[0]?.opts?.flow, 'lesson');
    // Explicit flows.
    const lesson = await postJson(base, '/api/jobs', { sourceId: 'nasa-grc-drag-equation', flow: 'lesson' });
    assert.equal(lesson.status, 202);
    assert.equal(started[1]?.opts?.flow, 'lesson');
    const activity = await postJson(base, '/api/jobs', { sourceId: 'nasa-grc-drag-equation', flow: 'activity' });
    assert.equal(activity.status, 202);
    assert.equal(started[2]?.opts?.flow, 'activity');
    // demoFault + model still travel alongside the flow.
    const both = await postJson(base, '/api/jobs', {
      sourceId: 'nasa-grc-drag-equation', flow: 'activity', demoFault: 'wrong-answer', model: 'muse-spark-1.3',
    });
    assert.equal(both.status, 202);
    assert.equal(started[3]?.opts?.demoFault, 'wrong-answer');
    assert.equal(started[3]?.opts?.model, 'muse-spark-1.3');
    // Unknown flows → 400 FLOW_INVALID, nothing started.
    for (const bad of ['v2', '', 1, null, ['lesson']]) {
      const res = await postJson(base, '/api/jobs', { sourceId: 'nasa-grc-drag-equation', flow: bad });
      assert.equal(res.status, 400);
      assert.deepEqual(res.body, { error: 'FLOW_INVALID' });
    }
    assert.equal(started.length, 4, 'no job was started for a rejected flow');
  });
});

/* ------------------------------------------------------------------ */
/* GET detail + list for a real lesson job                              */
/* ------------------------------------------------------------------ */

test('GET /api/jobs/:id serves the frozen lesson detail; the list carries flow + lesson progress', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = realStartJob('nasa-grc-drag-equation', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => 'lesson-api-00000001',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');

  await withServer({ storageDir, startJob: null }, async base => {
    const detail = await getJson(base, `/api/jobs/${jobId}`);
    assert.equal(detail.status, 200);
    const body = detail.body;
    // Summary: flow + lesson progress.
    assert.equal(body.summary.flow, 'lesson');
    assert.deepEqual(body.summary.lesson, {
      overviewReady: true, componentsPlanned: 2, componentsPublished: 2, componentsFailed: 0, partialPublish: false,
    });
    // Frozen lesson detail fields.
    assert.deepEqual(body.analysisV2, usableAnalysis);
    assert.equal(body.analysisV2Report.publishable, true);
    assert.deepEqual(body.analysisV2Revisions.map((r: { revision: number }) => r.revision), [1]);
    assert.equal(body.lesson.overview.componentId, 'overview-v1');
    assert.equal(body.lesson.components.length, 2);
    assert.deepEqual(Object.keys(body.kitSpecs).sort(), [
      `${jobId}:formula-explorer-v1:r1`, `${jobId}:quiz-cards-v1:r1`,
    ]);
    assert.deepEqual(Object.keys(body.componentReports).sort(), [
      `${jobId}:formula-explorer-v1:r1`, `${jobId}:quiz-cards-v1:r1`,
    ]);
    assert.deepEqual(body.componentRepairs, []);
    // Events carry the two new stages with componentId + revision.
    const stages = body.events.map((e: { stage: string }) => e.stage);
    assert.ok(stages.includes('overview'));
    assert.ok(stages.includes('component'));
    const compEvents = body.events.filter((e: { stage: string }) => e.stage === 'component');
    assert.ok(compEvents.every((e: { componentId?: string; revision?: number }) => typeof e.componentId === 'string' && e.revision === 1));

    // The list summary carries flow + lesson.
    const list = await getJson(base, '/api/jobs');
    assert.equal(list.status, 200);
    const row = (list.body as any[]).find(j => j.jobId === jobId);
    assert.equal(row?.flow, 'lesson');
    assert.equal(row?.lesson?.componentsPublished, 2);
  });
});

test('GET /api/jobs/:id for an activity job and a legacy record: no lesson fields, flow reads activity', async () => {
  const storageDir = tempStorage();
  // A real v1 job through the same worker entry point (flow omitted → 'activity').
  const { jobId, done } = realStartJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
    newJobId: () => 'activity-api-0000001',
  });
  await done;
  // A hand-written pre-Stage-6 record with no flow field at all.
  const legacyDir = join(storageDir, 'runs', 'legacy-job-00000001');
  mkdirSync(legacyDir, { recursive: true });
  writeFileSync(
    join(legacyDir, 'job.json'),
    JSON.stringify({
      jobId: 'legacy-job-00000001',
      sourceId: 'nasa-grc-equations-of-motion',
      status: 'succeeded',
      purpose: 'test-live',
      createdAt: new Date().toISOString(),
      totalCostUSD: 0.02,
      reservedUnknownUSD: 0,
      engine: 'forces-1d-v1',
      revisions: 1,
      repairs: [],
      sourceKind: 'library',
    }),
  );

  await withServer({ storageDir, startJob: null }, async base => {
    const activity = await getJson(base, `/api/jobs/${jobId}`);
    assert.equal(activity.status, 200);
    assert.equal(activity.body.summary.flow, 'activity');
    for (const key of ['analysisV2', 'analysisV2Report', 'analysisV2Revisions', 'lesson', 'kitSpecs', 'componentReports', 'componentRepairs']) {
      assert.equal(key in activity.body, false, `activity detail must not carry ${key}`);
    }
    assert.ok(activity.body.spec !== undefined, 'the v1 detail is unchanged');

    const legacy = await getJson(base, '/api/jobs/legacy-job-00000001');
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.summary.flow, 'activity', 'a legacy record reads as the v1 flow');

    const list = await getJson(base, '/api/jobs');
    const flows = Object.fromEntries((list.body as any[]).map(j => [j.jobId, j.flow]));
    assert.deepEqual(flows, { [jobId]: 'activity', 'legacy-job-00000001': 'activity' });
  });
});
