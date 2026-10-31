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

const CEILING_PHRASES: readonly string[] = [
  'or less',
  'or under',
  'and under',
  'up to',
  'not over',
];

function ceilingRemainder(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const lower = trimmed.toLowerCase();
  for (const phrase of CEILING_PHRASES) {
    if (lower.startsWith(phrase)) {
      const after: string = lower.slice(phrase.length);
      if (after !== '' && /[a-z]/.test(after[0] as string)) {
        continue;
      }
      const rest = trimmed.slice(phrase.length).trim();
      if (rest !== '') {
        return rest;
      }
    }
    if (lower.endsWith(phrase)) {
      const at = lower.length - phrase.length;
      const before: string = at === 0 ? '' : (lower[at - 1] as string);
      if (before !== '' && /[a-z]/.test(before)) {
        continue;
      }
      const rest = trimmed.slice(0, at).trim();
      if (rest !== '') {
        return rest;
      }
    }
  }
  return null;
}

function isCeilingPhrase(text: string): boolean {
  const rest = ceilingRemainder(text);
  if (rest === null) {
    return false;
  }
  return parseTableNumber(rest) !== null;
}

export function bracketFloors(overTexts: readonly string[]): number[] | null {
  if (!Array.isArray(overTexts) || overTexts.length < 1) {
    return null;
  }
  const floors: number[] = [];
  for (let i = 0; i < overTexts.length; i++) {
    const text = overTexts[i] as string;
    if (typeof text !== 'string') {
      return null;
    }
    if (i === 0 && isCeilingPhrase(text)) {
      floors.push(0);
      continue;
    }
    const v = parseTableNumber(text);
    if (v === null) {
      return null;
    }
    floors.push(v);
  }
  for (let i = 1; i < floors.length; i++) {
    if (!(floors[i] as number > (floors[i - 1] as number))) {
      return null;
    }
  }
  return floors;
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
    const brackets = (gen as { brackets?: { enabled?: unknown; overColumnIndex?: unknown } }).brackets;
    const useBracketFloors =
      typeof brackets === 'object' &&
      brackets !== null &&
      brackets.enabled === true &&
      brackets.overColumnIndex === q.columnIndex;
    if (useBracketFloors) {
      const overTexts: string[] = [];
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !Array.isArray(row.values) || q.columnIndex >= row.values.length) {
          return null;
        }
        const cell = row.values[q.columnIndex];
        if (!cell || typeof cell.value !== 'string') {
          return null;
        }
        overTexts.push(cell.value);
      }
      if (overTexts.length === 0) {
        return null;
      }
      const floors = bracketFloors(overTexts);
      if (floors === null) {
        return null;
      }
      let best = 0;
      for (let r = 1; r < floors.length; r++) {
        const cur = floors[r] as number;
        const curBest = floors[best] as number;
        if (q.kind === 'largest' ? cur > curBest : cur < curBest) {
          best = r;
        }
      }
      let count = 0;
      for (const v of floors) {
        if (v === (floors[best] as number)) {
          count += 1;
        }
      }
      if (count !== 1) {
        return null;
      }
      const row = rows[best];
      if (!row || !Array.isArray(row.values) || q.columnIndex >= row.values.length) {
        return null;
      }
      const cell = row.values[q.columnIndex];
      if (!cell || typeof cell.value !== 'string') {
        return null;
      }
      return { rowIndex: best, value: cell.value };
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
      if (q.kind === 'largest' ? nums[r] as number > (nums[best] as number) : nums[r] as number < (nums[best] as number)) {
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
    if (brackets[i]!.over <= brackets[i - 1]!.over) {
      throw new RangeError('BRACKETS_INVALID: over thresholds must be strictly ascending');
    }
  }
  const parts: TaxSlice[] = [];
  let total = 0;
  for (let i = 0; i < brackets.length; i++) {
    const from = brackets[i]!.over;
    const next: number | null = i + 1 < brackets.length ? brackets[i + 1]!.over : null;
    const to = next === null ? income : Math.min(income, next);
    if (income <= from) {
      continue;
    }
    const taxable = to - from;
    if (taxable <= 0) {
      continue;
    }
    const tax = (taxable * brackets[i]!.rate) / 100;
    if (!Number.isFinite(tax)) {
      throw new RangeError('BRACKETS_INVALID: tax slice is not finite');
    }
    parts.push({ rate: brackets[i]!.rate, from, to, tax });
    total += tax;
  }
  if (!Number.isFinite(total)) {
    throw new RangeError('BRACKETS_INVALID: total is not finite');
  }
  return { total, parts };
}
