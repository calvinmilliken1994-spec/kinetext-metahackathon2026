// BUG-006 — a component-level OUTPUT_TRUNCATED (the client's MetaError when the provider
// finishes with finish_reason != 'stop', e.g. the 24k component cap consumed by reasoning)
// must fail ONLY that component (lesson entry failed with a plain reason, partial publish),
// never the whole lesson job — while every OTHER MetaError (auth, budget, rate limit,
// network after retries, aborts, wall-time) stays fatal exactly as before, and analysis/
// overview-stage truncation stays lesson-fatal. The failed call's cost still goes through
// the ONE accumulator. OUTPUT_INVALID from a component repair call gets the same
// component-level treatment (it already had it for generation calls).
//
// Live evidence: docs/evidence/stage-6/evaluation-lesson-1.3/jobs/job-20261029130605-5af31428
// (nij-population-genetics): overview + 2 components passed, a concept-map REPAIR call ended
// OUTPUT_TRUNCATED and the whole job became failed OUTPUT_TRUNCATED.
//
// Fake MetaClient only — no network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { GeneratedOutputError } from '../../packages/meta/pipeline.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';
const JOB = 'lesson-bug006-000001';

/** The plain reason the frozen contract wants on a truncated component entry. */
const TRUNCATED_REASON = 'Muse ran out of room while writing this part, so it was left out.';
const INVALID_REASON = 'The model returned output that does not match the required structure.';

function fakeReceipt(responseId: string, estCostUSD = 0.01): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD,
    finishReason: 'stop',
    attempts: 1,
  };
}

/**
 * What the real client throws after a PAID, settled call whose finish_reason was not
 * 'stop': a MetaError carrying the receipt plus the settled chargedUSD (client.ts fail()).
 */
function truncatedError(responseId: string, estCostUSD = 0.01): MetaError {
  return new MetaError('OUTPUT_TRUNCATED', undefined, {
    receipt: fakeReceipt(responseId, estCostUSD),
    chargedUSD: estCostUSD,
    reservedUnknownUSD: 0,
    costBasis: 'usage',
  });
}

interface FakeOpts {
  analysis?: unknown;
  kit?: Record<string, unknown>;
  kitRepair?: Record<string, unknown>;
  throwOn?: Record<string, unknown>;
}

