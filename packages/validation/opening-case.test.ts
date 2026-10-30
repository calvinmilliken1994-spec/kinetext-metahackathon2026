// Stage 7 item 1 (frozen docs/specs/STAGE-7-teacher-polish.md) — semantic.opening-case:
// for every slider engine (all engines except timeline-v1), each simulation.<input>.default
// must equal predictions[0].<input> within 1e-9 relative (absolute 1e-9 when the prediction
// value is 0), so the activity opens on its first case. affected = ONLY the
// /simulation/<input>/default pointers; repair may change those defaults and nothing else.
// Run: node --test packages/validation/opening-case.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { affectedPathsOf, compareRevisions, repairFindings, validateSpec } from './validate.ts';
import { makeLiftSpec, liftSourceDoc, makeSoundSpec, soundSourceDoc, projectileSourceDoc } from './fixtures/engine-specs.ts';
import { harborSourceDoc, makeHarborTimelineSpec } from './fixtures/timeline-specs.ts';
import type { ProjectileActivitySpec, ValidationCheck, ValidationReport } from '../contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson(rel: string): any {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
}

const EXECUTION = { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false } as const;

/**
 * The REAL stored Moon spec (storage/runs/job-20261027181336-572d603f/spec.r1.json):
 * simulation ranges, scenario, predictions and behavioralTests copied verbatim from the
 * stored artifact; the explanatory prose is the package fixture's (quotes grounded in
 * projectileSourceDoc) so only semantic.opening-case depends on the stored numbers.
 * The bug the check exists for: gravityMps2 default 9.8 under the label "Moon surface
 * with no air", while the first prediction ("moon-high-throw") uses 1.62.
 */
function makeMoonSpec(): ProjectileActivitySpec {
  const src = projectileSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'user-accf5f60ebed-job-20261027181336-572d603f',
    title: 'Throwing a ball on the Moon',
    learningObjectives: ['Predict the maximum height of a ballistic arc from the launch speed and gravity.'],
    sources: [{
      id: src.id, title: src.title, locator: src.locator,
      license: src.license, attribution: src.attribution, sha256: src.sha256,
    }],
    explanations: [
      {
        id: 'max-height',
        text: 'The maximum height grows with the square of the vertical launch speed.',
        evidence: [{
          sourceId: src.id,
          quote: 'the maximum height equals the vertical speed squared divided by twice the gravity',
        }],
      },
      {
        id: 'independent-motions',
        text: 'Sideways motion continues unchanged while gravity bends the path downward.',
        evidence: [{
          sourceId: src.id,
          quote: 'Horizontal motion is uniform while the vertical motion accelerates downward',
        }],
      },
    ],
    simulation: {
      engine: 'projectile-v1',
      equation: 'y_max=V0^2/(2*g)',
      horizontalSpeedMps: { unit: 'm/s', min: 5, max: 50, default: 20 },
      verticalSpeedMps: { unit: 'm/s', min: 5, max: 30, default: 15 },
      gravityMps2: { unit: 'm/s^2', min: 1.6, max: 24.8, default: 9.8 },
      scenario: { objectLabel: 'Thrown ball', settingLabel: 'Moon surface with no air' },
    },
    behavioralTests: [
      { name: 'low-arc Earth toss', horizontalSpeedMps: 20, verticalSpeedMps: 5, gravityMps2: 9.8, expectedMaxHeightM: 1.2755, tolerance: 0.01 },
      { name: 'high-arc Moon throw', horizontalSpeedMps: 10, verticalSpeedMps: 30, gravityMps2: 1.62, expectedMaxHeightM: 277.7778, tolerance: 0.5 },
      { name: 'Moon mid throw', horizontalSpeedMps: 15, verticalSpeedMps: 15, gravityMps2: 1.62, expectedMaxHeightM: 69.4444, tolerance: 0.2 },
      { name: 'Earth comparison throw', horizontalSpeedMps: 25, verticalSpeedMps: 15, gravityMps2: 9.8, expectedMaxHeightM: 11.4796, tolerance: 0.05 },
    ],
    predictions: [
      {
        id: 'moon-high-throw',
        prompt: 'Predict the peak height for a ball thrown upward on the Moon with no air.',
        horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62, expectedMaxHeightM: 69.4444, tolerance: 0.2,
      },
      {
        id: 'earth-lower-throw',
        prompt: 'Predict the peak height for the same upward throw under stronger gravity.',
        horizontalSpeedMps: 25, verticalSpeedMps: 12, gravityMps2: 9.8, expectedMaxHeightM: 7.3469, tolerance: 0.03,
      },
    ],
    execution: EXECUTION,
    provenance: {
      provider: 'meta' as const,
      requestedModel: 'muse-spark-1.3',
      returnedModel: 'muse-spark-1.3',
      responseId: 'fixture-copied-from-stored-spec',
      runId: 'job-20261027181336-572d603f',
      promptVersion: 'v9',
      revision: 1,
      repairOf: null,
      generatedAt: '2026-10-27T18:13:36.000Z',
    },
  } satisfies ProjectileActivitySpec);
}

