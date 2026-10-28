/**
 * hardy-weinberg-v1 — deterministic Hardy-Weinberg engine (one gene, two alleles).
 *
 * Pure and browser-safe. With allele frequencies p and q = 1 - p, genotype
 * frequencies in equilibrium are p^2, 2pq and q^2 (they sum to 1). The checked
 * output is the heterozygote frequency 2pq, at most 0.5 (at p = 0.5).
 */

export const ENGINE_ID = 'hardy-weinberg-v1';

export interface GenotypeFrequencies { homozygousP: number; heterozygous: number; homozygousQ: number }

function checkP(p: number): void {
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new RangeError('ALLELE_FREQUENCY_OUT_OF_RANGE');
}

/** Heterozygote frequency 2pq. */
export function heterozygoteFrequencyOf(p: number): number {
  checkP(p);
  return 2 * p * (1 - p);
}

/** All three genotype frequencies p^2, 2pq, q^2. */
export function genotypeFrequencies(p: number): GenotypeFrequencies {
  checkP(p);
  const q = 1 - p;
  return { homozygousP: p * p, heterozygous: 2 * p * q, homozygousQ: q * q };
}
