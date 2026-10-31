import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import {
  ACTIVITY_IDS,
  repairProvenance,
  type Provenance,
  type SourceDocument
} from '../packages/contracts/index.ts';
import * as contracts from '../packages/contracts/index.ts';
import {
  kitGenSchemaFor,
  sourceAnalysisV2GenSchema,
  sourceAnalysisGenSchema,
  genSchemaFor,
  timelineGenSchema
} from '../packages/contracts/schemas.ts';
import {
  ANALYSIS_V2_REPAIRABLE_CHECK_IDS,
  BALANCE_SIDES,
  CHECK_PREFIX_BY_COMPONENT,
  CONCEPT_MAP_RELATIONS,
  DECLINE_CODES,
  FORMULA_RESERVED_NAMES,
  FORMULA_VAR_NAME_PATTERN,
  KIT_COMPONENT_IDS,
  KIT_DEFAULT_EXECUTION,
  KIT_GEN_BODY_KEYS,
  KIT_GEN_COMPONENT_IDS,
  KIT_GEN_SCHEMA_FILES,
  KIT_ID_PATTERN,
  KIT_LIMITS,
  KIT_SCHEMA_VERSION,
  PLAN_COMPONENT_IDS,
  RETIRED_STAGE6_CHECK_IDS,
  SEQUENCE_ORDER_BASES,
  STAGE6_CHECK_IDS,
  STAGE6_CHECKS,
  SUBJECTS,
  assembleKitSpec,
  assembleOverviewSpec,
  checkIdsFor,
  compareGridFromRows,
  isKitComponentId,
  isKitGenComponentId,
  isPlanComponentId,
  isSubject,
  kitSpecId,
  type KitGenByComponent,
  type KitGenComponentId,
  type SourceAnalysisV2
} from '../packages/contracts/kit.ts';
import { loadSource } from '../packages/sources/index.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/stage6/${name}`, import.meta.url), 'utf8'));
const rootFixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const synthText = (): string =>
  readFileSync(new URL('./fixtures/stage6/balance.synthetic-source.txt', import.meta.url), 'utf8');

const v2Usable = (): SourceAnalysisV2 => structuredClone(fixture('source-analysis-v2.usable.json')) as SourceAnalysisV2;
const v2Declined = (): SourceAnalysisV2 => structuredClone(fixture('source-analysis-v2.declined.json')) as SourceAnalysisV2;
const provenance = (): Provenance => structuredClone(rootFixture('provenance.fixture.json')) as Provenance;
const dragSource = (): SourceDocument => loadSource('nasa-grc-drag-equation');

function goldenGen<C extends KitGenComponentId>(c: C): KitGenByComponent[C] {
  return structuredClone(fixture(KIT_GEN_SCHEMA_FILES[c])) as KitGenByComponent[C];
}

const GOLDENS: Array<{ file: string; schema: Record<string, unknown> }> = [
  { file: 'source-analysis-v2.usable.json', schema: sourceAnalysisV2GenSchema as Record<string, unknown> },
  { file: 'quiz-cards.gen.json', schema: kitGenSchemaFor('quiz-cards-v1') },
  { file: 'sequence.gen.json', schema: kitGenSchemaFor('sequence-v1') },
  { file: 'sort-groups.gen.json', schema: kitGenSchemaFor('sort-groups-v1') },
  { file: 'concept-map.gen.json', schema: kitGenSchemaFor('concept-map-v1') },
  { file: 'compare-table.gen.json', schema: kitGenSchemaFor('compare-table-v1') },
  { file: 'formula-explorer.gen.json', schema: kitGenSchemaFor('formula-explorer-v1') },
  { file: 'balance-equation.gen.json', schema: kitGenSchemaFor('balance-equation-v1') }
];

interface QuoteEntry { quote: string; sourceId: string; path: string; }

function quoteEntries(value: unknown): QuoteEntry[] {
  const out: QuoteEntry[] = [];
  const walk = (v: unknown, inheritedId: string, path: string): void => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], inheritedId, path + '[' + String(i) + ']');
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      let current = inheritedId;
      if (typeof r['sourceId'] === 'string' && (r['sourceId'] as string) !== '') current = r['sourceId'] as string;
      else if (typeof r['focusSourceId'] === 'string' && (r['focusSourceId'] as string) !== '') current = r['focusSourceId'] as string;
      if (typeof r['quote'] === 'string') {
        out.push({ quote: r['quote'] as string, sourceId: current, path: path === '' ? 'quote' : path + '.quote' });
      }
      if (typeof r['focusQuote'] === 'string') {
        const fsid = typeof r['focusSourceId'] === 'string' ? (r['focusSourceId'] as string) : current;
        out.push({ quote: r['focusQuote'] as string, sourceId: fsid, path: path === '' ? 'focusQuote' : path + '.focusQuote' });
      }
      for (const k of Object.keys(r)) {
        if (k === 'quote' || k === 'focusQuote') continue;
        walk(r[k], current, path === '' ? k : path + '.' + k);
      }
    }
  };
  walk(value, '', '');
  return out;
}

