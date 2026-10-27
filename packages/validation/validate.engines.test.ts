// TASK-013 — engine-generic validation tests: dispatch, descriptor-driven checks,
// semantic.tolerance, repairFindings, compareRevisions, multi-engine validateAnalysis.
// Run: node --test packages/validation/validate.engines.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { compareRevisions, repairFindings, validateAnalysis, validateSpec } from './validate.ts';
import {
  liftSourceDoc,
  makeLiftSpec,
  makeProjectileSpec,
  makeSoundSpec,
  projectileSourceDoc,
  soundSourceDoc,
} from './fixtures/engine-specs.ts';
import { ENGINE_IDS } from '../contracts/index.ts';
import type { SourceAnalysis, SourceDocument, ValidationReport } from '../contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Helpers + fixtures                                                  */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadJson(rel: string): any {
  return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
}
const loadAnalysisFixture = (): SourceAnalysis => loadJson('../../tests/fixtures/analysis.forces.json') as SourceAnalysis;
const loadSourceDoc = (): SourceDocument => loadJson('../../tests/fixtures/source-doc.json') as SourceDocument;
const loadForcesSpec = () => loadJson('../../tests/fixtures/spec.forces.v0.2.json');

function checkOf(report: ValidationReport, id: string) {
  const found = report.checks.find(c => c.id === id);
  assert.ok(found, `expected a check "${id}", report has [${report.checks.map(c => c.id).join(', ')}]`);
  return found;
}

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function failureDetail(report: ValidationReport): string {
  return report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n');
}

/** Assert the schema gate still passes, exactly `expected` checks fail, and the report blocks publication. */
function expectFailures(report: ValidationReport, expected: string[]): ValidationReport {
  assert.equal(checkOf(report, 'schema.full').passed, true, `mutation must keep the spec schema-valid: ${checkOf(report, 'schema.full').message}`);
  assert.deepEqual(failedIds(report), expected, failureDetail(report));
  assert.equal(report.publishable, false);
  return report;
}

// Check ids shared by every engine, in report order.
const GENERIC_TAIL = [
  'semantic.unique-ids',
  'refs.sources',
  'refs.sha256',
  'grounding.quotes',
  'behavior.tests',
  'behavior.predictions',
  'semantic.tolerance',
  'semantic.predictions-in-range',
];
const POLICY_SCOPE = ['policy.no-publisher-attribution', 'scope.prose-unverified'];

const PROJECTILE_CHECK_IDS = [
  'schema.full',
  'semantic.range.horizontalSpeedMps',
  'semantic.range.verticalSpeedMps',
  'semantic.range.gravityMps2',
  ...GENERIC_TAIL,
  ...POLICY_SCOPE,
];
const LIFT_CHECK_IDS = [
  'schema.full',
  'semantic.range.liftCoefficient',
  'semantic.range.airDensityKgM3',
  'semantic.range.airspeedMps',
  'semantic.range.wingAreaM2',
  ...GENERIC_TAIL,
  ...POLICY_SCOPE,
];
const SOUND_CHECK_IDS = [
  'schema.full',
  'semantic.range.gamma',
  'semantic.range.gasConstantJPerKgK',
  'semantic.range.temperatureK',
  ...GENERIC_TAIL,
  ...POLICY_SCOPE,
];

const KINDS: Record<string, string> = {
  'schema.full': 'schema',
  'semantic.unique-ids': 'semantic',
  'refs.sources': 'grounding',
  'refs.sha256': 'grounding',
  'grounding.quotes': 'grounding',
  'behavior.tests': 'behavioral',
  'behavior.predictions': 'behavioral',
  'semantic.tolerance': 'semantic',
  'semantic.predictions-in-range': 'semantic',
  'policy.no-publisher-attribution': 'semantic',
  'scope.prose-unverified': 'semantic',
};

/* ------------------------------------------------------------------ */
/* Happy paths — one valid hand-written spec per engine                */
/* ------------------------------------------------------------------ */

test('validateSpec: valid projectile spec passes all 14 checks and is publishable', () => {
  const report = validateSpec(makeProjectileSpec(), [projectileSourceDoc()]);
  assert.deepEqual(report.checks.map(c => c.id), PROJECTILE_CHECK_IDS, failureDetail(report));
  for (const c of report.checks) {
    assert.equal(c.kind, KINDS[c.id] ?? 'semantic', `check ${c.id} kind`);
    assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  }
  assert.equal(report.publishable, true);
  assert.equal(report.artifactId, 'projectile-contract-fixture');
  assert.equal(report.revision, 1);
});

