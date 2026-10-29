// S6-V — formula-explorer-v1 tests: golden pass, one failing fixture per FE check id, the FE-05
// source-example recomputation (the design's table-based free-fall vector and a synthetic
// wing-loading example), the FE-08 addendum bridge (unparseable page formula publishes ONLY with
// a verified FE-05 example), and the system-owned case-output recomputation.
// Run: node --test packages/validation/stage6-formula-explorer.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateKitComponent, computeCaseOutputs, parsePageFormulaFromQuote, mapPageSymbols } from './kit/index.ts';
import { evaluate, parseExpression } from './expression.ts';
import {
  checkOf, clone, dragSource, expectFailures, failedIds, formulaGen, stage6Fixture, synthSource,
  wingLoadingGen, WING_LOADING_SOURCE, WING_WORDS_SOURCE,
} from './fixtures/stage6.ts';
import type { FormulaExplorerGen } from '../contracts/kit.ts';

const fe = (gen: FormulaExplorerGen, sources = [dragSource()]) => validateKitComponent('formula-explorer-v1', gen, sources);

test('FE-01: a formulaText outside the quote fails alone', () => {
  const gen = clone(formulaGen());
  gen.formulaText = 'D = Cd * rho * V^2 * A'; // plausible, but not the quoted line
  expectFailures(fe(gen), ['FE-01']);
});

test('FE-02: an unparseable expression fails FE-02 (and FE-08, which cannot compare)', () => {
  const gen = clone(formulaGen());
  gen.expression = 'cd * (';
  expectFailures(fe(gen), ['FE-02', 'FE-08']);
});

test('FE-02: variable-set equality is enforced both ways', () => {
  const gen = clone(formulaGen());
  gen.expression = 'cd * (rho * v^2) / 2'; // drops declared variable a
  const report = fe(gen);
  assert.ok(failedIds(report).includes('FE-02'));
  assert.match(checkOf(report, 'FE-02').message, /never used/);
  const extra = clone(formulaGen());
  extra.expression = 'cd * (rho * v^2 * a) / 2 + q'; // q undeclared
  const r2 = fe(extra);
  assert.ok(failedIds(r2).includes('FE-02'));
  assert.match(checkOf(r2, 'FE-02').message, /not a declared variable/);
});

test('FE-02: the 50-node AST budget is enforced', () => {
  const gen = clone(formulaGen());
  gen.expression = Array.from({ length: 40 }, () => 'v').join('+');
  const report = fe(gen);
  assert.ok(failedIds(report).includes('FE-02'));
  assert.match(checkOf(report, 'FE-02').message, /does not parse|budget/);
});

test('FE-03: meaningQuoted=true requires the meaning inside the variable quote', () => {
  const gen = clone(formulaGen());
  gen.variables[1]!.meaningQuoted = true; // "air density" is not in "density is designated by the letter rho"... it is not verbatim
  const report = fe(gen);
  assert.ok(failedIds(report).includes('FE-03'));
});

test('FE-03: reserved names, bad patterns and unknown xVariable fail', () => {
  const gen = clone(formulaGen());
  gen.xVariable = 'q';
  expectFailures(fe(gen), ['FE-03']);
  const reserved = clone(formulaGen());
  reserved.variables[0]!.name = 'pi';
  reserved.expression = 'pi * (rho * v^2 * a) / 2';
  assert.ok(failedIds(fe(reserved)).includes('FE-03'));
  const pattern = clone(formulaGen());
  pattern.variables[0]!.name = 'Cd';
  pattern.expression = 'Cd * (rho * v^2 * a) / 2';
  assert.ok(failedIds(fe(pattern)).includes('FE-03'));
});

test('FE-04: an out-of-range case input fails alone; the system owns the outputs', () => {
  const gen = clone(formulaGen());
  gen.cases[0]!.inputs[2]!.value = 1000; // v range is 1..100
  expectFailures(fe(gen), ['FE-04']);
  const outputs = computeCaseOutputs(formulaGen());
  assert.deepEqual(outputs.map(o => o.id), ['case-one', 'case-two']);
  assert.ok(Math.abs((outputs[0]!.output) - 30) < 1e-9);
  assert.ok(Math.abs((outputs[1]!.output) - 320) < 1e-9);
});

