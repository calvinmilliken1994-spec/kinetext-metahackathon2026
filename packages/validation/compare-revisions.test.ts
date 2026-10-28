// Stage 5 review S5-02 — baseline-anchored, per-case/per-field no-weakening rules.
// Every case here reproduces a reviewer probe (launder-tolerance, launder-range,
// rename-tolerance, replace-case, exception.mjs) at the deterministic validator level.
// Round-2 sections reproduce the S5-08 probes (duplicates.mjs: duplicate-name
// deletion, replacement with an unchanged count, reordering duplicates, duplicate
// prediction ids) and the S5-09 probe (policy-name-repair: a publisher-violating
// test name must be repairable).
// Run: node --test packages/validation/compare-revisions.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compareRevisions, validateSpec } from './validate.ts';
import { makeProjectileSpec, projectileSourceDoc } from './fixtures/engine-specs.ts';
import type { ActivitySpec, ValidationReport } from '../contracts/index.ts';

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

type LooseCase = Record<string, unknown>;
function casesOf(spec: unknown, list: 'behavioralTests' | 'predictions'): LooseCase[] {
  return (spec as unknown as Record<string, LooseCase[]>)[list];
}

const projectileDoc = projectileSourceDoc();

/** A projectile spec whose first case states a wrong answer (+0.05 m). */
function wrongProjectile(): ActivitySpec {
  const spec = makeProjectileSpec();
  const first = casesOf(spec, 'behavioralTests')[0];
  assert.ok(first !== undefined);
  first['expectedMaxHeightM'] = (first['expectedMaxHeightM'] as number) + 0.05;
  return spec;
}

/* ------------------------------------------------------------------ */
/* exception.mjs — scoped tolerance exceptions (S5-02)                  */
/* ------------------------------------------------------------------ */

test('S5-02 exception.mjs: one invalid tolerance no longer disables tolerance comparisons for all cases', () => {
  // Reviewer probe: baseline case 0 states a wrong answer (tolerance 0.001) and
  // baseline case 1 has an excessive tolerance (0.5 > maxTolerance) so
  // 'semantic.tolerance' fails on the baseline. The "repair" widens case 0's
  // tolerance 0.001 → 0.1 (masking its unchanged wrong answer) and lowers case 1
  // to 0.01. The next revision is fully publishable on its own — the comparison
  // is the only guard, and it must fail because case 0's tolerance increased.
  const previous = wrongProjectile();
  const prevCases = casesOf(previous, 'behavioralTests');
  assert.ok(prevCases[1] !== undefined);
  prevCases[1]['tolerance'] = 0.5;
  const prevReport = validateSpec(previous, [projectileDoc]);
  assert.ok(failedIds(prevReport).includes('semantic.tolerance'), 'the excessive tolerance fails on the baseline');
  assert.ok(failedIds(prevReport).includes('behavior.tests'), 'the wrong answer fails on the baseline');

  const next = structuredClone(previous);
  const nextCases = casesOf(next, 'behavioralTests');
  assert.ok(nextCases[0] !== undefined && nextCases[1] !== undefined);
  nextCases[0]['tolerance'] = 0.1;
  nextCases[1]['tolerance'] = 0.01;
  const nextReport = validateSpec(next, [projectileDoc]);
  assert.equal(nextReport.publishable, true, 'the probe revision passes every validator check on its own');

  const comparison = compareRevisions(previous, next, failedIds(prevReport));
  assert.equal(comparison.id, 'repair.no-weakening');
  assert.equal(comparison.passed, false, 'the unrelated tolerance increase is a violation even though semantic.tolerance failed on the baseline');
  assert.match(comparison.message, /"earth launch" tolerance increased from 0\.001 to 0\.1/);
  assert.ok(!comparison.message.includes('"moon launch" tolerance'), 'lowering the invalid tolerance is not a violation');
});

/* ------------------------------------------------------------------ */
/* launder-tolerance / launder-range (S5-01 + S5-02)                    */
/* ------------------------------------------------------------------ */

