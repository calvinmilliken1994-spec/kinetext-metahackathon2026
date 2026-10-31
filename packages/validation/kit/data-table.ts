// Stage 8a V-B — data-table-v1 validation (DT-01..DT-08, frozen spec docs/specs/STAGE-8a-subject-engines.md §1d).
// Muse writes lesson DATA grounded in verbatim page quotes; the tested engine
// (packages/kit-engines/table.ts: parseTableNumber, answerQuestion, progressiveTax) computes, and
// these checks tie every value to the page:
//   DT-01 every column, row and cell quote verbatim (shared collectQuoteFailures convention);
//   DT-02 each column header occurs in that column's quote, and each row label occurs in the row's
//         quote or the same source paragraph (the shared labelInQuoteOrParagraph rule);
//   DT-03 each cell value is a WHOLE printed token of its quote: never a substring of a larger
//         printed number ("12,10" cut from "12,104", "104" from "12,104", "4.25" from "4.25-4.50"),
//         never a cut sign, and currency/percent marks copied AS PRINTED ("$640,600", "37%");
//   DT-04 shape: column/row/question counts within KIT_LIMITS.dataTable, one value per column,
//         numeric columns parse with parseTableNumber, distinct row labels;
//   DT-05 questions: valid indices, largest/smallest only on numeric columns, and answerQuestion
//         must return a unique answer (a tie or an unparsable column fails);
//   DT-06 chart: the -1 sentinel or a numeric column;
//   DT-07 brackets: when enabled the rate/threshold columns are distinct numeric columns,
//         thresholds strictly ascending from the first row, rates ascending within [0, 100],
//         exampleIncome > 0, and progressiveTax runs on the page's own brackets; when disabled the
//         -1/-1/0 sentinels must be intact;
//   DT-08 the shared N-01 numbers-checkable rule over the AI-written title and labelHeader and the
//         page-copied headers, units and row labels (cell values are bound to their quotes by the
//         stronger DT-03 as-printed rule instead).
// schema.gen owns the non-quote structural shape (title, lengths, question id pattern/uniqueness).
// Failing checks carry validator-owned `affected` JSON pointers into the GEN (the artifact a repair
// revises), e.g. /rows/2/values/1/value, /questions/0/columnIndex, /brackets/rateColumnIndex; every
// id is always emitted, in frozen order, and no check throws (guarded()).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { DataColumnGen, DataQuestionGen, DataRowGen, DataTableGen } from '../../contracts/kit.ts';
import { answerQuestion, parseTableNumber, progressiveTax } from '../../kit-engines/table.ts';
import { guarded, QUOTE_MESSAGE_LIMIT } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  idProblems,
  lengthProblems,
  normalizeWhitespace,
  numbersCheckProblems,
  truncate,
} from './shared.ts';
import type { EntryQuote } from './shared.ts';
import { labelInQuoteOrParagraph } from './sort.ts';

const L = KIT_LIMITS.dataTable;

function columnsOf(gen: DataTableGen): DataColumnGen[] {
  return Array.isArray(gen?.columns) ? gen.columns : [];
}
function rowsOf(gen: DataTableGen): DataRowGen[] {
  return Array.isArray(gen?.rows) ? gen.rows : [];
}
function valuesOf(row: DataRowGen | undefined): { value?: unknown; sourceId?: unknown; quote?: unknown }[] {
  return Array.isArray(row?.values) ? row.values : [];
}
function questionsOf(gen: DataTableGen): DataQuestionGen[] {
  return Array.isArray(gen?.questions) ? gen.questions : [];
}

/**
 * DT-03 as-printed whole-token rule. `value` must occur in `quote` (both whitespace-normalised,
 * case-insensitive) at a position where nothing adjacent continues a LONGER printed form:
 *   - no digit, '$', '%' or sign/range hyphen directly before or after ("12,10" out of "12,104",
 *     "5832.5" out of "-5832.5", "4.25" out of "4.25-4.50");
 *   - no '.'/',' + digit attached (a decimal-part or thousands-grouping crop: "104" out of "12,104",
 *     "85" out of "0.854") — a sentence-final period after the value stays fine;
 *   - a printed '$' before the occurrence or '%' after it belongs to the value: the cell must copy
 *     the token AS PRINTED ("$640,600", "37%"), never a bare "640,600" or "37" from that quote;
 *   - letters need word boundaries ("No" never matches inside "November");
 *   - a trailing footnote mark is not part of the number ("0.384" is whole in "0.384*").
 * `printed` is the longer printed run around a blocked occurrence, for the plain-language message.
 */
