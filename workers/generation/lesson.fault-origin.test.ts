// S6R-11 — fault origin is immutable per component and comes from an ACTUAL injection.
//
//   - A premium repair is afterInjectedFault ONLY when a fault was actually injected into
//     that component — never merely because summary.demoFault exists (a requested fault
//     that could not be injected is recorded with effective:false and no component).
//   - Every repair of a component that carried an injected fault (attempt 1 AND attempt 2+)
//     stays system-made (componentRepairs[].afterInjectedFault === true); a natural repair
//     of any other component stays natural (false).
//
// Fake MetaClient only — no network, no credits, no .env access. The declaration analysis
// and quiz below are hand-written TEST DATA quoting the public-domain NARA page (the same
// fixture-shaped data as lesson.premium.test.ts), not model output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob } from './jobs.ts';
import type { JobStageEvent, JobSummary } from './jobs.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { MetaReceipt, TimelineGeneratedSpec } from '../../packages/contracts/index.ts';
import type { SourceAnalysisV2 } from '../../packages/contracts/kit.ts';

const FIX = '../../tests/fixtures/stage6/';
const usableAnalysis = JSON.parse(readFileSync(new URL(`${FIX}source-analysis-v2.usable.json`, import.meta.url), 'utf8')) as SourceAnalysisV2;
const quizGen = JSON.parse(readFileSync(new URL(`${FIX}quiz-cards.gen.json`, import.meta.url), 'utf8')) as {
  cards: { quote: string }[];
};
const feGen = JSON.parse(readFileSync(new URL(`${FIX}formula-explorer.gen.json`, import.meta.url), 'utf8')) as { expression: string };
const timelineGen = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/timeline.declaration.gen.json', import.meta.url), 'utf8'),
) as TimelineGeneratedSpec;

const DRAG = 'nasa-grc-drag-equation';
const DECL = 'nara-declaration-of-independence';

const Q1 = 'The Continental Congress adopted the Declaration of Independence on July 4, 1776.';
const Q2 = 'Congress appointed on June 10 a committee of five to draft a statement of independence';
const Q3 = 'Jefferson drafted the statement between June 11 and 28';
const Q4 = 'with the actual writing delegated to Jefferson';

function declarationAnalysis(): SourceAnalysisV2 {
  return {
    analysisVersion: 2,
    subject: 'history',
    usable: true,
    declineCode: '',
    declineSummary: '',
    pageCoverage: 'The page traces the drafting, adoption, printing and signing of the Declaration of Independence.',
    overview: {
      headline: 'Adoption and signing of the Declaration were separate events.',
      keyPoints: [
        { id: 'adoption-date', point: 'Congress adopted the Declaration of Independence in July 1776.', sourceId: DECL, quote: Q1 },
        { id: 'committee-of-five', point: 'A committee of five was appointed to draft the statement.', sourceId: DECL, quote: Q2 },
        { id: 'jefferson-drafted', point: 'Jefferson drafted the statement between June 11 and 28.', sourceId: DECL, quote: Q3 },
      ],
      keyTerms: [
        { id: 'continental-congress', term: 'Continental Congress', gloss: 'The congress that adopted the declaration.', sourceId: DECL, quote: Q1 },
        { id: 'committee-of-five', term: 'committee of five', gloss: 'The five-member committee appointed to draft the statement.', sourceId: DECL, quote: Q2 },
        { id: 'jefferson', term: 'Jefferson', gloss: 'Jefferson did the actual writing.', sourceId: DECL, quote: Q4 },
      ],
    },
    componentPlan: [
      { componentId: 'timeline-v1', pedagogicalReason: 'Dated events from June through August suit an ordered timeline.', focusQuote: Q1, focusSourceId: DECL },
      { componentId: 'quiz-cards-v1', pedagogicalReason: 'Checks who drafted the statement and when it was adopted.', focusQuote: Q4, focusSourceId: DECL },
    ],
  };
}

/** Declaration-page quiz golden (hand-written test data; passes Q-01..Q-07 against the page). */
function declarationQuiz(): unknown {
  return {
    schemaVersion: 'quiz-cards-v1',
    title: 'Declaration drafting quiz',
    cards: [
      { id: 'adoption-date-card', stem: 'When did Congress adopt the Declaration of Independence?', options: ['July 4, 1776', 'June 10, 1776', 'August 2, 1776'], sourceId: DECL, quote: Q1, hint: '' },
      { id: 'committee-size-card', stem: 'How many members were on the committee appointed to draft the statement?', options: ['five', 'seven', 'twelve'], sourceId: DECL, quote: Q2, hint: '' },
      { id: 'writer-card', stem: 'Who did the actual writing of the statement?', options: ['Jefferson', 'Adams', 'Franklin'], sourceId: DECL, quote: Q4, hint: '' },
    ],
  };
}

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

