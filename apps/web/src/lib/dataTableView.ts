// Data table (data-table-v1) view model (pure). The page's values are shown exactly as printed; every number the view
// sorts, charts or taxes comes from packages/kit-engines/table.ts (parseTableNumber, answerQuestion, progressiveTax).
// Questions are worded by this file and answered by the engine; the model never writes an answer.

import type { DataQuestionGen, DataTableGen, DataTableSpec } from '../../../../packages/contracts/kit.ts';
import { answerQuestion, bracketFloors, parseTableNumber, progressiveTax } from '../../../../packages/kit-engines/table.ts';
import { quoteDisclosesValue } from './conceal.ts';
import { aiLabel, groupThousands } from './displayText.ts';
import type { QuoteLike } from './linking.ts';

/** The spec in the engine's gen shape (answerQuestion reads only rows and columns). */
export function asGen(spec: DataTableSpec): DataTableGen {
  return {
    schemaVersion: 'data-table-v1', title: spec.title, labelHeader: spec.labelHeader, columns: spec.columns, rows: spec.rows,
    questions: spec.questions, chartColumnIndex: spec.chartColumnIndex, brackets: spec.brackets,
  };
}

// ---- steps ------------------------------------------------------------------------------------------------------------

/** In brackets mode the tax calculator is the first question ("How much tax on $100,000?"), then the page questions. */
export type DataTableStep = { kind: 'tax' } | { kind: 'question'; index: number };

/** How many presenter steps (→ presses inside the part's presentation beat) this view uses. */
export function dataTablePresentationSteps(spec: DataTableSpec): number {
  return Math.max(1, spec.questions.length + (bracketSchedule(spec) === null ? 0 : 1));
}

export function presentationStep(spec: DataTableSpec, step: number): DataTableStep {
  const tax = bracketSchedule(spec) !== null;
  const n = dataTablePresentationSteps(spec);
  const s = Math.max(0, Math.min(n - 1, Math.trunc(Number.isFinite(step) ? step : 0)));
  if (tax && s === 0) return { kind: 'tax' };
  return { kind: 'question', index: Math.max(0, Math.min(spec.questions.length - 1, tax ? s - 1 : s)) };
}

// ---- columns ----------------------------------------------------------------------------------------------------------

export interface ColumnView { index: number; headerText: string; numeric: boolean; unit: string }

/** Headers in sentence case with their unit once: 'Diameter (km)', 'Increase (basis points)', 'Mass (10²⁴kg)'. */
export function columnViews(spec: DataTableSpec): ColumnView[] {
  return spec.columns.map((c, index) => {
    const header = c.header.trim();
    const unit = c.unit.trim();
    const text = unit === '' || header.includes(unit) ? header : `${header} (${unit})`;
    return { index, headerText: aiLabel(text), numeric: c.numeric, unit };
  });
}

const sameText = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

/**
 * The value column that repeats every row label (IRS brackets: label '12%', Rate column '12%' or '12' with unit '%'), or
 * null. The view then drops the label column and shows that column as the row header, so the table never prints the
 * same numbers twice. Kept when a lookup question hides a cell of that column: the row would lose its name.
 */
export function duplicateLabelColumn(spec: DataTableSpec): number | null {
  if (spec.rows.length === 0) return null;
  const labels = spec.rows.map((r) => sameText(r.label));
  if (labels.some((l) => l === '')) return null;
  for (let c = 0; c < spec.columns.length; c++) {
    const unit = sameText(spec.columns[c]?.unit ?? '');
    const repeats = spec.rows.every((r, i) => {
      const v = sameText(r.values[c]?.value ?? '');
      const l = labels[i] as string;
      return v !== '' && (v === l || (unit !== '' && (`${v}${unit}` === l || `${unit}${v}` === l)));
    });
    if (!repeats) continue;
    if (spec.questions.some((q) => q.kind === 'lookup' && q.columnIndex === c)) return null;
    return c;
  }
  return null;
}