function idEntries(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const e of v) walk(e);
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      for (const k of ['id', 'fromId', 'toId', 'groupId', 'xVariable']) {
        if (typeof r[k] === 'string' && (k === 'id' || k === 'fromId' || k === 'toId' || k === 'groupId')) out.push(r[k] as string);
      }
      for (const k of Object.keys(r)) walk(r[k]);
    }
  };
  walk(value);
  return out;
}

test('stage6 gen schemas accept goldens; declined passes v2; v1 and v2 reject each other', () => {
  for (const g of GOLDENS) {
    const v = ajv.compile(g.schema);
    assert.equal(v(fixture(g.file)), true, g.file + ' ' + JSON.stringify(v.errors));
  }
  const vV2 = ajv.compile(sourceAnalysisV2GenSchema as Record<string, unknown>);
  assert.equal(vV2(fixture('source-analysis-v2.declined.json')), true, JSON.stringify(vV2.errors));
  const vV1 = ajv.compile(sourceAnalysisGenSchema as Record<string, unknown>);
  assert.equal(vV1(fixture('source-analysis-v2.usable.json')), false, 'v1 must reject v2 golden');
  assert.equal(vV2(rootFixture('analysis.forces.json')), false, 'v2 must reject v1 analysis');
});

interface ArrayLoc { path: Array<string | number>; minItems?: number; maxItems?: number; }

function collectArrays(schema: unknown, path: Array<string | number>, out: ArrayLoc[]): void {
  if (typeof schema !== 'object' || schema === null) return;
  const s = schema as Record<string, unknown>;
  if (s['type'] === 'array') {
    const loc: ArrayLoc = { path: [...path] };
    if (typeof s['minItems'] === 'number') loc.minItems = s['minItems'] as number;
    if (typeof s['maxItems'] === 'number') loc.maxItems = s['maxItems'] as number;
    if (loc.minItems !== undefined || loc.maxItems !== undefined) out.push(loc);
    collectArrays(s['items'], [...path, 0], out);
    return;
  }
  const props = s['properties'] as Record<string, unknown> | undefined;
  if (typeof props === 'object' && props !== null) {
    for (const k of Object.keys(props)) collectArrays(props[k], [...path, k], out);
  }
  const items = s['items'] as unknown;
  if (items !== undefined && s['type'] !== 'array') collectArrays(items, path, out);
}

function getAt(root: unknown, path: Array<string | number>): unknown {
  let cur: unknown = root;
  for (const p of path) {
    if (typeof p === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[(p as number) % Math.max(cur.length, 1)];
    } else {
      if (typeof cur !== 'object' || cur === null) return undefined;
      cur = (cur as Record<string, unknown>)[p as string];
    }
  }
  return cur;
}

function pathLabel(path: Array<string | number>): string {
  if (path.length === 0) return '$';
  let s = '';
  for (const p of path) {
    if (typeof p === 'number') s += '[' + String(p) + ']';
    else s += (s === '' ? '' : '.') + p;
  }
  return s;
}

function cloneWithout(root: unknown, path: Array<string | number>, key: string): unknown {
  const c = structuredClone(root);
  const parent: unknown = path.length === 0 ? c : getAt(c, path);
  if (typeof parent === 'object' && parent !== null) delete (parent as Record<string, unknown>)[key];
  return c;
}

function cloneWithExtra(root: unknown, path: Array<string | number>): unknown {
  const c = structuredClone(root);
  const target: unknown = path.length === 0 ? c : getAt(c, path);
  if (typeof target === 'object' && target !== null) (target as Record<string, unknown>)['zzzExtra'] = 'x';
  return c;
}

function forEachObjectInstance(
  data: unknown,
  schema: unknown,
  path: Array<string | number>,
  cb: (node: unknown, sch: Record<string, unknown>, at: Array<string | number>) => void
): void {
  if (typeof schema !== 'object' || schema === null) return;
  const s = schema as Record<string, unknown>;
  if (s['type'] === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
    cb(data, s, path);
    const props = s['properties'] as Record<string, unknown>;
    const r = data as Record<string, unknown>;
    for (const k of Object.keys(props)) {
      if (k in r) forEachObjectInstance(r[k], props[k], [...path, k], cb);
    }
    return;
  }
  if (s['type'] === 'array') {
    if (!Array.isArray(data) || data.length === 0) return;
    forEachObjectInstance(data[0], s['items'], [...path, 0], cb);
  }
}