/** Every schema answers from its own queue (the last entry repeats). */
function queuedClient(queues: Record<string, unknown[]>): MetaClient & { calls: string[] } {
  const calls: string[] = [];
  const used: Record<string, number> = {};
  return {
    calls,
    complete: async <T,>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      const name = req.schemaName;
      calls.push(name);
      const q = queues[name];
      if (q === undefined || q.length === 0) {
        throw new Error(`FAKE_MISSING_RESPONSE:${name}`);
      }
      const i = used[name] ?? 0;
      used[name] = i + 1;
      const data = q[Math.min(i, q.length - 1)];
      return { data: structuredClone(data) as T, receipt: fakeReceipt(`${name}-${calls.length}`) };
    },
  };
}

function readEvents(storageDir: string, jobId: string): JobStageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as JobStageEvent);
}

function ungroundedYearGen(): TimelineGeneratedSpec {
  const bad = structuredClone(timelineGen);
  const e1 = bad.simulation.events[0];
  assert.ok(e1 !== undefined);
  e1.year = 1775;
  return bad;
}

test('S6R-11: a requested-but-NOT-injected fault never marks a natural premium repair afterInjectedFault', async () => {
  // wrong-answer targets formula-explorer-v1, which this plan does not contain → the fault
  // is recorded as not injected; the premium timeline then fails and is repaired naturally.
  const client = queuedClient({
    source_analysis_v2: [declarationAnalysis()],
    activity_spec: [ungroundedYearGen()],
    activity_spec_repair: [timelineGen],
    quiz_cards: [declarationQuiz()],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r11-premium-'));
  const jobId = 's6r11-premium-000001';
  const { done } = startJob(DECL, { client, storageDir, purpose: 'demo', flow: 'lesson', demoFault: 'wrong-answer', newJobId: () => jobId });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.demoFault?.effective, false, 'requested, not injected');
  assert.equal(summary.demoFaultComponentId, undefined);
  const inject = readEvents(storageDir, jobId).filter(e => e.stage === 'inject');
  assert.deepEqual(inject.map(e => [e.status, e.componentId]), [['failed', undefined]]);
  assert.equal(summary.repairs.length, 1, 'the premium timeline was repaired once');
  assert.equal(summary.repairs[0]?.publishable, true);
  assert.equal(summary.repairs[0]?.afterInjectedFault, false, 'a natural repair is never relabelled system-made');
});

test('S6R-11: every repair attempt of the component that carried the injected fault stays system-made (attempt 1 fails, attempt 2 passes)', async () => {
  const stillFaulty = structuredClone(quizGen);
  (stillFaulty.cards[0] as { quote: string }).quote = 'This sentence is still not printed anywhere on the page.';
  const client = queuedClient({
    source_analysis_v2: [usableAnalysis],
    formula_explorer: [feGen],
    quiz_cards: [quizGen],
    quiz_cards_repair: [stillFaulty, quizGen],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r11-kit-'));
  const jobId = 's6r11-kit-0000000001';
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'demo', flow: 'lesson', demoFault: 'fabricated-quote', newJobId: () => jobId });
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.demoFault?.effective, true);
  assert.equal(summary.demoFaultComponentId, 'quiz-cards-v1');
  const quizRepairs = (summary.componentRepairs ?? []).filter(r => r.componentId === 'quiz-cards-v1');
  assert.deepEqual(
    quizRepairs.map(r => [r.attempt, r.revision, r.passed, r.afterInjectedFault]),
    [
      [1, 2, false, true],
      [2, 3, true, true],
    ],
    'attempt 2 is still a repair against the injected baseline, never a natural repair',
  );
});

test('S6R-11: with the fault injected into one component, a natural repair of ANOTHER component stays natural', async () => {
  const brokenFe = structuredClone(feGen);
  brokenFe.expression = `(${feGen.expression}) + 1`;
  const client = queuedClient({
    source_analysis_v2: [usableAnalysis],
    formula_explorer: [brokenFe],
    formula_explorer_repair: [feGen],
    quiz_cards: [quizGen],
    quiz_cards_repair: [quizGen],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r11-other-'));
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'demo', flow: 'lesson', demoFault: 'fabricated-quote', newJobId: () => 's6r11-other-00000001' });
  const summary: JobSummary = await done;
  assert.equal(summary.status, 'succeeded');
  const byComponent = Object.fromEntries((summary.componentRepairs ?? []).map(r => [r.componentId, r.afterInjectedFault]));
  assert.equal(byComponent['quiz-cards-v1'], true);
  assert.equal(byComponent['formula-explorer-v1'], false);
});

test('S6R-11: without any demo fault every component repair record says afterInjectedFault false', async () => {
  const brokenFe = structuredClone(feGen);
  brokenFe.expression = `(${feGen.expression}) + 1`;
  const client = queuedClient({
    source_analysis_v2: [usableAnalysis],
    formula_explorer: [brokenFe],
    formula_explorer_repair: [feGen],
    quiz_cards: [quizGen],
  });
  const storageDir = mkdtempSync(join(tmpdir(), 's6r11-none-'));
  const { done } = startJob(DRAG, { client, storageDir, purpose: 'test-live', flow: 'lesson', newJobId: () => 's6r11-none-000000001' });
  const summary: JobSummary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.deepEqual((summary.componentRepairs ?? []).map(r => [r.componentId, r.passed, r.afterInjectedFault]), [['formula-explorer-v1', true, false]]);
});
