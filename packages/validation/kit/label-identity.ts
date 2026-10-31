// Set A (reviews B-06 / W-01): bind a part NAME to the printed word of the slot its label box sits on.
// The figure library stores, per figure, the lead-verified printed-label boxes in image pixels; since
// Set A each box may carry the printed `text` and a `group` shared by the lines of ONE printed label.
// A part's own label box (0..1000 grid) is converted to pixels and compared with those boxes:
//   - the printed label (group = one unit) its box overlaps most is the part's slot; when Muse's box overlaps
//     none (real stored lessons put it up to ~30 px off the word), the nearest printed label within 10% of the
//     figure's longer side is the slot, as long as no other label is about as near;
//   - the part name must equal that label's text, joined over the group in reading order, after
//     normalisation (case, whitespace, hyphen/space, punctuation, one simple plural "s" per word). Narrowed on
//     the replay of stored lessons: a name that is a contiguous whole-word part of the printed label also passes
//     ("Runoff" on "Surface Runoff": four published water-cycle lessons); swapped or foreign names still fail;
//   - one part per printed label: two parts on the same label cannot both claim it;
//   - a box that sits on no printed label, or between two of them, cannot be bound and fails;
//   - a part without a box (all-zero sentinel), a malformed box (LD-05 owns it), a slot whose printed
//     text is unknown, or a figure whose stored boxes carry no text at all: rule not applicable.
// Pure and never throws; used by LD-02 (name-in-quote) in label-diagram.ts.

import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { LabelPartGen } from '../../contracts/kit.ts';
import type { FigureMeta } from '../../sources/figures.ts';

const COORD_MAX = KIT_LIMITS.labelDiagram.coordMax;

/** A part's box must cover at least this fraction of the smaller of (its box, the printed box) to count as sitting on it. */
const MIN_COVER_FRACTION = 0.3;

/** Without overlap, a printed label within this fraction of the figure's longer side counts as the slot (the web view's own reach). */
const NEAR_FRACTION = 0.1;
/** ...unless another label is nearer by less than this many pixels than the runner-up. */
const NEAR_MARGIN_PX = 5;

interface PxBox { x1: number; y1: number; x2: number; y2: number }

/** Plain comparison form of a printed label or part name. */
export function normalisePrintedLabel(text: unknown): string {
  if (typeof text !== 'string') return '';
  const words = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w !== '');
  // one simple plural "s" per word ("pairs" = "pair"), never "ss" and never short words ("gas").
  return words.map(w => (w.length >= 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)).join(' ');
}

/**
 * True when the part name is the printed label (normalised equality) or a contiguous whole-word part of it
 * ("runoff" in "surface runoff"). A name with other or reordered words never matches.
 */
export function nameMatchesPrinted(name: unknown, printed: string): boolean {
  const n = normalisePrintedLabel(name).split(' ').filter(w => w !== '');
  const p = normalisePrintedLabel(printed).split(' ').filter(w => w !== '');
  if (n.length === 0 || n.length > p.length) return false;
  for (let at = 0; at + n.length <= p.length; at++) {
    if (n.every((w, k) => p[at + k] === w)) return true;
  }
  return false;
}

function isBox(b: unknown): b is PxBox {
  const o = b as Record<string, unknown> | null | undefined;
  return !!o && ['x1', 'y1', 'x2', 'y2'].every(k => typeof o[k] === 'number' && Number.isFinite(o[k] as number));
}

function area(b: PxBox): number { return Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1); }

/** Distance from the CENTRE of box `a` to box `b` (0 when the centre lies inside b); how far a part's label box sits from a printed word. */
function gap(a: PxBox, b: PxBox): number {
  const cx = (a.x1 + a.x2) / 2;
  const cy = (a.y1 + a.y2) / 2;
  return Math.hypot(Math.max(b.x1 - cx, cx - b.x2, 0), Math.max(b.y1 - cy, cy - b.y2, 0));
}

function intersection(a: PxBox, b: PxBox): number {
  const w = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
  const h = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
  return w > 0 && h > 0 ? w * h : 0;
}

interface PrintedUnit {
  /** One printed label: the boxes of one group, or one ungrouped box. */
  members: { box: PxBox; text: string | undefined }[];
  /** The label's words in reading order, or null when no member carries text. */
  text: string | null;
}

/** Reading order of the member boxes: lines top to bottom, boxes of one line left to right. */
function readingOrder(members: { box: PxBox; text: string | undefined }[]): { box: PxBox; text: string | undefined }[] {
  const byTop = [...members].sort((a, b) => (a.box.y1 + a.box.y2) - (b.box.y1 + b.box.y2));
  const lines: { box: PxBox; text: string | undefined }[][] = [];
  for (const m of byTop) {
    const cy = (m.box.y1 + m.box.y2) / 2;
    const line = lines.find(l => {
      const ref = l[0]!.box;
      const tol = 0.5 * Math.min(ref.y2 - ref.y1, m.box.y2 - m.box.y1);
      return Math.abs((ref.y1 + ref.y2) / 2 - cy) < tol;
    });
    if (line === undefined) lines.push([m]); else line.push(m);
  }
  return lines.flatMap(l => l.sort((a, b) => a.box.x1 - b.box.x1 || a.box.x2 - b.box.x2));
}

