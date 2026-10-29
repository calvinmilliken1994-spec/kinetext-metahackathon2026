import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  META_PROVIDERS,
  MODEL_CHOICES,
  PRICES_PER_MTOK,
  costFromUsage,
  isMetaProvider,
  isModelChoice,
  reservationUSD,
} from './pricing.ts';
import type { ModelChoice } from './pricing.ts';
import type { Usage } from '../contracts/index.ts';

test('muse-spark-open prices match the frozen plan (1.25 / 0.15 / 4.25)', () => {
  assert.equal(PRICES_PER_MTOK['muse-spark-open'].input, 1.25);
  assert.equal(PRICES_PER_MTOK['muse-spark-open'].cachedInput, 0.15);
  assert.equal(PRICES_PER_MTOK['muse-spark-open'].output, 4.25);
});

test('MODEL_CHOICES and META_PROVIDERS order', () => {
  assert.deepStrictEqual([...MODEL_CHOICES], ['muse-spark-1.3', 'muse-spark-open']);
  assert.deepStrictEqual([...META_PROVIDERS], ['meta-api', 'modal']);
});

test('isModelChoice and isMetaProvider accept valid and reject invalid including proto keys', () => {
  assert.strictEqual(isModelChoice('muse-spark-1.3'), true);
  assert.strictEqual(isModelChoice('muse-spark-open'), true);
  assert.strictEqual(isModelChoice('bogus'), false);
  assert.strictEqual(isModelChoice('__proto__'), false);
  assert.strictEqual(isModelChoice('toString'), false);
  assert.strictEqual(isModelChoice(''), false);
  assert.strictEqual(isModelChoice(null), false);
  assert.strictEqual(isModelChoice(undefined), false);
  assert.strictEqual(isModelChoice(123), false);
  assert.strictEqual(isMetaProvider('meta-api'), true);
  assert.strictEqual(isMetaProvider('modal'), true);
  assert.strictEqual(isMetaProvider('bogus'), false);
  assert.strictEqual(isMetaProvider('__proto__'), false);
  assert.strictEqual(isMetaProvider('toString'), false);
  assert.strictEqual(isMetaProvider(null), false);
});

test('muse-spark-open cost matches price constants and literal 183/415/0', () => {
  const usage: Usage = { promptTokens: 183, completionTokens: 415, reasoningTokens: 0, cachedTokens: 0 };
  const actual: number = costFromUsage('muse-spark-open', usage);
  const fromConsts: number =
    (183 * PRICES_PER_MTOK['muse-spark-open'].input +
      415 * PRICES_PER_MTOK['muse-spark-open'].output) /
    1e6;
  assert.ok(Math.abs(actual - fromConsts) < 1e-12);
  assert.ok(Math.abs(actual - (183 * 1.25 + 415 * 4.25) / 1e6) < 1e-12);
  assert.strictEqual(actual, (183 * 1.25 + 415 * 4.25) / 1e6);
});

test('muse-spark-open reservation matches price constants', () => {
  const actual: number = reservationUSD('muse-spark-open', 1000, 2000);
  const expected: number =
    (1000 * PRICES_PER_MTOK['muse-spark-open'].input +
      2000 * PRICES_PER_MTOK['muse-spark-open'].output) /
    1e6;
  assert.ok(Math.abs(actual - expected) < 1e-12);
  assert.ok(Math.abs(actual - 0.00975) < 1e-12);
});

test('muse-spark-1.3 results unchanged', () => {
  const zero: Usage = { promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', zero), 0);
  const big: Usage = { promptTokens: 800000, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.strictEqual(costFromUsage('muse-spark-1.3', big), 1);
  assert.ok(Math.abs(reservationUSD('muse-spark-1.3', 1000, 2000) - 0.00975) < 1e-12);
});

test('UNKNOWN_MODEL for cast strings including __proto__ and toString', () => {
  const usage: Usage = { promptTokens: 10, completionTokens: 10, reasoningTokens: 0, cachedTokens: 0 };
  assert.throws(() => costFromUsage('bogus' as unknown as ModelChoice, usage), {
    message: 'UNKNOWN_MODEL',
  });
  assert.throws(() => costFromUsage('__proto__' as unknown as ModelChoice, usage), {
    message: 'UNKNOWN_MODEL',
  });
  assert.throws(() => costFromUsage('toString' as unknown as ModelChoice, usage), {
    message: 'UNKNOWN_MODEL',
  });
  assert.throws(() => reservationUSD('__proto__' as unknown as ModelChoice, 10, 10), {
    message: 'UNKNOWN_MODEL',
  });
  assert.throws(() => reservationUSD('toString' as unknown as ModelChoice, 10, 10), {
    message: 'UNKNOWN_MODEL',
  });
  assert.throws(() => reservationUSD('muse-spark-9.9' as unknown as ModelChoice, 10, 10), {
    message: 'UNKNOWN_MODEL',
  });
  assert.strictEqual(costFromUsage('muse-spark-open', usage) >= 0, true);
});

test('INVALID_USAGE and INVALID_AMOUNT preserved for both models', () => {
  const bad: Usage = { promptTokens: -1, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
  assert.throws(() => costFromUsage('muse-spark-1.3', bad), { message: 'INVALID_USAGE' });
  assert.throws(() => costFromUsage('muse-spark-open', bad), { message: 'INVALID_USAGE' });
  assert.throws(() => reservationUSD('muse-spark-1.3', NaN, 10), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-open', NaN, 10), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-open', 10, -1), { message: 'INVALID_AMOUNT' });
  assert.throws(() => reservationUSD('muse-spark-open', Infinity, 10), { message: 'INVALID_AMOUNT' });
});
