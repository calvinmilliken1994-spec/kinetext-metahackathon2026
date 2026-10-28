// TASK-023b: tests for the pure evaluation-metrics module (scripts/evaluation-metrics.ts).
// Written first (RED) before the module existed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResult, computeMetrics, parseResultsJsonl, renderSummaryMarkdown,
} from '../scripts/evaluation-metrics.ts';
import type { EvalResultLine, ManifestEntry } from '../scripts/evaluation-metrics.ts';

function entry(over: Partial<ManifestEntry> & { sourceId: string }): ManifestEntry {
  return { candidate: 1, subject: 'physics', expected: 'forces-1d-v1', acceptable: [], difficulty: 'easy', ...over };
}

function line(over: Partial<EvalResultLine> = {}): EvalResultLine {
  return {
    sourceId: 'src', candidate: 1, subject: 'physics', expected: 'forces-1d-v1', acceptable: [], difficulty: 'easy',
    status: 'succeeded', engine: 'forces-1d-v1', publishedRevision: 1, revisions: 1,
    repairs: [], failedChecks: [], firstRevisionFailedChecks: [], error: null,
    totalCostUSD: 0.05, wallS: 40, ...over,
  };
}

test('classifyResult: published r1 with the expected engine is correct-first-try', () => {
  assert.equal(classifyResult(line({})), 'correct-first-try');
});

test('classifyResult: published r>1 with the expected engine is correct-after-repair', () => {
  assert.equal(classifyResult(line({ publishedRevision: 2, revisions: 2 })), 'correct-after-repair');
});

test('classifyResult: an acceptable alternative engine still counts as correct', () => {
  assert.equal(classifyResult(line({ engine: 'projectile-v1', acceptable: ['projectile-v1'] })), 'correct-first-try');
  assert.equal(classifyResult(line({ engine: 'projectile-v1', acceptable: ['projectile-v1'], publishedRevision: 3, revisions: 3 })), 'correct-after-repair');
});

