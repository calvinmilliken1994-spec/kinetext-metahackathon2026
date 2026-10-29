// S6-V — compare-table-v1 validation (CT-01..CT-05, design §2.6 frozen; Stage 6 compare-grid
// step 1, docs/specs/STAGE-6-compare-grid.md: Muse writes rows of values — no cell ids, no
// indexes — and our code builds the spec grid with compareGridFromRows from contracts).
//
// CT-02 (the design's exact rule): every cell value occurs in its own quote (required) AND the
// row's entity name occurs in that quote or in the same paragraph as the located quote span (the
// SORT-02 rule). The design discloses the false accept: paragraph-level entity attribution
// without a direct statement; every quote is shown.
// CT-03 shape: every row carries exactly one value per attribute column (the frozen message
// `rows[2] has 3 values; it needs one per column (4)`), row and attribute names are distinct,
// and the row/attribute counts stay inside KIT_LIMITS.compare.
// CT-05 predict-cell-valid never fails the component: when no attribute column offers >= 3
// distinct cell values (the "3 seeded same-column options" of §2.6e), the message records that
// the UI falls back to reveal-only (design: "falls back to reveal-only, not component failure").
// schema.gen additionally owns the page-wording rule (compare-grid step 1): an entity or
// attribute name that looks like an id — kebab-case, or an underscore without any space — and
// does NOT occur in the cited source text (lead ruling: real hyphenated words the page uses, like
// 'set-aside' or 'half-life', are page wording) fails
// with `rows[0].entity "constant-pressure-process" looks like an id; use the words the page uses`
// (the live Spark Open failure class: 'this-equation', 'constant-pressure-process',
// 'starting-at-age-14'). There is no per-cell drop helper: a bad value fails the component with
// the frozen failure message.
// Affected pointers index the GEN shape (the artifact a repair revises): /title, /attributes/j,
// /rows, /rows/i/entity, /rows/i/values, /rows/i/values/j/{value|quote|sourceId}.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { compareGridFromRows, KIT_LIMITS } from '../../contracts/kit.ts';
import type { CompareRowGen, CompareTableGen, CompareValueGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  KIT_FAILURE_MESSAGES,
  lengthProblems,
  numbersCheckProblems,
} from './shared.ts';
import type { EntryQuote } from './shared.ts';
import { labelInQuoteOrParagraph } from './sort.ts';

const L = KIT_LIMITS.compare;

/** The frozen id-like-name pattern (compare-grid step 1): lowercase kebab-case. */
const ID_LIKE_KEBAB = /^[a-z0-9]+(-[a-z0-9]+)+$/;

/**
 * The page-wording rule for row/column names: a name that matches the kebab-case id pattern,
 * or contains '_' with no space, reads as an id rather than the words the page uses — UNLESS the
 * name really occurs in the cited source text (case-insensitive, whitespace-normalised, as a whole
 * token), in which case it is page wording ('set-aside', 'half-life', 'long-term'). Returns the
 * frozen problem message, or null when the name is ordinary page wording. Without `sourceTexts`
 * nothing can be on a page, so the strict id-pattern rule applies.
 */
export function idLikeNameProblem(label: string, name: unknown, sourceTexts: readonly (string | undefined)[] = []): string | null {
  if (typeof name !== 'string') return null;
  if (ID_LIKE_KEBAB.test(name) || (name.includes('_') && !/\s/.test(name))) {
    if (occursInPage(name, sourceTexts)) return null;
    return `${label} "${name}" looks like an id; use the words the page uses`;
  }
  return null;
}

/** True when `name` occurs in any of the texts as a whole token (not inside a longer hyphenated/underscored word). */
function occursInPage(name: string, texts: readonly (string | undefined)[]): boolean {
  const needle = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle === '') return false;
  const re = new RegExp(`(?<![A-Za-z0-9_-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_-])`);
  return texts.some(t => typeof t === 'string' && re.test(t.replace(/\s+/g, ' ').toLowerCase()));
}

function valuesOf(row: CompareRowGen | undefined): CompareValueGen[] {
  return Array.isArray(row?.values) ? row.values : [];
}