test('stage6 gen schemas reject missing keys, extra keys, and array bound violations', () => {
  const files: Array<{ file: string; schema: Record<string, unknown> }> = [
    { file: 'source-analysis-v2.usable.json', schema: sourceAnalysisV2GenSchema as Record<string, unknown> },
    { file: 'source-analysis-v2.declined.json', schema: sourceAnalysisV2GenSchema as Record<string, unknown> },
    ...GOLDENS.slice(1)
  ];
  for (const f of files) {
    const validate = ajv.compile(f.schema);
    const golden = (): unknown => structuredClone(fixture(f.file));
    const instances: Array<{ path: Array<string | number>; schema: Record<string, unknown> }> = [];
    forEachObjectInstance(golden(), f.schema, [], (node, sch, at) => {
      void node;
      instances.push({ path: [...at], schema: sch });
    });
    assert.ok(instances.length > 0, f.file + ' should have object instances');
    for (const inst of instances) {
      const required = (inst.schema['required'] as string[] | undefined) ?? [];
      for (const key of required) {
        const bad = cloneWithout(golden(), inst.path, key);
        assert.equal(validate(bad), false, f.file + ' missing ' + pathLabel([...inst.path, key]));
      }
      const badExtra = cloneWithExtra(golden(), inst.path);
      assert.equal(validate(badExtra), false, f.file + ' extra accepted at ' + pathLabel(inst.path));
    }
    const locs: ArrayLoc[] = [];
    collectArrays(f.schema, [], locs);
    assert.ok(locs.length > 0, f.file + ' should have bounded arrays');
    for (const loc of locs) {
      if (loc.maxItems !== undefined) {
        const bad = golden();
        const arrVal = getAt(bad, loc.path) as unknown[];
        assert.ok(Array.isArray(arrVal), f.file + ' path missing for max test');
        while (arrVal.length < (loc.maxItems as number) + 1) arrVal.push(structuredClone(arrVal[arrVal.length - 1] ?? arrVal[0]));
        assert.equal(validate(bad), false, f.file + ' maxItems+1 accepted at ' + JSON.stringify(loc.path));
      }
      if (loc.minItems !== undefined && (loc.minItems as number) > 0) {
        const bad = golden();
        const arrVal = getAt(bad, loc.path) as unknown[];
        assert.ok(Array.isArray(arrVal), f.file + ' path missing for min test');
        const cut = (arrVal as unknown[]).slice(0, (loc.minItems as number) - 1);
        const setAt = (root: unknown, path: Array<string | number>, value: unknown): void => {
          let cur = root as Record<string, unknown>;
          for (let i = 0; i < path.length - 1; i++) {
            const p = path[i] as string | number;
            cur = (typeof p === 'number' ? (cur as unknown as unknown[])[(p as number) % Math.max((cur as unknown as unknown[]).length, 1)] : cur[p as string]) as Record<string, unknown>;
          }
          const last = path[path.length - 1] as string;
          (cur as Record<string, unknown>)[last] = value;
        };
        if (loc.path.length === 1) {
          (bad as Record<string, unknown>)[loc.path[0] as string] = cut;
        } else {
          setAt(bad, loc.path, cut);
        }
        assert.equal(validate(bad), false, f.file + ' minItems-1 accepted at ' + JSON.stringify(loc.path));
      }
    }
  }
});

const ALLOWED = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'minItems', 'maxItems'];

function checkKeywords(node: unknown, file: string): void {
  if (typeof node !== 'object' || node === null) return;
  if (Array.isArray(node)) {
    for (const e of node) checkKeywords(e, file);
    return;
  }
  const r = node as Record<string, unknown>;
  const isSchema = typeof r['type'] === 'string' || r['properties'] !== undefined || r['items'] !== undefined || r['enum'] !== undefined;
  if (isSchema) {
    for (const k of Object.keys(r)) assert.ok(ALLOWED.includes(k), file + ' forbidden keyword ' + k);
    if (r['properties'] !== undefined) {
      assert.equal(r['additionalProperties'], false, file + ' object missing additionalProperties false');
      const req = [...((r['required'] as string[]) ?? [])].sort();
      const keys = [...Object.keys(r['properties'] as Record<string, unknown>)].sort();
      assert.deepEqual(req, keys, file + ' required must equal property keys');
      for (const k of Object.keys(r['properties'] as Record<string, unknown>)) {
        checkKeywords((r['properties'] as Record<string, unknown>)[k], file);
      }
    }
    if (r['items'] !== undefined) checkKeywords(r['items'], file);
  }
}

test('stage6 gen schemas stay in the constrained-decoding-safe subset', () => {
  const schemas: Array<{ file: string; schema: unknown }> = [
    { file: 'source-analysis-v2', schema: sourceAnalysisV2GenSchema },
    ...KIT_GEN_COMPONENT_IDS.map((c) => ({ file: c, schema: kitGenSchemaFor(c) }))
  ];
  for (const s of schemas) {
    const text = JSON.stringify(s.schema);
    for (const w of ['pattern', 'minLength', 'maxLength', 'minimum', 'maximum', 'const']) {
      assert.equal(text.includes('"' + w + '"'), false, s.file + ' uses ' + w);
    }
    checkKeywords(s.schema, s.file);
  }
});