test('S5-01 launder-tolerance: a rejected weakening stays rejected against the baseline forever', () => {
  const r1 = wrongProjectile(); // expected +0.05, tolerance 0.001 → behavior.tests fails
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['behavior.tests']);

  const r2 = structuredClone(r1);
  // Widened to 0.1 (<= maxTolerance(projectile, 20.408…) = 0.102) so the wrong
  // answer "passes" behavior.tests and semantic.tolerance on its own.
  casesOf(r2, 'behavioralTests')[0]['tolerance'] = 0.1;
  const r2Report = validateSpec(r2, [projectileDoc]);
  assert.equal(r2Report.publishable, true, 'the widened revision passes the plain validator');

  // First repair: compared against the baseline it must fail.
  const first = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(first.passed, false);
  assert.match(first.message, /tolerance increased from 0\.001 to 0\.1/);

  // The laundering attempt: r3 repeats the EXACT rejected content. Compared
  // against r2 it would be identical (no change); compared against the
  // immutable baseline it must fail again with the same violation.
  const r3 = structuredClone(r2);
  const again = compareRevisions(r1, r3, failedIds(r1Report));
  assert.equal(again.passed, false, 'an unchanged rejected weakening must remain rejected forever');
  assert.match(again.message, /tolerance increased from 0\.001 to 0\.1/);
  // ... while a comparison anchored on the weakened revision would have passed (the old bug).
  assert.equal(compareRevisions(r2, r3, failedIds(r2Report)).passed, true);
});

test('S5-01 launder-range: a shrunk range stays rejected against the baseline even when repeated verbatim', () => {
  const r1 = wrongProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);

  const r2 = structuredClone(makeProjectileSpec()); // honest answers, but a narrower gravity slider
  const sim = (r2 as unknown as { simulation: Record<string, { min: number; max: number; default: number }> }).simulation;
  sim['gravityMps2'].max -= 1;
  const r2Report = validateSpec(r2, [projectileDoc]);
  assert.equal(r2Report.publishable, true, 'the narrower range passes the plain validator');

  const first = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(first.passed, false);
  assert.match(first.message, /simulation\.gravityMps2 range width shrank from 19 to 18/);

  const r3 = structuredClone(r2);
  const again = compareRevisions(r1, r3, failedIds(r1Report));
  assert.equal(again.passed, false, 'the identical shrink must remain rejected against the baseline');
  assert.match(again.message, /range width shrank/);
  assert.equal(compareRevisions(r2, r3, failedIds(r2Report)).passed, true, 'the old previous-anchored comparison would have laundered it');
});

test('range shrink is excused only by that range\'s own failed check id, per input', () => {
  const baseline = makeProjectileSpec();
  const next = structuredClone(baseline);
  const sim = (next as unknown as { simulation: Record<string, { min: number; max: number; default: number }> }).simulation;
  sim['verticalSpeedMps'].max -= 1;

  // No failed range check → violation names the range's own check id.
  const denied = compareRevisions(baseline, next, []);
  assert.equal(denied.passed, false);
  assert.match(denied.message, /simulation\.verticalSpeedMps range width shrank/);

  // That range's own check failed on the baseline → the rewrite is allowed.
  assert.equal(compareRevisions(baseline, next, ['semantic.range.verticalSpeedMps']).passed, true);

  // A DIFFERENT range's failure does not excuse it (scoped per field).
  assert.equal(compareRevisions(baseline, next, ['semantic.range.gravityMps2']).passed, false);
});

test('forces keeps the Stage 2 range check ids in the shrink exception', () => {
  const spec = JSON.parse(
    readFileSync(new URL('../../tests/fixtures/spec.forces.v0.2.json', import.meta.url), 'utf8'),
  ) as ActivitySpec;
  const next = structuredClone(spec);
  const sim = (next as unknown as { simulation: Record<string, { min: number; max: number; default: number }> }).simulation;
  const mass = sim['massKg'];
  mass.max -= 1;
  const denied = compareRevisions(spec, next, []);
  assert.equal(denied.passed, false);
  assert.match(denied.message, /simulation\.massKg range width shrank/);
  assert.equal(compareRevisions(spec, next, ['semantic.mass-range']).passed, true, 'the legacy forces id excuses its own range');
  assert.equal(compareRevisions(spec, next, ['semantic.range.massKg']).passed, false, 'the generic id does not apply to forces');
});

/* ------------------------------------------------------------------ */
/* rename-tolerance / replace-case (S5-02)                              */
/* ------------------------------------------------------------------ */

test('S5-02 rename-tolerance: renaming a baseline case does not remove its obligations', () => {
  // Reviewer probe: keep the erroneous expectation, rename the test, widen the
  // tolerance — the rename must not dodge the comparison.
  const r1 = wrongProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const r2 = structuredClone(r1);
  const first = casesOf(r2, 'behavioralTests')[0];
  assert.ok(first !== undefined);
  first['name'] = `${String(first['name'])} renamed`;
  first['tolerance'] = 0.1;
  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" from the baseline is missing from the repair/);
  assert.match(comparison.message, /renaming, replacing or deleting/);
});

