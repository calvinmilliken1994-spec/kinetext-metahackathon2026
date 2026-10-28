// Timeline-v1 view model (pure). The source text is the oracle: dates come from the spec's events, and every
// order, answer and grade shown to a learner is recomputed here from those dates. The spec's array order and its
// stored earlier/later ids are never trusted as the answer.

import type { ActivitySpec, TimelineActivitySpec, TimelineCase, TimelineEvent } from '../../../../packages/contracts/index.ts';

/** Any activity spec the workspace can display: the seven numeric engines or a timeline. */
export type AnyActivitySpec = ActivitySpec | TimelineActivitySpec;

export function isTimelineSpec(spec: AnyActivitySpec | null | undefined): spec is TimelineActivitySpec {
  return (spec as { simulation?: { engine?: unknown } } | null | undefined)?.simulation?.engine === 'timeline-v1';
}

export type DateLike = Pick<TimelineEvent, 'year' | 'month' | 'day'>;
type Dated = DateLike & { id: string };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const validYear = (y: number): boolean => Number.isInteger(y) && y !== 0;
const validMonth = (m: number): boolean => Number.isInteger(m) && m >= 1 && m <= 12;
const validDay = (d: number): boolean => Number.isInteger(d) && d >= 1 && d <= 31;

/** The date as the source states it: 'June 10, 1776', 'July 1776', '1776', '500 BCE'. A day without a month is not shown. */
export function formatEventDate(d: DateLike): string {
  if (!validYear(d.year)) return 'date unavailable';
  const year = d.year < 0 ? `${-d.year} BCE` : String(d.year);
  if (!validMonth(d.month)) return year;
  const month = MONTHS[d.month - 1] ?? '';
  if (!validDay(d.day)) return `${month} ${year}`;
  // 'June 10, 1776' / 'March 15, 44 BCE'
  return `${month} ${d.day}, ${year}`;
}

type Tuple = readonly [number, number, number];

/** First and last day a stated date can mean: a year covers the whole year, a month the whole month. */
function span(d: DateLike): { start: Tuple; end: Tuple } {
  const m = validMonth(d.month) ? d.month : 0;
  const day = m !== 0 && validDay(d.day) ? d.day : 0;
  return { start: [d.year, m || 1, day || 1], end: [d.year, m || 12, day || 31] };
}

function tupleCompare(a: Tuple, b: Tuple): number {
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * -1 if `a` is strictly before `b`, 1 if strictly after, 0 if they cannot be strictly ordered (the same date, or one
 * is less precise and contains the other, such as '1776' and 'July 4, 1776'). This is comparison at the precision
 * both events state.
 */
export function compareEvents(a: DateLike, b: DateLike): -1 | 0 | 1 {
  const x = span(a);
  const y = span(b);
  if (tupleCompare(x.end, y.start) < 0) return -1;
  if (tupleCompare(y.end, x.start) < 0) return 1;
  return 0;
}

/** Events in date order, computed from the dates only. Ties: less precise first, then by id, so the result is stable. */
export function dateOrder<T extends Dated>(events: readonly T[]): T[] {
  const precision = (e: DateLike): number => (!validMonth(e.month) ? 0 : validDay(e.day) ? 2 : 1);
  return [...events].sort((a, b) => {
    const c = tupleCompare(span(a).start, span(b).start);
    if (c !== 0) return c;
    const p = precision(a) - precision(b);
    if (p !== 0) return p;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** True when at least two events cannot be strictly ordered (so either order between them is accepted). */
export function hasUnorderedPair(events: readonly DateLike[]): boolean {
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (compareEvents(events[i] as DateLike, events[j] as DateLike) === 0) return true;
    }
  }
  return false;
}

// ---- seeded shuffle -------------------------------------------------------------------------------------

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when `orderIds` lists every event exactly once and no event is strictly after one listed later. */
export function isValidOrder(events: readonly Dated[], orderIds: readonly string[]): boolean {
  if (orderIds.length !== events.length) return false;
  const byId = new Map(events.map((e) => [e.id, e] as const));
  if (byId.size !== events.length || new Set(orderIds).size !== orderIds.length) return false;
  const seq: Dated[] = [];
  for (const id of orderIds) {
    const e = byId.get(id);
    if (e === undefined) return false;
    seq.push(e);
  }
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      if (compareEvents(seq[i] as Dated, seq[j] as Dated) === 1) return false;
    }
  }
  return true;
}