/** The row-label column's noun for a question: 'planet', 'date' ('row' when the page gives none). */
function labelNoun(spec: DataTableSpec): string {
  const h = spec.labelHeader.trim();
  // Row labels that are numbers (IRS: the Single column's thresholds) name a column, not a kind of row.
  if (h === '' || (spec.rows.length > 0 && spec.rows.every((r) => parseTableNumber(r.label) !== null))) return 'row';
  return /^[A-Z][a-z]/.test(h) ? h.charAt(0).toLowerCase() + h.slice(1) : h;
}

export function cellNumber(spec: DataTableSpec, row: number, column: number): number | null {
  const v = spec.rows[row]?.values[column]?.value;
  return v === undefined ? null : parseTableNumber(v);
}

// ---- sorting and the chart --------------------------------------------------------------------------------------------

export interface SortState { column: number; dir: 'asc' | 'desc' }

/** Row indices in the shown order; numeric columns sort by their parsed numbers, ties and unreadable cells keep page order. */
export function sortedRows(spec: DataTableSpec, sort: SortState | null): number[] {
  const rows = spec.rows.map((_, i) => i);
  if (sort === null) return rows;
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows.sort((a, b) => {
    const x = cellNumber(spec, a, sort.column);
    const y = cellNumber(spec, b, sort.column);
    if (x === null || y === null) return x === null && y === null ? a - b : x === null ? 1 : -1;
    return x === y ? a - b : (x - y) * sign;
  });
}

export interface ChartBar {
  rowIndex: number; label: string; value: number; text: string;
  /** |value| as a share of the chart's whole span (max − min, zero included). */
  fraction: number;
  /** Where the bar starts along the track (0..1): at the zero baseline for a positive value, below it for a negative one. */
  start: number;
  negative: boolean;
}

/**
 * One bar per row (in the table's shown order) for the chart column, drawn from a zero baseline: positive values to its
 * right, negative ones to its left, so −140 °C never reads as a large positive bar (W-09). Null without a chart, when a
 * cell does not read as a number, or when every value is zero (the table alone says it).
 */
export function chartBars(spec: DataTableSpec, order: readonly number[]): { headerText: string; column: number; bars: ChartBar[]; zero: number; signed: boolean } | null {
  const column = spec.chartColumnIndex;
  const col = columnViews(spec)[column];
  if (column < 0 || col === undefined || !col.numeric) return null;
  const values = order.map((r) => cellNumber(spec, r, column));
  if (values.some((v) => v === null || !Number.isFinite(v))) return null;
  const nums = values as number[];
  const lo = Math.min(0, ...nums);
  const hi = Math.max(0, ...nums);
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const zero = -lo / span;
  return {
    headerText: col.headerText,
    column,
    zero,
    signed: lo < 0,
    bars: order.map((r, i) => {
      const value = nums[i] ?? 0;
      const fraction = Math.abs(value) / span;
      return { rowIndex: r, label: spec.rows[r]?.label ?? '', value, text: spec.rows[r]?.values[column]?.value ?? '', fraction, start: value < 0 ? zero - fraction : zero, negative: value < 0 };
    }),
  };
}

/** The chart's note naming what its row labels are, when they are numbers from another column (IRS: Single). */
export function chartRowsNote(spec: DataTableSpec): string | null {
  const h = spec.labelHeader.trim();
  if (h === '' || spec.rows.length === 0 || !spec.rows.every((r) => parseTableNumber(r.label) !== null)) return null;
  return `Rows named by the ${aiLabel(h)} column`;
}

// ---- questions --------------------------------------------------------------------------------------------------------

export interface QuestionView {
  id: string;
  kind: DataQuestionGen['kind'];
  text: string;
  columnIndex: number;
  /** The engine's answer (null when the engine cannot answer: the view then leaves the question out). */
  answer: { rowIndex: number; value: string } | null;
  /** Rows the class chooses from (largest/smallest); a lookup is answered by revealing the hidden cell. */
  choices: number[];
}

export function questionViews(spec: DataTableSpec): QuestionView[] {
  const cols = columnViews(spec);
  const gen = asGen(spec);
  return spec.questions.map((q) => {
    const header = cols[q.columnIndex]?.headerText ?? '';
    const label = spec.rows[q.rowIndex]?.label ?? '';
    const text = q.kind === 'lookup'
      ? `What does the table give for ${label} in the ${header} column?`
      : `Which ${labelNoun(spec)} has the ${q.kind} value in the ${header} column?`;
    return { id: q.id, kind: q.kind, text, columnIndex: q.columnIndex, answer: answerQuestion(gen, q), choices: q.kind === 'lookup' ? [] : spec.rows.map((_, i) => i) };
  });
}