test('S5-02 replace-case: deleting a failing case and duplicating a passing one under a new name fails', () => {
  const r1 = wrongProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const r2 = structuredClone(r1);
  const cases = casesOf(r2, 'behavioralTests');
  assert.ok(cases[1] !== undefined);
  cases[0] = structuredClone(cases[1]);
  cases[0]['name'] = 'Replacement case';
  const r2Report = validateSpec(r2, [projectileDoc]);
  assert.equal(r2Report.publishable, true, 'the replacement passes every plain check (same count, all answers right)');
  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" from the baseline is missing from the repair/);
});

test('a baseline case name appearing twice in the repair fails (exactly once)', () => {
  const baseline = makeProjectileSpec();
  const next = structuredClone(baseline);
  const cases = casesOf(next, 'behavioralTests');
  cases.push(structuredClone(cases[0]));
  const comparison = compareRevisions(baseline, next, []);
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" appears 2 times in the repair, expected exactly once/);
});

/* ------------------------------------------------------------------ */
/* Per-case content immutability (S5-02 rule 4)                         */
/* ------------------------------------------------------------------ */

test('a case that was correct on the baseline may not change inputs or expected output', () => {
  const baseline = makeProjectileSpec(); // every case correct as delivered
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  assert.equal(baselineReport.publishable, true);

  // Changing an input of a correct case is a violation, even with an honest expected value.
  const movedInputs = structuredClone(baseline);
  const c0 = casesOf(movedInputs, 'behavioralTests')[0];
  assert.ok(c0 !== undefined);
  c0['verticalSpeedMps'] = 21;
  c0['expectedMaxHeightM'] = (21 * 21) / (2 * 9.8);
  const denied = compareRevisions(baseline, movedInputs, []);
  assert.equal(denied.passed, false);
  assert.match(denied.message, /"earth launch" changed \(verticalSpeedMps 20 -> 21, expectedMaxHeightM [\d.]+ -> [\d.]+\)/);
  assert.match(denied.message, /passed its own checks on the baseline/);

  // Changing only the expected output of a correct case is also a violation.
  const movedExpected = structuredClone(baseline);
  const e0 = casesOf(movedExpected, 'behavioralTests')[0];
  assert.ok(e0 !== undefined);
  e0['expectedMaxHeightM'] = (e0['expectedMaxHeightM'] as number) + 0.0005; // still inside its tolerance!
  assert.equal(compareRevisions(baseline, movedExpected, []).passed, false);
});

test('a case that was wrong on the baseline may be corrected (inputs, expected output, lower tolerance)', () => {
  const baseline = wrongProjectile();
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  assert.deepEqual(failedIds(baselineReport), ['behavior.tests'], '|expected - computed| > tolerance made this case wrong');

  const fixed = makeProjectileSpec(); // restores the honest expected value, everything else equal
  assert.equal(compareRevisions(baseline, fixed, failedIds(baselineReport)).passed, true);

  // Rewriting the inputs of a wrong case is allowed too (still the same identity).
  const rewritten = structuredClone(fixed);
  const c0 = casesOf(rewritten, 'behavioralTests')[0];
  assert.ok(c0 !== undefined);
  c0['verticalSpeedMps'] = 25;
  c0['expectedMaxHeightM'] = (25 * 25) / (2 * 9.8);
  assert.equal(compareRevisions(baseline, rewritten, failedIds(baselineReport)).passed, true);

  // A baseline case whose tolerance exceeded maxTolerance counts as wrong and may change.
  const overTolerance = makeProjectileSpec();
  const t1 = casesOf(overTolerance, 'behavioralTests')[1];
  assert.ok(t1 !== undefined);
  t1['tolerance'] = 0.5; // > maxTolerance(projectile, 44.44…) = 0.2222
  const overReport = validateSpec(overTolerance, [projectileDoc]);
  assert.ok(failedIds(overReport).includes('semantic.tolerance'));
  const tightened = structuredClone(overTolerance);
  const tt1 = casesOf(tightened, 'behavioralTests')[1];
  assert.ok(tt1 !== undefined);
  tt1['tolerance'] = 0.01;
  tt1['expectedMaxHeightM'] = 44.444444;
  assert.equal(compareRevisions(overTolerance, tightened, failedIds(overReport)).passed, true);
});

test('lowering a tolerance is always allowed; raising it is never allowed, even for a wrong case', () => {
  const baseline = wrongProjectile();
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  const lowered = structuredClone(baseline);
  casesOf(lowered, 'behavioralTests')[0]['tolerance'] = 0.0005;
  assert.equal(compareRevisions(baseline, lowered, failedIds(baselineReport)).passed, true);

  const raised = structuredClone(baseline);
  const c = casesOf(raised, 'behavioralTests')[0];
  assert.ok(c !== undefined);
  c['tolerance'] = 0.002;
  c['expectedMaxHeightM'] = 20.408163265306122; // honest value, but the tolerance grew
  const comparison = compareRevisions(baseline, raised, failedIds(baselineReport));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /tolerance increased from 0\.001 to 0\.002/);
});