test('stage6 schema numbers come from KIT_LIMITS and enums match constants', () => {
  const quiz = kitGenSchemaFor('quiz-cards-v1') as unknown as Record<string, Record<string, Record<string, number>>>;
  assert.equal((quiz['properties'] as unknown as Record<string, Record<string, number>>)['cards']['maxItems'], KIT_LIMITS.quiz.cards.max);
  const explorer = kitGenSchemaFor('formula-explorer-v1') as unknown as Record<string, Record<string, Record<string, number>>>;
  assert.equal((explorer['properties'] as unknown as Record<string, Record<string, number>>)['variables']['maxItems'], KIT_LIMITS.formulaExplorer.variables.max);
  const compare = kitGenSchemaFor('compare-table-v1') as unknown as Record<string, unknown>;
  const compareProps = compare['properties'] as Record<string, unknown>;
  const compareAttributes = compareProps['attributes'] as Record<string, number>;
  assert.equal(compareAttributes['minItems'], KIT_LIMITS.compare.attributes.min);
  assert.equal(compareAttributes['maxItems'], KIT_LIMITS.compare.attributes.max);
  const compareRows = compareProps['rows'] as Record<string, unknown>;
  assert.equal(compareRows['minItems'], KIT_LIMITS.compare.entities.min);
  assert.equal(compareRows['maxItems'], KIT_LIMITS.compare.entities.max);
  const compareRowItems = compareRows['items'] as Record<string, unknown>;
  const compareRowProps = compareRowItems['properties'] as Record<string, unknown>;
  const compareValues = compareRowProps['values'] as Record<string, number>;
  assert.equal(compareValues['minItems'], KIT_LIMITS.compare.attributes.min);
  assert.equal(compareValues['maxItems'], KIT_LIMITS.compare.attributes.max);
  assert.ok(!('cells' in compareProps), 'compare gen must not have cells');
  assert.ok(!('entities' in compareProps), 'compare gen must not have entities');
  const v2 = sourceAnalysisV2GenSchema as unknown as Record<string, Record<string, Record<string, unknown>>>;
  assert.equal(((v2['properties'] as unknown as Record<string, Record<string, number>>)['componentPlan'] as Record<string, number>)['maxItems'], KIT_LIMITS.analysis.componentPlan.max);
  const props = (sourceAnalysisV2GenSchema as unknown as Record<string, Record<string, Record<string, unknown>>>)['properties'] as unknown as Record<string, Record<string, unknown>>;
  assert.deepEqual((props['componentId'] !== undefined ? props['componentId'] : ((((props['componentPlan'] as unknown as Record<string, unknown>)['items'] as Record<string, unknown>)['properties'] as Record<string, unknown>)['componentId'] as Record<string, unknown>))['enum'], [...PLAN_COMPONENT_IDS]);
  assert.deepEqual((props['subject'] as Record<string, unknown>)['enum'], [...SUBJECTS]);
  assert.deepEqual((props['declineCode'] as Record<string, unknown>)['enum'], ['', ...DECLINE_CODES]);
  const cm = kitGenSchemaFor('concept-map-v1') as unknown as Record<string, Record<string, Record<string, Record<string, Record<string, unknown>>>>>;
  const linkItems = ((cm['properties'] as unknown as Record<string, Record<string, unknown>>)['links'] as Record<string, unknown>)['items'] as Record<string, unknown>;
  assert.deepEqual(((linkItems['properties'] as Record<string, unknown>)['relation'] as Record<string, unknown>)['enum'], [...CONCEPT_MAP_RELATIONS]);
  for (const c of KIT_GEN_COMPONENT_IDS) {
    const s = kitGenSchemaFor(c) as unknown as Record<string, Record<string, Record<string, unknown>>>;
    assert.deepEqual(((s['properties'] as unknown as Record<string, unknown>)['schemaVersion'] as Record<string, unknown>)['enum'], [c]);
  }
});

test('stage6 goldens quote real sources exactly; ids match; quiz answers check out', () => {
  const bySource: Record<string, string> = {
    'nasa-grc-drag-equation': loadSource('nasa-grc-drag-equation').text,
    'nara-constitution': loadSource('nara-constitution').text,
    'nij-heterozygosity': loadSource('nij-heterozygosity').text,
    'nasa-grc-earth-atmosphere-equation-english': loadSource('nasa-grc-earth-atmosphere-equation-english').text,
    'synthetic-balance': synthText()
  };
  const files = [
    'source-analysis-v2.usable.json',
    'quiz-cards.gen.json',
    'sequence.gen.json',
    'sort-groups.gen.json',
    'concept-map.gen.json',
    'compare-table.gen.json',
    'formula-explorer.gen.json',
    'balance-equation.gen.json'
  ];
  for (const f of files) {
    const golden = fixture(f) as Record<string, unknown>;
    for (const q of quoteEntries(golden)) {
      if (q.quote === '') {
        const isSourceExample = q.path === 'sourceExample.quote';
        assert.ok(isSourceExample, f + ' empty quote not allowed at ' + q.path);
        assert.equal(golden['hasSourceExample'], false, f + ' empty quote but hasSourceExample true at ' + q.path);
        continue;
      }
      assert.ok(q.quote.length <= 150, f + ' quote too long: ' + q.quote);
      const text = bySource[q.sourceId];
      assert.ok(text !== undefined, f + ' unknown source ' + q.sourceId);
      assert.ok(text.includes(q.quote), f + ' quote not exact substring: ' + q.quote);
    }
    for (const id of idEntries(golden)) {
      assert.ok(KIT_ID_PATTERN.test(id), f + ' bad id ' + id);
    }
  }
  const quiz = fixture('quiz-cards.gen.json') as unknown as { cards: Array<{ options: string[]; quote: string }> };
  for (const card of quiz.cards) {
    assert.ok(card.quote.includes(card.options[0] as string), 'options[0] must occur in quote');
    for (const d of card.options.slice(1)) assert.ok(!card.quote.includes(d), 'distractor occurs in quote: ' + d);
  }
});

