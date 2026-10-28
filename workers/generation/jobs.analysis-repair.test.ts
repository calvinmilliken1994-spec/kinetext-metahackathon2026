// TASK-024b worker tests — bounded analysis check-then-repair loop wired to
// Muse's repairAnalysis. All against FAKE MetaClients and recorded fixtures.
// No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { AnalysisRepairRecord, JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type {
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
  ValidationReport,
} from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

/** 53-char concept id — the genuine Muse error from the Stage 5b evaluation (analysis.concept-ids). */
const LONG_ID = 'velocity-and-displacement-under-constant-acceleration';

/** The recorded analysis with one over-long concept id: fails analysis.concept-ids only. */
function badAnalysis(): SourceAnalysis {
  const bad = structuredClone(analysisFixture);
  const first = bad.concepts[0];
  assert.ok(first !== undefined);
  first.id = LONG_ID;
  return bad;
}

/** A decline Muse could return to escape a finding (validateAnalysis-publishable on its own). */
function declineAnalysis(): SourceAnalysis {
  return {
    supported: false,
    activity: 'none',
    unsupportedReason: 'The source teaches motion under a constant net force but no listed activity fits its teaching.',
    concepts: [],
    objectives: [],
  } as unknown as SourceAnalysis;
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

interface AnalysisRepairClientOptions {
  /** Revision-1 analysis; defaults to the 53-char-concept-id failure. */
  analysis?: unknown;
  /** One payload per 'source_analysis_repair' call (shifted); the last one repeats. */
  repairs?: unknown[];
}

/** Fake client dispatching on schemaName, recording every request. */
function analysisRepairClient(opts: AnalysisRepairClientOptions = {}): {
  client: MetaClient;
  requests: CompleteRequest[];
  analysisRepairRequests: () => CompleteRequest[];
  analysisRepairCount: () => number;
} {
  const requests: CompleteRequest[] = [];
  const repairQueue = [...(opts.repairs ?? [])];
  let repairCalls = 0;
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      requests.push(req);
      if (req.schemaName === 'source_analysis') {
        return { data: (opts.analysis ?? badAnalysis()) as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      if (req.schemaName === 'source_analysis_repair') {
        repairCalls += 1;
        const data: unknown = repairQueue.length > 1 ? repairQueue.shift() : repairQueue[0];
        return { data: data as T, receipt: fakeReceipt(`fake-analysis-repair-${repairCalls}`) };
      }
      if (req.schemaName === 'activity_spec') {
        return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
      }
      throw new Error(`unexpected schemaName in analysis-repair test: ${req.schemaName}`);
    },
  };
  return {
    client,
    requests,
    analysisRepairRequests: (): CompleteRequest[] =>
      requests.filter(r => r.schemaName === 'source_analysis_repair'),
    analysisRepairCount: (): number => repairCalls,
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task024b-jobs-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/* ------------------------------------------------------------------ */
/* (a) attempt 1 fixes the finding → the job continues and publishes    */
/* ------------------------------------------------------------------ */

test('analysis repair: a 53-char concept id is fixed by attempt 1 and the job publishes', async () => {
  const storageDir = tempStorage();
  const { client, requests, analysisRepairCount } = analysisRepairClient({ repairs: [analysisFixture] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishable, true);
  assert.equal(summary.publishedRevision, 1, 'the SPEC still publishes on revision 1');
  assert.equal(summary.revisions, 1);
  assert.equal(summary.engine, 'forces-1d-v1');
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + analysis repair + spec receipts');
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.equal(summary.error, undefined);
  assert.equal(analysisRepairCount(), 1, 'the loop stops at the first publishable analysis');
  assert.deepEqual(summary.repairs, [], 'no spec repairs happened');

  assert.equal(summary.analysisRepairs?.length, 1);
  const record: AnalysisRepairRecord | undefined = summary.analysisRepairs?.[0];
  assert.deepEqual(record, {
    attempt: 1,
    revision: 2,
    targeted: ['analysis.concept-ids'],
    fixed: ['analysis.concept-ids'],
    remaining: [],
    passed: true,
  });

  const runDir = join(storageDir, 'runs', jobId);
  // Persisted revisions: r1 = the immutable original, r2 = attempt 1's result.
  for (const f of ['analysis.r1.json', 'analysis.r2.json', 'analysis.json', 'spec.r1.json', 'report.r1.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  const r1 = readJson(join(runDir, 'analysis.r1.json')) as { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  assert.equal(r1.analysis.concepts[0]?.id, LONG_ID, 'analysis.r1 keeps the failing original');
  assert.equal(r1.report.publishable, false);
  assert.equal(r1.receipt.responseId, 'fake-analysis-1');
  const r2 = readJson(join(runDir, 'analysis.r2.json')) as { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  assert.deepEqual(r2.analysis, analysisFixture);
  assert.equal(r2.report.publishable, true);
  assert.equal(r2.report.revision, 2);
  assert.equal(r2.receipt.responseId, 'fake-analysis-repair-1');
  // The repaired analysis becomes the analysis of record.
  const finalFile = readJson(join(runDir, 'analysis.json')) as { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
  assert.deepEqual(finalFile.analysis, analysisFixture);
  assert.equal(finalFile.report.publishable, true);
  assert.equal(finalFile.receipt.responseId, 'fake-analysis-repair-1');

  // Events: the analysis repair is a 'repair' event carrying target 'analysis'.
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    [
      'ingest:started',
      'ingest:succeeded',
      'analyze:started',
      'repair:started',
      'repair:succeeded',
      'analyze:succeeded',
      'specify:started',
      'specify:succeeded',
      'validate:started',
      'validate:succeeded',
      'done:succeeded',
    ],
  );
  const repairStarted = events.find(e => e.stage === 'repair' && e.status === 'started');
  assert.equal(repairStarted?.target, 'analysis');
  assert.equal(repairStarted?.revision, 2);
  assert.equal(repairStarted?.detail, `analysis repair 1; targeted checks: analysis.concept-ids`);
  const repairOk = events.find(e => e.stage === 'repair' && e.status === 'succeeded');
  assert.equal(repairOk?.target, 'analysis');
  assert.equal(repairOk?.revision, 2);
  assert.equal(repairOk?.responseId, 'fake-analysis-repair-1');
  assert.equal(repairOk?.estCostUSD, 0.01);
  const analyzeOk = events.find(e => e.stage === 'analyze' && e.status === 'succeeded');
  assert.equal(analyzeOk?.responseId, 'fake-analysis-1', 'analyze:succeeded keeps the analyze call receipt');
  assert.match(analyzeOk?.detail ?? '', /^supported; checks 7\/7 passed$/, 'the repaired report includes repair.analysis-unchanged');

  // R-11: the repair call shares the job deadline signal and uses the ANALYSIS output cap.
  const repairReq = requests.find(r => r.schemaName === 'source_analysis_repair');
  assert.ok(repairReq !== undefined);
  assert.ok(repairReq.signal !== undefined, 'budget.signal is forwarded');
  assert.equal(repairReq.maxOutputTokens, 6000, 'the analysis output cap covers analysis repairs');

  // readJob exposes the analysis revisions and the summary records.
  const full = readJob(storageDir, jobId);
  assert.ok(full !== null);
  assert.deepEqual(
    full.analysisRevisions.map(r => r.revision),
    [1, 2],
  );
  assert.deepEqual(full.analysisRevisions[0]?.analysis, r1.analysis);
  assert.deepEqual(full.analysisRevisions[1]?.report, r2.report);
  assert.ok(full.analysisRevisions[1]?.receipt !== undefined);
  assert.equal(full.summary.analysisRepairs?.length, 1);
  assert.deepEqual(full.analysis, finalFile);
});

/* ------------------------------------------------------------------ */
/* (b) both attempts fail → ANALYSIS_INVALID, both receipts accounted   */
/* ------------------------------------------------------------------ */

test('analysis repair: two failing attempts end ANALYSIS_INVALID with every receipt accounted', async () => {
  const storageDir = tempStorage();
  const unchangedBad = badAnalysis();
  const { client, analysisRepairCount } = analysisRepairClient({ repairs: [unchangedBad] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'ANALYSIS_INVALID', message: 'analysis failed validation' });
  assert.equal(analysisRepairCount(), 2, 'exactly maxRepairAttempts (default 2) analysis repair calls');
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + two repair receipts');
  assert.equal(summary.engine, null);
  assert.equal(summary.specId, undefined);
  assert.equal(summary.analysisRepairs?.length, 2);
  assert.deepEqual(summary.analysisRepairs?.[0], {
    attempt: 1,
    revision: 2,
    targeted: ['analysis.concept-ids'],
    fixed: [],
    remaining: ['analysis.concept-ids'],
    passed: false,
  });
  assert.equal(summary.analysisRepairs?.[1]?.attempt, 2);
  assert.equal(summary.analysisRepairs?.[1]?.revision, 3);
  assert.equal(summary.analysisRepairs?.[1]?.passed, false);

  const runDir = join(storageDir, 'runs', jobId);
  for (const f of ['analysis.r1.json', 'analysis.r2.json', 'analysis.r3.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  assert.ok(!existsSync(join(runDir, 'spec.r1.json')), 'specify never runs');
  // analysis.json stays the revision-1 analysis for a failed job.
  const finalFile = readJson(join(runDir, 'analysis.json')) as { analysis: SourceAnalysis; report: ValidationReport };
  assert.equal(finalFile.analysis.concepts[0]?.id, LONG_ID);
  assert.equal(finalFile.report.publishable, false);

  const events = readEvents(storageDir, jobId);
  assert.ok(!events.some(e => e.stage === 'specify'));
  assert.ok(!events.some(e => e.stage === 'done'));
  const repairEvents = events.filter(e => e.stage === 'repair');
  assert.deepEqual(
    repairEvents.map(e => `${e.status}:${e.target}:${e.revision}`),
    ['started:analysis:2', 'succeeded:analysis:2', 'started:analysis:3', 'succeeded:analysis:3'],
    'each attempt is a repair pair tagged target=analysis',
  );
  const failedAnalyze = events.find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.ok(failedAnalyze !== undefined);
  assert.equal(failedAnalyze.detail, 'ANALYSIS_INVALID');
  assert.equal(failedAnalyze.responseId, 'fake-analysis-repair-2', 'the failure event carries the last analysis call receipt');
});

/* ------------------------------------------------------------------ */
/* (c) maxRepairAttempts 0 keeps today's behaviour                      */
/* ------------------------------------------------------------------ */

test('analysis repair: maxRepairAttempts 0 fails ANALYSIS_INVALID immediately (today\'s behaviour)', async () => {
  const storageDir = tempStorage();
  const { client, analysisRepairCount } = analysisRepairClient({ repairs: [analysisFixture] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 0 },
  });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'ANALYSIS_INVALID', message: 'analysis failed validation' });
  assert.equal(analysisRepairCount(), 0, 'no repair call at all');
  assert.equal(summary.totalCostUSD, 0.01, 'only the analysis receipt');
  assert.deepEqual(summary.analysisRepairs, []);
  const runDir = join(storageDir, 'runs', jobId);
  assert.ok(existsSync(join(runDir, 'analysis.json')));
  assert.ok(!existsSync(join(runDir, 'analysis.r1.json')), 'no revision files without a repair attempt');
  assert.ok(!existsSync(join(runDir, 'analysis.r2.json')));
  const events = readEvents(storageDir, jobId);
  assert.ok(!events.some(e => e.stage === 'repair'));
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    ['ingest:started', 'ingest:succeeded', 'analyze:started', 'analyze:failed'],
  );
  const failedAnalyze = events.find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedAnalyze?.responseId, 'fake-analysis-1');
  assert.equal(failedAnalyze?.estCostUSD, 0.01);
});

test('analysis repair: maxRepairAttempts 1 makes exactly one attempt', async () => {
  const storageDir = tempStorage();
  const { client, analysisRepairCount } = analysisRepairClient({ repairs: [badAnalysis()] });
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 1 },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'ANALYSIS_INVALID');
  assert.equal(analysisRepairCount(), 1);
  assert.equal(summary.analysisRepairs?.length, 1);
  assert.equal(summary.totalCostUSD, 0.02);
});

/* ------------------------------------------------------------------ */
/* (d) attempt 2 receives the immutable revision-1 baseline             */
/* ------------------------------------------------------------------ */

test('analysis repair: attempt 2 passes the revision-1 baseline and can still succeed', async () => {
  const storageDir = tempStorage();
  const { client, analysisRepairRequests } = analysisRepairClient({
    repairs: [badAnalysis(), analysisFixture],
  });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(analysisRepairRequests().length, 2);
  assert.equal(summary.analysisRepairs?.length, 2);
  assert.equal(summary.analysisRepairs?.[0]?.passed, false);
  assert.equal(summary.analysisRepairs?.[1]?.passed, true);
  assert.equal(summary.analysisRepairs?.[1]?.revision, 3);
  assert.equal(summary.totalCostUSD, 0.04, 'analysis + two repairs + spec');

  const userOf = (req: CompleteRequest): string => req.messages[1]?.content ?? '';
  const [first, second] = analysisRepairRequests();
  assert.ok(first !== undefined && second !== undefined);
  assert.ok(!userOf(first).includes('originalAnalysis'), 'attempt 1 carries no baseline');
  assert.ok(userOf(second).includes('originalAnalysis'), 'attempt 2 carries the revision-1 baseline');
  assert.ok(userOf(second).includes(LONG_ID), 'the baseline block contains the original failing id');

  const runDir = join(storageDir, 'runs', jobId);
  for (const f of ['analysis.r1.json', 'analysis.r2.json', 'analysis.r3.json']) {
    assert.ok(existsSync(join(runDir, f)), `${f} should exist`);
  }
  const r3 = readJson(join(runDir, 'analysis.r3.json')) as { analysis: SourceAnalysis; report: ValidationReport };
  assert.deepEqual(r3.analysis, analysisFixture);
  assert.equal(r3.report.revision, 3);
  assert.equal(r3.report.publishable, true);
});

/* ------------------------------------------------------------------ */
/* (e) declining to escape the finding is rejected, never 'unsupported' */
/* ------------------------------------------------------------------ */

test('analysis repair: flipping to a decline fails repair.analysis-unchanged and the job never ends unsupported', async () => {
  const storageDir = tempStorage();
  const { client, analysisRepairCount } = analysisRepairClient({ repairs: [declineAnalysis()] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 1 },
  });
  const summary = await done;

  assert.equal(summary.status, 'failed', 'a decline-escape is a failure, never an honest unsupported');
  assert.deepEqual(summary.error, { code: 'ANALYSIS_INVALID', message: 'analysis failed validation' });
  assert.equal(analysisRepairCount(), 1);
  assert.equal(summary.engine, null);
  assert.equal(summary.analysisRepairs?.length, 1);
  const record = summary.analysisRepairs?.[0];
  assert.equal(record?.passed, false);
  assert.deepEqual(record?.remaining, ['repair.analysis-unchanged'], 'the escape is caught by the unchanged check');
  assert.deepEqual(record?.targeted, ['analysis.concept-ids']);

  const events = readEvents(storageDir, jobId);
  assert.ok(!events.some(e => e.stage === 'done'), 'a failed job never emits done');
  const failedAnalyze = events.find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedAnalyze?.detail, 'ANALYSIS_INVALID');
  // The analysis of record stays the revision-1 analysis; the decline is only kept as a revision.
  const runDir = join(storageDir, 'runs', jobId);
  const finalFile = readJson(join(runDir, 'analysis.json')) as { analysis: SourceAnalysis };
  assert.equal(finalFile.analysis.concepts[0]?.id, LONG_ID);
  const r2 = readJson(join(runDir, 'analysis.r2.json')) as { analysis: SourceAnalysis; report: ValidationReport };
  assert.equal(r2.analysis.supported, false);
  const unchanged = r2.report.checks.find(c => c.id === 'repair.analysis-unchanged');
  assert.equal(unchanged?.passed, false);
});

