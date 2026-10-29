// S6-V — compare-table-v1 validation (CT-01..CT-05, design §2.6 frozen).
//
// CT-02 (the design's exact rule): the cell value occurs in the cell's quote (required) AND the
// entity name occurs in the quote or in the same paragraph as the located quote span (the
// SORT-02 rule). The design discloses the false accept: paragraph-level entity attribution
// without a direct statement; every quote is shown.
// CT-05 predict-cell-valid never fails the component: when no attribute column offers >= 3
// distinct cell values (the "3 seeded same-column options" of §2.6e), the message records that
// the UI falls back to reveal-only (design: "falls back to reveal-only, not component failure").
// There is no per-cell drop helper: cells must form the exact entity x attribute product, so a
// bad cell fails the component with the frozen shape message.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { CompareTableGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  idProblems,
  KIT_FAILURE_MESSAGES,
  lengthProblems,
  numbersCheckProblems,
} from './shared.ts';
import { labelInQuoteOrParagraph } from './sort.ts';

const L = KIT_LIMITS.compare;

export function compareStructuralProblems(gen: CompareTableGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  gen.entities.forEach((e, i) => {
    if (typeof e !== 'string' || e === '') { problems.push(`entities[${i}] must be a non-empty string`); affected.push(`/entities/${i}`); }
  });
  gen.attributes.forEach((at, i) => {
    if (typeof at !== 'string' || at === '') { problems.push(`attributes[${i}] must be a non-empty string`); affected.push(`/attributes/${i}`); }
  });
  const ids = gen.cells.map(c => c.id);
  const dups = duplicateOccurrences(ids);
  gen.cells.forEach((c, i) => {
    push(idProblems(`cells[${i}].id`, c.id), `/cells/${i}/id`);
    if (dups.has(c.id)) { problems.push(`cell id "${c.id}" occurs more than once (expected unique ids)`); affected.push(`/cells/${i}/id`); }
    push(lengthProblems(`cells[${i}].value`, c.value, L.value.min, L.value.max), `/cells/${i}/value`);
  });
  return { problems, affected };
}

