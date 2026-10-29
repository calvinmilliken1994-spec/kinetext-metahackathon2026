// S6R wave A1 regression tests — Stage 6 review findings S6R-02, S6R-03, S6R-04 (formula explorer).
// Each of the reviewer's probe vectors (cache/scratch/review-s6/publish-probes.mjs: formula-diagonal,
// formula-quote-cut, formula-unmapped-operator, formula-bridge-swaps-input-identities) is a test here,
// plus the controls that must stay publishable and the unit-level rules:
//   - S6R-02: FE-08 compares at INDEPENDENTLY varied points (defaults, per-variable one-at-a-time,
//     seeded pseudo-random, stored case inputs), never only the correlated diagonal.
//   - S6R-03: the formula quote/formulaText must be a COMPLETE source formula (an evidence edge may
//     not cut a mathematical token), and the page-formula parser never succeeds on a prefix when an
//     unsupported mathematical character follows; trailing prose is stripped only at explicit
//     prose boundaries.
//   - S6R-04: the FE-05 source-example bridge binds page symbols to values EXPLICITLY from the
//     quote ('x = 6', 'x is 6', '6 for x'), compares only at those bindings, never permutes
//     numbers, never uses the stated result as an input candidate, and supports repeated equal
//     input values.
// Run: node --test packages/validation/review-s6-formula.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateFormulaExplorer,
  parsePageFormulaFromQuote,
  bindSourceExampleInputs,
  formulaCompletenessProblems,
} from './kit/formula-explorer.ts';
import {
  compareAtPoints,
  evaluate,
  independentSamplePoints,
  parseExpression,
} from './expression.ts';
import type { SourceDocument } from '../contracts/index.ts';
import type { FormulaExplorerGen } from '../contracts/kit.ts';

function reviewSource(id: string, text: string): SourceDocument {
  return {
    id, text, title: 'Classroom text', locator: 'synthetic:review',
    license: 'project-authored', attribution: 'Project-authored review vector.', sha256: '0'.repeat(64),
  } as SourceDocument;
}

const failingIds = (r: { checks: { id: string; passed: boolean }[] }): string[] => r.checks.filter(c => !c.passed).map(c => c.id);
const messageOf = (r: { checks: { id: string; message: string }[] }, id: string): string => r.checks.find(c => c.id === id)?.message ?? '';

/** The reviewer's two-variable probe generator (variables x,y over [1,9], stored case {x:2,y:4}). */
function probeFormula(quote: string, expression = 'x/y', example: { quote: string; resultNumber: number; tolerance: number } | null = null): FormulaExplorerGen {
  return {
    schemaVersion: 'formula-explorer-v1',
    title: 'Formula exploration',
    formulaText: quote,
    sourceId: 'formula',
    quote,
    expression,
    variables: [
      { name: 'x', pageSymbol: 'x', meaning: 'first input', meaningQuoted: false, quote, unit: '', min: 1, max: 9, default: 2 },
      { name: 'y', pageSymbol: 'y', meaning: 'second input', meaningQuoted: false, quote, unit: '', min: 1, max: 9, default: 4 },
    ],
    xVariable: 'x',
    cases: [{ id: 'first', inputs: [{ name: 'x', value: 2 }, { name: 'y', value: 4 }] }],
    sourceExample: example ?? { quote: '', resultNumber: 0, tolerance: 0 },
    hasSourceExample: example !== null,
  };
}

const XY_VARS = [{ name: 'x', pageSymbol: 'x' }, { name: 'y', pageSymbol: 'y' }];

/* ------------------------------------------------------------------ */
/* S6R-02 — FE-08 must not sample only the diagonal                    */
/* ------------------------------------------------------------------ */

test('S6R-02 formula-diagonal: x+y+(x-y)^2 against page z = x+y fails FE-08', () => {
  const gen = probeFormula('z = x+y', 'x+y+(x-y)^2');
  const report = validateFormulaExplorer(gen, [reviewSource('formula', 'z = x+y')]);
  assert.ok(failingIds(report).includes('FE-08'), `expected FE-08 failure, got [${failingIds(report).join('|')}]`);
  assert.equal(report.publishable, false);
  // At the STORED CASE inputs the page gives 6 while the accepted expression gives 10:
  assert.match(messageOf(report, 'FE-08'), /does not match the page formula/);
});