/** Texts of the sources the table's cells cite (all provided sources when none resolves). */
function citedTexts(gen: CompareTableGen, texts: { sourceTextOf: (id: string) => string | undefined; all: string[] }): string[] {
  const out: string[] = [];
  for (const row of Array.isArray(gen.rows) ? gen.rows : []) {
    for (const v of valuesOf(row)) {
      const t = typeof v?.sourceId === 'string' ? texts.sourceTextOf(v.sourceId) : undefined;
      if (t !== undefined && !out.includes(t)) out.push(t);
    }
  }
  return out.length > 0 ? out : texts.all;
}

/** `pageTexts` = the cited source text(s), against which kebab-case / underscore names are tested. */
export function compareStructuralProblems(gen: CompareTableGen, pageTexts: readonly (string | undefined)[] = []): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  const attributes = Array.isArray(gen.attributes) ? gen.attributes : [];
  attributes.forEach((at, j) => {
    if (typeof at !== 'string' || at === '') {
      problems.push(`attributes[${j}] must be a non-empty string`);
      affected.push(`/attributes/${j}`);
      return;
    }
    const idLike = idLikeNameProblem(`attributes[${j}]`, at, pageTexts);
    if (idLike !== null) { problems.push(idLike); affected.push(`/attributes/${j}`); }
  });
  const rows = Array.isArray(gen.rows) ? gen.rows : [];
  rows.forEach((row, i) => {
    const entity = row?.entity;
    if (typeof entity !== 'string' || entity === '') {
      problems.push(`rows[${i}].entity must be a non-empty string`);
      affected.push(`/rows/${i}/entity`);
    } else {
      const idLike = idLikeNameProblem(`rows[${i}].entity`, entity, pageTexts);
      if (idLike !== null) { problems.push(idLike); affected.push(`/rows/${i}/entity`); }
    }
    valuesOf(row).forEach((v, j) => {
      push(lengthProblems(`rows[${i}].values[${j}].value`, v?.value, L.value.min, L.value.max), `/rows/${i}/values/${j}/value`);
    });
  });
  return { problems, affected };
}

