// Label the diagram (label-diagram-v1, Stage 8b) view model (pure). The parts, points, printed-label boxes and SAM
// regions come from the spec (docs/specs/STAGE-8b-label-diagram.md); this file only scales that geometry to the rendered
// figure, decides what a presenter step shows, and checks a student's placements by name.
// Coordinates: part points and label boxes are normalised 0..1000 (Meta's perception grid); regions are image pixels.

import type { LabelDiagramSpec, LabelFigureRef, LabelPartGen, LabelRegion } from '../../../../packages/contracts/kit.ts';
import { aiLabel } from './displayText.ts';
import type { QuoteLike } from './linking.ts';
import { seededOrder } from './seeded.ts';

/** The normalised grid the model writes points and label boxes on. */
export const GRID = 1000;

/** Grid units a label cover reaches past the printed label above and below (labels drawn with anti-aliased edges). */
export const MASK_PAD = 8;
/** Grid units a label cover reaches past the printed label left and right: model boxes tend to stop short of a word's end. */
export const MASK_PAD_X = 16;

/** A box as percentages of the rendered figure (left/top/width/height), so it scales with any rendered size. */
export interface PctBox { left: number; top: number; width: number; height: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A normalised 0..1000 coordinate in rendered pixels along an axis of `size` px (clamped to the image). */
export function normToPx(v: number, size: number): number {
  return (clamp(v, 0, GRID) * size) / GRID;
}

/** A part's point in rendered pixels. */
export function pointPx(part: Pick<LabelPartGen, 'x' | 'y'>, size: { width: number; height: number }): { x: number; y: number } {
  return { x: normToPx(part.x, size.width), y: normToPx(part.y, size.height) };
}

/** A part's point as a percentage of the figure. */
export function pointPct(part: Pick<LabelPartGen, 'x' | 'y'>): { left: number; top: number } {
  return { left: clamp(part.x, 0, GRID) / 10, top: clamp(part.y, 0, GRID) / 10 };
}

/** A SAM pixel box as a percentage box of the figure (clamped to the image); null when empty or the size is unknown. */
export function pixelBoxPct(box: Pick<LabelRegion, 'x1' | 'y1' | 'x2' | 'y2'>, figure: { width: number; height: number }): PctBox | null {
  const W = figure.width;
  const H = figure.height;
  if (!(W > 0) || !(H > 0)) return null;
  const x1 = clamp(box.x1, 0, W);
  const x2 = clamp(box.x2, 0, W);
  const y1 = clamp(box.y1, 0, H);
  const y2 = clamp(box.y2, 0, H);
  if (!(x2 > x1) || !(y2 > y1)) return null;
  return { left: (x1 * 100) / W, top: (y1 * 100) / H, width: ((x2 - x1) * 100) / W, height: ((y2 - y1) * 100) / H };
}

type LabelBox = Pick<LabelPartGen, 'labelX1' | 'labelY1' | 'labelX2' | 'labelY2'>;

/** True when the part carries a well-formed printed-label box (all 0 means the figure prints no label for it). */
export function hasLabelBox(p: LabelBox): boolean {
  if (p.labelX1 === 0 && p.labelY1 === 0 && p.labelX2 === 0 && p.labelY2 === 0) return false;
  return p.labelX2 > p.labelX1 && p.labelY2 > p.labelY1;
}

export interface LabelMask { key: string; partIds: string[]; box: PctBox }

/**
 * One neutral cover per printed label, so the figure does not show its answers. Each cover reaches MASK_PAD_X / MASK_PAD
 * grid units past the label (clamped to the figure); when that padding would hide any part's point, the label's own box
 * is used.
 * Parts that point at the same printed box share one cover.
 */
export function labelMasks(parts: readonly LabelPartGen[]): LabelMask[] {
  const out: LabelMask[] = [];
  const byKey = new Map<string, LabelMask>();
  const covers = (x1: number, y1: number, x2: number, y2: number): boolean => parts.some((p) => p.x > x1 && p.x < x2 && p.y > y1 && p.y < y2);
  for (const p of parts) {
    if (!hasLabelBox(p)) continue;
    const key = `${p.labelX1},${p.labelY1},${p.labelX2},${p.labelY2}`;
    const seen = byKey.get(key);
    if (seen !== undefined) { seen.partIds.push(p.id); continue; }
    let x1 = clamp(p.labelX1 - MASK_PAD_X, 0, GRID);
    let y1 = clamp(p.labelY1 - MASK_PAD, 0, GRID);
    let x2 = clamp(p.labelX2 + MASK_PAD_X, 0, GRID);
    let y2 = clamp(p.labelY2 + MASK_PAD, 0, GRID);
    if (covers(x1, y1, x2, y2)) {
      x1 = clamp(p.labelX1, 0, GRID); y1 = clamp(p.labelY1, 0, GRID); x2 = clamp(p.labelX2, 0, GRID); y2 = clamp(p.labelY2, 0, GRID);
    }
    const mask: LabelMask = { key, partIds: [p.id], box: { left: x1 / 10, top: y1 / 10, width: (x2 - x1) / 10, height: (y2 - y1) / 10 } };
    byKey.set(key, mask);
    out.push(mask);
  }
  return out;
}

/** Image pixels a stored (lead-verified) label cover reaches past its box: the box is tight around the glyphs. */
export const FIGURE_COVER_PAD = 2;

type PixelBox = { x1: number; y1: number; x2: number; y2: number };

/**
 * Covers from the figure's stored printed-label boxes (`figure.labelBoxes`, image pixels, x2/y2 exclusive): one cover
 * per box, padded by FIGURE_COVER_PAD pixels and clamped to the image. When the padding would hide a part's point, the
 * box itself is used. Boxes that are empty after clamping are skipped. The covers name no part (`partIds` is empty):
 * they hide every printed word, not just the answers.
 */
export function figureLabelMasks(figure: Pick<LabelFigureRef, 'width' | 'height' | 'labelBoxes'>, parts: readonly Pick<LabelPartGen, 'x' | 'y'>[]): LabelMask[] {
  const W = figure.width;
  const H = figure.height;
  const boxes = figure.labelBoxes ?? [];
  if (!(W > 0) || !(H > 0)) return [];
  const points = parts.map((p) => ({ x: (clamp(p.x, 0, GRID) * W) / GRID, y: (clamp(p.y, 0, GRID) * H) / GRID }));
  const hides = (b: PixelBox): boolean => points.some((p) => p.x > b.x1 && p.x < b.x2 && p.y > b.y1 && p.y < b.y2);
  const out: LabelMask[] = [];
  boxes.forEach((b, i) => {
    if (!(b.x2 > b.x1) || !(b.y2 > b.y1)) return;
    const padded: PixelBox = { x1: b.x1 - FIGURE_COVER_PAD, y1: b.y1 - FIGURE_COVER_PAD, x2: b.x2 + FIGURE_COVER_PAD, y2: b.y2 + FIGURE_COVER_PAD };
    const box = pixelBoxPct(hides(padded) ? b : padded, figure);
    if (box !== null) out.push({ key: `figure-${i}`, partIds: [], box });
  });
  return out;
}

/** Where a lesson's label covers come from: the figure's stored boxes when it has any usable one, else Muse's part boxes. */
export function coverSource(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>): 'figure' | 'model' {
  return figureLabelMasks(spec.figure, spec.parts).length > 0 ? 'figure' : 'model';
}

/**
 * The covers a lesson draws over the figure until the reveal. With stored label boxes (`figure.labelBoxes`, lessons made
 * after Stage 8b live run 3) exactly those boxes are covered and Muse's per-part label boxes are not used; older lessons
 * fall back to Muse's boxes (labelMasks).
 */
export function coverMasks(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>): LabelMask[] {
  const fromFigure = figureLabelMasks(spec.figure, spec.parts);
  return fromFigure.length > 0 ? fromFigure : labelMasks(spec.parts);
}

// ---- label slots: the printed labels as a worksheet's blank boxes -------------------------------------------------------

/**
 * Two stored boxes belong to one multi-line printed label when the lower line starts within this fraction of a line
 * height below the upper one (and their columns overlap and align); a separate label sits a full line or more away.
 */
export const SLOT_STACK_GAP = 0.5;
/** A part's own label box is matched to a slot only within this fraction of the figure's longer side (centre to centre). */
export const SLOT_MATCH_MAX_DIST = 0.1;

const boxW = (b: PixelBox): number => b.x2 - b.x1;
const boxH = (b: PixelBox): number => b.y2 - b.y1;
const unionOf = (bs: readonly PixelBox[]): PixelBox => ({
  x1: Math.min(...bs.map((b) => b.x1)), y1: Math.min(...bs.map((b) => b.y1)), x2: Math.max(...bs.map((b) => b.x2)), y2: Math.max(...bs.map((b) => b.y2)),
});
const hidesPoint = (b: PixelBox, points: readonly { x: number; y: number }[]): boolean => points.some((p) => p.x > b.x1 && p.x < b.x2 && p.y > b.y1 && p.y < b.y2);

/** True when two boxes are one printed label: they overlap, or they are two lines stacked tight in one column. */
function sameLabel(a: PixelBox, b: PixelBox): boolean {
  const ix = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const iy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  if (ix > 0 && iy > 0) return true;
  const line = Math.min(boxH(a), boxH(b));
  const gap = Math.max(a.y1, b.y1) - Math.min(a.y2, b.y2);
  if (!(ix >= 0.5 * Math.min(boxW(a), boxW(b))) || gap < 0 || gap > SLOT_STACK_GAP * line) return false;
  const leftAligned = Math.abs(a.x1 - b.x1) <= line;
  const centred = Math.abs((a.x1 + a.x2) / 2 - (b.x1 + b.x2) / 2) <= line;
  return leftAligned || centred;
}

/**
 * Groups a figure's stored label boxes (image pixels) into printed labels: boxes that overlap (a word box inside its
 * line's box) or stack as lines of one label ("Sugar phosphate" over "backbone") join one group. A group whose joined
 * box would hide a part's point (`points`, image pixels) stays as separate boxes. Groups list box indexes in order and
 * are ordered by their first box.
 */
export function groupLabelBoxes(boxes: readonly PixelBox[], points: readonly { x: number; y: number }[]): number[][] {
  const usable = boxes.map((b) => b.x2 > b.x1 && b.y2 > b.y1);
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] as number; return i; };
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined || !usable[i] || !usable[j] || !sameLabel(a, b)) continue;
      const ri = find(i);
      const rj = find(j);
      if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
    }
  }
  const groups = new Map<number, number[]>();
  boxes.forEach((_, i) => {
    if (!usable[i]) return;
    const r = find(i);
    const g = groups.get(r);
    if (g === undefined) groups.set(r, [i]); else g.push(i);
  });
  const out: number[][] = [];
  for (const g of groups.values()) {
    if (g.length > 1 && hidesPoint(unionOf(g.map((i) => boxes[i] as PixelBox)), points)) out.push(...g.map((i) => [i]));
    else out.push(g);
  }
  return out.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
}

