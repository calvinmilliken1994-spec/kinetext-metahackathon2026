// Wave A3 (Stage 6 review S6R-01 validation side, S6R-10): the usable-analysis gate that runs the
// overview checks OV-01..OV-06 next to A-01..A-11, and the append-only repair exception for an
// undersized, validator-authorised analysis list. Turned from the reviewer probes
// `overview-bypassed` and `analysis-count-repair` (cache/scratch/review-s6/publish-probes.mjs).
// Run: node --test packages/validation/stage6-a3-gate.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { SourceAnalysisV2 } from '../contracts/index.ts';
import * as V from './analysis-v2.ts';
import { validateAnalysisV2, compareAnalysisV2Revisions, analysisV2RepairAuthority } from './analysis-v2.ts';
import { validateKitComponent } from './kit/index.ts';
import { affectedPathsOf } from './validate.ts';
import { checkOf, clone, declinedAnalysis, dragSource, failedIds, stubSource, usableAnalysis } from './fixtures/stage6.ts';

type Gate = (analysis: unknown, sources: ReturnType<typeof dragSource>[]) => ReturnType<typeof validateAnalysisV2>;
const gate = (): Gate => {
  const fn = (V as unknown as { validateLessonAnalysisGate?: Gate }).validateLessonAnalysisGate;
  assert.equal(typeof fn, 'function', 'analysis-v2.ts must export validateLessonAnalysisGate(analysis, sources)');
  return fn as Gate;
};

const A_IDS = ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06', 'A-07', 'A-08', 'A-09', 'A-10', 'A-11'];
const OV_IDS = ['OV-01', 'OV-02', 'OV-03', 'OV-04', 'OV-05', 'OV-06'];

function mismatched(): SourceAnalysisV2 {
  // reviewer probe `overview-bypassed`: real drag quotes kept, unrelated point / invented term
  const a = clone(usableAnalysis());
  a.overview.keyPoints[0]!.point = 'Bananas become purple while mountains sing softly.';
  a.overview.keyTerms[0]!.term = 'teleportation';
  a.overview.keyTerms[0]!.gloss = 'Teleportation moves mountains between distant planets.';
  return a;
}

/* ------------------------------------------------------------------ */
/* S6R-01 — the gate                                                   */
/* ------------------------------------------------------------------ */

test('golden usable analysis passes the whole gate (A-01..A-11 and OV-01..OV-06): the golden wording is now honest under OV-06', () => {
  const report = gate()(usableAnalysis(), [dragSource()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n'));
  assert.equal(report.publishable, true);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.analysis-v2', ...A_IDS, ...OV_IDS]);
});

test('the golden overview itself passes OV-06 with no rewording helper (fixture wording fixed, check not disabled)', () => {
  const report = validateKitComponent('overview-v1', usableAnalysis().overview, [dragSource()]);
  assert.deepEqual(failedIds(report), []);
});

test('overview-bypassed: validateAnalysisV2 alone accepts unrelated points, the gate rejects them with OV-02 and OV-06', () => {
  const a = mismatched();
  assert.equal(validateAnalysisV2(a, [dragSource()]).publishable, true, 'this is the gap the gate closes');
  const report = gate()(a, [dragSource()]);
  assert.equal(report.publishable, false);
  const failed = failedIds(report);
  assert.ok(failed.includes('OV-02'), failed.join());
  assert.ok(failed.includes('OV-06'), failed.join());
  assert.equal(failed.some(id => id.startsWith('A-')), false, 'only the overview checks catch this');
});

test('every OV affected pointer is prefixed /overview and field-scoped (joins the revision-1 authority)', () => {
  const report = gate()(mismatched(), [dragSource()]);
  const ov06 = checkOf(report, 'OV-06');
  assert.deepEqual(ov06.affected, ['/overview/keyPoints/0/point', '/overview/keyTerms/0/gloss']);
  assert.equal(ov06.path, '/overview/keyPoints/0/point');
  const ov02 = checkOf(report, 'OV-02');
  assert.deepEqual(ov02.affected, ['/overview/keyTerms/0/term', '/overview/keyTerms/0/quote']);
  for (const c of report.checks.filter(x => !x.passed && x.id.startsWith('OV-'))) {
    for (const p of c.affected ?? []) assert.ok(p.startsWith('/overview/'), `${c.id} pointer ${p} must be /overview-prefixed`);
  }
  // the repair authority recomputed from revision 1 contains them
  const auth = analysisV2RepairAuthority(mismatched(), [dragSource()]);
  for (const p of ['/overview/keyPoints/0/point', '/overview/keyTerms/0/gloss', '/overview/keyTerms/0/term']) {
    assert.ok(auth.allowed.includes(p), `${p} must be authorised by the gate-based authority`);
  }
});

test('honest decline: the gate adds no OV checks and skips usable-overview minimum counts', () => {
  const report = gate()(declinedAnalysis(), [stubSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.analysis-v2', ...A_IDS]);
  assert.equal(report.publishable, true);
});

test('a schema-invalid analysis short-circuits exactly like validateAnalysisV2 (no OV walk on unsafe shapes)', () => {
  const bad = clone(usableAnalysis()) as unknown as { subject: string };
  bad.subject = 'astrology';
  const report = gate()(bad, [dragSource()]);
  assert.equal(report.publishable, false);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.analysis-v2']);
});

test('gate never throws on junk', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}]) {
    assert.equal(gate()(junk, [dragSource()]).publishable, false);
  }
});

