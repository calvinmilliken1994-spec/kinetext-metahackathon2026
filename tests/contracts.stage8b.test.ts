import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { Provenance, SourceDocument } from '../packages/contracts/index.ts';
import { kitGenSchemaFor } from '../packages/contracts/schemas.ts';
import {
  CHECK_PREFIX_BY_COMPONENT,
  KIT_GEN_BODY_KEYS,
  KIT_GEN_SCHEMA_FILES,
  KIT_LIMITS,
  KIT_SCHEMA_VERSION,
  STAGE6_CHECKS,
  assembleKitSpec,
  attachLabelRegions,
  checkIdsFor,
  type LabelDiagramGen,
  type LabelFigureRef,
  type LabelRegion
} from '../packages/contracts/kit.ts';
import { loadSource } from '../packages/sources/index.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/stage6/${name}`, import.meta.url), 'utf8'));

function golden(): LabelDiagramGen {
  return structuredClone(fixture('label-diagram.gen.json')) as LabelDiagramGen;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWholePhrase(haystack: string, needle: string): boolean {
  const re = new RegExp('(?:^|[^a-z0-9])' + escapeRegExp(needle) + '(?:[^a-z0-9]|$)', 'i');
  return re.test(haystack);
}

test('label-diagram golden validates against its gen schema', () => {
  const schema = kitGenSchemaFor('label-diagram-v1') as unknown as Record<string, unknown>;
  const v = ajv.compile(schema);
  const gen = golden();
  assert.equal(v(gen), true, JSON.stringify(v.errors));
});

test('label-diagram golden quotes are exact spans of at most 150 characters', () => {
  const text = loadSource('medlineplus-what-is-dna').text;
  const gen = golden();
  assert.ok(gen.parts.length > 0);
  for (const p of gen.parts) {
    assert.ok(p.quote.length >= 1 && p.quote.length <= 150, 'quote length: ' + p.quote);
    assert.equal(p.sourceId, 'medlineplus-what-is-dna');
    assert.ok(text.includes(p.quote), 'quote not an exact span: ' + p.quote);
  }
});

test('label-diagram golden content matches the task contract', () => {
  const gen = golden();
  assert.equal(gen.schemaVersion, 'label-diagram-v1');
  assert.equal(gen.figureId, 'medlineplus-dna-structure-1');
  assert.equal(gen.parts.length, 6);
  assert.deepEqual(gen.parts.map((p) => p.name), [
    'base pairs',
    'adenine',
    'thymine',
    'guanine',
    'cytosine',
    'sugar-phosphate backbone'
  ]);
  assert.deepEqual(gen.parts.map((p) => [p.x, p.y]), [
    [283, 475],
    [650, 317],
    [800, 317],
    [658, 478],
    [800, 478],
    [358, 683]
  ]);
  assert.deepEqual(gen.parts.map((p) => [p.labelX1, p.labelY1, p.labelX2, p.labelY2]), [
    [397, 303, 542, 330],
    [595, 353, 707, 380],
    [762, 353, 873, 380],
    [595, 510, 707, 537],
    [762, 510, 880, 537],
    [508, 672, 745, 733]
  ]);
  for (const p of gen.parts) {
    assert.ok(Number.isInteger(p.x) && Number.isInteger(p.y));
    assert.ok(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000);
    assert.ok(p.name.length >= 1 && p.name.length <= 40);
    assert.ok(isWholePhrase(p.quote, p.name), p.name + ' not a whole phrase of: ' + p.quote);
  }
  assert.equal(KIT_GEN_SCHEMA_FILES['label-diagram-v1'], 'label-diagram.gen.json');
  assert.deepEqual(KIT_GEN_BODY_KEYS['label-diagram-v1'], ['figureId', 'parts', 'hint']);
  assert.equal(KIT_LIMITS.labelDiagram.parts.min, 3);
  assert.equal(KIT_LIMITS.labelDiagram.parts.max, 8);
  assert.equal(KIT_LIMITS.labelDiagram.name.min, 1);
  assert.equal(KIT_LIMITS.labelDiagram.name.max, 40);
  assert.equal(KIT_LIMITS.labelDiagram.coordMax, 1000);
  assert.equal(KIT_LIMITS.labelDiagram.maxRegionAreaFraction, 0.5);
  assert.equal(KIT_LIMITS.labelDiagram.minRegionAreaFraction, 0.0005);
  assert.equal(KIT_LIMITS.labelDiagram.maxRegionOverlapIoU, 0.6);
});

test('assembleKitSpec plus attachLabelRegions produce the spec without mutating inputs', () => {
  const sources: SourceDocument[] = [loadSource('medlineplus-what-is-dna')];
  const provenance = (): Provenance => JSON.parse(readFileSync(new URL('./fixtures/provenance.fixture.json', import.meta.url), 'utf8')) as Provenance;
  const gen = golden();
  const genSnap = JSON.stringify(gen);
  const figure: LabelFigureRef = {
    id: 'medlineplus-dna-structure-1',
    width: 600,
    height: 600,
    caption: 'DNA is a double helix formed by base pairs attached to a sugar-phosphate backbone.',
    credit: 'Credit: U.S. National Library of Medicine',
    license: 'U.S. Government work (U.S. National Library of Medicine), public domain',
    labelsInImage: true
  };
  const regions: LabelRegion[] = gen.parts.map((p, i) => ({
    partId: p.id,
    x1: 10 + i * 30,
    y1: 10,
    x2: 20 + i * 30,
    y2: 20,
    confidence: null
  }));
  const figureSnap = JSON.stringify(figure);
  const regionsSnap = JSON.stringify(regions);
  const base = assembleKitSpec(gen, 'label-diagram-v1', {
    id: 'job-8b:label-diagram-v1:r1',
    sources,
    provenance: provenance(),
    seed: 7
  });
  assert.equal(base.schemaVersion, KIT_SCHEMA_VERSION);
  assert.equal(base.componentId, 'label-diagram-v1');
  assert.equal(base.figureId, gen.figureId);
  assert.deepEqual(base.parts, gen.parts);
  assert.equal(base.hint, gen.hint);
  const spec = attachLabelRegions(base, figure, regions);
  assert.equal(spec.componentId, 'label-diagram-v1');
  assert.deepEqual(spec.figure, figure);
  assert.deepEqual(spec.regions, regions);
  assert.deepEqual(spec.parts, gen.parts);
  assert.equal(JSON.stringify(gen), genSnap, 'gen must not be mutated');
  assert.equal(JSON.stringify(figure), figureSnap, 'figure must not be mutated');
  assert.equal(JSON.stringify(regions), regionsSnap, 'regions must not be mutated');
  const specSnap = JSON.stringify(spec);
  (figure as unknown as Record<string, unknown>)['caption'] = 'mutated-should-not-appear';
  (regions[0] as unknown as Record<string, unknown>)['x1'] = -999;
  assert.equal(JSON.stringify(spec), specSnap, 'spec must deep-copy figure and regions');
});

test('checkIdsFor returns 9 LD ids and the check names match the spec', () => {
  assert.deepEqual(checkIdsFor('label-diagram-v1'), [
    'LD-01', 'LD-02', 'LD-03', 'LD-04', 'LD-05', 'LD-06', 'LD-07', 'LD-08', 'LD-09'
  ]);
  assert.ok(checkIdsFor('label-diagram-v1').every((id) => id.startsWith('LD-')));
  assert.equal(CHECK_PREFIX_BY_COMPONENT['label-diagram-v1'], 'LD');
  assert.deepEqual([
    STAGE6_CHECKS['LD-01'], STAGE6_CHECKS['LD-02'], STAGE6_CHECKS['LD-03'],
    STAGE6_CHECKS['LD-04'], STAGE6_CHECKS['LD-05'], STAGE6_CHECKS['LD-06'],
    STAGE6_CHECKS['LD-07'], STAGE6_CHECKS['LD-08'], STAGE6_CHECKS['LD-09']
  ], [
    'quotes-verbatim', 'name-in-quote', 'figure-valid',
    'points-valid', 'label-boxes-valid', 'regions-found',
    'regions-distinct', 'numbers-checkable', 'counts-valid'
  ]);
  assert.equal(Object.keys(STAGE6_CHECKS).length, 101);
});

test('label-diagram gen schema rejects 2 parts and a missing key', () => {
  const schema = kitGenSchemaFor('label-diagram-v1') as unknown as Record<string, unknown>;
  const v = ajv.compile(schema);
  const good = golden();
  const tooFew = structuredClone(good);
  tooFew.parts = tooFew.parts.slice(0, 2);
  assert.equal(v(tooFew), false, '2 parts must be rejected (min 3)');
  const missing = structuredClone(good) as unknown as Record<string, unknown>;
  delete missing['hint'];
  assert.equal(v(missing), false, 'missing hint must be rejected');
});
