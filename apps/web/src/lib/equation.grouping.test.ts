/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { equationText, explorerEquation, engineEquation } from './equation.ts';

test('explorer equation: a large result is grouped (1,040,000), the substituted inputs too', () => {
  const eq = explorerEquation('0.5 * c * r * v^2 * a', ['c', 'r', 'v', 'a'], 'D', { c: 0.5, r: 1.3, v: 400, a: 10 }, 0.5 * 0.5 * 1.3 * 400 * 400 * 10);
  assert.ok(eq !== null);
  assert.equal(eq.result, '520,000');
  const big = explorerEquation('a * b', ['a', 'b'], 'y', { a: 20000, b: 52 }, 1040000);
  assert.ok(big !== null);
  assert.equal(big.result, '1,040,000');
  assert.match(equationText(big), /= 20,000 · 52 = 1,040,000$|= 20,000 \* 52 = 1,040,000$|20,000/);
});

test('explorer equation: small results are unchanged', () => {
  const eq = explorerEquation('a * b', ['a', 'b'], 'y', { a: 2, b: 3.5 }, 7);
  assert.ok(eq !== null);
  assert.equal(eq.result, '7');
});

test('engine equation: a large substituted input is grouped', () => {
  const eq = engineEquation('lift-equation-v1', { liftCoefficient: 0.5, airDensityKgM3: 1.2, airspeedMps: 250, wingAreaM2: 1200 });
  assert.ok(eq !== null);
  assert.match(equationText(eq), /1,200/);
  assert.doesNotMatch(equationText(eq), /\b1200\b/);
});