export function valueAsPrintedIn(value: unknown, quote: unknown): { ok: boolean; contained: boolean; printed: string | null } {
  if (typeof value !== 'string' || typeof quote !== 'string') return { ok: false, contained: false, printed: null };
  const hay = normalizeWhitespace(quote).toLowerCase();
  const ndl = normalizeWhitespace(value).toLowerCase();
  if (hay === '' || ndl === '') return { ok: false, contained: false, printed: null };
  const startsDigit = /^[0-9]/.test(ndl);
  const startsLetter = /^[a-z]/.test(ndl);
  const endsDigit = /[0-9]$/.test(ndl);
  const endsLetter = /[a-z]$/.test(ndl);
  let contained = false;
  let printed: string | null = null;
  for (let at = hay.indexOf(ndl); at !== -1; at = hay.indexOf(ndl, at + 1)) {
    contained = true;
    const end = at + ndl.length;
    const prev = at === 0 ? '' : (hay[at - 1] as string);
    const next = (hay[end] ?? '') as string;
    const next2 = (hay[end + 1] ?? '') as string;
    const blocked =
      /[0-9$%\-]/.test(prev) ||
      ((prev === '.' || prev === ',') && startsDigit) ||
      (startsLetter && /[a-z]/.test(prev)) ||
      /[0-9]/.test(next) ||
      (next === '%' && !ndl.endsWith('%')) ||
      (next === '$' && endsDigit) ||
      ((next === '.' || next === ',') && /[0-9]/.test(next2)) ||
      (next === '-' && /[0-9]/.test(next2)) ||
      (endsLetter && /[a-z0-9]/.test(next)) ||
      (endsDigit && /[a-z]/.test(next));
    if (!blocked) return { ok: true, contained: true, printed: null };
    if (printed === null) printed = printedRunAround(hay, at, end);
  }
  return { ok: false, contained, printed };
}

/** The maximal printed number-ish run around [start, end) of `hay` (for "the quote prints X there"). */
function printedRunAround(hay: string, start: number, end: number): string {
  let s = start;
  let e = end;
  while (s > 0 && /[0-9$.,\-]/.test(hay[s - 1] as string)) s--;
  while (e < hay.length && /[0-9$.,%\-*]/.test(hay[e] as string)) e++;
  return hay.slice(s, e);
}

export function dataTableStructuralProblems(gen: DataTableGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen?.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  push(lengthProblems('labelHeader', gen?.labelHeader, L.header.min, L.header.max), '/labelHeader');
  columnsOf(gen).forEach((c, j) => {
    push(lengthProblems(`columns[${j}].header`, c?.header, L.header.min, L.header.max), `/columns/${j}/header`);
    push(lengthProblems(`columns[${j}].unit`, c?.unit, L.unit.min, L.unit.max), `/columns/${j}/unit`);
  });
  rowsOf(gen).forEach((row, i) => {
    push(lengthProblems(`rows[${i}].label`, row?.label, L.label.min, L.label.max), `/rows/${i}/label`);
    valuesOf(row).forEach((v, j) => {
      push(lengthProblems(`rows[${i}].values[${j}].value`, v?.value, L.value.min, L.value.max), `/rows/${i}/values/${j}/value`);
    });
  });
  const questions = questionsOf(gen);
  const qIds = questions.map(q => String(q?.id));
  const qDups = duplicateOccurrences(qIds);
  questions.forEach((q, i) => {
    push(idProblems(`questions[${i}].id`, q?.id), `/questions/${i}/id`);
    if (qDups.has(qIds[i] as string)) {
      problems.push(`question id "${qIds[i]}" occurs more than once (expected unique ids)`);
      affected.push(`/questions/${i}/id`);
    }
  });
  return { problems, affected };
}

