import { test } from 'node:test';
import assert from 'node:assert/strict';
import { remainingAfter } from './engine.ts';

test('whole half-lives halve exactly', () => {
  const i = { initialAmount: 100, halfLife: 5730 };
  assert.equal(remainingAfter({ ...i, elapsedTime: 0 }), 100);
  assert.equal(remainingAfter({ ...i, elapsedTime: 5730 }), 50);
  assert.equal(remainingAfter({ ...i, elapsedTime: 3 * 5730 }), 12.5);
});
test('fractional half-lives follow N0 * 0.5^(t/T)', () => {
  assert.ok(Math.abs(remainingAfter({ initialAmount: 80, halfLife: 8, elapsedTime: 4 }) - 56.5685424949) < 1e-9);
});
test('rejects invalid inputs with stable codes', () => {
  const ok = { initialAmount: 10, halfLife: 2, elapsedTime: 1 };
  assert.throws(() => remainingAfter({ ...ok, initialAmount: 0 }), /INITIAL_AMOUNT_NOT_POSITIVE/);
  assert.throws(() => remainingAfter({ ...ok, halfLife: 0 }), /HALF_LIFE_NOT_POSITIVE/);
  assert.throws(() => remainingAfter({ ...ok, elapsedTime: -1 }), /ELAPSED_TIME_NEGATIVE/);
});
