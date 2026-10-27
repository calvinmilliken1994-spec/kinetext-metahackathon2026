/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { gradePrediction, parseGuess } from './predictions.ts';
import { accelerationOf } from '../../../../packages/activities/forces-1d/engine.ts';

test('exact guess is within tolerance', () => {
  const g = gradePrediction(3, accelerationOf(4, 12), 0.001);
  assert.equal(g.withinTolerance, true);
  assert.equal(g.direction, 'exact');
});

test('guess exactly at the tolerance edge passes (float slack)', () => {
  assert.equal(gradePrediction(3.001, 3, 0.001).withinTolerance, true);
  assert.equal(gradePrediction(2.999, 3, 0.001).withinTolerance, true);
});

test('guess just outside the tolerance fails and reports direction', () => {
  const hi = gradePrediction(3.0011, 3, 0.001);
  assert.equal(hi.withinTolerance, false);
  assert.equal(hi.direction, 'high');
  const lo = gradePrediction(2.9989, 3, 0.001);
  assert.equal(lo.withinTolerance, false);
  assert.equal(lo.direction, 'low');
});

test('non-terminating quotient: 1.6667 is within 0.001 of 10/6', () => {
  const actual = accelerationOf(6, 10);
  assert.equal(gradePrediction(1.6667, actual, 0.001).withinTolerance, true);
  assert.equal(gradePrediction(1.67, actual, 0.001).withinTolerance, false);
});

test('negative acceleration is graded by signed value', () => {
  assert.equal(gradePrediction(3, accelerationOf(3, -9), 0.001).withinTolerance, false);
  assert.equal(gradePrediction(-3, accelerationOf(3, -9), 0.001).withinTolerance, true);
});

test('parseGuess handles decimals, comma, unicode minus and rejects junk', () => {
  assert.equal(parseGuess(' 2.5 '), 2.5);
  assert.equal(parseGuess('2,5'), 2.5);
  assert.equal(parseGuess('\u22123'), -3);
  assert.equal(parseGuess('.5'), 0.5);
  assert.equal(parseGuess(''), null);
  assert.equal(parseGuess('abc'), null);
  assert.equal(parseGuess('1.2.3'), null);
  assert.equal(parseGuess('Infinity'), null);
});
