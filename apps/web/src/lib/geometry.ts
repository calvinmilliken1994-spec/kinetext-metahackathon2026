// Pure drawing geometry for the projectile, lift and speed-of-sound schematics (no DOM, no React).
// The physics values (positions, lift, radii) are computed by the engines; this file only maps them to pixels.

import { liftOf } from '../../../../packages/activities/lift-equation-v1/engine.ts';
import { speedOfSoundOf, wavefrontRadiusAt } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import type { SoundInput } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import { niceStep } from './track.ts';

export interface PlotBox { left: number; right: number; top: number; bottom: number }

export interface ProjectileLayout {
  /** Pixels per metre (same for x and y, so the arc keeps its real shape). */
  scale: number;
  toPx: (xM: number, yM: number) => { px: number; py: number };
  /** Nice x tick positions in metres, from 0 up to the largest x that fits the box. */
  xTicks: number[];
  xTickStep: number;
}

/**
 * Fit a trajectory (x from 0 to xMaxM, y from 0 to yMaxM) into the box with one common scale. The ground
 * is the box bottom and the launch point the box left. Degenerate extents (U0 = 0 or tiny heights) still give
 * a finite, positive scale.
 */
export function projectileLayout(xMaxM: number, yMaxM: number, box: PlotBox): ProjectileLayout {
  const w = Math.max(1, box.right - box.left);
  const h = Math.max(1, box.bottom - box.top);
  const worldH = Math.max(yMaxM, 1e-6);
  const worldW = xMaxM > 1e-6 ? xMaxM : worldH * 0.5;
  const scale = Math.min(w / worldW, h / worldH);
  const toPx = (xM: number, yM: number): { px: number; py: number } => ({ px: box.left + xM * scale, py: box.bottom - yM * scale });
  const fitM = w / scale;
  const xTickStep = niceStep(fitM / 6);
  const xTicks: number[] = [];
  for (let k = 0; k * xTickStep <= fitM + 1e-9 && k <= 40; k++) xTicks.push(Number((k * xTickStep).toFixed(10)));
  return { scale, toPx, xTicks, xTickStep };
}

/** |lift| of the largest combination the sliders allow — the reference for the arrow scale. Null if the engine rejects it. */
export function liftScaleMax(maxima: Record<string, number>, minima: Record<string, number>): number | null {
  const cl = Math.max(Math.abs(maxima['liftCoefficient'] ?? 0), Math.abs(minima['liftCoefficient'] ?? 0));
  try {
    return Math.abs(liftOf({
      liftCoefficient: cl,
      airDensityKgM3: maxima['airDensityKgM3'] ?? Number.NaN,
      airspeedMps: Math.max(Math.abs(maxima['airspeedMps'] ?? 0), Math.abs(minima['airspeedMps'] ?? 0)),
      wingAreaM2: maxima['wingAreaM2'] ?? Number.NaN,
    }));
  } catch {
    return null;
  }
}

/**
 * Signed lift-arrow length in px on a LOGARITHMIC scale: log10(1+|L|) / log10(1+|Lref|), so a 100x change in lift
 * is a visible change in length rather than a vanishing arrow. Non-zero lift is at least minPx long and never
 * longer than maxPx; zero (or unusable) lift gives 0 (no arrow). Not proportional — the view says so.
 */
export function liftArrowPx(liftN: number, scaleMaxN: number, maxPx: number, minPx = 14): number {
  if (!Number.isFinite(liftN) || liftN === 0 || !(scaleMaxN > 0)) return 0;
  const frac = Math.min(1, Math.log10(1 + Math.abs(liftN)) / Math.log10(1 + scaleMaxN));
  const len = Math.min(maxPx, Math.max(minPx, minPx + (maxPx - minPx) * frac));
  return liftN < 0 ? -len : len;
}

/** Wing tilt in degrees, proportional to Cl and capped, so a larger lift coefficient visibly pitches the wing up. */
export function wingTiltDeg(cl: number, clAbsMax: number, maxDeg = 14): number {
  if (!Number.isFinite(cl) || !(clAbsMax > 0)) return 0;
  return Math.max(-maxDeg, Math.min(maxDeg, (cl / clAbsMax) * maxDeg));
}

/** Seconds for one airflow dash cycle: faster flow (larger V) cycles faster. Clamped to [0.35, 2.6]. */
export function flowCycleS(v: number, vMax: number): number {
  if (!Number.isFinite(v) || !(vMax > 0)) return 2.6;
  const frac = Math.min(1, Math.max(0, Math.abs(v) / vMax));
  return Number((2.6 - (2.6 - 0.35) * frac).toFixed(3));
}

/** Number of streamlines drawn: denser air (larger rho) shows more lines, 3 to 7. */
export function flowLineCount(rho: number, rhoMax: number): number {
  if (!Number.isFinite(rho) || !(rhoMax > 0)) return 3;
  return 3 + Math.round(4 * Math.min(1, Math.max(0, rho / rhoMax)));
}

export interface WaveRing {
  /** Emission order (0 = first ever). */
  index: number;
  ageS: number;
  /** r = a * age from the engine. */
  radiusM: number;
  /** 1 when new, 0 when it expires. */
  opacity: number;
}

export interface RingOptions { emitEveryS: number; lifetimeS: number }

/** Live rings at time t: one is emitted every emitEveryS; each expands at the speed of sound (wavefrontRadiusAt). */
export function wavefronts(input: SoundInput, t: number, opts: RingOptions): WaveRing[] {
  if (!Number.isFinite(t) || t < 0 || !(opts.emitEveryS > 0) || !(opts.lifetimeS > 0)) return [];
  const rings: WaveRing[] = [];
  const last = Math.floor(t / opts.emitEveryS + 1e-9);
  for (let k = Math.max(0, last - Math.ceil(opts.lifetimeS / opts.emitEveryS)); k <= last; k++) {
    const ageS = t - k * opts.emitEveryS;
    if (ageS < 0 || ageS > opts.lifetimeS) continue;
    rings.push({ index: k, ageS, radiusM: wavefrontRadiusAt(input, ageS), opacity: Math.max(0, 1 - ageS / opts.lifetimeS) });
  }
  return rings;
}

/**
 * Radius that a ring reaches at the end of its life when the sound speed is the largest the sliders allow, times a
 * headroom factor (0.8: typical air then fills most of the drawing and only the very fastest gases are clipped near
 * the end of a ring's life; labels always show the true radius). Null on engine rejection.
 */
export function soundScaleMaxM(maxInput: SoundInput, lifetimeS: number, headroom = 0.8): number | null {
  try {
    return speedOfSoundOf(maxInput) * lifetimeS * headroom;
  } catch {
    return null;
  }
}

/** Ring radius in px for a fixed physical scale (so hotter gas visibly spreads faster). Never beyond maxPx. */
export function ringPx(radiusM: number, scaleMaxM: number, maxPx: number): number {
  if (!(scaleMaxM > 0) || !Number.isFinite(radiusM)) return 0;
  return Math.min(maxPx, Math.max(0, (radiusM / scaleMaxM) * maxPx));
}