test('FE-04: a missing case input fails the exact-name-set rule', () => {
  const gen = clone(formulaGen());
  gen.cases[0]!.inputs = gen.cases[0]!.inputs.slice(0, 3);
  expectFailures(fe(gen), ['FE-04']);
});

test('FE-05: hasSourceExample=false demands the empty shape; true demands quote+result+match', () => {
  // The golden (false + empty shape) passes; a non-empty shape with false fails:
  const gen = clone(formulaGen());
  gen.sourceExample.resultNumber = 3;
  expectFailures(fe(gen), ['FE-05']);
  // Declared example whose result is not stated in the quote fails alone:
  const declared = clone(formulaGen());
  declared.hasSourceExample = true;
  declared.sourceExample = { quote: 'D = Cd * (rho * V^2 * A) / 2', resultNumber: 42, tolerance: 0.001 };
  expectFailures(fe(declared), ['FE-05']);
});

test('FE-05: the free-fall table vector — X = (1/2)*a*t^2 with a=9.8, t=2 → 19.6', () => {
  const src = synthSource('free-fall', 'Synthetic free fall table paragraph',
    'The motion equations are V = a * t and X = (1 / 2) * a * t^2. The table shows that for a = 9.8 and t = 2 the velocity V is 19.6 and the distance X is 19.6.');
  const gen: FormulaExplorerGen = {
    schemaVersion: 'formula-explorer-v1',
    title: 'Free fall distance explorer',
    formulaText: 'X = (1 / 2) * a * t^2',
    sourceId: 'free-fall',
    quote: 'X = (1 / 2) * a * t^2',
    expression: '(1 / 2) * acc * t^2',
    variables: [
      { name: 'acc', pageSymbol: 'a', meaning: 'acceleration', meaningQuoted: false, quote: 'The motion equations are V = a * t and X = (1 / 2) * a * t^2', unit: 'm/s2', min: 1, max: 20, default: 9.8 },
      { name: 't', pageSymbol: 't', meaning: 'elapsed time', meaningQuoted: false, quote: 'The motion equations are V = a * t and X = (1 / 2) * a * t^2', unit: 's', min: 0.5, max: 10, default: 2 },
    ],
    xVariable: 't',
    cases: [{ id: 'case-table', inputs: [{ name: 'acc', value: 9.8 }, { name: 't', value: 2 }] }],
    sourceExample: { quote: 'for a = 9.8 and t = 2 the velocity V is 19.6 and the distance X is 19.6', resultNumber: 19.6, tolerance: 0.001 },
    hasSourceExample: true,
  };
  const report = validateKitComponent('formula-explorer-v1', gen, [src]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  // A result that no assignment reproduces fails FE-05:
  const bad = clone(gen);
  bad.sourceExample = { ...gen.sourceExample, resultNumber: 19.7 };
  // 19.7 must also APPEAR in the quote to reach the recomputation clause — extend the quote text:
  assert.ok(failedIds(fe(bad, [src])).includes('FE-05'));
});

test('FE-06: a default outside its range fails alone; literal exponents are bounded', () => {
  const gen = clone(formulaGen());
  gen.variables[2]!.default = 500;
  expectFailures(fe(gen), ['FE-06']);
  const exp = clone(formulaGen());
  exp.expression = 'cd * (rho * v^101 * a) / 2';
  assert.ok(failedIds(fe(exp)).includes('FE-06'));
});

test('FE-07: an off-page number in a meaning fails alone', () => {
  const gen = clone(formulaGen());
  gen.variables[1]!.meaning = 'air density at 987654 units';
  expectFailures(fe(gen), ['FE-07']);
});

test('FE-08: a wrong exponent fails the page-formula comparison alone', () => {
  const gen = clone(formulaGen());
  gen.expression = 'cd * (rho * v^3 * a) / 2';
  const report = expectFailures(fe(gen), ['FE-08']);
  assert.match(checkOf(report, 'FE-08').message, /The formula could not be checked with our calculator/);
});

test('FE-08: the page RHS is parsed with symbol mapping and prose cutting', () => {
  const vars = [
    { name: 'cd', pageSymbol: 'Cd' },
    { name: 'rho', pageSymbol: 'rho' },
    { name: 'v', pageSymbol: 'V' },
    { name: 'a', pageSymbol: 'A' },
  ];
  assert.equal(mapPageSymbols('Cd * (rho * V^2 * A) / 2', vars), 'cd * (rho * v^2 * a) / 2');
  const attempt = parsePageFormulaFromQuote('The drag equation states D = Cd * (rho * V^2 * A) / 2 exactly', vars);
  assert.equal(attempt.status, 'parsed');
  if (attempt.status === 'parsed' && attempt.ast !== undefined) {
    const expr = parseExpression('cd * (rho * v^2 * a) / 2');
    assert.equal(expr.ok, true);
    if (expr.ok) {
      const point = { cd: 0.5, rho: 1.2, v: 10, a: 1 };
      assert.ok(Math.abs(evaluate(attempt.ast, point) - evaluate(expr.ast, point)) < 1e-9);
    }
  }
  // Trailing prose after "where" is cut before parsing:
  const withWhere = parsePageFormulaFromQuote('V = a * t where a is the acceleration', [{ name: 'a', pageSymbol: 'a' }, { name: 't', pageSymbol: 't' }]);
  assert.equal(withWhere.status, 'parsed');
  // A words-only formula line is unparseable:
  const words = parsePageFormulaFromQuote('the wing loading w equals the weight W divided by the area S', [{ name: 'wt', pageSymbol: 'W' }, { name: 'ar', pageSymbol: 'S' }]);
  assert.equal(words.status, 'unparseable');
});

test('FE-08: an unparseable page formula publishes ONLY with a verified FE-05 example (addendum bridge)', () => {
  // Words-only formula, no example → FE-08 fails with the frozen message:
  const noExample = wingLoadingGen({ words: true });
  const r1 = fe(noExample, [WING_WORDS_SOURCE()]);
  assert.deepEqual(failedIds(r1), ['FE-08']);
  assert.match(checkOf(r1, 'FE-08').message, /no verified FE-05 source example/);
  assert.match(checkOf(r1, 'FE-08').message, /The formula could not be checked with our calculator/);
  // Same page with a verified example → everything passes and the bridge is disclosed:
  const withExample = wingLoadingGen({ words: true, withExample: true });
  const r2 = fe(withExample, [WING_WORDS_SOURCE()]);
  assert.deepEqual(failedIds(r2), [], r2.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(r2, 'FE-08').message, /FE-05 bridge/);
});

test('FE-08: a parseable page formula compares at independently varied points (S6R-02)', () => {
  const gen = wingLoadingGen({ withExample: true });
  const report = fe(gen, [WING_LOADING_SOURCE()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'FE-08').message, /matches the page formula/);
  assert.match(checkOf(report, 'FE-08').message, /finite independent comparison points agree within relative/);
  // A wrong expression on the same page fails even though an example exists:
  const wrong = clone(gen);
  wrong.expression = 'wt * ar';
  wrong.cases = [{ id: 'case-one', inputs: [{ name: 'wt', value: 6 }, { name: 'ar', value: 3 }] }];
  assert.ok(failedIds(fe(wrong, [WING_LOADING_SOURCE()])).includes('FE-08'));
});

test('golden fixture sanity: schema gate and frozen ids', () => {
  const report = fe(stage6Fixture<FormulaExplorerGen>('formula-explorer.gen.json'));
  assert.equal(checkOf(report, 'schema.gen').passed, true);
  assert.equal(report.publishable, true);
});
