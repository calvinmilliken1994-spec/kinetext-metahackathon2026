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

export function defaultInputs(spec: FormulaExplorerSpec): Inputs {
  return Object.fromEntries(spec.variables.map((v) => [v.name, clamp(v.default, v.min, v.max)]));
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

// ---- graph geometry -----------------------------------------------------------------------------------------

export interface GraphSize { width: number; height: number }
export const GRAPH_SIZE: GraphSize = { width: 520, height: 300 };
const MARGIN = { l: 62, r: 18, t: 18, b: 46 };

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
  const plot = { l: MARGIN.l, t: MARGIN.t, r: size.width - MARGIN.r, b: size.height - MARGIN.b };
  const xMin = samples[0]?.x ?? 0;
  const xMax = samples[samples.length - 1]?.x ?? 1;
  const ys = samples.map((s) => s.y).filter(Number.isFinite);
  const range = ys.length === 0 ? niceRange(0, 1) : niceRange(Math.min(...ys), Math.max(...ys));
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
    xTicks: tickValues(xMin, xMax).map((value) => ({ value, px: sx(value), label: sig6(value) })),
    yTicks: range.ticks.map((value) => ({ value, py: sy(value), label: sig6(value) })),
    segments,
    hasGap: samples.some((s) => !Number.isFinite(s.y)),
    current: { x: current.x, y: current.y, px: sx(current.x), py: defined ? clamp(sy(current.y), plot.t, plot.b) : null, defined },
  };
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
  const parts = spec.variables.map((v) => `${v.meaning} = ${sig6(inputs[v.name] ?? v.default)}${unitSuffix(v.unit)}`);
  return `With ${parts.join(', ')}. What is ${outputName(spec)}?`;
}

/** Students are graded with the teaching margin: 2% of the calculator's value (cases carry no tolerance of their own). */
export function gradeCaseGuess(guess: number, actual: number): Grade {
  return gradePrediction(guess, actual, studentTolerance(actual, 0));
}
