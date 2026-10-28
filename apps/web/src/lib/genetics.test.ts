/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { alleleQ, formatFrequency, frequenciesSumToOne, genotypeBars, GENOTYPE_LABELS, heterozygoteCurve } from './genetics.ts';

const close = (a: number, b: number, eps = 1e-12): void => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

test('genotypeBars(0.3): p², 2pq, q² with generic AA/Aa/aa labels, the checked output flagged', () => {
  const bars = genotypeBars(0.3);
  assert.deepEqual(bars.map((b) => b.label), ['AA', 'Aa', 'aa']);
  assert.deepEqual(GENOTYPE_LABELS, { homozygousP: 'AA', heterozygous: 'Aa', homozygousQ: 'aa' });
  assert.deepEqual(bars.map((b) => b.formula), ['p²', '2pq', 'q²']);
  close(bars[0]?.frequency ?? Number.NaN, 0.09);
  close(bars[1]?.frequency ?? Number.NaN, 0.42);
  close(bars[2]?.frequency ?? Number.NaN, 0.49);
  assert.deepEqual(bars.map((b) => b.checked), [false, true, false]);
  assert.equal(frequenciesSumToOne(bars), true);
});

test('genotypeBars: the extremes p = 0 and p = 1 (one allele fixed)', () => {
  assert.deepEqual(genotypeBars(0).map((b) => b.frequency), [0, 0, 1]);
  assert.deepEqual(genotypeBars(1).map((b) => b.frequency), [1, 0, 0]);
});

test('genotypeBars: p = 0.5 puts the heterozygote at its 0.5 peak', () => {
  const bars = genotypeBars(0.5);
  assert.deepEqual(bars.map((b) => b.frequency), [0.25, 0.5, 0.25]);
});

test('genotypeBars: an out-of-range p gives no bars and does not sum to one', () => {
  assert.deepEqual(genotypeBars(1.2), []);
  assert.deepEqual(genotypeBars(-0.1), []);
  assert.deepEqual(genotypeBars(Number.NaN), []);
  assert.equal(frequenciesSumToOne([]), false);
});

test('frequencies sum to 1 for every p on a fine grid', () => {
  for (let i = 0; i <= 100; i++) assert.equal(frequenciesSumToOne(genotypeBars(i / 100)), true, `p=${i / 100}`);
});

test('alleleQ = 1 - p', () => {
  close(alleleQ(0.3), 0.7);
  assert.equal(alleleQ(0), 1);
  assert.equal(alleleQ(1), 0);
});

test('heterozygoteCurve: 2pq against p, zero at both ends, peak 0.5 at p = 0.5, symmetric', () => {
  const c = heterozygoteCurve(100);
  assert.equal(c.length, 101);
  assert.deepEqual(c[0], { p: 0, h: 0 });
  assert.deepEqual(c[100], { p: 1, h: 0 });
  assert.deepEqual(c[50], { p: 0.5, h: 0.5 });
  const max = Math.max(...c.map((pt) => pt.h));
  assert.equal(max, 0.5);
  assert.equal(c.find((pt) => pt.h === max)?.p, 0.5);
  for (let i = 0; i <= 100; i++) close(c[i]?.h ?? Number.NaN, c[100 - i]?.h ?? Number.NaN);
});

test('heterozygoteCurve with a tiny step count still includes both ends', () => {
  assert.deepEqual(heterozygoteCurve(2).map((pt) => pt.p), [0, 0.5, 1]);
  assert.deepEqual(heterozygoteCurve(0).map((pt) => pt.p), [0, 1]);
});

test('formatFrequency: up to four decimals, no float noise, no trailing zeros', () => {
  assert.equal(formatFrequency(0.42), '0.42');
  assert.equal(formatFrequency(0.17999999999999997), '0.18');
  assert.equal(formatFrequency(0.0475), '0.0475');
  assert.equal(formatFrequency(0), '0');
  assert.equal(formatFrequency(1), '1');
  assert.equal(formatFrequency(Number.NaN), 'NaN');
});
