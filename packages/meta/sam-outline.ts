// Stage 8c: SAM mask -> SVG outline in absolute IMAGE pixels, for the label-diagram build animation.
//
// The mask comes from a SAM result record (`SamBox.mask`): a box-local raster (height = y2 - y1 + 1 rows, width = x2 - x1 + 1
// columns). Meta's `@meta-sam/parser` decodes it and traces the contour (marching squares over pixel centres, so a pixel
// (r, c) is centred on (c, r) and the contour runs half a pixel outside the outermost set pixels). Here that contour is
//   1. moved to the image: + (box.x1, box.y1), and + 0.5 so a pixel (x, y) is the unit square [x, x+1) x [y, y+1) of an
//      SVG whose viewBox is the image's own width x height (what the web view draws on);
//   2. simplified per ring with Ramer-Douglas-Peucker at 1 px tolerance and rounded to 0.5 px;
//   3. trimmed to the largest rings until the string fits OUTLINE_MAX_CHARS (a mask of many scattered pieces keeps its
//      biggest ones); a single ring that does not fit gives null.
// Any failure to decode (corrupt payload, marker or size that disagree with the box) gives null: the caller then simply
// has no outline and the web falls back to the box animation. Pure and deterministic; never throws.
import { decodeMaskToSVGPath } from '@meta-sam/parser';
import type { SamMask } from './sam.ts';

/** Frozen contract limit (`LabelRegion.outline`): at most this many characters. */
export const OUTLINE_MAX_CHARS = 6000;
/** Simplification tolerance in image pixels. */
export const OUTLINE_TOLERANCE_PX = 1;
/** Rings smaller than this (in px^2, after simplification) are specks and are dropped. */
const MIN_RING_AREA = 4;
/** More rings than this never help a teacher read the shape. */
const MAX_RINGS = 12;

export interface OutlineBox {
  /** Image pixels, edges inclusive (the SAM record's box). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface OutlineOptions {
  /** Test seam; defaults to OUTLINE_MAX_CHARS and never exceeds it. */
  maxChars?: number;
}

type Pt = readonly [number, number];

const PATH_RING_RE = /M([^MZ]*)Z/g;

function parseRings(svg: string): Pt[][] {
  const rings: Pt[][] = [];
  for (const m of svg.matchAll(PATH_RING_RE)) {
    const ring: Pt[] = [];
    for (const token of (m[1] ?? '').split('L')) {
      const [xs, ys] = token.trim().split(' ');
      const x: number = Number(xs);
      const y: number = Number(ys);
      if (xs === undefined || ys === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
        return [];
      }
      ring.push([x, y]);
    }
    rings.push(ring);
  }
  return rings;
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx: number = b[0] - a[0];
  const dy: number = b[1] - a[1];
  const len2: number = dx * dx + dy * dy;
  if (len2 === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  const t: number = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker over an open polyline; keeps both ends. */
function rdp(points: readonly Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) {
    return [...points];
  }
  const keep: boolean[] = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number];
    let worst = -1;
    let worstDist = tolerance;
    for (let i = lo + 1; i < hi; i++) {
      const d: number = distanceToSegment(points[i] as Pt, points[lo] as Pt, points[hi] as Pt);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = true;
      stack.push([lo, worst], [worst, hi]);
    }
  }
  return points.filter((_, i: number): boolean => keep[i] === true);
}

/** RDP for a CLOSED ring: split at the point farthest from the first so no corner is pinned by the arbitrary start. */
function simplifyRing(ring: readonly Pt[], tolerance: number): Pt[] {
  if (ring.length < 4) {
    return [...ring];
  }
  const first: Pt = ring[0] as Pt;
  let far = 0;
  let farDist = -1;
  for (let i = 1; i < ring.length; i++) {
    const p: Pt = ring[i] as Pt;
    const d: number = Math.hypot(p[0] - first[0], p[1] - first[1]);
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  const a: Pt[] = rdp(ring.slice(0, far + 1), tolerance);
  const b: Pt[] = rdp([...ring.slice(far), first], tolerance);
  return [...a, ...b.slice(1, -1)];
}

function ringArea(ring: readonly Pt[]): number {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const p: Pt = ring[i] as Pt;
    const q: Pt = ring[j] as Pt;
    twice += q[0] * p[1] - p[0] * q[1];
  }
  return Math.abs(twice) / 2;
}