/** The stored forces fixture with EXPLICIT defaults, so this test is stable if the lead realigns the JSON. */
function makeForcesSpec(massDefault: number, forceDefault: number) {
  const spec = loadJson('../../tests/fixtures/spec.forces.v0.2.json');
  spec.simulation.massKg.default = massDefault;
  spec.simulation.netForceN.default = forceDefault;
  return spec;
}

function checkOf(report: ValidationReport, id: string): ValidationCheck {
  const found = report.checks.find(c => c.id === id);
  assert.ok(found, `expected a check "${id}", report has [${report.checks.map(c => c.id).join(', ')}]`);
  return found;
}

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

/* ------------------------------------------------------------------ */
/* The real Moon case                                                  */
/* ------------------------------------------------------------------ */

test('semantic.opening-case: the stored Moon spec fails with the frozen message and default-only affected paths', () => {
  const report = validateSpec(makeMoonSpec(), [projectileSourceDoc()]);
  assert.equal(checkOf(report, 'schema.full').passed, true, 'the copied Moon spec must stay schema-valid');
  const check = checkOf(report, 'semantic.opening-case');
  assert.equal(check.kind, 'semantic');
  assert.equal(check.passed, false);
  assert.equal(
    check.message,
    'slider default gravityMps2 = 9.8 but the first prediction ("moon-high-throw") uses 1.62; the activity must open on its first case',
  );
  assert.deepEqual(check.affected, ['/simulation/gravityMps2/default']);
  assert.equal(check.path, '/simulation');
  // Nothing else about the stored spec is wrong: the opening case is the ONLY failure.
  assert.deepEqual(failedIds(report), ['semantic.opening-case']);
  assert.equal(report.publishable, false);
});