/* ------------------------------------------------------------------ */
/* (f) GeneratedOutputError during a repair → OUTPUT_INVALID, accounted */
/* ------------------------------------------------------------------ */

test('analysis repair: malformed repair output fails OUTPUT_INVALID with the receipt accounted', async () => {
  const storageDir = tempStorage();
  const { client } = analysisRepairClient({ repairs: [{ nope: 'SYNTH-MARKER not an analysis' }] });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;

  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, {
    code: 'OUTPUT_INVALID',
    message: 'The model returned output that does not match the required structure.',
  });
  assert.equal(summary.totalCostUSD, 0.02, 'analysis + the billed repair call whose output failed the schema');
  assert.deepEqual(summary.analysisRepairs, [], 'a thrown repair produced no record');
  const jobJson = readJson(join(storageDir, 'runs', jobId, 'job.json')) as JobSummary;
  assert.equal(jobJson.error?.code, 'OUTPUT_INVALID');

  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(repairFailed !== undefined);
  assert.equal(repairFailed.target, 'analysis');
  assert.equal(repairFailed.revision, 2);
  assert.equal(repairFailed.detail, 'OUTPUT_INVALID');
  assert.equal(repairFailed.responseId, 'fake-analysis-repair-1');
  assert.equal(repairFailed.estCostUSD, 0.01);
  assert.ok(!events.some(e => e.stage === 'specify'));
});

/* ------------------------------------------------------------------ */
/* Budget separation: analysis repairs do not consume spec repairs      */
/* ------------------------------------------------------------------ */

test('analysis repair: analysis and spec repair budgets are separate', async () => {
  const storageDir = tempStorage();
  // Analysis fails once (fixed by attempt 1); the spec's revision 1 would fail too,
  // but the fake has no activity_spec_repair route — assert the spec loop is untouched
  // by checking the analysis repair budget was fully available despite maxRepairAttempts 1.
  const { client, analysisRepairCount } = analysisRepairClient({ repairs: [analysisFixture] });
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxRepairAttempts: 1 },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(analysisRepairCount(), 1);
  assert.equal(summary.analysisRepairs?.length, 1, 'the analysis repair used its own budget');
  assert.deepEqual(summary.repairs, [], 'the spec budget was never touched');
});
