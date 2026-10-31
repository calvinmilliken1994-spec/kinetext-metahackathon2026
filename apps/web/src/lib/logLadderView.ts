// Stage 8a slice W-A: the log ladder's view model (docs/specs/STAGE-8a-subject-engines.md §1b, §4). Pure.
// Every ratio and direction is our engine's (packages/kit-engines ladderRatio, ladderDirection); this file only lays the
// scale out, words the question from the page's effect phrase, and grades a prediction with the teaching margin.
import type { LogCaseGen, LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import { ladderDirection, ladderRatio } from '../../../../packages/kit-engines/logLadder.ts';
import { aiText, amountText, groupThousands } from './displayText.ts';
import { trimmed } from './format.ts';

/** How many presenter steps (→ presses inside the part's presentation beat) this view uses; 1 = a single stage. */
export function logLadderPresentationSteps(spec: LogLadderSpec): number {
  return Math.max(1, spec.cases.length);
}

/** Share of the engine value a prediction may be off by and still count (the product's teaching margin). */
export const LADDER_MARGIN = 0.02;

const round10 = (n: number): number => Math.round(n * 1e10) / 1e10;

/** The engine's ratio, or Infinity where the engine refuses a ratio too large to represent (never a render crash). */
function safeRatio(factor: number, from: number, to: number): number {
  try { return ladderRatio(factor, from, to); } catch { return Number.POSITIVE_INFINITY; }
}

/** A scale value as printed on the ladder ('5.6', '7'). */
export function valueText(n: number): string {
  return trimmed(n, 3);
}

/** A multiplier as a person writes it: whole numbers grouped in full ('100,000'), others to three significant figures. */
export function ratioText(r: number): string {
  if (!Number.isFinite(r)) return 'not defined';
  const whole = Math.round(r);
  if (Math.abs(r - whole) <= 1e-9 * Math.max(1, Math.abs(r))) return groupThousands(String(whole));
  return amountText(r, '');
}

// ---- wording from the page's effect phrase ---------------------------------------------------------------------------

export interface LadderWording {
  /** The question under the from → to line. */
  question: string;
  /** The words for each direction, as a choice and inside the answer ('more acidic', 'larger'). */
  dir: { more: string; less: string };
}

export function ladderWording(spec: Pick<LogLadderSpec, 'effectPhrase'>): LadderWording {
  const phrase = aiText(spec.effectPhrase).replace(/\s+/g, ' ').trim();
  const comparative = /^(?:more|less|greater|fewer|higher|lower)\s+(.+)$/i.exec(phrase);
  if (comparative !== null) {
    const x = comparative[1] as string;
    return { question: `How many times more or less ${x}?`, dir: { more: `more ${x}`, less: `less ${x}` } };
  }
  const change = /^(?:an?\s+)?(?:increase|decrease|rise|drop|change)s?\s+in\s+(?:the\s+)?(.+)$/i.exec(phrase);
  if (change !== null) {
    const x = change[1] as string;
    return { question: `How many times larger or smaller is the ${x}?`, dir: { more: 'larger', less: 'smaller' } };
  }
  return { question: `How many times more or less ${phrase}?`, dir: { more: `more ${phrase}`, less: `less ${phrase}` } };
}

// ---- cases -----------------------------------------------------------------------------------------------------------

export interface LadderStep {
  from: number;
  to: number;
  /** This step's own multiplier: the factor for a whole step, less for the last part step. */
  stepRatio: number;
  /** The multiplier from the case's start to this step's end. */
  cumulative: number;
  /** Shorter than one whole step (the case ends between two whole values). */
  partial: boolean;
}

export interface LadderCase {
  id: string;
  index: number;
  from: number;
  to: number;
  /** The engine's ratio, factor ** |to − from|. */
  ratio: number;
  direction: 'more' | 'less';
  /** |to − from|: how many steps, possibly fractional. */
  exponent: number;
  steps: LadderStep[];
  /** 'pH 7 → 2' (sentence case is applied where it is shown). */
  fromTo: string;
  /** '100,000 times more acidic'. */
  answerText: string;
}

/** The most running-multiplier steps a case draws; a longer case groups whole steps (×10 per step becomes ×100 per 2). */
export const MAX_CASE_STEPS = 12;
/** The most tick marks a ladder draws, whatever the span of its values. */
export const MAX_TICKS = 12;

/**
 * The ladder's steps from one value to another: whole steps of the factor, then a part step if the case ends between.
 * At most MAX_CASE_STEPS (+1 part step) are listed: a longer case groups whole steps evenly, so the work is bounded by a
 * constant, never by the page's values (W-03). Values that are not finite give no steps.
 */
export function ladderSteps(factor: number, from: number, to: number): LadderStep[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
  const sign = to > from ? 1 : -1;
  const diff = round10(Math.abs(to - from));
  if (!Number.isFinite(diff)) return [];
  const whole = Math.floor(diff + 1e-9);
  const stride = whole <= MAX_CASE_STEPS ? 1 : Math.ceil(whole / MAX_CASE_STEPS);
  const out: LadderStep[] = [];
  let last = from;
  for (let k = stride; k <= whole && out.length < MAX_CASE_STEPS; k += stride) {
    const v = round10(from + sign * k);
    if (v === last) break;
    out.push({ from: last, to: v, stepRatio: safeRatio(factor, last, v), cumulative: safeRatio(factor, from, v), partial: false });
    last = v;
  }
  // The rest of the way: a part step (less than one stride), or the whole steps a grouped case had left over.
  const rest = round10(Math.abs(to - last));
  if (rest > 1e-9) out.push({ from: last, to, stepRatio: safeRatio(factor, last, to), cumulative: safeRatio(factor, from, to), partial: rest < stride - 1e-9 });
  return out;
}

export function ladderCases(spec: LogLadderSpec): LadderCase[] {
  const wording = ladderWording(spec);
  return spec.cases.map((c: LogCaseGen, index) => {
    const ratio = safeRatio(spec.factor, c.fromValue, c.toValue);
    const direction = ladderDirection(spec.increasing, c.fromValue, c.toValue);
    return {
      id: c.id, index, from: c.fromValue, to: c.toValue, ratio, direction,
      exponent: round10(Math.abs(c.toValue - c.fromValue)),
      steps: ladderSteps(spec.factor, c.fromValue, c.toValue),
      fromTo: `${aiText(spec.quantity)} ${valueText(c.fromValue)} → ${valueText(c.toValue)}`,
      answerText: `${ratioText(ratio)} times ${wording.dir[direction]}`,
    };
  });
}

export type LadderGradeStatus = 'right' | 'wrong-way' | 'off' | 'invalid';
export interface LadderGrade { status: LadderGradeStatus; margin: number }

/** Right when within the teaching margin of the engine value and in the right direction. */
export function gradeLadder(c: Pick<LadderCase, 'ratio' | 'direction'>, guess: number, dir: 'more' | 'less'): LadderGrade {
  const margin = LADDER_MARGIN * c.ratio;
  if (!Number.isFinite(guess) || guess <= 0) return { status: 'invalid', margin };
  if (Math.abs(guess - c.ratio) > margin) return { status: 'off', margin };
  return { status: dir === c.direction ? 'right' : 'wrong-way', margin };
}

// ---- layout ----------------------------------------------------------------------------------------------------------

export interface LadderAxis {
  min: number;
  max: number;
  /** Whole values from min to max, every `stride` values: at most MAX_TICKS + 1 marks. */
  ticks: number[];
  /** Values between two ticks (1 = every whole step of the scale; a wide span uses 2, 5, 10, 20, …). */
  stride: number;
  /** Position of a value, in % of the ladder's height from the top (higher values sit higher). */
  y: (v: number) => number;
}

export function ladderAxis(spec: Pick<LogLadderSpec, 'rungs' | 'cases'>): LadderAxis {
  const values = [...spec.rungs.map((r) => r.value), ...spec.cases.flatMap((c) => [c.fromValue, c.toValue])];
  const finite = values.filter((v) => Number.isFinite(v));
  let min = finite.length === 0 ? 0 : Math.floor(Math.min(...finite) + 1e-9);
  let max = finite.length === 0 ? 1 : Math.ceil(Math.max(...finite) - 1e-9);
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (max <= min) max = min + 1;
  const span = max - min;
  // A fixed tick budget with a round stride (W-03): the loop runs at most MAX_TICKS + 1 times for any span, and values
  // past the safe-integer range (where v + 1 === v) draw only their two ends.
  const safe = Number.isSafeInteger(min) && Number.isSafeInteger(max) && Number.isSafeInteger(span);
  const stride = safe ? niceStride(span / MAX_TICKS) : span;
  const ticks: number[] = [];
  if (safe) {
    for (let k = 0; k <= MAX_TICKS; k++) {
      const v = min + k * stride;
      if (v > max) break;
      ticks.push(v);
    }
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
  } else {
    ticks.push(min, max);
  }
  return { min, max, ticks, stride, y: (v: number) => round10(((max - v) / span) * 100) };
}

/** The multiplier between two marks of the axis, as the ladder prints it: '×10', or '×100' when marks are two steps apart. */
export function gapText(factor: number, from: number, to: number): string {
  return `×${ratioText(safeRatio(factor, from, to))}`;
}

/** The smallest round stride (1, 2, 5, 10, 20, 50, …) at least `raw`, and at least 1. */
export function niceStride(raw: number): number {
  if (!(raw > 1) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/**
 * Label positions (in the same units as `ys`) kept at least `gap` apart and inside [lo, hi], in the same order as the
 * values they label. Labels that already clear each other stay where they are.
 */
export function spreadLabels(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const pos = order.map((o) => Math.min(hi, Math.max(lo, o.y)));
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k] as number, (pos[k - 1] as number) + gap);
  if (pos.length > 0) pos[pos.length - 1] = Math.min(hi, pos[pos.length - 1] as number);
  for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k] as number, (pos[k + 1] as number) - gap);
  if (pos.length > 0) pos[0] = Math.max(lo, pos[0] as number);
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => { out[o.i] = pos[k] as number; });
  return out;
}