test('validateSpec: valid lift spec passes all 15 checks and is publishable', () => {
  const report = validateSpec(makeLiftSpec(), [liftSourceDoc()]);
  assert.deepEqual(report.checks.map(c => c.id), LIFT_CHECK_IDS, failureDetail(report));
  for (const c of report.checks) assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  assert.equal(report.publishable, true);
  assert.equal(report.artifactId, 'lift-contract-fixture');
});

test('validateSpec: valid sound spec passes all 14 checks and is publishable', () => {
  const report = validateSpec(makeSoundSpec(), [soundSourceDoc()]);
  assert.deepEqual(report.checks.map(c => c.id), SOUND_CHECK_IDS, failureDetail(report));
  for (const c of report.checks) assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  assert.equal(report.publishable, true);
  assert.equal(report.artifactId, 'sound-contract-fixture');
});

test('validateSpec: behavior messages name the engine equation', () => {
  const report = validateSpec(makeLiftSpec(), [liftSourceDoc()]);
  assert.match(checkOf(report, 'behavior.tests').message, /L=Cl\*\(rho\*V\^2\/2\)\*A/);
  assert.match(checkOf(report, 'semantic.tolerance').message, /speed-of-sound|lift-equation/);
});

/* ------------------------------------------------------------------ */
/* Engine dispatch + unknown engine                                    */
/* ------------------------------------------------------------------ */

test('validateSpec: unknown engine yields a single failed schema.full naming the problem', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = makeProjectileSpec() as any;
  spec.simulation.engine = 'drag-v1';
  const report = validateSpec(spec, [projectileSourceDoc()]);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].id, 'schema.full');
  assert.equal(report.checks[0].kind, 'schema');
  assert.equal(report.checks[0].passed, false);
  assert.match(report.checks[0].message, /drag-v1/, 'the unknown id is named');
  for (const id of ENGINE_IDS) assert.match(report.checks[0].message, new RegExp(id), `the message lists ${id}`);
  assert.equal(report.publishable, false);
  assert.equal(report.artifactId, 'projectile-contract-fixture');
  assert.equal(report.revision, 1);
});

test('validateSpec: missing simulation.engine or missing simulation names the problem in schema.full', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noEngine = makeProjectileSpec() as any;
  delete noEngine.simulation.engine;
  let report = validateSpec(noEngine, [projectileSourceDoc()]);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0].id, 'schema.full');
  assert.match(report.checks[0].message, /simulation\.engine/);
  assert.match(report.checks[0].message, /missing/);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const noSim = makeSoundSpec() as any;
  delete noSim.simulation;
  report = validateSpec(noSim, [soundSourceDoc()]);
  assert.equal(report.checks.length, 1);
  assert.match(report.checks[0].message, /simulation\.engine/);
  assert.equal(report.publishable, false);
});

test('validateSpec: right engine id, wrong engine shape fails schema.full alone', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const spec = makeProjectileSpec() as any;
  spec.simulation.engine = 'lift-equation-v1'; // projectile body, lift id
  const report = validateSpec(spec, [liftSourceDoc()]);
  assert.deepEqual(failedIds(report), ['schema.full']);
  assert.equal(report.checks.length, 1);
});

test('validateSpec: forces specs keep validating through the same dispatch (0.2.0 fixture, 15 checks)', () => {
  const report = validateSpec(loadForcesSpec(), [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.checks.length, 15);
  assert.equal(checkOf(report, 'semantic.tolerance').passed, true, 'stored-evidence tolerances satisfy the tolerance rule');
  assert.equal(report.publishable, true);
});

/* ------------------------------------------------------------------ */
/* Descriptor-driven failures per engine                               */
/* ------------------------------------------------------------------ */

test('projectile: wrong expectedMaxHeightM fails behavior.tests only', () => {
  const spec = makeProjectileSpec();
  spec.behavioralTests[0].expectedMaxHeightM = 30; // computed 20.408163...
  const report = expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['behavior.tests']);
  assert.match(checkOf(report, 'behavior.tests').message, /earth launch/);
  assert.match(checkOf(report, 'behavior.tests').message, /20\.408163265306122/);
});

