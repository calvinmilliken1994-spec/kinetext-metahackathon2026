// S6-V test helpers — loads the frozen golden fixtures (tests/fixtures/stage6/), the real
// licensed sources (data/sources/) and builds small synthetic SourceDocuments for vectors the
// corpus does not cover (chemistry equations, numbered sequences, paragraph-fallback sorts,
// wing-loading formula examples). Test-only module; no production code imports it.
import { readFileSync } from 'node:fs';

import type { SourceAnalysisV2, SourceDocument, ValidationReport } from '../../contracts/index.ts';
import type {
  BalanceEquationGen,
  CompareTableGen,
  ConceptMapGen,
  FormulaExplorerGen,
  OverviewGen,
  QuizCardsGen,
  SequenceGen,
  SortGroupsGen,
} from '../../contracts/kit.ts';
import { loadSource, listSourceIds, loadSourceMeta, sha256 } from '../../sources/index.ts';

export function stage6Fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../tests/fixtures/stage6/${name}`, import.meta.url), 'utf8')) as T;
}

export const dragSource = (): SourceDocument => loadSource('nasa-grc-drag-equation');
export const constitutionSource = (): SourceDocument => loadSource('nara-constitution');
export const nijSource = (): SourceDocument => loadSource('nij-heterozygosity');
export const atmosphereSource = (): SourceDocument => loadSource('nasa-grc-earth-atmosphere-equation-english');

export const usableAnalysis = (): SourceAnalysisV2 => stage6Fixture<SourceAnalysisV2>('source-analysis-v2.usable.json');
export const declinedAnalysis = (): SourceAnalysisV2 => stage6Fixture<SourceAnalysisV2>('source-analysis-v2.declined.json');
export const quizGen = (): QuizCardsGen => stage6Fixture<QuizCardsGen>('quiz-cards.gen.json');
export const sequenceGen = (): SequenceGen => stage6Fixture<SequenceGen>('sequence.gen.json');
export const sortGen = (): SortGroupsGen => stage6Fixture<SortGroupsGen>('sort-groups.gen.json');
export const conceptMapGen = (): ConceptMapGen => stage6Fixture<ConceptMapGen>('concept-map.gen.json');
export const compareGen = (): CompareTableGen => stage6Fixture<CompareTableGen>('compare-table.gen.json');
export const formulaGen = (): FormulaExplorerGen => stage6Fixture<FormulaExplorerGen>('formula-explorer.gen.json');
export const balanceGen = (): BalanceEquationGen => stage6Fixture<BalanceEquationGen>('balance-equation.gen.json');
export const overviewGen = (): OverviewGen => usableAnalysis().overview;

/**
 * The golden overview with the THREE entries that fail the frozen OV-06 overlap rule reworded
 * toward their quotes (the design's own repair path: rewrite point/gloss wording, never the
 * quote). Used by the OV check-fixture tests so each mutation fails in isolation; the raw golden
 * gap stays pinned in stage6-kit-golden.test.ts for the lead.
 */
export function repairedOverviewGen(): OverviewGen {
  const gen = clone(overviewGen());
  gen.keyPoints[1]!.point = 'One drag coefficient variable collects the complex effects.';
  gen.keyTerms[0]!.gloss = 'Single number collecting drag coefficient effects.';
  gen.keyTerms[1]!.gloss = 'Mass of air per volume, the density in the equation.';
  return gen;
}

export function balanceGoldenSource(): SourceDocument {
  const text = readFileSync(new URL('../../../tests/fixtures/stage6/balance.synthetic-source.txt', import.meta.url), 'utf8');
  return synthSource('synthetic-balance', 'Synthetic methane burning paragraph', text);
}

export function synthSource(id: string, title: string, text: string): SourceDocument {
  return {
    id,
    title,
    locator: `synthetic:${id}`,
    license: 'project-authored',
    attribution: 'Project-authored synthetic test source.',
    sha256: sha256(text),
    text,
  };
}

/** The stub source for the declined-analysis golden (under the 300-char R-DEC-3 threshold). */
export function stubSource(): SourceDocument {
  return synthSource('stub', 'Stub', 'A short stub mentioning D = Cd * rho without explanation.');
}

export function chemistrySource(id: string, text: string): SourceDocument {
  return synthSource(id, 'Synthetic chemistry paragraph', text);
}

/* ------------------------------------------------------------------ */
/* Report helpers (v1 test conventions)                                */
/* ------------------------------------------------------------------ */

import assert from 'node:assert/strict';

export function checkOf(report: ValidationReport, id: string) {
  const found = report.checks.find(c => c.id === id);
  assert.ok(found, `expected a check "${id}", report has [${report.checks.map(c => c.id).join(', ')}]`);
  return found;
}

export function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

export function failureDetail(report: ValidationReport): string {
  return report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n');
}

/** Assert the structural gate passed, exactly `expected` check ids failed, and publication is blocked. */
export function expectFailures(report: ValidationReport, expected: string[], gateId = 'schema.gen'): ValidationReport {
  assert.equal(checkOf(report, gateId).passed, true, `mutation must keep the gen schema-valid: ${checkOf(report, gateId).message}`);
  assert.deepEqual(failedIds(report), expected, failureDetail(report));
  assert.equal(report.publishable, false);
  return report;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ */
/* Synthetic vectors                                                   */
/* ------------------------------------------------------------------ */

export const IMPOSSIBLE_EQUATION_TEXT = 'Methane CH4 burns in oxygen O2. The page prints CH4 + O2 \u2192 CO2 as written. Carbon dioxide CO2 appears.';
export function impossibleBalanceGen(): BalanceEquationGen {
  return {
    schemaVersion: 'balance-equation-v1',
    title: 'Impossible methane split',
    equationText: 'CH4 + O2 \u2192 CO2',
    sourceId: 'chem-impossible',
    quote: 'The page prints CH4 + O2 \u2192 CO2 as written',
    species: [
      { id: 'methane', formula: 'CH4', side: 'left', sourceId: 'chem-impossible', quote: 'Methane CH4 burns in oxygen O2' },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-impossible', quote: 'Methane CH4 burns in oxygen O2' },
      { id: 'carbon-dioxide', formula: 'CO2', side: 'right', sourceId: 'chem-impossible', quote: 'Carbon dioxide CO2 appears' },
    ],
    hint: 'Count the atoms on each side.',
  };
}
export const IMPOSSIBLE_SOURCE = (): SourceDocument => chemistrySource('chem-impossible', IMPOSSIBLE_EQUATION_TEXT);

export const AMBIGUOUS_EQUATION_TEXT = 'Ammonia NH3 reacts with oxygen O2. The page prints NH3 + O2 \u2192 N2 + NO + H2O as written. The products are nitrogen N2, nitric oxide NO and water H2O.';
export function ambiguousBalanceGen(): BalanceEquationGen {
  return {
    schemaVersion: 'balance-equation-v1',
    title: 'Ambiguous ammonia oxidation',
    equationText: 'NH3 + O2 \u2192 N2 + NO + H2O',
    sourceId: 'chem-ambiguous',
    quote: 'The page prints NH3 + O2 \u2192 N2 + NO + H2O as written',
    species: [
      { id: 'ammonia', formula: 'NH3', side: 'left', sourceId: 'chem-ambiguous', quote: 'Ammonia NH3 reacts with oxygen O2' },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-ambiguous', quote: 'Ammonia NH3 reacts with oxygen O2' },
      { id: 'nitrogen', formula: 'N2', side: 'right', sourceId: 'chem-ambiguous', quote: 'The products are nitrogen N2, nitric oxide NO and water H2O' },
      { id: 'nitric-oxide', formula: 'NO', side: 'right', sourceId: 'chem-ambiguous', quote: 'The products are nitrogen N2, nitric oxide NO and water H2O' },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-ambiguous', quote: 'The products are nitrogen N2, nitric oxide NO and water H2O' },
    ],
    hint: 'Count the atoms on each side.',
  };
}
export const AMBIGUOUS_SOURCE = (): SourceDocument => chemistrySource('chem-ambiguous', AMBIGUOUS_EQUATION_TEXT);

export const BIG_COEFF_EQUATION_TEXT = 'Octane C8H18 burns in oxygen O2. The page prints C8H18 + O2 \u2192 CO2 + H2O as written. The exhaust is carbon dioxide CO2 and water H2O.';
export function bigCoefficientBalanceGen(): BalanceEquationGen {
  return {
    schemaVersion: 'balance-equation-v1',
    title: 'Octane combustion',
    equationText: 'C8H18 + O2 \u2192 CO2 + H2O',
    sourceId: 'chem-octane',
    quote: 'The page prints C8H18 + O2 \u2192 CO2 + H2O as written',
    species: [
      { id: 'octane', formula: 'C8H18', side: 'left', sourceId: 'chem-octane', quote: 'Octane C8H18 burns in oxygen O2' },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-octane', quote: 'Octane C8H18 burns in oxygen O2' },
      { id: 'carbon-dioxide', formula: 'CO2', side: 'right', sourceId: 'chem-octane', quote: 'The exhaust is carbon dioxide CO2 and water H2O' },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-octane', quote: 'The exhaust is carbon dioxide CO2 and water H2O' },
    ],
    hint: 'Count the atoms on each side.',
  };
}
export const BIG_COEFF_SOURCE = (): SourceDocument => chemistrySource('chem-octane', BIG_COEFF_EQUATION_TEXT);

export const NUMBERED_CYCLE_TEXT =
  'The water cycle steps are printed in order. First, evaporation lifts water vapor upward. ' +
  'Second, condensation forms clouds. Third, precipitation returns water to the land. ' +
  'Fourth, collection stores water in the oceans.';
export function numberedSequenceGen(): SequenceGen {
  const src = 'cycle-numbered';
  return {
    schemaVersion: 'sequence-v1',
    title: 'The water cycle in order',
    orderBasis: 'numbered',
    cyclic: true,
    orderNote: '',
    steps: [
      { id: 'evaporation', label: 'evaporation lifts water vapor upward', sourceId: src, quote: 'First, evaporation lifts water vapor upward', orderHint: '' },
      { id: 'condensation', label: 'condensation forms clouds', sourceId: src, quote: 'Second, condensation forms clouds', orderHint: '' },
      { id: 'precipitation', label: 'precipitation returns water to the land', sourceId: src, quote: 'Third, precipitation returns water to the land', orderHint: '' },
      { id: 'collection', label: 'collection stores water in the oceans', sourceId: src, quote: 'Fourth, collection stores water in the oceans', orderHint: '' },
    ],
  };
}
export const NUMBERED_SOURCE = (): SourceDocument => chemistrySource('cycle-numbered', NUMBERED_CYCLE_TEXT);

export const ROCK_SORT_TEXT =
  'Sorting rocks by origin uses two categories.\n\n' +
  'Igneous rocks include granite. A granite sample cools slowly underground, forming large crystals. Another basalt piece cools quickly outdoors.\n\n' +
  'Sedimentary layers settle underwater. A sandstone slab settles in water. A shale fragment settles in deeper water.';
export function rockSortGen(): SortGroupsGen {
  const src = 'rock-sort';
  return {
    schemaVersion: 'sort-groups-v1',
    title: 'Rock origin sort',
    groups: [
      { id: 'igneous', label: 'Igneous rocks' },
      { id: 'sedimentary', label: 'Sedimentary' },
    ],
    items: [
      { id: 'granite-sample', label: 'granite sample', groupId: 'igneous', sourceId: src, quote: 'A granite sample cools slowly underground, forming large crystals' },
      { id: 'basalt-piece', label: 'basalt piece', groupId: 'igneous', sourceId: src, quote: 'Another basalt piece cools quickly outdoors' },
      { id: 'cools-slowly', label: 'cools slowly', groupId: 'igneous', sourceId: src, quote: 'A granite sample cools slowly underground, forming large crystals' },
      { id: 'sandstone-slab', label: 'sandstone slab', groupId: 'sedimentary', sourceId: src, quote: 'A sandstone slab settles in water' },
      { id: 'shale-fragment', label: 'shale fragment', groupId: 'sedimentary', sourceId: src, quote: 'A shale fragment settles in deeper water' },
      { id: 'settle-underwater', label: 'settle underwater', groupId: 'sedimentary', sourceId: src, quote: 'Sedimentary layers settle underwater' },
    ],
  };
}
export const ROCK_SORT_SOURCE = (): SourceDocument => synthSource('rock-sort', 'Synthetic rock sorting paragraph', ROCK_SORT_TEXT);

export const THREE_ENTITY_TEXT =
  'Alpha rock is hard and old. Beta rock is soft and young. Gamma rock is porous and new.';
export function threeEntityCompareGen(): CompareTableGen {
  const src = 'compare-three';
  return {
    schemaVersion: 'compare-table-v1',
    title: 'Rock properties compare',
    entities: ['Alpha rock', 'Beta rock', 'Gamma rock'],
    attributes: ['texture', 'age'],
    cells: [
      { id: 'alpha-texture', entityIndex: 0, attributeIndex: 0, value: 'hard', sourceId: src, quote: 'Alpha rock is hard and old' },
      { id: 'alpha-age', entityIndex: 0, attributeIndex: 1, value: 'old', sourceId: src, quote: 'Alpha rock is hard and old' },
      { id: 'beta-texture', entityIndex: 1, attributeIndex: 0, value: 'soft', sourceId: src, quote: 'Beta rock is soft and young' },
      { id: 'beta-age', entityIndex: 1, attributeIndex: 1, value: 'young', sourceId: src, quote: 'Beta rock is soft and young' },
      { id: 'gamma-texture', entityIndex: 2, attributeIndex: 0, value: 'porous', sourceId: src, quote: 'Gamma rock is porous and new' },
      { id: 'gamma-age', entityIndex: 2, attributeIndex: 1, value: 'new', sourceId: src, quote: 'Gamma rock is porous and new' },
    ],
  };
}
export const THREE_ENTITY_SOURCE = (): SourceDocument => synthSource('compare-three', 'Synthetic rock compare paragraph', THREE_ENTITY_TEXT);

export const WING_LOADING_PARSEABLE_TEXT =
  'The glider wing loading example. The page states the wing loading w = W / S, the weight W divided by the area S. With W = 6 and S = 3 the wing loading is 2 for this aircraft.';
export const WING_LOADING_WORDS_TEXT =
  'The glider handbook states the wing loading w equals the weight W divided by the area S. With W = 6 and S = 3 the wing loading is 2.';

export function wingLoadingGen(opts: { words?: boolean; withExample?: boolean } = {}): FormulaExplorerGen {
  const src = opts.words === true ? 'wing-words' : 'wing-loading';
  const formulaText = opts.words === true
    ? 'wing loading w equals the weight W divided by the area S'
    : 'w = W / S';
  const quote = opts.words === true
    ? 'the wing loading w equals the weight W divided by the area S'
    : 'The page states the wing loading w = W / S';
  return {
    schemaVersion: 'formula-explorer-v1',
    title: 'Wing loading explorer',
    formulaText,
    sourceId: src,
    quote,
    expression: 'wt / ar',
    variables: [
      { name: 'wt', pageSymbol: 'W', meaning: 'weight', meaningQuoted: false, quote: 'the weight W divided by the area S', unit: 'N', min: 1, max: 12, default: 6 },
      { name: 'ar', pageSymbol: 'S', meaning: 'wing area', meaningQuoted: false, quote: 'the weight W divided by the area S', unit: 'm2', min: 1, max: 6, default: 3 },
    ],
    xVariable: 'wt',
    cases: [{ id: 'case-one', inputs: [{ name: 'wt', value: 6 }, { name: 'ar', value: 3 }] }],
    sourceExample: opts.withExample === true
      ? { quote: 'With W = 6 and S = 3 the wing loading is 2', resultNumber: 2, tolerance: 0.001 }
      : { quote: '', resultNumber: 0, tolerance: 0 },
    hasSourceExample: opts.withExample === true,
  };
}
export const WING_LOADING_SOURCE = (): SourceDocument => synthSource('wing-loading', 'Synthetic wing loading paragraph', WING_LOADING_PARSEABLE_TEXT);
export const WING_WORDS_SOURCE = (): SourceDocument => synthSource('wing-words', 'Synthetic wing loading words paragraph', WING_LOADING_WORDS_TEXT);

export { listSourceIds, loadSourceMeta };