/** One printed label of the figure as a worksheet slot: covered, then (once its part is named) holding the part's name. */
export interface LabelSlot {
  key: string;
  /** The slot as a percentage box of the figure (the printed label's footprint, padded like a cover). */
  box: PctBox;
  /** The slot in image pixels (same box). */
  px: PixelBox;
  /** Indexes into `figure.labelBoxes` this slot covers. */
  boxes: number[];
  /** The part (spec order) whose name this slot holds, or null when no part names this printed label. */
  partIndex: number | null;
}

/**
 * The figure's printed labels as slots, each matched to at most one part. Only lessons with stored label boxes
 * (`figure.labelBoxes`) have slots; older lessons return [] and keep their covers and floating name tags.
 * Matching: each part's own label box (Muse's labelX1..Y2, 0..1000) against every slot's printed boxes; any overlap
 * beats any distance (larger overlap first), otherwise the nearest centre within SLOT_MATCH_MAX_DIST of the figure's
 * longer side. Pairs are taken best first, so a slot holds one part and a part one slot (ties go to the earlier part);
 * a part with no box, or none close enough, has no slot.
 */
export function labelSlots(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>): LabelSlot[] {
  const fig = spec.figure;
  const W = fig.width;
  const H = fig.height;
  const boxes = fig.labelBoxes ?? [];
  if (!(W > 0) || !(H > 0) || coverSource(spec) !== 'figure') return [];
  const points = spec.parts.map((p) => ({ x: (clamp(p.x, 0, GRID) * W) / GRID, y: (clamp(p.y, 0, GRID) * H) / GRID }));
  const slots: LabelSlot[] = [];
  for (const g of groupLabelBoxes(boxes, points)) {
    const raw = unionOf(g.map((i) => boxes[i] as PixelBox));
    const padded: PixelBox = { x1: raw.x1 - FIGURE_COVER_PAD, y1: raw.y1 - FIGURE_COVER_PAD, x2: raw.x2 + FIGURE_COVER_PAD, y2: raw.y2 + FIGURE_COVER_PAD };
    const use = hidesPoint(padded, points) ? raw : padded;
    const px: PixelBox = { x1: clamp(use.x1, 0, W), y1: clamp(use.y1, 0, H), x2: clamp(use.x2, 0, W), y2: clamp(use.y2, 0, H) };
    const box = pixelBoxPct(px, fig);
    if (box === null) continue;
    slots.push({ key: `slot-${g.join('-')}`, box, px, boxes: g, partIndex: null });
  }
  // candidate (part, slot) pairs with a cost: overlap first (−1 − IoU), else the centre distance as a fraction
  const maxDist = SLOT_MATCH_MAX_DIST * Math.max(W, H);
  const pairs: { part: number; slot: number; cost: number }[] = [];
  spec.parts.forEach((p, pi) => {
    if (!hasLabelBox(p)) return;
    const m: PixelBox = { x1: (clamp(p.labelX1, 0, GRID) * W) / GRID, y1: (clamp(p.labelY1, 0, GRID) * H) / GRID, x2: (clamp(p.labelX2, 0, GRID) * W) / GRID, y2: (clamp(p.labelY2, 0, GRID) * H) / GRID };
    slots.forEach((s, si) => {
      const printed = unionOf(s.boxes.map((i) => boxes[i] as PixelBox));
      const ix = Math.min(m.x2, printed.x2) - Math.max(m.x1, printed.x1);
      const iy = Math.min(m.y2, printed.y2) - Math.max(m.y1, printed.y1);
      if (ix > 0 && iy > 0) {
        const inter = ix * iy;
        pairs.push({ part: pi, slot: si, cost: -1 - inter / (boxW(m) * boxH(m) + boxW(printed) * boxH(printed) - inter) });
        return;
      }
      const d = Math.hypot((m.x1 + m.x2) / 2 - (printed.x1 + printed.x2) / 2, (m.y1 + m.y2) / 2 - (printed.y1 + printed.y2) / 2);
      if (d <= maxDist) pairs.push({ part: pi, slot: si, cost: d / Math.max(W, H) });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost || a.part - b.part || a.slot - b.slot);
  const partTaken = new Set<number>();
  for (const pr of pairs) {
    const s = slots[pr.slot];
    if (s === undefined || s.partIndex !== null || partTaken.has(pr.part)) continue;
    s.partIndex = pr.part;
    partTaken.add(pr.part);
  }
  return slots;
}

/** The slot holding each part's name (spec order), or null when the part has none (it gets a floating tag instead). */
export function slotOfPart(slots: readonly LabelSlot[], partCount: number): (number | null)[] {
  return Array.from({ length: partCount }, (_, i) => {
    const k = slots.findIndex((s) => s.partIndex === i);
    return k < 0 ? null : k;
  });
}

export type SlotState = 'covered' | 'named' | 'open';

/**
 * What each slot shows: 'covered' (a blank label slot), 'named' (its part's name written in), 'open' (the printed label
 * shows). `labelsShown` uncovers every slot (the slide's last step); `openUnmatched` uncovers the slots no part names
 * (the lesson's Show the answers, where those printed words give nothing away).
 */
export function slotStates(slots: readonly LabelSlot[], named: readonly boolean[], opts: { labelsShown: boolean; openUnmatched: boolean }): SlotState[] {
  return slots.map((s) => {
    if (opts.labelsShown) return 'open';
    if (s.partIndex === null) return opts.openUnmatched ? 'open' : 'covered';
    return named[s.partIndex] === true ? 'named' : 'covered';
  });
}

export interface SlotFit {
  /** Font size in the same px unit as the slot. */
  fontSize: number;
  /** One or two lines (a name never wraps past two). */
  lines: string[];
  /** False when even the minimum size overflows the slot (the view lets the name run past it, centred). */
  fits: boolean;
  /** Inline padding the fit kept on each side, and the line height (× font size) it assumed. */
  padX: number;
  lineHeight: number;
}

/** Every way to put a name on at most two lines: whole, or split at a space (or after a hyphen when it has no space). */
function lineOptions(name: string, maxLines: number): string[][] {
  const out: string[][] = [[name]];
  if (maxLines < 2) return out;
  const words = name.split(' ');
  if (words.length > 1) {
    for (let k = 1; k < words.length; k++) out.push([words.slice(0, k).join(' '), words.slice(k).join(' ')]);
  } else {
    for (let k = name.indexOf('-'); k > 0 && k < name.length - 1; k = name.indexOf('-', k + 1)) out.push([name.slice(0, k + 1), name.slice(k + 1)]);
  }
  return out;
}

/**
 * The largest font size (from `max` down to `min`, in 0.25 px steps) at which a name fits its slot on one line or, when
 * that is larger, two lines split at a space. `measure(text, px)` is the text's width at that font size. When nothing
 * fits at `min`, returns `min` with the narrowest split and `fits: false`.
 */
export function fitSlotText(
  name: string, slot: { w: number; h: number }, measure: (text: string, px: number) => number,
  opts: { min: number; max: number; maxLines?: number; lineHeight?: number },
): SlotFit {
  const lineHeight = opts.lineHeight ?? 1.15;
  const padX = clamp(slot.h * 0.15, 1, 4);
  const wAvail = Math.max(0, slot.w - 2 * padX);
  const hAvail = Math.max(0, slot.h - 2);
  const options = lineOptions(name.trim(), opts.maxLines ?? 2);
  const widest = (lines: string[], px: number): number => Math.max(...lines.map((l) => measure(l, px)));
  for (let px = opts.max; px >= opts.min - 1e-9; px -= 0.25) {
    let best: string[] | null = null;
    for (const lines of options) {
      if (lines.length * px * lineHeight > hAvail + 1e-9 || widest(lines, px) > wAvail + 1e-9) continue;
      if (best === null || lines.length < best.length) best = lines;
    }
    if (best !== null) return { fontSize: px, lines: best, fits: true, padX, lineHeight };
  }
  const narrowest = options.reduce((a, b) => (widest(b, opts.min) < widest(a, opts.min) ? b : a));
  return { fontSize: opts.min, lines: narrowest, fits: false, padX, lineHeight };
}

/**
 * Fits every slot's name at ONE shared font size, like a printed worksheet: the largest size at which every name that
 * fits at all still fits (each slot's own best fit, the smallest of those wins). A name that cannot fit even at `min`
 * keeps its own min-size fit. `null` entries (slots without a part) stay null.
 */
export function fitSlotTexts(
  items: readonly ({ name: string; w: number; h: number } | null)[], measure: (text: string, px: number) => number,
  opts: { min: number; max: number; maxLines?: number; lineHeight?: number },
): (SlotFit | null)[] {
  const own = items.map((it) => (it === null ? null : fitSlotText(it.name, it, measure, opts)));
  const sizes = own.filter((f): f is SlotFit => f !== null && f.fits).map((f) => f.fontSize);
  if (sizes.length === 0) return own;
  const shared = Math.min(...sizes);
  return items.map((it, i) => {
    const f = own[i] ?? null;
    if (it === null || f === null || !f.fits) return f;
    return fitSlotText(it.name, it, measure, { ...opts, max: shared });
  });
}

export interface PartView {
  part: LabelPartGen;
  index: number;
  /** The marker number on the figure (1-based, spec order). */
  number: number;
  /** The part's name as the slide shows it (sentence case). */
  name: string;
  point: { left: number; top: number };
  /** The SAM region around the part, or null when segmentation found none for it. */
  region: PctBox | null;
  confidence: number | null;
}

export function partViews(spec: Pick<LabelDiagramSpec, 'parts' | 'regions' | 'figure'>): PartView[] {
  return spec.parts.map((part, index) => {
    const r = spec.regions.find((x) => x.partId === part.id);
    const region = r === undefined ? null : pixelBoxPct(r, spec.figure);
    return { part, index, number: index + 1, name: aiLabel(part.name.trim()), point: pointPct(part), region, confidence: r?.confidence ?? null };
  });
}

// ---- name tags ---------------------------------------------------------------------------------------------------------

/** An axis-aligned rectangle in rendered pixels (any one consistent unit). */
export interface Rect { x: number; y: number; w: number; h: number }
export type TagSide = 'above' | 'below' | 'right' | 'left';
export interface TagPlacement {
  /** Top-left corner of the tag in the figure's rendered pixels. */
  x: number;
  y: number;
  side: TagSide;
  /** False when no position cleared every other tag, cover and marker (the least-overlapping one was used). */
  clear: boolean;
}
export interface TagLayoutInput {
  /** The rendered figure. */
  width: number;
  height: number;
  /** Side of a (square) marker, centred on its part's point. */
  marker: number;
  /** One per part, in spec order: the part's point and its name tag's size. */
  tags: readonly { x: number; y: number; w: number; h: number }[];
  /** Label covers (and anything else a tag must not sit on). */
  covers: readonly Rect[];
  /** Space kept between a tag and its marker, and between two tags. */
  gap?: number;
}

const SIDES: readonly TagSide[] = ['above', 'below', 'right', 'left'];
/** How many nudge steps each side tries before giving up on a clear position. */
export const TAG_NUDGES = 6;

const overlapArea = (a: Rect, b: Rect, gap = 0): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** True when the rectangles overlap (touching edges do not count). */
export function rectsOverlap(a: Rect, b: Rect): boolean {
  return overlapArea(a, b) > 0;
}

/**
 * Where each part's name tag sits on the revealed figure, so no two tags overlap and no tag sits on a label cover or a
 * marker, or leaves the figure. Deterministic: tags are placed in spec order; each tries, in a fixed order, above its
 * marker, below, right, left, then the same sides nudged step by step (sideways along the marker, then outwards), and
 * takes the first position that is clear of the figure's edges, the tags already placed, every cover and every marker.
 * When none is clear it takes the candidate inside the figure with the least overlap (tags first, then markers, then
 * covers) and says so (`clear: false`). Positions do not depend on which tags are shown, so revealing never moves one.
 */
export function placeTags(input: TagLayoutInput): TagPlacement[] {
  const { width: W, height: H, marker: m, tags, covers } = input;
  const gap = input.gap ?? Math.max(2, Math.round(m / 8));
  const half = m / 2;
  const markers: Rect[] = tags.map((t) => ({ x: t.x - half, y: t.y - half, w: m, h: m }));
  const placed: Rect[] = [];
  const out: TagPlacement[] = [];
  for (const t of tags) {
    const base = (side: TagSide): { x: number; y: number } => {
      switch (side) {
        case 'above': return { x: t.x - t.w / 2, y: t.y - half - gap - t.h };
        case 'below': return { x: t.x - t.w / 2, y: t.y + half + gap };
        case 'right': return { x: t.x + half + gap, y: t.y - t.h / 2 };
        case 'left': return { x: t.x - half - gap - t.w, y: t.y - t.h / 2 };
      }
    };
    // Sideways steps keep the tag beside its own marker (at most half the tag's length); outward steps lift it clear.
    const along = (side: TagSide): number => (side === 'above' || side === 'below' ? t.w : t.h) / (2 * TAG_NUDGES);
    const outStep = (side: TagSide): number => (side === 'above' || side === 'below' ? t.h : t.w / 4) / 2;
    const candidates: { side: TagSide; r: Rect }[] = [];
    const push = (side: TagSide, da: number, dout: number): void => {
      const b = base(side);
      const vertical = side === 'above' || side === 'below';
      const sign = side === 'above' || side === 'left' ? -1 : 1;
      const x = b.x + (vertical ? da : sign * dout);
      const y = b.y + (vertical ? sign * dout : da);
      candidates.push({ side, r: { x, y, w: t.w, h: t.h } });
    };
    for (const side of SIDES) push(side, 0, 0);
    for (let k = 1; k <= TAG_NUDGES; k++) {
      for (const side of SIDES) {
        const a = along(side) * k;
        push(side, a, 0);
        push(side, -a, 0);
      }
      for (const side of SIDES) {
        const o = outStep(side) * k;
        push(side, 0, o);
        push(side, along(side) * k, o);
        push(side, -along(side) * k, o);
      }
    }
    const inside = (r: Rect): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;
    const cost = (r: Rect): [number, number, number] => [
      placed.reduce((s, p) => s + overlapArea(r, p, gap), 0),
      markers.reduce((s, p) => s + overlapArea(r, p), 0),
      covers.reduce((s, p) => s + overlapArea(r, p), 0),
    ];
    let best: { side: TagSide; r: Rect; c: [number, number, number] } | null = null;
    let chosen: { side: TagSide; r: Rect; clear: boolean } | null = null;
    for (const c of candidates) {
      if (!inside(c.r)) continue;
      const k = cost(c.r);
      if (k[0] === 0 && k[1] === 0 && k[2] === 0) { chosen = { ...c, clear: true }; break; }
      if (best === null || k[0] < best.c[0] || (k[0] === best.c[0] && (k[1] < best.c[1] || (k[1] === best.c[1] && k[2] < best.c[2])))) best = { ...c, c: k };
    }
    if (chosen === null) {
      if (best !== null) chosen = { side: best.side, r: best.r, clear: false };
      else {
        // The tag is larger than the figure allows anywhere: above its marker, pulled inside the figure.
        const b = base('above');
        chosen = { side: 'above', r: { x: clamp(b.x, 0, Math.max(0, W - t.w)), y: clamp(b.y, 0, Math.max(0, H - t.h)), w: t.w, h: t.h }, clear: false };
      }
    }
    placed.push(chosen.r);
    out.push({ x: chosen.r.x, y: chosen.r.y, side: chosen.side, clear: chosen.clear });
  }
  return out;
}

/** The figure's size on a slide: the image aspect inside a box of at most maxW × maxH (square when the size is unknown). */
export function stageFigureSize(figure: { width: number; height: number }, maxW: number, maxH: number): { width: number; height: number } {
  const W = figure.width > 0 ? figure.width : 1;
  const H = figure.height > 0 ? figure.height : 1;
  const k = Math.min(maxW / W, maxH / H);
  return { width: Math.round(W * k), height: Math.round(H * k) };
}

/** The most a lesson enlarges a figure past its natural size (the page's figures are small raster images). */
export const LESSON_MAX_UPSCALE = 1.6;

/** The widest a lesson draws the figure: LESSON_MAX_UPSCALE × its natural width (null when the size is unknown). */
export function lessonFigureMaxWidth(figure: { width: number; height: number }): number | null {
  return figure.width > 0 ? Math.round(figure.width * LESSON_MAX_UPSCALE) : null;
}

// ---- word bank and answers -----------------------------------------------------------------------------------------

/** A name in the word bank; `token` is the id of the part the name came from. */
export interface BankWord { token: string; name: string }

/** Every part's name once, in a seeded order that never matches the marker order (so the bank gives nothing away). */
export function wordBank(spec: Pick<LabelDiagramSpec, 'id' | 'parts'>): BankWord[] {
  return seededOrder(spec.parts, `${spec.id}#bank`).map((p) => ({ token: p.id, name: aiLabel(p.name.trim()) }));
}

/** Which name (bank token) sits on which marker (part id). */
export type Placements = Readonly<Record<string, string>>;

/** Put a name on a marker. A name sits on one marker only (it moves); a name already on that marker goes back to the bank. */
export function place(placements: Placements, token: string, markerId: string): Placements {
  const next: Record<string, string> = {};
  for (const [m, t] of Object.entries(placements)) if (t !== token && m !== markerId) next[m] = t;
  next[markerId] = token;
  return next;
}

/** Take the name off a marker (back to the bank). */
export function unplace(placements: Placements, markerId: string): Placements {
  const next: Record<string, string> = { ...placements };
  delete next[markerId];
  return next;
}

const norm = (s: string): string => s.toLowerCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();

/** Two names are the same part name, ignoring case and spacing. */
export function sameName(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

export type MarkResult = 'right' | 'wrong' | 'empty';
export interface CheckResult { results: Record<string, MarkResult>; right: number; total: number; complete: boolean }

/** Right, wrong or empty per marker. Answers are compared by name, so two parts with the same name accept either. */
export function checkPlacements(spec: Pick<LabelDiagramSpec, 'parts'>, placements: Placements): CheckResult {
  const nameOf = new Map(spec.parts.map((p) => [p.id, p.name]));
  const results: Record<string, MarkResult> = {};
  let right = 0;
  for (const p of spec.parts) {
    const token = placements[p.id];
    const placed = token === undefined ? undefined : nameOf.get(token);
    const r: MarkResult = placed === undefined ? 'empty' : sameName(placed, p.name) ? 'right' : 'wrong';
    results[p.id] = r;
    if (r === 'right') right++;
  }
  return { results, right, total: spec.parts.length, complete: spec.parts.every((p) => results[p.id] !== 'empty') };
}

// ---- presentation --------------------------------------------------------------------------------------------------

/** How many presenter steps the view uses: one per part, plus one that uncovers the printed labels when there are any. */
export function labelDiagramPresentationSteps(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>): number {
  return Math.max(1, spec.parts.length + (coverMasks(spec).length > 0 ? 1 : 0));
}

export interface StageState {
  /** Per part (spec order): its name and outline are shown. */
  named: boolean[];
  /** The part this step asks about, or null on the labels step. */
  current: number | null;
  /** The step that uncovers the figure's printed labels. */
  final: boolean;
  /** The printed labels are uncovered. */
  labelsShown: boolean;
}

/** Step k asks about part k with the parts before it named; R names part k; the last step's R uncovers the labels. */
export function stageView(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>, step: number, revealed: boolean): StageState {
  const n = spec.parts.length;
  const s = clamp(Math.trunc(step), 0, labelDiagramPresentationSteps(spec) - 1);
  const final = n > 0 && s >= n;
  return {
    named: spec.parts.map((_, i) => final || i < s || (i === s && revealed)),
    current: final ? null : s,
    final,
    labelsShown: final && revealed,
  };
}

/**
 * The one SAM region a slide outlines: the part this step asks about (before and after R), none on the labels step.
 * Earlier parts keep their names but lose their outlines, so large overlapping regions never pile up.
 */
export function stageOutline(st: StageState): number | null {
  return st.final ? null : st.current;
}

/** The slide's question for a step: the marker number only, never a name. */
export function stageQuestion(spec: Pick<LabelDiagramSpec, 'parts' | 'figure'>, step: number): { eyebrow: string; question: string } {
  const n = spec.parts.length;
  const s = clamp(Math.trunc(step), 0, labelDiagramPresentationSteps(spec) - 1);
  if (n > 0 && s >= n) return { eyebrow: 'Last step', question: 'Now the figure’s own labels.' };
  return { eyebrow: `Part ${s + 1} of ${n}`, question: `Which part is number ${s + 1}?` };
}

/** The page sentence a revealed step puts in the quote zone: the named part's quote (the labels step has none). */
export function labelDiagramRevealQuote(spec: Pick<LabelDiagramSpec, 'parts'>, step: number): QuoteLike | null {
  const p = spec.parts[step];
  return p === undefined ? null : { sourceId: p.sourceId, quote: p.quote };
}
