/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FaultRecord, RepairRecord, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import {
  BADGE_REPAIRED, BADGE_REPAIRED_AFTER_FAULT, buildRepairSteps, defaultRevision, demoFaultNotice, faultChangeText, overallRepairBadge,
  repairAttemptCount, revisionInputs, runTags, validationHeading,
} from './repairs.ts';

const report = (revision: number, failing: string[], passing: string[] = ['schema.full', 'refs.sources'], publishable?: boolean): ValidationReport => ({
  artifactId: 'a', revision,
  checks: [
    ...passing.map((id) => ({ id, kind: 'semantic' as const, passed: true, message: 'ok' })),
    ...failing.map((id) => ({ id, kind: 'behavioral' as const, passed: false, message: 'bad' })),
  ],
  publishable: publishable ?? failing.length === 0,
});

const FAULT: FaultRecord = { kind: 'wrong-answer', path: 'behavioralTests[0].expectedLiftN', original: 12250, injected: 18376, revision: 1 };

const rec = (over: Partial<RepairRecord> & Pick<RepairRecord, 'revision'>): RepairRecord => ({
  repairOf: over.revision - 1, targeted: [], fixed: [], remaining: [], publishable: false, afterInjectedFault: false, ...over,
});

const ev = (seq: number, stage: StageEvent['stage'], status: StageEvent['status'], extra: Partial<StageEvent> = {}): StageEvent =>
  ({ jobId: 'j', seq, stage, status, at: '2026-10-28T00:00:00.000Z', ...extra });

test('demoFaultNotice: exact honest wording, never a model error', () => {
  assert.equal(
    demoFaultNotice(FAULT),
    'Demo fault injected by the system (not a model error): wrong-answer at behavioralTests[0].expectedLiftN',
  );
  assert.equal(
    demoFaultNotice({ kind: 'fabricated-quote', path: 'explanations[0].evidence[0].quote' }),
    'Demo fault injected by the system (not a model error): fabricated-quote at explanations[0].evidence[0].quote',
  );
});

test('faultChangeText: numbers and quotes', () => {
  assert.equal(faultChangeText(FAULT), 'value 12250 → 18376');
  const q = faultChangeText({ original: 'Lift acts perpendicular to the oncoming flow.', injected: 'A sentence that the source never contains. [nonce 9f3a]' });
  assert.ok(q.startsWith('quote “Lift acts perpendicular'));
  assert.ok(q.includes('→ “A sentence that the source never contains.'));
});

test('overallRepairBadge: only when a later revision was published; fault runs never say just "repaired"', () => {
  assert.equal(overallRepairBadge({}), null);
  assert.equal(overallRepairBadge({ publishedRevision: 1 }), null);
  assert.equal(overallRepairBadge({ publishedRevision: undefined, repairs: [rec({ revision: 2 })] }), null);
  assert.deepEqual(overallRepairBadge({ publishedRevision: 2, repairs: [rec({ revision: 2, publishable: true })] }), { text: 'Repaired by Muse', tone: 'ok' });
  assert.equal(BADGE_REPAIRED, 'Repaired by Muse');
  assert.deepEqual(overallRepairBadge({ publishedRevision: 2, demoFault: FAULT, repairs: [rec({ revision: 2, publishable: true, afterInjectedFault: true })] }),
    { text: 'System-made fault, repaired by Muse', tone: 'fault' });
  assert.equal(BADGE_REPAIRED_AFTER_FAULT, 'System-made fault, repaired by Muse');
  // the record alone also marks it, even if the fault summary were missing
  assert.equal(overallRepairBadge({ publishedRevision: 3, repairs: [rec({ revision: 2 }), rec({ revision: 3, publishable: true, afterInjectedFault: true })] })?.text, BADGE_REPAIRED_AFTER_FAULT);
});

test('runTags: demo-fault marker plus repair badge', () => {
  assert.deepEqual(runTags({}), []);
  assert.deepEqual(runTags({ publishedRevision: 2 }).map((t) => t.text), [BADGE_REPAIRED]);
  assert.deepEqual(runTags({ publishedRevision: 2, demoFault: FAULT }).map((t) => t.text), ['Demo fault (system-made)', BADGE_REPAIRED_AFTER_FAULT]);
  assert.deepEqual(runTags({ demoFault: FAULT }).map((t) => t.text), ['Demo fault (system-made)']);
});

