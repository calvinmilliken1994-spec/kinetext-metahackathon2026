// Data table (data-table-v1) view model (pure). The page's values are shown exactly as printed; every number the view
// sorts, charts or taxes comes from packages/kit-engines/table.ts (parseTableNumber, answerQuestion, progressiveTax).
// Questions are worded by this file and answered by the engine; the model never writes an answer.

import type { DataQuestionGen, DataTableGen, DataTableSpec } from '../../../../packages/contracts/kit.ts';
import { answerQuestion, parseTableNumber, progressiveTax } from '../../../../packages/kit-engines/table.ts';
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

/** The row-label column's noun for a question: 'planet', 'date' ('row' when the page gives none). */
function labelNoun(spec: DataTableSpec): string {
  const h = spec.labelHeader.trim();
  if (h === '') return 'row';
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

export interface ChartBar { rowIndex: number; label: string; value: number; text: string; fraction: number }

/** One bar per row (in the table's shown order) for the chart column, scaled to the largest value; null without a chart. */
export function chartBars(spec: DataTableSpec, order: readonly number[]): { headerText: string; column: number; bars: ChartBar[] } | null {
  const column = spec.chartColumnIndex;
  const col = columnViews(spec)[column];
  if (column < 0 || col === undefined || !col.numeric) return null;
  const values = order.map((r) => cellNumber(spec, r, column));
  if (values.some((v) => v === null)) return null;
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 0);
  return {
    headerText: col.headerText,
    column,
    bars: order.map((r, i) => {
      const value = values[i] ?? 0;
      return { rowIndex: r, label: spec.rows[r]?.label ?? '', value, text: spec.rows[r]?.values[column]?.value ?? '', fraction: max > 0 ? Math.abs(value) / max : 0 };
    }),
  };
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

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when a quote contains the hidden answer as a whole token: hovering it before the reveal would give it away. */
export function quoteLeaksAnswer(quote: string, value: string): boolean {
  const v = value.trim();
  if (v === '') return false;
  return new RegExp(`(?<![\\p{L}\\p{N}.,])${escapeRe(v)}(?![\\p{L}\\p{N}]|[.,]\\d)`, 'u').test(quote);
}

// ---- brackets ---------------------------------------------------------------------------------------------------------

export interface Bracket { rate: number; over: number; rowIndex: number }

/** The page's rate schedule from the rate and threshold columns; null when brackets are off or a cell does not read. */
export function bracketSchedule(spec: DataTableSpec): { brackets: Bracket[]; currency: string } | null {
  const b = spec.brackets;
  if (!b.enabled || b.rateColumnIndex < 0 || b.overColumnIndex < 0) return null;
  const brackets: Bracket[] = [];
  for (let r = 0; r < spec.rows.length; r++) {
    const rate = cellNumber(spec, r, b.rateColumnIndex);
    const over = cellNumber(spec, r, b.overColumnIndex);
    if (rate === null || over === null) return null;
    brackets.push({ rate, over, rowIndex: r });
  }
  for (let i = 1; i < brackets.length; i++) if ((brackets[i]?.over ?? 0) <= (brackets[i - 1]?.over ?? 0)) return null;
  if (brackets.length === 0) return null;
  const first = spec.rows[0]?.values[b.overColumnIndex]?.value.trim() ?? '';
  const unit = spec.columns[b.overColumnIndex]?.unit.trim() ?? '';
  const currency = first.startsWith('$') || unit === '$' ? '$' : '';
  return { brackets, currency };
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

/** The progressive tax on an income under the page's schedule (engine: progressiveTax); null without a schedule. */
export function taxView(spec: DataTableSpec, income: number): TaxView | null {
  const sched = bracketSchedule(spec);
  if (sched === null) return null;
  const inc = Number.isFinite(income) && income > 0 ? income : 0;
  const res = progressiveTax(sched.brackets.map((b) => ({ rate: b.rate, over: b.over })), inc);
  const parts = res.parts.map((p): TaxPart => ({ ...p, rowIndex: sched.brackets.find((b) => b.over === p.from)?.rowIndex ?? -1 }));
  const first = sched.brackets[0]?.over ?? 0;
  return {
    income: inc, total: res.total, effectiveRate: inc > 0 ? (res.total / inc) * 100 : 0, parts,
    below: Math.min(inc, first), currency: sched.currency, topRow: parts.length === 0 ? null : (parts[parts.length - 1]?.rowIndex ?? null),
  };
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
