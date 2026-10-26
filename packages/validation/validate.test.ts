// TASK-003 — deterministic validation engine tests.
// Run: node --test packages/validation/validate.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkTrajectory, normalizeWhitespace, validateAnalysis, validateSpec } from './validate.ts';
import { loadSource } from '../sources/index.ts';
import { simulate } from '../activities/forces-1d/engine.ts';
import type { Frame } from '../activities/forces-1d/engine.ts';
import type { SourceDocument, ValidationReport } from '../contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadFixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`../../tests/fixtures/${name}`, import.meta.url), 'utf8'));
}
const loadSpec = () => loadFixture('spec.forces.v0.2.json');
const loadAnalysisFixture = () => loadFixture('analysis.forces.json');
const loadSourceDoc = (): SourceDocument => loadFixture('source-doc.json') as SourceDocument;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const SPEC_CHECK_IDS: string[] = [
  'schema.full',
  'semantic.mass-range',
  'semantic.force-range',
  'semantic.frame-budget',
  'semantic.unique-ids',
  'refs.sources',
  'refs.sha256',
  'grounding.quotes',
  'behavior.tests',
  'behavior.predictions',
  'semantic.predictions-in-range',
  'behavior.trajectory',
  'policy.no-publisher-attribution',
];

const SPEC_CHECK_KINDS: Record<string, string> = {
  'schema.full': 'schema',
  'semantic.mass-range': 'semantic',
  'semantic.force-range': 'semantic',
  'semantic.frame-budget': 'semantic',
  'semantic.unique-ids': 'semantic',
  'refs.sources': 'grounding',
  'refs.sha256': 'grounding',
  'grounding.quotes': 'grounding',
  'behavior.tests': 'behavioral',
  'behavior.predictions': 'behavioral',
  'semantic.predictions-in-range': 'semantic',
  'behavior.trajectory': 'behavioral',
  'policy.no-publisher-attribution': 'semantic',
};

const ANALYSIS_CHECK_IDS: string[] = [
  'schema.analysis',
  'analysis.invariants',
  'analysis.concept-ids',
  'refs.sources',
  'grounding.quotes',
];

function checkOf(report: ValidationReport, id: string) {
  const found = report.checks.find(c => c.id === id);
  assert.ok(found, `expected a check "${id}", report has [${report.checks.map(c => c.id).join(', ')}]`);
  return found;
}

function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

/**
 * Mutate a clone of the valid fixture, then assert the schema check still
 * passes, exactly `expected` checks fail, and the report is not publishable.
 */
function expectSpecFailures(
  mutate: (spec: any) => void,
  expected: string[],
  sources?: SourceDocument[],
): ValidationReport {
  const spec = loadSpec();
  mutate(spec);
  const report = validateSpec(spec, sources ?? [loadSourceDoc()]);
  assert.equal(checkOf(report, 'schema.full').passed, true, 'mutation must keep the spec schema-valid');
  assert.deepEqual(failedIds(report), expected);
  assert.equal(report.publishable, false);
  assert.equal(report.artifactId, 'forces-contract-fixture');
  assert.equal(report.revision, 1);
  return report;
}

/* ------------------------------------------------------------------ */
/* normalizeWhitespace                                                 */
/* ------------------------------------------------------------------ */

test('normalizeWhitespace collapses whitespace runs and trims, case-sensitively', () => {
  assert.equal(normalizeWhitespace('  a \n\n b\t   c  '), 'a b c');
  assert.equal(normalizeWhitespace('A  B'), 'A B');
  assert.equal(normalizeWhitespace('keep "quotes" and … as-is'), 'keep "quotes" and … as-is');
  assert.equal(normalizeWhitespace('   \n\t '), '');
  assert.equal(normalizeWhitespace('single'), 'single');
});

/* ------------------------------------------------------------------ */
/* validateSpec — happy path                                           */
/* ------------------------------------------------------------------ */

