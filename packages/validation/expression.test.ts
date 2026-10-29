// S6-V — expression parser/evaluator tests: the frozen grammar vectors of design §2.7(d) plus
// the task-required vectors (precedence, unary minus, ^ right-associativity, functions, constants,
// reserved names, malformed input, huge exponents, division by zero). No eval/Function anywhere.
// Run: node --test packages/validation/expression.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  astNodeCount,
  canonicalAst,
  astStructurallyEqual,
  astVariables,
  canonicalString,
  evaluate,
  evalExpression,
  lexExpression,
  normalizeExpression,
  normalizePageFormula,
  parseExpression,
  parsePageFormula,
  sliderSamplePoints,
} from './expression.ts';

function ev(expr: string, vars: Record<string, number> = {}): number {
  const parsed = parseExpression(expr);
  assert.equal(parsed.ok, true, `expected "${expr}" to parse: ${parsed.ok ? '' : parsed.error}`);
  return evaluate(parsed.ast, vars);
}

function parseError(expr: string, vars?: readonly string[]): string {
  const parsed = parseExpression(expr, vars === undefined ? {} : { knownVariables: vars });
  assert.equal(parsed.ok, false, `expected "${expr}" to be rejected`);
  return parsed.ok ? '' : parsed.error;
}

/* ---------------- the design's exact grammar vectors ---------------- */

test('design grammar vectors (§2.7d)', () => {
  assert.equal(ev('2+3*4'), 14);
  assert.equal(ev('-x^2', { x: 3 }), -9); // ^ binds tighter than unary minus
  assert.equal(ev('2^-1'), 0.5); // unary right operand allowed
  assert.equal(ev('2^3^2'), 512); // right-associative: 2^(3^2)
  assert.equal(ev('sqrt(4)'), 2);
  assert.equal(ev('log(e)'), 1); // natural log, e constant
  assert.equal(ev('sin(0)'), 0);
  assert.equal(ev('cos(0)'), 1);
  assert.equal(ev('tan(0)'), 0);
  assert.equal(ev('1e5'), 100000); // longest match: 1e5 is ONE number
  assert.ok(Number.isNaN(ev('1/0'))); // ÷0 is a domain error → NaN, never Infinity
  assert.ok(Number.isNaN(ev('sqrt(-1)')));
});

