import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { assembleSpec, type GeneratedSpec, type Provenance, type SourceDocument } from '../packages/contracts/index.ts';
import { activitySpecFullSchema, activitySpecGenSchema, sourceAnalysisGenSchema } from '../packages/contracts/schemas.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validateFull = ajv.compile(activitySpecFullSchema);
const validateGen = ajv.compile(activitySpecGenSchema);
const validateAnalysis = ajv.compile(sourceAnalysisGenSchema);

test('full schema accepts the v0.2 fixture', () => {
  assert.equal(validateFull(fixture('spec.forces.v0.2.json')), true, JSON.stringify(validateFull.errors));
});

test('assembleSpec turns Muse output plus system fields into the full fixture, without source text', () => {
  const spec = assembleSpec(fixture('gen.forces.json') as GeneratedSpec, {
    id: 'forces-contract-fixture', sources: [fixture('source-doc.json') as SourceDocument],
    provenance: fixture('provenance.fixture.json') as Provenance,
  });
  assert.deepEqual(spec, fixture('spec.forces.v0.2.json'));
  assert.equal(JSON.stringify(spec).includes((fixture('source-doc.json') as SourceDocument).text), false);
  assert.equal(validateFull(spec), true, JSON.stringify(validateFull.errors));
});

test('generation schemas accept their fixtures', () => {
  assert.equal(validateGen(fixture('gen.forces.json')), true, JSON.stringify(validateGen.errors));
  assert.equal(validateAnalysis(fixture('analysis.forces.json')), true, JSON.stringify(validateAnalysis.errors));
});

test('generation schemas stay inside the constrained-decoding-safe subset', () => {
  // Meta docs: recursive schemas return HTTP 400. We also avoid refs, unions, conditionals and patterns (Muse review).
  const forbidden = ['$ref', '$defs', 'definitions', 'oneOf', 'anyOf', 'allOf', '"not"', '"if"', 'pattern', 'patternProperties'];
  for (const schema of [activitySpecGenSchema, sourceAnalysisGenSchema]) {
    const text = JSON.stringify(schema);
    for (const word of forbidden) assert.equal(text.includes(word), false, `generation schema uses ${word}`);
  }
});

test('generation schema cannot carry system-owned or executable fields', () => {
  for (const key of ['sources', 'execution', 'provenance', 'code', 'schemaVersion', 'id']) {
    const bad = { ...fixture('gen.forces.json'), [key]: 'x' };
    assert.equal(validateGen(bad), false, `gen schema accepted ${key}`);
  }
});

test('full schema rejects unsafe or malformed variants', () => {
  const mutations: Array<[string, (x: any) => void]> = [
    ['zero mass default', x => { x.simulation.massKg.default = 0; }],
    ['arbitrary engine', x => { x.simulation.engine = 'arbitrary-javascript'; }],
    ['other equation', x => { x.simulation.equation = 'a=F*m'; }],
    ['no sources', x => { x.sources = []; }],
    ['explanation without evidence', x => { x.explanations[0].evidence = []; }],
    ['code field', x => { x.code = 'fetch("https://example.com")'; }],
    ['non-meta provider', x => { x.provenance.provider = 'openai'; }],
    ['too many repairs', x => { x.execution.maxRepairAttempts = 99; }],
    ['network enabled', x => { x.execution.network = true; }],
    ['generated code enabled', x => { x.execution.generatedCodeAllowed = true; }],
    ['bad sha', x => { x.sources[0].sha256 = 'not-a-hash'; }],
    ['loose tolerance', x => { x.behavioralTests[0].tolerance = 5; }],
    ['unknown observable', x => { x.simulation.observables = ['jerk']; }],
    ['duplicate observable', x => { x.simulation.observables = ['position', 'position']; }],
    ['too long frame step', x => { x.simulation.stepS = 1; }],
    ['wrong schema version', x => { x.schemaVersion = '0.1.0'; }],
    ['html-length label', x => { x.simulation.scenario.objectLabel = 'x'.repeat(61); }],
  ];
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(fixture('spec.forces.v0.2.json'));
    mutate(copy);
    assert.equal(validateFull(copy), false, `accepted: ${name}`);
  }
});
