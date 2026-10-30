// Pure drawing geometry for the projectile, lift and speed-of-sound schematics (no DOM, no React).
// The physics values (positions, lift, radii) are computed by the engines; this file only maps them to pixels.

import { liftOf } from '../../../../packages/activities/lift-equation-v1/engine.ts';
import { speedOfSoundOf, wavefrontRadiusAt } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import type { SoundInput } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import { niceStep } from './track.ts';
import { simulate } from '../../../../packages/activities/projectile-v1/engine.ts';
import { projectileSummary } from './engines.ts';
import { fixed, trimmed } from './format.ts';

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

// ---- projectile scene: arcs, comparison ghosts and collision-free labels (Stage 7 item 4) ----------------------------

export interface Px { px: number; py: number }
/** Axis-aligned box, top-left corner + size, in viewBox units. */
export interface LabelBox { x: number; y: number; w: number; h: number }
export type Anchor = 'start' | 'middle' | 'end';
export interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  anchor: Anchor;
  box: LabelBox;
  /** False when no candidate spot was free and the least-bad one was used. */
  clean: boolean;
}

/** A thin line from the point a label belongs to (peak, ghost peak) to the label's nearest edge, or null when it sits close. */
export function leaderLine(label: PlacedLabel, to: Px, near = 24): { x1: number; y1: number; x2: number; y2: number } | null {
  const b = label.box;
  const x = Math.min(Math.max(to.px, b.x), b.x + b.w);
  const y = Math.min(Math.max(to.py, b.y), b.y + b.h);
  return Math.hypot(x - to.px, y - to.py) <= near ? null : { x1: to.px, y1: to.py, x2: x, y2: y };
}

/** The projectile drawing: viewBox size, plot box (ground = bottom, launch = left) and fixed text rows. */
export const PROJECTILE_FRAME = {
  W: 800,
  H: 320,
  box: { left: 64, right: 760, top: 66, bottom: 250 } as PlotBox,
  titleY: 26,
  tickLabelDy: 28,
} as const;

/** Estimated text box for an SVG label (system-ui; bold 16 px scene labels, 12–14 px small ones). Errs a little wide. */
export function textBox(text: string, fontPx: number, x: number, y: number, anchor: Anchor, bold = false): LabelBox {
  const w = text.length * fontPx * (bold ? 0.62 : 0.58);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: left, y: y - fontPx * 0.8, w, h: fontPx };
}

/** Points no more than `step` apart along the polyline (so a box cannot slip between two samples). */
export function densify(points: readonly Px[], step: number): Px[] {
  const out: Px[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Px;
    out.push(a);
    const b = points[i + 1];
    if (b === undefined) break;
    const n = Math.ceil(Math.hypot(b.px - a.px, b.py - a.py) / step);
    for (let k = 1; k < n; k++) out.push({ px: a.px + ((b.px - a.px) * k) / n, py: a.py + ((b.py - a.py) * k) / n });
  }
  return out;
}

const grow = (b: LabelBox, pad: number): LabelBox => ({ x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad });
const boxesOverlap = (a: LabelBox, b: LabelBox): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const pointIn = (p: Px, b: LabelBox): boolean => p.px >= b.x && p.px <= b.x + b.w && p.py >= b.y && p.py <= b.y + b.h;

export interface LabelRequest {
  text: string;
  fontPx: number;
  bold?: boolean;
  /** Preferred spots, best first. */
  candidates: { x: number; y: number; anchor: Anchor }[];
  /** When every preferred spot is taken, also try a grid over the drawing, nearest to this point first. */
  near?: Px;
  /** Lowest baseline the grid may use (keeps peak labels above the ground). */
  maxY?: number;
}