test('S6R-02: independentSamplePoints varies variables independently, deterministically, and includes defaults and stored case points', () => {
  const vars = [
    { name: 'x', min: 1, max: 9, default: 2 },
    { name: 'y', min: 1, max: 9, default: 4 },
  ];
  const points = independentSamplePoints(vars, [{ x: 2, y: 4 }, { x: 2, y: 4 }, { x: NaN, y: 1 }, { x: 5 }]);
  // Deterministic: identical calls give identical point lists (fixed seed, no clock/Math.random).
  assert.deepEqual(independentSamplePoints(vars, [{ x: 2, y: 4 }]), independentSamplePoints(vars, [{ x: 2, y: 4 }]));
  // The slider-default point is included:
  assert.ok(points.some(p => p.x === 2 && p.y === 4), 'the default/stored-case point {x:2,y:4} must be sampled');
  // NOT only the diagonal: many points with x !== y, and one-at-a-time variation around the base
  // (y held at its default while x moves, and vice versa):
  const offDiagonal = points.filter(p => p.x !== p.y);
  assert.ok(offDiagonal.length >= 5, `expected >= 5 off-diagonal points, got ${offDiagonal.length}`);
  assert.ok(points.some(p => p.y === 4 && p.x !== 2), 'expected one-at-a-time variation of x around the base point');
  assert.ok(points.some(p => p.x === 2 && p.y !== 4), 'expected one-at-a-time variation of y around the base point');
  // Every point is finite and inside the ranges; incomplete/NaN extras are dropped:
  for (const p of points) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.ok(p.x >= 1 && p.x <= 9 && p.y >= 1 && p.y <= 9);
  }
  assert.ok(points.length >= 10, `expected a substantially larger sample set than 5, got ${points.length}`);
});

test('S6R-02: compareAtPoints is a pure exported helper that flags any mismatch and counts finite agreements', () => {
  const ast = (expr: string) => {
    const parsed = parseExpression(expr);
    assert.equal(parsed.ok, true, expr);
    return parsed.ok ? parsed.ast : undefined!;
  };
  const points = independentSamplePoints([{ name: 'x', min: 1, max: 9, default: 2 }, { name: 'y', min: 1, max: 9, default: 4 }]);
  const bad = compareAtPoints(ast('x+y'), ast('x+y+(x-y)^2'), points, 1e-9);
  assert.ok(bad.mismatches.length > 0, 'the (x-y)^2 error must produce mismatches at independently varied points');
  assert.equal(bad.finite, points.length);
  assert.ok(bad.agreeing < bad.finite);
  // Identical formulas (up to commutativity) agree everywhere with no mismatch:
  const same = compareAtPoints(ast('x+y'), ast('y+x'), points, 1e-9);
  assert.equal(same.mismatches.length, 0);
  assert.equal(same.agreeing, same.finite);
  // Non-finite points on either side are skipped, never counted as agreements:
  const dom = compareAtPoints(ast('sqrt(x)'), ast('sqrt(x)'), [{ x: -1, y: 1 }, { x: 4, y: 1 }], 1e-9);
  assert.equal(dom.finite, 1);
  assert.equal(dom.agreeing, 1);
  assert.equal(dom.mismatches.length, 0);
});

/* ------------------------------------------------------------------ */
/* S6R-03 — complete source formula, no prefix parses                  */
/* ------------------------------------------------------------------ */

test('S6R-03 formula-quote-cut: quoting z = x/y from source z = x/y^2 fails FE-01', () => {
  const gen = probeFormula('z = x/y', 'x/y');
  const report = validateFormulaExplorer(gen, [reviewSource('formula', 'The full formula is z = x/y^2.')]);
  assert.ok(failingIds(report).includes('FE-01'), `expected FE-01 failure, got [${failingIds(report).join('|')}]`);
  assert.equal(report.publishable, false);
  assert.match(messageOf(report, 'FE-01'), /complete formula|cuts|continues/);
});

