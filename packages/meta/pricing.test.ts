import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRICES_PER_MTOK, costFromUsage, reservationUSD } from './pricing.ts';
import type { Usage } from '../contracts/index.ts';

test('prices match the published Muse Spark Standard rates', () => {
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].input, 1.25);
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].cachedInput, 0.15);
  assert.equal(PRICES_PER_MTOK['muse-spark-1.3'].output, 4.25);
});

test('zero usage costs zero (exact)', () => {
  const usage: Usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 0);
});

test('known usage without cache gives an exact cost', () => {
  // 800000 * 1.25 = 1000000 exactly, and 1000000 / 1e6 = 1 exactly.
  // 1.25 (= 5/4) and the integers involved are exactly representable in
  // binary64, and the final quotient is the integer 1, so === is safe here.
  const usage: Usage = { promptTokens: 800000, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 1);
});

test('output-only usage gives an exact cost', () => {
  // 4000000 * 4.25 = 17000000 exactly, and 17000000 / 1e6 = 17 exactly.
  // 4.25 (= 17/4) is exactly representable, so === is safe here.
  const usage: Usage = { promptTokens: 0, completionTokens: 4000000, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', usage), 17);
});

test('cached usage matches hand-computed decimal value (tolerance)', () => {
  // Hand computation: ((1000 - 400) * 1.25 + 400 * 0.15 + 2000 * 4.25) / 1e6
  // = (750 + 60 + 8500) / 1e6 = 9310 / 1e6 = 0.00931.
  // 0.15 has no exact binary64 representation, and division by 1e6 (2^6 * 5^6)
  // introduces a factor of 5, so the binary64 result cannot equal the decimal
  // 0.00931 bit-for-bit; compare with a tight tolerance instead.
  // Reasoning tokens are already included in completionTokens, so the
  // reasoningTokens: 500 below must not change the result.
  const usage: Usage = { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 500, cachedTokens: 400 };
  const actual: number = costFromUsage('muse-spark-1.3', usage);
  assert.ok(Math.abs(actual - 0.00931) < 1e-12);
});

test('reservation covers the corresponding real cost', () => {
  // promptChars 3000 -> ceil(3000 / 3) = 1000 input tokens; maxOutput 2000.
  // Reservation: (1000 * 1.25 + 2000 * 4.25) / 1e6 = 9750 / 1e6 = 0.00975,
  // which must be >= the 0.00931 cost of the usage above (the cache discount
  // can only lower the real cost). Same binary64 caveat as above, so use a
  // tolerance for the absolute value but an exact >= for the comparison.
  const reservation: number = reservationUSD('muse-spark-1.3', 3000, 2000);
  assert.ok(Math.abs(reservation - 0.00975) < 1e-12);
  const usage: Usage = { promptTokens: 1000, completionTokens: 2000, reasoningTokens: 500, cachedTokens: 400 };
  const cost: number = costFromUsage('muse-spark-1.3', usage);
  assert.ok(reservation >= cost);
});

test('reservation rounds input tokens up with ceil', () => {
  // 10 chars -> ceil(10 / 3) = 4 tokens: (4 * 1.25) / 1e6 = 5e-6.
  // 5e-6 is not bit-exact in binary64, so compare with tolerance.
  const reservation: number = reservationUSD('muse-spark-1.3', 10, 0);
  assert.ok(Math.abs(reservation - 0.000005) < 1e-15);
});
