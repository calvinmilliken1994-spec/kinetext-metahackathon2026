// S6-W fix — formula-expression normalisation end-to-end through the lesson worker.
// Live evidence (docs/evidence/stage-6/evaluation-lesson-open): Muse Spark Open wrote whole
// equations (`D = cd * (rho * v^2 * a) / 2`, `v = a * t`) into the formula-explorer
// `expression` field; the frozen grammar rejects '=' (FE-02/FE-08), repairs did not fix it,
// and the parts were lost. The worker now deterministically strips a leading `<name> =`
// BEFORE validation on revision 1 AND every repair revision, persists the normalised gen
// with `normalisedFrom` beside it, and says so in plain words on the event — while a WRONG
// formula still fails FE-02/FE-08 on the normalised result.
//
// Fake MetaClient only — no network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';
const JOB = 'lesson-formula-norm-01';
const GOLDEN_EXPR = 'cd * (rho * v^2 * a) / 2';
const EQUATION_EXPR = 'D = cd * (rho * v^2 * a) / 2';

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

interface FakeOpts {
  kit?: Record<string, unknown>;
  kitRepair?: Record<string, unknown>;
}

function fakeLessonClient(opts: FakeOpts = {}): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      let data: unknown;
      if (name === 'source_analysis_v2') {
        data = usableAnalysis;
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

function startLesson(opts: FakeOpts, extra: { maxRepairAttempts?: number } = {}): {
  storageDir: string;
  jobId: string;
  done: Promise<JobSummary>;
  client: MetaClient & { calls: string[] };
} {
  const client = fakeLessonClient(opts);
  const storageDir = mkdtempSync(join(tmpdir(), 's6w-fnorm-'));
  const { jobId, done } = startJob(DRAG, {
    client,
    storageDir,
    purpose: 'test-live',
    flow: 'lesson',
    newJobId: () => JOB,
    ...(extra.maxRepairAttempts !== undefined ? { limits: { maxRepairAttempts: extra.maxRepairAttempts } } : {}),
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

/* ------------------------------------------------------------------ */
/* Revision 1: `D = …` publishes without any repair call                */
/* ------------------------------------------------------------------ */

test('formula-normalise: an r1 expression written as "D = <rhs>" is tidied deterministically and publishes with NO repair call', async () => {
  const equationFe = structuredClone(feGen) as { expression: string };
  equationFe.expression = EQUATION_EXPR;
  const { storageDir, jobId, done, client } = startLesson({
    kit: { formula_explorer: equationFe, quiz_cards: quizGen },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.03, 'analysis + 2 components; no repair was paid');
  assert.ok(!client.calls.some(c => c.endsWith('_repair')), 'no repair call');

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.deepEqual(
    { status: feEntry?.status, revision: feEntry?.revision, reason: feEntry?.reason },
    { status: 'passed', revision: 1, reason: '' },
  );

  // Honest persistence: the stored gen is the NORMALISED one, with normalisedFrom beside it.
  const r1 = readRunFile(storageDir, jobId, 'formula-explorer-v1.r1.json');
  assert.equal(r1.gen.expression, GOLDEN_EXPR);
  assert.equal(r1.normalisedFrom, EQUATION_EXPR);
  assert.equal(r1.report.publishable, true);
  assert.equal(r1.spec.expression, GOLDEN_EXPR, 'the served spec carries the normalised expression');
  // Nothing else is altered.
  assert.equal(r1.gen.formulaText, feGen.formulaText);
  assert.equal(r1.gen.quote, feGen.quote);
  assert.deepEqual(r1.gen.variables, feGen.variables);
  assert.deepEqual(r1.gen.cases, feGen.cases);

  // The plain-words note rides the component event.
  const events = readEvents(storageDir, jobId);
  const feOk = events.find(e => e.componentId === 'formula-explorer-v1' && e.stage === 'component' && e.status === 'succeeded');
  assert.match(feOk?.detail ?? '', /expression tidied: removed "D =" before checking/);

  // The API detail serves the normalised spec.
  const detail = readJob(storageDir, jobId);
  assert.equal((detail?.kitSpecs?.[`${jobId}:formula-explorer-v1:r1`] as { expression?: string } | undefined)?.expression, GOLDEN_EXPR);
});

test('formula-normalise: a WRONG formula behind "D =" still fails — normalising is not validating', async () => {
  const wrongFe = structuredClone(feGen) as { expression: string };
  wrongFe.expression = `D = (${GOLDEN_EXPR}) + 1`;
  const { storageDir, jobId, done, client } = startLesson(
    { kit: { formula_explorer: wrongFe, quiz_cards: quizGen } },
    { maxRepairAttempts: 0 },
  );
  const summary = await done;
  assert.equal(summary.status, 'succeeded', 'the lesson still publishes (partial publish)');
  assert.equal(summary.lesson?.componentsFailed, 1);
  assert.ok(!client.calls.some(c => c.endsWith('_repair')));

  const r1 = readRunFile(storageDir, jobId, 'formula-explorer-v1.r1.json');
  assert.equal(r1.normalisedFrom, `D = (${GOLDEN_EXPR}) + 1`);
  assert.equal(r1.gen.expression, `(${GOLDEN_EXPR}) + 1`, 'the tidied rhs is what FE-08 rejects');
  assert.equal(r1.report.publishable, false);
  assert.ok(r1.report.checks.some((c: { id: string; passed: boolean }) => c.id === 'FE-08' && !c.passed));

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'failed');
  assert.match(feEntry?.reason ?? '', /^FE-08: /);
});

/* ------------------------------------------------------------------ */
/* Repair revisions: normalised too, comparator consistent              */
/* ------------------------------------------------------------------ */

test('formula-normalise: a repair revision written as "D = <rhs>" is tidied, compared consistently and published as r2', async () => {
  // r1 fails FE-08 (wrong formula, no '=' involved); the repair "fixes" it but writes the
  // whole equation again — the pre-fix behaviour that lost these parts.
  const brokenFe = structuredClone(feGen) as { expression: string };
  brokenFe.expression = `(${GOLDEN_EXPR}) + 1`;
  const repairedFe = structuredClone(feGen) as { expression: string };
  repairedFe.expression = EQUATION_EXPR;
  const { storageDir, jobId, done, client } = startLesson({
    kit: { formula_explorer: brokenFe, quiz_cards: quizGen },
    kitRepair: { formula_explorer_repair: repairedFe },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.ok(client.calls.includes('formula_explorer_repair'));
  assert.deepEqual(summary.componentRepairs?.map(r => [r.componentId, r.revision, r.passed]), [
    ['formula-explorer-v1', 2, true],
  ]);

  const lesson = readRunFile(storageDir, jobId, 'lesson.json') as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.deepEqual(
    { status: feEntry?.status, revision: feEntry?.revision },
    { status: 'passed', revision: 2 },
  );

  // r1 keeps the untouched (non-equation) expression and NO normalisedFrom marker.
  const r1 = readRunFile(storageDir, jobId, 'formula-explorer-v1.r1.json');
  assert.equal(r1.gen.expression, `(${GOLDEN_EXPR}) + 1`);
  assert.equal(r1.normalisedFrom, undefined);
  // r2 stores the normalised gen with normalisedFrom beside it.
  const r2 = readRunFile(storageDir, jobId, 'formula-explorer-v1.r2.json');
  assert.equal(r2.gen.expression, GOLDEN_EXPR);
  assert.equal(r2.normalisedFrom, EQUATION_EXPR);
  assert.equal(r2.report.publishable, true);
  assert.equal(r2.spec.expression, GOLDEN_EXPR);

  // The repair event carries the plain-words note.
  const events = readEvents(storageDir, jobId);
  const repOk = events.find(e => e.stage === 'repair' && e.target === 'component' && e.status === 'succeeded');
  assert.match(repOk?.detail ?? '', /expression tidied: removed "D =" before checking/);
});