test('S6R-03: the quote-edge completeness helper rejects cut mathematical tokens on either edge', () => {
  // The cropped quote has no clean occurrence (the only one continues into ^2):
  const cut = formulaCompletenessProblems('z = x/y', 'z = x/y', 'The full formula is z = x/y^2.');
  assert.ok(cut.problems.length > 0, 'z = x/y cut from z = x/y^2 must be rejected');
  assert.ok(cut.affected.includes('/quote') && cut.affected.includes('/formulaText'));
  // A coefficient cut on the left edge (z = x/y quoted from 2z = x/y):
  const onlyCut = formulaCompletenessProblems('z = x/y', 'z = x/y', 'The page prints 2z = x/y today.');
  assert.ok(onlyCut.problems.length > 0, 'z = x/y cut from 2z = x/y must be rejected (left edge cuts the coefficient)');
  // The complete formula passes:
  assert.deepEqual(formulaCompletenessProblems('z = x/y^2', 'z = x/y^2', 'The full formula is z = x/y^2.').problems, []);
  // A prose continuation after the formula is fine:
  assert.deepEqual(formulaCompletenessProblems('W = m * g', 'W = m * g', 'The weight W = m * g since the gravitational constant is fixed.').problems, []);
  // An unmapped mathematical operator/symbol/digit right after the quote edge is a cut:
  assert.ok(formulaCompletenessProblems('z = x/y', 'z = x/y', 'The page prints z = x/y ÷ 2 here.').problems.length > 0);
  assert.ok(formulaCompletenessProblems('z = x/y', 'z = x/y', 'The page prints z = x/y² here.').problems.length > 0);
  assert.ok(formulaCompletenessProblems('z = x/y', 'z = x/y', 'The page prints z = x/y - 1 here.').problems.length > 0);
  assert.ok(formulaCompletenessProblems('z = x/y', 'z = x/y', 'The page prints z = x/y 2 here.').problems.length > 0);
  // Parenthesised formulas keep clean edges, and a formulaText cropped INSIDE a complete quote
  // is rejected too:
  assert.deepEqual(formulaCompletenessProblems('the relation (V = a * t) holds', 'V = a * t', 'the relation (V = a * t) holds').problems, []);
  assert.ok(formulaCompletenessProblems('z = x/y^2', 'z = x/y', 'The full formula is z = x/y^2.').problems.length > 0);
  // An unlocatable source text yields no verdict here (quote grounding owns that failure):
  assert.deepEqual(formulaCompletenessProblems('z = x/y', 'z = x/y', undefined).problems, []);
});

test('S6R-03 formula-unmapped-operator: full quote z = x/y ÷ 2 is unparseable, so FE-08 fails without a bridge', () => {
  const attempt = parsePageFormulaFromQuote('z = x/y ÷ 2', XY_VARS);
  assert.equal(attempt.status, 'unparseable', 'an unmapped mathematical operator must not yield a prefix parse');
  const gen = probeFormula('z = x/y ÷ 2', 'x/y');
  const report = validateFormulaExplorer(gen, [reviewSource('formula', 'z = x/y ÷ 2')]);
  assert.ok(failingIds(report).includes('FE-08'), `expected FE-08 failure, got [${failingIds(report).join('|')}]`);
  assert.equal(report.publishable, false);
});

test('S6R-03: the page-formula parser never succeeds on a prefix before unsupported mathematical content', () => {
  // Equality chains: the full RHS after the first '=' still contains '=' → unparseable:
  assert.equal(parsePageFormulaFromQuote('z = x/y = 2*x/y', XY_VARS).status, 'unparseable');
  // Unsupported operators/symbols following the would-be prefix:
  assert.equal(parsePageFormulaFromQuote('z = x/y ÷ 2', XY_VARS).status, 'unparseable');
  assert.equal(parsePageFormulaFromQuote('z = x/y √ 2', XY_VARS).status, 'unparseable');
  assert.equal(parsePageFormulaFromQuote('z = x/y × 2', XY_VARS).status, 'parsed'); // × IS a supported normalisation…
  const times = parsePageFormulaFromQuote('z = x/y × 2', XY_VARS);
  if (times.status === 'parsed' && times.ast !== undefined) {
    // …so it must parse as the COMPLETE x/y*2, never the prefix x/y:
    assert.ok(Math.abs(evaluate(times.ast, { x: 8, y: 4 }) - 4) < 1e-12, '× must keep the full formula content (8/4*2 = 4)');
  }
  // A digit continuing the formula after the prefix:
  assert.equal(parsePageFormulaFromQuote('z = x/y 2', XY_VARS).status, 'unparseable');
  // Adjacent letters (implicit multiplication) are not silently dropped:
  assert.equal(parsePageFormulaFromQuote('z = x/yz', XY_VARS).status, 'unparseable');
  // Superscripts inside the quote are the frozen normalisation and parse completely:
  const sup = parsePageFormulaFromQuote('z = x/y²', XY_VARS);
  assert.equal(sup.status, 'parsed');
  if (sup.status === 'parsed' && sup.ast !== undefined) assert.ok(Math.abs(evaluate(sup.ast, { x: 8, y: 2 }) - 2) < 1e-12);
});

