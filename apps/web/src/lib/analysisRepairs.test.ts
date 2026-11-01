/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SourceAnalysis, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import {
  ANALYSIS_REPAIR_LABEL, analysisCheckName, analysisCheckPlain, analysisIssuesRepaired, analysisRepairOverall, analysisRepairTags,
  analysisRepairNote, buildAnalysisRepairSteps, naturalRepairNote, describeChange, diffAnalyses, repairSummaryText,
} from './analysisRepairs.ts';

const LONG_ID = 'velocity-and-displacement-under-constant-acceleration';
const SHORT_ID = 'constant-acceleration-kinematics';
const SRC = 'nasa-grc-motion-of-free-falling-object';

const analysis = (conceptId = LONG_ID, over: Partial<SourceAnalysis> = {}): SourceAnalysis => ({
  supported: true, activity: 'forces-1d-v1', unsupportedReason: '',
  concepts: [
    { id: 'newtons-second-law', name: 'Newton’s second law for free fall', evidence: [{ sourceId: SRC, quote: 'its motion is described by Newton’s second law of motion.' }] },
    { id: conceptId, name: 'Velocity and displacement under constant acceleration', evidence: [{ sourceId: SRC, quote: 'V = a * t' }, { sourceId: SRC, quote: 'X = (1 / 2) * a * t^2' }] },
  ],
  objectives: ['Describe free-falling motion', 'Calculate velocity and displacement'],
  ...over,
});

const report = (revision: number, failing: Array<[string, string]> = [], extra: string[] = []): ValidationReport => ({
  artifactId: 'a', revision,
  checks: [
    ...['schema.analysis', 'analysis.invariants', 'analysis.concept-ids', 'refs.sources', 'grounding.quotes', 'policy.no-publisher-attribution', ...extra]
      .filter((id) => !failing.some(([f]) => f === id))
      .map((id) => ({ id, kind: 'semantic' as const, passed: true, message: 'ok' })),
    ...failing.map(([id, message]) => ({ id, kind: 'semantic' as const, passed: false, message })),
  ],
  publishable: failing.length === 0,
});

const ev = (seq: number, status: StageEvent['status'], extra: Partial<StageEvent> = {}): StageEvent =>
  ({ jobId: 'j', seq, stage: 'repair', status, at: '2026-10-28T00:00:00.000Z', target: 'analysis', ...extra });

const CONCEPT_FAIL: [string, string] = ['analysis.concept-ids', `concept ids not matching /^[a-z0-9-]{1,40}$/: "${LONG_ID}"`];
const REC = { attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: ['analysis.concept-ids'], remaining: [], passed: true };

test('LONG_ID is 53 characters and SHORT_ID 32 (the recorded example)', () => {
  assert.equal(LONG_ID.length, 53);
  assert.equal(SHORT_ID.length, 32);
});

test('analysisCheckName: readable names for every analysis check, null for unknown ids', () => {
  assert.equal(analysisCheckName('analysis.concept-ids'), 'Concept ids are short and well-formed');
  assert.equal(analysisCheckName('repair.analysis-unchanged'), 'The repair changed only what the check named');
  for (const id of ['schema.analysis', 'analysis.invariants', 'refs.sources', 'grounding.quotes', 'policy.no-publisher-attribution']) {
    const n = analysisCheckName(id);
    assert.ok(n !== null && n.length > 8 && !n.includes('.'), `${id} -> ${n}`);
    const plain = analysisCheckPlain(id);
    assert.ok(plain !== null && plain.length > 20, id);
  }
  assert.equal(analysisCheckName('timeline.unique-ids'), null);
  assert.equal(analysisCheckName('toString'), null);
  assert.equal(analysisCheckPlain('constructor'), null);
});

test('diffAnalyses: the recorded concept-id rename, with character counts', () => {
  const changes = diffAnalyses(analysis(LONG_ID), analysis(SHORT_ID));
  assert.equal(changes.length, 1);
  const c = changes[0];
  assert.ok(c !== undefined);
  assert.equal(c.kind, 'concept-id');
  assert.equal(c.before, LONG_ID);
  assert.equal(c.after, SHORT_ID);
  assert.equal(c.beforeNote, '53 characters');
  assert.equal(c.afterNote, '32 characters');
  assert.match(c.label, /Velocity and displacement under constant acceleration/);
  assert.equal(describeChange(c), `Concept id (concept “Velocity and displacement under constant acceleration”): “${LONG_ID}” (53 characters) → “${SHORT_ID}” (32 characters)`);
});

