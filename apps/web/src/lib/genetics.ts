// Hardy-Weinberg view-model helpers (pure). Frequencies come from the SAME engine the validator ran
// (packages/activities/hardy-weinberg-v1); nothing here re-implements p², 2pq or q².

import { genotypeFrequencies, heterozygoteFrequencyOf } from '../../../../packages/activities/hardy-weinberg-v1/engine.ts';
import { trimmed } from './format.ts';

export interface GenotypeLabels { homozygousP: string; heterozygous: string; homozygousQ: string }

/** Generic labels: the scenario carries only an object and a setting label, so no allele names are invented. */
export const GENOTYPE_LABELS: GenotypeLabels = { homozygousP: 'AA', heterozygous: 'Aa', homozygousQ: 'aa' };

export interface GenotypeBar {
  key: keyof GenotypeLabels;
  label: string;
  /** 'p²', '2pq', 'q²'. */
  formula: string;
  frequency: number;
  /** True for 2pq, the value every prediction asks for. */
  checked: boolean;
}

/** The three genotype bars for allele frequency p, or none when p is outside [0, 1]. */
export function genotypeBars(p: number, labels: GenotypeLabels = GENOTYPE_LABELS): GenotypeBar[] {
  let f;
  try {
    f = genotypeFrequencies(p);
  } catch {
    return [];
  }
  return [
    { key: 'homozygousP', label: labels.homozygousP, formula: 'p²', frequency: f.homozygousP, checked: false },
    { key: 'heterozygous', label: labels.heterozygous, formula: '2pq', frequency: f.heterozygous, checked: true },
    { key: 'homozygousQ', label: labels.homozygousQ, formula: 'q²', frequency: f.homozygousQ, checked: false },
  ];
}

/** True when there are three bars whose frequencies add up to 1 (within float error). */
export function frequenciesSumToOne(bars: readonly GenotypeBar[]): boolean {
  return bars.length === 3 && Math.abs(bars.reduce((s, b) => s + b.frequency, 0) - 1) <= 1e-9;
}

/** q = 1 − p. */
export function alleleQ(p: number): number {
  return 1 - p;
}

export interface CurvePoint { p: number; h: number }

/** 2pq against p at `steps + 1` evenly spaced values of p from 0 to 1 (at least both ends). */
export function heterozygoteCurve(steps: number): CurvePoint[] {
  const n = Math.max(1, Math.floor(steps));
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = i / n;
    return { p, h: heterozygoteFrequencyOf(p) };
  });
}

/** Up to four decimals, no float noise, no trailing zeros. */
export function formatFrequency(n: number): string {
  return trimmed(n, 4);
}