test('compare golden uses rows shape with the same content in order', () => {
  const gen = goldenGen('compare-table-v1');
  assert.deepEqual(gen.attributes, ['temperature', 'pressure']);
  assert.equal(gen.rows.length, 2);
  assert.equal(gen.rows[0]?.entity, 'troposphere');
  assert.equal(gen.rows[1]?.entity, 'lower stratosphere');
  assert.equal(gen.rows[0]?.values.length, 2);
  assert.equal(gen.rows[1]?.values.length, 2);
  assert.equal(gen.rows[0]?.values[0]?.value, 'temperature decreases linearly');
  assert.equal(gen.rows[0]?.values[1]?.value, 'pressure decreases exponentially');
  assert.equal(gen.rows[1]?.values[0]?.value, 'temperature is constant');
  assert.equal(gen.rows[1]?.values[1]?.value, 'pressure decreases exponentially');
  for (const row of gen.rows) {
    for (const v of row.values) {
      assert.ok(v.value.length >= 1 && v.value.length <= 80, 'value length out of range: ' + v.value);
      assert.ok(v.quote.includes(v.value), 'value must occur in quote: ' + v.value);
    }
  }
});

test('assembleKitSpec sets system fields for all 7 components and enforces rules', () => {
  const sources = [dragSource()];
  const prov = provenance();
  const expectedSources = sources.map(({ text: _text, ...ref }) => ref);
  for (const c of KIT_GEN_COMPONENT_IDS) {
    const gen = goldenGen(c);
    const spec = assembleKitSpec(gen, c, { id: 'job-1:' + c + ':r1', sources, provenance: prov, seed: 7 }) as unknown as Record<string, unknown>;
    assert.equal(spec['schemaVersion'], KIT_SCHEMA_VERSION);
    assert.equal(spec['id'], 'job-1:' + c + ':r1');
    assert.equal(spec['componentId'], c);
    assert.equal(spec['seed'], 7);
    const exec = spec['execution'] as Record<string, unknown>;
    assert.equal(exec['network'], false);
    assert.equal(exec['generatedCodeAllowed'], false);
    assert.deepEqual(exec, { ...KIT_DEFAULT_EXECUTION });
    const withExec = assembleKitSpec(gen, c, {
      id: 'x', sources, provenance: prov, seed: 1, execution: { maxWallTimeMs: 500, maxRepairAttempts: 0, network: false, generatedCodeAllowed: false }
    }) as unknown as Record<string, unknown>;
    assert.equal((withExec['execution'] as Record<string, unknown>)['maxWallTimeMs'], 500);
    const sourcesOut = spec['sources'] as Array<Record<string, unknown>>;
    assert.ok(!('text' in (sourcesOut[0] as object)));
    const provOut = spec['provenance'] as Provenance;
    assert.equal(provOut.repairOf, null);
    const specBodyKeys: readonly string[] = c === 'compare-table-v1'
      ? ['entities', 'attributes', 'cells']
      : (KIT_GEN_BODY_KEYS[c] as readonly string[]);
    const expectedKeys = [...['schemaVersion', 'id', 'componentId', 'title', 'sources', 'execution', 'provenance', 'seed'], ...specBodyKeys].sort();
    assert.deepEqual(Object.keys(spec).sort(), expectedKeys);
    if (c === 'compare-table-v1') assert.ok(!('rows' in spec), 'compare spec must not have rows');
    const smuggled = structuredClone(gen) as unknown as Record<string, unknown>;
    smuggled['execution'] = 'x';
    smuggled['provenance'] = 'x';
    smuggled['sources'] = 'x';
    smuggled['code'] = 'x';
    smuggled['componentId'] = 'quiz-cards-v1';
    smuggled['seed'] = 999;
    const clean = assembleKitSpec(smuggled as unknown as typeof gen, c, { id: 's', sources, provenance: prov, seed: 2 }) as unknown as Record<string, unknown>;
    assert.deepEqual(clean['execution'], KIT_DEFAULT_EXECUTION);
    assert.deepEqual(clean['provenance'], prov);
    assert.deepEqual(clean['sources'], expectedSources);
    assert.ok(!('code' in clean));
    assert.equal(clean['componentId'], c);
    assert.equal(clean['seed'], 2);
    const snap = JSON.stringify(spec);
    const mutable = gen as unknown as Record<string, unknown>;
    mutable['title'] = 'mutated-title-should-not-appear';
    for (const key of (KIT_GEN_BODY_KEYS[c] as readonly string[])) {
      const v: unknown = mutable[key];
      if (Array.isArray(v)) {
        if (v.length > 0) {
          const first: unknown = v[0];
          if (typeof first === 'object' && first !== null) {
            const fr = first as Record<string, unknown>;
            for (const fk of Object.keys(fr)) {
              const fv: unknown = fr[fk];
              if (typeof fv === 'string') fr[fk] = 'mutated-should-not-appear';
              else if (typeof fv === 'number') fr[fk] = 999999;
              else if (typeof fv === 'boolean') fr[fk] = !(fv as boolean);
            }
            (v as unknown[]).push(structuredClone(first));
          } else if (typeof first === 'string') {
            (v as unknown[])[0] = 'mutated-should-not-appear';
            (v as unknown[]).push('mutated-extra');
          } else if (typeof first === 'number') {
            (v as unknown[])[0] = 999999;
            (v as unknown[]).push(1);
          }
        } else {
          (v as unknown[]).push('mutated-extra');
        }
      } else if (typeof v === 'object' && v !== null) {
        const o = v as Record<string, unknown>;
        for (const fk of Object.keys(o)) {
          if (typeof o[fk] === 'string') o[fk] = 'mutated-should-not-appear';
        }
        o['zzzMutated'] = 'x';
      } else if (typeof v === 'string') {
        mutable[key] = 'mutated-should-not-appear';
      } else if (typeof v === 'boolean') {
        mutable[key] = !(v as boolean);
      }
    }
    assert.equal(JSON.stringify(spec), snap);
    assert.equal(JSON.stringify(spec).includes(sources[0]?.text ?? 'no-such-marker-xyz'), false);
    for (const badSeed of [-1, 1.5, NaN]) {
      assert.throws(() => assembleKitSpec(gen, c, { id: 's', sources, provenance: prov, seed: badSeed }), /KIT_SEED_INVALID/);
    }
    const other = (c === 'quiz-cards-v1' ? 'sequence-v1' : 'quiz-cards-v1') as KitGenComponentId;
    assert.throws(
      () => assembleKitSpec(gen, other as typeof c, { id: 's', sources, provenance: prov, seed: 1 }),
      /KIT_COMPONENT_MISMATCH/
    );
  }
  const quizGen = goldenGen('quiz-cards-v1');
  const { revision: _r, repairOf: _ro, ...base } = prov;
  void _r;
  void _ro;
  const rep2 = repairProvenance(base, 1);
  assert.equal(rep2.revision, 2);
  assert.equal(rep2.repairOf, 1);
  const spec2 = assembleKitSpec(quizGen, 'quiz-cards-v1', { id: 'job-1:quiz-cards-v1:r2', sources, provenance: rep2, seed: 1 }) as unknown as Record<string, unknown>;
  assert.equal((spec2['provenance'] as Provenance).revision, 2);
  assert.equal((spec2['provenance'] as Provenance).repairOf, 1);
});