/**
 * Deterministic shuffle for the put-in-order activity. The same seed (the spec id) always gives the same start, so a
 * lecture demo is reproducible, and the start is never an already-correct order (unless every pair of dates is tied,
 * when no wrong order exists).
 */
export function seededShuffle<T extends Dated>(events: readonly T[], seed: string): T[] {
  const n = events.length;
  if (n < 2) return [...events];
  for (let attempt = 0; attempt < 64; attempt++) {
    const rng = mulberry32(hash32(`${seed}#${attempt}`));
    const out = [...events];
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j] as T, out[i] as T];
    }
    if (!isValidOrder(events, out.map((e) => e.id))) return out;
  }
  const reversed = dateOrder(events).reverse();
  return isValidOrder(events, reversed.map((e) => e.id)) ? [...events] : reversed;
}

/** Move the item at `from` to index `to` (clamped); returns a new array and never mutates the input. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (!Number.isInteger(from) || from < 0 || from >= out.length) return out;
  const target = Math.min(out.length - 1, Math.max(0, Math.trunc(to)));
  if (target === from) return out;
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item as T);
  return out;
}

// ---- grading an order -------------------------------------------------------------------------------------

/** Two cards the learner put the wrong way round: `firstId` is listed above `secondId` but its date is strictly later. */
export interface WrongPair { firstId: string; secondId: string }

export interface OrderGrade {
  /** Events in the activity. */
  total: number;
  /** Positions (aligned to the learner's order) whose card is part of no wrong pair. */
  positions: boolean[];
  /** Cards that are part of no wrong pair. */
  rightCount: number;
  /** The whole order is consistent with the dates. */
  correct: boolean;
  /** Every pair that is strictly ordered by the dates but listed the wrong way round, in the learner's list order. */
  wrongPairs: WrongPair[];
  /** The order computed from the dates (ties: less precise first). */
  correctOrderIds: string[];
}

/**
 * Grade a learner's order against the dates. The order is right when no pair of events that the dates strictly order
 * (comparable at the precision both state, and different) is listed the wrong way round; events whose dates cannot
 * be strictly ordered may be swapped freely. Feedback names the real wrong pairs: a card is marked only when it is
 * one end of such a pair, so a rejected order always shows at least one pair to fix and an accepted order marks nothing.
 */
export function gradeOrder(events: readonly Dated[], orderIds: readonly string[]): OrderGrade {
  const byId = new Map(events.map((e) => [e.id, e] as const));
  const wrongPairs: WrongPair[] = [];
  for (let i = 0; i < orderIds.length; i++) {
    for (let j = i + 1; j < orderIds.length; j++) {
      const a = byId.get(orderIds[i] as string);
      const b = byId.get(orderIds[j] as string);
      if (a !== undefined && b !== undefined && a.id !== b.id && compareEvents(a, b) === 1) wrongPairs.push({ firstId: a.id, secondId: b.id });
    }
  }
  const involved = new Set(wrongPairs.flatMap((w) => [w.firstId, w.secondId]));
  const positions = orderIds.map((id) => byId.has(id) && !involved.has(id));
  return {
    total: events.length, positions, rightCount: positions.filter(Boolean).length,
    correct: isValidOrder(events, orderIds), wrongPairs,
    correctOrderIds: dateOrder(events).map((e) => e.id),
  };
}

/** The ids of the cards `id` is the wrong way round with (empty when it is in no wrong pair). */
export function wrongPartners(grade: Pick<OrderGrade, 'wrongPairs'>, id: string): string[] {
  return grade.wrongPairs.flatMap((w) => (w.firstId === id ? [w.secondId] : w.secondId === id ? [w.firstId] : []));
}