/* ------------------------------------------------------------------ */
/* Predictions (S5-02: behavioral tests AND predictions)                */
/* ------------------------------------------------------------------ */

test('predictions: id preservation, content immutability and tolerance rule apply exactly like tests', () => {
  const baseline = makeProjectileSpec();
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  assert.equal(baselineReport.publishable, true);

  // Renaming a prediction id is a violation.
  const renamed = structuredClone(baseline);
  casesOf(renamed, 'predictions')[0]['id'] = 'fast-throw-2';
  const renameComparison = compareRevisions(baseline, renamed, []);
  assert.equal(renameComparison.passed, false);
  assert.match(renameComparison.message, /predictions "fast-throw" from the baseline is missing from the repair/);

  // Changing a correct prediction's expected output is a violation (even within tolerance).
  const nudged = structuredClone(baseline);
  const p = casesOf(nudged, 'predictions')[0];
  assert.ok(p !== undefined);
  p['expectedMaxHeightM'] = (p['expectedMaxHeightM'] as number) + 0.0005;
  assert.equal(compareRevisions(baseline, nudged, []).passed, false);

  // Widening a prediction tolerance is a violation.
  const widened = structuredClone(baseline);
  casesOf(widened, 'predictions')[0]['tolerance'] = 0.01;
  const widenComparison = compareRevisions(baseline, widened, []);
  assert.equal(widenComparison.passed, false);
  assert.match(widenComparison.message, /predictions "fast-throw" tolerance increased from 0\.001 to 0\.01/);

  // Deleting a prediction is a violation.
  const deleted = structuredClone(baseline);
  (deleted as unknown as { predictions: unknown[] }).predictions = [];
  assert.equal(compareRevisions(baseline, deleted, []).passed, false);
});

test('predictions: a prediction whose baseline inputs were outside the baseline ranges may change', () => {
  const baseline = makeProjectileSpec();
  const p = casesOf(baseline, 'predictions')[0];
  assert.ok(p !== undefined);
  p['verticalSpeedMps'] = 45; // outside the baseline slider range [5, 40]
  p['expectedMaxHeightM'] = (45 * 45) / (2 * 9.8);
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  assert.ok(failedIds(baselineReport).includes('semantic.predictions-in-range'));

  const brought = structuredClone(baseline);
  const pb = casesOf(brought, 'predictions')[0];
  assert.ok(pb !== undefined);
  pb['verticalSpeedMps'] = 30; // reachable with the sliders again
  pb['expectedMaxHeightM'] = (30 * 30) / (2 * 9.8);
  assert.equal(compareRevisions(baseline, brought, failedIds(baselineReport)).passed, true);
});

/* ------------------------------------------------------------------ */
/* Engine, additions, message shape                                     */
/* ------------------------------------------------------------------ */

test('engine changes and unknown engines still fail closed', () => {
  const baseline = makeProjectileSpec();
  const next = structuredClone(baseline);
  (next as unknown as { simulation: Record<string, unknown> }).simulation['engine'] = 'forces-1d-v1';
  const changed = compareRevisions(baseline, next, []);
  assert.equal(changed.passed, false);
  assert.match(changed.message, /engine changed from projectile-v1 to forces-1d-v1/);

  const junk = compareRevisions(null as unknown as ActivitySpec, undefined as unknown as ActivitySpec, []);
  assert.equal(junk.passed, false);
  assert.match(junk.message, /cannot compare revisions/);
});

test('adding cases is allowed', () => {
  const baseline = makeProjectileSpec();
  const next = structuredClone(baseline);
  const extra: LooseCase = {
    name: 'extra launch',
    horizontalSpeedMps: 5,
    verticalSpeedMps: 10,
    gravityMps2: 9.8,
    expectedMaxHeightM: (10 * 10) / (2 * 9.8),
    tolerance: 0.001,
  };
  casesOf(next, 'behavioralTests').push(extra);
  const comparison = compareRevisions(baseline, next, []);
  assert.equal(comparison.passed, true, comparison.message);
});