test('buildRepairSteps: revision 1 with injected fault → revision 2 repair that fixes it', () => {
  const events = [
    ev(0, 'inject', 'succeeded', { revision: 1, detail: 'demo fault injected by the system: wrong-answer at behavioralTests[0].expectedLiftN' }),
    ev(1, 'repair', 'started', { revision: 2, detail: 'targeted checks: behavior.tests' }),
    ev(2, 'repair', 'succeeded', { revision: 2, model: 'muse-spark-1.3', responseId: 'chatcmpl-abcdef0123456789', estCostUSD: 0.0301, detail: 'repaired revision 1' }),
  ];
  const steps = buildRepairSteps({
    revisions: [{ revision: 2, report: report(2, []) }, { revision: 1, report: report(1, ['behavior.tests']) }],
    repairs: [rec({ revision: 2, targeted: ['behavior.tests'], fixed: ['behavior.tests'], remaining: [], publishable: true, afterInjectedFault: true })],
    demoFault: FAULT, events, publishedRevision: 2,
  });
  assert.deepEqual(steps.map((s) => s.revision), [1, 2]);
  const [r1, r2] = steps;
  assert.ok(r1 !== undefined && r2 !== undefined);
  assert.equal(r1.role, 'initial');
  assert.equal(r1.faultNotice, 'Demo fault injected by the system (not a model error): wrong-answer at behavioralTests[0].expectedLiftN');
  assert.equal(r1.badge?.text, 'Demo fault injected by the system');
  assert.deepEqual(r1.failedIds, ['behavior.tests']);
  assert.equal(r1.publishable, false);
  assert.equal(r1.passed, 2);
  assert.equal(r1.total, 3);
  assert.equal(r2.role, 'repair');
  assert.equal(r2.repairOf, 1);
  assert.deepEqual([r2.targeted, r2.fixed, r2.remaining, r2.introduced], [['behavior.tests'], ['behavior.tests'], [], []]);
  assert.equal(r2.badge?.text, 'System-made fault, repaired by Muse');
  assert.equal(r2.faultNotice, null);
  assert.equal(r2.isPublished, true);
  assert.equal(r2.actor?.model, 'muse-spark-1.3');
  assert.equal(r2.actor?.cost, '$0.0301 est.');
  assert.match(r2.outcome, /Fixed 1 of 1 targeted check; all machine checks now pass\./);
});

test('buildRepairSteps: a model-made failure repaired over two revisions says only "Repaired by Muse"', () => {
  const steps = buildRepairSteps({
    revisions: [
      { revision: 1, report: report(1, ['behavior.tests', 'grounding.quotes']) },
      { revision: 2, report: report(2, ['grounding.quotes', 'semantic.tolerance']) },
      { revision: 3, report: report(3, []) },
    ],
    repairs: [
      rec({ revision: 2, targeted: ['behavior.tests', 'grounding.quotes'], fixed: ['behavior.tests'], remaining: ['grounding.quotes', 'semantic.tolerance'] }),
      rec({ revision: 3, targeted: ['grounding.quotes', 'semantic.tolerance'], fixed: ['grounding.quotes', 'semantic.tolerance'], remaining: [], publishable: true }),
    ],
    publishedRevision: 3,
  });
  assert.equal(steps.length, 3);
  const [r1, r2, r3] = steps;
  assert.ok(r1 && r2 && r3);
  assert.equal(r1.badge, null);
  assert.equal(r1.faultNotice, null);
  assert.equal(r2.badge, null); // not publishable yet: no "repaired" claim
  assert.deepEqual(r2.introduced, ['semantic.tolerance']);
  assert.match(r2.outcome, /Fixed 1 of 2 targeted checks; 2 still failing \(1 new\)\./);
  assert.equal(r3.badge?.text, 'Repaired by Muse');
  assert.equal(r3.isPublished, true);
  assert.equal(r2.isPublished, false);
  // no repair events recorded → model and cost are unknown, never invented
  assert.equal(r3.actor, null);
});

