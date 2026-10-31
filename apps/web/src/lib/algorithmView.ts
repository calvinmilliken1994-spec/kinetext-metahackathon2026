// Stage 8a slice W-A: the algorithm tracer's view model (docs/specs/STAGE-8a-subject-engines.md §1a, §4).
// Pure. Our engine (packages/kit-engines traceAlgorithm) runs the algorithm; this file only READS its frames: which
// cells to mark, what the class predicts before a frame and which later frame shows the answer. It never re-runs a
// comparison of its own, except one documented fallback for a binary-search range that emptied (see halfOf).
import type { AlgorithmId, AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import { traceAlgorithm } from '../../../../packages/kit-engines/algorithms.ts';
import type { AlgoFrame, AlgoOp, AlgoTrace } from '../../../../packages/kit-engines/algorithms.ts';

/** How many predict points a lesson (and a presentation beat) walks through; the rest of the trace plays without asking. */
export const ALGORITHM_PRESENT_MAX = 8;

export function algorithmTrace(spec: Pick<AlgorithmTraceSpec, 'algorithm' | 'input' | 'hasTarget' | 'target'>): AlgoTrace {
  return traceAlgorithm(spec.algorithm, spec.input, spec.hasTarget ? spec.target : null, KIT_LIMITS.algorithm.maxFrames);
}

export const isSearch = (id: AlgorithmId): boolean => id === 'binary-search' || id === 'linear-search';

// ---- predict points ----------------------------------------------------------------------------------------------------

export type PredictKind = 'swap' | 'land' | 'min-into' | 'merge-next' | 'pivot-land' | 'half' | 'match';
export interface PredictOption { id: string; label: string }
export interface PredictPoint {
  kind: PredictKind;
  /** The frame the class sees while predicting (the answer is not on it). */
  ask: number;
  /** The frame that shows the answer (may equal `ask` when nothing moves, e.g. "no swap"). */
  reveal: number;
  question: string;
  options: PredictOption[];
  /** The id of the right option. */
  answer: string;
  /** One plain sentence said on reveal. */
  outcome: string;
  /** Positions the options stand for (the "land" kinds), so the board can label them. */
  positions: number[] | null;
}

const YES_NO_SWAP: PredictOption[] = [{ id: 'yes', label: 'Yes, they swap' }, { id: 'no', label: 'No, they stay' }];
const YES_NO_MATCH: PredictOption[] = [{ id: 'yes', label: 'Yes, found it' }, { id: 'no', label: 'No, keep looking' }];
const HALVES: PredictOption[] = [{ id: 'left', label: 'The left half' }, { id: 'found', label: 'It is the target' }, { id: 'right', label: 'The right half' }];

const at = (f: AlgoFrame | undefined, i: number | undefined): number => (f === undefined || i === undefined ? 0 : (f.array[i] ?? 0));
const range = (lo: number, hi: number): number[] => Array.from({ length: Math.max(0, hi - lo + 1) }, (_v, k) => lo + k);
const positionOptions = (ps: readonly number[]): PredictOption[] => ps.map((p) => ({ id: String(p), label: `Position ${p}` }));

interface Span { start: number; end: number }
export interface InsertionSpan extends Span { keyIndex: number; lastWrite: number | null }
export interface SelectionPass extends Span { pass: number; swap: number | null }
export interface Partition extends Span { pivotIndex: number; lo: number; hi: number; landing: number; landFrame: number; pivotSwap: number | null }

/** Frames [start, end] that belong to one key of insertion sort: a key starts when a compare reaches a new right index. */
export function insertionSpans(frames: readonly AlgoFrame[]): InsertionSpan[] {
  const out: InsertionSpan[] = [];
  let key = 0;
  frames.forEach((f, k) => {
    if (f.op === 'compare' && (f.indices[1] ?? 0) > key) {
      key = f.indices[1] ?? 0;
      out.push({ start: k, end: k, keyIndex: key, lastWrite: null });
      return;
    }
    const cur = out[out.length - 1];
    if (cur === undefined || f.op === 'done') return;
    cur.end = k;
    if (f.op === 'write') cur.lastWrite = k;
  });
  return out;
}

/** Selection sort passes: a pass starts where the scanning index stops growing. */
export function selectionPasses(frames: readonly AlgoFrame[]): SelectionPass[] {
  const out: SelectionPass[] = [];
  let lastJ = Number.POSITIVE_INFINITY;
  frames.forEach((f, k) => {
    if (f.op === 'compare') {
      const j = f.indices[0] ?? 0;
      const fresh = out.length === 0 || j <= lastJ;
      lastJ = j;
      if (fresh) { out.push({ start: k, end: k, pass: j - 1, swap: null }); return; }
    }
    const cur = out[out.length - 1];
    if (cur === undefined || f.op === 'done') return;
    cur.end = k;
    if (f.op === 'swap') cur.swap = k;
  });
  return out;
}

/** Quicksort partitions: from a pivot frame to the frame before the next pivot (or the end). */
export function quicksortPartitions(frames: readonly AlgoFrame[]): Partition[] {
  const out: Partition[] = [];
  frames.forEach((f, k) => {
    if (f.op === 'pivot') {
      const hi = f.indices[0] ?? 0;
      out.push({ start: k, end: k, pivotIndex: hi, lo: f.range?.[0] ?? hi, hi, landing: hi, landFrame: k, pivotSwap: null });
      return;
    }
    const cur = out[out.length - 1];
    if (cur === undefined || f.op === 'done') return;
    cur.end = k;
    // The pivot's own swap moves it from the end of the range into its final place; without one it stays at the end.
    if (f.op === 'swap' && f.indices[1] === cur.pivotIndex) { cur.landing = f.indices[0] ?? cur.landing; cur.pivotSwap = k; }
    cur.landFrame = cur.pivotSwap ?? k;
  });
  return out;
}

export interface MergeTray { lo: number; mid: number; hi: number; left: number[]; right: number[]; li: number; rj: number }

/**
 * The two sorted halves a merge is reading, and how far into each it is. The engine merges from copies of the halves while
 * it overwrites the array, so the halves are taken from the array just before the merge began (the frame before its first
 * compare or write), and each write is matched to the side whose front item it copied.
 */
export function mergeTray(frames: readonly AlgoFrame[], f: number): MergeTray | null {
  const fr = frames[f];
  if (fr === undefined || fr.range === null || !(fr.op === 'compare' || fr.op === 'write' || fr.op === 'merge')) return null;
  const [lo, hi] = fr.range;
  const same = (x: AlgoFrame | undefined): boolean => x !== undefined && x.range !== null && x.range[0] === lo && x.range[1] === hi;
  const inMerge = (x: AlgoFrame | undefined): boolean => same(x) && (x?.op === 'compare' || x?.op === 'write');
  let s = fr.op === 'merge' ? f - 1 : f;
  while (s - 1 >= 0 && inMerge(frames[s - 1])) s -= 1;
  let mid: number | null = null;
  for (let k = s - 1; k >= 0; k--) {
    const x = frames[k];
    if (x?.op === 'split' && same(x)) { mid = x.indices[0] ?? null; break; }
  }
  const snap = frames[s - 1];
  if (mid === null || snap === undefined) return null;
  const left = snap.array.slice(lo, mid);
  const right = snap.array.slice(mid, hi + 1);
  let li = 0;
  let rj = 0;
  const end = fr.op === 'merge' ? f - 1 : f;
  for (let k = s; k <= end; k++) {
    const x = frames[k];
    if (x === undefined) break;
    if (x.op === 'compare') { li = (x.indices[0] ?? lo) - lo; rj = (x.indices[1] ?? mid) - mid; }
    if (x.op === 'write') {
      const w = at(x, x.indices[0]);
      if (li < left.length && (rj >= right.length || w === left[li])) li += 1;
      else rj += 1;
    }
  }
  return { lo, mid, hi, left, right, li, rj };
}

/** Which way a binary-search compare sent the search. */
function halfOf(spec: Pick<AlgorithmTraceSpec, 'target'>, cur: AlgoFrame, next: AlgoFrame | undefined): 'left' | 'right' | 'found' {
  if (next?.op === 'found') return 'found';
  const mid = cur.indices[0] ?? 0;
  if (next?.range != null) return next.range[1] < mid ? 'left' : 'right';
  // The range emptied: an end of the old range tells the side, unless it held one item. Only then is the engine's own
  // rule (a target smaller than the middle value goes left) read off the frame's values.
  const [lo, hi] = cur.range ?? [mid, mid];
  if (mid === lo && mid !== hi) return 'left';
  if (mid === hi && mid !== lo) return 'right';
  return spec.target < at(cur, mid) ? 'left' : 'right';
}

/** Every predict point in the trace, in order (intervals [ask, reveal] never overlap). */
export function predictPoints(spec: AlgorithmTraceSpec, trace: AlgoTrace = algorithmTrace(spec)): PredictPoint[] {
  const fr = trace.frames;
  const out: PredictPoint[] = [];
  switch (spec.algorithm) {
    case 'bubble-sort':
      fr.forEach((f, k) => {
        if (f.op !== 'compare') return;
        const a = at(f, f.indices[0]);
        const b = at(f, f.indices[1]);
        const swap = fr[k + 1]?.op === 'swap';
        out.push({
          kind: 'swap', ask: k, reveal: swap ? k + 1 : k, question: `Will ${a} and ${b} swap?`, options: YES_NO_SWAP,
          answer: swap ? 'yes' : 'no', outcome: swap ? `Yes: ${a} and ${b} swap places.` : `No: ${a} and ${b} are already in order.`, positions: null,
        });
      });
      break;
    case 'insertion-sort':
      for (const sp of insertionSpans(fr)) {
        const f = fr[sp.start] as AlgoFrame;
        const key = at(f, sp.keyIndex);
        const landing = sp.lastWrite === null ? sp.keyIndex : (fr[sp.lastWrite]?.indices[0] ?? sp.keyIndex);
        const ps = range(0, sp.keyIndex);
        out.push({
          kind: 'land', ask: sp.start, reveal: sp.lastWrite ?? sp.start, question: `Where will ${key} land?`, options: positionOptions(ps),
          answer: String(landing),
          outcome: landing === sp.keyIndex ? `Position ${landing}: it stays, because nothing before it is larger.` : `Position ${landing}: the larger items shift right to make room.`,
          positions: ps,
        });
      }
      break;
    case 'selection-sort':
      for (const sp of selectionPasses(fr)) {
        const f = fr[sp.start] as AlgoFrame;
        const i = sp.pass;
        const value = sp.swap === null ? at(f, i) : at(fr[sp.swap], i);
        const seen = new Set<number>();
        const options: PredictOption[] = [];
        for (const v of f.array.slice(i)) if (!seen.has(v)) { seen.add(v); options.push({ id: String(v), label: String(v) }); }
        out.push({
          kind: 'min-into', ask: sp.start, reveal: sp.swap ?? sp.end, question: `Which value ends up at position ${i}?`, options,
          answer: String(value), outcome: `${value}: the smallest value from position ${i} on.`, positions: null,
        });
      }
      break;
    case 'merge-sort':
      fr.forEach((f, k) => {
        if (f.op !== 'compare') return;
        const tray = mergeTray(fr, k);
        if (tray === null) return;
        const lv = tray.left[tray.li] ?? 0;
        const rv = tray.right[tray.rj] ?? 0;
        const w = at(fr[k + 1], fr[k + 1]?.indices[0]);
        const side = w === lv ? 'left' : 'right';
        out.push({
          kind: 'merge-next', ask: k, reveal: k + 1, question: `Which goes down next: ${lv} from the left or ${rv} from the right?`,
          options: [{ id: 'left', label: `${lv} from the left` }, { id: 'right', label: `${rv} from the right` }], answer: side,
          outcome: lv === rv ? `${lv} from the left: on a tie the left item goes first.` : side === 'left' ? `${lv} from the left: the smaller front item goes down first.` : `${rv} from the right: the smaller front item goes down first.`,
          positions: null,
        });
      });
      break;
    case 'quicksort':
      for (const sp of quicksortPartitions(fr)) {
        const f = fr[sp.start] as AlgoFrame;
        const pivot = at(f, sp.pivotIndex);
        const ps = range(sp.lo, sp.hi);
        out.push({
          kind: 'pivot-land', ask: sp.start, reveal: sp.landFrame, question: `Where will the pivot ${pivot} settle?`, options: positionOptions(ps),
          answer: String(sp.landing), outcome: `Position ${sp.landing}: everything before it is at most ${pivot}, everything after it is larger.`, positions: ps,
        });
      }
      break;
    case 'binary-search':
      fr.forEach((f, k) => {
        if (f.op !== 'compare') return;
        const v = at(f, f.indices[0]);
        const side = halfOf(spec, f, fr[k + 1]);
        out.push({
          kind: 'half', ask: k, reveal: k + 1, question: `The middle item is ${v}. Where does the search for ${spec.target} go next?`, options: HALVES,
          answer: side,
          outcome: side === 'found' ? `Found: ${v} is the target.` : side === 'left' ? `The left half: ${spec.target} is smaller than ${v}.` : `The right half: ${spec.target} is larger than ${v}.`,
          positions: null,
        });
      });
      break;
    case 'linear-search':
      fr.forEach((f, k) => {
        if (f.op !== 'compare') return;
        const i = f.indices[0] ?? 0;
        const v = at(f, i);
        const found = fr[k + 1]?.op === 'found';
        out.push({
          kind: 'match', ask: k, reveal: found ? k + 1 : k, question: `Is ${v} the target ${spec.target}?`, options: YES_NO_MATCH,
          answer: found ? 'yes' : 'no', outcome: found ? `Yes: ${spec.target} is at position ${i}.` : `No: ${v} is not ${spec.target}, so the search moves on.`, positions: null,
        });
      });
      break;
  }
  return out;
}

/** The predict points a lesson walks through: the first ALGORITHM_PRESENT_MAX. */
export function teachingPoints(spec: AlgorithmTraceSpec, trace?: AlgoTrace): PredictPoint[] {
  return predictPoints(spec, trace).slice(0, ALGORITHM_PRESENT_MAX);
}

/** How many presenter steps (→ presses inside the part's presentation beat) this view uses; 1 = a single stage. */
export function algorithmPresentationSteps(spec: AlgorithmTraceSpec): number {
  try {
    return Math.max(1, teachingPoints(spec).length);
  } catch {
    return 1;
  }
}

/** Presentation step k shows predict point k at its ask frame; revealed shows its reveal frame. */
export function presentationFrame(spec: AlgorithmTraceSpec, step: number, revealed: boolean, trace?: AlgoTrace): { point: number; frame: number } {
  const points = teachingPoints(spec, trace);
  if (points.length === 0) return { point: -1, frame: 0 };
  const k = Math.min(points.length - 1, Math.max(0, Math.floor(step)));
  const p = points[k] as PredictPoint;
  return { point: k, frame: revealed ? p.reveal : p.ask };
}

export function gradeChoice(point: Pick<PredictPoint, 'answer'>, optionId: string): boolean {
  return point.answer === optionId;
}

// ---- the board at one frame --------------------------------------------------------------------------------------------

export type CellMark = 'none' | 'compare' | 'swap' | 'write' | 'pivot' | 'min' | 'found' | 'held' | 'slot' | 'pending';
export interface BoardCell {
  index: number;
  value: number;
  /** Bar height, 0..1 of the largest input value. */
  scale: number;
  mark: CellMark;
  /** In its final place. */
  settled: boolean;
  /** Outside the part still being worked on (a search's eliminated half, positions already checked). */
  out: boolean;
}
export interface BoardMarkers { lo: number | null; mid: number | null; hi: number | null; key: number | null; min: number | null; pivot: number | null }
export interface BoardView {
  frame: number;
  op: AlgoOp;
  note: string;
  comparisons: number;
  moves: number;
  cells: BoardCell[];
  /** The bracketed range: a search interval, a merge, or a partition. */
  range: [number, number] | null;
  /** Merge sort: the first position of the right half inside `range`. */
  split: number | null;
  markers: BoardMarkers;
  tray: MergeTray | null;
  done: boolean;
}

function settledSet(spec: AlgorithmTraceSpec, frames: readonly AlgoFrame[], f: number): Set<number> {
  const out = new Set<number>();
  const n = spec.input.length;
  const fr = frames[f];
  if (fr === undefined) return out;
  if (fr.op === 'done') {
    if (!isSearch(spec.algorithm)) for (let i = 0; i < n; i++) out.add(i);
    return out;
  }
  if (spec.algorithm === 'bubble-sort') {
    // Each finished pass leaves its last compared position in its final place.
    let seen = false;
    let passMax = -1;
    let from = n;
    for (let k = 0; k <= f; k++) {
      const x = frames[k] as AlgoFrame;
      if (x.op !== 'compare') continue;
      if (seen && x.indices[0] === 0) { from = passMax; passMax = -1; }
      seen = true;
      passMax = Math.max(passMax, x.indices[1] ?? 0);
    }
    for (let i = from; i < n; i++) out.add(i);
  } else if (spec.algorithm === 'selection-sort') {
    for (const p of selectionPasses(frames)) {
      if (p.start > f) break;
      for (let i = 0; i < p.pass; i++) out.add(i);
      if (p.swap !== null && p.swap <= f) out.add(p.pass);
    }
  } else if (spec.algorithm === 'quicksort') {
    for (const p of quicksortPartitions(frames)) if (p.landFrame <= f) out.add(p.landing);
  }
  return out;
}

export function boardAt(spec: AlgorithmTraceSpec, trace: AlgoTrace, f: number): BoardView {
  const frames = trace.frames;
  const k = Math.min(frames.length - 1, Math.max(0, f));
  const fr = frames[k] as AlgoFrame;
  const n = fr.array.length;
  const max = Math.max(1, ...spec.input);
  const marks: CellMark[] = Array.from({ length: n }, () => 'none');
  const out: boolean[] = Array.from({ length: n }, () => false);
  const markers: BoardMarkers = { lo: null, mid: null, hi: null, key: null, min: null, pivot: null };
  const values = fr.array.slice();
  let rangeShown: [number, number] | null = null;
  let split: number | null = null;
  let tray: MergeTray | null = null;
  const [i0, i1] = fr.indices;
  const mark = (i: number | undefined | null, m: CellMark): void => { if (i !== undefined && i !== null && i >= 0 && i < n) marks[i] = m; };
  const foundAtEnd = fr.op === 'done' && trace.foundIndex !== null;
  const missAtEnd = fr.op === 'not-found' || (fr.op === 'done' && trace.foundIndex === null);

  switch (spec.algorithm) {
    case 'binary-search': {
      const r = fr.op === 'done' || fr.op === 'not-found' ? null : fr.range;
      if (fr.op === 'compare' || fr.op === 'found') { mark(i0, fr.op === 'found' ? 'found' : 'compare'); markers.mid = i0 ?? null; }
      if (r !== null) {
        for (let i = 0; i < n; i++) out[i] = i < r[0] || i > r[1];
        rangeShown = r;
        markers.lo = r[0];
        markers.hi = r[1];
      } else if (fr.op === 'narrow' || missAtEnd) {
        out.fill(true);
      }
      break;
    }
    case 'linear-search':
      if (fr.op === 'compare' || fr.op === 'found') {
        const i = i0 ?? 0;
        for (let j = 0; j < i; j++) out[j] = true;
        mark(i, fr.op === 'found' ? 'found' : 'compare');
      } else if (missAtEnd) {
        out.fill(true);
      }
      break;
    case 'bubble-sort':
      if (fr.op === 'compare' || fr.op === 'swap') { mark(i0, fr.op); mark(i1, fr.op); }
      break;
    case 'selection-sort':
      if (fr.op === 'compare') { mark(i0, 'compare'); mark(i1, 'min'); markers.min = i1 ?? null; }
      if (fr.op === 'swap') { mark(i0, 'swap'); mark(i1, 'swap'); }
      break;
    case 'insertion-sort': {
      const sp = insertionSpans(frames).find((s) => s.start <= k && k <= s.end);
      if (sp !== undefined) {
        const key = at(frames[sp.start], sp.keyIndex);
        let hole: number | null = null;
        if (fr.op === 'compare') { hole = i1 ?? null; mark(i0, 'compare'); }
        if (fr.op === 'write') { mark(i0, 'write'); if (k !== sp.lastWrite) hole = (i0 ?? 1) - 1; }
        if (hole !== null && hole >= 0) { values[hole] = key; mark(hole, 'held'); markers.key = hole; }
      }
      break;
    }
    case 'merge-sort':
      if (fr.op === 'split') { rangeShown = fr.range; split = i0 ?? null; }
      if (fr.op === 'compare' || fr.op === 'write' || fr.op === 'merge') {
        rangeShown = fr.range;
        tray = mergeTray(frames, k);
        if (tray !== null && fr.op !== 'merge') {
          split = tray.mid;
          // The positions still to be filled hold stale copies (the merge reads from the two halves in the tray).
          const next = tray.lo + tray.li + tray.rj;
          if (fr.op === 'compare') mark(next, 'slot');
          for (let i = next + (fr.op === 'compare' ? 1 : 0); i <= tray.hi; i++) mark(i, 'pending');
        }
        if (fr.op === 'write') mark(i0, 'write');
      }
      break;
    case 'quicksort': {
      if (fr.range !== null && fr.op !== 'done') rangeShown = fr.range;
      const part = quicksortPartitions(frames).find((p) => p.start <= k && k <= p.end);
      if (part !== undefined) {
        const pivotMoved = part.pivotSwap !== null && k >= part.pivotSwap;
        markers.pivot = pivotMoved ? part.landing : part.pivotIndex;
        if (fr.op === 'swap' && k === part.pivotSwap) { mark(i1, 'swap'); mark(i0, 'pivot'); }
        else {
          mark(markers.pivot, 'pivot');
          if (fr.op === 'compare') mark(i0, 'compare');
          if (fr.op === 'swap') { mark(i0, 'swap'); mark(i1, 'swap'); }
        }
      }
      break;
    }
  }
  if (isSearch(spec.algorithm) && foundAtEnd) {
    for (let j = 0; j < n; j++) out[j] = j !== trace.foundIndex;
    mark(trace.foundIndex, 'found');
  }

  const settled = settledSet(spec, frames, k);
  const cells: BoardCell[] = values.map((value, index) => ({
    index, value, scale: value / max, mark: marks[index] ?? 'none', settled: settled.has(index), out: out[index] ?? false,
  }));
  return {
    frame: k, op: fr.op, note: fr.note, comparisons: fr.comparisons, moves: fr.moves, cells, range: rangeShown, split, markers, tray,
    done: fr.op === 'done',
  };
}

/** The two outer positions that trade places on a swap frame (the arc under the board), or null. */
export function swapPair(view: Pick<BoardView, 'op' | 'cells'>): readonly [number, number] | null {
  if (view.op !== 'swap') return null;
  const traded = view.cells.filter((c) => c.mark === 'swap' || c.mark === 'pivot').map((c) => c.index);
  if (traded.length < 2) return null;
  const lo = Math.min(...traded);
  const hi = Math.max(...traded);
  return lo === hi ? null : [lo, hi];
}

/** Rows the board keeps room for: the marker row (lo · mid · hi, key, min, pivot) and the swap-arc band. */
export interface BoardRooms { tags: boolean; swapArc: boolean }

/**
 * Which reserved rows this trace ever uses, read over every frame: a board reserves only those, so merge sort or bubble
 * sort carry no empty band, and because the answer is the same on every frame, stepping and revealing never move it.
 */
export function boardRooms(spec: AlgorithmTraceSpec, trace: AlgoTrace): BoardRooms {
  let tags = false;
  let swapArc = false;
  for (let f = 0; f < trace.frames.length && !(tags && swapArc); f++) {
    const v = boardAt(spec, trace, f);
    const m = v.markers;
    if (!tags && (m.lo ?? m.mid ?? m.hi ?? m.key ?? m.min ?? m.pivot) !== null) tags = true;
    if (!swapArc && swapPair(v) !== null) swapArc = true;
  }
  return { tags, swapArc };
}

// ---- words around the trace --------------------------------------------------------------------------------------------

/** What the second counter counts, in the engine's terms; null for searches (nothing moves). */
export function movesLabel(id: AlgorithmId): string | null {
  switch (id) {
    case 'bubble-sort': case 'selection-sort': case 'quicksort': return 'Swaps';
    case 'insertion-sort': return 'Moves';
    case 'merge-sort': return 'Writes';
    default: return null;
  }
}

/** A quiet note when our tracer fixes a choice the page leaves open. */
export function variantNote(id: AlgorithmId): string | null {
  switch (id) {
    case 'quicksort': return 'Our tracer shows one standard version: the last item of each range is the pivot.';
    case 'merge-sort': return 'Our tracer shows one standard version: split in half, sort each half, then merge them.';
    case 'bubble-sort': return 'Our tracer shows one standard version: it makes every pass, even after the list is in order.';
    default: return null;
  }
}

/** The one-line setup above the board, e.g. "Looking for 31 in 7 sorted numbers". */
export function traceLede(spec: Pick<AlgorithmTraceSpec, 'algorithm' | 'input' | 'hasTarget' | 'target'>): string {
  const n = spec.input.length;
  if (spec.algorithm === 'binary-search') return `Looking for ${spec.target} in ${n} sorted numbers`;
  if (spec.algorithm === 'linear-search') return `Looking for ${spec.target} in ${n} numbers, one at a time`;
  return `Sorting ${n} numbers from smallest to largest`;
}