test('compareGridFromRows builds ids, indexes and row-major order', () => {
  const gen = goldenGen('compare-table-v1');
  const grid = compareGridFromRows(gen);
  assert.deepEqual(grid.entities, gen.rows.map((r) => r.entity));
  assert.equal(grid.cells.length, gen.rows.length * gen.attributes.length);
  let k = 0;
  for (let i = 0; i < gen.rows.length; i++) {
    for (let j = 0; j < gen.attributes.length; j++) {
      const cell = grid.cells[k] as { id: string; entityIndex: number; attributeIndex: number; value: string; sourceId: string; quote: string };
      assert.equal(cell.id, 'cell-' + String(i) + '-' + String(j));
      assert.equal(cell.entityIndex, i);
      assert.equal(cell.attributeIndex, j);
      assert.equal(cell.value, gen.rows[i]?.values[j]?.value);
      assert.equal(cell.sourceId, gen.rows[i]?.values[j]?.sourceId);
      assert.equal(cell.quote, gen.rows[i]?.values[j]?.quote);
      k++;
    }
  }
});

test('compareGridFromRows does not pad a short row and does not mutate input', () => {
  const gen = goldenGen('compare-table-v1');
  const short = structuredClone(gen);
  short.rows[1]?.values.pop();
  assert.equal(short.rows[1]?.values.length, short.attributes.length - 1);
  const before = JSON.stringify(short);
  const grid = compareGridFromRows(short);
  assert.equal(grid.cells.length, (short.rows[0]?.values.length ?? 0) + (short.rows[1]?.values.length ?? 0));
  assert.ok(!grid.cells.some((c) => c.entityIndex === 1 && c.attributeIndex === 1), 'short row must not be padded');
  assert.ok(grid.cells.some((c) => c.entityIndex === 0 && c.attributeIndex === 1), 'full row keeps its cells');
  assert.equal(JSON.stringify(short), before);
  assert.deepEqual(grid.entities, short.rows.map((r) => r.entity));
});

