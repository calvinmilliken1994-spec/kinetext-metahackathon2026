import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heterozygoteFrequencyOf, genotypeFrequencies } from './engine.ts';

test('2pq: p = 0.5 gives the maximum 0.5; p = 0 and 1 give 0', () => {
  assert.equal(heterozygoteFrequencyOf(0.5), 0.5);
  assert.equal(heterozygoteFrequencyOf(0), 0);
  assert.equal(heterozygoteFrequencyOf(1), 0);
});
test('p = 0.7 gives 2pq = 0.42 and the three genotypes sum to 1', () => {
  assert.ok(Math.abs(heterozygoteFrequencyOf(0.7) - 0.42) < 1e-12);
  const g = genotypeFrequencies(0.7);
  assert.ok(Math.abs(g.homozygousP - 0.49) < 1e-12 && Math.abs(g.homozygousQ - 0.09) < 1e-12);
  assert.ok(Math.abs(g.homozygousP + g.heterozygous + g.homozygousQ - 1) < 1e-12);
});
test('rejects p outside [0, 1] or non-finite', () => {
  for (const p of [-0.01, 1.01, Number.NaN, Infinity]) assert.throws(() => heterozygoteFrequencyOf(p), /ALLELE_FREQUENCY_OUT_OF_RANGE/);
});
