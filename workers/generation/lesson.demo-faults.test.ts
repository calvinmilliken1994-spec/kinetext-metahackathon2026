// S6-W — labelled demo faults in the lesson flow (frozen contract, two families only):
//   fabricated-quote → the FIRST quiz card's quote is replaced with text not on the page
//                      (must fail Q-01); inject event carries componentId; summary records
//                      demoFault + demoFaultComponentId.
//   wrong-answer     → the formula explorer's expression is altered (must fail FE-08, else
//                      FE-05/FE-04; the inject detail names the failing check).
// A fault is system-made, labelled everywhere, EXCLUDED from quality metrics, and never
// hides behind the prune (the faulty revision goes to repair, not to a drop). When the plan
// has no target component (or the page declines) the fault is recorded as NOT effective with
// a plain reason and an inject event WITHOUT componentId — a natural repair is never
// labelled system-made (lead decision 2026-10-29).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJob, startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { normalizeWhitespace } from '../../packages/validation/validate.ts';
import type { MetaReceipt } from '../../packages/contracts/index.ts';
import type { LessonSpec, SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const declinedAnalysis = JSON.parse(
  readFileSync(new URL(`${FIX}source-analysis-v2.declined.json`, import.meta.url), 'utf8'),
) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8'));
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8'));

const DRAG = 'nasa-grc-drag-equation';
const GLOSSARY = 'nrc-glossary-half-life';

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'demo',
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

function fakeClient(opts: {
  analysis?: unknown;
  kit?: Record<string, unknown>;
  kitRepair?: Record<string, unknown>;
}): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  let n = 0;
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      calls.push(req.schemaName);
      let data: unknown;
      if (req.schemaName === 'source_analysis_v2') {
        data = opts.analysis ?? usableAnalysis;
      } else if (req.schemaName.endsWith('_repair')) {
        data = opts.kitRepair?.[req.schemaName];
      } else {
        data = opts.kit?.[req.schemaName];
      }
      if (data === undefined) {
        throw new Error(`FAKE_MISSING_RESPONSE:${req.schemaName}`);
      }
      n += 1;
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${req.schemaName}-${n}`) };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 's6w-faults-'));
}

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

function run(sourceId: string, opts: Parameters<typeof fakeClient>[0], demoFault: 'fabricated-quote' | 'wrong-answer', jobId: string) {
  const client = fakeClient(opts);
  const storageDir = tempStorage();
  const started = startJob(sourceId, {
    client,
    storageDir,
    purpose: 'demo',
    flow: 'lesson',
    demoFault,
    newJobId: () => jobId,
  });
  return { client, storageDir, ...started };
}

test('lesson demo fault fabricated-quote: injected into the first quiz card, caught by Q-01, labelled, repaired to r2', async () => {
  const { storageDir, jobId, done } = run(
    DRAG,
    { kit: { formula_explorer: feGen, quiz_cards: quizGen }, kitRepair: { quiz_cards_repair: quizGen } },
    'fabricated-quote',
    'lesson-fault-quote01',
  );
  const summary: JobSummary = await done;
  assert.equal(summary.status, 'succeeded');

  const fault = summary.demoFault;
  assert.ok(fault !== undefined);
  assert.equal(fault?.kind, 'fabricated-quote');
  assert.equal(fault?.path, '/cards/0/quote');
  assert.equal(fault?.revision, 1);
  assert.equal(fault?.effective, true, 'the faulty revision re-validation must fail the intended check');
  assert.equal(fault?.original, quizGen.cards[0].quote);
  const injected = String(fault?.injected);
  const sourceText = readFileSync(new URL('../../data/sources/nasa-grc-drag-equation.txt', import.meta.url), 'utf8');
  assert.ok(
    !normalizeWhitespace(sourceText).includes(normalizeWhitespace(injected)),
    'the injected sentence is absent from the page under the validator normalisation',
  );
  assert.equal(summary.demoFaultComponentId, 'quiz-cards-v1');

  // The faulty revision 1 is persisted with the fault record and failed Q-01.
  const r1 = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'quiz-cards-v1.r1.json'), 'utf8'));
  assert.equal(r1.gen.cards[0].quote, injected);
  assert.equal(r1.report.publishable, false);
  assert.ok(r1.report.checks.some((c: { id: string; passed: boolean }) => c.id === 'Q-01' && !c.passed));
  assert.equal(r1.fault.effective, true);

  // The repair fixed it; the record is system-made-excluded via summary.demoFault.
  assert.deepEqual(summary.componentRepairs?.map(r => [r.componentId, r.attempt, r.revision, r.passed]), [
    ['quiz-cards-v1', 1, 2, true],
  ]);
  assert.ok(summary.componentRepairs?.[0]?.targeted.includes('Q-01'));

  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.ok(inject !== undefined);
  assert.equal(inject?.status, 'succeeded');
  assert.equal(inject?.componentId, 'quiz-cards-v1', 'the inject event MUST carry the componentId (lead decision)');
  assert.equal(inject?.revision, 1);
  assert.match(inject?.detail ?? '', /demo fault injected by the system: fabricated-quote at \/cards\/0\/quote \(caught by Q-01\)/);

  const lesson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8')) as LessonSpec;
  const quizEntry = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  assert.equal(quizEntry?.status, 'passed');
  assert.equal(quizEntry?.revision, 2);

  const detail = readJob(storageDir, jobId);
  assert.ok(detail !== null);
  const served = detail.kitSpecs?.[`${jobId}:quiz-cards-v1:r2`] as { cards: { quote: string }[] };
  assert.equal(served.cards[0].quote, quizGen.cards[0].quote, 'only the verified revision is served');
});

test('lesson demo fault wrong-answer: the altered expression is caught by FE-08, labelled, repaired to r2', async () => {
  const { storageDir, jobId, done } = run(
    DRAG,
    { kit: { formula_explorer: feGen, quiz_cards: quizGen }, kitRepair: { formula_explorer_repair: feGen } },
    'wrong-answer',
    'lesson-fault-answer01',
  );
  const summary: JobSummary = await done;
  assert.equal(summary.status, 'succeeded');

  const fault = summary.demoFault;
  assert.equal(fault?.kind, 'wrong-answer');
  assert.equal(fault?.path, '/expression');
  assert.equal(fault?.effective, true);
  assert.equal(fault?.original, feGen.expression);
  assert.equal(fault?.injected, `(${feGen.expression}) + 1`);
  assert.equal(summary.demoFaultComponentId, 'formula-explorer-v1');

  const r1 = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'formula-explorer-v1.r1.json'), 'utf8'));
  assert.equal(r1.gen.expression, `(${feGen.expression}) + 1`);
  assert.ok(r1.report.checks.some((c: { id: string; passed: boolean }) => c.id === 'FE-08' && !c.passed));

  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.equal(inject?.componentId, 'formula-explorer-v1');
  assert.match(inject?.detail ?? '', /demo fault injected by the system: wrong-answer at \/expression \(caught by FE-08\)/);

  assert.deepEqual(summary.componentRepairs?.map(r => [r.componentId, r.passed]), [['formula-explorer-v1', true]]);
  const lesson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8')) as LessonSpec;
  const feEntry = lesson.components.find(c => c.componentId === 'formula-explorer-v1');
  assert.equal(feEntry?.status, 'passed');
  assert.equal(feEntry?.revision, 2);
});

test('lesson demo fault: a faulty quiz that COULD be pruned still goes to repair — the fault never hides behind a drop', async () => {
  // A 4-card quiz whose extra card is perfectly valid: WITHOUT a fault, a broken card 0 could
  // be pruned (4 → 3) and published with no model call. WITH the injected fault the prune is
  // skipped, so the catch must be demonstrated through the repair path instead.
  const quiz4 = structuredClone(quizGen);
  quiz4.cards.push({
    id: 'dynamic-pressure-card',
    stem: 'What is the combination of density and velocity squared divided by two called?',
    options: ['dynamic pressure', 'drag coefficient', 'reference area'],
    sourceId: DRAG,
    quote: 'called the dynamic pressure and appears in Bernoulli\u2019s pressure equation',
    hint: '',
  });
  const repairedQuiz4 = structuredClone(quiz4);
  repairedQuiz4.cards[0].quote = quizGen.cards[0].quote; // the model restores the real quote
  const { storageDir, jobId, done, client } = run(
    DRAG,
    { kit: { formula_explorer: feGen, quiz_cards: quiz4 }, kitRepair: { quiz_cards_repair: repairedQuiz4 } },
    'fabricated-quote',
    'lesson-fault-pruneskip1',
  );
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.demoFault?.effective, true);
  assert.ok(client.calls.includes('quiz_cards_repair'), 'the faulty revision went to repair, not to the prune');
  assert.deepEqual(summary.componentRepairs?.map(r => [r.attempt, r.revision, r.passed]), [[1, 2, true]]);
  const lesson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'lesson.json'), 'utf8')) as LessonSpec;
  const entry = lesson.components.find(c => c.componentId === 'quiz-cards-v1');
  assert.equal(entry?.status, 'passed');
  assert.equal(entry?.revision, 2);
  assert.equal(entry?.reason, '', 'nothing was dropped: the repair restored the real quote');
  const r2 = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'quiz-cards-v1.r2.json'), 'utf8'));
  assert.equal(r2.gen.cards.length, 4);
});

test('lesson demo fault: a plan without the target component records the fault NOT effective, with a plain reason and no componentId', async () => {
  const analysis = structuredClone(usableAnalysis);
  analysis.componentPlan = [analysis.componentPlan[0]]; // formula-explorer only
  const { storageDir, jobId, done } = run(
    DRAG,
    { analysis, kit: { formula_explorer: feGen } },
    'fabricated-quote',
    'lesson-fault-notarget1',
  );
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.demoFault?.effective, false, 'recorded as NOT effective — never a claimed catch');
  assert.equal(summary.demoFault?.kind, 'fabricated-quote');
  assert.equal(summary.demoFaultComponentId, undefined);
  assert.deepEqual(summary.componentRepairs, [], 'no repair happened, so none can be mislabelled');

  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.ok(inject !== undefined);
  assert.equal(inject?.status, 'failed');
  assert.equal(inject?.componentId, undefined, 'no componentId: no component is branded system-made');
  assert.match(inject?.detail ?? '', /demo fault requested by the system but NOT injected: the plan has no quiz-cards-v1 component/);
});

test('lesson demo fault: a declined page records the fault NOT effective with a plain reason', async () => {
  const { storageDir, jobId, done } = run(
    GLOSSARY,
    { analysis: declinedAnalysis },
    'wrong-answer',
    'lesson-fault-declined1',
  );
  const summary = await done;
  assert.equal(summary.status, 'unsupported');
  assert.equal(summary.demoFault?.effective, false);
  const events = readEvents(storageDir, jobId);
  const inject = events.find(e => e.stage === 'inject');
  assert.equal(inject?.status, 'failed');
  assert.equal(inject?.componentId, undefined);
  assert.match(inject?.detail ?? '', /NOT injected: the page was declined, so no component was built/);
});