test('S6R-03: trailing prose is stripped only at explicit prose boundaries', () => {
  // ' where ', ' and ', comma, sentence end:
  assert.equal(parsePageFormulaFromQuote('V = a * t where a is the acceleration', [{ name: 'a', pageSymbol: 'a' }, { name: 't', pageSymbol: 't' }]).status, 'parsed');
  assert.equal(parsePageFormulaFromQuote('D = Cd * q * S, the drag force', [{ name: 'cd', pageSymbol: 'Cd' }, { name: 'q', pageSymbol: 'q' }, { name: 's', pageSymbol: 'S' }]).status, 'parsed');
  assert.equal(parsePageFormulaFromQuote('W = m * g and g is constant', [{ name: 'm', pageSymbol: 'm' }, { name: 'g', pageSymbol: 'g' }]).status, 'parsed');
  assert.equal(parsePageFormulaFromQuote('The drag equation states D = Cd * (rho * V^2 * A) / 2 exactly', [
    { name: 'cd', pageSymbol: 'Cd' }, { name: 'rho', pageSymbol: 'rho' }, { name: 'v', pageSymbol: 'V' }, { name: 'a', pageSymbol: 'A' },
  ]).status, 'parsed');
  // Words-only formula lines stay unparseable (bridge territory):
  assert.equal(parsePageFormulaFromQuote('the wing loading w equals the weight W divided by the area S', [{ name: 'wt', pageSymbol: 'W' }, { name: 'ar', pageSymbol: 'S' }]).status, 'unparseable');
  // A word-operator RHS is NOT truncated to its first symbol:
  assert.equal(parsePageFormulaFromQuote('w = W divided by S', [{ name: 'wt', pageSymbol: 'W' }, { name: 'ar', pageSymbol: 'S' }]).status, 'unparseable');
});

/* ------------------------------------------------------------------ */
/* S6R-04 — explicit source-example bindings, no permutation search    */
/* ------------------------------------------------------------------ */

const BRIDGE_TEXT = 'z equals x divided by y. With x = 6 and y = 3 the result is 2.';
const BRIDGE_EXAMPLE = { quote: 'With x = 6 and y = 3 the result is 2.', resultNumber: 2, tolerance: 0.001 };

test('S6R-04 formula-bridge-swaps-input-identities: y/x is rejected at the source-stated bindings', () => {
  const gen = probeFormula('z equals x divided by y', 'y/x', BRIDGE_EXAMPLE);
  const report = validateFormulaExplorer(gen, [reviewSource('formula', BRIDGE_TEXT)]);
  assert.ok(failingIds(report).includes('FE-05'), `expected FE-05 failure, got [${failingIds(report).join('|')}]`);
  assert.ok(failingIds(report).includes('FE-08'), 'without a verified FE-05 example the unparseable page formula must fail FE-08');
  assert.equal(report.publishable, false);
  // The comparison happens at the SOURCE bindings (x=6, y=3 → y/x = 0.5), not a swapped pair:
  assert.match(messageOf(report, 'FE-05'), /x=6.*y=3|x = 6.*y = 3/);
});

test('S6R-04: the stated result is never an input candidate and unbound numbers never become inputs', () => {
  // x*y at x=6,y=3 gives 18 ≠ 2; a permutation search using the result token would find 2*... no:
  const asInput = probeFormula('z equals x divided by y', 'x*y', BRIDGE_EXAMPLE);
  const r1 = validateFormulaExplorer(asInput, [reviewSource('formula', BRIDGE_TEXT)]);
  assert.ok(failingIds(r1).includes('FE-05'));
  // No explicit bindings at all ("The values 6 and 3 give the result 2"): the old permutation
  // search validated y/x = 2 by assigning y=6, x=3; explicit bindings refuse to guess:
  const unbound = probeFormula('z equals x divided by y', 'y/x', { quote: 'The values 6 and 3 give the result 2.', resultNumber: 2, tolerance: 0.001 });
  const r2 = validateFormulaExplorer(unbound, [reviewSource('formula', 'z equals x divided by y. The values 6 and 3 give the result 2.')]);
  assert.ok(failingIds(r2).includes('FE-05'), 'unbound quote numbers must not ground the expression');
  assert.ok(failingIds(r2).includes('FE-08'), 'an unbound example must not bridge FE-08');
  assert.equal(r2.publishable, false);
});