test('classifyResult: unsupported when decline was expected or acceptable is correct-decline', () => {
  assert.equal(classifyResult(line({ status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline' })), 'correct-decline');
  assert.equal(classifyResult(line({ status: 'unsupported', engine: null, publishedRevision: null, acceptable: ['decline'] })), 'correct-decline');
});

test('classifyResult: declining a supported page with no decline acceptable is wrong-decline', () => {
  assert.equal(classifyResult(line({ status: 'unsupported', engine: null, publishedRevision: null })), 'wrong-decline');
});

test('classifyResult: publishing an expected-decline page is false-accept', () => {
  assert.equal(classifyResult(line({ expected: 'decline', engine: 'forces-1d-v1' })), 'false-accept');
});

test('classifyResult: publishing an engine outside expected/acceptable is wrong-engine', () => {
  assert.equal(classifyResult(line({ engine: 'lift-equation-v1' })), 'wrong-engine');
});

test('classifyResult: failed jobs classify as failed regardless of other fields', () => {
  assert.equal(classifyResult(line({ status: 'failed', error: 'REPAIR_BUDGET_EXHAUSTED', engine: null, publishedRevision: null })), 'failed');
  assert.equal(classifyResult(line({ status: 'unsupported', error: 'OUTPUT_INVALID' })), 'failed');
});

test('classifyResult: unexpected shapes are unknown, never silently correct', () => {
  assert.equal(classifyResult(line({ status: 'running' })), 'unknown');
  assert.equal(classifyResult(line({ status: 'succeeded', engine: null, publishedRevision: null })), 'unknown');
});

test('parseResultsJsonl: parses lines, skips blanks, tolerates a missing trailing newline', () => {
  const a = line({ sourceId: 'a' });
  const b = line({ sourceId: 'b', status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline' });
  const text = `${JSON.stringify(a)}\n\n${JSON.stringify(b)}`;
  const parsed = parseResultsJsonl(text);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].sourceId, 'a');
  assert.equal(parsed[1].sourceId, 'b');
  assert.equal(parseResultsJsonl('').length, 0);
});

test('computeMetrics: overall counts and the accuracy rate', () => {
  const results = [
    line({ sourceId: 'ok1' }),
    line({ sourceId: 'ok2', publishedRevision: 2, revisions: 2, repairs: [{ revision: 2, targeted: ['behavior.tests'], fixed: ['behavior.tests'], remaining: [] }], firstRevisionFailedChecks: ['behavior.tests'] }),
    line({ sourceId: 'dec-ok', status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline' }),
    line({ sourceId: 'dec-bad' , status: 'unsupported', engine: null, publishedRevision: null }),
    line({ sourceId: 'eng-bad', engine: 'half-life-v1' }),
    line({ sourceId: 'acc-bad', expected: 'decline' }),
    line({ sourceId: 'fail', status: 'failed', error: 'ANALYSIS_FAILED', engine: null, publishedRevision: null, totalCostUSD: 0.02 }),
  ];
  const m = computeMetrics(results, []);
  assert.equal(m.total, 7);
  assert.deepEqual(m.byClass, {
    'correct-first-try': 1, 'correct-after-repair': 1, 'correct-decline': 1,
    'wrong-engine': 1, 'wrong-decline': 1, 'false-accept': 1, failed: 1, unknown: 0,
  });
  assert.equal(m.accuracyRate, 3 / 7);
});

test('computeMetrics: per-subject and per-difficulty breakdowns', () => {
  const results = [
    line({ sourceId: 'p1', subject: 'physics', difficulty: 'easy' }),
    line({ sourceId: 'p2', subject: 'physics', difficulty: 'hard', status: 'unsupported', engine: null, publishedRevision: null }),
    line({ sourceId: 'h1', subject: 'history', difficulty: 'medium', expected: 'timeline-v1', engine: 'timeline-v1' }),
  ];
  const m = computeMetrics(results, []);
  assert.equal(m.bySubject.physics.total, 2);
  assert.equal(m.bySubject.physics.accuracyRate, 0.5);
  assert.equal(m.bySubject.history.total, 1);
  assert.equal(m.bySubject.history.accuracyRate, 1);
  assert.equal(m.byDifficulty.easy.total, 1);
  assert.equal(m.byDifficulty.hard.byClass['wrong-decline'], 1);
  assert.equal(m.byDifficulty.medium.accuracyRate, 1);
  assert.equal(m.bySubject.finance, undefined, 'subjects with no results are absent, not zero-filled');
});

test('computeMetrics: natural repair counts and which checks triggered them', () => {
  const results = [
    line({
      sourceId: 'r1', publishedRevision: 2, revisions: 2,
      repairs: [{ revision: 2, targeted: ['behavior.tests', 'grounding.quotes'], fixed: ['behavior.tests', 'grounding.quotes'], remaining: [] }],
      firstRevisionFailedChecks: ['behavior.tests', 'grounding.quotes'],
    }),
    line({
      sourceId: 'r2', status: 'failed', error: 'REPAIR_BUDGET_EXHAUSTED', engine: null, publishedRevision: null, revisions: 3,
      repairs: [
        { revision: 2, targeted: ['timeline.case-order'], fixed: [], remaining: ['timeline.case-order'] },
        { revision: 3, targeted: ['timeline.case-order'], fixed: [], remaining: ['timeline.case-order'] },
      ],
      firstRevisionFailedChecks: ['timeline.case-order'],
    }),
    line({ sourceId: 'r3' }),
  ];
  const m = computeMetrics(results, []);
  assert.equal(m.repairs.total, 3);
  assert.equal(m.repairs.jobsWithRepairs, 2);
  assert.deepEqual(m.repairs.byTargetedCheck, { 'behavior.tests': 1, 'grounding.quotes': 1, 'timeline.case-order': 2 });
  assert.deepEqual(m.repairs.byFirstRevisionCheck, { 'behavior.tests': 1, 'grounding.quotes': 1, 'timeline.case-order': 1 });
});

test('computeMetrics: cost per published lesson, total cost and mean wall time', () => {
  const results = [
    line({ sourceId: 'a', totalCostUSD: 0.04, wallS: 30 }),
    line({ sourceId: 'b', publishedRevision: 2, revisions: 2, totalCostUSD: 0.10, wallS: 90 }),
    line({ sourceId: 'c', status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline', totalCostUSD: 0.02, wallS: 20 }),
    line({ sourceId: 'd', status: 'failed', error: 'X', engine: null, publishedRevision: null, totalCostUSD: 0.06, wallS: 60 }),
  ];
  const m = computeMetrics(results, []);
  assert.equal(m.cost.publishedLessons, 2);
  assert.equal(m.cost.meanPerPublishedUSD, 0.07);
  assert.equal(m.cost.maxPerPublishedUSD, 0.10);
  assert.equal(m.cost.totalUSD, 0.22);
  assert.equal(m.timing.meanWallS, 50);
});

test('computeMetrics: empty input yields zeros and null costs, never NaN', () => {
  const m = computeMetrics([], []);
  assert.equal(m.total, 0);
  assert.equal(m.accuracyRate, null);
  assert.equal(m.cost.meanPerPublishedUSD, null);
  assert.equal(m.cost.maxPerPublishedUSD, null);
  assert.equal(m.timing.meanWallS, null);
  assert.ok(Number.isFinite(m.cost.totalUSD));
});

test('computeMetrics: pages carry their class for the report', () => {
  const m = computeMetrics([line({ sourceId: 'x' })], [entry({ sourceId: 'x', note: 'n' })]);
  assert.equal(m.pages.length, 1);
  assert.equal(m.pages[0].sourceId, 'x');
  assert.equal(m.pages[0].class, 'correct-first-try');
  assert.equal(m.pages[0].expected, 'forces-1d-v1');
});

test('computeMetrics: manifest entries fill subject/difficulty when a result line lacks them', () => {
  const bare = { sourceId: 'y', candidate: 9, expected: 'timeline-v1', acceptable: [], status: 'succeeded', engine: 'timeline-v1', publishedRevision: 1, revisions: 1 } as unknown as EvalResultLine;
  const m = computeMetrics([bare], [entry({ sourceId: 'y', candidate: 9, subject: 'history', expected: 'timeline-v1', difficulty: 'hard' })]);
  assert.equal(m.pages[0].subject, 'history');
  assert.equal(m.byDifficulty.hard.total, 1);
});

test('renderSummaryMarkdown: states the sample size and every class, and handles empty input', () => {
  const md = renderSummaryMarkdown(computeMetrics([line({ sourceId: 'a' })], []), { manifestTotal: 29 });
  assert.match(md, /1 of 29/);
  assert.match(md, /correct-first-try/);
  assert.match(md, /wrong-decline/);
  assert.match(md, /\| physics \|/);
  const empty = renderSummaryMarkdown(computeMetrics([], []), { manifestTotal: 29 });
  assert.match(empty, /0 of 29/);
  assert.doesNotMatch(empty, /NaN/);
});

/* ------------------------------------------------------------------ */
/* TASK-024b: analysis repairs count as natural repairs                 */
/* ------------------------------------------------------------------ */

function analysisRepairLine(over: Partial<EvalResultLine> = {}): EvalResultLine {
  return line({
    sourceId: 'an1',
    analysisRepairs: [{ attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: ['analysis.concept-ids'], remaining: [], passed: true }],
    ...over,
  });
}

test('classifyResult: publishing revision 1 after an analysis repair is correct-after-repair', () => {
  assert.equal(classifyResult(analysisRepairLine({ publishedRevision: 1, revisions: 1 })), 'correct-after-repair');
});

test('classifyResult: old records without analysisRepairs keep their class', () => {
  const old = line({ publishedRevision: 1, revisions: 1 });
  assert.equal('analysisRepairs' in old, false);
  assert.equal(classifyResult(old), 'correct-first-try');
  assert.equal(classifyResult(line({ publishedRevision: 2, revisions: 2 })), 'correct-after-repair');
});

test('classifyResult: analysis repair on an acceptable-engine expected-decline page is correct-after-repair', () => {
  assert.equal(
    classifyResult(analysisRepairLine({ expected: 'decline', acceptable: ['forces-1d-v1'], publishedRevision: 1 })),
    'correct-after-repair',
  );
  assert.equal(
    classifyResult(analysisRepairLine({ expected: 'decline', acceptable: [], publishedRevision: 1 })),
    'false-accept',
    'an engine outside expected/acceptable is never laundered by a repair',
  );
});

test('classifyResult: analysis repair cannot rescue a wrong engine or a failed job', () => {
  assert.equal(classifyResult(analysisRepairLine({ engine: 'lift-equation-v1' })), 'wrong-engine');
  assert.equal(
    classifyResult(analysisRepairLine({ status: 'failed', error: 'ANALYSIS_INVALID', engine: null, publishedRevision: null })),
    'failed',
  );
});

test('computeMetrics: analysis repairs join the natural repair counts', () => {
  const results = [
    analysisRepairLine({ sourceId: 'a1' }),
    line({
      sourceId: 'a2', publishedRevision: 2, revisions: 2,
      repairs: [{ revision: 2, targeted: ['behavior.tests'], fixed: ['behavior.tests'], remaining: [] }],
      firstRevisionFailedChecks: ['behavior.tests'],
    }),
    line({
      sourceId: 'a3', status: 'failed', error: 'ANALYSIS_INVALID', engine: null, publishedRevision: null,
      analysisRepairs: [
        { attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids'], passed: false },
        { attempt: 2, revision: 3, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids'], passed: false },
      ],
    }),
    line({ sourceId: 'a4' }),
  ];
  const m = computeMetrics(results, []);
  assert.equal(m.repairs.total, 4, 'one analysis + one spec + two failed analysis attempts');
  assert.equal(m.repairs.jobsWithRepairs, 3);
  assert.equal(m.repairs.analysisTotal, 3);
  assert.equal(m.repairs.jobsWithAnalysisRepairs, 2);
  assert.deepEqual(m.repairs.byTargetedCheck, { 'analysis.concept-ids': 3, 'behavior.tests': 1 });
  assert.equal(m.byClass['correct-after-repair'], 2, 'a1 (analysis repair) + a2 (spec repair)');
  assert.equal(m.byClass['correct-first-try'], 1);
  assert.equal(m.byClass.failed, 1);
});

test('renderSummaryMarkdown: mentions analysis repairs and stays valid without them', () => {
  const md = renderSummaryMarkdown(computeMetrics([analysisRepairLine({})], []), { manifestTotal: 29 });
  assert.match(md, /Analysis repair attempts: \*\*1\*\*/);
  const without = renderSummaryMarkdown(computeMetrics([line({ sourceId: 'b' })], []), { manifestTotal: 29 });
  assert.match(without, /Analysis repair attempts: \*\*0\*\*/);
  assert.doesNotMatch(without, /NaN/);
});
