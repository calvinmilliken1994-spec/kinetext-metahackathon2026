// Formula explorer (formula-explorer-v1) view model (pure). The stored spec carries only inputs (expression, ranges,
// cases); every output, curve sample and graph coordinate shown to a learner is computed here with the safe evaluator.

import type { FormulaCaseGen, FormulaExplorerSpec, FormulaVarGen } from '../../../../packages/contracts/kit.ts';
import { FORMULA_CONSTANTS, FORMULA_FUNCTIONS, KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import { linearScale, pointString } from './charts.ts';
import { evaluate, parseFormula } from './formula.ts';
import type { Ast } from './formula.ts';
import { gradePrediction, studentTolerance } from './predictions.ts';
import { compareAtPoints, independentSamplePoints, parseExpression, parsePageFormula } from '../../../../packages/validation/expression.ts';
import type { Grade } from './predictions.ts';
import { densify, placeLabels } from './geometry.ts';
import type { LabelBox, PlacedLabel, Px } from './geometry.ts';

export const CALCULATOR_FAILURE = 'The formula could not be checked with our calculator.';

export type Inputs = Record<string, number>;

export interface ExplorerModel {
  ok: true;
  ast: Ast;
  names: string[];
  xVariable: string;
  vars: Record<string, FormulaVarGen>;
}
export type ExplorerResult = ExplorerModel | { ok: false; reason: string };

/** Parse the stored expression and check the variable table; not ok means the view must show only the failure message. */
export function buildExplorer(spec: FormulaExplorerSpec): ExplorerResult {
  const names = spec.variables.map((v) => v.name);
  const fail = (): ExplorerResult => ({ ok: false, reason: CALCULATOR_FAILURE });
  if (names.length === 0 || new Set(names).size !== names.length || !names.includes(spec.xVariable)) return fail();
  for (const v of spec.variables) {
    if (![v.min, v.max, v.default].every(Number.isFinite) || !(v.max > v.min)) return fail();
  }
  const parsed = parseFormula(spec.expression, names);
  if (!parsed.ok) return fail();
  return { ok: true, ast: parsed.ast, names, xVariable: spec.xVariable, vars: Object.fromEntries(spec.variables.map((v) => [v.name, v])) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * The explorer's OPENING slider positions (Stage 7): the first case's inputs (the page's own opening scenario), each clamped
 * into its slider range; a variable's default only when there is no case or the case does not give that variable a finite
 * value. The view opens here and "Reset sliders" returns here.
 */
export function defaultInputs(spec: FormulaExplorerSpec): Inputs {
  const first = spec.cases[0];
  const given = new Map((first?.inputs ?? []).filter((i) => Number.isFinite(i.value)).map((i) => [i.name, i.value] as const));
  return Object.fromEntries(spec.variables.map((v) => [v.name, clamp(given.get(v.name) ?? v.default, v.min, v.max)]));
}

/** Slider step: the range in 100 equal steps (design §2.7). */
export function sliderStep(v: { min: number; max: number }): number {
  return (v.max - v.min) / (KIT_LIMITS.formulaExplorer.samples - 1);
}

export function evalAt(model: ExplorerModel, inputs: Readonly<Inputs>): number {
  return evaluate(model.ast, inputs);
}

export function inputsOfCase(c: FormulaCaseGen): Inputs {
  return Object.fromEntries(c.inputs.map((i) => [i.name, i.value]));
}

export interface CaseOutput { id: string; inputs: Inputs; output: number }

/** Case outputs are always recomputed here; the spec stores only the inputs. */
export function caseOutputs(model: ExplorerModel, spec: FormulaExplorerSpec): CaseOutput[] {
  return spec.cases.map((c) => {
    const inputs = inputsOfCase(c);
    return { id: c.id, inputs, output: evalAt(model, inputs) };
  });
}

export interface Sample { x: number; y: number }

/** 101 samples of the output over the x variable's slider range, every other input held at its current value. */
export function curveSamples(model: ExplorerModel, spec: FormulaExplorerSpec, inputs: Readonly<Inputs>): Sample[] {
  const xv = spec.variables.find((v) => v.name === model.xVariable) as FormulaVarGen;
  const n = KIT_LIMITS.formulaExplorer.samples;
  return Array.from({ length: n }, (_, i) => {
    const x = xv.min + ((xv.max - xv.min) * i) / (n - 1);
    return { x, y: evaluate(model.ast, { ...inputs, [model.xVariable]: x }) };
  });
}

// ---- axes ---------------------------------------------------------------------------------------------------

const NICE = [1, 2, 5, 10];
const tidy = (n: number): number => Number(n.toPrecision(12));

function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  return tidy((NICE.find((m) => m >= raw / pow - 1e-9) ?? 10) * pow);
}

/** Round tick values inside [lo, hi]. */
export function tickValues(lo: number, hi: number, target = 5): number[] {
  if (!(hi > lo)) return [lo];
  const step = niceStep(hi - lo, target);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(tidy(v));
  return out;
}

export interface NiceRange { min: number; max: number; ticks: number[] }

/** A y axis that covers [lo, hi] with round limits; all-positive data starts at zero unless it sits far above it. A flat line gets padding. */
export function niceRange(lo: number, hi: number, target = 5): NiceRange {
  let a = lo;
  let b = hi;
  if (!(b > a)) {
    const pad = Math.abs(a) * 0.1 || 1;
    a -= pad;
    b += pad;
  }
  if (a >= 0 && a < 0.5 * b) a = 0;
  const step = niceStep(b - a, target);
  const min = tidy(Math.floor(a / step + 1e-9) * step);
  const max = tidy(Math.ceil(b / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 1e-9; v += step) ticks.push(tidy(v));
  return { min, max, ticks };
}

/** Up to six significant figures, no trailing zeros; 'not defined' for NaN or infinity. */
export function sig6(n: number): string {
  if (!Number.isFinite(n)) return 'not defined';
  const s = Number(n.toPrecision(6)).toString();
  return s === '-0' ? '0' : s;
}

/** sig6 with thousands separators, so 100000 reads '100,000' on a projector. Exponent forms are left as they are. */
export function groupedSig6(n: number): string {
  const s = sig6(n);
  if (s === 'not defined' || /e/i.test(s)) return s;
  const neg = s.startsWith('-');
  const [int = '', frac] = (neg ? s.slice(1) : s).split('.');
  if (int.length <= 3) return s;
  return `${neg ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${frac === undefined ? '' : `.${frac}`}`;
}

/** Unit words as a page or Muse writes them, mapped to the usual symbols (exact phrases only; case-insensitive). */
const UNIT_WORDS: Record<string, string> = {
  'dimensionless': '', 'unitless': '', 'no unit': '', 'no units': '', 'none': '', '1': '',
  'meters per second': 'm/s', 'metres per second': 'm/s', 'meter per second': 'm/s', 'metre per second': 'm/s',
  'meters per second squared': 'm/s²', 'metres per second squared': 'm/s²',
  'kilograms per cubic meter': 'kg/m³', 'kilograms per cubic metre': 'kg/m³', 'kilogram per cubic meter': 'kg/m³', 'kilogram per cubic metre': 'kg/m³',
  'square meters': 'm²', 'square metres': 'm²', 'square meter': 'm²', 'square metre': 'm²',
  'cubic meters': 'm³', 'cubic metres': 'm³',
  'meters': 'm', 'metres': 'm', 'meter': 'm', 'metre': 'm',
  'seconds': 's', 'second': 's', 'kilograms': 'kg', 'kilogram': 'kg',
  'newtons': 'N', 'newton': 'N', 'pascals': 'Pa', 'pascal': 'Pa', 'joules': 'J', 'joule': 'J', 'watts': 'W', 'watt': 'W',
  'kelvin': 'K', 'kelvins': 'K',
};

/** A compact display unit for a slider, axis or prompt: 'meters per second' → 'm/s', 'm/s^2' → 'm/s²', 'dimensionless' → ''. */
export function displayUnit(unit: string): string {
  const key = unit.trim().toLowerCase().replace(/\s+/g, ' ');
  if (key === '') return '';
  const word = UNIT_WORDS[key];
  if (word !== undefined) return word;
  const sup: Record<string, string> = { '2': '²', '3': '³' };
  return unit.trim().replace(/\^(\d)/g, (_m, d: string) => sup[d] ?? `^${d}`).replace(/\*/g, '·');
}

// ---- graph geometry -----------------------------------------------------------------------------------------

export interface GraphSize { width: number; height: number }
export const GRAPH_SIZE: GraphSize = { width: 520, height: 300 };
/** Room above the plot for the axis name and the 'Now:' value (14 px type), below it for ticks and the axis title. */
const MARGIN = { l: 62, r: 18, t: 28, b: 46 };

export interface GraphTick { value: number; px: number; label: string }
export interface YTick { value: number; py: number; label: string }

export interface GraphGeometry {
  width: number;
  height: number;
  plot: { l: number; t: number; r: number; b: number };
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xTicks: GraphTick[];
  yTicks: YTick[];
  /** SVG polyline `points` strings, one per defined stretch of the curve (a stretch is at least two points). */
  segments: string[];
  /** True when some sampled inputs give no value (the line is broken there). */
  hasGap: boolean;
  current: { x: number; y: number; px: number; py: number | null; defined: boolean };
}

export function graphGeometry(samples: readonly Sample[], current: { x: number; y: number }, size: GraphSize = GRAPH_SIZE): GraphGeometry {
  const xMin = samples[0]?.x ?? 0;
  const xMax = samples[samples.length - 1]?.x ?? 1;
  const ys = samples.map((s) => s.y).filter(Number.isFinite);
  const range = ys.length === 0 ? niceRange(0, 1) : niceRange(Math.min(...ys), Math.max(...ys));
  // The y axis grows to fit its longest tick label (13 px tabular figures, under 8 px each, plus a gap to the axis).
  const longest = Math.max(0, ...range.ticks.map((v) => groupedSig6(v).length));
  const plot = { l: Math.max(MARGIN.l, longest * 8 + 14), t: MARGIN.t, r: size.width - MARGIN.r, b: size.height - MARGIN.b };
  const sx = linearScale(xMin, xMax, plot.l, plot.r);
  const sy = linearScale(range.min, range.max, plot.b, plot.t);

  const segments: string[] = [];
  let run: { x: number; y: number }[] = [];
  const flush = (): void => {
    if (run.length >= 2) segments.push(pointString(run));
    run = [];
  };
  for (const s of samples) {
    if (Number.isFinite(s.y)) run.push({ x: sx(s.x), y: sy(s.y) });
    else flush();
  }
  flush();

  const defined = Number.isFinite(current.y);
  return {
    width: size.width,
    height: size.height,
    plot,
    xMin,
    xMax,
    yMin: range.min,
    yMax: range.max,
    xTicks: tickValues(xMin, xMax).map((value) => ({ value, px: sx(value), label: groupedSig6(value) })),
    yTicks: range.ticks.map((value) => ({ value, py: sy(value), label: groupedSig6(value) })),
    segments,
    hasGap: samples.some((s) => !Number.isFinite(s.y)),
    current: { x: current.x, y: current.y, px: sx(current.x), py: defined ? clamp(sy(current.y), plot.t, plot.b) : null, defined },
  };
}

export interface GraphReveal {
  /** y of the guess line; pinned to the plot edge when the guess is off the plotted range. */
  guessPy: number;
  offScale: 'above' | 'below' | null;
  /** py of value + margin (top) and value − margin (bottom), inside the plot, at least 4 px apart. */
  band: { top: number; bottom: number };
  /** How far (px, + = down) the current point starts from its true place: it travels from the guess to the value. */
  fromDy: number;
  within: boolean;
  /** '1,250 too low' or 'inside the ±125 margin' (the output has no unit in the spec). */
  text: string;
  /** x of the bracket from the guess line to the point. */
  bracketX: number;
  /** 'your guess 5,000' (plus 'above/below the graph' when pinned), placed off the curve. */
  guessLabel: PlacedLabel;
  /** The gap in words, placed off the curve near the bracket. */
  deltaLabel: PlacedLabel;
}

/** The plotted curve as points (from the polyline strings), for keeping labels off it. */
function curvePoints(g: GraphGeometry): Px[] {
  return g.segments.flatMap((seg) => densify(seg.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { px: x ?? 0, py: y ?? 0 };
  }), 3));
}

/** The graph's reveal overlay for a graded guess (the point must be the graded case: the view checks the sliders). */
export function graphReveal(g: GraphGeometry, grade: Grade, who = 'your'): GraphReveal {
  const { plot } = g;
  const span = g.yMax - g.yMin;
  const sy = (y: number): number => plot.b - ((y - g.yMin) / (span === 0 ? 1 : span)) * (plot.b - plot.t);
  const raw = sy(grade.guess);
  const offScale = raw < plot.t ? 'above' as const : raw > plot.b ? 'below' as const : null;
  const guessPy = clamp(raw, plot.t, plot.b);
  const mid = clamp(sy(grade.actual), plot.t, plot.b);
  let top = clamp(sy(grade.actual + grade.tolerance), plot.t, plot.b);
  let bottom = clamp(sy(grade.actual - grade.tolerance), plot.t, plot.b);
  if (bottom - top < 4) { top = Math.max(plot.t, mid - 2); bottom = Math.min(plot.b, mid + 2); }
  const at = g.current.py ?? mid;
  const text = grade.withinTolerance
    ? `inside the ±${groupedSig6(grade.tolerance)} margin`
    : `${groupedSig6(Math.abs(grade.error))} too ${grade.direction === 'high' ? 'high' : 'low'}`;

  // Labels: the same collision-free placer as the projectile scene, inside the plot, off the curve, the dot and the bracket.
  const px = g.current.px;
  const right = px < (plot.l + plot.r) / 2 + 60;
  const bracketX = px + (right ? 18 : -18);
  const obstacles = curvePoints(g);
  obstacles.push(...densify([{ px: plot.l, py: guessPy }, { px: plot.r, py: guessPy }], 3));
  obstacles.push(...densify([{ px: bracketX, py: guessPy }, { px: bracketX, py: at }], 3));
  const dot: LabelBox = { x: px - 9, y: at - 9, w: 18, h: 18 };
  const bounds: LabelBox = { x: plot.l, y: plot.t, w: plot.r - plot.l, h: plot.b - plot.t };
  const off = offScale === 'above' ? ', above the graph' : offScale === 'below' ? ', below the graph' : '';
  const lo = Math.min(guessPy, at);
  const hi = Math.max(guessPy, at);
  const side = right ? 'start' as const : 'end' as const;
  const dx = right ? 8 : -8;
  const [guessLabel, deltaLabel] = placeLabels([
    {
      text: `${who} guess ${groupedSig6(grade.guess)}${off}`, fontPx: 14, bold: true,
      candidates: [
        ...(px < (plot.l + plot.r) / 2 ? [plot.r - 6, plot.l + 6] : [plot.l + 6, plot.r - 6]).flatMap((x) => [-8, 19, -26, 37].map((dy) => ({
          x, y: guessPy + dy, anchor: x > (plot.l + plot.r) / 2 ? 'end' as const : 'start' as const,
        }))),
      ],
    },
    {
      text, fontPx: 14, bold: true, near: { px: bracketX, py: (lo + hi) / 2 }, maxY: plot.b,
      candidates: [
        { x: bracketX + dx, y: (lo + hi) / 2 + 5, anchor: side },
        { x: bracketX + dx, y: lo - 8, anchor: side },
        { x: bracketX + dx, y: hi + 19, anchor: side },
        { x: px, y: lo - 14, anchor: 'middle' },
        { x: px, y: lo - 26, anchor: 'middle' },
        ...[-26, -44, -62, -80].flatMap((dy) => [
          { x: bracketX + dx, y: lo + dy, anchor: side },
          { x: px - dx, y: lo + dy, anchor: right ? 'end' as const : 'start' as const },
        ]),
      ],
    },
  ], [dot], obstacles, bounds, 2) as [PlacedLabel, PlacedLabel];
  return { guessPy, offScale, band: { top, bottom }, fromDy: guessPy - at, within: grade.withinTolerance, text, bracketX, guessLabel, deltaLabel };
}

/** Evenly spaced rows from the samples (both ends included) for the value table. */
export function valueTable(samples: readonly Sample[], rows = 6): Sample[] {
  if (samples.length === 0) return [];
  const last = samples.length - 1;
  return Array.from({ length: rows }, (_, k) => samples[Math.round((k * last) / Math.max(1, rows - 1))] as Sample);
}

/**
 * Value-table rows at round x values (the axis ticks) with both ends of the slider range kept, so a teacher reads
 * "200, 400, 600" rather than "200.8, 400.6, 600.4". Every y is worked out by the calculator, other inputs as set.
 */
export function niceValueRows(model: ExplorerModel, spec: FormulaExplorerSpec, inputs: Readonly<Inputs>): Sample[] {
  const xv = spec.variables.find((v) => v.name === model.xVariable) as FormulaVarGen;
  const span = xv.max - xv.min;
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= span * 1e-9;
  const xs = [xv.min, ...tickValues(xv.min, xv.max).filter((x) => !near(x, xv.min) && !near(x, xv.max)), xv.max];
  return xs.map((x) => ({ x, y: evaluate(model.ast, { ...inputs, [model.xVariable]: x }) }));
}

export interface ValueRow extends Sample { now: boolean }

/**
 * The value table with the current slider position in its place: the row at x is marked 'now', or, when x falls between
 * rows, a 'now' row is put in order (not at the top, where '50' above '10, 20, 40' reads as a sorting error). Rows ascend.
 */
export function valueRowsWithNow(rows: readonly Sample[], xNow: number, yNow: number): ValueRow[] {
  const near = (a: number): boolean => Math.abs(a - xNow) <= 1e-9 * Math.max(1, Math.abs(xNow));
  if (rows.some((r) => near(r.x))) return rows.map((r) => ({ ...r, now: near(r.x) }));
  const out: ValueRow[] = rows.map((r) => ({ ...r, now: false }));
  const at = out.findIndex((r) => r.x > xNow);
  out.splice(at < 0 ? out.length : at, 0, { x: xNow, y: yNow, now: true });
  return out;
}

// ---- short slider labels ----------------------------------------------------------------------------------------------

/** A meaning this short is shown whole. */
const SHORT_MEANING = 24;
/** Longest short label when no natural break is found. */
const SHORT_MAX = 28;
/** Words that start a clause describing the quantity ('… that collects', '… relative to', '… for the body'): cut before. */
const CLAUSE_WORDS = new Set(['that', 'which', 'who', 'whose', 'where', 'when', 'relative', 'for', 'used', 'measured', 'given', 'is', 'are', 'was', 'were', 'being']);
/** Small words a short label must not end on. */
const DANGLING = new Set(['of', 'the', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'by', 'for', 'that', 'with', 'from', 'as']);

const trimDangling = (words: string[]): string[] => {
  const out = [...words];
  while (out.length > 1 && DANGLING.has((out[out.length - 1] as string).toLowerCase())) out.pop();
  return out;
};

/**
 * A slider label from a variable's meaning (Muse writes whole descriptions: 'drag coefficient that collects shape and flow
 * effects'). Short meanings stay whole; a long one is cut at its first comma or describing clause ('drag coefficient'),
 * else after a few words. The view keeps the full meaning as the slider's description and tooltip.
 */
export function shortMeaning(meaning: string): string {
  const s = meaning.replace(/\s+/g, ' ').trim();
  if (s.length <= SHORT_MEANING) return s;
  const head = s.split(/\s*[,;(—–]\s*|\s+-\s+/)[0]?.trim() ?? '';
  if (head !== '' && head.length < s.length && head.length <= SHORT_MAX) return trimDangling(head.split(' ')).join(' ');
  const words = s.split(' ');
  const cut = words.findIndex((w, i) => i > 0 && CLAUSE_WORDS.has(w.toLowerCase()));
  if (cut > 0) {
    const before = trimDangling(words.slice(0, cut)).join(' ');
    if (before.length <= SHORT_MAX + 4) return before;
  }
  const taken: string[] = [];
  for (const w of words) {
    if (taken.length > 0 && [...taken, w].join(' ').length > SHORT_MAX) break;
    taken.push(w);
  }
  return trimDangling(taken).join(' ');
}

// ---- naming and the page formula --------------------------------------------------------------------------------

/** The page's name for the output: the single word before '=' in the formula text, else 'result'. */
export function outputName(spec: Pick<FormulaExplorerSpec, 'formulaText'>): string {
  const eq = spec.formulaText.indexOf('=');
  if (eq < 0) return 'result';
  const lhs = spec.formulaText.slice(0, eq).trim();
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(lhs) ? lhs : 'result';
}

export const unitSuffix = (unit: string): string => (unit === '' || unit === '1' ? '' : ` ${unit}`);

export type PageFormulaStatus = 'matches' | 'mismatch' | 'unparseable';

/** The same comparison rule the validator applies (FE-08): relative 1e-9 and at least three finite agreeing points. */
const PAGE_FORMULA_TOLERANCE = 1e-9;
const PAGE_FORMULA_MIN_POINTS = 3;

/**
 * Re-read the quoted formula line with the same grammar (page symbols mapped to variable names) and compare it with the
 * stored expression at the validator's independently varied points (`independentSamplePoints` + `compareAtPoints` from
 * packages/validation/expression.ts: slider defaults, one variable at a time, seeded random points and the stored cases).
 * 'unparseable' means the page line is not a plain formula (words, subscripts, unknown symbols): the view then tells the
 * teacher the formula was entered by AI and should be compared with the quote.
 */
export function pageFormulaStatus(spec: FormulaExplorerSpec): PageFormulaStatus {
  const eq = spec.formulaText.indexOf('=');
  if (eq < 0) return 'unparseable';
  const symbols = new Map(spec.variables.map((v) => [v.pageSymbol, v.name] as const));
  let unknown = false;
  const mapped = spec.formulaText.slice(eq + 1).replace(/[A-Za-z_][A-Za-z0-9_]*/g, (word) => {
    const name = symbols.get(word);
    if (name !== undefined) return name;
    if ((FORMULA_FUNCTIONS as readonly string[]).includes(word) || (FORMULA_CONSTANTS as readonly string[]).includes(word)) return word;
    unknown = true;
    return word;
  });
  if (unknown) return 'unparseable';
  const names = spec.variables.map((v) => v.name);
  const page = parsePageFormula(mapped, { knownVariables: names });
  if (!page.ok) return 'unparseable';
  const own = parseExpression(spec.expression, { knownVariables: names });
  if (!own.ok) return 'mismatch';
  const points = independentSamplePoints(
    spec.variables.map((v) => ({ name: v.name, min: v.min, max: v.max, default: v.default })),
    spec.cases.map(inputsOfCase),
  );
  const cmp = compareAtPoints(own.ast, page.ast, points, PAGE_FORMULA_TOLERANCE);
  return cmp.finite >= PAGE_FORMULA_MIN_POINTS && cmp.agreeing >= PAGE_FORMULA_MIN_POINTS && cmp.mismatches.length === 0 ? 'matches' : 'mismatch';
}

// ---- predict, then reveal -----------------------------------------------------------------------------------------

export function casePrompt(spec: FormulaExplorerSpec, c: FormulaCaseGen): string {
  const inputs = inputsOfCase(c);
  const parts = spec.variables.map((v) => `${shortMeaning(v.meaning)} = ${groupedSig6(inputs[v.name] ?? v.default)}${unitSuffix(displayUnit(v.unit))}`);
  return `With ${parts.join(', ')}. What is ${outputName(spec)}?`;
}

/** Students are graded with the teaching margin: 2% of the calculator's value (cases carry no tolerance of their own). */
export function gradeCaseGuess(guess: number, actual: number): Grade {
  return gradePrediction(guess, actual, studentTolerance(actual, 0));
}

/** Where case 1 should sit along the x axis of a predict beat's graph (fraction of the range). */
const PREDICT_X_AT = 0.45;

/**
 * Presentation mode's predict beat: the same explorer with the x variable's range narrowed (from its minimum) so case 1
 * sits near the middle of the graph. On the full slider range a case near the low end is squeezed into the bottom corner,
 * where the guess line, the margin band and the value cannot be told apart from across a room. Only the drawn range
 * changes; the formula, the cases and every other variable stay as they are. A case already past the PREDICT_X_AT point
 * keeps the full range.
 */
export function predictSpec(spec: FormulaExplorerSpec): FormulaExplorerSpec {
  const first = spec.cases[0];
  const xv = spec.variables.find((v) => v.name === spec.xVariable);
  if (first === undefined || xv === undefined) return spec;
  const x0 = inputsOfCase(first)[spec.xVariable];
  if (x0 === undefined || !Number.isFinite(x0) || !(xv.max > xv.min) || x0 <= xv.min) return spec;
  const want = xv.min + (x0 - xv.min) / PREDICT_X_AT;
  if (want >= xv.max) return spec;
  const step = niceStep(want - xv.min, 5);
  const max = Math.min(xv.max, tidy(xv.min + Math.ceil((want - xv.min) / step - 1e-9) * step));
  if (!(max > x0)) return spec;
  return { ...spec, variables: spec.variables.map((v) => (v.name === spec.xVariable ? { ...v, max } : v)) };
}
