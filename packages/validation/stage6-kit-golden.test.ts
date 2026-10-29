// S6-V — Stage 6 golden-fixture tests: every frozen tests/fixtures/stage6 gen must pass every
// check of its component against the real licensed sources, and each report must carry exactly
// 'schema.gen' plus the frozen check ids in order (retired ids always pass).
//
// KNOWN GOLDEN GAP — RESOLVED (Wave A3, S6R-01): the hand-written overview golden used to fail
// OV-06 point-quote-overlap on three paraphrased entries. The authored fixture wording
// (tests/fixtures/stage6/source-analysis-v2.usable.json) is now faithful to its quotes and the
// raw golden passes every OV check; no check was weakened or disabled.
// Run: node --test packages/validation/stage6-kit-golden.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { checkIdsFor } from '../contracts/kit.ts';
import { validateKitComponent, computeCaseOutputs } from './kit/index.ts';
import {
  atmosphereSource, balanceGoldenSource, checkOf, constitutionSource, dragSource,
  failedIds, failureDetail, formulaGen, nijSource,
  stage6Fixture, usableAnalysis,
} from './fixtures/stage6.ts';
import type { QuizCardsGen, SequenceGen, SortGroupsGen, ConceptMapGen, CompareTableGen, FormulaExplorerGen, BalanceEquationGen } from '../contracts/kit.ts';

test('golden quiz-cards passes every check', () => {
  const report = validateKitComponent('quiz-cards-v1', stage6Fixture<QuizCardsGen>('quiz-cards.gen.json'), [dragSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('quiz-cards-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('golden sequence passes every check (page-order offsets strictly ascend)', () => {
  const report = validateKitComponent('sequence-v1', stage6Fixture<SequenceGen>('sequence.gen.json'), [constitutionSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('sequence-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('golden sort-groups passes every check', () => {
  const report = validateKitComponent('sort-groups-v1', stage6Fixture<SortGroupsGen>('sort-groups.gen.json'), [nijSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('sort-groups-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('golden concept-map passes every check (paragraph fallback grounds the "drag" endpoint)', () => {
  const report = validateKitComponent('concept-map-v1', stage6Fixture<ConceptMapGen>('concept-map.gen.json'), [dragSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('concept-map-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('golden compare-table passes; CT-05 records the reveal-only fallback (2 entities < 3 options)', () => {
  const report = validateKitComponent('compare-table-v1', stage6Fixture<CompareTableGen>('compare-table.gen.json'), [atmosphereSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('compare-table-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'CT-05').message, /reveal-only/);
});

test('golden formula-explorer passes every check incl. FE-08 page-formula match', () => {
  const gen = stage6Fixture<FormulaExplorerGen>('formula-explorer.gen.json');
  const report = validateKitComponent('formula-explorer-v1', gen, [dragSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('formula-explorer-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.match(checkOf(report, 'FE-08').message, /matches the page formula/);
  // The system-owned case recomputation (design: Muse writes inputs only):
  const outputs = computeCaseOutputs(gen);
  assert.equal(outputs.length, 2);
  assert.ok(Math.abs((outputs[0]?.output ?? NaN) - 0.5 * (1.2 * 100 * 1) / 2) < 1e-9); // 30
  assert.ok(Math.abs((outputs[1]?.output ?? NaN) - 0.8 * (1 * 400 * 2) / 2) < 1e-9); // 320
});

test('golden balance-equation passes every check; BAL-06 retired always passes', () => {
  const report = validateKitComponent('balance-equation-v1', stage6Fixture<BalanceEquationGen>('balance-equation.gen.json'), [balanceGoldenSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('balance-equation-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(checkOf(report, 'BAL-06').passed, true);
  assert.match(checkOf(report, 'BAL-06').message, /retired/);
  assert.match(checkOf(report, 'BAL-03').message, /\[1, 2, 1, 2\]/);
});

test('golden overview: OV-01..OV-06 all pass (the authored wording was made faithful to its quotes; OV-06 is not disabled)', () => {
  const report = validateKitComponent('overview-v1', usableAnalysis().overview, [dragSource()]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.gen', ...checkIdsFor('overview-v1')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('an unknown componentId fails closed at the gate', () => {
  const report = validateKitComponent('nope-v2', {}, []);
  assert.equal(report.publishable, false);
  assert.equal(report.checks.length, 1);
  assert.equal(report.checks[0]?.id, 'schema.gen');
});

test('a type-invalid gen short-circuits at the Ajv gate; count-only violations do NOT', () => {
  // Type error → short circuit with affected paths:
  const broken = { schemaVersion: 'quiz-cards-v1', title: 42, cards: [] };
  const r1 = validateKitComponent('quiz-cards-v1', broken, [dragSource()]);
  assert.equal(r1.checks.length, 1);
  assert.equal(r1.checks[0]?.id, 'schema.gen');
  assert.ok((r1.checks[0]?.affected ?? []).includes('/title'));
  // Count-only violation (2 cards) → the component validator owns it via schema.gen structural:
  const gen = stage6Fixture<QuizCardsGen>('quiz-cards.gen.json');
  const short = { ...gen, cards: gen.cards.slice(0, 2) };
  const r2 = validateKitComponent('quiz-cards-v1', short, [dragSource()]);
  assert.ok(r2.checks.length > 1, 'count violations must not short-circuit');
  assert.equal(checkOf(r2, 'schema.gen').passed, false);
  assert.match(checkOf(r2, 'schema.gen').message, /cards has 2 entries, expected 3-5/);
});

test('malformed gen input never throws (junk degrades into failed checks)', () => {
  for (const junk of [null, undefined, 42, 'x', [], {}]) {
    const report = validateKitComponent('quiz-cards-v1', junk, []);
    assert.equal(report.publishable, false);
  }
  const overview = validateKitComponent('overview-v1', { headline: 1 }, []);
  assert.equal(overview.publishable, false);
  assert.equal(overview.checks[0]?.id, 'schema.gen');
});
