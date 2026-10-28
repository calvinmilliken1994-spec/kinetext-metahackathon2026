// Half-life view-model helpers (pure). Amounts come from the SAME engine the validator ran
// (packages/activities/half-life-v1); nothing here re-implements the decay formula.

import { remainingAfter } from '../../../../packages/activities/half-life-v1/engine.ts';
import type { HalfLifeInput } from '../../../../packages/activities/half-life-v1/engine.ts';
import { trimmed } from './format.ts';

/** At most this many half-life markers are drawn, so a tiny half-life cannot flood the chart. */
export const MAX_HALF_LIFE_MARKERS = 10;

/** What is left after k half-lives: 1, 1/2, 1/4, 1/8 … */
export function fractionLabel(k: number): string {
  return k <= 0 ? '1' : `1/${2 ** k}`;
}

export interface HalfLifeMarker { k: number; t: number; fraction: number; fractionLabel: string; amount: number }

/** One marker per whole half-life up to the end of the time axis (at most MAX_HALF_LIFE_MARKERS). Empty for invalid inputs. */
export function halfLifeMarkers(halfLife: number, tMax: number, initialAmount: number): HalfLifeMarker[] {
  if (![halfLife, tMax, initialAmount].every((v) => Number.isFinite(v) && v > 0)) return [];
  const out: HalfLifeMarker[] = [];
  // 1e-9 relative slack: 3 × 0.1 is 0.30000000000000004 and must still count as 0.3.
  for (let k = 1; k <= MAX_HALF_LIFE_MARKERS && k * halfLife <= tMax * (1 + 1e-9); k++) {
    const t = k * halfLife;
    out.push({ k, t, fraction: 0.5 ** k, fractionLabel: fractionLabel(k), amount: remainingAfter({ initialAmount, halfLife, elapsedTime: t }) });
  }
  return out;
}

export interface DecayPoint { t: number; amount: number }

/** N(t) at `steps + 1` evenly spaced times 0..tMax, each from the engine. Empty for rejected inputs or an empty axis. */
export function decayPoints(input: HalfLifeInput, tMax: number, steps: number): DecayPoint[] {
  if (!Number.isFinite(tMax) || tMax <= 0) return [];
  const n = Math.max(1, Math.floor(steps));
  try {
    return Array.from({ length: n + 1 }, (_, i) => {
      const t = (tMax * i) / n;
      return { t, amount: remainingAfter({ ...input, elapsedTime: t }) };
    });
  } catch {
    return [];
  }
}

/** How many half-lives have passed (t / T), or null for a bad half-life or time. */
export function halfLivesElapsed(elapsedTime: number, halfLife: number): number | null {
  if (!Number.isFinite(elapsedTime) || elapsedTime < 0 || !Number.isFinite(halfLife) || halfLife <= 0) return null;
  return elapsedTime / halfLife;
}

/** Label every `stride`-th marker so labels do not overlap: stride 1 when each marker has `minGapPx` of room. */
export function markerLabelStride(tMax: number, halfLife: number, widthPx: number, minGapPx: number): number {
  if (![tMax, halfLife, widthPx, minGapPx].every((v) => Number.isFinite(v) && v > 0)) return 1;
  const gap = (halfLife / tMax) * widthPx;
  return Math.max(1, Math.ceil(minGapPx / gap - 1e-9));
}

/** Readable amount at any scale. No unit is added: N0 may be grams, atoms or percent. */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 10) return trimmed(n, 2);
  if (a >= 1) return trimmed(n, 3);
  if (a >= 0.001) return trimmed(n, 4);
  return n.toExponential(2);
}
