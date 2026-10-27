// Pure geometry for the simulation scene and graphs (no DOM, no React).

/** Smallest 1/2/5 x 10^k that is >= rough. */
export function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const m of [1, 2, 5, 10]) {
    if (m * pow >= rough - 1e-12) return m * pow;
  }
  return 10 * pow;
}

export interface TrackWindow { min: number; max: number; step: number; ticks: number[] }

export interface TrackOptions { minSpan?: number; targetTicks?: number; padFraction?: number }

/**
 * Visible metre window for a run: always contains the origin and every sampled position,
 * with padding and nice tick marks. Works for negative, zero and positive net force.
 */
export function trackWindow(xs: readonly number[], opts: TrackOptions = {}): TrackWindow {
  const minSpan = opts.minSpan ?? 10;
  const targetTicks = opts.targetTicks ?? 8;
  const padFraction = opts.padFraction ?? 0.08;
  let lo = 0;
  let hi = 0;
  for (const x of xs) {
    if (!Number.isFinite(x)) continue;
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  if (hi - lo < minSpan) hi = lo + minSpan; // object (nearly) at rest: still show a useful scale
  const span = hi - lo;
  const pad = span * padFraction;
  const rawMin = lo - pad;
  const rawMax = hi + pad;
  const step = niceStep((rawMax - rawMin) / targetTicks);
  const min = Math.floor(rawMin / step + 1e-9) * step;
  const max = Math.ceil(rawMax / step - 1e-9) * step;
  const ticks: number[] = [];
  const first = Math.round(min / step);
  const last = Math.round(max / step);
  for (let k = first; k <= last; k++) ticks.push(Number((k * step).toFixed(10)));
  return { min: Number(min.toFixed(10)), max: Number(max.toFixed(10)), step, ticks };
}

/** Map a metre value to a pixel inside [px0, px1] for the given window. */
export function toPx(x: number, w: { min: number; max: number }, px0: number, px1: number): number {
  const f = (x - w.min) / (w.max - w.min);
  return px0 + f * (px1 - px0);
}

/**
 * Signed arrow length in px: proportional to |value|/maxAbs, at least minPx for any non-zero value,
 * never longer than maxPx. Zero (or an unusable scale) gives 0 so no arrow is drawn.
 */
export function arrowLength(value: number, maxAbs: number, maxPx: number, minPx = 10): number {
  if (!Number.isFinite(value) || value === 0 || !(maxAbs > 0)) return 0;
  const mag = Math.min(maxPx, Math.max(minPx, (Math.abs(value) / maxAbs) * maxPx));
  return value < 0 ? -mag : mag;
}

/** Shorten a signed arrow so its tip stays inside [lo, hi] when started at `from`. */
export function clampArrow(from: number, len: number, lo: number, hi: number): number {
  const tip = Math.min(hi, Math.max(lo, from + len));
  return tip - from;
}

/** A pleasant slider step (1/2/5 x 10^k) giving roughly 100+ positions across the range. */
export function sliderStep(min: number, max: number): number {
  const range = max - min;
  if (!(range > 0)) return 1;
  const rough = range / 100;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  let best = pow;
  for (const m of [1, 2, 5]) if (m * pow <= rough + 1e-12) best = m * pow;
  return Number(best.toFixed(10));
}

/** [lo, hi] covering all values and zero, padded; never a zero-height range. */
export function valueRange(values: readonly number[], padFraction = 0.1): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 1e-9) return { lo: -1, hi: 1 };
  const pad = (hi - lo) * padFraction;
  return { lo: lo < 0 ? lo - pad : 0, hi: hi > 0 ? hi + pad : 0 };
}

export type ObjectShape = 'aircraft' | 'block';

/** Choose a generic silhouette from the spec's display label (no copied artwork either way). */
export function objectShapeFor(label: string): ObjectShape {
  return /\b(air\s?craft|airplane|aeroplane|plane|jet|glider|drone|flight|airliner)\b/i.test(label) ? 'aircraft' : 'block';
}