test('buildRepairSteps: unrepaired run marks the best revision and keeps a failed repair attempt visible', () => {
  const events = [
    ev(0, 'repair', 'started', { revision: 2 }),
    ev(1, 'repair', 'succeeded', { revision: 2, model: 'muse-spark-1.3', estCostUSD: 0.02, detail: 'repaired revision 1' }),
    ev(2, 'repair', 'started', { revision: 3 }),
    ev(3, 'repair', 'failed', { revision: 3, model: 'muse-spark-1.3', detail: 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)' }),
  ];
  const steps = buildRepairSteps({
    revisions: [{ revision: 1, report: report(1, ['a', 'b', 'c']) }, { revision: 2, report: report(2, ['a']) }],
    repairs: [rec({ revision: 2, targeted: ['a', 'b', 'c'], fixed: ['b', 'c'], remaining: ['a'] })],
    events, bestRevision: 2,
  });
  assert.deepEqual(steps.map((s) => [s.revision, s.failedAttempt]), [[1, false], [2, false], [3, true]]);
  assert.equal(steps[1]?.isBest, true);
  assert.equal(steps[1]?.isPublished, false);
  assert.equal(steps[1]?.badge, null);
  assert.equal(steps[2]?.actor?.failed, true);
  assert.equal(steps[2]?.actor?.cost, 'cost unknown'); // reservation with no recorded amount is never "free"
  assert.deepEqual(steps[2]?.targeted, ['a']);
});

test('buildRepairSteps: a single revision without a fault is one plain step; with no data there are no steps', () => {
  assert.equal(buildRepairSteps({ revisions: [] }).length, 0);
  const one = buildRepairSteps({ revisions: [{ revision: 1, report: report(1, []) }], publishedRevision: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0]?.badge, null);
  assert.equal(one[0]?.outcome, 'All machine checks passed on the first try.');
});

test('buildRepairSteps: fault on a run whose repair is missing from the summary falls back to events/report', () => {
  const steps = buildRepairSteps({
    revisions: [{ revision: 1, report: report(1, ['behavior.tests']) }, { revision: 2, report: report(2, []) }],
    demoFault: FAULT, publishedRevision: 2,
  });
  assert.deepEqual(steps[1]?.targeted, ['behavior.tests']);
  assert.deepEqual(steps[1]?.fixed, ['behavior.tests']);
  assert.equal(steps[1]?.badge?.text, BADGE_REPAIRED_AFTER_FAULT);
});

test('repairAttemptCount: recorded repairs plus repair calls that failed without a revision', () => {
  assert.equal(repairAttemptCount(undefined, undefined), 0);
  assert.equal(repairAttemptCount([rec({ revision: 2 })], []), 1);
  assert.equal(repairAttemptCount([rec({ revision: 2 })], [ev(0, 'repair', 'failed', { revision: 3 })]), 2);
  // the same revision seen in both places counts once; started events never count on their own
  assert.equal(repairAttemptCount([rec({ revision: 2 })], [ev(0, 'repair', 'failed', { revision: 2 }), ev(1, 'repair', 'started', { revision: 3 })]), 1);
});

test('defaultRevision / validationHeading / revisionInputs', () => {
  const revs = [{ revision: 1 }, { revision: 2 }, { revision: 3 }];
  assert.equal(defaultRevision(revs, { publishedRevision: 2 }), 2);
  assert.equal(defaultRevision(revs, { bestRevision: 1 }), 1);
  assert.equal(defaultRevision(revs, {}), 3);
  assert.equal(defaultRevision(revs, { publishedRevision: 9 }), 3); // unknown revision ignored
  assert.equal(defaultRevision([], {}), null);
  assert.equal(validationHeading(null, 0, undefined), 'Validation');
  assert.equal(validationHeading(1, 1, 1), 'Validation');
  assert.equal(validationHeading(2, 3, 2), 'Validation · revision 2 (published)');
  assert.equal(validationHeading(1, 3, 2), 'Validation · revision 1 (not published)');
  assert.equal(validationHeading(3, 3, undefined), 'Validation · revision 3');

  const r = report(1, []);
  assert.deepEqual(revisionInputs({ revisions: [{ revision: 1, report: r }], summary: {} }), [{ revision: 1, report: r }]);
  // an older server returns only spec/report: it becomes the single revision
  assert.deepEqual(revisionInputs({ report: r, summary: {} }), [{ revision: 1, report: r }]);
  assert.deepEqual(revisionInputs({ report: r, summary: { publishedRevision: 2 } }), [{ revision: 2, report: r }]);
  assert.deepEqual(revisionInputs({ summary: {} }), []);
});