test('identical revisions pass with the exact message format the recorded evidence stores', () => {
  const baseline = makeProjectileSpec();
  const comparison = compareRevisions(baseline, structuredClone(baseline), []);
  assert.equal(comparison.passed, true);
  assert.equal(comparison.id, 'repair.no-weakening');
  assert.equal(comparison.kind, 'semantic');
  // Byte-identical to the pass message recorded in docs/evidence/stage-5/live
  // (tests/e2e/stage5-evidence.test.ts recomputes and compares it verbatim).
  assert.equal(
    comparison.message,
    'no weakening: engine projectile-v1 unchanged, no matched case tolerance increased, no simulation range width shrank, and the number of behavioral tests (2) and predictions (1) did not decrease',
  );
});

test('the failure message lists every violation, capped for display', () => {
  const baseline = wrongProjectile();
  const baselineReport = validateSpec(baseline, [projectileDoc]);
  const next = structuredClone(baseline);
  const cases = casesOf(next, 'behavioralTests');
  assert.ok(cases[0] !== undefined && cases[1] !== undefined);
  cases[0]['tolerance'] = 0.05; // violation 1: tolerance increased
  cases[1]['name'] = 'renamed away'; // violation 2: baseline name missing
  const comparison = compareRevisions(baseline, next, failedIds(baselineReport));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" tolerance increased from 0\.001 to 0\.05/);
  assert.match(comparison.message, /"moon launch" from the baseline is missing from the repair/);

  // More violations than the display cap → the message says how many are hidden.
  const manyBaseline = {
    simulation: { engine: 'projectile-v1' },
    behavioralTests: Array.from({ length: 13 }, (_v, i) => ({
      name: `case-${i}`,
      horizontalSpeedMps: 1,
      verticalSpeedMps: 1,
      gravityMps2: 1,
      expectedMaxHeightM: 0.5,
      tolerance: 0.001,
    })),
    predictions: [],
  } as unknown as ActivitySpec;
  const manyNext = {
    simulation: { engine: 'projectile-v1' },
    behavioralTests: [],
    predictions: [],
  } as unknown as ActivitySpec;
  const capped = compareRevisions(manyBaseline, manyNext, []);
  assert.equal(capped.passed, false);
  assert.match(capped.message, /case-0/);
  assert.match(capped.message, /\(\+1 more violation\(s\)\)/);
  assert.ok(capped.message.length < 2000, 'the display message stays bounded');
});

/* ------------------------------------------------------------------ */
/* S5-08 — duplicate baseline names/ids: identity is (key, occurrence)  */
/* ------------------------------------------------------------------ */

/** A projectile spec whose behavioralTests[1] is renamed to 'earth launch' (both cases numerically correct). */
function duplicateNameProjectile(): ActivitySpec {
  const spec = makeProjectileSpec();
  const cases = casesOf(spec, 'behavioralTests');
  assert.ok(cases[1] !== undefined);
  cases[1]['name'] = 'earth launch';
  return spec;
}

test('S5-08 duplicate-name-drops-correct-case: deleting the second occurrence of a duplicated name fails', () => {
  // Reviewer probe duplicate-name-drops-correct-case: two numerically distinct
  // CORRECT tests share one name; deleting the second drops the test count and
  // published r2 before the fix. Every occurrence is its own obligation.
  const r1 = duplicateNameProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['semantic.unique-ids'], 'the duplicated name is the only baseline failure');

  const r2 = structuredClone(r1);
  casesOf(r2, 'behavioralTests').splice(1, 1);
  const r2Report = validateSpec(r2, [projectileDoc]);
  assert.equal(r2Report.publishable, true, 'the shrunken revision passes every plain check on its own');

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" \(occurrence 2 of 2\) from the baseline is missing from the repair/);
});

test('S5-08 duplicate-name-drops-wrong-case: deleting a failing duplicate is not a repair', () => {
  // Reviewer probe duplicate-name-drops-wrong-case: the second occurrence states
  // 999 instead of the correct value; deleting it removes BOTH the uniqueness and
  // the behavioral failure — and published r2 before the fix.
  const r1 = duplicateNameProjectile();
  const second = casesOf(r1, 'behavioralTests')[1];
  assert.ok(second !== undefined);
  second['expectedMaxHeightM'] = 999; // wrong: computed is 44.44… (tolerance 0.01)
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report).sort(), ['behavior.tests', 'semantic.unique-ids'].sort());

  const r2 = structuredClone(r1);
  casesOf(r2, 'behavioralTests').splice(1, 1);
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true, 'deleting it removes both failures from the plain validator');

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" \(occurrence 2 of 2\) from the baseline is missing from the repair/);
});