/** The printed labels of a figure (units), or null when no stored box carries text (rule not applicable). */
export function printedUnits(figure: FigureMeta | null | undefined): PrintedUnit[] | null {
  const boxes = Array.isArray(figure?.labelBoxes) ? figure!.labelBoxes! : [];
  if (!boxes.some(b => isBox(b) && typeof b.text === 'string' && b.text !== '')) return null;
  const byGroup = new Map<number, PrintedUnit['members']>();
  const units: PrintedUnit[] = [];
  for (const b of boxes) {
    if (!isBox(b)) continue;
    const member = { box: { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 }, text: typeof b.text === 'string' && b.text !== '' ? b.text : undefined };
    if (typeof b.group === 'number' && Number.isInteger(b.group)) {
      const list = byGroup.get(b.group) ?? [];
      list.push(member);
      byGroup.set(b.group, list);
    } else {
      units.push({ members: [member], text: member.text ?? null });
    }
  }
  for (const members of byGroup.values()) {
    const texts = readingOrder(members).map(m => m.text).filter((t): t is string => t !== undefined);
    units.push({ members, text: texts.length > 0 ? texts.join(' ') : null });
  }
  return units;
}

export interface PrintedLabelProblems {
  problems: string[];
  /** Validator-owned JSON pointers into the gen: each offending part's name and its four label-box edges. */
  affected: string[];
}

/**
 * The printed-label identity problems of `parts` on `figure`. Empty when the figure's stored boxes carry no
 * text. Part boxes are on the 0..1000 grid; the figure's stored boxes are image pixels.
 */
export function printedLabelProblems(parts: readonly LabelPartGen[], figure: FigureMeta | null | undefined): PrintedLabelProblems {
  const out: PrintedLabelProblems = { problems: [], affected: [] };
  const units = printedUnits(figure);
  const width = figure?.width;
  const height = figure?.height;
  if (units === null || typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return out;
  const flag = (i: number, message: string): void => {
    out.problems.push(message);
    out.affected.push(`/parts/${i}/name`, `/parts/${i}/labelX1`, `/parts/${i}/labelY1`, `/parts/${i}/labelX2`, `/parts/${i}/labelY2`);
  };
  const slotOf = new Map<number, number>(); // unit index -> first part index
  parts.forEach((part, i) => {
    const edges: unknown[] = [part?.labelX1, part?.labelY1, part?.labelX2, part?.labelY2];
    if (edges.every(e => e === 0)) return; // no printed label claimed
    if (!edges.every(e => typeof e === 'number' && Number.isFinite(e))) return; // LD-05 owns junk shapes
    const [gx1, gy1, gx2, gy2] = edges as number[];
    if (!(gx1! < gx2! && gy1! < gy2!)) return;
    const box: PxBox = { x1: (gx1! * width) / COORD_MAX, y1: (gy1! * height) / COORD_MAX, x2: (gx2! * width) / COORD_MAX, y2: (gy2! * height) / COORD_MAX };
    const nameShown = typeof part?.name === 'string' && part.name !== '' ? `"${part.name}"` : `parts[${i}]`;
    // 1) overlap: the unit whose boxes the part's box covers most.
    const overlapped = units.map((u, k) => {
      let score = 0;
      for (const m of u.members) {
        const inter = intersection(box, m.box);
        const cover = inter / Math.max(1e-9, Math.min(area(box), area(m.box)));
        if (cover >= MIN_COVER_FRACTION && inter > score) score = inter;
      }
      return { u, k, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);
    let best: { u: PrintedUnit; k: number };
    if (overlapped.length > 0) {
      if (overlapped.length > 1 && overlapped[1]!.u.text !== null && overlapped[0]!.u.text !== null) {
        flag(i, `parts[${i}]: the label box of ${nameShown} covers two printed labels ("${overlapped[0]!.u.text}" and "${overlapped[1]!.u.text}"); the box must surround the one printed label of this part`);
        return;
      }
      best = overlapped[0]!;
    } else {
      // 2) nearest: a box that misses the word by a few pixels still belongs to the printed label next to it.
      const reach = NEAR_FRACTION * Math.max(width, height);
      const near = units.map((u, k) => ({ u, k, d: Math.min(...u.members.map(m => gap(box, m.box))) })).filter(x => x.d <= reach).sort((a, b) => a.d - b.d);
      if (near.length === 0) {
        flag(i, `parts[${i}]: the name ${nameShown} is written on a label box that covers no printed label of the figure; the box (image pixel ${Math.round(box.x1)},${Math.round(box.y1)}-${Math.round(box.x2)},${Math.round(box.y2)}) must sit on the word the figure prints for this part`);
        return;
      }
      if (near.length > 1 && near[1]!.d - near[0]!.d < NEAR_MARGIN_PX && near[0]!.u.text !== null && near[1]!.u.text !== null) {
        flag(i, `parts[${i}]: the label box of ${nameShown} sits between two printed labels ("${near[0]!.u.text}" and "${near[1]!.u.text}"); the box must sit on the one printed label of this part`);
        return;
      }
      best = near[0]!;
    }
    if (best.u.text === null) return; // printed words of this slot are not transcribed: cannot compare
    const printed = best.u.text;
    if (!nameMatchesPrinted(part?.name, printed)) {
      flag(i, `parts[${i}]: the name ${nameShown} does not match the printed label \"${printed}\" found in its slot (label box over that word); name the part exactly as the figure prints it (\"${printed}\") or move the label box onto the printed word of ${nameShown}`);
    }
    const first = slotOf.get(best.k);
    if (first === undefined) slotOf.set(best.k, i);
    else flag(i, `parts[${i}] (${nameShown}) sits on the same printed label \"${printed}\" as parts[${first}]; there is exactly one part per printed label, so give each part its own printed word`);
  });
  return out;
}