test('projectile: tolerance 0.5 on a small output (44.44 m) fails semantic.tolerance only', () => {
  const spec = makeProjectileSpec();
  spec.behavioralTests[1].tolerance = 0.5; // maxTolerance = max(0.01, 0.005*44.444...) = 0.2222...
  const report = expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['semantic.tolerance']);
  const msg = checkOf(report, 'semantic.tolerance').message;
  assert.match(msg, /moon launch/);
  assert.match(msg, /0\.5/);
  assert.match(msg, /0\.2222222222222222/, 'the per-case maxTolerance is named');
});

test('projectile: inverted verticalSpeedMps range fails the range check and predictions-in-range', () => {
  const spec = makeProjectileSpec();
  spec.simulation.verticalSpeedMps = { unit: 'm/s', min: 40, max: 5, default: 20 };
  const report = expectFailures(validateSpec(spec, [projectileSourceDoc()]), [
    'semantic.range.verticalSpeedMps',
    'semantic.predictions-in-range',
  ]);
  assert.match(checkOf(report, 'semantic.range.verticalSpeedMps').message, /min/);
});

test('projectile: prediction gravity outside the slider range fails predictions-in-range only', () => {
  const spec = makeProjectileSpec();
  spec.predictions[0].gravityMps2 = 25; // schema hard bounds allow [0.1, 30]; slider range is [1, 20]
  spec.predictions[0].expectedMaxHeightM = 18; // 30^2/(2*25): physics stays consistent
  const report = expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['semantic.predictions-in-range']);
  assert.match(checkOf(report, 'semantic.predictions-in-range').message, /gravityMps2 25/);
});

test('projectile: "According to NASA" in settingLabel fails policy.no-publisher-attribution only', () => {
  const spec = makeProjectileSpec();
  spec.simulation.scenario.settingLabel = 'According to NASA';
  const report = expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['policy.no-publisher-attribution']);
  assert.match(checkOf(report, 'policy.no-publisher-attribution').message, /settingLabel/);
});

test('projectile: duplicate behavioral test name fails semantic.unique-ids only', () => {
  const spec = makeProjectileSpec();
  spec.behavioralTests[1].name = spec.behavioralTests[0].name;
  expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['semantic.unique-ids']);
});

test('projectile: paraphrased quote fails grounding.quotes only', () => {
  const spec = makeProjectileSpec();
  spec.explanations[0].evidence[0].quote = 'height grows with the launch speed squared';
  expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['grounding.quotes']);
});

test('projectile: tampered source sha fails refs.sha256 only', () => {
  const spec = makeProjectileSpec();
  spec.sources[0].sha256 = 'b'.repeat(64);
  expectFailures(validateSpec(spec, [projectileSourceDoc()]), ['refs.sha256']);
});

test('projectile: input violating a hard bound (rho-style exclusive minimum) fails schema.full alone', () => {
  const spec = makeLiftSpec();
  spec.behavioralTests[0].airDensityKgM3 = 0; // exclusiveMinimum 0 in the full schema
  const report = validateSpec(spec, [liftSourceDoc()]);
  assert.deepEqual(failedIds(report), ['schema.full']);
  assert.equal(report.checks.length, 1);
});

test('lift: wrong expectedLiftN fails behavior.tests only', () => {
  const spec = makeLiftSpec();
  spec.behavioralTests[0].expectedLiftN = 9999; // computed 12250
  const report = expectFailures(validateSpec(spec, [liftSourceDoc()]), ['behavior.tests']);
  assert.match(checkOf(report, 'behavior.tests').message, /cruise lift/);
});

test('lift: prediction tolerance 200 > maxTolerance(21600) = 108 fails semantic.tolerance only', () => {
  const spec = makeLiftSpec();
  spec.predictions[0].tolerance = 200;
  const report = expectFailures(validateSpec(spec, [liftSourceDoc()]), ['semantic.tolerance']);
  assert.match(checkOf(report, 'semantic.tolerance').message, /dense-air/);
  assert.match(checkOf(report, 'semantic.tolerance').message, /108/);
});

test('lift: "NASA wing" objectLabel fails policy only', () => {
  const spec = makeLiftSpec();
  spec.simulation.scenario.objectLabel = 'NASA wing';
  expectFailures(validateSpec(spec, [liftSourceDoc()]), ['policy.no-publisher-attribution']);
});