test('S5-08 duplicate-name-replaced-same-count: an easy replacement does not preserve the dropped occurrence', () => {
  // Reviewer probe duplicate-name-replaced-same-count: replace the ignored wrong
  // duplicate with an easy case and keep the test count — r2 published before the
  // fix. Count checks alone are insufficient; the occurrence is still missing.
  const r1 = duplicateNameProjectile();
  const second = casesOf(r1, 'behavioralTests')[1];
  assert.ok(second !== undefined);
  second['expectedMaxHeightM'] = 999;
  const r1Report = validateSpec(r1, [projectileDoc]);

  const r2 = structuredClone(r1);
  const cases = casesOf(r2, 'behavioralTests');
  cases.splice(1, 1);
  cases.push({
    name: 'easy replacement',
    horizontalSpeedMps: 0,
    verticalSpeedMps: 5,
    gravityMps2: 9.8,
    expectedMaxHeightM: (5 * 5) / (2 * 9.8),
    tolerance: 0.001,
  });
  assert.equal(cases.length, 2, 'the test count is unchanged');
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true, 'the replacement passes every plain check');

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" \(occurrence 2 of 2\) from the baseline is missing from the repair/);
});

test('S5-08 reordering duplicates to swap their content fails', () => {
  // Both occurrences survive under the same name, but their contents are swapped:
  // (name, occurrence) identity pairs them up and the frozen-content rule fires.
  const r1 = duplicateNameProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const r2 = structuredClone(r1);
  const cases = casesOf(r2, 'behavioralTests');
  const first = cases[0];
  const secondCase = cases[1];
  assert.ok(first !== undefined && secondCase !== undefined);
  cases[0] = secondCase;
  cases[1] = first;

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" changed \(/);
  assert.match(comparison.message, /passed its own checks on the baseline/);
  assert.ok(!comparison.message.includes('appears 2 times'), 'both occurrences are preserved; the swap is the violation');
});

test('S5-08 duplicate-id-drops-correct-prediction: deleting the second occurrence of a duplicated prediction id fails', () => {
  // Reviewer probe duplicate-id-drops-correct-prediction: predictions 2 → 1
  // published r2 before the fix.
  const r1 = makeProjectileSpec();
  const preds = (r1 as unknown as { predictions: LooseCase[] }).predictions;
  const extra = structuredClone(preds[0]);
  assert.ok(extra !== undefined);
  extra['verticalSpeedMps'] = 25;
  extra['expectedMaxHeightM'] = (25 * 25) / (2 * 9.8);
  preds.push(extra); // same id 'fast-throw', different correct numbers
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['semantic.unique-ids']);

  const r2 = structuredClone(r1);
  (r2 as unknown as { predictions: unknown[] }).predictions.splice(1, 1);
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true);

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /predictions "fast-throw" \(occurrence 2 of 2\) from the baseline is missing from the repair/);
});

test('S5-08 preserving every duplicate occurrence passes the comparison (uniqueness stays a plain-validation failure)', () => {
  const r1 = duplicateNameProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['semantic.unique-ids']);
  const comparison = compareRevisions(r1, structuredClone(r1), failedIds(r1Report));
  assert.equal(comparison.passed, true, comparison.message);
  assert.equal(validateSpec(r1, [projectileDoc]).publishable, false, 'the duplicate name still fails semantic.unique-ids');
});

test('S5-08 renaming a duplicate occurrence to a unique name fails closed (no uniqueness-rename exception)', () => {
  // Lead decision: only a publisher-policy-violating name/id may be renamed
  // (S5-09). A duplicate that "repairs" semantic.unique-ids by renaming one
  // occurrence is rejected — fail closed, ending in human review — because a
  // rename cannot be distinguished from a replacement.
  const r1 = duplicateNameProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const r2 = structuredClone(r1);
  const second = casesOf(r2, 'behavioralTests')[1];
  assert.ok(second !== undefined);
  second['name'] = 'moon launch duplicate'; // content untouched, uniqueness "fixed"
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true, 'the renamed revision passes every plain check');

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" \(occurrence 2 of 2\) from the baseline is missing from the repair/);
});

/* ------------------------------------------------------------------ */
/* S5-09 — publisher-policy-violating names/ids are repairable          */
/* ------------------------------------------------------------------ */

/** A projectile spec whose first behavioral-test name violates the publisher policy. */
function nasaNamedProjectile(): ActivitySpec {
  const spec = makeProjectileSpec();
  const first = casesOf(spec, 'behavioralTests')[0];
  assert.ok(first !== undefined);
  first['name'] = 'NASA predicts this arc';
  return spec;
}