export function validateDataTable(gen: DataTableGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  // Defensive: a direct call with junk degrades into failed checks, never a throw.
  const g = (typeof gen === 'object' && gen !== null ? gen : {}) as DataTableGen;
  const idx = buildSourceIndex(Array.isArray(sources) ? sources : []);
  const all = idx.allTexts();
  const structural = dataTableStructuralProblems(g);
  const columns = columnsOf(g);
  const rows = rowsOf(g);
  const questions = questionsOf(g);
  const headerOf = (j: number): string => String(columns[j]?.header ?? `columns[${j}]`);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every data-table title, header, unit, label, value length and question id shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `data-table gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('DT-01', 'grounding', () => {
      const entries: EntryQuote[] = [];
      columns.forEach((c, j) => {
        entries.push({ quote: c?.quote, sourceId: c?.sourceId, quotePtr: `/columns/${j}/quote`, sourceIdPtr: `/columns/${j}/sourceId`, label: `columns[${j}].quote` });
      });
      rows.forEach((row, i) => {
        entries.push({ quote: row?.quote, sourceId: row?.sourceId, quotePtr: `/rows/${i}/quote`, sourceIdPtr: `/rows/${i}/sourceId`, label: `rows[${i}].quote` });
        valuesOf(row).forEach((v, j) => {
          entries.push({ quote: v?.quote, sourceId: v?.sourceId, quotePtr: `/rows/${i}/values/${j}/quote`, sourceIdPtr: `/rows/${i}/values/${j}/sourceId`, label: `rows[${i}].values[${j}].quote` });
        });
      });
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} column, row and cell quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters copied from the cited source)`, path: affected[0], affected };
    }),

    guarded('DT-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      columns.forEach((c, j) => {
        if (typeof c?.header === 'string' && c.header !== '' && !containsNormalized(typeof c?.quote === 'string' ? c.quote : '', c.header)) {
          problems.push(`columns[${j}]: the header "${c.header}" does not occur in its quote "${truncate(String(c?.quote ?? ''), QUOTE_MESSAGE_LIMIT)}" (the column quote must contain the header as the page prints it)`);
          affected.push(`/columns/${j}/header`, `/columns/${j}/quote`);
        }
      });
      rows.forEach((row, i) => {
        if (typeof row?.label !== 'string' || row.label === '') return; // schema.gen owns the empty label
        if (!labelInQuoteOrParagraph(row.label, typeof row?.quote === 'string' ? row.quote : '', typeof row?.sourceId === 'string' ? row.sourceId : '', idx)) {
          problems.push(`rows[${i}]: the label "${row.label}" occurs neither in its quote "${truncate(String(row?.quote ?? ''), QUOTE_MESSAGE_LIMIT)}" nor in the same source paragraph (the row must be the page's own row)`);
          affected.push(`/rows/${i}/label`, `/rows/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every column header occurs in its column quote and every row label occurs in its row quote or the same source paragraph (headers-and-labels-in-quote)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('DT-03', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let checked = 0;
      rows.forEach((row, i) => {
        valuesOf(row).forEach((v, j) => {
          const r = valueAsPrintedIn(v?.value, v?.quote);
          if (r.ok) { checked++; return; }
          const shown = truncate(String(v?.quote ?? ''), QUOTE_MESSAGE_LIMIT);
          problems.push(r.contained
            ? `rows[${i}].values[${j}]: the value "${String(v?.value)}" is not a whole printed token of its quote "${shown}"${r.printed !== null ? ` — the quote prints "${r.printed}" there; copy the complete value as printed, including commas, $ and %` : ''}`
            : `rows[${i}].values[${j}]: the value "${String(v?.value)}" does not occur in its quote "${shown}" at all`);
          affected.push(`/rows/${i}/values/${j}/value`, `/rows/${i}/values/${j}/quote`);
        });
      });
      return problems.length === 0
        ? { passed: true, message: `all ${checked} cell value(s) occur in their own quote exactly as the page prints them, as whole tokens — never a crop of a longer number (values-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('DT-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (columns.length < L.columns.min || columns.length > L.columns.max) {
        problems.push(`columns has ${columns.length} entries, expected ${L.columns.min}-${L.columns.max}`);
        affected.push('/columns');
      }
      if (rows.length < L.rows.min || rows.length > L.rows.max) {
        problems.push(`rows has ${rows.length} entries, expected ${L.rows.min}-${L.rows.max}`);
        affected.push('/rows');
      }
      if (questions.length < L.questions.min || questions.length > L.questions.max) {
        problems.push(`questions has ${questions.length} entries, expected ${L.questions.min}-${L.questions.max}`);
        affected.push('/questions');
      }
      rows.forEach((row, i) => {
        const values = valuesOf(row);
        if (values.length !== columns.length) {
          problems.push(`rows[${i}] has ${values.length} values; it needs one per column (${columns.length})`);
          affected.push(`/rows/${i}/values`);
        }
      });
      columns.forEach((c, j) => {
        if (c?.numeric !== true) return;
        rows.forEach((row, i) => {
          const v = valuesOf(row)[j];
          if (v === undefined) return; // the row-length problem above owns the missing slot
          if (parseTableNumber(String(v?.value)) === null) {
            problems.push(`rows[${i}].values[${j}].value "${String(v?.value)}" is not a number, but the column "${headerOf(j)}" is numeric: every value in it must parse with parseTableNumber (like "12,104", "$640,600", "37%" or "-0.5")`);
            affected.push(`/rows/${i}/values/${j}/value`);
          }
        });
      });
      const labels = rows.map(r => String(r?.label));
      const dups = duplicateOccurrences(labels);
      rows.forEach((row, i) => {
        if (dups.has(labels[i] as string)) {
          problems.push(`rows[${i}].label "${labels[i]}" occurs more than once (every row needs a distinct label)`);
          affected.push(`/rows/${i}/label`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `the table shape is valid: ${rows.length} rows x ${columns.length} value columns with exactly one value per slot, every numeric column parses with parseTableNumber, and the row labels are distinct (shape-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('DT-05', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const answers: string[] = [];
      questions.forEach((q, i) => {
        const kind = q?.kind;
        const ri = q?.rowIndex;
        const ci = q?.columnIndex;
        const qProblems: string[] = [];
        const qAffected: string[] = [];
        if (kind === 'lookup') {
          if (!Number.isInteger(ri) || ri < 0 || ri >= rows.length) {
            qProblems.push(`questions[${i}] (${String(q?.id)}): rowIndex ${JSON.stringify(ri)} is out of range for a lookup, expected 0..${rows.length - 1}`);
            qAffected.push(`/questions/${i}/rowIndex`);
          }
        } else if (kind === 'largest' || kind === 'smallest') {
          if (ri !== -1) {
            qProblems.push(`questions[${i}] (${String(q?.id)}): rowIndex is ${JSON.stringify(ri)}, expected the -1 sentinel for a ${kind} question`);
            qAffected.push(`/questions/${i}/rowIndex`);
          }
        } else {
          qProblems.push(`questions[${i}].kind is ${JSON.stringify(kind)}, expected lookup, largest or smallest`);
          qAffected.push(`/questions/${i}/kind`);
        }
        if (kind === 'lookup' || kind === 'largest' || kind === 'smallest') {
          if (!Number.isInteger(ci) || ci < 0 || ci >= columns.length) {
            qProblems.push(`questions[${i}] (${String(q?.id)}): columnIndex ${JSON.stringify(ci)} is out of range, expected 0..${columns.length - 1}`);
            qAffected.push(`/questions/${i}/columnIndex`);
          } else if (kind !== 'lookup' && columns[ci]?.numeric !== true) {
            qProblems.push(`questions[${i}] (${String(q?.id)}): a ${kind} question needs a numeric column, but column ${ci} ("${headerOf(ci)}") is not numeric`);
            qAffected.push(`/questions/${i}/kind`, `/questions/${i}/columnIndex`);
          }
        }
        if (qProblems.length === 0) {
          // The engine is the answer key: it must return a unique answer (a tie returns null).
          const answer = answerQuestion(g, q);
          if (answer === null) {
            qProblems.push(`questions[${i}] (${String(q?.id)}): our code finds no answer for this ${String(kind)} question — ${kind === 'lookup' ? 'the cell does not exist' : `column ${ci} ("${headerOf(Number(ci))}") has no unique ${String(kind)} value (a tie, or a value that does not parse)`}`);
            qAffected.push(`/questions/${i}/kind`, `/questions/${i}/rowIndex`, `/questions/${i}/columnIndex`);
          } else {
            answers.push(`"${String(q?.id)}" (${String(kind)}) → rows[${answer.rowIndex}] "${answer.value}"`);
          }
        }
        if (qProblems.length > 0) { problems.push(...qProblems); affected.push(...qAffected); }
      });
      return problems.length === 0
        ? { passed: true, message: `our code answers every question from the table itself: ${answers.join('; ')} (questions-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('DT-06', 'semantic', () => {
      const ci: unknown = g?.chartColumnIndex;
      if (ci === -1) {
        return { passed: true, message: 'chartColumnIndex is the -1 sentinel: this table shows no chart (chart-valid)' };
      }
      if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci >= columns.length) {
        return {
          passed: false,
          message: `chartColumnIndex is ${JSON.stringify(ci)}, expected the -1 sentinel (no chart) or a column index 0..${Math.max(columns.length - 1, 0)} (chart-valid)`,
          path: '/chartColumnIndex',
          affected: ['/chartColumnIndex'],
        };
      }
      if (columns[ci]?.numeric !== true) {
        return {
          passed: false,
          message: `the chart column ${ci} ("${headerOf(ci)}") is not numeric: a chart can only draw values parseTableNumber parses (chart-valid)`,
          path: '/chartColumnIndex',
          affected: ['/chartColumnIndex', `/columns/${ci}/numeric`],
        };
      }
      return { passed: true, message: `the chart draws the numeric column ${ci} ("${headerOf(ci)}") (chart-valid)` };
    }),

    guarded('DT-07', 'behavioral', () => {
      const b = (typeof g?.brackets === 'object' && g.brackets !== null ? g.brackets : {}) as Partial<DataTableGen['brackets']>;
      const problems: string[] = [];
      const affected: string[] = [];
      if (b.enabled !== true) {
        const sentinels: [string, unknown, number][] = [
          ['/brackets/rateColumnIndex', b.rateColumnIndex, -1],
          ['/brackets/overColumnIndex', b.overColumnIndex, -1],
          ['/brackets/exampleIncome', b.exampleIncome, 0],
        ];
        for (const [ptr, value, want] of sentinels) {
          if (value !== want) {
            problems.push(`the bracket calculator is disabled, so ${ptr.replace('/brackets/', '')} must keep the ${want} sentinel, got ${JSON.stringify(value)}`);
            affected.push(ptr);
          }
        }
        return problems.length === 0
          ? { passed: true, message: 'the progressive-rate calculator is off and its sentinels are intact (brackets-valid)' }
          : { passed: false, message: problems.join('; '), path: affected[0], affected };
      }
      const rateCol = b.rateColumnIndex;
      const overCol = b.overColumnIndex;
      let usable = true;
      for (const [name, ci] of [['rateColumnIndex', rateCol], ['overColumnIndex', overCol]] as const) {
        if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0 || ci >= columns.length) {
          problems.push(`brackets.${name} is ${JSON.stringify(ci)}, expected a column index 0..${columns.length - 1}`);
          affected.push(`/brackets/${name}`);
          usable = false;
        } else if (columns[ci]?.numeric !== true) {
          problems.push(`brackets.${name} points at column ${ci} ("${headerOf(ci)}"), which is not numeric: the calculator needs numbers it can parse`);
          affected.push(`/brackets/${name}`);
          usable = false;
        }
      }
      if (usable && rateCol === overCol) {
        problems.push(`brackets.rateColumnIndex and brackets.overColumnIndex both point at column ${String(rateCol)}; the calculator needs a rate column and a separate threshold column`);
        affected.push('/brackets/rateColumnIndex', '/brackets/overColumnIndex');
        usable = false;
      }
      const income = b.exampleIncome;
      if (typeof income !== 'number' || !Number.isFinite(income) || income <= 0) {
        problems.push(`brackets.exampleIncome is ${JSON.stringify(income)}, expected a number greater than 0`);
        affected.push('/brackets/exampleIncome');
        usable = false;
      }
      if (!usable) {
        return { passed: false, message: problems.join('; '), path: affected[0], affected };
      }
      const rc = rateCol as number;
      const oc = overCol as number;
      const pairs: { rate: number; over: number }[] = [];
      rows.forEach((row, i) => {
        const rateText = String(valuesOf(row)[rc]?.value ?? '');
        const overText = String(valuesOf(row)[oc]?.value ?? '');
        const rate = parseTableNumber(rateText);
        const over = parseTableNumber(overText);
        if (rate === null || over === null) {
          problems.push(`rows[${i}]: the bracket calculator cannot read rate "${rateText}" / threshold "${overText}" (both columns must hold numbers parseTableNumber parses)`);
          affected.push(`/rows/${i}/values/${rc}/value`, `/rows/${i}/values/${oc}/value`);
          return;
        }
        const prev = pairs[pairs.length - 1];
        if (prev !== undefined) {
          if (over <= prev.over) {
            problems.push(`rows[${i}]: the threshold "${overText}" (${over}) is not strictly above the previous row's ${prev.over} — bracket thresholds must ascend from the first row`);
            affected.push(`/rows/${i}/values/${oc}/value`);
          }
          if (rate < prev.rate) {
            problems.push(`rows[${i}]: the rate "${rateText}" (${rate}) is below the previous row's ${prev.rate} — bracket rates must ascend`);
            affected.push(`/rows/${i}/values/${rc}/value`);
          }
        }
        if (rate < 0 || rate > 100) {
          problems.push(`rows[${i}]: the rate ${rate} is outside 0..100 percent`);
          affected.push(`/rows/${i}/values/${rc}/value`);
        }
        pairs.push({ rate, over });
      });
      if (problems.length > 0) {
        return { passed: false, message: problems.join('; '), path: affected[0], affected };
      }
      try {
        const result = progressiveTax(pairs, income as number);
        const total = Math.round(result.total * 100) / 100;
        return { passed: true, message: `the progressive-rate calculator runs on the page's own brackets: an example income of ${String(income)} takes ${String(total)} across ${result.parts.length} bracket(s) — thresholds strictly ascending, rates ascending within 0..100 (brackets-valid)` };
      } catch (err) {
        return {
          passed: false,
          message: `the progressive-rate calculator rejects these brackets: ${err instanceof Error ? err.message : String(err)} (brackets-valid)`,
          path: '/brackets',
          affected: ['/brackets/rateColumnIndex', '/brackets/overColumnIndex', '/brackets/exampleIncome'],
        };
      }
    }),

    guarded('DT-08', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, cited: unknown, ptr: string): void => {
        const citedText = typeof cited === 'string' ? idx.textOf(cited) : undefined;
        const p = numbersCheckProblems(label, text, [citedText, ...all]);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', g.title, undefined, '/title');
      check('labelHeader', g.labelHeader, undefined, '/labelHeader');
      columns.forEach((c, j) => {
        check(`columns[${j}].header`, c?.header, c?.sourceId, `/columns/${j}/header`);
        check(`columns[${j}].unit`, c?.unit, c?.sourceId, `/columns/${j}/unit`);
      });
      rows.forEach((row, i) => check(`rows[${i}].label`, row?.label, row?.sourceId, `/rows/${i}/label`));
      return problems.length === 0
        ? { passed: true, message: 'every number in the title, the label header, the column headers and units and the row labels appears on the cited page (N-01); cell values are bound to their quotes as printed by DT-03 (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('data-table-v1', checks, opts.revision ?? 1);
}
