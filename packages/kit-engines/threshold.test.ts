import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fractionWords, requiredCount, stagePasses } from './threshold.ts';

test('majority of 538 is 270', () => {
  assert.equal(
    requiredCount({ total: 538, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0 }),
    270,
  );
});

test('three-fourths of 50 is 38', () => {
  assert.equal(
    requiredCount({ total: 50, rule: 'fraction', numerator: 3, denominator: 4, statedCount: 0 }),
    38,
  );
});

test('two-thirds of 100 is 67', () => {
  assert.equal(
    requiredCount({ total: 100, rule: 'fraction', numerator: 2, denominator: 3, statedCount: 0 }),
    67,
  );
});

test('count rule returns statedCount', () => {
  assert.equal(
    requiredCount({ total: 100, rule: 'count', numerator: 0, denominator: 0, statedCount: 60 }),
    60,
  );
});

test('stagePasses uses the required count', () => {
  const stage = { total: 538, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0 } as const;
  assert.equal(stagePasses(stage, 270), true);
  assert.equal(stagePasses(stage, 269), false);
  const frac = { total: 50, rule: 'fraction', numerator: 3, denominator: 4, statedCount: 0 } as const;
  assert.equal(stagePasses(frac, 38), true);
  assert.equal(stagePasses(frac, 37), false);
});

test('fractionWords covers named fractions plus n/d', () => {
  assert.deepEqual(fractionWords(2, 3), ['two-thirds', 'two thirds', '2/3']);
  const w34 = fractionWords(3, 4);
  assert.ok(w34.includes('three-fourths'));
  assert.ok(w34.includes('three fourths'));
  assert.ok(w34.includes('three-quarters'));
  assert.ok(w34.includes('three quarters'));
  assert.ok(w34.includes('3/4'));
  const half = fractionWords(1, 2);
  assert.ok(half.includes('half'));
  assert.ok(half.includes('one-half'));
  assert.ok(half.includes('one half'));
  assert.ok(half.includes('a half'));
  assert.ok(half.includes('1/2'));
  assert.deepEqual(fractionWords(2, 5), ['two-fifths', 'two fifths', '2/5']);
  assert.deepEqual(fractionWords(3, 5), ['three-fifths', 'three fifths', '3/5']);
  assert.deepEqual(fractionWords(3, 11), ['3/11']);
});

test('fractionWords covers one..nine over halves..tenths', () => {
  const w15 = fractionWords(1, 5);
  assert.ok(w15.includes('one-fifth'));
  assert.ok(w15.includes('one fifth'));
  assert.ok(w15.includes('1/5'));
  const w23 = fractionWords(2, 3);
  assert.ok(w23.includes('two-thirds'));
  assert.ok(w23.includes('two thirds'));
  assert.ok(w23.includes('2/3'));
  const w34 = fractionWords(3, 4);
  assert.ok(w34.includes('three-quarters'));
  assert.ok(w34.includes('three-fourths'));
  assert.ok(w34.includes('3/4'));
  const w13 = fractionWords(1, 3);
  assert.ok(w13.includes('one-third'));
  assert.ok(w13.includes('a third'));
  assert.ok(w13.includes('1/3'));
  const w710 = fractionWords(7, 10);
  assert.ok(w710.includes('seven-tenths'));
  assert.ok(w710.includes('seven tenths'));
  assert.ok(w710.includes('7/10'));
  const w14 = fractionWords(1, 4);
  assert.ok(w14.includes('one-quarter'));
  assert.ok(w14.includes('one-fourth'));
  assert.ok(w14.includes('1/4'));
  const w32 = fractionWords(3, 2);
  assert.ok(w32.includes('three-halves'));
  assert.ok(w32.includes('3/2'));
});

test('invalid threshold inputs throw', () => {
  assert.throws(
    () =>
      requiredCount({ total: 0, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0 }),
    /THRESHOLD_INVALID/,
  );
  assert.throws(
    () => requiredCount({ total: 100, rule: 'count', numerator: 0, denominator: 0, statedCount: 0 }),
    /THRESHOLD_INVALID/,
  );
  assert.throws(
    () =>
      stagePasses(
        { total: 100, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0 },
        101,
      ),
    /THRESHOLD_INVALID/,
  );
  assert.throws(
    () =>
      stagePasses(
        { total: 100, rule: 'majority', numerator: 0, denominator: 0, statedCount: 0 },
        -1,
      ),
    /THRESHOLD_INVALID/,
  );
  assert.throws(() => fractionWords(2, 0), /THRESHOLD_INVALID/);
});

test('Set A (B2-04b): a fraction above 1 throws instead of requiring more votes than exist', () => {
  assert.throws(() => requiredCount({ total: 10, rule: 'fraction', numerator: 5, denominator: 4, statedCount: 0 }), /fraction must be at most 1/);
  assert.equal(requiredCount({ total: 10, rule: 'fraction', numerator: 4, denominator: 4, statedCount: 0 }), 10);
});