test('S5-09 policy-name-repair: a publisher-violating name may be renamed with identical numbers', () => {
  // Reviewer probe policy-name-repair: r1 is valid except for the NASA name; the
  // clean fixture (only the name differs) was rejected before the fix, so no valid
  // repair existed and the job burned both attempts.
  const r1 = nasaNamedProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['policy.no-publisher-attribution'], 'the name is the only baseline failure');

  const r2 = makeProjectileSpec(); // restores a clean name; every number is identical
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true);

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, true, comparison.message);
});

test('S5-09: the replacement name must not violate the publisher policy either', () => {
  const r1 = nasaNamedProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const r2 = structuredClone(r1);
  const first = casesOf(r2, 'behavioralTests')[0];
  assert.ok(first !== undefined);
  first['name'] = 'NASA confirms this arc';

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /violates the publisher-attribution policy/);
  assert.match(comparison.message, /violates the policy too/);
});

test('S5-09: the replacement name must not equal another baseline name', () => {
  const r1 = makeProjectileSpec();
  const cases = casesOf(r1, 'behavioralTests');
  assert.ok(cases[1] !== undefined);
  cases[1]['name'] = 'NASA predicts this arc'; // the SECOND case violates the policy
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['policy.no-publisher-attribution']);

  const r2 = structuredClone(r1);
  const r2Cases = casesOf(r2, 'behavioralTests');
  assert.ok(r2Cases[1] !== undefined);
  r2Cases[1]['name'] = 'earth launch'; // impersonates the other baseline case

  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /not another baseline name/);
});

test('S5-09: numeric content rules still apply to a policy rename', () => {
  const r1 = nasaNamedProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);

  // Widening the tolerance under cover of the rename.
  const widened = structuredClone(r1);
  const w0 = casesOf(widened, 'behavioralTests')[0];
  assert.ok(w0 !== undefined);
  w0['name'] = 'earth launch again';
  w0['tolerance'] = 0.1;
  const widenComparison = compareRevisions(r1, widened, failedIds(r1Report));
  assert.equal(widenComparison.passed, false);
  assert.match(widenComparison.message, /tolerance increased from 0\.001 to 0\.1/);

  // Rewriting a correct case's numbers under cover of the rename.
  const rewritten = structuredClone(r1);
  const c0 = casesOf(rewritten, 'behavioralTests')[0];
  assert.ok(c0 !== undefined);
  c0['name'] = 'earth launch again';
  c0['verticalSpeedMps'] = 5;
  c0['expectedMaxHeightM'] = (5 * 5) / (2 * 9.8);
  const rewriteComparison = compareRevisions(r1, rewritten, failedIds(r1Report));
  assert.equal(rewriteComparison.passed, false);
  assert.match(rewriteComparison.message, /changed \(verticalSpeedMps 20 -> 5/);
  assert.match(rewriteComparison.message, /passed its own checks on the baseline/);
});

test('S5-09: a publisher-violating prediction id may be renamed the same way', () => {
  const r1 = makeProjectileSpec();
  const preds = (r1 as unknown as { predictions: LooseCase[] }).predictions;
  assert.ok(preds[0] !== undefined);
  preds[0]['id'] = 'nasa-pred'; // matches /\bNASA\b/i — the policy pattern applies to ids too
  const r2 = makeProjectileSpec(); // original clean id 'fast-throw', identical numbers

  const comparison = compareRevisions(r1, r2, []);
  assert.equal(comparison.passed, true, comparison.message);

  // ... but not to another policy-violating id, and not to another baseline id.
  const stillBad = structuredClone(r1);
  preds0Id(stillBad, 'NASA pred 2');
  assert.equal(compareRevisions(r1, stillBad, []).passed, false);
  const colliding = makeProjectileSpec();
  (colliding as unknown as { predictions: LooseCase[] }).predictions.push({
    id: 'nasa-pred',
    prompt: 'A second prediction.',
    horizontalSpeedMps: 10,
    verticalSpeedMps: 25,
    gravityMps2: 9.8,
    expectedMaxHeightM: (25 * 25) / (2 * 9.8),
    tolerance: 0.001,
  });
  // The policy-violating 'nasa-pred' (position 1) is renamed to 'fast-throw',
  // the other baseline prediction id — an impersonation, not a policy fix.
  const impersonate = structuredClone(colliding);
  const ip = (impersonate as unknown as { predictions: LooseCase[] }).predictions;
  assert.ok(ip[1] !== undefined);
  ip[1]['id'] = 'fast-throw';
  const impersonateComparison = compareRevisions(colliding, impersonate, []);
  assert.equal(impersonateComparison.passed, false);
  assert.match(impersonateComparison.message, /not another baseline id/);
});

