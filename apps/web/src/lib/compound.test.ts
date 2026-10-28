/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountAfter, balanceAt } from '../../../../packages/activities/compound-interest-v1/engine.ts';
import {
  COMPOUNDING_PRESETS, compoundEquation, compoundSubstitution, compoundingName, compoundingStops, formatMoney, formatUSD,
  growthPoints, interestEarned, stopIndex,
} from './compound.ts';

const BASE = { principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10 };

test('compoundingStops: the presets 1, 2, 4, 12, 365 when the spec range allows them', () => {
  assert.deepEqual([...COMPOUNDING_PRESETS], [1, 2, 4, 12, 365]);
  assert.deepEqual(compoundingStops(1, 365), [1, 2, 4, 12, 365]);
  assert.deepEqual(compoundingStops(1, 12), [1, 2, 4, 12]);
  assert.deepEqual(compoundingStops(1, 4), [1, 2, 4]);
  assert.deepEqual(compoundingStops(2, 12), [2, 4, 12]);
  assert.deepEqual(compoundingStops(1.5, 12.5), [2, 4, 12]);
});

test('compoundingStops: whole-number steps when fewer than two presets fit', () => {
  assert.deepEqual(compoundingStops(5, 9), [5, 6, 7, 8, 9]);
  assert.deepEqual(compoundingStops(1, 1), [1]);
  assert.deepEqual(compoundingStops(3, 3.9), [3]);
  // a single preset in range (12) is not a usable choice list, so every whole number is offered
  assert.deepEqual(compoundingStops(10, 14), [10, 11, 12, 13, 14]);
});

test('compoundingStops keeps a value outside the stop list (a prediction can set n = 3) so the slider never lies', () => {
  assert.deepEqual(compoundingStops(1, 12, 3), [1, 2, 3, 4, 12]);
  assert.deepEqual(compoundingStops(1, 12, 4), [1, 2, 4, 12]);
  assert.deepEqual(compoundingStops(1, 12, 20), [1, 2, 4, 12, 20]);
  assert.deepEqual(compoundingStops(1, 12, Number.NaN), [1, 2, 4, 12]);
});

test('compoundingStops always returns at least one stop, even for an inverted range', () => {
  const s = compoundingStops(9, 2);
  assert.ok(s.length >= 1);
  assert.ok(s.every(Number.isFinite));
});

test('stopIndex finds the exact stop, else the nearest', () => {
  assert.equal(stopIndex([1, 2, 4, 12, 365], 12), 3);
  assert.equal(stopIndex([1, 2, 4, 12, 365], 365), 4);
  assert.equal(stopIndex([1, 2, 4, 12, 365], 5), 2);
  assert.equal(stopIndex([], 5), 0);
});

test('compoundingName: everyday names for the common periods, a plain count otherwise', () => {
  assert.equal(compoundingName(1), 'once a year');
  assert.equal(compoundingName(2), 'twice a year');
  assert.equal(compoundingName(4), 'quarterly');
  assert.equal(compoundingName(12), 'monthly');
  assert.equal(compoundingName(365), 'daily');
  assert.equal(compoundingName(3), '3 times a year');
});

test('formatUSD / formatMoney always show cents and group thousands', () => {
  assert.equal(formatUSD(1628.894626777442), '$1,628.89');
  assert.equal(formatUSD(0), '$0.00');
  assert.equal(formatUSD(5), '$5.00');
  assert.equal(formatUSD(1000000000), '$1,000,000,000.00');
  assert.equal(formatUSD(-5.5), '-$5.50');
  assert.equal(formatUSD(Number.NaN), 'NaN');
  assert.equal(formatMoney(1628.894626777442), '1,628.89');
  assert.equal(formatMoney(12345678.9), '12,345,678.90');
  assert.equal(formatMoney(-0.001), '0.00');
});

test('growthPoints: balance over 0..years from the engine curve, ending exactly on the engine amount', () => {
  const pts = growthPoints(BASE, 10, 20);
  assert.equal(pts.length, 21);
  assert.deepEqual(pts[0], { t: 0, balance: 1000 });
  assert.equal(pts[20]?.t, 10);
  assert.equal(pts[20]?.balance, amountAfter(BASE));
  assert.equal(pts[10]?.balance, balanceAt(BASE, 5));
  for (let i = 1; i < pts.length; i++) assert.ok((pts[i]?.balance ?? 0) >= (pts[i - 1]?.balance ?? 0));
});

test('growthPoints: zero years is a single starting point; a rejected input gives no points', () => {
  assert.deepEqual(growthPoints(BASE, 0, 20), [{ t: 0, balance: 1000 }]);
  assert.deepEqual(growthPoints({ ...BASE, principalUSD: 0 }, 10, 20), []);
  assert.deepEqual(growthPoints({ ...BASE, compoundsPerYear: 0 }, 10, 20), []);
  assert.deepEqual(growthPoints(BASE, Number.NaN, 20), []);
});

test('growthPoints at 0% grows nothing: the interest portion is empty', () => {
  const pts = growthPoints({ ...BASE, annualRatePercent: 0 }, 10, 5);
  assert.ok(pts.every((p) => p.balance === 1000));
});

test('interestEarned = balance - principal, never negative', () => {
  assert.ok(Math.abs(interestEarned(1000, 1628.894626777442) - 628.894626777442) < 1e-9);
  assert.equal(interestEarned(1000, 1000), 0);
  assert.equal(interestEarned(1000, 999.9999999999), 0);
});

test('equation text: general form and the form with this activity numbers substituted', () => {
  assert.equal(compoundEquation(), 'A = P × (1 + r/(100·n))^(n·t)');
  assert.equal(compoundSubstitution(BASE), 'A = $1,000.00 × (1 + 5/(100·1))^(1·10)');
  assert.equal(
    compoundSubstitution({ principalUSD: 2000, annualRatePercent: 6.5, compoundsPerYear: 12, years: 2.5 }),
    'A = $2,000.00 × (1 + 6.5/(100·12))^(12·2.5)',
  );
});