test('assembleKitSpec compare-table-v1 builds entities, attributes and cells with no rows key', () => {
  const sources = [dragSource()];
  const prov = provenance();
  const gen = goldenGen('compare-table-v1');
  const genSnap = JSON.stringify(gen);
  const spec = assembleKitSpec(gen, 'compare-table-v1', { id: 'job-1:compare-table-v1:r1', sources, provenance: prov, seed: 3 }) as unknown as Record<string, unknown>;
  const grid = compareGridFromRows(structuredClone(gen));
  assert.deepEqual(spec['entities'], gen.rows.map((r) => r.entity));
  assert.deepEqual(spec['attributes'], gen.attributes);
  assert.deepEqual(spec['cells'], grid.cells);
  assert.ok(!('rows' in spec), 'compare spec must not have rows');
  assert.deepEqual(Object.keys(spec).sort(), ['schemaVersion', 'id', 'componentId', 'title', 'sources', 'execution', 'provenance', 'seed', 'entities', 'attributes', 'cells'].sort());
  assert.equal(JSON.stringify(gen), genSnap);
  (gen.attributes as string[])[0] = 'mutated-should-not-appear';
  const firstRow = gen.rows[0] as unknown as Record<string, unknown>;
  firstRow['entity'] = 'mutated-should-not-appear';
  assert.notDeepEqual(spec['attributes'], gen.attributes);
  assert.notDeepEqual(spec['entities'], gen.rows.map((r) => r.entity));
});

test('assemble copies system objects instead of aliasing; default execution is frozen', () => {
  assert.equal(Object.isFrozen(KIT_DEFAULT_EXECUTION), true);
  const sources = [dragSource()];
  const prov = provenance();
  const provRunId = prov.runId;
  const genA = goldenGen('quiz-cards-v1');
  const specA = assembleKitSpec(genA, 'quiz-cards-v1', { id: 'a', sources, provenance: prov, seed: 1 });
  const specB = assembleKitSpec(goldenGen('quiz-cards-v1'), 'quiz-cards-v1', { id: 'b', sources, provenance: prov, seed: 1 });
  const defaultMs = (KIT_DEFAULT_EXECUTION as { maxWallTimeMs: number }).maxWallTimeMs;
  (specA.execution as unknown as Record<string, unknown>)['maxWallTimeMs'] = 999999;
  assert.equal((KIT_DEFAULT_EXECUTION as { maxWallTimeMs: number }).maxWallTimeMs, defaultMs);
  assert.notEqual((specB.execution as { maxWallTimeMs: number }).maxWallTimeMs, 999999);
  (specA.provenance as unknown as Record<string, unknown>)['runId'] = 'mutated-run-id';
  assert.equal(prov.runId, provRunId);
});

test('assembleOverviewSpec copies the usable golden and declines the declined one; kitSpecId formats', () => {
  const sources = [dragSource()];
  const prov = provenance();
  const spec = assembleOverviewSpec(v2Usable(), { id: 'job-1:overview-v1:r1', sources, provenance: prov, seed: 0 });
  assert.equal(spec.componentId, 'overview-v1');
  assert.equal(spec.title, v2Usable().overview.headline);
  assert.deepEqual(spec.keyPoints, v2Usable().overview.keyPoints);
  assert.deepEqual(spec.keyTerms, v2Usable().overview.keyTerms);
  const analysis = v2Usable();
  const snapSpec = assembleOverviewSpec(analysis, { id: 'job-1:overview-v1:r1', sources, provenance: prov, seed: 0 });
  const snap = JSON.stringify(snapSpec);
  analysis.overview.keyPoints[0].point = 'mutated-should-not-appear';
  analysis.overview.keyTerms.push(structuredClone(analysis.overview.keyTerms[0] as object) as never);
  analysis.overview.headline = 'mutated-should-not-appear';
  assert.equal(JSON.stringify(snapSpec), snap);
  assert.throws(() => assembleOverviewSpec(v2Declined(), { id: 'x', sources, provenance: prov, seed: 0 }), /OVERVIEW_DECLINED/);
  assert.equal(kitSpecId('job-1', 'quiz-cards-v1', 2), 'job-1:quiz-cards-v1:r2');
});