export function validateCompareTable(gen: CompareTableGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = compareStructuralProblems(gen, citedTexts(gen, { sourceTextOf: id => idx.textOf(id), all }));
  const attributes: unknown[] = Array.isArray(gen.attributes) ? gen.attributes : [];
  const rows: CompareRowGen[] = Array.isArray(gen.rows) ? gen.rows : [];

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every compare-table text length is within the frozen limits and every row and column name uses page words, never an id' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `compare-table gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('CT-01', 'grounding', () => {
      const entries: EntryQuote[] = [];
      rows.forEach((row, i) => {
        valuesOf(row).forEach((v, j) => {
          entries.push({
            quote: v?.quote,
            sourceId: v?.sourceId,
            quotePtr: `/rows/${i}/values/${j}/quote`,
            sourceIdPtr: `/rows/${i}/values/${j}/sourceId`,
            label: `rows[${i}].values[${j}]`,
          });
        });
      });
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} cell quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('CT-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      rows.forEach((row, i) => {
        const entity = row?.entity;
        valuesOf(row).forEach((v, j) => {
          if (!containsNormalized(v?.quote ?? '', v?.value ?? '')) {
            problems.push(`rows[${i}].values[${j}]: the value "${String(v?.value)}" does not occur in its quote (cell-in-quote requires the value IN the quote)`);
            affected.push(`/rows/${i}/values/${j}/value`, `/rows/${i}/values/${j}/quote`);
          }
          if (typeof entity === 'string' && entity !== '') {
            if (!labelInQuoteOrParagraph(entity, v?.quote ?? '', typeof v?.sourceId === 'string' ? v.sourceId : '', idx)) {
              problems.push(`rows[${i}].values[${j}]: the entity "${entity}" occurs neither in the quote nor in the same paragraph as the located quote span (cell-in-quote)`);
              affected.push(`/rows/${i}/entity`, `/rows/${i}/values/${j}/quote`);
            }
          }
        });
      });
      return problems.length === 0
        ? { passed: true, message: 'every cell value occurs in its quote and every row entity occurs in the quote or the same source paragraph (cell-in-quote; paragraph-level entity attribution is the design-disclosed false accept — quotes are visible)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (rows.length < L.entities.min || rows.length > L.entities.max) {
        problems.push(`rows has ${rows.length} entries, expected ${L.entities.min}-${L.entities.max}`);
        affected.push('/rows');
      }
      if (attributes.length < L.attributes.min || attributes.length > L.attributes.max) {
        problems.push(`attributes has ${attributes.length} entries, expected ${L.attributes.min}-${L.attributes.max}`);
        affected.push('/attributes');
      }
      const attrDups = duplicateOccurrences(attributes.map(a => String(a)));
      attributes.forEach((at, j) => {
        if (attrDups.has(String(at))) {
          problems.push(`attributes[${j}] "${String(at)}" occurs more than once (every column needs a distinct attribute name)`);
          affected.push(`/attributes/${j}`);
        }
      });
      const entityDups = duplicateOccurrences(rows.map(r => String(r?.entity)));
      rows.forEach((row, i) => {
        if (entityDups.has(String(row?.entity))) {
          problems.push(`rows[${i}].entity "${String(row?.entity)}" occurs more than once (every row needs a distinct entity name)`);
          affected.push(`/rows/${i}/entity`);
        }
        const values = valuesOf(row);
        if (values.length !== attributes.length) {
          problems.push(`rows[${i}] has ${values.length} values; it needs one per column (${attributes.length})`);
          affected.push(`/rows/${i}/values`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `the table shape is valid: ${rows.length} rows x ${attributes.length} attributes with exactly one value per row-column slot (shape-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-04', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      attributes.forEach((at, j) => {
        const p = numbersCheckProblems(`attributes[${j}]`, at, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/attributes/${j}`); }
      });
      rows.forEach((row, i) => {
        const p = numbersCheckProblems(`rows[${i}].entity`, row?.entity, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/rows/${i}/entity`); }
        valuesOf(row).forEach((v, j) => {
          const cited = typeof v?.sourceId === 'string' ? idx.textOf(v.sourceId) : undefined;
          const pv = numbersCheckProblems(`rows[${i}].values[${j}].value`, v?.value, [cited, ...all]);
          if (pv.length > 0) { problems.push(...pv); affected.push(`/rows/${i}/values/${j}/value`); }
        });
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in entity names, attributes and cell values appears on the cited page or in the same quote (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-05', 'semantic', () => {
      // Informational by design: the system chooses the predict cell; when no column offers
      // three distinct seeded options the UI falls back to reveal-only — never a component failure.
      // The grid comes from compareGridFromRows (contracts) — the single source of truth shared
      // with assembleKitSpec, so the check sees exactly what the published spec will hold.
      const grid = Array.isArray(gen?.rows) ? compareGridFromRows(gen) : { entities: [] as string[], cells: [] };
      let bestColumn = -1;
      for (let at = 0; at < attributes.length; at++) {
        const values = grid.cells
          .filter(c => c.attributeIndex === at && typeof c.value === 'string')
          .map(c => (c.value as string).replace(/\s+/g, ' ').trim().toLowerCase());
        if (new Set(values).size >= 3) { bestColumn = at; break; }
      }
      return {
        passed: true,
        message: bestColumn >= 0
          ? `predict mode is available: attribute "${String(attributes[bestColumn])}" offers >= 3 distinct seeded same-column options (predict-cell-valid)`
          : 'no attribute column offers 3 distinct cell values, so the UI falls back to reveal-only with unverified cells blanked as "Not stated on this page" — by design this is not a component failure (predict-cell-valid)',
      };
    }),
  ];

  return buildReport('compare-table-v1', checks, opts.revision ?? 1);
}

/** Compare tables have no drop helper (the rows are the frozen table identity); the frozen failure message. */
export const COMPARE_FAILURE_MESSAGE: string = KIT_FAILURE_MESSAGES['compare-table-v1'] as string;