/** True when a quote contains the hidden answer as a whole token: hovering it before the reveal would give it away (lib/conceal.ts). */
export function quoteLeaksAnswer(quote: string, value: string): boolean {
  return quoteDisclosesValue(quote, value);
}

// ---- brackets ---------------------------------------------------------------------------------------------------------

export interface Bracket {
  rate: number;
  over: number;
  rowIndex: number;
  /** The threshold cell as the page prints it ('$12,400 or less', '$50,400'). */
  overText: string;
}

/**
 * The page's rate schedule from the rate and threshold columns; null when brackets are off or a cell does not read.
 * Thresholds are read with the validator's own rule (kit-engines bracketFloors), so a first row printed as a ceiling
 * ('$12,400 or less') is floor 0 here exactly as it was when the lesson was checked (W-06).
 */
export function bracketSchedule(spec: DataTableSpec): { brackets: Bracket[]; currency: string } | null {
  const b = spec.brackets;
  if (!b.enabled || b.rateColumnIndex < 0 || b.overColumnIndex < 0 || spec.rows.length === 0) return null;
  const texts = spec.rows.map((r) => r.values[b.overColumnIndex]?.value);
  if (texts.some((t) => typeof t !== 'string')) return null;
  const floors = bracketFloors(texts as string[]);
  if (floors === null) return null;
  const brackets: Bracket[] = [];
  for (let r = 0; r < spec.rows.length; r++) {
    const rate = cellNumber(spec, r, b.rateColumnIndex);
    const over = floors[r];
    if (rate === null || over === undefined || !(rate >= 0 && rate <= 100)) return null;
    brackets.push({ rate, over, rowIndex: r, overText: (texts[r] as string).trim() });
  }
  const unit = spec.columns[b.overColumnIndex]?.unit.trim() ?? '';
  const currency = brackets.some((x) => x.overText.includes('$')) || unit === '$' ? '$' : '';
  return { brackets, currency };
}

/** The threshold column's name ('Married'): the one filing column the calculator reads. */
export function bracketColumnName(spec: DataTableSpec): string {
  const c = spec.columns[spec.brackets.overColumnIndex];
  return c === undefined ? '' : aiLabel(c.header.trim());
}

/** The calculator's question, naming the one column it uses: "Using the Married column, how much tax is due on $640,600 of income?" (P1). */
export function taxQuestion(spec: DataTableSpec, currency: string): string {
  const name = bracketColumnName(spec);
  const ask = `how much tax is due on ${moneyText(spec.brackets.exampleIncome, currency)} of income?`;
  return name === '' ? ask.charAt(0).toUpperCase() + ask.slice(1) : `Using the ${name} column, ${ask}`;
}

export interface TaxPart { rate: number; from: number; to: number; tax: number; rowIndex: number }
export interface TaxView {
  income: number;
  total: number;
  /** Total tax as a percent of income. */
  effectiveRate: number;
  parts: TaxPart[];
  /** Income below the schedule's first threshold, which the page's table gives no rate for. */
  below: number;
  currency: string;
  /** The highest bracket the income reaches (its row), or null when it reaches none. */
  topRow: number | null;
}

/** The largest income the calculator takes: far above any real schedule, far below where the arithmetic loses cents. */
export const MAX_INCOME = 1e12;