test('sound: wrong expectedSpeedMps in a prediction fails behavior.predictions only', () => {
  const spec = makeSoundSpec();
  spec.predictions[0].expectedSpeedMps = 400; // computed 358.5749572962395
  const report = expectFailures(validateSpec(spec, [soundSourceDoc()]), ['behavior.predictions']);
  assert.match(checkOf(report, 'behavior.predictions').message, /hot-day/);
  assert.match(checkOf(report, 'behavior.predictions').message, /358\.5749572962395/);
});

test('sound: tolerance 2 > maxTolerance(283.478) = 1.417 fails semantic.tolerance only', () => {
  const spec = makeSoundSpec();
  spec.behavioralTests[1].tolerance = 2; // schema max is 50, so the gate passes and the semantic rule fires
  const report = expectFailures(validateSpec(spec, [soundSourceDoc()]), ['semantic.tolerance']);
  assert.match(checkOf(report, 'semantic.tolerance').message, /cold air/);
});

test('sound: inverted temperatureK range fails range + predictions-in-range', () => {
  const spec = makeSoundSpec();
  spec.simulation.temperatureK = { unit: 'K', min: 400, max: 150, default: 288.15 };
  expectFailures(validateSpec(spec, [soundSourceDoc()]), [
    'semantic.range.temperatureK',
    'semantic.predictions-in-range',
  ]);
});

/* ------------------------------------------------------------------ */
/* repairFindings                                                      */
/* ------------------------------------------------------------------ */

test('repairFindings: a publishable report yields no findings', () => {
  const report = validateSpec(makeProjectileSpec(), [projectileSourceDoc()]);
  assert.deepEqual(repairFindings(report, makeProjectileSpec()), []);
  assert.deepEqual(repairFindings(report), []);
});

test('repairFindings: behavior.tests finding carries structured numbers and a case path', () => {
  const spec = makeProjectileSpec();
  spec.behavioralTests[0].expectedMaxHeightM = 30;
  const report = validateSpec(spec, [projectileSourceDoc()]);
  const findings = repairFindings(report, spec);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.id, 'behavior.tests');
  assert.equal(f.kind, 'behavioral');
  assert.equal(f.path, 'behavioralTests[0]');
  assert.equal(f.expected, 30);
  assert.equal(f.computed, 20.408163265306122);
  assert.equal(f.tolerance, 0.001);
  assert.ok(f.message.length > 0 && f.message.length <= 300);
});

test('repairFindings: behavior.predictions finding points at predictions[i]', () => {
  const spec = makeSoundSpec();
  spec.predictions[0].expectedSpeedMps = 400;
  const report = validateSpec(spec, [soundSourceDoc()]);
  const findings = repairFindings(report, spec);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, 'behavior.predictions');
  assert.equal(findings[0].path, 'predictions[0]');
  assert.equal(findings[0].expected, 400);
  assert.equal(findings[0].computed, 358.5749572962395);
  assert.equal(findings[0].tolerance, 0.01);
});

test('repairFindings: the FIRST failing case per check is reported, numbers untruncated', () => {
  const spec = makeLiftSpec();
  spec.behavioralTests[0].expectedLiftN = 9999;
  spec.behavioralTests[1].expectedLiftN = 1; // second failure must not be the one reported
  const report = validateSpec(spec, [liftSourceDoc()]);
  const findings = repairFindings(report, spec);
  const f = findings.find(x => x.id === 'behavior.tests');
  assert.ok(f);
  assert.equal(f.path, 'behavioralTests[0]');
  assert.equal(f.expected, 9999);
  assert.equal(f.computed, 12250.000000000002, 'full double precision, never truncated');
});

test('repairFindings: without a spec, behavior findings keep the check path and no numbers', () => {
  const spec = makeProjectileSpec();
  spec.behavioralTests[0].expectedMaxHeightM = 30;
  const report = validateSpec(spec, [projectileSourceDoc()]);
  const findings = repairFindings(report);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, '/behavioralTests');
  assert.equal(findings[0].expected, undefined);
  assert.equal(findings[0].computed, undefined);
  assert.equal(findings[0].tolerance, undefined);
});

