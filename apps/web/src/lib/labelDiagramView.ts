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