test('diffAnalyses: identical, malformed and missing inputs give no changes and never throw', () => {
  assert.deepEqual(diffAnalyses(analysis(), analysis()), []);
  assert.deepEqual(diffAnalyses(undefined, analysis()), []);
  assert.deepEqual(diffAnalyses(analysis(), null), []);
  assert.deepEqual(diffAnalyses({ concepts: 'x' }, { objectives: 3 }), []);
});

test('diffAnalyses: name, evidence, objectives, reason, decision, added and removed concepts', () => {
  const before = analysis(SHORT_ID);
  const after = analysis(SHORT_ID, {
    objectives: ['Describe free-falling motion', 'Predict velocity after a given time', 'Use the displacement formula'],
    concepts: [
      { id: 'newtons-second-law', name: 'Newton’s second law', evidence: [{ sourceId: SRC, quote: 'its motion is described by Newton’s second law of motion.' }, { sourceId: SRC, quote: 'The acceleration is constant' }] },
      { id: 'new-concept', name: 'A new concept', evidence: [] },
    ],
  });
  const kinds = diffAnalyses(before, after).map((c) => c.kind);
  assert.deepEqual(kinds.sort(), ['concept-added', 'concept-name', 'concept-removed', 'objective', 'objective', 'quote-added'].sort());
  const decision = diffAnalyses(analysis(), analysis(LONG_ID, { supported: false, activity: 'none', unsupportedReason: 'No fit.' }));
  assert.deepEqual(decision.map((c) => c.kind).sort(), ['decision', 'reason']);
  const dec = decision.find((c) => c.kind === 'decision');
  assert.match(dec?.before ?? '', /^Supported/);
  assert.equal(dec?.after, 'Declined');
});

test('diffAnalyses: removed quotes are reported, long quotes are shortened', () => {
  const longQuote = 'q '.repeat(100).trim();
  const before = analysis(SHORT_ID);
  const first = before.concepts[0];
  assert.ok(first !== undefined);
  first.evidence.push({ sourceId: SRC, quote: longQuote });
  const changes = diffAnalyses(before, analysis(SHORT_ID));
  assert.deepEqual(changes.map((c) => c.kind), ['quote-removed']);
  assert.ok((changes[0]?.before ?? '').length < 90);
});

test('describeChange: added and removed values read naturally', () => {
  assert.equal(describeChange({ kind: 'objective', label: 'Objective 2', before: null, after: 'Do X' }), 'Objective 2: added “Do X”');
  assert.equal(describeChange({ kind: 'objective', label: 'Objective 2', before: 'Do X', after: null }), 'Objective 2: removed “Do X”');
});

test('analysisIssuesRepaired / repairSummaryText: counts distinct fixed issues, honest on failure', () => {
  assert.equal(analysisIssuesRepaired([REC]), 1);
  assert.equal(analysisIssuesRepaired(undefined), 0);
  assert.equal(analysisIssuesRepaired([]), 0);
  assert.equal(repairSummaryText({ analysisRepairs: [REC] }), 'Repaired 1 analysis issue');
  const two = [
    { attempt: 1, revision: 2, targeted: ['schema.analysis', 'analysis.concept-ids'], fixed: ['analysis.concept-ids'], remaining: ['schema.analysis'], passed: false },
    { attempt: 2, revision: 3, targeted: ['schema.analysis'], fixed: ['schema.analysis'], remaining: [], passed: true },
  ];
  assert.equal(repairSummaryText({ analysisRepairs: two }), 'Repaired 2 analysis issues');
  assert.equal(repairSummaryText({ analysisRepairs: [{ ...REC, fixed: [], remaining: ['analysis.concept-ids'], passed: false }] }), 'Analysis repair failed (1 attempt)');
  assert.equal(repairSummaryText({ analysisRepairs: [] }), null);
  assert.equal(repairSummaryText({}), null);
  assert.equal(
    repairSummaryText({ analysisRepairs: [REC], publishedRevision: 2, repairs: [{ revision: 2, repairOf: 1, targeted: ['x'], fixed: ['x'], remaining: [], publishable: true, afterInjectedFault: false }] }),
    'Repaired 1 analysis issue and 1 spec issue',
  );
  assert.equal(
    repairSummaryText({ analysisRepairs: [REC], publishedRevision: 2, demoFault: { kind: 'wrong-answer', path: 'p', original: 1, injected: 2, revision: 1 }, repairs: [{ revision: 2, repairOf: 1, targeted: ['x', 'y'], fixed: ['x', 'y'], remaining: [], publishable: true, afterInjectedFault: true }] }),
    'Repaired 1 analysis issue and 2 spec issues (the spec fault was system-made)',
  );
});