test('repairFindings: failed checks only, in report order, messages truncated to 300 chars', () => {
  const spec = makeProjectileSpec();
  spec.title = 'According to NASA, the official conclusion of the publisher about ballistic flight and how high a ball rises';
  spec.behavioralTests[0].expectedMaxHeightM = 30;
  const report = validateSpec(spec, [projectileSourceDoc()]);
  const findings = repairFindings(report, spec);
  assert.deepEqual(findings.map(f => f.id), ['behavior.tests', 'policy.no-publisher-attribution'], 'report order, failures only');
  for (const f of findings) assert.ok(f.message.length <= 300, `${f.id} message within 300 chars`);
  const policy = report.checks.find(c => c.id === 'policy.no-publisher-attribution');
  assert.ok(policy && policy.message.length > 300, 'the policy message really is longer than the display limit');
  const policyFinding = findings.find(f => f.id === 'policy.no-publisher-attribution');
  assert.equal(policyFinding?.message, policy.message.slice(0, 300));
});

/* ------------------------------------------------------------------ */
/* compareRevisions — repair.no-weakening                              */
/* ------------------------------------------------------------------ */

test('compareRevisions: identical specs pass', () => {
  const check = compareRevisions(makeProjectileSpec(), makeProjectileSpec(), []);
  assert.equal(check.id, 'repair.no-weakening');
  assert.equal(check.kind, 'semantic');
  assert.equal(check.passed, true);
  assert.match(check.message, /projectile-v1/);
});

test('compareRevisions: engine changed always fails', () => {
  const check = compareRevisions(makeProjectileSpec(), makeLiftSpec(), []);
  assert.equal(check.passed, false);
  assert.match(check.message, /engine/);
  assert.match(check.message, /projectile-v1/);
  assert.match(check.message, /lift-equation-v1/);
});

test('compareRevisions: tolerance increase fails unless semantic.tolerance failed on the previous revision', () => {
  const prev = makeProjectileSpec();
  const next = makeProjectileSpec();
  next.behavioralTests[0].tolerance = 0.05; // 0.001 -> 0.05
  const failed = compareRevisions(prev, next, []);
  assert.equal(failed.passed, false);
  assert.match(failed.message, /earth launch/);
  assert.match(failed.message, /tolerance/);
  assert.match(failed.message, /0\.001/);
  assert.match(failed.message, /0\.05/);
  assert.equal(compareRevisions(prev, next, ['semantic.tolerance']).passed, true);
  assert.equal(
    compareRevisions(prev, next, ['behavior.tests']).passed,
    false,
    'a failing behavior check does not excuse widening tolerance to pass it',
  );
});

test('compareRevisions: prediction tolerance increase follows the same rule', () => {
  const prev = makeSoundSpec();
  const next = makeSoundSpec();
  next.predictions[0].tolerance = 0.5; // 0.01 -> 0.5
  assert.equal(compareRevisions(prev, next, []).passed, false);
  assert.equal(compareRevisions(prev, next, ['behavior.predictions']).passed, false);
  assert.equal(compareRevisions(prev, next, ['semantic.tolerance']).passed, true);
});

test('compareRevisions: tolerance decrease or unchanged tolerances pass', () => {
  const prev = makeProjectileSpec();
  const next = makeProjectileSpec();
  next.behavioralTests[0].tolerance = 0.0005;
  assert.equal(compareRevisions(prev, next, []).passed, true);
});

test('compareRevisions: range width shrink fails unless that range check failed on the previous revision', () => {
  const prev = makeProjectileSpec();
  const next = makeProjectileSpec();
  next.simulation.verticalSpeedMps = { unit: 'm/s', min: 5, max: 30, default: 20 }; // width 35 -> 25
  const failed = compareRevisions(prev, next, []);
  assert.equal(failed.passed, false);
  assert.match(failed.message, /verticalSpeedMps/);
  assert.match(failed.message, /35/);
  assert.match(failed.message, /25/);
  assert.equal(compareRevisions(prev, next, ['semantic.range.verticalSpeedMps']).passed, true);
  assert.equal(
    compareRevisions(prev, next, ['semantic.range.gravityMps2']).passed,
    false,
    'a different range check failing does not excuse shrinking this range',
  );
});

test('compareRevisions: forces ranges use the Stage 2 check ids (semantic.mass-range)', () => {
  const prev = loadForcesSpec();
  const next = loadForcesSpec();
  next.simulation.massKg = { unit: 'kg', min: 1, max: 5, default: 2 }; // width 9 -> 4
  assert.equal(compareRevisions(prev, next, []).passed, false);
  assert.equal(compareRevisions(prev, next, ['semantic.mass-range']).passed, true);
});