test('stage6 constants are consistent and check ids are complete', () => {
  for (const arr of [KIT_COMPONENT_IDS, KIT_GEN_COMPONENT_IDS, PLAN_COMPONENT_IDS, SUBJECTS, DECLINE_CODES, STAGE6_CHECK_IDS]) {
    assert.equal(new Set(arr as readonly unknown[]).size, (arr as readonly unknown[]).length, 'duplicates found');
  }
  assert.deepEqual([...PLAN_COMPONENT_IDS], [...KIT_GEN_COMPONENT_IDS, ...ACTIVITY_IDS]);
  assert.equal(PLAN_COMPONENT_IDS.length, 20);
  assert.ok(!(PLAN_COMPONENT_IDS as readonly string[]).includes('overview-v1'));
  for (const id of KIT_COMPONENT_IDS) assert.ok(!(ACTIVITY_IDS as readonly string[]).includes(id as string));
  assert.equal(STAGE6_CHECK_IDS.length, 101); // SEQ-02 retired in Stage 7e (removed, never reused); +29 Stage 8a; +9 Stage 8b
  const counts: Record<string, number> = {};
  for (const id of STAGE6_CHECK_IDS) {
    assert.ok(/^(A|OV|Q|SEQ|SORT|CM|CT|FE|BAL|ALG|LOG|TH|DT|LD)-\d{2}$/.test(id), 'bad id ' + id);
    const prefix = id.slice(0, id.lastIndexOf('-'));
    counts[prefix] = (counts[prefix] ?? 0) + 1;
  }
  assert.deepEqual(counts, { A: 11, OV: 6, Q: 7, SEQ: 5, SORT: 6, CM: 6, CT: 5, FE: 8, BAL: 9, ALG: 7, LOG: 7, TH: 7, DT: 8, LD: 9 });
  for (const prefix of Object.keys(counts)) {
    const nums = STAGE6_CHECK_IDS.filter((id) => id.slice(0, id.lastIndexOf('-')) === prefix).map((id) => Number(id.slice(id.lastIndexOf('-') + 1)));
    // Ids are numbered 1..n except removed ids, which leave a permanent gap.
    const removed: Record<string, number[]> = { SEQ: [2] };
    const expected = Array.from({ length: nums.length + (removed[prefix]?.length ?? 0) }, (_, i) => i + 1).filter((n) => !(removed[prefix] ?? []).includes(n));
    assert.deepEqual(nums, expected);
  }
  assert.ok((STAGE6_CHECK_IDS as readonly string[]).includes('BAL-09'));
  for (const id of RETIRED_STAGE6_CHECK_IDS) assert.ok((STAGE6_CHECK_IDS as readonly string[]).includes(id as string));
  for (const id of ANALYSIS_V2_REPAIRABLE_CHECK_IDS) assert.ok((id as string).startsWith('A-'));
  assert.deepEqual(checkIdsFor('quiz-cards-v1'), STAGE6_CHECK_IDS.filter((id) => id.startsWith('Q-')));
  assert.equal(checkIdsFor('quiz-cards-v1').length, 7);
  assert.ok(FORMULA_RESERVED_NAMES.every((n) => FORMULA_VAR_NAME_PATTERN.test(n as string)));
  assert.ok(isSubject('physics') && !isSubject('nope'));
  assert.ok(isKitComponentId('overview-v1') && !isKitComponentId('x'));
  assert.ok(isKitGenComponentId('quiz-cards-v1') && !isKitGenComponentId('overview-v1'));
  assert.ok(isPlanComponentId('timeline-v1') && !isPlanComponentId('overview-v1'));
  void BALANCE_SIDES;
  void SEQUENCE_ORDER_BASES;
  void CHECK_PREFIX_BY_COMPONENT;
  const files = Object.values(KIT_GEN_SCHEMA_FILES as Record<string, string>);
  assert.equal(new Set(files).size, files.length);
  const v1Files = ['activity-spec.gen.json', 'activity-spec.full.json', 'source-analysis.gen.json', 'activity-spec.gen.timeline-v1.json', 'activity-spec.full.timeline-v1.json'];
  for (const f of files) assert.ok(!v1Files.includes(f) && !f.startsWith('activity-spec.'), 'kit file collides with v1: ' + f);
  assert.equal(Object.keys(STAGE6_CHECKS).length, 101);
  assert.ok(!(STAGE6_CHECK_IDS as readonly string[]).includes('SEQ-02'));
});

test('v1 contracts are unchanged and kit re-exports are visible', () => {
  assert.deepEqual((sourceAnalysisGenSchema as unknown as Record<string, unknown>)['required'], ['supported', 'activity', 'unsupportedReason', 'concepts', 'objectives']);
  assert.ok(typeof genSchemaFor === 'function' && typeof timelineGenSchema === 'object');
  assert.equal((contracts as unknown as Record<string, unknown>)['SCHEMA_VERSION'], '0.3.0');
  assert.equal(typeof (contracts as unknown as Record<string, unknown>)['assembleSpec'], 'function');
  assert.equal((contracts as unknown as Record<string, unknown>)['KIT_SCHEMA_VERSION'], '0.6.0');
});
