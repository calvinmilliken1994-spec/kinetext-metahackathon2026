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

/** The ladder's steps from one value to another: whole steps of the factor, then a part step if the case ends between. */
export function ladderSteps(factor: number, from: number, to: number): LadderStep[] {
  const sign = to > from ? 1 : -1;
  const diff = round10(Math.abs(to - from));
  const whole = Math.floor(diff + 1e-9);
  const out: LadderStep[] = [];
  let last = from;
  for (let k = 1; k <= whole; k++) {
    const v = round10(from + sign * k);
    out.push({ from: last, to: v, stepRatio: ladderRatio(factor, last, v), cumulative: ladderRatio(factor, from, v), partial: false });
    last = v;
  }
  if (diff - whole > 1e-9) out.push({ from: last, to, stepRatio: ladderRatio(factor, last, to), cumulative: ladderRatio(factor, from, to), partial: true });
  return out;
}

export function ladderCases(spec: LogLadderSpec): LadderCase[] {
  const wording = ladderWording(spec);
  return spec.cases.map((c: LogCaseGen, index) => {
    const ratio = ladderRatio(spec.factor, c.fromValue, c.toValue);
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
  /** Whole values from min to max: the rungs of the scale's own steps. */
  ticks: number[];
  /** Position of a value, in % of the ladder's height from the top (higher values sit higher). */
  y: (v: number) => number;
}

export function ladderAxis(spec: Pick<LogLadderSpec, 'rungs' | 'cases'>): LadderAxis {
  const values = [...spec.rungs.map((r) => r.value), ...spec.cases.flatMap((c) => [c.fromValue, c.toValue])];
  let min = Math.floor(Math.min(...values) + 1e-9);
  let max = Math.ceil(Math.max(...values) - 1e-9);
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (max <= min) max = min + 1;
  const ticks: number[] = [];
  for (let v = min; v <= max; v++) ticks.push(v);
  const span = max - min;
  return { min, max, ticks, y: (v: number) => round10(((max - v) / span) * 100) };
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
