import type { DataQuestionGen, DataTableGen } from '../contracts/kit.ts';

export function parseTableNumber(text: string): number | null {
  if (typeof text !== 'string') {
    return null;
  }
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const normalized = trimmed.replace(/[−‐‑‒–—―﹘＿Ｆ]/g, '-');
  const m = /^([+-]?)\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%?)$/.exec(normalized);
  if (m === null) {
    return null;
  }
  const sign = m[1];
  const intPart = (m[2] as string).replace(/,/g, '');
  const fracPart = m[3] as string | undefined;
  const source = sign + intPart + (fracPart !== undefined ? '.' + fracPart : '');
  if (!/^\d+$/.test(intPart)) {
    return null;
  }
  if (fracPart !== undefined && !/^\d+$/.test(fracPart)) {
    return null;
  }
  if (source === '+' || source === '-' || source === '') {
    return null;
  }
  const n = Number(source);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (n === 0) {
    return 0;
  }
  return n;
}

export function answerQuestion(
  gen: DataTableGen,
  q: DataQuestionGen,
): { rowIndex: number; value: string } | null {
  const rows = gen.rows;
  const columns = gen.columns;
  if (!Array.isArray(rows) || !Array.isArray(columns)) {
    return null;
  }
  if (q.kind === 'lookup') {
    if (!Number.isInteger(q.rowIndex) || !Number.isInteger(q.columnIndex)) {
      return null;
    }
    if (q.rowIndex < 0 || q.rowIndex >= rows.length) {
      return null;
    }
    if (q.columnIndex < 0 || q.columnIndex >= columns.length) {
      return null;
    }
    const row = rows[q.rowIndex];
    if (!row || !Array.isArray(row.values) || q.columnIndex >= row.values.length) {
      return null;
    }
    const cell = row.values[q.columnIndex];
    if (!cell || typeof cell.value !== 'string') {
      return null;
    }
    return { rowIndex: q.rowIndex, value: cell.value };
  }
  if (q.kind === 'largest' || q.kind === 'smallest') {
    if (q.rowIndex !== -1) {
      return null;
    }
    if (!Number.isInteger(q.columnIndex) || q.columnIndex < 0 || q.columnIndex >= columns.length) {
      return null;
    }
    const col = columns[q.columnIndex];
    if (!col || col.numeric !== true) {
      return null;
    }
    const nums: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !Array.isArray(row.values) || q.columnIndex >= row.values.length) {
        return null;
      }
      const cell = row.values[q.columnIndex];
      if (!cell || typeof cell.value !== 'string') {
        return null;
      }
      const v = parseTableNumber(cell.value);
      if (v === null) {
        return null;
      }
      nums.push(v);
    }
    if (nums.length === 0) {
      return null;
    }
    let best = 0;
    for (let r = 1; r < nums.length; r++) {
      if (q.kind === 'largest' ? nums[r] > nums[best] : nums[r] < nums[best]) {
        best = r;
      }
    }
    let count = 0;
    for (const v of nums) {
      if (v === nums[best]) {
        count += 1;
      }
    }
    if (count !== 1) {
      return null;
    }
    const row = rows[best];
    const cell = row.values[q.columnIndex];
    return { rowIndex: best, value: cell.value };
  }
  return null;
}

export interface TaxSlice {
  rate: number;
  from: number;
  to: number;
  tax: number;
}

export function progressiveTax(
  brackets: { rate: number; over: number }[],
  income: number,
): { total: number; parts: TaxSlice[] } {
  if (!Array.isArray(brackets) || brackets.length < 1) {
    throw new RangeError('BRACKETS_INVALID: brackets must be a non-empty array');
  }
  if (typeof income !== 'number' || !Number.isFinite(income) || income < 0) {
    throw new RangeError('BRACKETS_INVALID: income must be a finite number >= 0');
  }
  for (const b of brackets) {
    if (typeof b.rate !== 'number' || !Number.isFinite(b.rate) || b.rate < 0 || b.rate > 100) {
      throw new RangeError('BRACKETS_INVALID: rate must be a percent 0..100');
    }
    if (typeof b.over !== 'number' || !Number.isFinite(b.over) || b.over < 0) {
      throw new RangeError('BRACKETS_INVALID: over must be a finite number >= 0');
    }
  }
  for (let i = 1; i < brackets.length; i++) {
    if (brackets[i].over <= brackets[i - 1].over) {
      throw new RangeError('BRACKETS_INVALID: over thresholds must be strictly ascending');
    }
  }
  const parts: TaxSlice[] = [];
  let total = 0;
  for (let i = 0; i < brackets.length; i++) {
    const from = brackets[i].over;
    const next: number | null = i + 1 < brackets.length ? brackets[i + 1].over : null;
    const to = next === null ? income : Math.min(income, next);
    if (income <= from) {
      continue;
    }
    const taxable = to - from;
    if (taxable <= 0) {
      continue;
    }
    const tax = (taxable * brackets[i].rate) / 100;
    if (!Number.isFinite(tax)) {
      throw new RangeError('BRACKETS_INVALID: tax slice is not finite');
    }
    parts.push({ rate: brackets[i].rate, from, to, tax });
    total += tax;
  }
  if (!Number.isFinite(total)) {
    throw new RangeError('BRACKETS_INVALID: total is not finite');
  }
  return { total, parts };
}
