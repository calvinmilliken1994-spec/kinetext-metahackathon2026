import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountAfter, balanceAt } from './engine.ts';

test('CFPB-style example: $1,000 at 5% compounded yearly for 10 years', () => {
  assert.equal(Math.round(amountAfter({ principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10 }) * 100) / 100, 1628.89);
});
test('monthly compounding beats yearly at the same rate', () => {
  const y = amountAfter({ principalUSD: 1000, annualRatePercent: 6, compoundsPerYear: 1, years: 5 });
  const m = amountAfter({ principalUSD: 1000, annualRatePercent: 6, compoundsPerYear: 12, years: 5 });
  assert.ok(m > y); assert.equal(Math.round(m * 100) / 100, 1348.85);
});
test('0% rate or 0 years returns the principal exactly', () => {
  assert.equal(amountAfter({ principalUSD: 250, annualRatePercent: 0, compoundsPerYear: 4, years: 30 }), 250);
  assert.equal(amountAfter({ principalUSD: 250, annualRatePercent: 7, compoundsPerYear: 4, years: 0 }), 250);
});
test('balanceAt(t) follows the same curve and clamps negative time', () => {
  const i = { principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10 };
  assert.equal(balanceAt(i, 10), amountAfter(i)); assert.equal(balanceAt(i, -3), 1000);
});
test('rejects invalid inputs with stable codes', () => {
  const ok = { principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10 };
  assert.throws(() => amountAfter({ ...ok, principalUSD: 0 }), /PRINCIPAL_NOT_POSITIVE/);
  assert.throws(() => amountAfter({ ...ok, annualRatePercent: -1 }), /RATE_NEGATIVE/);
  assert.throws(() => amountAfter({ ...ok, compoundsPerYear: 0.5 }), /COMPOUNDS_BELOW_ONE/);
  assert.throws(() => amountAfter({ ...ok, years: Number.NaN }), /YEARS_NEGATIVE/);
});