/** The progressive tax on an income under the page's schedule (engine: progressiveTax); null without a schedule or when the engine refuses. */
export function taxView(spec: DataTableSpec, income: number): TaxView | null {
  const sched = bracketSchedule(spec);
  if (sched === null) return null;
  const inc = Number.isFinite(income) && income > 0 ? Math.min(income, MAX_INCOME) : 0;
  let res: ReturnType<typeof progressiveTax>;
  try {
    res = progressiveTax(sched.brackets.map((b) => ({ rate: b.rate, over: b.over })), inc);
  } catch {
    return null;
  }
  const parts = res.parts.map((p): TaxPart => ({ ...p, rowIndex: sched.brackets.find((b) => b.over === p.from)?.rowIndex ?? -1 }));
  const first = sched.brackets[0]?.over ?? 0;
  return {
    income: inc, total: res.total, effectiveRate: inc > 0 ? (res.total / inc) * 100 : 0, parts,
    below: Math.min(inc, first), currency: sched.currency, topRow: parts.length === 0 ? null : (parts[parts.length - 1]?.rowIndex ?? null),
  };
}

/**
 * A typed income: a number with optional '$', commas and spaces, from 0 up to MAX_INCOME. Anything else is a field
 * error shown beside the input (the calculator keeps its last good result), never a render crash (W-10).
 */
export function parseIncome(raw: string): { ok: true; income: number } | { ok: false; error: string } {
  const t = raw.replace(/[\s,]/g, '').replace(/^\$/, '');
  if (t === '') return { ok: false, error: 'Type an income, for example 100,000.' };
  if (/^[-−]/.test(t)) return { ok: false, error: 'Type an income of 0 or more.' };
  if (!/^\d+(?:\.\d+)?$/.test(t)) return { ok: false, error: 'Type the income as a number, for example 100,000.' };
  const n = Number(t);
  if (!Number.isFinite(n) || n > MAX_INCOME) return { ok: false, error: `Type an income up to ${moneyText(MAX_INCOME, '')}.` };
  return { ok: true, income: n };
}

/**
 * Labels for the band edges under the bracket blocks (P2): each block's upper edge as an amount ('$24,800', '$100,800',
 * …, the income), centred on its edge but kept inside the axis (the first is never clipped), and dropped when it would
 * touch the label before it. The last one (the income) always shows. `edges` are edge positions and label widths in
 * one pixel unit.
 */
export function placeEdgeLabels(edges: readonly { x: number; w: number }[], width: number, gap = 8): { left: number; shown: boolean }[] {
  const lefts = edges.map((e) => Math.max(0, Math.min(Math.max(0, width - e.w), e.x - e.w / 2)));
  const last = edges.length - 1;
  if (last < 0) return [];
  const shown = edges.map((_, i) => i === last);
  const lastLeft = lefts[last] as number;
  let right = -Infinity;
  for (let i = 0; i < last; i++) {
    const l = lefts[i] as number;
    const r = l + (edges[i]?.w ?? 0);
    if (l >= right + gap && r + gap <= lastLeft) { shown[i] = true; right = r; }
  }
  return edges.map((_, i) => ({ left: lefts[i] as number, shown: shown[i] as boolean }));
}

/** Money as people write it: '$15,472', '$1,234.50' (cents only when there are some). */
export function moneyText(n: number, currency: string): string {
  const cents = Math.round(n * 100) / 100;
  const whole = Number.isInteger(cents);
  const s = groupThousands(whole ? String(Math.abs(cents)) : Math.abs(cents).toFixed(2));
  return `${cents < 0 ? '−' : ''}${currency}${s}`;
}

/** A rate with one decimal: '15.5%'. */
export function percentText(p: number): string {
  return `${(Math.round(p * 10) / 10).toFixed(1)}%`;
}

// ---- the quote zone ---------------------------------------------------------------------------------------------------

/** The page sentence a revealed step puts in the quote zone: the answer cell's quote, or the top bracket reached. */
export function dataTableRevealQuote(spec: DataTableSpec, step: number): QuoteLike | null {
  const s = presentationStep(spec, step);
  if (s.kind === 'tax') {
    const t = taxView(spec, spec.brackets.exampleIncome);
    const row = t?.topRow === null || t === null ? undefined : spec.rows[t.topRow];
    return row === undefined ? null : { sourceId: row.sourceId, quote: row.quote };
  }
  const q = questionViews(spec)[s.index];
  if (q === undefined || q.answer === null) return null;
  const cell = spec.rows[q.answer.rowIndex]?.values[q.columnIndex];
  return cell === undefined ? null : { sourceId: cell.sourceId, quote: cell.quote };
}
