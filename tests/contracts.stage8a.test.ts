import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { Provenance, SourceDocument } from '../packages/contracts/index.ts';
import { kitGenSchemaFor } from '../packages/contracts/schemas.ts';
import {
  ALGORITHM_CLAIM_KINDS,
  ALGORITHM_IDS,
  CHECK_PREFIX_BY_COMPONENT,
  DATA_TABLE_QUESTION_KINDS,
  KIT_GEN_BODY_KEYS,
  KIT_LIMITS,
  KIT_SCHEMA_VERSION,
  SEARCH_ALGORITHM_IDS,
  STAGE6_CHECKS,
  THRESHOLD_RULES,
  assembleKitSpec,
  checkIdsFor,
  isAlgorithmClaimKind,
  isAlgorithmId,
  isDataTableQuestionKind,
  isSearchAlgorithmId,
  isThresholdRule,
  type KitGenByComponent,
  type KitGenComponentId
} from '../packages/contracts/kit.ts';
import { loadSource } from '../packages/sources/index.ts';

const ajv = new Ajv({ allErrors: true, strict: false });
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./fixtures/stage6/${name}`, import.meta.url), 'utf8'));

function goldenGen<C extends KitGenComponentId>(c: C): KitGenByComponent[C] {
  return structuredClone(fixture(`${c === 'algorithm-trace-v1' ? 'algorithm-trace' : c === 'log-ladder-v1' ? 'log-ladder' : c === 'threshold-v1' ? 'threshold' : 'data-table'}.gen.json`)) as KitGenByComponent[C];
}

function quoteEntries(value: unknown): Array<{ quote: string; sourceId: string; path: string }> {
  const out: Array<{ quote: string; sourceId: string; path: string }> = [];
  const walk = (v: unknown, inheritedId: string, path: string): void => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) walk(v[i], inheritedId, path + '[' + String(i) + ']');
      return;
    }
    if (typeof v === 'object' && v !== null) {
      const r = v as Record<string, unknown>;
      let current = inheritedId;
      if (typeof r['sourceId'] === 'string' && (r['sourceId'] as string) !== '') current = r['sourceId'] as string;
      if (typeof r['quote'] === 'string') out.push({ quote: r['quote'] as string, sourceId: current, path: path === '' ? 'quote' : path + '.quote' });
      if (typeof r['totalQuote'] === 'string') out.push({ quote: r['totalQuote'] as string, sourceId: current, path: path === '' ? 'totalQuote' : path + '.totalQuote' });
      for (const k of Object.keys(r)) {
        if (k === 'quote' || k === 'totalQuote') continue;
        walk(r[k], current, path === '' ? k : path + '.' + k);
      }
    }
  };
  walk(value, '', '');
  return out;
}

test('stage8a goldens validate against their gen schemas', () => {
  const ids: KitGenComponentId[] = ['algorithm-trace-v1', 'log-ladder-v1', 'threshold-v1', 'data-table-v1'];
  for (const c of ids) {
    const schema = kitGenSchemaFor(c) as unknown as Record<string, unknown>;
    const v = ajv.compile(schema);
    const gen = goldenGen(c);
    assert.equal(v(gen), true, c + ' ' + JSON.stringify(v.errors));
  }
});

test('stage8a golden quotes are exact contiguous spans of at most 150 characters', () => {
  const specs: Array<{ component: KitGenComponentId; sourceId: string }> = [
    { component: 'algorithm-trace-v1', sourceId: 'nist-dads-binary-search' },
    { component: 'log-ladder-v1', sourceId: 'usgs-earthquake-magnitude-energy-intensity' },
    { component: 'threshold-v1', sourceId: 'nara-constitutional-amendment-process' },
    { component: 'data-table-v1', sourceId: 'nasa-nssdc-planetary-fact-sheet-metric' }
  ];
  for (const s of specs) {
    const text = loadSource(s.sourceId).text;
    const gen = goldenGen(s.component) as unknown as Record<string, unknown>;
    const entries = quoteEntries(gen);
    assert.ok(entries.length > 0, s.component + ' has no quotes');
    for (const q of entries) {
      assert.ok(q.quote.length >= 1 && q.quote.length <= 150, s.component + ' quote length: ' + q.quote);
      assert.ok(text.includes(q.quote), s.component + ' quote not an exact span at ' + q.path + ': ' + q.quote);
    }
  }
});

test('stage8a golden content matches the task contract', () => {
  const alg = goldenGen('algorithm-trace-v1');
  assert.equal(alg.algorithm, 'binary-search');
  assert.equal(alg.algorithmName, 'binary search');
  assert.ok((alg.quote as string).includes(alg.algorithmName as string));
  assert.equal(alg.input.length, 7);
  assert.equal(alg.hasTarget, true);
  assert.ok((alg.input as number[]).includes(alg.target as number));
  assert.equal(alg.claims.length, 1);
  assert.equal(alg.claims[0]?.kind, 'running-time');
  assert.equal(alg.claims[0]?.text, 'Run time is O(ln n).');
  assert.ok((alg.claims[0]?.quote as string).includes(alg.claims[0]?.text as string));

  const ladder = goldenGen('log-ladder-v1');
  assert.equal(ladder.quantity, 'magnitude');
  assert.equal(ladder.factor, 10);
  assert.equal(ladder.factorText, 'tenfold');
  assert.equal(ladder.increasing, true);
  assert.ok((ladder.quote as string).includes('tenfold'));
  assert.ok((ladder.quote as string).includes('magnitude'));
  assert.equal(ladder.rungs.length, 2);
  assert.deepEqual(ladder.rungs.map((r) => r.value), [5.3, 6.3]);
  assert.equal(ladder.cases.length, 1);
  assert.deepEqual([ladder.cases[0]?.fromValue, ladder.cases[0]?.toValue], [5.3, 6.3]);

  const th = goldenGen('threshold-v1');
  assert.equal(th.stages.length, 1);
  assert.equal(th.stages[0]?.body, 'States');
  assert.equal(th.stages[0]?.total, 50);
  assert.equal(th.stages[0]?.rule, 'fraction');
  assert.deepEqual([th.stages[0]?.numerator, th.stages[0]?.denominator], [3, 4]);
  assert.equal(th.stages[0]?.statedCount, 38);
  assert.ok((th.stages[0]?.quote as string).includes('three-fourths'));
  assert.ok((th.stages[0]?.quote as string).includes('38 of 50'));
  assert.equal(th.scenarios.length, 1);
  assert.equal(th.scenarios[0]?.yes.length, 1);

  const dt = goldenGen('data-table-v1');
  assert.equal(dt.labelHeader, 'Planet');
  assert.equal(dt.columns.length, 2);
  assert.equal(dt.rows.length, 4);
  assert.deepEqual(dt.rows.map((r) => r.label), ['MERCURY', 'VENUS', 'EARTH', 'MARS']);
  assert.equal(dt.questions.length, 2);
  assert.deepEqual(dt.questions.map((q) => q.kind), ['lookup', 'largest']);
  assert.equal(dt.chartColumnIndex, 1);
  assert.deepEqual(dt.brackets, { enabled: false, rateColumnIndex: -1, overColumnIndex: -1, exampleIncome: 0 });
});

test('assembleKitSpec copies the four new bodies with system fields', () => {
  const sources: SourceDocument[] = [loadSource('nara-constitution')];
  const provenance = (): Provenance => JSON.parse(readFileSync(new URL('./fixtures/provenance.fixture.json', import.meta.url), 'utf8')) as Provenance;
  const ids: KitGenComponentId[] = ['algorithm-trace-v1', 'log-ladder-v1', 'threshold-v1', 'data-table-v1'];
  for (const c of ids) {
    const gen = goldenGen(c);
    const spec = assembleKitSpec(gen, c, { id: 'job-8a:' + c + ':r1', sources, provenance: provenance(), seed: 5 }) as unknown as Record<string, unknown>;
    assert.equal(spec['schemaVersion'], KIT_SCHEMA_VERSION);
    assert.equal(spec['componentId'], c);
    assert.equal(spec['seed'], 5);
    for (const key of KIT_GEN_BODY_KEYS[c] as readonly string[]) {
      assert.deepEqual(spec[key], (gen as unknown as Record<string, unknown>)[key], c + ' body key ' + key);
    }
    const snap = JSON.stringify(spec);
    (gen as unknown as Record<string, unknown>)['title'] = 'mutated-should-not-appear';
    assert.equal(JSON.stringify(spec), snap, c + ' must deep-copy the body');
  }
});

test('checkIdsFor returns 7/7/7/8 ids and prefixes map the new components', () => {
  assert.deepEqual(checkIdsFor('algorithm-trace-v1').length, 7);
  assert.deepEqual(checkIdsFor('log-ladder-v1').length, 7);
  assert.deepEqual(checkIdsFor('threshold-v1').length, 7);
  assert.deepEqual(checkIdsFor('data-table-v1').length, 8);
  assert.ok(checkIdsFor('algorithm-trace-v1').every((id) => id.startsWith('ALG-')));
  assert.ok(checkIdsFor('log-ladder-v1').every((id) => id.startsWith('LOG-')));
  assert.ok(checkIdsFor('threshold-v1').every((id) => id.startsWith('TH-')));
  assert.ok(checkIdsFor('data-table-v1').every((id) => id.startsWith('DT-')));
  assert.equal(CHECK_PREFIX_BY_COMPONENT['algorithm-trace-v1'], 'ALG');
  assert.equal(CHECK_PREFIX_BY_COMPONENT['log-ladder-v1'], 'LOG');
  assert.equal(CHECK_PREFIX_BY_COMPONENT['threshold-v1'], 'TH');
  assert.equal(CHECK_PREFIX_BY_COMPONENT['data-table-v1'], 'DT');
  assert.equal(Object.keys(STAGE6_CHECKS).length, 103); // 92 + 9 LD checks (Stage 8b) + 2 (Stage 8c)
});

test('new constants and guards behave', () => {
  assert.equal(ALGORITHM_IDS.length, 7);
  assert.ok((SEARCH_ALGORITHM_IDS as readonly string[]).every((id) => (ALGORITHM_IDS as readonly string[]).includes(id)));
  assert.equal(SEARCH_ALGORITHM_IDS.length, 2);
  assert.deepEqual([...THRESHOLD_RULES], ['majority', 'fraction', 'count']);
  assert.deepEqual([...DATA_TABLE_QUESTION_KINDS], ['lookup', 'largest', 'smallest']);
  assert.deepEqual([...ALGORITHM_CLAIM_KINDS], ['running-time', 'property']);
  assert.ok(isAlgorithmId('binary-search') && !isAlgorithmId('bogosort'));
  assert.ok(isSearchAlgorithmId('linear-search') && !isSearchAlgorithmId('quicksort'));
  assert.ok(isAlgorithmClaimKind('property') && !isAlgorithmClaimKind('speed'));
  assert.ok(isThresholdRule('fraction') && !isThresholdRule('supermajority'));
  assert.ok(isDataTableQuestionKind('largest') && !isDataTableQuestionKind('median'));
  assert.equal(KIT_LIMITS.algorithm.input.max, 10);
  assert.equal(KIT_LIMITS.logLadder.maxRatio, 1e12);
  assert.equal(KIT_LIMITS.threshold.total.max, 100000);
  assert.equal(KIT_LIMITS.dataTable.rows.max, 12);
});

test('new gen schemas reject a missing required key and an out-of-range input count', () => {
  const algSchema = kitGenSchemaFor('algorithm-trace-v1') as unknown as Record<string, unknown>;
  const v = ajv.compile(algSchema);
  const good = goldenGen('algorithm-trace-v1') as unknown as Record<string, unknown>;
  const missing = structuredClone(good) as Record<string, unknown>;
  delete missing['input'];
  assert.equal(v(missing), false, 'missing input must be rejected');
  const tooFew = structuredClone(good) as unknown as Record<string, unknown> & { input: number[] };
  tooFew['input'] = [1, 2, 3];
  assert.equal(v(tooFew), false, '3 inputs must be rejected (min 4)');
  const tooMany = structuredClone(good) as unknown as Record<string, unknown> & { input: number[] };
  tooMany['input'] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  assert.equal(v(tooMany), false, '11 inputs must be rejected (max 10)');
});