test('analysisRepairTags: natural tag for a pass, bad tag for a failure, nothing without analysis repairs', () => {
  assert.deepEqual(analysisRepairTags({}), []);
  assert.deepEqual(analysisRepairTags({ analysisRepairs: [] }), []);
  assert.deepEqual(analysisRepairTags({ analysisRepairs: [REC] }), [{ text: 'Repaired 1 analysis issue', tone: 'natural' }]);
  assert.deepEqual(analysisRepairTags({ analysisRepairs: [{ ...REC, passed: false, fixed: [], remaining: ['analysis.concept-ids'] }] }), [{ text: 'Analysis repair failed', tone: 'bad' }]);
});

const EVENTS: StageEvent[] = [
  ev(3, 'started', { revision: 2, detail: 'analysis repair 1; targeted checks: analysis.concept-ids' }),
  ev(4, 'succeeded', { revision: 2, model: 'muse-spark-1.3', responseId: 'chatcmpl-01a183bb-9d2b-7096-89f4-a5712af98a2e', estCostUSD: 0.01047575, latencyMs: 9423, detail: 'analysis repair 1 passed; 7/7 checks passed' }),
  // A SPEC repair of the same revision number must never be mixed in.
  { jobId: 'j', seq: 9, stage: 'repair', status: 'succeeded', at: 'x', revision: 2, model: 'spec-model', estCostUSD: 9, detail: 'repaired revision 1' },
];

test('buildAnalysisRepairSteps: a passed natural repair, with before/after, names, checks and cost', () => {
  const steps = buildAnalysisRepairSteps({
    revisions: [{ revision: 1, analysis: analysis(LONG_ID), report: report(1, [CONCEPT_FAIL]) }, { revision: 2, analysis: analysis(SHORT_ID), report: report(2, [], ['repair.analysis-unchanged']) }],
    analysisRepairs: [REC], events: EVENTS,
  });
  assert.equal(steps.length, 1);
  const s = steps[0];
  assert.ok(s !== undefined);
  assert.equal(s.attempt, 1);
  assert.equal(s.revision, 2);
  assert.equal(s.repairOf, 1);
  assert.equal(s.state, 'passed');
  assert.equal(s.label, ANALYSIS_REPAIR_LABEL);
  assert.equal(ANALYSIS_REPAIR_LABEL, 'Revised by Muse after a failed check');
  assert.deepEqual(s.failedBefore.map((f) => [f.id, f.name]), [['analysis.concept-ids', 'Concept ids are short and well-formed']]);
  assert.match(s.failedBefore[0]?.plain ?? '', /40 characters/);
  assert.match(s.failedBefore[0]?.message ?? '', /velocity-and-displacement/);
  assert.deepEqual(s.targeted.map((t) => t.name), ['Concept ids are short and well-formed']);
  assert.deepEqual(s.fixed.map((t) => t.id), ['analysis.concept-ids']);
  assert.deepEqual(s.remaining, []);
  assert.equal(s.changes.length, 1);
  assert.equal(s.hasDiff, true);
  assert.deepEqual(s.after && [s.after.passed, s.after.total], [7, 7]);
  assert.ok(s.after?.checks.some((c) => c.id === 'repair.analysis-unchanged' && c.name === 'The repair changed only what the check named' && c.passed));
  assert.equal(s.actor?.model, 'muse-spark-1.3');
  assert.equal(s.actor?.cost, '$0.0105 est.');
  assert.equal(s.costUSD, 0.01047575);
  assert.match(s.outcome, /passed/);
});

