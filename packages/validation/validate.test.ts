// TASK-003 — deterministic validation engine tests.
// Run: node --test packages/validation/validate.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { checkTrajectory, normalizeWhitespace, quoteCountsAsEvidence, validateAnalysis, validateSpec } from './validate.ts';
import { loadSource, sha256 } from '../sources/index.ts';
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
  'semantic.tolerance',
  'semantic.predictions-in-range',
  'behavior.trajectory',
  'policy.no-publisher-attribution',
  'scope.prose-unverified',
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
  'semantic.tolerance': 'semantic',
  'semantic.predictions-in-range': 'semantic',
  'behavior.trajectory': 'behavioral',
  'policy.no-publisher-attribution': 'semantic',
  'scope.prose-unverified': 'semantic',
};

const ANALYSIS_CHECK_IDS: string[] = [
  'schema.analysis',
  'analysis.invariants',
  'analysis.concept-ids',
  'refs.sources',
  'grounding.quotes',
  'policy.no-publisher-attribution',
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

test('validateSpec: valid fixture passes all 15 checks and is publishable', () => {
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
  // A known engine id but nothing else: the Ajv gate (not the engine gate) reports the missing properties.
  const report = validateSpec({ simulation: { engine: 'forces-1d-v1' } }, [loadSourceDoc()]);
  assert.equal(report.checks.length, 1);
  const msg = report.checks[0].message;
  assert.match(msg, /must have required property 'schemaVersion'/);
  assert.match(msg, /\(\+\d+ more\)/); // 17 schema errors -> 5 shown + the rest counted
});

test('validateSpec: forces tolerance above the schema cap (0.01) fails schema.full alone', () => {
  // The Stage 2 forces schema caps tolerance at 0.01 = absMax, so semantic.tolerance
  // can never fire for a schema-valid forces spec — stored evidence stays valid.
  const spec = loadSpec();
  spec.behavioralTests[0].tolerance = 0.02;
  const report = validateSpec(spec, [loadSourceDoc()]);
  assert.equal(report.checks.length, 1);
  assert.deepEqual(failedIds(report), ['schema.full']);
  assert.equal(report.publishable, false);
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

test('validateAnalysis: valid fixture is publishable with all 6 checks', () => {
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

/* ------------------------------------------------------------------ */
/* R-05 — quotes must count as evidence (no whitespace/empty bypass)   */
/* ------------------------------------------------------------------ */

test('quoteCountsAsEvidence: >= 8 normalised characters and >= 3 letters/digits', () => {
  // The reviewer's bypass: whitespace normalises to '' which is a substring of everything.
  assert.equal(quoteCountsAsEvidence('   '), false);
  assert.equal(quoteCountsAsEvidence('\n\t  \n'), false);
  assert.equal(quoteCountsAsEvidence(''), false);
  // Present in a source but too short to be evidence on its own.
  assert.equal(quoteCountsAsEvidence('m * a'), false); // 5 chars
  assert.equal(quoteCountsAsEvidence('F = m * a'), true); // 9 chars, 3 letters/digits
  // Long enough but fewer than 3 letters/digits.
  assert.equal(quoteCountsAsEvidence('- - - - - - - -'), false);
  assert.equal(quoteCountsAsEvidence('a b c d e f g h'), true);
  // Unicode letters/digits count.
  assert.equal(quoteCountsAsEvidence('运动方程描述物体的加速度'), true);
});

test('validateSpec: whitespace-only quotes everywhere fail grounding.quotes (R-05 reviewer probe)', () => {
  // Reviewer P1: every quote replaced by '   ' used to yield publishable=true 13/13.
  const report = expectSpecFailures(
    s => {
      for (const ex of s.explanations) {
        for (const ev of ex.evidence) {
          ev.quote = '   ';
        }
      }
    },
    ['grounding.quotes'],
  );
  const msg = checkOf(report, 'grounding.quotes').message;
  assert.match(msg, /second-law/, 'the failing explanation is named');
  assert.match(msg, /8/, 'the message states the minimum normalised length');
});

test('validateSpec: a quote present in the source but too short to count fails grounding.quotes (R-05)', () => {
  const text =
    'Newton second law: net force equals mass times acceleration. SI units: newton, kilogram, metre per second squared. The product m * a equals the net force.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'Short-quote source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const report = expectSpecFailures(
    s => {
      s.sources[0].sha256 = sha256(text);
      s.explanations[0].evidence[0].quote = 'm * a'; // verbatim in the source, but only 5 chars
    },
    ['grounding.quotes'],
    [doc],
  );
  assert.match(checkOf(report, 'grounding.quotes').message, /m \* a/);
});

test('validateSpec: a real short formula quote "F = m * a" still counts and grounds (R-05)', () => {
  const text =
    'For a constant mass, F = m * a relates net force to acceleration. SI units: newton, kilogram, metre per second squared.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'Formula source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const spec = loadSpec();
  spec.sources[0].sha256 = sha256(text);
  spec.explanations[0].evidence = [{ sourceId: 'source-1', quote: 'F = m * a' }]; // 9 chars, 3 letters/digits
  const report = validateSpec(spec, [doc]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(checkOf(report, 'grounding.quotes').passed, true);
  assert.equal(report.publishable, true);
});

test('validateAnalysis: supported analysis with all concept evidence removed fails (R-05 reviewer probe)', () => {
  // Reviewer P1: removing every concept evidence entry used to yield publishable=true 5/5.
  const analysis = loadAnalysisFixture();
  for (const c of analysis.concepts) {
    c.evidence = [];
  }
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['grounding.quotes']);
  assert.match(checkOf(report, 'grounding.quotes').message, /newtons-second-law/);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: whitespace-only concept quotes fail grounding.quotes (R-05)', () => {
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].evidence[0].quote = ' \n\t ';
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['grounding.quotes']);
  assert.equal(report.publishable, false);
});

test('validateAnalysis: unsupported analysis without concepts still passes grounding (R-05)', () => {
  const analysis = loadAnalysisFixture();
  analysis.supported = false;
  analysis.activity = 'none';
  analysis.unsupportedReason = 'Source is a poem; it does not teach 1D Newtonian mechanics.';
  analysis.concepts = [];
  const report = validateAnalysis(analysis, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), []);
  assert.equal(report.publishable, true);
});

/* ------------------------------------------------------------------ */
/* R-12 — publisher attribution across EVERY generated display field   */
/* ------------------------------------------------------------------ */

test('validateSpec: reviewer-probe title and scenario label fail policy.no-publisher-attribution (R-12)', () => {
  const report = expectSpecFailures(
    s => {
      s.title = "NASA's official conclusion: this activity is endorsed by NASA";
      s.simulation.scenario.objectLabel = 'According to NASA';
    },
    ['policy.no-publisher-attribution'],
  );
  const msg = checkOf(report, 'policy.no-publisher-attribution').message;
  assert.match(msg, /\/title/);
  assert.match(msg, /objectLabel/);
});

test('validateSpec: attribution wording fails in every generated display field (R-12)', () => {
  const mutations: [(s: any) => void, string][] = [
    [s => { s.learningObjectives[0] = 'See the official position of the publisher on acceleration.'; }, 'learningObjectives'],
    [s => { s.explanations[0].text = 'National Aeronautics and Space Administration materials explain this.'; }, 'explanations text'],
    [s => { s.predictions[0].prompt = 'Guess what NASA says happens.'; }, 'prediction prompt'],
    [s => { s.behavioralTests[0].name = 'endorsed by NASA check'; }, 'behavioral test name'],
    [s => { s.simulation.scenario.surfaceLabel = 'approved by NASA surface'; }, 'surfaceLabel'],
  ];
  for (const [mutate, label] of mutations) {
    expectSpecFailures(mutate, ['policy.no-publisher-attribution']);
    void label;
  }
});

test('validateSpec: evidence quotes are exempt from the attribution policy (R-12)', () => {
  const text =
    'Newton second law: net force equals mass times acceleration. NASA provides these equations of motion for constant forces. SI units: newton, kilogram, metre per second squared.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'NASA-mentioning source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const spec = loadSpec();
  spec.sources[0].sha256 = sha256(text);
  spec.explanations[0].evidence = [
    { sourceId: 'source-1', quote: 'NASA provides these equations of motion for constant forces.' },
  ];
  const report = validateSpec(spec, [doc]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(report.publishable, true);
});

test('validateAnalysis: publisher attribution in concept names, objectives or unsupportedReason fails (R-12)', () => {
  const byName = loadAnalysisFixture();
  byName.concepts[0].name = 'According to NASA, force rules motion';
  let report = validateAnalysis(byName, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);

  const byObjective = loadAnalysisFixture();
  byObjective.objectives[0] = 'Learn why the official position of NASA matters.';
  report = validateAnalysis(byObjective, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);

  const byReason = loadAnalysisFixture();
  byReason.supported = false;
  byReason.activity = 'none';
  byReason.unsupportedReason = 'This source is endorsed by NASA but teaches sound, not forces.';
  report = validateAnalysis(byReason, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);
});

/* ------------------------------------------------------------------ */
/* R-08 — honest scope: prose is not machine-verified                  */
/* ------------------------------------------------------------------ */

test('validateSpec: scope.prose-unverified always passes with the exact honest-scope message (R-08)', () => {
  const expected =
    'Explanation prose is AI-generated; quotes, numbers and ranges are machine-checked, the wording needs teacher review.';
  const report = validateSpec(loadSpec(), [loadSourceDoc()]);
  const scope = checkOf(report, 'scope.prose-unverified');
  assert.equal(scope.kind, 'semantic');
  assert.equal(scope.passed, true);
  assert.equal(scope.message, expected);
  // It also passes (and is present) when other checks fail — it documents scope, not quality.
  const failing = validateSpec(loadSpec(), []);
  assert.equal(failing.publishable, false);
  assert.equal(checkOf(failing, 'scope.prose-unverified').passed, true);
  assert.equal(checkOf(failing, 'scope.prose-unverified').message, expected);
});

/* ------------------------------------------------------------------ */
/* N-06 — qualified publisher policy: attribution wording fails only   */
/* when it names a source or authority                                 */
/* ------------------------------------------------------------------ */

test('validateSpec: benign "according to the net force divided by its mass" prose passes policy (N-06 reviewer probe)', () => {
  // Reviewer P1 (N-06): changing ONLY the explanation prose to this normal physics
  // sentence used to fail policy.no-publisher-attribution and block the artifact.
  const spec = loadSpec();
  spec.explanations[0].text = 'The object accelerates according to the net force divided by its mass.';
  const report = validateSpec(spec, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(checkOf(report, 'policy.no-publisher-attribution').passed, true);
  assert.equal(report.publishable, true);
});

test('validateSpec: attribution wording naming a source or authority fails policy (N-06)', () => {
  const mutations: [(s: any) => void, string][] = [
    [s => { s.explanations[0].text = 'The result holds according to the source.'; }, 'according to the source'],
    [s => { s.explanations[1].text = 'Units follow according to the text.'; }, 'according to the text'],
    [s => { s.title = 'Motion endorsed by Glenn Research Center'; }, 'endorsed by Glenn Research Center'],
    [s => { s.learningObjectives[0] = 'See the official position of the agency on acceleration.'; }, 'official position of the agency'],
    [s => { s.behavioralTests[0].name = 'official conclusion of the author check'; }, 'official conclusion of the author'],
    [s => { s.predictions[0].prompt = "According to Newton's law, what is the acceleration?"; }, "according to Newton's law (capitalised authority)"],
  ];
  for (const [mutate, label] of mutations) {
    const report = expectSpecFailures(mutate, ['policy.no-publisher-attribution']);
    assert.match(checkOf(report, 'policy.no-publisher-attribution').message, /attribution/, label);
  }
});

test('validateSpec: the capitalised-follower rule is case-sensitive, the trigger rule case-insensitive (N-06)', () => {
  // No capitalised follower and no source noun: benign, even for an uppercase trigger.
  const benign = loadSpec();
  benign.explanations[0].text = 'This result is endorsed by glenn research center measurements.';
  let report = validateSpec(benign, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'policy.no-publisher-attribution').passed, true, 'lowercase follower does not name an authority');
  assert.equal(report.publishable, true);

  const upperTrigger = loadSpec();
  upperTrigger.explanations[0].text = 'ACCORDING TO the net force, the cart speeds up.';
  report = validateSpec(upperTrigger, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'policy.no-publisher-attribution').passed, true, 'the trigger is matched case-insensitively but the follower stays lowercase');
  assert.equal(report.publishable, true);

  // An uppercase trigger followed by a capitalised word still fails.
  expectSpecFailures(s => { s.title = 'APPROVED BY Glenn Research Center'; }, ['policy.no-publisher-attribution']);
});

test('validateSpec: a capitalised follower counts only within the 40-character window (N-06)', () => {
  const inside = loadSpec();
  inside.explanations[0].text = `The effect appears according to ${'a'.repeat(33)} Newton law.`; // capital at window offset 35
  let report = validateSpec(inside, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);

  const outside = loadSpec();
  outside.explanations[0].text = `The effect appears according to ${'a'.repeat(45)} Newton law.`; // capital at window offset 47
  report = validateSpec(outside, [loadSourceDoc()]);
  assert.equal(checkOf(report, 'policy.no-publisher-attribution').passed, true, 'beyond 40 characters the follower no longer counts');
  assert.equal(report.publishable, true);
});

test('validateSpec: plain NASA / full publisher name still fails anywhere without attribution wording (N-06)', () => {
  expectSpecFailures(s => { s.title = 'The NASA cart: force and acceleration'; }, ['policy.no-publisher-attribution']);
  expectSpecFailures(
    s => { s.simulation.scenario.surfaceLabel = 'National Aeronautics and Space Administration track'; },
    ['policy.no-publisher-attribution'],
  );
});

test('validateAnalysis: benign "according to" prose passes; naming an authority fails (N-06)', () => {
  const benign = loadAnalysisFixture();
  benign.objectives[0] = 'Predict motion according to the net force and the mass.';
  let report = validateAnalysis(benign, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(report.publishable, true);

  const named = loadAnalysisFixture();
  named.concepts[0].name = 'Endorsed by Glenn Research Center law';
  report = validateAnalysis(named, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);

  const byReason = loadAnalysisFixture();
  byReason.supported = false;
  byReason.activity = 'none';
  byReason.unsupportedReason = 'According to the author, this material teaches sound, not forces.';
  report = validateAnalysis(byReason, [loadSourceDoc()]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);
});

/* ------------------------------------------------------------------ */
/* N-07 — compact equation quotes ('F=ma') count as evidence           */
/* ------------------------------------------------------------------ */

test('quoteCountsAsEvidence: compact equations containing "=" count from 3 normalised chars (N-07)', () => {
  assert.equal(quoteCountsAsEvidence('F=ma'), true, 'the reviewer\'s compact formula');
  assert.equal(quoteCountsAsEvidence('E=mc2'), true);
  assert.equal(quoteCountsAsEvidence('v=d/t'), true);
  assert.equal(quoteCountsAsEvidence(' F = ma '), true, 'normalises to "F = ma" (6 chars, =, 3 letters)');
  // Still rejected: fewer than 3 letters/digits, or short without '='.
  assert.equal(quoteCountsAsEvidence('a=b'), false);
  assert.equal(quoteCountsAsEvidence('F=m'), false);
  assert.equal(quoteCountsAsEvidence('='), false);
  assert.equal(quoteCountsAsEvidence('a='), false);
  assert.equal(quoteCountsAsEvidence('Fma'), false, 'short without "=" is not an equation');
  assert.equal(quoteCountsAsEvidence('x*y'), false);
  assert.equal(quoteCountsAsEvidence('m * a'), false, 'short non-equation quotes still fail');
  assert.equal(quoteCountsAsEvidence('   '), false);
  assert.equal(quoteCountsAsEvidence(''), false);
  // The ordinary length rule is unchanged.
  assert.equal(quoteCountsAsEvidence('F = m * a'), true);
});

test('validateSpec: the reviewer\'s hash-matched "F=ma" quote grounds as compact equation evidence (N-07)', () => {
  // Reviewer P1 (N-07): an exact source containing 'F=ma', matching sha256 and a
  // quote citing that formula used to fail grounding solely on the 8-char minimum.
  const text =
    'Newton second law: the compact form F=ma relates net force to acceleration. SI units: newton, kilogram, metre per second squared.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'Compact-formula source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const spec = loadSpec();
  spec.sources[0].sha256 = sha256(text);
  spec.explanations[0].evidence = [{ sourceId: 'source-1', quote: 'F=ma' }];
  const report = validateSpec(spec, [doc]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(checkOf(report, 'grounding.quotes').passed, true);
  assert.equal(report.publishable, true);
});

test('validateSpec: a short quote without "=" still fails grounding.quotes (N-07 boundary)', () => {
  const text =
    'Newton second law: net force equals mass times acceleration, written Fma in compact form. SI units: newton, kilogram, metre per second squared.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'Short-quote source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const report = expectSpecFailures(
    s => {
      s.sources[0].sha256 = sha256(text);
      s.explanations[0].evidence[0].quote = 'Fma'; // verbatim in the source, but short and no '='
    },
    ['grounding.quotes'],
    [doc],
  );
  assert.match(checkOf(report, 'grounding.quotes').message, /Fma/);
});

test('validateAnalysis: a compact "F=ma" concept quote counts and grounds (N-07)', () => {
  const text =
    'Newton second law: F=ma relates net force to acceleration. Original test text authored for this repository.\n';
  const doc: SourceDocument = {
    id: 'source-1', title: 'Compact-formula source', locator: 'tests/fixtures/none.txt',
    license: 'CC0-1.0', attribution: 'test', sha256: sha256(text), text,
  };
  const analysis = loadAnalysisFixture();
  analysis.concepts[0].evidence[0].quote = 'F=ma';
  const report = validateAnalysis(analysis, [doc]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; '));
  assert.equal(checkOf(report, 'grounding.quotes').passed, true);
  assert.equal(report.publishable, true);
});