test('compareRevisions: range shift at the same width, and width growth, pass', () => {
  const prev = makeProjectileSpec();
  const shifted = makeProjectileSpec();
  shifted.simulation.verticalSpeedMps = { unit: 'm/s', min: 6, max: 41, default: 20 }; // width stays 35
  assert.equal(compareRevisions(prev, shifted, []).passed, true);
  const grown = makeProjectileSpec();
  grown.simulation.gravityMps2 = { unit: 'm/s^2', min: 0.5, max: 25, default: 9.8 }; // width 19 -> 24.5
  assert.equal(compareRevisions(prev, grown, []).passed, true);
});

test('compareRevisions: fewer behavioral tests or predictions always fails', () => {
  const prev = makeProjectileSpec();
  const fewerTests = makeProjectileSpec();
  fewerTests.behavioralTests.pop();
  const t = compareRevisions(prev, fewerTests, []);
  assert.equal(t.passed, false);
  assert.match(t.message, /behavioralTests/);
  assert.match(t.message, /2 -> 1/);
  assert.equal(
    compareRevisions(prev, fewerTests, ['behavior.tests']).passed,
    false,
    'deleting a failing test to pass is exactly the weakening this check catches',
  );

  const fewerPredictions = makeSoundSpec();
  const prevSound = makeSoundSpec();
  fewerPredictions.predictions.pop();
  const p = compareRevisions(prevSound, fewerPredictions, ['behavior.predictions']);
  assert.equal(p.passed, false);
  assert.match(p.message, /predictions/);
});

test('compareRevisions: adding cases passes', () => {
  const prev = makeProjectileSpec();
  const next = makeProjectileSpec();
  next.behavioralTests.push({ ...next.behavioralTests[0], name: 'extra launch', tolerance: 0.0005 });
  next.predictions.push({ ...next.predictions[0], id: 'extra-throw' });
  assert.equal(compareRevisions(prev, next, []).passed, true);
});

test('compareRevisions: message names every weakening', () => {
  const prev = makeProjectileSpec();
  const next = makeProjectileSpec();
  next.behavioralTests[0].tolerance = 0.05;
  next.simulation.verticalSpeedMps = { unit: 'm/s', min: 5, max: 30, default: 20 };
  next.predictions.pop();
  const check = compareRevisions(prev, next, []);
  assert.equal(check.passed, false);
  assert.match(check.message, /tolerance/);
  assert.match(check.message, /verticalSpeedMps/);
  assert.match(check.message, /predictions/);
});

test('compareRevisions: junk inputs fail closed and never throw', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const junk = {} as any;
  const check = compareRevisions(junk, junk, []);
  assert.equal(check.id, 'repair.no-weakening');
  assert.equal(check.passed, false);
  assert.doesNotThrow(() => compareRevisions(junk, makeProjectileSpec(), []));
  assert.doesNotThrow(() => compareRevisions(makeProjectileSpec(), junk, ['behavior.tests']));
});

/* ------------------------------------------------------------------ */
/* validateAnalysis — any engine id                                    */
/* ------------------------------------------------------------------ */

test('validateAnalysis: supported=true accepts every engine id from the catalogue', () => {
  for (const id of ENGINE_IDS) {
    const analysis = loadAnalysisFixture();
    analysis.activity = id;
    const report = validateAnalysis(analysis, [loadSourceDoc()]);
    assert.equal(checkOf(report, 'analysis.invariants').passed, true, `${id}: ${checkOf(report, 'analysis.invariants').message}`);
    assert.equal(report.publishable, true, `${id}: ${failureDetail(report)}`);
  }
});

test('validateAnalysis: supported=true with activity none fails invariants', () => {
  const analysis = loadAnalysisFixture();
  analysis.activity = 'none';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'analysis.invariants').passed, false);
  assert.match(checkOf(report, 'analysis.invariants').message, /none/);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: supported=false with any engine id fails invariants', () => {
  for (const id of ENGINE_IDS) {
    const analysis = loadAnalysisFixture();
    analysis.supported = false;
    analysis.activity = id;
    const report = validateAnalysis(analysis, [loadSourceDoc()]);
    assert.equal(checkOf(report, 'analysis.invariants').passed, false, `${id} must fail with supported=false`);
    assert.match(checkOf(report, 'analysis.invariants').message, new RegExp(id));
  }
});

test('validateAnalysis: supported=false with activity none and a reason still passes', () => {
  const analysis = loadAnalysisFixture();
  analysis.supported = false;
  analysis.activity = 'none';
  analysis.unsupportedReason = 'The source teaches flight with aerodynamic drag, which no tested engine models.';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});
