/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { astNodeCount, astVariables, evaluate, evalExpression, normalizeFormula, parseFormula } from './formula.ts';

const close = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// Grammar vectors from the frozen design (§2.7): input | vars | expected.
const VECTORS: [string, Record<string, number>, number][] = [
  ['2+3*4', {}, 14],
  ['-x^2', { x: 3 }, -9],
  ['2^-1', {}, 0.5],
  ['2^3^2', {}, 512],
  ['sqrt(4)', {}, 2],
  ['log(e)', {}, 1],
  ['sin(0)', {}, 0],
  ['cos(0)', {}, 1],
  ['tan(0)', {}, 0],
  ['1e5', {}, 100000],
];

for (const [src, vars, expected] of VECTORS) {
  test(`grammar vector: ${src}`, () => {
    assert.ok(close(evalExpression(src, vars), expected), `${src} = ${evalExpression(src, vars)}`);
  });
}

test('domain errors give NaN, never a thrown error or Infinity', () => {
  for (const src of ['1/0', 'sqrt(-1)', 'log(0)', 'log(-2)', '0^-1', '(-8)^0.5', 'exp(1000)', '10^100*10^100*10^100*10^100']) {
    assert.ok(Number.isNaN(evalExpression(src, {})), src);
  }
  assert.ok(Number.isNaN(evalExpression('1/x', { x: 0 })));
});

test('more arithmetic: precedence, parentheses, unary minus, constants', () => {
  assert.equal(evalExpression('(1+2)*3', {}), 9);
  assert.equal(evalExpression('2*-3', {}), -6);
  assert.equal(evalExpression('--2', {}), 2);
  assert.equal(evalExpression('x^2', { x: -2 }), 4);
  assert.equal(evalExpression('10-4-3', {}), 3);
  assert.equal(evalExpression('100/10/5', {}), 2);
  assert.ok(close(evalExpression('pi', {}), Math.PI));
  assert.equal(evalExpression('exp(0)', {}), 1);
  assert.equal(evalExpression('.5+1.', {}), 1.5);
});

test('the drag expression evaluates', () => {
  const p = parseFormula('cd * (rho * v^2 * a) / 2', ['cd', 'rho', 'v', 'a']);
  assert.ok(p.ok);
  assert.equal(evaluate(p.ast, { cd: 0.5, rho: 1.2, v: 10, a: 1 }), 30);
});

test('normalisation: times signs, unicode minus, superscripts and ** all become the final form', () => {
  assert.equal(normalizeFormula('2×3·4∙5'), '2*3*4*5');
  assert.equal(normalizeFormula('a−b'), 'a-b');
  assert.equal(normalizeFormula('x²'), 'x^2');
  assert.equal(normalizeFormula('x⁻¹'), 'x^-1');
  assert.equal(normalizeFormula('x³⁴'), 'x^34');
  assert.equal(normalizeFormula('x**2'), 'x^2');
  assert.equal(evalExpression('x**2', { x: 3 }), 9);
  assert.equal(evalExpression('3×x', { x: 2 }), 6);
});

test('rejected inputs: implicit multiplication, bad names, bad syntax', () => {
  const bad = ['2x', '2 x', 'x y', '2(3)', 'e5', '1e', 'foo(1)', 'sqrt 4', 'sqrt()', 'sqrt(1,2)', '1+', '(1', '1)', '', '   ', '+1', 'x', '1..2', '2^', 'y+1', 'é', 'X+1'];
  for (const src of bad) {
    const p = parseFormula(src, ['a']);
    assert.equal(p.ok, false, `should reject ${JSON.stringify(src)}`);
  }
});

test('"2 e5" stays a syntax error even though "2e5" is a number', () => {
  assert.equal(parseFormula('2e5', []).ok, true);
  assert.equal(parseFormula('2 e5', []).ok, false);
});

test('reserved names cannot be variables, and unknown names are rejected', () => {
  assert.equal(parseFormula('sqrt+1', ['sqrt']).ok, false);
  assert.equal(parseFormula('e+1', ['e']).ok, false);
  const p = parseFormula('q+1', ['a']);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.code, 'UNKNOWN_NAME');
});

test('limits: 120 characters, 50 nodes, exponents up to 100', () => {
  const long = '1+'.repeat(60) + '1';
  const tooLong = parseFormula(long, []);
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.code, 'TOO_LONG');
  const wide = parseFormula(Array.from({ length: 26 }, () => 'a').join('+'), ['a']);
  assert.equal(wide.ok, false, '26 variables + 25 plus signs is 51 nodes');
  if (!wide.ok) assert.equal(wide.code, 'TOO_COMPLEX');
  assert.equal(parseFormula(Array.from({ length: 25 }, () => 'a').join('+'), ['a']).ok, true, '49 nodes passes');
  assert.equal(parseFormula('2^100', []).ok, true);
  assert.equal(parseFormula('2^101', []).ok, false);
  assert.equal(parseFormula('2^-101', []).ok, false);
  assert.ok(Number.isNaN(evalExpression('a^b', { a: 2, b: 101 })), 'a computed exponent past 100 is not defined');
});

test('ast helpers', () => {
  const p = parseFormula('cd * (rho * v^2) / 2', ['cd', 'rho', 'v', 'unused']);
  assert.ok(p.ok);
  assert.deepEqual([...astVariables(p.ast)].sort(), ['cd', 'rho', 'v']);
  assert.equal(astNodeCount(p.ast), p.nodes);
});

test('the evaluator never uses eval or Function', () => {
  const src = readFileSync(new URL('./formula.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/\beval\s*\(/.test(src), false);
  assert.equal(/\bnew\s+Function\b|\bFunction\s*\(/.test(src), false);
  assert.equal(/\bimport\s*\(/.test(src), false);
});
