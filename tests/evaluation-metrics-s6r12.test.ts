// S6R-12 — evaluation metrics count kit (component) repairs and kit-only lessons honestly.
//   - componentRepairs join the repair totals and the targeted-check counts with
//     component-scoped ids (`<componentId>:<checkId>`); older lesson results without the
//     field are reported as "not recorded", never as zero repairs;
//   - lesson-flow cost statistics use "overview published" as the publication denominator
//     (the frozen lesson semantics), with separately named overview / interactive / premium
//     denominators; activity-flow (v1) statistics are unchanged;
//   - the legacy engine-class accuracy is labelled not applicable to kit-only lesson outcomes
//     (excluded from the accuracy denominator instead of counting as 'unknown').
// Pure computeMetrics fixtures; nothing is read from or written to docs/evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparisonSide, computeMetrics, renderComparisonMarkdown, renderSummaryMarkdown } from '../scripts/evaluation-metrics.ts';
import type { EvalResultLine } from '../scripts/evaluation-metrics.ts';

function kitLesson(over: Partial<EvalResultLine> = {}): EvalResultLine {
  return {
    sourceId: 'kit-only',
    expected: 'decline',
    acceptable: [],
    status: 'succeeded',
    flow: 'lesson',
    componentsPlanned: 1,
    componentsPublished: 1,
    componentsFailed: 0,
    overviewPublished: true,
    interactivePublished: true,
    partialPublish: false,
    engine: null,
    publishedRevision: null,
    repairs: [],
    analysisRepairs: [],
    componentRepairs: [
      { componentId: 'quiz-cards-v1', attempt: 1, revision: 2, targeted: ['Q-02'], fixed: ['Q-02'], remaining: [], passed: true },
    ],
    totalCostUSD: 0.05,
    ...over,
  };
}

function premiumLesson(over: Partial<EvalResultLine> = {}): EvalResultLine {
  return kitLesson({
    sourceId: 'premium',
    expected: 'timeline-v1',
    engine: 'timeline-v1',
    publishedRevision: 1,
    componentsPlanned: 2,
    componentsPublished: 2,
    componentRepairs: [],
    totalCostUSD: 0.09,
    ...over,
  });
}

const v1Line = (over: Partial<EvalResultLine> = {}): EvalResultLine => ({
  sourceId: 'v1',
  expected: 'forces-1d-v1',
  acceptable: [],
  status: 'succeeded',
  engine: 'forces-1d-v1',
  publishedRevision: 1,
  repairs: [],
  totalCostUSD: 0.03,
  ...over,
});

test('S6R-12 (review recipe): a kit-only lesson with one passing component repair counts in the repair totals and as a published lesson', () => {
  const m = computeMetrics([kitLesson()], []);
  assert.equal(m.lesson.interactivePublished, 1);
  assert.equal(m.repairs.total, 1, 'the component repair is a natural repair attempt');
  assert.equal(m.repairs.componentTotal, 1);
  assert.equal(m.repairs.jobsWithRepairs, 1);
  assert.equal(m.repairs.jobsWithComponentRepairs, 1);
  assert.deepEqual(m.repairs.byTargetedCheck, { 'quiz-cards-v1:Q-02': 1 }, 'component-scoped check id');
  assert.equal(m.cost.publishedLessons, 1, 'lesson publication = overview published');
  assert.equal(m.cost.meanPerPublishedUSD, 0.05);
  assert.equal(m.cost.lesson.overview.jobs, 1);
  assert.equal(m.cost.lesson.interactive.jobs, 1);
  assert.equal(m.cost.lesson.premium.jobs, 0);
  assert.equal(m.cost.lesson.premium.meanUSD, null);
});

test('S6R-12: a premium lesson and a kit-only lesson share the overview denominator; component type only changes the premium one', () => {
  const m = computeMetrics([kitLesson(), premiumLesson()], []);
  assert.equal(m.cost.publishedLessons, 2);
  assert.equal(m.cost.meanPerPublishedUSD, 0.07);
  assert.equal(m.cost.maxPerPublishedUSD, 0.09);
  assert.deepEqual(m.cost.lesson.overview, { jobs: 2, meanUSD: 0.07, maxUSD: 0.09 });
  assert.deepEqual(m.cost.lesson.interactive, { jobs: 2, meanUSD: 0.07, maxUSD: 0.09 });
  assert.deepEqual(m.cost.lesson.premium, { jobs: 1, meanUSD: 0.09, maxUSD: 0.09 });
});

