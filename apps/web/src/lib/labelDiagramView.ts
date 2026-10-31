// Label the diagram (label-diagram-v1, Stage 8b) view model (pure). The parts, points, printed-label boxes and SAM
// regions come from the spec (docs/specs/STAGE-8b-label-diagram.md); this file only scales that geometry to the rendered
// figure, decides what a presenter step shows, and checks a student's placements by name.
// Coordinates: part points and label boxes are normalised 0..1000 (Meta's perception grid); regions are image pixels.

import type { LabelDiagramSpec, LabelPartGen, LabelRegion } from '../../../../packages/contracts/kit.ts';
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
  /** Where the region's name tag sits: above the outline, or inside it when the outline touches the top edge. */
  tag: 'above' | 'inside';
  /** How far down its region the part's point sits (0 = top edge, 1 = bottom), so the tag can clear the marker. */
  pointDepth: number;
}

export function partViews(spec: Pick<LabelDiagramSpec, 'parts' | 'regions' | 'figure'>): PartView[] {
  return spec.parts.map((part, index) => {
    const r = spec.regions.find((x) => x.partId === part.id);
    const region = r === undefined ? null : pixelBoxPct(r, spec.figure);
    const point = pointPct(part);
    return {
      part, index, number: index + 1, name: aiLabel(part.name.trim()), point, region,
      confidence: r?.confidence ?? null, tag: region !== null && region.top < 6 ? 'inside' : 'above',
      pointDepth: region === null ? 0 : clamp((point.top - region.top) / region.height, 0, 1),
    };
  });
}

/** The figure's size on a slide: the image aspect inside a box of at most maxW × maxH (square when the size is unknown). */
export function stageFigureSize(figure: { width: number; height: number }, maxW: number, maxH: number): { width: number; height: number } {
  const W = figure.width > 0 ? figure.width : 1;
  const H = figure.height > 0 ? figure.height : 1;
  const k = Math.min(maxW / W, maxH / H);
  return { width: Math.round(W * k), height: Math.round(H * k) };
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
export function labelDiagramPresentationSteps(spec: Pick<LabelDiagramSpec, 'parts'>): number {
  return Math.max(1, spec.parts.length + (labelMasks(spec.parts).length > 0 ? 1 : 0));
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
export function stageView(spec: Pick<LabelDiagramSpec, 'parts'>, step: number, revealed: boolean): StageState {
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
export function stageQuestion(spec: Pick<LabelDiagramSpec, 'parts'>, step: number): { eyebrow: string; question: string } {
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
