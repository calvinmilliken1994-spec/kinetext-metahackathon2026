// TASK-019 — timeline-v1 contracts (Stage 5b plan, Muse design review dispositions).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import {
  ENGINE_IDS, SEQUENCE_ENGINES, SEQUENCE_ENGINE_IDS, assembleTimelineSpec, isSequenceEngineId,
  type Provenance, type SourceDocument, type TimelineGeneratedSpec,
} from '../packages/contracts/index.ts';
import { timelineFullSchema, timelineGenSchema } from '../packages/contracts/schemas.ts';
import { loadSource } from '../packages/sources/index.ts';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const gen = (): TimelineGeneratedSpec => fixture('timeline.declaration.gen.json');
const ajv = new Ajv({ allErrors: true, strict: false });
const validGen = ajv.compile(timelineGenSchema);
const validFull = ajv.compile(timelineFullSchema);

const source: SourceDocument = loadSource('nara-declaration-of-independence');
const provenance: Provenance = fixture('provenance.fixture.json');

function assemble(g: TimelineGeneratedSpec = gen()) {
  return assembleTimelineSpec(g, { id: 'tl-1', sources: [source], provenance });
}

test('timeline-v1 is a sequence engine, kept out of ENGINE_IDS until every consumer supports it', () => {
  assert.deepEqual([...SEQUENCE_ENGINE_IDS], ['timeline-v1']);
  assert.ok(isSequenceEngineId('timeline-v1'));
  assert.ok(!isSequenceEngineId('projectile-v1'));
  assert.ok(!(ENGINE_IDS as readonly string[]).includes('timeline-v1'));
  const d = SEQUENCE_ENGINES['timeline-v1'];
  assert.equal(d.kind, 'sequence');
  assert.deepEqual(d.scenarioKeys, ['subjectLabel', 'settingLabel']);
  assert.deepEqual(d.events, { min: 5, max: 10 });
  assert.ok(d.appliesWhen.length > 50);
});

test('the real Declaration fixture matches the generated (constrained-decoding) schema', () => {
  assert.ok(validGen(gen()), JSON.stringify(validGen.errors));
});

test('assembleTimelineSpec adds system-owned fields, never copies source text, drops unknown simulation fields', () => {
  const g = gen() as unknown as Record<string, any>;
  g.simulation.engine = 'projectile-v1';
  g.simulation.injected = 'x';
  const spec = assemble(g as TimelineGeneratedSpec);
  assert.equal(spec.simulation.engine, 'timeline-v1');
  assert.ok(!('injected' in spec.simulation));
  assert.ok(!('equation' in spec.simulation));
  assert.equal(spec.simulation.events.length, 6);
  assert.equal(spec.sources[0]?.id, 'nara-declaration-of-independence');
  assert.ok(!('text' in (spec.sources[0] as object)));
  assert.equal(spec.execution.generatedCodeAllowed, false);
  assert.ok(validFull(spec), JSON.stringify(validFull.errors));
});

test('full schema: month and day 0 mean "not stated"; a day needs a month', () => {
  const ok = assemble();
  ok.simulation.events[0]!.month = 0;
  ok.simulation.events[0]!.day = 0;
  assert.ok(validFull(ok), JSON.stringify(validFull.errors));
  const bad = assemble();
  bad.simulation.events[0]!.month = 0;
  bad.simulation.events[0]!.day = 10;
  assert.ok(!validFull(bad), 'day without month must be rejected');
});

test('full schema rejects year 0, non-integer years, out-of-range dates and event counts outside 5..10', () => {
  const cases: Array<[string, (s: ReturnType<typeof assemble>) => void]> = [
    ['year 0', s => { s.simulation.events[0]!.year = 0; }],
    ['fractional year', s => { s.simulation.events[0]!.year = 1776.5; }],
    ['year beyond 2100', s => { s.simulation.events[0]!.year = 2101; }],
    ['year before -3000', s => { s.simulation.events[0]!.year = -3001; }],
    ['month 13', s => { s.simulation.events[0]!.month = 13; }],
    ['day 32', s => { s.simulation.events[0]!.day = 32; }],
    ['4 events', s => { s.simulation.events = s.simulation.events.slice(0, 4); }],
    ['11 events', s => { s.simulation.events = [...s.simulation.events, ...s.simulation.events].slice(0, 11); }],
    ['no evidence', s => { s.simulation.events[0]!.evidence = []; }],
    ['3 quotes', s => { const q = s.simulation.events[0]!.evidence[0]!; s.simulation.events[0]!.evidence = [q, q, q]; }],
    ['long label', s => { s.simulation.events[0]!.label = 'x'.repeat(81); }],
    ['2 tests', s => { s.behavioralTests = s.behavioralTests.slice(0, 2); }],
    ['1 prediction', s => { s.predictions = s.predictions.slice(0, 1); }],
    ['equation smuggled in', s => { (s.simulation as unknown as Record<string, unknown>).equation = 'x'; }],
  ];
  for (const [label, mutate] of cases) {
    const s = assemble();
    mutate(s);
    assert.ok(!validFull(s), `${label} must be rejected`);
  }
});

test('BCE years are negative integers and accepted by the schema', () => {
  const s = assemble();
  s.simulation.events[0]!.year = -500;
  s.simulation.events[0]!.month = 0;
  s.simulation.events[0]!.day = 0;
  assert.ok(validFull(s), JSON.stringify(validFull.errors));
});