test('S6R-12: engine-class accuracy is not applicable to kit-only lesson outcomes (own class, excluded from the denominator)', () => {
  const m = computeMetrics([kitLesson(), premiumLesson(), v1Line()], []);
  const kit = m.pages.find(p => p.sourceId === 'kit-only');
  assert.equal(kit?.class, 'not-applicable');
  assert.equal(m.byClass['not-applicable'], 1);
  assert.equal(m.byClass.unknown, 0, 'a published kit-only lesson is not an unknown outcome');
  assert.equal(m.byClass['false-accept'], 0, 'publishing an overview for a v1-decline page is not a false accept');
  assert.equal(m.engineClassApplicable, 2);
  assert.equal(m.accuracyRate, 1, 'premium lesson + v1 activity are both correct; the kit-only lesson is excluded');
  const md = renderSummaryMarkdown(m, { manifestTotal: 3 });
  assert.match(md, /not applicable/i);
  assert.match(md, /\*\*2 of 2\*\* engine-class/);
});

test('S6R-12: older lesson results without componentRepairs are "not recorded", never zero; injected-fault component repairs are excluded', () => {
  const old = kitLesson({ sourceId: 'old' });
  delete (old as { componentRepairs?: unknown }).componentRepairs;
  const faulted = kitLesson({
    sourceId: 'faulted',
    componentRepairs: [
      { componentId: 'quiz-cards-v1', attempt: 1, revision: 2, targeted: ['Q-01'], fixed: [], remaining: ['Q-01'], passed: false, afterInjectedFault: true },
      { componentId: 'quiz-cards-v1', attempt: 2, revision: 3, targeted: ['Q-01'], fixed: ['Q-01'], remaining: [], passed: true, afterInjectedFault: true },
    ],
  });
  const m = computeMetrics([old, faulted, kitLesson()], []);
  assert.equal(m.repairs.componentRepairsNotRecorded, 1);
  assert.equal(m.repairs.componentTotal, 1, 'only the natural repair counts');
  assert.equal(m.repairs.componentAfterInjectedFault, 2);
  assert.equal(m.repairs.total, 1);
  assert.deepEqual(m.repairs.byTargetedCheck, { 'quiz-cards-v1:Q-02': 1 });
  const md = renderSummaryMarkdown(m, { manifestTotal: 3 });
  assert.match(md, /Component repair attempts: \*\*1\*\*/);
  assert.match(md, /1 lesson result line\(s\) predate component-repair recording/);
  assert.match(md, /2 component repair attempt\(s\) after a system-injected demo fault are excluded/);
});

test('S6R-12: v1 statistics are unchanged by the lesson fields (activity lines only)', () => {
  const lines = [
    v1Line({ sourceId: 'a', totalCostUSD: 0.04 }),
    v1Line({ sourceId: 'b', publishedRevision: 2, repairs: [{ revision: 2, targeted: ['behavior.tests'], fixed: ['behavior.tests'], remaining: [] }], totalCostUSD: 0.1 }),
    v1Line({ sourceId: 'c', status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline', totalCostUSD: 0.02 }),
  ];
  const m = computeMetrics(lines, []);
  assert.equal(m.accuracyRate, 1);
  assert.equal(m.engineClassApplicable, 3);
  assert.equal(m.byClass['not-applicable'], 0);
  assert.equal(m.repairs.total, 1);
  assert.equal(m.repairs.componentTotal, 0);
  assert.equal(m.repairs.componentRepairsNotRecorded, 0, 'activity lines never had component repairs');
  assert.deepEqual(m.repairs.byTargetedCheck, { 'behavior.tests': 1 });
  assert.equal(m.cost.publishedLessons, 2);
  assert.equal(m.cost.meanPerPublishedUSD, 0.07);
  assert.equal(m.cost.lesson.overview.jobs, 0);
  const md = renderSummaryMarkdown(m, { manifestTotal: 3 });
  assert.ok(!/not-applicable/.test(md), 'no n/a row or column without kit-only lessons');
  assert.ok(!/Component repair attempts/.test(md), 'no component-repair line without lesson results');
});

test('S6R-12: the comparison carries component repairs and the lesson publication denominator', () => {
  const a = comparisonSide([kitLesson(), premiumLesson()], { label: 'A' });
  const b = comparisonSide([v1Line()], { label: 'B' });
  assert.equal(a.componentRepairsTotal, 1);
  assert.equal(a.repairsTotal, 1);
  assert.equal(a.publishedLessons, 2);
  assert.equal(a.notApplicable, 1);
  const md = renderComparisonMarkdown(a, b, { generatedAt: '2026-10-30T00:00:00.000Z' });
  assert.match(md, /\| Component repair attempts \| 1 \| 0 \|/);
  assert.match(md, /\| not-applicable \| 1 \| 0 \|/);
  const v1Only = renderComparisonMarkdown(b, b, { generatedAt: '2026-10-30T00:00:00.000Z' });
  assert.ok(!v1Only.includes('not-applicable'), 'v1-only comparisons keep their table');
});