test('S6R-04: bindSourceExampleInputs supports the small explicit patterns, repeated equal values, and refuses ambiguity', () => {
  const vars = [{ name: 'x', pageSymbol: 'x' }, { name: 'y', pageSymbol: 'y' }];
  // 'x = 6' pattern:
  assert.deepEqual(bindSourceExampleInputs('With x = 6 and y = 3 the result is 2.', vars), { ok: true, bindings: { x: 6, y: 3 }, problems: [] });
  // 'x is 6' pattern:
  assert.deepEqual(bindSourceExampleInputs('Here x is 6 and y is 3.', vars), { ok: true, bindings: { x: 6, y: 3 }, problems: [] });
  // '6 for x' pattern:
  assert.deepEqual(bindSourceExampleInputs('The page uses 6 for x and 3 for y.', vars), { ok: true, bindings: { x: 6, y: 3 }, problems: [] });
  // pageSymbol binding maps to the variable NAME (W → wt):
  const wing = [{ name: 'wt', pageSymbol: 'W' }, { name: 'ar', pageSymbol: 'S' }];
  assert.deepEqual(bindSourceExampleInputs('With W = 6 and S = 3 the wing loading is 2.', wing), { ok: true, bindings: { wt: 6, ar: 3 }, problems: [] });
  // Repeated equal input values are supported:
  assert.deepEqual(bindSourceExampleInputs('With x = 3 and y = 3 the result is 1.', vars), { ok: true, bindings: { x: 3, y: 3 }, problems: [] });
  // Decimals and signs:
  assert.deepEqual(bindSourceExampleInputs('With x = 9.8 and y = -2 the result is -4.9.', vars), { ok: true, bindings: { x: 9.8, y: -2 }, problems: [] });
  // Missing binding → not ok:
  const missing = bindSourceExampleInputs('With x = 6 the result is 2.', vars);
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some(p => p.includes('y')));
  // Conflicting bindings → not ok (fail-closed, never pick the one that works):
  const conflict = bindSourceExampleInputs('With x = 6 and y = 3 and x = 3 the result is 2.', vars);
  assert.equal(conflict.ok, false);
  // The result statement itself never binds a non-variable symbol:
  assert.deepEqual(bindSourceExampleInputs('With x = 6 and y = 3 the result is 2.', vars).bindings, { x: 6, y: 3 });
});

