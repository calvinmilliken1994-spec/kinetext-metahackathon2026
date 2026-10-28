// Compound-interest view-model helpers (pure). Balances come from the SAME engine the validator ran
// (packages/activities/compound-interest-v1); nothing here re-implements the compound-interest formula.

import { balanceAt } from '../../../../packages/activities/compound-interest-v1/engine.ts';
import type { CompoundInterestInput } from '../../../../packages/activities/compound-interest-v1/engine.ts';
import { trimmed } from './format.ts';

/** The compounding frequencies a student expects to see: yearly, twice a year, quarterly, monthly, daily. */
export const COMPOUNDING_PRESETS: readonly number[] = [1, 2, 4, 12, 365];

/**
 * The positions of the "compounds per year" slider. The presets that fit the spec's [min, max] range, or every
 * whole number in range when fewer than two presets fit. A current value outside that list (a prediction can set
 * n = 3) is inserted so the slider never shows a value it is not at. Always returns at least one finite stop.
 */
export function compoundingStops(min: number, max: number, current?: number): number[] {
  const lo = Number.isFinite(min) ? min : 1;
  const hi = Number.isFinite(max) ? max : lo;
  let stops = COMPOUNDING_PRESETS.filter((p) => p >= lo && p <= hi);
  if (stops.length < 2) {
    stops = [];
    for (let n = Math.ceil(lo); n <= Math.floor(hi) && stops.length < 400; n++) stops.push(n);
  }
  if (typeof current === 'number' && Number.isFinite(current) && !stops.includes(current)) {
    stops = [...stops, current].sort((a, b) => a - b);
  }
  return stops.length > 0 ? stops : [Math.max(1, Math.round(lo))];
}

/** Index of the exact stop for `value`, else of the nearest one; 0 for an empty list. */
export function stopIndex(stops: readonly number[], value: number): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  stops.forEach((s, i) => {
    const d = Math.abs(s - value);
    if (d < bestDist) { best = i; bestDist = d; }
  });
  return best;
}

/** Everyday words for a compounding frequency. */
export function compoundingName(n: number): string {
  switch (n) {
    case 1: return 'once a year';
    case 2: return 'twice a year';
    case 4: return 'quarterly';
    case 12: return 'monthly';
    case 365: return 'daily';
    default: return `${trimmed(n, 4)} times a year`;
  }
}

/** '1,628.89': two decimals, grouped thousands, never '-0.00'. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 && body !== '0.00' ? `-${body}` : body;
}

/** '$1,628.89'; a negative amount reads '-$5.50'. */
export function formatUSD(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const s = formatMoney(n);
  return s.startsWith('-') ? `-$${s.slice(1)}` : `$${s}`;
}

export interface GrowthPoint { t: number; balance: number }

/** Balance at `steps + 1` evenly spaced times 0..years, each from the engine. Empty if the engine rejects the inputs. */
export function growthPoints(input: CompoundInterestInput, years: number, steps: number): GrowthPoint[] {
  if (!Number.isFinite(years) || years < 0) return [];
  const n = years === 0 ? 0 : Math.max(1, Math.floor(steps));
  try {
    const out: GrowthPoint[] = [];
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : (years * i) / n;
      out.push({ t, balance: balanceAt(input, t) });
    }
    return out;
  } catch {
    return [];
  }
}

/** Interest earned so far; float noise below zero reads as 0. */
export function interestEarned(principalUSD: number, balance: number): number {
  return Math.max(0, balance - principalUSD);
}

/** The general formula as shown to students. */
export function compoundEquation(): string {
  return 'A = P × (1 + r/(100·n))^(n·t)';
}

/** The formula with this activity's numbers put in. */
export function compoundSubstitution(i: CompoundInterestInput): string {
  return `A = ${formatUSD(i.principalUSD)} × (1 + ${trimmed(i.annualRatePercent, 4)}/(100·${trimmed(i.compoundsPerYear, 4)}))^(${trimmed(i.compoundsPerYear, 4)}·${trimmed(i.years, 4)})`;
}
