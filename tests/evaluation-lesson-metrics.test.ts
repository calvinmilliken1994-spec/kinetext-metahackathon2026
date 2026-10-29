// S6-W — lesson metrics in the evaluation report (pure functions over results.jsonl lines).
// The v1 outcome classification is untouched; the lesson section only reads the additive
// flow/lesson fields the driver records, and never counts an activity-flow line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLessonMetrics,
  computeMetrics,
  renderSummaryMarkdown,
} from '../scripts/evaluation-metrics.ts';
import type { EvalResultLine } from '../scripts/evaluation-metrics.ts';

function lessonLine(over: Partial<EvalResultLine>): EvalResultLine {
  return {
    sourceId: 'src',
    status: 'succeeded',
    flow: 'lesson',
    componentsPlanned: 2,
    componentsPublished: 2,
    componentsFailed: 0,
    overviewPublished: true,
    interactivePublished: true,
    partialPublish: false,
    totalCostUSD: 0.05,
    ...over,
  };
}

const LINES: EvalResultLine[] = [
  lessonLine({ sourceId: 'a' }),
  lessonLine({
    sourceId: 'b',
    componentsPublished: 1,
    componentsFailed: 1,
    partialPublish: true,
    interactivePublished: true,
  }),
  lessonLine({
    sourceId: 'c',
    status: 'unsupported',
    declineCode: 'too-short',
    componentsPlanned: 0,
    componentsPublished: 0,
    overviewPublished: false,
    interactivePublished: false,
  }),
  lessonLine({
    sourceId: 'd',
    status: 'failed',
    error: 'ANALYSIS_INVALID',
    componentsPlanned: 0,
    componentsPublished: 0,
    overviewPublished: false,
    interactivePublished: false,
  }),
  lessonLine({
    sourceId: 'e',
    componentsPublished: 0,
    componentsFailed: 2,
    overviewPublished: true,
    interactivePublished: false,
    partialPublish: false,
  }),
  // An activity-flow line: counted by the v1 metrics, invisible to the lesson metrics.
  { sourceId: 'f', status: 'succeeded', flow: 'activity', engine: 'forces-1d-v1', publishedRevision: 1, expected: 'forces-1d-v1', totalCostUSD: 0.03 },
  // A pre-Stage-6 line without flow: also invisible to the lesson metrics.
  { sourceId: 'g', status: 'succeeded', engine: 'timeline-v1', publishedRevision: 1, expected: 'timeline-v1', totalCostUSD: 0.03 },
];

test('computeLessonMetrics: rates over lesson lines only, counts and declines by code', () => {
  const m = computeLessonMetrics(LINES);
  assert.equal(m.lessonJobs, 5);
  assert.equal(m.declined, 1);
  assert.equal(m.failed, 1);
  assert.equal(m.overviewPublished, 3); // a, b, e
  assert.equal(m.overviewRate, 0.6);
  assert.equal(m.interactivePublished, 2); // a, b
  assert.equal(m.interactiveRate, 0.4);
  assert.equal(m.componentsPlanned, 6); // 2+2+0+0+2
  assert.equal(m.componentsPublished, 3); // 2+1
  assert.equal(m.componentsFailed, 3); // 1+2
  assert.equal(m.partialPublishJobs, 1);
  assert.deepEqual(m.declinesByCode, { 'too-short': 1 });
});

test('computeLessonMetrics: no lesson lines → zeros and null rates (never 0 by assumption)', () => {
  const m = computeLessonMetrics([{ sourceId: 'x', flow: 'activity', status: 'succeeded' }]);
  assert.equal(m.lessonJobs, 0);
  assert.equal(m.overviewRate, null);
  assert.equal(m.interactiveRate, null);
});

test('computeMetrics exposes lesson metrics; the v1 classes are unchanged by the lesson lines', () => {
  const summary = computeMetrics(LINES, []);
  assert.equal(summary.lesson.lessonJobs, 5);
  assert.equal(summary.lesson.overviewRate, 0.6);
  // The activity line classifies exactly as before.
  const activityPage = summary.pages.find(p => p.sourceId === 'f');
  assert.equal(activityPage?.class, 'correct-first-try');
});

test('renderSummaryMarkdown: the lesson section appears only when lesson jobs exist', () => {
  const withLesson = renderSummaryMarkdown(computeMetrics(LINES, []), { manifestTotal: 7 });
  assert.match(withLesson, /## Lesson flow \(Stage 6\)/);
  assert.match(withLesson, /Pages that got an overview: \*\*3 of 5\*\* \(60\.0%\)/);
  assert.match(withLesson, /at least one interactive component: \*\*2 of 5\*\* \(40\.0%\)/);
  assert.match(withLesson, /\*\*3 published\*\*, \*\*3 failed\/skipped\*\*, of \*\*6 planned\*\*/);
  assert.match(withLesson, /Partial publishes[^\n]*\*\*1\*\*/);
  assert.match(withLesson, /Decline codes: `too-short` ×1/);

  const activityOnly = renderSummaryMarkdown(
    computeMetrics([{ sourceId: 'x', flow: 'activity', status: 'succeeded', expected: 'decline' }], []),
    { manifestTotal: 1 },
  );
  assert.ok(!activityOnly.includes('## Lesson flow'), 'no lesson section without lesson lines');
});