/** Fallback spots: a 20 x 10 px grid over the bounds (three anchors each), nearest to `near` first. */
function gridCandidates(near: Px, bounds: LabelBox, maxY: number): { x: number; y: number; anchor: Anchor }[] {
  const out: { x: number; y: number; anchor: Anchor; d: number }[] = [];
  for (let y = bounds.y + 14; y <= Math.min(maxY, bounds.y + bounds.h); y += 10) {
    for (let x = bounds.x; x <= bounds.x + bounds.w; x += 20) {
      for (const anchor of ['start', 'end'] as const) out.push({ x, y, anchor, d: Math.hypot(x - near.px, y - near.py) });
    }
  }
  return out.sort((a, b) => a.d - b.d).map(({ x, y, anchor }) => ({ x, y, anchor }));
}

/**
 * Place labels in order: each takes its first candidate spot that stays inside the drawing and is at least `pad` away from
 * the fixed boxes, the labels already placed and every obstacle point. When none is free, the spot with the fewest
 * conflicts is used and marked not clean.
 */
export function placeLabels(requests: readonly LabelRequest[], fixedBoxes: readonly LabelBox[], points: readonly Px[], bounds: LabelBox, pad = 3): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const obstacles: Px[] = [...points];
  for (const r of requests) {
    let best: { label: PlacedLabel; score: number } | null = null;
    const all = r.near === undefined ? r.candidates : [...r.candidates, ...gridCandidates(r.near, bounds, r.maxY ?? Number.POSITIVE_INFINITY)];
    for (const c of all) {
      const box = textBox(r.text, r.fontPx, c.x, c.y, c.anchor, r.bold === true);
      const padded = grow(box, pad);
      const outside = box.x < bounds.x || box.y < bounds.y || box.x + box.w > bounds.x + bounds.w || box.y + box.h > bounds.y + bounds.h;
      const hits = fixedBoxes.filter((f) => boxesOverlap(padded, f)).length
        + placed.filter((l) => boxesOverlap(padded, l.box)).length;
      const onCurve = obstacles.filter((p) => pointIn(p, padded)).length;
      // Its leader line (if it sits far from its point) must not run through a label already placed.
      const lead = r.near === undefined ? null : leaderLine({ text: r.text, x: c.x, y: c.y, anchor: c.anchor, box, clean: true }, r.near);
      const leadHits = lead === null ? 0 : placed.filter((l) => densify([{ px: lead.x1, py: lead.y1 }, { px: lead.x2, py: lead.y2 }], 3).some((p) => pointIn(p, grow(l.box, 2)))).length;
      const score = (outside ? 1e6 : 0) + (hits + leadHits) * 1e3 + onCurve;
      const label = { text: r.text, x: c.x, y: c.y, anchor: c.anchor, box, clean: score === 0 };
      if (score === 0) { best = { label, score }; break; }
      if (best === null || score < best.score) best = { label, score };
    }
    if (best !== null) {
      placed.push(best.label);
      // A far label gets a leader line in the drawing; later labels must not sit on it either.
      const lead = r.near === undefined ? null : leaderLine(best.label, r.near);
      if (lead !== null) obstacles.push(...densify([{ px: lead.x1, py: lead.y1 }, { px: lead.x2, py: lead.y2 }], 3));
    }
  }
  return placed;
}

export interface ProjectileInput { horizontalSpeedMps: number; verticalSpeedMps: number; gravityMps2: number }

export interface GhostArc {
  gravityMps2: number;
  maxHeightM: number;
  points: Px[];
  apex: Px;
  land: Px;
  label: PlacedLabel;
}

export interface ProjectileScene {
  layout: ProjectileLayout;
  maxHeightM: number;
  flightTimeS: number;
  rangeM: number;
  apexTimeS: number;
  /** The current arc, sampled by the engine, and the simulated time of each sample. */
  points: Px[];
  pointTimes: number[];
  apex: Px;
  land: Px;
  ghosts: GhostArc[];
  labels: { apex: PlacedLabel; landing: PlacedLabel };
  /** Title, axis tick labels and the ground band: what labels must never cover. */
  fixedBoxes: LabelBox[];
}

const ARC_SAMPLES = 160;