test('S6R-04 controls: a correct expression bridges via explicit bindings, and repeated equal inputs pass end to end', () => {
  const correct = probeFormula('z equals x divided by y', 'x/y', BRIDGE_EXAMPLE);
  const r1 = validateFormulaExplorer(correct, [reviewSource('formula', BRIDGE_TEXT)]);
  assert.deepEqual(failingIds(r1), [], r1.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(r1.publishable, true);
  assert.match(messageOf(r1, 'FE-08'), /FE-05 bridge/);

  const repeated = probeFormula('z equals x divided by y', 'x/y', { quote: 'With x = 3 and y = 3 the result is 1.', resultNumber: 1, tolerance: 0.001 });
  const r2 = validateFormulaExplorer(repeated, [reviewSource('formula', 'z equals x divided by y. With x = 3 and y = 3 the result is 1.')]);
  assert.deepEqual(failingIds(r2), [], r2.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(r2.publishable, true);
});

test('controls: the reviewer\'s positive formula controls stay publishable', () => {
  const ok = validateFormulaExplorer(probeFormula('z = x/y'), [reviewSource('formula', 'z = x/y')]);
  assert.deepEqual(failingIds(ok), [], ok.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(ok.publishable, true);
  const wrong = validateFormulaExplorer(probeFormula('z = x/y', 'x*y'), [reviewSource('formula', 'z = x/y')]);
  assert.ok(failingIds(wrong).includes('FE-08'));
});

/* ------------------------------------------------------------------ */
/* S6R round-2 residuals — grouped numbers (S6R-03) and exponent        */
/* notation bindings (S6R-04): a numeric token is read COMPLETE or the  */
/* path fails closed; a prefix is never parsed or bound.                */
/* ------------------------------------------------------------------ */

test('S6R-03 formula-thousands-suffix: z = x+y+1,000 no longer parses as the prefix x+y+1', () => {
  const gen = probeFormula('z = x+y+1,000', 'x+y+1');
  const report = validateFormulaExplorer(gen, [reviewSource('formula', 'z = x+y+1,000')]);
  assert.ok(failingIds(report).includes('FE-08'), `expected FE-08 failure, got [${failingIds(report).join('|')}]`);
  assert.equal(report.publishable, false);
  assert.match(messageOf(report, 'FE-08'), /1006/, 'the page formula must evaluate as x+y+1000 (1006 at {x:2,y:4}), never 7');
  // The page parse reads the grouped number as ONE token with the value 1000:
  const attempt = parsePageFormulaFromQuote('z = x+y+1,000', XY_VARS);
  assert.equal(attempt.status, 'parsed');
  if (attempt.ast === undefined) throw new Error('expected an AST');
  assert.equal(evaluate(attempt.ast, { x: 2, y: 4 }), 1006);
});

test('S6R-03 control: a correct expression x+y+1000 for a grouped page formula stays publishable', () => {
  const gen = probeFormula('z = x+y+1,000', 'x+y+1000');
  const report = validateFormulaExplorer(gen, [reviewSource('formula', 'z = x+y+1,000')]);
  assert.deepEqual(failingIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(report.publishable, true);
});

test('S6R-03: grouped numbers are one token, prose commas still cut, and malformed groupings fail closed', () => {
  const xv = [{ name: 'x', pageSymbol: 'x' }];
  // Grouped decimal:
  const dec = parsePageFormulaFromQuote('C = x + 12,500.5', xv);
  assert.equal(dec.status, 'parsed');
  if (dec.ast === undefined) throw new Error('expected an AST');
  assert.equal(evaluate(dec.ast, { x: 2 }), 12502.5);
  // Multiple groups:
  const big = parsePageFormulaFromQuote('N = x + 1,000,000', xv);
  assert.equal(big.status, 'parsed');
  if (big.ast === undefined) throw new Error('expected an AST');
  assert.equal(evaluate(big.ast, { x: 1 }), 1000001);
  // A prose comma (not digit-comma-digit) still ends the formula line:
  const prose = parsePageFormulaFromQuote('V = a*t, where t is time', [{ name: 'a', pageSymbol: 'a' }, { name: 't', pageSymbol: 't' }]);
  assert.equal(prose.status, 'parsed');
  assert.equal(prose.rhs, 'a*t');
  // Malformed digit-comma-digit groupings are NOT prose boundaries and never parse as a prefix:
  for (const q of ['z = x+1,0000', 'z = x+3,14', 'z = x+2100,0000']) {
    const bad = parsePageFormulaFromQuote(q, XY_VARS);
    assert.equal(bad.status, 'unparseable', `${q} must fail closed, not parse a prefix`);
  }
});

test('S6R-03: the completeness edge check reads a thousands comma as a numeric continuation', () => {
  // Cropping the grouped number off the source formula is a cut at the right edge:
  const right = formulaCompletenessProblems('z = x+y+1', 'z = x+y+1', 'The page states z = x+y+1,000 in the offset table.');
  assert.ok(right.problems.length > 0, 'quoting z = x+y+1 from z = x+y+1,000 cuts a numeric token');
  // Quoting only the tail of the grouped number is a cut at the left edge:
  const left = formulaCompletenessProblems('000', '000', 'The offset is 1,000 units.');
  assert.ok(left.problems.length > 0);
  // The complete formula has clean edges:
  const full = formulaCompletenessProblems('z = x+y+1,000', 'z = x+y+1,000', 'The page states z = x+y+1,000 in the offset table.');
  assert.deepEqual(full.problems, []);
  // An ordinary prose comma after the formula stays a clean edge:
  const prose = formulaCompletenessProblems('z = x+y', 'z = x+y', 'The page states z = x+y, the offset total.');
  assert.deepEqual(prose.problems, []);
});

const EXP_BRIDGE_TEXT = 'z equals x divided by y. With x = 6e2 and y = 3 the result is 200.';
const EXP_EXAMPLE = { quote: 'With x = 6e2 and y = 3 the result is 200.', resultNumber: 200, tolerance: 0.001 };

test('S6R-04 formula-example-exponent-input: 100*x/y no longer binds the prefix 6 of 6e2', () => {
  const gen = probeFormula('z equals x divided by y', '100*x/y', EXP_EXAMPLE);
  const report = validateFormulaExplorer(gen, [reviewSource('formula', EXP_BRIDGE_TEXT)]);
  assert.ok(failingIds(report).includes('FE-05'), `expected FE-05 failure, got [${failingIds(report).join('|')}]`);
  assert.ok(failingIds(report).includes('FE-08'), 'a failed example must not bridge the unparseable page formula');
  assert.equal(report.publishable, false);
  assert.match(messageOf(report, 'FE-05'), /20000/, 'the recomputation must happen at x=600 (100*600/3 = 20000 ≠ 200)');
  // The binder reads the complete exponent-notation token, never the prefix:
  const bound = bindSourceExampleInputs(EXP_EXAMPLE.quote, XY_VARS);
  assert.equal(bound.ok, true, bound.problems.join('; '));
  assert.deepEqual(bound.bindings, { x: 600, y: 3 });
});

test('S6R-04 control: a correct expression x/y publishes via the exponent-notation binding', () => {
  const gen = probeFormula('z equals x divided by y', 'x/y', EXP_EXAMPLE);
  const report = validateFormulaExplorer(gen, [reviewSource('formula', EXP_BRIDGE_TEXT)]);
  assert.deepEqual(failingIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.equal(report.publishable, true);
});

test('S6R-04: the binder reads complete numeric tokens — e-notation by value, unsupported notations fail closed', () => {
  const vars = XY_VARS;
  // e-notation parses to its value (signed exponent, "for" pattern):
  assert.deepEqual(bindSourceExampleInputs('With x = 6E-3 and y = 3 the result is 0.002.', vars), { ok: true, bindings: { x: 0.006, y: 3 }, problems: [] });
  assert.deepEqual(bindSourceExampleInputs('The page uses 6e2 for x and 3 for y.', vars), { ok: true, bindings: { x: 600, y: 3 }, problems: [] });
  assert.deepEqual(bindSourceExampleInputs('With x = 6e-2 and y = 3 the result is 0.02.', vars), { ok: true, bindings: { x: 0.06, y: 3 }, problems: [] });
  // ×10^ / x 10^ / *10^ notations: fail closed, never bind the mantissa as a prefix:
  for (const q of ['With x = 6×10^2 and y = 3 the result is 200.', 'With x = 6 x 10^2 and y = 3 the result is 200.', 'With x = 6*10^2 and y = 3 the result is 200.', 'With x = 6×10² and y = 3 the result is 200.']) {
    const bad = bindSourceExampleInputs(q, vars);
    assert.equal(bad.ok, false, `${q} must fail closed`);
    assert.ok(bad.problems.some(p => p.includes('"x"')), q);
  }
  // Malformed exponent markers: fail closed, never bind 6:
  assert.equal(bindSourceExampleInputs('With x = 6e and y = 3 the result is 2.', vars).ok, false);
  assert.equal(bindSourceExampleInputs('With x = 6e+ and y = 3 the result is 2.', vars).ok, false);
  assert.equal(bindSourceExampleInputs('With x = 6e2e3 and y = 3 the result is 2.', vars).ok, false);
  // Thousands-grouped bindings still fail closed (never bind 1 from 1,000):
  assert.equal(bindSourceExampleInputs('With x = 1,000 and y = 3 the result is 2.', vars).ok, false);
  // Sentence periods and plain decimals still bind (positive controls):
  assert.deepEqual(bindSourceExampleInputs('Let x = 6. Then y = 3.', vars), { ok: true, bindings: { x: 6, y: 3 }, problems: [] });
  assert.deepEqual(bindSourceExampleInputs('With x = 9.8 and y = 3 the result is 2.', vars), { ok: true, bindings: { x: 9.8, y: 3 }, problems: [] });
});