export function validateCompareTable(gen: CompareTableGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = compareStructuralProblems(gen);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every compare-table text length, id pattern and id uniqueness is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `compare-table gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('CT-01', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        gen.cells.map((c, i) => ({ quote: c.quote, sourceId: c.sourceId, quotePtr: `/cells/${i}/quote`, sourceIdPtr: `/cells/${i}/sourceId`, label: `cells[${i}] (${c.id})` })),
        idx,
      );
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} cell quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('CT-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.cells.forEach((c, i) => {
        if (!containsNormalized(c.quote ?? '', c.value ?? '')) {
          problems.push(`cells[${i}] (${c.id}): the value "${c.value}" does not occur in its quote (cell-in-quote requires the value IN the quote)`);
          affected.push(`/cells/${i}/value`, `/cells/${i}/quote`);
        }
        const entity = gen.entities[c.entityIndex];
        if (typeof entity === 'string' && Number.isInteger(c.entityIndex) && c.entityIndex >= 0 && c.entityIndex < gen.entities.length) {
          if (!labelInQuoteOrParagraph(entity, c.quote ?? '', c.sourceId ?? '', idx)) {
            problems.push(`cells[${i}] (${c.id}): the entity "${entity}" occurs neither in the quote nor in the same paragraph as the located quote span (cell-in-quote)`);
            affected.push(`/cells/${i}/entityIndex`, `/cells/${i}/quote`);
          }
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every cell value occurs in its quote and every cell entity occurs in the quote or the same source paragraph (cell-in-quote; paragraph-level entity attribution is the design-disclosed false accept — quotes are visible)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (gen.entities.length < L.entities.min || gen.entities.length > L.entities.max) {
        problems.push(`entities has ${gen.entities.length} entries, expected ${L.entities.min}-${L.entities.max}`);
        affected.push('/entities');
      }
      if (gen.attributes.length < L.attributes.min || gen.attributes.length > L.attributes.max) {
        problems.push(`attributes has ${gen.attributes.length} entries, expected ${L.attributes.min}-${L.attributes.max}`);
        affected.push('/attributes');
      }
      const expected = gen.entities.length * gen.attributes.length;
      if (gen.cells.length !== expected) {
        problems.push(`cells has ${gen.cells.length} entries, expected exactly entities x attributes = ${expected} (every pair exactly once)`);
        affected.push('/cells');
      }
      const seen = new Set<string>();
      gen.cells.forEach((c, i) => {
        const ei = c.entityIndex;
        const ai = c.attributeIndex;
        if (!Number.isInteger(ei) || ei < 0 || ei >= gen.entities.length) {
          problems.push(`cells[${i}] (${c.id}): entityIndex ${String(ei)} is outside 0..${gen.entities.length - 1}`);
          affected.push(`/cells/${i}/entityIndex`);
        }
        if (!Number.isInteger(ai) || ai < 0 || ai >= gen.attributes.length) {
          problems.push(`cells[${i}] (${c.id}): attributeIndex ${String(ai)} is outside 0..${gen.attributes.length - 1}`);
          affected.push(`/cells/${i}/attributeIndex`);
        }
        const key = `${ei}\u0000${ai}`;
        if (seen.has(key)) {
          problems.push(`cells[${i}] (${c.id}): the pair (entityIndex ${String(ei)}, attributeIndex ${String(ai)}) occurs more than once`);
          affected.push(`/cells/${i}/entityIndex`, `/cells/${i}/attributeIndex`);
        }
        seen.add(key);
      });
      for (let e = 0; e < gen.entities.length; e++) {
        for (let at = 0; at < gen.attributes.length; at++) {
          if (!seen.has(`${e}\u0000${at}`)) {
            problems.push(`the cell pair (entity ${String(gen.entities[e])}, attribute ${String(gen.attributes[at])}) is missing (cells must be the exact product)`);
            affected.push('/cells');
          }
        }
      }
      return problems.length === 0
        ? { passed: true, message: `the table shape is valid: ${gen.entities.length} entities x ${gen.attributes.length} attributes with all ${gen.cells.length} cells present exactly once (shape-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-04', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      gen.entities.forEach((e, i) => {
        const p = numbersCheckProblems(`entities[${i}]`, e, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/entities/${i}`); }
      });
      gen.attributes.forEach((at, i) => {
        const p = numbersCheckProblems(`attributes[${i}]`, at, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/attributes/${i}`); }
      });
      gen.cells.forEach((c, i) => {
        const p = numbersCheckProblems(`cells[${i}].value`, c.value, [idx.textOf(c.sourceId), ...all]);
        if (p.length > 0) { problems.push(...p); affected.push(`/cells/${i}/value`); }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in entity names, attributes and cell values appears on the cited page or in the same quote (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('CT-05', 'semantic', () => {
      // Informational by design: the system chooses the predict cell; when no column offers
      // three distinct seeded options the UI falls back to reveal-only — never a component failure.
      let bestColumn = -1;
      for (let at = 0; at < gen.attributes.length; at++) {
        const values = gen.cells
          .filter(c => c.attributeIndex === at && typeof c.value === 'string')
          .map(c => (c.value as string).replace(/\s+/g, ' ').trim().toLowerCase());
        if (new Set(values).size >= 3) { bestColumn = at; break; }
      }
      return {
        passed: true,
        message: bestColumn >= 0
          ? `predict mode is available: attribute "${String(gen.attributes[bestColumn])}" offers >= 3 distinct seeded same-column options (predict-cell-valid)`
          : 'no attribute column offers 3 distinct cell values, so the UI falls back to reveal-only with unverified cells blanked as "Not stated on this page" — by design this is not a component failure (predict-cell-valid)',
      };
    }),
  ];

  return buildReport('compare-table-v1', checks, opts.revision ?? 1);
}

/** Compare tables have no drop helper (cells are the exact product); the frozen failure message. */
export const COMPARE_FAILURE_MESSAGE: string = KIT_FAILURE_MESSAGES['compare-table-v1'] as string;
