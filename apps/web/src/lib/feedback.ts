// One feedback voice (set B, UX review #10): every prediction check, in the lesson and on a slide, is worded here.
//
// A check is one compact line: "18,000 N predicted · 18,375 N calculated · just outside the 2% target", at one of three
// levels — within the target, very close (outside it but within twice it), or off — plus one useful next action in the
// lesson. The margin's numbers and where the calculated value comes from go in a small disclosure (`margin`, `source`),
// never in the line. The teaching margin itself is the caller's (lib/predictions.ts studentTolerance / gradeCaseGuess):
// this file only words what was graded.

import { amountText, groupThousands, prettyExponents } from './displayText.ts';
import { trimmed } from './format.ts';
import { STUDENT_RELATIVE_TOLERANCE } from './predictions.ts';
import type { Grade } from './predictions.ts';

export type FeedbackLevel = 'within' | 'close' | 'off';

/** How far outside the margin still counts as "very close": up to twice the margin. */
export const CLOSE_FACTOR = 2;

export interface NumericCheck {
  guess: number;
  /** The calculated value (engine, formula or ladder ratio), never a stored expectation. */
  actual: number;
  /** The teaching margin the guess was graded with (already max(case tolerance, 2%)). */
  tolerance: number;
  /** Display unit ('' for none), e.g. 'N', 'm/s²', 'times'. */
  unit?: string;
  /** How a value is written (the engine's own formatting); default: up to 4 decimals with thousands commas. */
  format?: (n: number) => string;
  /** The relative rule behind the margin (default 2%). */
  share?: number;
  /**
   * The calculated value is still hidden (a ladder check that may be tried again): the line names no calculated value,
   * and the margin is described without its numbers (2% of the answer would give the answer away).
   */
  hideActual?: boolean;
  /** Another case follows this one (the next action points to it). */
  more?: boolean;
}

export interface Feedback {
  level: FeedbackLevel;
  /** Within the target. */
  ok: boolean;
  direction: 'high' | 'low' | 'exact';
  /** '18,000 N predicted' */
  predicted: string;
  /** '18,375 N calculated' (null while hidden). */
  calculated: string | null;
  /** 'within the 2% target' · 'just outside the 2% target' · '3,375 N too low' */
  verdict: string;
  /** The one compact line: predicted · calculated · verdict. */
  line: string;
  /** Slide wording: a short headline and the line under it ('Very close' / 'just outside the 2% target · 375 N low'). */
  headline: string;
  detail: string;
  /** The level in two or three words ('Within the target', 'Very close', 'Off target'), for screen readers and marks. */
  label: string;
  /** One useful next step for a learner. */
  next: string;
  /** The margin in words, for the disclosure ('Within ±367.5 N counts as right here: 2% of the calculated value.'). */
  margin: string;
}

export const LEVEL_LABEL: Readonly<Record<FeedbackLevel, string>> = {
  within: 'Within the target', close: 'Very close', off: 'Off target',
};

const defaultFormat = (n: number): string => groupThousands(trimmed(n, 4));

const withUnit = (text: string, unit: string): string => (unit === '' ? text : `${text} ${unit}`);

/** The level of a graded guess: within the margin, within twice it, or further off. */
export function feedbackLevel(guess: number, actual: number, tolerance: number): FeedbackLevel {
  const gap = Math.abs(guess - actual);
  const slack = 1e-9 * Math.max(1, Math.abs(actual));
  if (gap <= tolerance + slack) return 'within';
  if (gap <= CLOSE_FACTOR * tolerance + slack) return 'close';
  return 'off';
}

/** 'the 2% target', or 'the ±0.5 m target' when the case's own margin is wider than 2% of the value. */
function targetWords(c: NumericCheck, unit: string): string {
  const share = c.share ?? STUDENT_RELATIVE_TOLERANCE;
  const pct = `${trimmed(share * 100, 2)}%`;
  if (c.hideActual === true) return `the ${pct} target`;
  const relative = share * Math.abs(c.actual);
  return c.tolerance > relative * (1 + 1e-9) + 1e-12 ? `the ±${amountText(c.tolerance, unit)} target` : `the ${pct} target`;
}

function nextStep(level: FeedbackLevel, direction: Feedback['direction'], more: boolean): string {
  const then = more ? 'on the next case' : 'next time';
  if (level === 'within') return more ? 'Try the next case.' : 'Move a slider and predict what it does before you look.';
  if (level === 'close') return `Aim a little ${direction === 'high' ? 'lower' : 'higher'} ${then}.`;
  return 'Move one input at a time and watch how the result changes.';
}