test('precedence and associativity', () => {
  assert.equal(ev('1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('10-2-3'), 5); // left-assoc subtraction
  assert.equal(ev('12/3/2'), 2); // left-assoc division
  assert.equal(ev('2*3^2'), 18); // ^ tighter than *
  assert.equal(ev('-(3)^2'), -9);
  assert.equal(ev('-(-3)'), 3);
  assert.equal(ev('2^2^3'), 256); // 2^(2^3)
});

test('functions and constants', () => {
  assert.equal(ev('pi'), Math.PI);
  assert.equal(ev('e'), Math.E);
  assert.ok(Math.abs(ev('exp(1)') - Math.E) < 1e-12);
  assert.ok(Math.abs(ev('sqrt(2)^2') - 2) < 1e-12);
  assert.ok(Math.abs(ev('sin(pi/2)') - 1) < 1e-12);
  assert.ok(Math.abs(ev('cos(pi)') + 1) < 1e-12);
  assert.ok(Math.abs(ev('log(1)')) < 1e-12);
});

test('domain errors yield NaN, never Infinity', () => {
  assert.ok(Number.isNaN(ev('1/0')));
  assert.ok(Number.isNaN(ev('-1/0')));
  assert.ok(Number.isNaN(ev('0/0')));
  assert.ok(Number.isNaN(ev('log(0)')));
  assert.ok(Number.isNaN(ev('log(-2)')));
  assert.ok(Number.isNaN(ev('sqrt(0-1)')));
  assert.ok(Number.isNaN(ev('0^-1'))); // 0^negative
  assert.ok(Number.isNaN(ev('1e200*1e200'))); // overflow → NaN
  assert.ok(Number.isNaN(ev('x+1', { x: NaN })));
  assert.ok(Number.isNaN(ev('x', {}))); // missing variable
});

test('huge exponents: |exponent| > 100 is a domain error', () => {
  assert.ok(Number.isNaN(ev('2^101')));
  assert.ok(Number.isNaN(ev('2^-101')));
  assert.equal(ev('2^100'), Math.pow(2, 100)); // boundary is allowed
});

/* ---------------- lexer: longest match, reserved names, malformed input ---------------- */

test('1e5 is a number while bare e is the constant; e5 and 1e are rejected', () => {
  const lexed = lexExpression(normalizeExpression('1e5'));
  assert.equal(lexed.ok, true);
  if (lexed.ok) {
    assert.deepEqual(lexed.tokens.map(t => [t.type, t.value]), [['number', '1e5']]);
  }
  assert.equal(ev('e'), Math.E);
  // e5 lexes as the identifier e5 — an unknown name, rejected at validation.
  assert.match(parseError('e5', []), /unknown name "e5"/);
  // 1e is number(1) followed by constant e: juxtaposition → implicit multiplication → rejected.
  assert.match(parseError('1e'), /implicit multiplication/);
});

test('reserved names are never variables', () => {
  for (const constant of ['pi', 'e']) {
    // Even when "declared" as a known variable, a constant name lexes as the constant.
    const parsed = parseExpression(constant, { knownVariables: [constant] });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.ast.kind, 'const', `"${constant}" must parse as the constant`);
  }
  for (const fn of ['sqrt', 'exp', 'log', 'sin', 'cos', 'tan']) {
    const parsed = parseExpression(`${fn}(1)`, { knownVariables: [fn] });
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.ast.kind, 'call', `"${fn}" must parse as a function call`);
  }
  assert.match(parseError('pi(2)'), /unexpected|must be followed/); // pi is not a function
  assert.match(parseError('sqrt'), /followed by|ended|\(/); // a bare function name needs "("
});

test('malformed input is rejected with a plain-language error', () => {
  assert.match(parseError(''), /empty/);
  assert.match(parseError('(1+'), /ended unexpectedly|unexpected token/);
  assert.match(parseError('(1+2'), /missing "\)"/);
  assert.match(parseError('1+'), /ended unexpectedly/);
  assert.match(parseError('*2'), /unexpected token/);
  assert.equal(ev('2 3'), 23); // whitespace is IGNORED, so "2 3" is the number 23
  assert.match(parseError('2 sqrt(4)'), /implicit multiplication/);
  assert.match(parseError('2x', ['x']), /implicit multiplication/);
  assert.match(parseError('x', []), /unknown name "x"/);
  assert.match(parseError('2**3'), /\*\*/); // ** rejected in the final expression form
  assert.match(parseError('V^2'), /unexpected character "V"/); // uppercase is not final-form ASCII
  assert.match(parseError('a$(b)'), /unexpected character/);
});

test('implicit multiplication is rejected everywhere', () => {
  assert.match(parseError('2(x+1)'), /implicit multiplication/);
  assert.match(parseError('(x+1)(x-1)', ['x']), /implicit multiplication/);
  assert.match(parseError('x (y)', ['x', 'y']), /implicit multiplication/);
});

test('AST node budget (50) aborts parsing', () => {
  const long = Array.from({ length: 40 }, () => 'v').join('+'); // 40 leaves + 39 ops = 79 nodes
  assert.match(parseError(long, ['v']), /50-node budget/);
  const ok = Array.from({ length: 25 }, () => 'v').join('+'); // 49 nodes
  const parsed = parseExpression(ok, { knownVariables: ['v'] });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.ok(astNodeCount(parsed.ast) <= 50);
});

/* ---------------- normalisation ---------------- */

test('page normalisation: ×·∙ → *, ** → ^, unicode minus, superscripts, whitespace', () => {
  assert.equal(normalizePageFormula('Cd × V**2'), 'Cd*V^2');
  assert.equal(normalizePageFormula('rho · V − 1'), 'rho*V-1');
  assert.equal(normalizePageFormula('V² + A³'), 'V^2+A^3');
  assert.equal(normalizePageFormula(' a  +\tb '), 'a+b');
  assert.equal(normalizePageFormula('x⁻¹'), 'x^-1');
  // The expression field keeps '**' illegal (final form must use ^).
  assert.equal(normalizeExpression('2**3'), '2**3');
  assert.equal(normalizeExpression('2 × 3'), '2*3');
});

test('page formulas parse after normalisation', () => {
  const parsed = parsePageFormula('Cd × V**2', { knownVariables: ['cd', 'v'] });
  // Uppercase page symbols are mapped by the FE-08 caller before parsing; the parser itself is strict.
  assert.equal(parsed.ok, false);
  const ok = parsePageFormula('cd*v^2', { knownVariables: ['cd', 'v'] });
  assert.equal(ok.ok, true);
  const sup = parsePageFormula('V²'.replace('V', 'v'), { knownVariables: ['v'] });
  assert.equal(sup.ok, true);
  if (sup.ok) assert.equal(evaluate(sup.ast, { v: 3 }), 9);
});

/* ---------------- structural helpers ---------------- */

test('astVariables collects declared-use set in first-appearance order', () => {
  const parsed = parseExpression('a+b*c^2-a/d', { knownVariables: ['a', 'b', 'c', 'd'] });
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(astVariables(parsed.ast), ['a', 'b', 'c', 'd']);
});

test('canonical form sorts commutative operands; structural equality', () => {
  const l = parseExpression('a*b+c', { knownVariables: ['a', 'b', 'c'] });
  const r = parseExpression('c+b*a', { knownVariables: ['a', 'b', 'c'] });
  assert.equal(l.ok && r.ok, true);
  if (l.ok && r.ok) {
    assert.equal(astStructurallyEqual(l.ast, r.ast), true);
    assert.equal(canonicalString(canonicalAst(l.ast)), canonicalString(canonicalAst(r.ast)));
  }
  const s = parseExpression('a-b', { knownVariables: ['a', 'b'] });
  const t = parseExpression('b-a', { knownVariables: ['a', 'b'] });
  if (s.ok && t.ok) assert.equal(astStructurallyEqual(s.ast, t.ast), false);
});

test('sliderSamplePoints spreads 5 deterministic points over every range', () => {
  const points = sliderSamplePoints([{ name: 'v', min: 1, max: 100 }, { name: 'a', min: 0, max: 10 }]);
  assert.equal(points.length, 5);
  assert.deepEqual(Object.keys(points[0] as Record<string, number>).sort(), ['a', 'v']);
  assert.ok(Math.abs((points[0] as Record<string, number>).v - 10.9) < 1e-9);
  assert.ok(Math.abs((points[4] as Record<string, number>).a - 9) < 1e-9);
});

test('evalExpression convenience wrapper', () => {
  assert.equal(evalExpression('2+2', {}), 4);
  assert.ok(Number.isNaN(evalExpression('???', {})));
});