/** Plain-language result line. Names the first wrong pair (and how many more) so a rejected order always says what to fix. */
export function orderSummary(grade: OrderGrade, labels: Readonly<Record<string, string>>): string {
  if (grade.correct) return `✓ Correct — all ${grade.total} events are in the right order.`;
  const name = (id: string): string => labels[id] ?? id;
  const first = grade.wrongPairs[0];
  const lead = `✗ ${grade.rightCount} of ${grade.total} events are in the right place.`;
  if (first === undefined) return `${lead} The order is incomplete or has an unknown card — check every event is in the list.`;
  const more = grade.wrongPairs.length - 1;
  const tail = more > 0 ? ` ${more} more ${more === 1 ? 'pair is' : 'pairs are'} marked too.` : '';
  return `${lead} “${name(first.firstId)}” and “${name(first.secondId)}” are the wrong way round.${tail} Move the marked cards and check again.`;
}

// ---- predictions ------------------------------------------------------------------------------------------

export interface PairPrediction { id: string; prompt: string; earlierEventId: string; laterEventId: string }

export type PairGrade =
  | { status: 'graded'; correct: boolean; pickedId: string; earlier: TimelineEvent; later: TimelineEvent }
  | { status: 'ungradable'; pickedId: string; first: TimelineEvent; second: TimelineEvent };

function pairEvents(events: readonly TimelineEvent[], p: Pick<TimelineCase, 'earlierEventId' | 'laterEventId'>): [TimelineEvent, TimelineEvent] | null {
  const a = events.find((e) => e.id === p.earlierEventId);
  const b = events.find((e) => e.id === p.laterEventId);
  return a === undefined || b === undefined || a.id === b.id ? null : [a, b];
}

/**
 * The two answer choices, in an order that depends on the seed and the prediction id, so the earlier event is not
 * always listed first. Null when either event is missing.
 */
export function pairOptions(events: readonly TimelineEvent[], p: PairPrediction, seed: string): [TimelineEvent, TimelineEvent] | null {
  const pair = pairEvents(events, p);
  if (pair === null) return null;
  return hash32(`${seed}|${p.id}`) % 2 === 0 ? pair : [pair[1], pair[0]];
}

/**
 * Grade "which happened first?" from the dates. The spec's stored earlier/later ids only say which two events the
 * question is about. Null when an event is missing or the pick is not one of the two.
 */
export function gradePair(events: readonly TimelineEvent[], p: PairPrediction, pickedId: string): PairGrade | null {
  const pair = pairEvents(events, p);
  if (pair === null || (pickedId !== pair[0].id && pickedId !== pair[1].id)) return null;
  const c = compareEvents(pair[0], pair[1]);
  if (c === 0) return { status: 'ungradable', pickedId, first: pair[0], second: pair[1] };
  const [earlier, later] = c === -1 ? pair : [pair[1], pair[0]];
  return { status: 'graded', correct: pickedId === earlier.id, pickedId, earlier, later };
}

// ---- spec helpers -----------------------------------------------------------------------------------------

/** Event id -> label, for describing demo faults in words. Empty for non-timeline specs. */
export function timelineEventLabels(spec: AnyActivitySpec | null | undefined): Record<string, string> {
  if (!isTimelineSpec(spec)) return {};
  return Object.fromEntries(spec.simulation.events.map((e) => [e.id, e.label]));
}

/**
 * The worker records a swapped ordering answer as original 'e1 -> e3', injected 'e3 -> e1'. Describe it in plain
 * words with the event labels (the ids when a label is unknown). Null when the values are not such a swap.
 */
export function describeAnswerSwap(original: unknown, injected: unknown, labels: Readonly<Record<string, string>>): string | null {
  const parse = (v: unknown): [string, string] | null => {
    if (typeof v !== 'string') return null;
    const m = /^\s*([^\s>]+)\s*->\s*([^\s>]+)\s*$/.exec(v);
    return m === null ? null : [m[1] as string, m[2] as string];
  };
  if (parse(original) === null) return null;
  const claim = parse(injected);
  if (claim === null) return null;
  const name = (id: string): string => labels[id] ?? id;
  return `System swapped the answer: “${name(claim[0])}” now claimed to come before “${name(claim[1])}” (the honest answer is the other way round)`;
}