test('validateSpec: valid fixture passes all 13 checks and is publishable', () => {
  const report = validateSpec(loadSpec(), [loadSourceDoc()]);
  assert.deepEqual(report.checks.map(c => c.id), SPEC_CHECK_IDS);
  for (const c of report.checks) {
    assert.equal(c.kind, SPEC_CHECK_KINDS[c.id], `check ${c.id} must have kind ${SPEC_CHECK_KINDS[c.id]}`);
    assert.equal(typeof c.message, 'string');
    assert.ok(c.message.length > 0, `check ${c.id} must carry a message`);
    assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  }
  assert.equal(report.publishable, true);
  assert.equal(report.artifactId, 'forces-contract-fixture');
  assert.equal(report.revision, 1);
});

/* ------------------------------------------------------------------ */
/* validateSpec — one failing mutation per check (2–13)                */
/* ------------------------------------------------------------------ */

test('validateSpec: default mass above slider max fails semantic.mass-range only', () => {
  const report = expectSpecFailures(s => { s.simulation.massKg.default = 20; }, ['semantic.mass-range']);
  const msg = checkOf(report, 'semantic.mass-range').message;
  assert.match(msg, /20/);
  assert.match(msg, /10/); // names the expected bound (max)
});

test('validateSpec: default force above slider max fails semantic.force-range only', () => {
  const report = expectSpecFailures(s => { s.simulation.netForceN.default = 50; }, ['semantic.force-range']);
  assert.match(checkOf(report, 'semantic.force-range').message, /50/);
});

test('validateSpec: min/max swapped fails semantic.force-range only', () => {
  // A swapped range also pushes the 10 N prediction out of range, so both
  // the range check and predictions-in-range must fail — publish stays blocked.
  const report = expectSpecFailures(s => {
    s.simulation.netForceN.min = 10;
    s.simulation.netForceN.max = -10;
  }, ['semantic.force-range', 'semantic.predictions-in-range']);
  assert.match(checkOf(report, 'semantic.force-range').message, /min/);
});

test('validateSpec: durationS 30 with stepS 0.001 exceeds the frame budget', () => {
  // simulate() would need 30001 frames > MAX_FRAMES (3001); the trajectory
  // check cannot run either, so it fails with the same root cause.
  const report = expectSpecFailures(s => {
    s.simulation.durationS = 30;
    s.simulation.stepS = 0.001;
  }, ['semantic.frame-budget', 'behavior.trajectory']);
  assert.match(checkOf(report, 'semantic.frame-budget').message, /30001/);
  assert.match(checkOf(report, 'semantic.frame-budget').message, /3001/);
});

test('validateSpec: duplicate explanation id fails semantic.unique-ids only', () => {
  const report = expectSpecFailures(s => { s.explanations[1].id = s.explanations[0].id; }, ['semantic.unique-ids']);
  assert.match(checkOf(report, 'semantic.unique-ids').message, /second-law/);
});

test('validateSpec: evidence sourceId not declared in spec.sources fails refs.sources only', () => {
  const report = expectSpecFailures(s => { s.explanations[0].evidence[0].sourceId = 'missing'; }, ['refs.sources']);
  assert.match(checkOf(report, 'refs.sources').message, /missing/);
});

test('validateSpec: spec source without a provided document fails refs.sources only', () => {
  expectSpecFailures(() => {}, ['refs.sources'], []); // no documents at all
  const s = loadSpec();
  s.sources.push({
    id: 'source-2', title: 'Undeclared doc', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'none', sha256: 'a'.repeat(64),
  });
  const report = validateSpec(s, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['refs.sources']);
  assert.equal(report.publishable, false);
});

test('validateSpec: tampered document text (sha256 field unchanged) fails refs.sha256 only', () => {
  const doc = loadSourceDoc();
  const tampered: SourceDocument = { ...doc, text: doc.text.replace('Original test text', 'Tampered test text') };
  const report = expectSpecFailures(() => {}, ['refs.sha256'], [tampered]);
  assert.match(checkOf(report, 'refs.sha256').message, /source-1/);
});