function fakeLessonClient(opts: FakeOpts = {}): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      const err = opts.throwOn?.[name];
      if (err !== undefined) {
        throw err;
      }
      let data: unknown;
      if (name === 'source_analysis_v2') {
        data = opts.analysis ?? usableAnalysis;
      } else if (name.endsWith('_repair')) {
        data = opts.kitRepair?.[name];
      } else {
        data = opts.kit?.[name];
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${name}-${n}`) };
    },
  };
}

function startLesson(opts: FakeOpts): {
  storageDir: string;
  jobId: string;
  done: Promise<JobSummary>;
  client: MetaClient & { calls: string[] };
} {
  const client = fakeLessonClient(opts);
  const storageDir = mkdtempSync(join(tmpdir(), 'bug006-'));
  const { jobId, done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => JOB,
  });
  return { storageDir, jobId, done, client };
}

type Ev = JobStageEvent;
function readEvents(storageDir: string, jobId: string): Ev[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as Ev);
}
function readRunFile(storageDir: string, jobId: string, name: string): any {
  return JSON.parse(readFileSync(join(storageDir, 'runs', jobId, name), 'utf8'));
}

function brokenFe(): unknown {
  const b = structuredClone(feGen) as { expression: string };
  b.expression = `(${feGen.expression as string}) + 1`;
  return b;
}

/* ------------------------------------------------------------------ */
/* BUG-006 core: a truncated REPAIR call fails only its component       */
/* ------------------------------------------------------------------ */

test('BUG-006: a component repair call that ends OUTPUT_TRUNCATED fails only that component — the job still succeeds with a partial publish, and the paid call is accounted', async () => {
  const { storageDir, jobId, done, client } = startLesson({
    kit: { formula_explorer: brokenFe(), quiz_cards: quizGen },
    throwOn: { formula_explorer_repair: truncatedError('fe-repair-truncated') },
  });
  const summary = await done;

  assert.equal(summary.status, 'succeeded', 'overview + 1 passed component = succeeded, not failed');
  assert.equal(summary.error, undefined);
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 1,
    componentsFailed: 1,
    partialPublish: true,
  });
  // analysis + fe gen + quiz gen + the truncated repair — ALL accounted (single accumulator).
  assert.equal(summary.totalCostUSD, 0.04);
  assert.equal(summary.reservedUnknownUSD, 0);
  assert.ok(client.calls.includes('formula_explorer_repair'), 'the repair call was made');

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.equal(feEntry?.reason, TRUNCATED_REASON, 'a plain reason, never provider text');
  assert.equal(feEntry?.revision, 1, 'the last verified revision stays the entry revision');
  const quizEntry = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  assert.equal(quizEntry?.status, 'passed');

  // The paid repair attempt is recorded as a component repair that did not pass.
  assert.equal(summary.componentRepairs?.length, 1);
  const rep = summary.componentRepairs?.[0];
  assert.equal(rep?.componentId, 'formula-explorer-v1');
  assert.equal(rep?.attempt, 1);
  assert.equal(rep?.revision, 2);
  assert.ok((rep?.targeted ?? []).includes('FE-08'));
  assert.deepEqual(rep?.fixed, []);
  assert.deepEqual(rep?.remaining, rep?.targeted);
  assert.equal(rep?.passed, false);

  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.ok(repairFailed, 'a repair:failed event exists');
  assert.equal(repairFailed?.target, 'component');
  assert.equal(repairFailed?.componentId, 'formula-explorer-v1');
  assert.equal(repairFailed?.revision, 2);
  assert.equal(repairFailed?.detail, 'OUTPUT_TRUNCATED', 'the fixed code, never provider text');
  assert.equal(repairFailed?.estCostUSD, 0.01, 'the failure event carries the accounted receipt');
  assert.equal(events[events.length - 1]?.stage, 'done');
  assert.equal(events[events.length - 1]?.status, 'succeeded');
  assert.match(events[events.length - 1]?.detail ?? '', /partial publish/);

  // The failed component's spec is never served; its r1 report is.
  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  assert.deepEqual(Object.keys(detail.kitSpecs ?? {}), [`${jobId}:quiz-cards-v1:r1`]);
  assert.deepEqual(detail.componentRepairs?.map(r => [r.componentId, r.passed]), [
    ['formula-explorer-v1', false],
  ]);

  // job.json on disk carries the same accounted totals.
  const jobJson = readRunFile(storageDir, jobId, 'job.json') as JobSummary;
  assert.equal(jobJson.totalCostUSD, 0.04);
  assert.equal(jobJson.status, 'succeeded');
});

/* ------------------------------------------------------------------ */
/* Truncated GENERATION call: same component-level treatment            */
/* ------------------------------------------------------------------ */

test('BUG-006: a component generation call that ends OUTPUT_TRUNCATED fails only that component', async () => {
  const { storageDir, jobId, done } = startLesson({
    kit: { quiz_cards: quizGen },
    throwOn: { formula_explorer: truncatedError('fe-gen-truncated') },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.error, undefined);
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 1,
    componentsFailed: 1,
    partialPublish: true,
  });
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + truncated fe gen + quiz gen');

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.equal(feEntry?.reason, TRUNCATED_REASON);
  assert.equal(feEntry?.revision, 1);

  const events = readEvents(storageDir, jobId);
  const feFailed = events.find(e => e.componentId === 'formula-explorer-v1' && e.status === 'failed');
  assert.equal(feFailed?.stage, 'component');
  assert.equal(feFailed?.detail, 'OUTPUT_TRUNCATED');
  assert.equal(feFailed?.estCostUSD, 0.01);
});

/* ------------------------------------------------------------------ */
/* No component passes: the frozen contract rule (overview-only) holds  */
/* ------------------------------------------------------------------ */

test('BUG-006: when EVERY component truncates the job still succeeds as overview-only (contract: succeeded = overview published), partialPublish stays false', async () => {
  const { storageDir, jobId, done } = startLesson({
    throwOn: {
      formula_explorer: truncatedError('fe-gen-truncated'),
      quiz_cards: truncatedError('quiz-gen-truncated'),
    },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded', 'the overview published, so the job succeeds');
  assert.deepEqual(summary.lesson, {
    overviewReady: true,
    componentsPlanned: 2,
    componentsPublished: 0,
    componentsFailed: 2,
    partialPublish: false,
  });
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + both truncated generations');
  const events = readEvents(storageDir, jobId);
  assert.match(events[events.length - 1]?.detail ?? '', /overview only/);
  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  assert.deepEqual(
    lesson.components.map(c => [c.componentId, c.status, c.reason]),
    [
      ['formula-explorer-v1', 'failed', TRUNCATED_REASON],
      ['quiz-cards-v1', 'failed', TRUNCATED_REASON],
    ],
  );
});

/* ------------------------------------------------------------------ */
/* OUTPUT_INVALID from a repair call: component-level with plain reason */
/* ------------------------------------------------------------------ */

test('BUG-006: OUTPUT_INVALID from a component repair call fails only that component with the plain structure reason and a repair record', async () => {
  const { storageDir, jobId, done } = startLesson({
    kit: { formula_explorer: brokenFe(), quiz_cards: quizGen },
    throwOn: {
      formula_explorer_repair: new GeneratedOutputError('repair', fakeReceipt('fe-repair-invalid')),
    },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.lesson?.partialPublish, true);
  assert.equal(summary.totalCostUSD, 0.04, 'the billed-but-invalid repair call is accounted (F-01)');

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.equal(feEntry?.reason, INVALID_REASON);

  assert.equal(summary.componentRepairs?.length, 1);
  assert.equal(summary.componentRepairs?.[0]?.passed, false);
  assert.ok((summary.componentRepairs?.[0]?.targeted ?? []).includes('FE-08'));

  const events = readEvents(storageDir, jobId);
  const repairFailed = events.find(e => e.stage === 'repair' && e.status === 'failed');
  assert.equal(repairFailed?.detail, 'OUTPUT_INVALID');
  assert.equal(repairFailed?.componentId, 'formula-explorer-v1');
});

/* ------------------------------------------------------------------ */
/* Everything else stays fatal, exactly as now                          */
/* ------------------------------------------------------------------ */

test('BUG-006 guard: a RATE_LIMITED MetaError during a component repair still fails the whole job', async () => {
  const { storageDir, jobId, done } = startLesson({
    kit: { formula_explorer: brokenFe(), quiz_cards: quizGen },
    throwOn: { formula_explorer_repair: new MetaError('RATE_LIMITED') },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'RATE_LIMITED', message: 'rate limited' });
  const events = readEvents(storageDir, jobId);
  assert.equal(events[events.length - 1]?.stage, 'repair');
  assert.equal(events[events.length - 1]?.status, 'failed');
});

test('BUG-006 guard: OUTPUT_TRUNCATED at the ANALYSIS stage stays lesson-fatal (the overview is the minimum publishable unit)', async () => {
  const { storageDir, jobId, done } = startLesson({
    throwOn: { source_analysis_v2: truncatedError('analysis-truncated') },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'OUTPUT_TRUNCATED', message: 'output truncated' });
  assert.equal(summary.totalCostUSD, 0.01, 'the truncated analysis call is still accounted');
  const events = readEvents(storageDir, jobId);
  const failed = events.find(e => e.status === 'failed');
  assert.equal(failed?.stage, 'analyze');
  assert.equal(failed?.detail, 'OUTPUT_TRUNCATED');
});