function arcOf(input: ProjectileInput): { summary: NonNullable<ReturnType<typeof projectileSummary>>; frames: { t: number; x: number; y: number }[] } | null {
  const summary = projectileSummary({ ...input });
  if (summary === null) return null;
  try {
    const frames = simulate(input, summary.flightTimeS / ARC_SAMPLES);
    return frames.length === 0 ? null : { summary, frames };
  } catch {
    return null;
  }
}

/**
 * Everything the projectile schematic draws, from the engine: the current arc, faint comparison arcs at the SAME launch
 * speeds for each other page-stated g (`ghostGravities`), one common scale that fits all of them (so the page's "about six
 * times higher" is visible), and the peak, landing and ghost labels placed where they cover no curve and no other text.
 * Null when the engine rejects the current inputs; a ghost the engine rejects is left out.
 */
export function projectileScene(input: ProjectileInput, ghostGravities: readonly number[], title = ''): ProjectileScene | null {
  const main = arcOf(input);
  if (main === null) return null;
  const ghostArcs = ghostGravities
    .map((g) => ({ g, arc: arcOf({ ...input, gravityMps2: g }) }))
    .filter((x): x is { g: number; arc: NonNullable<ReturnType<typeof arcOf>> } => x.arc !== null);

  const { W, H, box, titleY, tickLabelDy } = PROJECTILE_FRAME;
  const layout = projectileLayout(
    Math.max(main.summary.rangeM, ...ghostArcs.map((x) => x.arc.summary.rangeM)),
    Math.max(main.summary.maxHeightM, ...ghostArcs.map((x) => x.arc.summary.maxHeightM)),
    box,
  );
  const toPts = (frames: { x: number; y: number }[]): Px[] => frames.map((f) => layout.toPx(f.x, f.y));
  const points = toPts(main.frames);
  const apex = layout.toPx(main.summary.rangeM / 2, main.summary.maxHeightM);
  const land = layout.toPx(main.summary.rangeM, 0);

  const fixedBoxes: LabelBox[] = [];
  if (title !== '') fixedBoxes.push(textBox(title, 14, box.left, titleY, 'start', true));
  fixedBoxes.push({ x: box.left - 14, y: box.bottom - 3, w: box.right - box.left + 28, h: 8 });
  for (const x of layout.xTicks) {
    const p = layout.toPx(x, 0);
    if (p.px <= box.right + 20) fixedBoxes.push(textBox(trimmed(x, 3), 14, p.px, box.bottom + tickLabelDy, 'middle'));
  }
  fixedBoxes.push(textBox('m', 14, box.right + 28, box.bottom + tickLabelDy, 'end'));

  const ghostData = ghostArcs.map(({ g, arc }) => ({
    g,
    arc,
    points: toPts(arc.frames),
    apex: layout.toPx(arc.summary.rangeM / 2, arc.summary.maxHeightM),
    land: layout.toPx(arc.summary.rangeM, 0),
  }));

  // Obstacles for every label: all arcs, the dashed guide from the peak to the ground, and the two dots.
  const curvePts = densify(points, 3);
  for (const gd of ghostData) curvePts.push(...densify(gd.points, 3));
  curvePts.push(...densify([apex, { px: apex.px, py: box.bottom }], 3));
  const dots: LabelBox[] = [
    { x: apex.px - 6, y: apex.py - 6, w: 12, h: 12 },
    { x: land.px - 5, y: land.py - 5, w: 10, h: 10 },
  ];
  const bounds: LabelBox = { x: 2, y: 2, w: W - 4, h: H - 4 };
  const below = box.bottom + tickLabelDy + 22;

  const apexText = `max height ${fixed(main.summary.maxHeightM, 2)} m`;
  const landText = `lands at t = ${fixed(main.summary.flightTimeS, 2)} s`;
  const requests: LabelRequest[] = [
    {
      text: apexText, fontPx: 16, bold: true, near: apex, maxY: box.bottom - 8,
      candidates: [
        { x: apex.px, y: apex.py - 14, anchor: 'middle' },
        { x: apex.px + 12, y: apex.py - 10, anchor: 'start' },
        { x: apex.px - 12, y: apex.py - 10, anchor: 'end' },
        { x: apex.px + 14, y: apex.py + 6, anchor: 'start' },
        { x: apex.px - 14, y: apex.py + 6, anchor: 'end' },
        { x: apex.px + 14, y: apex.py + 26, anchor: 'start' },
        { x: apex.px - 14, y: apex.py + 26, anchor: 'end' },
        // Beside the whole arc at peak height (a small arc under a larger ghost): the leader stays level with the peak.
        { x: land.px + 12, y: apex.py + 5, anchor: 'start' },
        { x: box.left - 2, y: apex.py + 5, anchor: 'end' },
        // Crowded arcs (a tiny arc under larger ghosts): step further up; a leader line then ties the label to the peak.
        ...[-30, -50, -70, -90, -110].flatMap((dy) => [
          { x: apex.px + 14, y: apex.py + dy, anchor: 'start' as const },
          { x: apex.px - 14, y: apex.py + dy, anchor: 'end' as const },
        ]),
      ],
    },
    ...ghostData.map((gd): LabelRequest => ({
      text: `g = ${trimmed(gd.g, 4)} m/s²`, fontPx: 12, near: gd.apex, maxY: box.bottom - 8,
      candidates: [
        { x: gd.apex.px, y: gd.apex.py - 10, anchor: 'middle' },
        { x: gd.apex.px + 10, y: gd.apex.py - 6, anchor: 'start' },
        { x: gd.apex.px - 10, y: gd.apex.py - 6, anchor: 'end' },
        { x: gd.apex.px, y: gd.apex.py + 18, anchor: 'middle' },
        { x: gd.apex.px + 12, y: gd.apex.py + 16, anchor: 'start' },
        { x: gd.apex.px - 12, y: gd.apex.py + 16, anchor: 'end' },
        { x: gd.land.px + 8, y: box.bottom - 10, anchor: 'start' },
        { x: gd.land.px - 8, y: box.bottom - 10, anchor: 'end' },
        ...[-22, -40, -60].flatMap((dy) => [
          { x: gd.apex.px + 12, y: gd.apex.py + dy, anchor: 'start' as const },
          { x: gd.apex.px - 12, y: gd.apex.py + dy, anchor: 'end' as const },
        ]),
      ],
    })),
    {
      text: landText, fontPx: 12, near: land,
      candidates: [
        { x: land.px + 10, y: box.bottom - 10, anchor: 'start' },
        { x: land.px - 10, y: box.bottom - 10, anchor: 'end' },
        { x: land.px, y: below, anchor: 'end' },
        { x: land.px, y: below, anchor: 'start' },
        { x: land.px, y: below, anchor: 'middle' },
        { x: W - 8, y: below, anchor: 'end' },
      ],
    },
  ];
  const placed = placeLabels(requests, [...fixedBoxes, ...dots], curvePts, bounds);
  const apexLabel = placed[0] as PlacedLabel;
  const landLabel = placed[placed.length - 1] as PlacedLabel;
  const ghosts: GhostArc[] = ghostData.map((gd, i) => ({
    gravityMps2: gd.g, maxHeightM: gd.arc.summary.maxHeightM, points: gd.points, apex: gd.apex, land: gd.land, label: placed[1 + i] as PlacedLabel,
  }));
  return {
    layout,
    maxHeightM: main.summary.maxHeightM,
    flightTimeS: main.summary.flightTimeS,
    rangeM: main.summary.rangeM,
    apexTimeS: main.summary.apexTimeS,
    points,
    pointTimes: main.frames.map((f) => f.t),
    apex,
    land,
    ghosts,
    labels: { apex: apexLabel, landing: landLabel },
    fixedBoxes,
  };
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