test('validateSpec: paraphrased quote fails grounding.quotes only', () => {
  const report = expectSpecFailures(
    s => { s.explanations[0].evidence[0].quote = 'net force equals mass times deceleration'; },
    ['grounding.quotes'],
  );
  assert.match(checkOf(report, 'grounding.quotes').message, /net force equals mass times deceleration/);
});

test('validateSpec: wrong expected acceleration in behavioralTests fails behavior.tests only', () => {
  // m=2 kg, F=4 N -> a=2; claiming 3 exceeds the 1e-6 tolerance.
  const report = expectSpecFailures(s => { s.behavioralTests[0].expectedAccelerationMps2 = 3; }, ['behavior.tests']);
  assert.match(checkOf(report, 'behavior.tests').message, /positive force/);
});

test('validateSpec: wrong expected acceleration in predictions fails behavior.predictions only', () => {
  const report = expectSpecFailures(s => { s.predictions[0].expectedAccelerationMps2 = 4.9; }, ['behavior.predictions']);
  assert.match(checkOf(report, 'behavior.predictions').message, /double-force/);
});

test('validateSpec: prediction mass outside slider range fails semantic.predictions-in-range only', () => {
  // Keep the physics consistent (a = 10/20 = 0.5) so behavior.predictions still passes.
  const report = expectSpecFailures(s => {
    s.predictions[0].massKg = 20;
    s.predictions[0].expectedAccelerationMps2 = 0.5;
  }, ['semantic.predictions-in-range']);
  assert.match(checkOf(report, 'semantic.predictions-in-range').message, /20/);
});

test('validateSpec: title attributing claims to NASA fails policy.no-publisher-attribution only', () => {
  const report = expectSpecFailures(
    s => { s.title = 'According to NASA, force equals mass times acceleration'; },
    ['policy.no-publisher-attribution'],
  );
  assert.match(checkOf(report, 'policy.no-publisher-attribution').message, /title/);
});

test('validateSpec: "NASA states" in a learning objective fails the attribution policy', () => {
  expectSpecFailures(
    s => { s.learningObjectives[0] = 'NASA states that acceleration equals net force divided by mass.'; },
    ['policy.no-publisher-attribution'],
  );
});

/* ------------------------------------------------------------------ */
/* validateSpec — schema gate                                          */
/* ------------------------------------------------------------------ */

test('validateSpec: schema failure returns a single failed schema.full check and never throws', () => {
  for (const input of [null, 'text', {}, undefined, 42, [], true]) {
    const report = validateSpec(input, [loadSourceDoc()]);
    assert.equal(report.checks.length, 1, `input ${JSON.stringify(input)} must yield exactly one check`);
    assert.equal(report.checks[0].id, 'schema.full');
    assert.equal(report.checks[0].kind, 'schema');
    assert.equal(report.checks[0].passed, false);
    assert.equal(report.publishable, false);
    assert.equal(report.artifactId, 'unknown');
    assert.equal(report.revision, 1);
  }
});

test('validateSpec: schema failure message lists errors as instancePath + message, max 5', () => {
  const report = validateSpec({}, [loadSourceDoc()]);
  const msg = report.checks[0].message;
  assert.match(msg, /must have required property 'schemaVersion'/);
  assert.match(msg, /\(\+6 more\)/); // 11 required properties missing -> 5 shown + 6 more
});

test('validateSpec: schema failure keeps a string spec.id as artifactId', () => {
  const report = validateSpec({ id: 'partial-spec' }, []);
  assert.equal(report.artifactId, 'partial-spec');
  const numeric = validateSpec({ id: 17 }, []);
  assert.equal(numeric.artifactId, 'unknown');
});

test('validateSpec: never throws even with a malformed sources argument', () => {
  assert.doesNotThrow(() => validateSpec(null, undefined as unknown as SourceDocument[]));
  assert.doesNotThrow(() => validateSpec(loadSpec(), undefined as unknown as SourceDocument[]));
  const report = validateSpec(loadSpec(), null as unknown as SourceDocument[]);
  assert.deepEqual(failedIds(report), ['refs.sources']);
});

/* ------------------------------------------------------------------ */
/* validateSpec — whitespace normalisation                             */
/* ------------------------------------------------------------------ */