/** The words for one numeric prediction check. */
export function numericFeedback(c: NumericCheck): Feedback {
  const unit = prettyExponents((c.unit ?? '').trim());
  const fmt = c.format ?? defaultFormat;
  const error = c.guess - c.actual;
  const level = feedbackLevel(c.guess, c.actual, c.tolerance);
  const direction: Feedback['direction'] = Math.abs(error) <= 1e-9 * Math.max(1, Math.abs(c.actual)) ? 'exact' : error > 0 ? 'high' : 'low';
  const way = direction === 'high' ? 'high' : 'low';
  const target = targetWords(c, unit);
  const gap = amountText(Math.abs(error), unit);
  const hidden = c.hideActual === true;

  const predicted = `${withUnit(defaultFormat(c.guess), unit)} predicted`;
  const calculated = hidden ? null : `${withUnit(fmt(c.actual), unit)} calculated`;
  const verdict = level === 'within'
    ? `within ${target}`
    : level === 'close'
      ? `just outside ${target}`
      : hidden ? `too ${way}` : `${gap} too ${way}`;
  const line = [predicted, calculated, verdict].filter((s): s is string => s !== null).join(' · ');

  const headline = level === 'within' ? `Within ${target}` : level === 'close' ? 'Very close' : hidden ? `Too ${way}` : `${gap} too ${way}`;
  const detail = level === 'within'
    ? predicted
    : level === 'close'
      ? (hidden ? `just outside ${target}, a little ${way}` : `just outside ${target} · ${gap} ${way}`)
      : `outside ${target}`;

  const share = c.share ?? STUDENT_RELATIVE_TOLERANCE;
  const pct = `${trimmed(share * 100, 2)}%`;
  const relative = share * Math.abs(c.actual);
  const margin = hidden
    ? `Within ${pct} of the calculated value counts as right.`
    : c.tolerance > relative * (1 + 1e-9) + 1e-12
      ? `Within ±${amountText(c.tolerance, unit)} counts as right here: this case’s own margin, which is wider than ${pct} of the calculated value.`
      : `Within ±${amountText(c.tolerance, unit)} counts as right here: ${pct} of the calculated value.`;

  return {
    level, ok: level === 'within', direction, predicted, calculated, verdict, line, headline, detail,
    label: LEVEL_LABEL[level], next: nextStep(level, direction, c.more === true), margin,
  };
}

/** The same words from a lib/predictions.ts Grade (engine cases and formula cases). */
export function gradeFeedback(g: Grade, opts: Omit<NumericCheck, 'guess' | 'actual' | 'tolerance'> = {}): Feedback {
  return numericFeedback({ ...opts, guess: g.guess, actual: g.actual, tolerance: g.tolerance });
}

/** The one line before any check: the rule, without numbers that would give the answer away. */
export function targetRule(share = STUDENT_RELATIVE_TOLERANCE): string {
  return `Within ${trimmed(share * 100, 2)}% of the calculated value counts as right.`;
}

/** Where the calculated value comes from, for the disclosure (teacher detail, not the learner's line). */
export const CALCULATED_SOURCE = 'The calculated value is worked out by code from this case’s inputs, not written by the AI.';

// ---- a choice prediction (does it pass?) -----------------------------------------------------------------------------

export interface ChoiceFeedback {
  level: 'within' | 'off';
  ok: boolean;
  /** 'Passes predicted · it fails · 1 short of the 270 needed' */
  line: string;
  label: string;
}

/**
 * A prediction between named outcomes, in the same voice: what was predicted · what happened · why. `predicted` and
 * `outcome` are short phrases ('it passes', 'it fails'); `why` the engine's reason ('1 short of the 270 needed').
 */
export function choiceFeedback(input: { predicted: string; outcome: string; why: string; right: boolean }): ChoiceFeedback {
  const cap = (s: string): string => (s === '' ? s : s.charAt(0).toUpperCase() + s.slice(1));
  const why = input.why.trim().replace(/\.$/, '');
  const line = [`${cap(input.predicted.trim())} predicted`, input.outcome.trim(), why].filter((s) => s !== '').join(' · ');
  return { level: input.right ? 'within' : 'off', ok: input.right, line, label: input.right ? 'Right' : 'Not this time' };
}

// ---- a "how many times?" check on a log scale ------------------------------------------------------------------------

export interface LadderCheck {
  guess: number;
  /** The engine's ratio for the case. */
  ratio: number;
  /** The teaching margin (2% of the ratio). */
  margin: number;
  /** The class's chosen way and the case's way, in the scale's words ('more acidic', 'less acidic'). */
  chosen: string;
  actualWay: string;
  /** The direction was right (a wrong way with the right number is its own case). */
  sameWay: boolean;
  /** The answer is on screen (a right check reveals it); otherwise the line never names it. */
  revealed: boolean;
  /** The page's factor per whole step, as written ('10'). */
  factorText: string;
  format?: (n: number) => string;
}

/**
 * A ladder check in the same voice: '1,000 times more acidic predicted · too low' while the answer is hidden (the class
 * may try again), '100,000 times less acidic predicted · 100,000 times less acidic calculated · within the 2% target'
 * once it is shown. A right number the wrong way says so; the next step is the ladder's own hint.
 */
export function ladderFeedback(c: LadderCheck): Feedback {
  const fmt = c.format ?? defaultFormat;
  const base = numericFeedback({ guess: c.guess, actual: c.ratio, tolerance: c.margin, format: fmt, hideActual: !c.revealed });
  const predicted = `${fmt(c.guess)} times ${c.chosen} predicted`;
  const calculated = c.revealed ? `${fmt(c.ratio)} times ${c.actualWay} calculated` : null;
  if (base.level === 'within' && !c.sameWay) {
    const verdict = 'the right number, the wrong way';
    return {
      ...base, level: 'off', ok: false, predicted, calculated, verdict,
      line: [predicted, calculated, verdict].filter((x): x is string => x !== null).join(' · '),
      headline: 'The wrong way', detail: verdict, label: LEVEL_LABEL.off,
      next: `Check the direction: this case is ${c.actualWay}.`,
    };
  }
  const line = [predicted, calculated, base.verdict].filter((x): x is string => x !== null).join(' · ');
  const next = base.level === 'within'
    ? 'Try the next case, or say why each step multiplies.'
    : `Count the whole steps: each one multiplies by ${c.factorText}.`;
  return { ...base, predicted, calculated, line, next };
}