test('semantic.opening-case: the Moon spec with default gravityMps2 = 1.62 passes and the spec is publishable', () => {
  const spec = makeMoonSpec();
  spec.simulation.gravityMps2.default = 1.62;
  const report = validateSpec(spec, [projectileSourceDoc()]);
  const check = checkOf(report, 'semantic.opening-case');
  assert.equal(check.passed, true, check.message);
  assert.equal(report.publishable, true, report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n'));
  // Check-count change: projectile reports grow 14 -> 15, the new check sits right after
  // semantic.predictions-in-range (report order is pinned for the lead's e2e updates).
  assert.equal(report.checks.length, 15);
  const ids = report.checks.map(c => c.id);
  assert.equal(ids.filter(id => id === 'semantic.opening-case').length, 1);
  assert.equal(ids[ids.indexOf('semantic.predictions-in-range') + 1], 'semantic.opening-case');
});

/* ------------------------------------------------------------------ */
/* Tolerance semantics: 1e-9 relative, absolute 1e-9 when the target is 0 */
/* ------------------------------------------------------------------ */

test('semantic.opening-case: agreement within 1e-9 relative passes, beyond it fails', () => {
  const pass = makeMoonSpec();
  pass.simulation.gravityMps2.default = 1.62 * (1 + 5e-10);
  assert.equal(checkOf(validateSpec(pass, [projectileSourceDoc()]), 'semantic.opening-case').passed, true);

  const fail = makeMoonSpec();
  fail.simulation.gravityMps2.default = 1.62 * (1 + 2e-9);
  const check = checkOf(validateSpec(fail, [projectileSourceDoc()]), 'semantic.opening-case');
  assert.equal(check.passed, false);
  assert.deepEqual(check.affected, ['/simulation/gravityMps2/default']);
});

test('semantic.opening-case: a zero prediction value is matched with absolute 1e-9', () => {
  // horizontalSpeedMps does not enter y_max, so predictions[0] can use 0 (hardMin is inclusive).
  const base = makeMoonSpec();
  base.simulation.gravityMps2.default = 1.62; // align the other inputs; this test is about h = 0
  base.predictions[0].horizontalSpeedMps = 0;
  base.simulation.horizontalSpeedMps = { unit: 'm/s', min: 0, max: 50, default: 1e-10 };
  assert.equal(checkOf(validateSpec(base, [projectileSourceDoc()]), 'semantic.opening-case').passed, true);

  const beyond = structuredClone(base);
  beyond.simulation.horizontalSpeedMps.default = 2e-9;
  const check = checkOf(validateSpec(beyond, [projectileSourceDoc()]), 'semantic.opening-case');
  assert.equal(check.passed, false);
  assert.deepEqual(check.affected, ['/simulation/horizontalSpeedMps/default']);
  assert.match(check.message, /slider default horizontalSpeedMps = 2e-9 but the first prediction \("moon-high-throw"\) uses 0/);
});

/* ------------------------------------------------------------------ */
/* Forces engine: massKg / netForceN, multi-input message              */
/* ------------------------------------------------------------------ */

test('semantic.opening-case: forces names netForceN (Stage-2 input keys), default-only affected', () => {
  const report = validateSpec(makeForcesSpec(2, 4), [loadJson('../../tests/fixtures/source-doc.json')]);
  const check = checkOf(report, 'semantic.opening-case');
  assert.equal(check.passed, false);
  assert.equal(
    check.message,
    'slider default netForceN = 4 but the first prediction ("double-force") uses 10; the activity must open on its first case',
  );
  assert.deepEqual(check.affected, ['/simulation/netForceN/default']);

  const aligned = validateSpec(makeForcesSpec(2, 10), [loadJson('../../tests/fixtures/source-doc.json')]);
  assert.equal(checkOf(aligned, 'semantic.opening-case').passed, true);
});

test('semantic.opening-case: every mismatched input is named, each with its own affected default pointer', () => {
  const report = validateSpec(makeForcesSpec(5, 4), [loadJson('../../tests/fixtures/source-doc.json')]);
  const check = checkOf(report, 'semantic.opening-case');
  assert.equal(check.passed, false);
  assert.equal(
    check.message,
    'slider default massKg = 5 but the first prediction ("double-force") uses 2; ' +
      'slider default netForceN = 4 but the first prediction ("double-force") uses 10; ' +
      'the activity must open on its first case',
  );
  assert.deepEqual(check.affected, ['/simulation/massKg/default', '/simulation/netForceN/default']);
});

test('semantic.opening-case: the check exists exactly once for every slider engine and never for timeline-v1', () => {
  for (const [spec, sources] of [
    [makeMoonSpec(), [projectileSourceDoc()]],
    [makeLiftSpec(), [liftSourceDoc()]],
    [makeSoundSpec(), [soundSourceDoc()]],
  ] as const) {
    const report = validateSpec(structuredClone(spec), [...sources]);
    assert.equal(report.checks.filter(c => c.id === 'semantic.opening-case').length, 1);
  }
  const timeline = validateSpec(makeHarborTimelineSpec(), [harborSourceDoc()]);
  assert.equal(timeline.checks.some(c => c.id === 'semantic.opening-case'), false);
});

/* ------------------------------------------------------------------ */
/* Repair authorization: default-only unlock, nothing else             */
/* ------------------------------------------------------------------ */

test('semantic.opening-case: repairFindings/affectedPathsOf carry only the default pointers', () => {
  const report = validateSpec(makeMoonSpec(), [projectileSourceDoc()]);
  const finding = repairFindings(report, makeMoonSpec()).find(f => f.id === 'semantic.opening-case');
  assert.ok(finding, 'the failing check must become a repair finding');
  assert.equal(finding.kind, 'semantic');
  assert.equal(finding.path, '/simulation');
  assert.deepEqual(finding.affected, ['/simulation/gravityMps2/default']);
  assert.equal(finding.message, report.checks.find(c => c.id === 'semantic.opening-case')?.message);
  // firstFailingCase numbers stay reserved for behavior.* ids.
  assert.equal(finding.expected, undefined);
  assert.equal(finding.computed, undefined);
  assert.deepEqual(affectedPathsOf(report), ['/simulation/gravityMps2/default']);
});

test('repair.no-weakening: a default-only repair authorized by semantic.opening-case passes', () => {
  const baseline = makeMoonSpec();
  const repaired = makeMoonSpec();
  repaired.simulation.gravityMps2.default = 1.62; // the ONLY change: the affected default
  const weakening = compareRevisions(baseline, repaired, ['semantic.opening-case']);
  assert.equal(weakening.passed, true, weakening.message);
});

test('repair.no-weakening: "fixing" the opening case by editing the first prediction is weakening', () => {
  const baseline = makeMoonSpec();
  const cheat = makeMoonSpec();
  cheat.predictions[0].gravityMps2 = 9.8; // meet the default halfway instead of the other way
  cheat.predictions[0].expectedMaxHeightM = 11.4796;
  cheat.predictions[0].tolerance = 0.05;
  const weakening = compareRevisions(baseline, cheat, ['semantic.opening-case']);
  assert.equal(weakening.passed, false);
  assert.match(weakening.message, /predictions "moon-high-throw" changed/);
});

test('repair.no-weakening: opening-case alone never unlocks a range width shrink', () => {
  const baseline = makeMoonSpec();
  const shrink = makeMoonSpec();
  shrink.simulation.gravityMps2 = { unit: 'm/s^2', min: 1.6, max: 20, default: 1.62 };
  const denied = compareRevisions(baseline, shrink, ['semantic.opening-case']);
  assert.equal(denied.passed, false);
  assert.match(denied.message, /range width shrank/);
  // The range's OWN check id failing on the baseline still unlocks the shrink (unchanged rule).
  const allowed = compareRevisions(baseline, shrink, ['semantic.opening-case', 'semantic.range.gravityMps2']);
  assert.equal(allowed.passed, true, allowed.message);
});