const half = (v: number): number => Math.round(v * 2) / 2;
const num = (v: number): string => String(v);

function ringToPath(ring: readonly Pt[]): string {
  return `M${ring.map((p: Pt): string => `${num(p[0])} ${num(p[1])}`).join('L')}Z`;
}

/** Rounds to 0.5 px and removes consecutive duplicates (including the closing one). */
function roundRing(ring: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of ring) {
    const r: Pt = [half(p[0]), half(p[1])];
    const last: Pt | undefined = out[out.length - 1];
    if (last === undefined || last[0] !== r[0] || last[1] !== r[1]) {
      out.push(r);
    }
  }
  const head: Pt | undefined = out[0];
  const tail: Pt | undefined = out[out.length - 1];
  if (out.length > 1 && head !== undefined && tail !== undefined && head[0] === tail[0] && head[1] === tail[1]) {
    out.pop();
  }
  return out;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
}

/**
 * SAM mask -> `M x y L x y ... Z` outline (one subpath per ring; fill-rule even-odd keeps holes) in absolute image pixels,
 * or null when the mask cannot be decoded, does not match its box, or the outline cannot fit `maxChars`.
 */
export function maskToOutline(mask: SamMask, box: OutlineBox, options: OutlineOptions = {}): string | null {
  try {
    const limit: number = Math.min(OUTLINE_MAX_CHARS, options.maxChars ?? OUTLINE_MAX_CHARS);
    const boxW: number = box.x2 - box.x1 + 1;
    const boxH: number = box.y2 - box.y1 + 1;
    if (![box.x1, box.y1, box.x2, box.y2].every(Number.isInteger) || !isPositiveInt(boxW) || !isPositiveInt(boxH)) {
      return null;
    }
    // The raster is box-local: a mask whose size is not the box's belongs to something else and would be mis-placed.
    if (mask.width !== boxW || mask.height !== boxH) {
      return null;
    }
    // The payload keeps its marker (`~` lossless, `!` one_bit); a marker that disagrees with the declared encoding is a corrupt record.
    const marker: string = mask.payload.charAt(0);
    if ((mask.encoding === 'lossless' && marker !== '~') || (mask.encoding === 'one_bit' && marker !== '!')) {
      return null;
    }
    const svg: string = decodeMaskToSVGPath({
      encoding: mask.encoding,
      payload: mask.payload,
      width: mask.width,
      height: mask.height,
    });
    if (typeof svg !== 'string' || svg === '') {
      return null;
    }
    const placed: Array<{ ring: Pt[]; area: number }> = [];
    for (const raw of parseRings(svg)) {
      const moved: Pt[] = raw.map((p: Pt): Pt => [p[0] + box.x1 + 0.5, p[1] + box.y1 + 0.5]);
      const ring: Pt[] = roundRing(simplifyRing(moved, OUTLINE_TOLERANCE_PX));
      if (ring.length < 3) {
        continue;
      }
      const area: number = ringArea(ring);
      if (area >= MIN_RING_AREA) {
        placed.push({ ring, area });
      }
    }
    if (placed.length === 0) {
      return null;
    }
    placed.sort((a, b): number => b.area - a.area);
    let kept: string = '';
    for (const { ring } of placed.slice(0, MAX_RINGS)) {
      const next: string = kept + ringToPath(ring);
      if (next.length > limit) {
        break; // the smaller rings that follow cannot fit either way round; keep what already fits
      }
      kept = next;
    }
    return kept === '' ? null : kept;
  } catch {
    return null;
  }
}