test('validateSpec: quote with newlines and double spaces still grounds after normalisation', () => {
  const spec = loadSpec();
  spec.explanations[0].evidence[0].quote = 'net force equals\n mass    times  acceleration';
  const report = validateSpec(spec, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'grounding.quotes').passed, true);
  assert.equal(report.publishable, true);
});

test('validateSpec: ellipsis quote that is not verbatim in the source fails grounding', () => {
  const spec = loadSpec();
  spec.explanations[0].evidence[0].quote = 'net force equals ... mass times acceleration';
  const report = validateSpec(spec, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'grounding.quotes').passed, false);
  assert.match(checkOf(report, 'grounding.quotes').message, /net force equals \.\.\. mass times acceleration/);
  assert.equal(report.publishable, false);
});

test('validateSpec: failing quotes are truncated to 60 characters in the message', () => {
  const spec = loadSpec();
  spec.explanations[0].evidence[0].quote = `x${'y'.repeat(100)}`;
  const report = validateSpec(spec, [loadSourceDoc()]);
  const msg = checkOf(report, 'grounding.quotes').message;
  assert.ok(msg.includes(`x${'y'.repeat(59)}`), 'first 60 characters of the quote must appear');
  assert.ok(!msg.includes('y'.repeat(60)), 'quote must be truncated to 60 characters');
});

/* ------------------------------------------------------------------ */
/* validateSpec — real licensed source                                 */
/* ------------------------------------------------------------------ */

test('validateSpec: real NASA GRC source grounds an exact quote and rejects a paraphrase', () => {
  const nasa = loadSource('nasa-grc-equations-of-motion');
  const spec = loadSpec();
  spec.sources[0] = {
    id: nasa.id, title: nasa.title, locator: nasa.locator,
    license: nasa.license, attribution: nasa.attribution, sha256: nasa.sha256,
  };
  spec.explanations[0].evidence[0] = {
    sourceId: nasa.id,
    quote: 'For a constant force and constant mass, the acceleration remains constant.',
  };
  spec.explanations[1].evidence[0] = {
    sourceId: nasa.id,
    quote: 'the basic equations of motion can be solved',
  };

  const grounded = validateSpec(spec, [nasa]);
  assert.deepEqual(failedIds(grounded), [], grounded.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(grounded.publishable, true);

  const paraphrased = structuredClone(spec);
  paraphrased.explanations[1].evidence[0].quote = 'Acceleration always stays the same.';
  const report = validateSpec(paraphrased, [nasa]);
  assert.deepEqual(failedIds(report), ['grounding.quotes']);
  assert.equal(report.publishable, false);
});

/* ------------------------------------------------------------------ */
/* checkTrajectory (check 12 unit-tested directly)                     */
/* ------------------------------------------------------------------ */

test('checkTrajectory: accepts exact closed-form simulate() output', () => {
  const frames = simulate({ massKg: 2, netForceN: 4, durationS: 1, stepS: 0.1 });
  const result = checkTrajectory(frames);
  assert.equal(result.passed, true, result.message);
});

test('checkTrajectory: rejects frames violating v = a*t', () => {
  const frames: Frame[] = [
    { t: 0, x: 0, v: 0, a: 2 },
    { t: 1, x: 1, v: 3, a: 2 }, // v should be a*t = 2
  ];
  const result = checkTrajectory(frames);
  assert.equal(result.passed, false);
  assert.match(result.message, /frame 1/);
  assert.match(result.message, /v=3/);
  assert.match(result.message, /2/); // expected value named
});

test('checkTrajectory: rejects frames violating x = 0.5*a*t^2 beyond tolerance', () => {
  const frames: Frame[] = [
    { t: 0, x: 0, v: 0, a: 2 },
    { t: 1, x: 1.5, v: 2, a: 2 }, // x should be 0.5*2*1 = 1
  ];
  const result = checkTrajectory(frames);
  assert.equal(result.passed, false);
  assert.match(result.message, /x=1\.5/);
});

test('checkTrajectory: rejects fewer than 2 frames and non-finite values', () => {
  assert.equal(checkTrajectory([]).passed, false);
  const single = simulate({ massKg: 2, netForceN: 4, durationS: 1, stepS: 1 });
  assert.equal(checkTrajectory(single.slice(0, 1)).passed, false);

  const frames = simulate({ massKg: 2, netForceN: 4, durationS: 1, stepS: 0.25 });
  const bad = structuredClone(frames);
  bad[2].x = Number.NaN;
  assert.equal(checkTrajectory(bad).passed, false);
  const bad2 = structuredClone(frames);
  bad2[1].v = Number.POSITIVE_INFINITY;
  assert.equal(checkTrajectory(bad2).passed, false);
});

test('validateSpec: behavior.trajectory passes for the valid default simulation', () => {
  const report = validateSpec(loadSpec(), [loadSourceDoc()]);
  assert.equal(checkOf(report, 'behavior.trajectory').passed, true);
});

/* ------------------------------------------------------------------ */
/* validateAnalysis                                                    */
/* ------------------------------------------------------------------ */

test('validateAnalysis: valid fixture is publishable with all 5 checks', () => {
  const report = validateAnalysis(loadAnalysisFixture(), [loadSourceDoc()]);
  assert.deepEqual(report.checks.map(c => c.id), ANALYSIS_CHECK_IDS);
  for (const c of report.checks) assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  assert.equal(report.publishable, true);
  assert.equal(report.artifactId, 'source-analysis');
  assert.equal(report.revision, 1);
});

test('validateAnalysis: supported=false with activity forces-1d-v1 fails invariants', () => {
  const analysis = loadAnalysisFixture();
  analysis.supported = false; // activity stays 'forces-1d-v1'
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'analysis.invariants').passed, false);
  assert.match(checkOf(report, 'analysis.invariants').message, /forces-1d-v1/);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: supported=false with blank unsupportedReason fails invariants', () => {
  const analysis = loadAnalysisFixture();
  analysis.supported = false;
  analysis.activity = 'none';
  analysis.unsupportedReason = '   ';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'analysis.invariants').passed, false);
  assert.match(checkOf(report, 'analysis.invariants').message, /unsupportedReason/);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: supported=false with activity none and a real reason passes', () => {
  const analysis = loadAnalysisFixture();
  analysis.supported = false;
  analysis.activity = 'none';
  analysis.unsupportedReason = 'Source is a poem; it does not teach 1D Newtonian mechanics.';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'analysis.invariants').passed, true);
  assert.equal(report.publishable, true);
});