function preds0Id(spec: ActivitySpec, id: string): void {
  const p = (spec as unknown as { predictions: LooseCase[] }).predictions[0];
  assert.ok(p !== undefined);
  p['id'] = id;
}

test('S5-09: keeping a policy-violating name is not itself weakening (the policy check still fails separately)', () => {
  const r1 = nasaNamedProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  const comparison = compareRevisions(r1, structuredClone(r1), failedIds(r1Report));
  assert.equal(comparison.passed, true, comparison.message);
  assert.equal(validateSpec(r1, [projectileDoc]).publishable, false, 'the policy failure remains until the name is fixed');
});

test('S5-09: no other renames — a clean name that violates nothing stays immutable', () => {
  const r1 = makeProjectileSpec();
  const r2 = structuredClone(r1);
  const first = casesOf(r2, 'behavioralTests')[0];
  assert.ok(first !== undefined);
  first['name'] = 'totally clean new name';
  const comparison = compareRevisions(r1, r2, []);
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /"earth launch" from the baseline is missing from the repair/);
});

/* ------------------------------------------------------------------ */
/* BUG-003 — an id that is itself invalid (schema id pattern) is       */
/* repairable by renaming it, numbers frozen (live job                 */
/* job-20261028182320-bc3e9bff: a 41-character prediction id failed    */
/* schema.full; Muse renamed it correctly; no-weakening rejected the   */
/* rename twice, so the job could never publish).                      */
/* ------------------------------------------------------------------ */

const LONG_ID = 'save-2000-at-4-percent-quarterly-15-years'; // 41 chars, as in the live job

function longIdProjectile(): ActivitySpec {
  const spec = makeProjectileSpec();
  const first = casesOf(spec, 'predictions')[0];
  assert.ok(first !== undefined);
  first['id'] = LONG_ID;
  return spec;
}

test('BUG-003: a prediction id that fails the id pattern may be renamed to a valid id with identical numbers', () => {
  const r1 = longIdProjectile();
  const r1Report = validateSpec(r1, [projectileDoc]);
  assert.deepEqual(failedIds(r1Report), ['schema.full'], 'the over-long id is the only baseline failure');
  const r2 = structuredClone(r1);
  casesOf(r2, 'predictions')[0]!['id'] = 'save-2000-4pct-quarterly-15y';
  assert.equal(validateSpec(r2, [projectileDoc]).publishable, true);
  const comparison = compareRevisions(r1, r2, failedIds(r1Report));
  assert.equal(comparison.passed, true, comparison.message);
});

test('BUG-003: the replacement id must itself be valid and not another baseline id', () => {
  const r1 = longIdProjectile();
  const failed = failedIds(validateSpec(r1, [projectileDoc]));
  const stillLong = structuredClone(r1);
  casesOf(stillLong, 'predictions')[0]!['id'] = 'save-2000-at-4-percent-quarterly-15-years-x';
  const c1 = compareRevisions(r1, stillLong, failed);
  assert.equal(c1.passed, false);
  assert.match(c1.message, /not a valid id/);
  // A second baseline prediction, so the rename could impersonate it.
  const withTwo = structuredClone(r1);
  const preds = casesOf(withTwo, 'predictions');
  preds.push({ ...structuredClone(preds[0]!), id: 'second-prediction' });
  const failed2 = failedIds(validateSpec(withTwo, [projectileDoc]));
  const impersonates = structuredClone(withTwo);
  casesOf(impersonates, 'predictions')[0]!['id'] = 'second-prediction';
  const c2 = compareRevisions(withTwo, impersonates, failed2);
  assert.equal(c2.passed, false);
  assert.match(c2.message, /not another baseline id|appears 2 times/);
});

test('BUG-003: renaming an invalid id never unlocks its numbers', () => {
  const r1 = longIdProjectile();
  const failed = failedIds(validateSpec(r1, [projectileDoc]));
  const r2 = structuredClone(r1);
  const c = casesOf(r2, 'predictions')[0]!;
  c['id'] = 'renamed-and-changed';
  c['verticalSpeedMps'] = (c['verticalSpeedMps'] as number) + 1;
  const comparison = compareRevisions(r1, r2, failed);
  assert.equal(comparison.passed, false, 'a rename keeps the numbers frozen');
});

test('BUG-003: a VALID baseline id still may not be renamed', () => {
  const r1 = makeProjectileSpec();
  const r2 = structuredClone(r1);
  casesOf(r2, 'predictions')[0]!['id'] = 'some-other-id';
  const comparison = compareRevisions(r1, r2, []);
  assert.equal(comparison.passed, false);
  assert.match(comparison.message, /missing from the repair/);
});