test('buildAnalysisRepairSteps: a repair that still fails is shown as failed, with what remains', () => {
  const rec = { attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids', 'repair.analysis-unchanged'], passed: false };
  const steps = buildAnalysisRepairSteps({
    revisions: [{ revision: 1, analysis: analysis(LONG_ID), report: report(1, [CONCEPT_FAIL]) },
      { revision: 2, analysis: analysis(LONG_ID, { objectives: ['x'] }), report: report(2, [CONCEPT_FAIL, ['repair.analysis-unchanged', 'repair changed objectives without a finding naming them']]) }],
    analysisRepairs: [rec],
    events: [ev(1, 'started', { revision: 2 }), ev(2, 'succeeded', { revision: 2, model: 'muse-spark-1.3', estCostUSD: 0.02, detail: 'analysis repair 1 still failing checks: analysis.concept-ids, repair.analysis-unchanged' })],
  });
  const s = steps[0];
  assert.ok(s !== undefined);
  assert.equal(s.state, 'still-failing');
  assert.deepEqual(s.fixed, []);
  assert.deepEqual(s.remaining.map((r) => r.id), ['analysis.concept-ids', 'repair.analysis-unchanged']);
  assert.match(s.outcome, /still failing/i);
  assert.equal(analysisRepairOverall({ analysisRepairs: [rec], events: [] }).state, 'failed');
});

test('buildAnalysisRepairSteps: a repair call that produced nothing, and a repair still running', () => {
  const failed = buildAnalysisRepairSteps({
    revisions: [{ revision: 1, analysis: analysis(LONG_ID), report: report(1, [CONCEPT_FAIL]) }],
    analysisRepairs: [],
    events: [ev(1, 'started', { revision: 2 }), ev(2, 'failed', { revision: 2, model: 'muse-spark-1.3', estCostUSD: 0.011, detail: 'OUTPUT_INVALID' })],
  });
  assert.equal(failed.length, 1);
  assert.equal(failed[0]?.state, 'call-failed');
  assert.equal(failed[0]?.actor?.failed, true);
  assert.deepEqual(failed[0]?.failedBefore.map((f) => f.id), ['analysis.concept-ids']);
  assert.equal(failed[0]?.after, null);
  assert.equal(failed[0]?.hasDiff, false);
  const running = buildAnalysisRepairSteps({
    revisions: [{ revision: 1, analysis: analysis(LONG_ID), report: report(1, [CONCEPT_FAIL]) }],
    analysisRepairs: [], events: [ev(1, 'started', { revision: 2 })],
  });
  assert.equal(running[0]?.state, 'running');
  assert.equal(analysisRepairOverall({ analysisRepairs: [], events: [ev(1, 'started', { revision: 2 })] }).state, 'running');
});

test('buildAnalysisRepairSteps: spec-repair events and jobs without analysis repairs yield nothing', () => {
  const specOnly: StageEvent[] = [
    { jobId: 'j', seq: 1, stage: 'repair', status: 'started', at: 'x', revision: 2 },
    { jobId: 'j', seq: 2, stage: 'repair', status: 'failed', at: 'x', revision: 2, target: 'spec', detail: 'OUTPUT_INVALID' },
  ];
  assert.deepEqual(buildAnalysisRepairSteps({ revisions: [], analysisRepairs: undefined, events: specOnly }), []);
  assert.deepEqual(buildAnalysisRepairSteps({ revisions: [], analysisRepairs: [], events: [] }), []);
  assert.equal(analysisRepairOverall({ analysisRepairs: undefined, events: specOnly }).state, 'none');
});

test('buildAnalysisRepairSteps: two attempts, the second compared with the first repair', () => {
  const rec1 = { attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids'], passed: false };
  const rec2 = { attempt: 2, revision: 3, targeted: ['analysis.concept-ids'], fixed: ['analysis.concept-ids'], remaining: [], passed: true };
  const steps = buildAnalysisRepairSteps({
    revisions: [
      { revision: 1, analysis: analysis(LONG_ID), report: report(1, [CONCEPT_FAIL]) },
      { revision: 2, analysis: analysis(`${LONG_ID}-x`), report: report(2, [CONCEPT_FAIL]) },
      { revision: 3, analysis: analysis(SHORT_ID), report: report(3, [], ['repair.analysis-unchanged']) },
    ],
    analysisRepairs: [rec1, rec2], events: [],
  });
  assert.deepEqual(steps.map((s) => [s.attempt, s.repairOf, s.state]), [[1, 1, 'still-failing'], [2, 2, 'passed']]);
  assert.equal(steps[1]?.changes[0]?.before, `${LONG_ID}-x`);
  assert.equal(steps[0]?.actor, null);
  assert.equal(steps[0]?.costUSD, null);
});

test('the real recorded job job-20261028181732-c760fe12 renders its concept-id repair', () => {
  const dir = new URL('../../../../docs/evidence/stage-5b/evaluation-rerun-hard/jobs/job-20261028181732-c760fe12/', import.meta.url);
  const read = (f: string): unknown => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  const job = read('job.json') as { analysisRepairs: typeof REC[] };
  const r1 = read('analysis.r1.json') as { analysis: SourceAnalysis; report: ValidationReport };
  const r2 = read('analysis.r2.json') as { analysis: SourceAnalysis; report: ValidationReport };
  const events = readFileSync(new URL('events.jsonl', dir), 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as StageEvent);
  const steps = buildAnalysisRepairSteps({ revisions: [{ revision: 1, ...r1 }, { revision: 2, ...r2 }], analysisRepairs: job.analysisRepairs, events });
  assert.equal(steps.length, 1);
  const s = steps[0];
  assert.ok(s !== undefined);
  assert.equal(s.state, 'passed');
  assert.equal(s.changes.length, 1);
  assert.equal(describeChange(s.changes[0] ?? { kind: 'objective', label: '', before: null, after: null }).includes('(53 characters) → “constant-acceleration-kinematics” (32 characters)'), true);
  assert.equal(s.after?.passed, 7);
  assert.equal(s.after?.total, 7);
  assert.equal(s.actor?.model, 'muse-spark-1.3');
  assert.equal(repairSummaryText({ analysisRepairs: job.analysisRepairs }), 'Repaired 1 analysis issue');
});

test('analysisRepairNote: says what was repaired, or honestly that no attempt passed', () => {
  assert.equal(analysisRepairNote(undefined), null);
  assert.equal(analysisRepairNote([]), null);
  assert.equal(
    analysisRepairNote([REC]),
    'Muse’s first analysis failed 1 check (Concept ids are short and well-formed). Muse repaired it, and every check then passed.',
  );
  assert.equal(
    analysisRepairNote([{ attempt: 1, revision: 2, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids'], passed: false }, { attempt: 2, revision: 3, targeted: ['analysis.concept-ids'], fixed: [], remaining: ['analysis.concept-ids', 'repair.analysis-unchanged'], passed: false }]),
    'Muse made 2 analysis repair attempts, but the analysis still failed: Concept ids are short and well-formed; The repair changed only what the check named.',
  );
  assert.equal(
    analysisRepairNote([{ ...REC, targeted: ['schema.analysis', 'refs.sources'], fixed: ['schema.analysis', 'refs.sources'] }]),
    'Muse’s first analysis failed 2 checks (The analysis follows the required structure; Every cited source exists). Muse repaired it, and every check then passed.',
  );
});

test('naturalRepairNote: never claims a repair that did not happen', () => {
  assert.match(naturalRepairNote('passed'), /^Revised by Muse after a failed check\./);
  assert.match(naturalRepairNote('passed'), /Muse repaired it/);
  const failed = naturalRepairNote('failed');
  assert.match(failed, /^Muse’s revision did not pass\./);
  assert.match(failed, /did not fix it/);
  assert.doesNotMatch(failed, /repaired it/);
  assert.match(failed, /system-made demo fault/);
  assert.match(naturalRepairNote('running'), /is repairing/);
});