test('repair authority: the OV-06 rewrite of the failing point is accepted, an unrelated point rewrite is not', () => {
  const baseline = mismatched();
  const honest = clone(baseline);
  honest.overview.keyPoints[0]!.point = 'The drag equation relates drag to the drag coefficient and the density.';
  honest.overview.keyTerms[0]!.term = 'drag coefficient';
  honest.overview.keyTerms[0]!.gloss = 'Variable called the drag coefficient that collects shape and flow effects.';
  assert.equal(gate()(honest, [dragSource()]).publishable, true, failedIds(gate()(honest, [dragSource()])).join());
  const ok = compareAnalysisV2Revisions(baseline, honest, { sources: [dragSource()] });
  assert.equal(ok.passed, true, ok.message);

  const sneaky = clone(honest);
  sneaky.overview.keyPoints[1]!.point = 'Something unrelated that was never flagged on the baseline.';
  const bad = compareAnalysisV2Revisions(baseline, sneaky, { sources: [dragSource()] });
  assert.equal(bad.passed, false);
  assert.match(bad.message, /\/overview\/keyPoints\/1\/point changed/);
});

/* ------------------------------------------------------------------ */
/* S6R-10 — append-only exception for an undersized authorised list   */
/* ------------------------------------------------------------------ */

function shortKeyPoints(): SourceAnalysisV2 {
  const a = clone(usableAnalysis());
  a.overview.keyPoints.pop(); // 2 points: A-07 (and OV-05) name /overview/keyPoints
  return a;
}

test('analysis-count-repair: the baseline fails only the count checks naming /overview/keyPoints', () => {
  const report = gate()(shortKeyPoints(), [dragSource()]);
  assert.deepEqual(failedIds(report), ['A-07', 'OV-05']);
  assert.ok(checkOf(report, 'A-07').affected?.includes('/overview/keyPoints'));
  assert.ok(checkOf(report, 'OV-05').affected?.includes('/overview/keyPoints'));
  assert.ok(affectedPathsOf(report).includes('/overview/keyPoints'));
});

test('analysis-count-repair: appending the missing point passes the comparator (existing entries and ids preserved in order)', () => {
  const next = usableAnalysis();
  assert.equal(gate()(next, [dragSource()]).publishable, true);
  const check = compareAnalysisV2Revisions(shortKeyPoints(), next, { sources: [dragSource()] });
  assert.equal(check.passed, true, check.message);
  assert.match(check.message, /list resize/);
});

test('append + mutation of a passing prefix entry is rejected (list authority does not unlock the subtree)', () => {
  const next = usableAnalysis();
  next.overview.keyPoints[0]!.point = 'The drag equation collects density, speed, area and coefficient in a changed relation.';
  const check = compareAnalysisV2Revisions(shortKeyPoints(), next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/overview\/keyPoints\/0\/point changed/);
});

test('append + prefix id rename / quote swap / reorder are rejected', () => {
  const renamed = usableAnalysis();
  renamed.overview.keyPoints[0]!.id = 'renamed-point';
  assert.equal(compareAnalysisV2Revisions(shortKeyPoints(), renamed, { sources: [dragSource()] }).passed, false);

  const requoted = usableAnalysis();
  requoted.overview.keyPoints[1]!.quote = requoted.overview.keyPoints[0]!.quote;
  assert.equal(compareAnalysisV2Revisions(shortKeyPoints(), requoted, { sources: [dragSource()] }).passed, false);

  const reordered = usableAnalysis();
  [reordered.overview.keyPoints[0], reordered.overview.keyPoints[1]] = [reordered.overview.keyPoints[1]!, reordered.overview.keyPoints[0]!];
  assert.equal(compareAnalysisV2Revisions(shortKeyPoints(), reordered, { sources: [dragSource()] }).passed, false);
});