test('validateAnalysis: duplicate concept id fails concept-ids only', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts.push(structuredClone(analysis.concepts[0]));
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['analysis.concept-ids']);
  assert.match(checkOf(report, 'analysis.concept-ids').message, /newtons-second-law/);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: concept id outside /^[a-z0-9-]{1,40}$/ fails concept-ids only', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].id = 'Has Spaces';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['analysis.concept-ids']);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: evidence sourceId without a document fails refs.sources only', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].evidence[0].sourceId = 'missing';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['refs.sources']);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: paraphrased quote fails grounding.quotes only', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].evidence[0].quote = 'force is basically mass times acceleration';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['grounding.quotes']);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: whitespace-only differences in a quote still ground', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].evidence[0].quote = 'net force equals\n  mass   times acceleration';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'grounding.quotes').passed, true);
  assert.equal(report.publishable, true);
});

test('validateAnalysis: schema failure returns a single failed schema.analysis check and never throws', () => {
  for (const input of [null, 'text', {}, undefined, 7]) {
    const report = validateAnalysis(input, [loadSourceDoc()]);
    assert.equal(report.checks.length, 1);
    assert.equal(report.checks[0].id, 'schema.analysis');
    assert.equal(report.checks[0].kind, 'schema');
    assert.equal(report.checks[0].passed, false);
    assert.equal(report.publishable, false);
    assert.equal(report.artifactId, 'source-analysis');
    assert.equal(report.revision, 1);
  }
  assert.doesNotThrow(() => validateAnalysis(null, undefined as unknown as SourceDocument[]));
});