test('a prefix entry may still change when its OWN failing path authorises it, together with the append', () => {
  const baseline = shortKeyPoints();
  baseline.overview.keyPoints[1]!.point = 'Bananas become purple while mountains sing softly.'; // OV-06 names .../1/point
  const rep = gate()(baseline, [dragSource()]);
  assert.deepEqual(failedIds(rep), ['A-07', 'OV-05', 'OV-06']);
  const next = usableAnalysis(); // restores point 1 honestly AND appends point 2
  assert.equal(compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] }).passed, true);
});

test('appending beyond the maximum, or an append that is not append-only at the tail, is rejected', () => {
  const baseline = shortKeyPoints();
  const tooMany = usableAnalysis();
  for (let i = 0; i < 4; i++) tooMany.overview.keyPoints.push({ ...clone(tooMany.overview.keyPoints[2]!), id: `extra-${i}` });
  assert.equal(tooMany.overview.keyPoints.length, 7);
  assert.equal(compareAnalysisV2Revisions(baseline, tooMany, { sources: [dragSource()] }).passed, false);
});

test('the appended entry is "checked normally": a bad appended entry fails the gate (the comparator does not vouch for content)', () => {
  const next = usableAnalysis();
  next.overview.keyPoints[2]!.point = 'Bananas become purple while mountains sing softly.';
  assert.equal(gate()(next, [dragSource()]).publishable, false);
  assert.ok(failedIds(gate()(next, [dragSource()])).includes('OV-06'));
});

test('oversized list: deletion is NOT a supported repair (kept failing, documented)', () => {
  const baseline = usableAnalysis();
  for (let i = 0; i < 4; i++) baseline.overview.keyPoints.push({ ...clone(baseline.overview.keyPoints[2]!), id: `extra-${i}` });
  assert.equal(baseline.overview.keyPoints.length, 7);
  assert.ok(failedIds(gate()(baseline, [dragSource()])).includes('A-07'));
  const trimmed = clone(baseline);
  trimmed.overview.keyPoints = trimmed.overview.keyPoints.slice(0, 6);
  const check = compareAnalysisV2Revisions(baseline, trimmed, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/overview\/keyPoints changed shape or list length/);
});

test('append is only for the three analysis lists the authority names; an unnamed list cannot grow', () => {
  const baseline = shortKeyPoints(); // /overview/keyTerms is NOT named
  const next = usableAnalysis();
  next.overview.keyTerms.push({ id: 'extra-term', term: 'area', gloss: 'The reference area of the body.', sourceId: 'nasa-grc-drag-equation', quote: 'the area (A) given in the drag equation is given as a reference area' });
  const check = compareAnalysisV2Revisions(baseline, next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/overview\/keyTerms changed shape or list length/);
});

test('undersized keyTerms and componentPlan lists support the same append-only repair', () => {
  const terms = usableAnalysis();
  const lastTerm = terms.overview.keyTerms.pop()!;
  assert.deepEqual(failedIds(gate()(terms, [dragSource()])), ['A-07', 'OV-05']);
  const termsNext = clone(terms);
  termsNext.overview.keyTerms.push(lastTerm);
  assert.equal(compareAnalysisV2Revisions(terms, termsNext, { sources: [dragSource()] }).passed, true);

  const plan = usableAnalysis();
  const lastPlan = plan.componentPlan.splice(0); // empty plan: A-04 + A-07 name /componentPlan
  assert.ok(failedIds(gate()(plan, [dragSource()])).includes('A-07'));
  const planNext = clone(plan);
  planNext.componentPlan.push(lastPlan[1]!);
  assert.equal(compareAnalysisV2Revisions(plan, planNext, { sources: [dragSource()] }).passed, true);
});

test('decline escape stays blocked: a usable analysis cannot "fix" the count by declining', () => {
  const baseline = shortKeyPoints();
  const declined = clone(declinedAnalysis());
  const check = compareAnalysisV2Revisions(baseline, declined, { sources: [dragSource()] });
  assert.equal(check.passed, false);
});

test('without sources the comparator still fails closed, even for a pure append', () => {
  assert.equal(compareAnalysisV2Revisions(shortKeyPoints(), usableAnalysis(), {}).passed, false);
});
