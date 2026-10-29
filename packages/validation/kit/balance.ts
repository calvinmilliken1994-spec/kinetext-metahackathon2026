// S6-V — balance-equation-v1 validation (BAL-01..BAL-09, design §3 frozen; BAL-06 retired) built
// on the exact integer chemistry parser/balancer in ../chemistry.ts. The system derives the
// solution (lowest positive integers, gcd 1); a wrong key is never shown.
//
// Recorded decisions:
//   - BAL-02 also cross-checks the Muse-written species split against the printed equationText:
//     equationText must parse into (coefficient, formula, side) parts whose (formula, side)
//     multiset equals the species list (coefficients are the system's job, not Muse's).
//   - BAL-09 (addendum defect fix) grounds each species quote verbatim in ITS OWN species.sourceId
//     source and requires the species formula to appear in that quote (normalised), so no required
//     field is unused and every species is tied to the page.
//   - Nullity != 1 fails BAL-08 ('ambiguous' for nullity >= 2); a nullity-0 (impossible) equation
//     fails BAL-03/04/05/08 together — they all describe the same root cause: no system solution.
//   - hint follows the ''/5-120 optional-text convention of the other components.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { BalanceEquationGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  duplicateOccurrences,
  idProblems,
  KIT_FAILURE_MESSAGES,
  numbersCheckProblems,
  optionalLengthProblems,
} from './shared.ts';
import { balanceSpecies, normalizeChemFormula, normalizeEquationText, parseChemicalFormula, parseEquationParts } from '../chemistry.ts';
import type { BalanceResult } from '../chemistry.ts';

const L = KIT_LIMITS.balance;
export const BAL_FAILURE_MESSAGE: string = KIT_FAILURE_MESSAGES['balance-equation-v1'] as string;

/** The system-derived solution for one gen (the answer key source; UI/pipeline reuse this). */
export function deriveBalanceSolution(gen: BalanceEquationGen): BalanceResult {
  return balanceSpecies((gen.species ?? []).map(s => ({ formula: s.formula, side: s.side })));
}

export function balanceStructuralProblems(gen: BalanceEquationGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  push(optionalLengthProblems('hint', gen.hint, KIT_LIMITS.quiz.hint.min, KIT_LIMITS.quiz.hint.max), '/hint');
  const ids = (gen.species ?? []).map(s => s.id);
  const dups = duplicateOccurrences(ids);
  (gen.species ?? []).forEach((s, i) => {
    push(idProblems(`species[${i}].id`, s.id), `/species/${i}/id`);
    if (dups.has(s.id)) { problems.push(`species id "${s.id}" occurs more than once (expected unique ids)`); affected.push(`/species/${i}/id`); }
  });
  return { problems, affected };
}

export function validateBalanceEquation(gen: BalanceEquationGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = balanceStructuralProblems(gen);
  const species = Array.isArray(gen.species) ? gen.species : [];
  const solution = deriveBalanceSolution(gen);
  const speciesAffected = species.map((_, i) => `/species/${i}/formula`);
  const equationAffected = ['/equationText', ...speciesAffected];

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every balance title, hint and species id shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `balance gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('BAL-01', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const { problems: qp, affected: qa } = collectQuoteFailures(
        [{ quote: gen.quote, sourceId: gen.sourceId, quotePtr: '/quote', sourceIdPtr: '/sourceId', label: 'equation quote' }],
        idx,
      );
      problems.push(...qp);
      affected.push(...qa);
      if (typeof gen.equationText !== 'string' || gen.equationText === '') {
        problems.push('equationText is empty, expected the reaction as printed on the page');
        affected.push('/equationText');
      } else if (!normalizeEquationText(gen.quote ?? '').includes(normalizeEquationText(gen.equationText))) {
        problems.push(`equationText "${gen.equationText}" does not occur in the equation quote "${String(gen.quote).slice(0, 60)}" after normalisation (the printed equation itself must be quoted)`);
        affected.push('/equationText', '/quote');
      }
      return problems.length === 0
        ? { passed: true, message: `the equation quote appears verbatim in source "${gen.sourceId}" and equationText occurs inside the quote after normalisation (equation-quoted)` }
        : { passed: false, message: `${problems.join('; ')} — ${BAL_FAILURE_MESSAGE}`, path: affected[0], affected };
    }),

    guarded('BAL-02', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (species.length < L.species.min || species.length > L.species.max) {
        problems.push(`species has ${species.length} entries, expected ${L.species.min}-${L.species.max}`);
        affected.push('/species');
      }
      const elementSet = new Set<string>();
      species.forEach((s, i) => {
        const r = parseChemicalFormula(s.formula);
        if (!r.ok) {
          problems.push(`species[${i}] (${s.id}): ${r.error}`);
          affected.push(`/species/${i}/formula`);
        } else {
          for (const el of r.parsed.atoms.keys()) elementSet.add(el);
        }
      });
      if (elementSet.size > L.elements.max) {
        problems.push(`the reaction uses ${elementSet.size} distinct elements, expected <= ${L.elements.max}`);
        affected.push('/species');
      }
      // The printed equation must parse and its (formula, side) multiset must equal the species split.
      const eq = parseEquationParts(gen.equationText ?? '');
      if (!eq.ok) {
        problems.push(`equationText does not parse into a reaction: ${eq.error}`);
        affected.push('/equationText');
      } else {
        const key = (f: string, side: string): string => `${normalizeChemFormula(f)}\u0000${side}`;
        const fromText = eq.parts.map(p => key(p.formula, p.side)).sort();
        const fromSpecies = species.map(s => key(typeof s.formula === 'string' ? s.formula : '', String(s.side))).sort();
        if (fromText.join('|') !== fromSpecies.join('|')) {
          problems.push(`the species split [${fromSpecies.join(', ')}] does not match the printed equationText parts [${fromText.join(', ')}] (same formulas on the same sides, coefficients aside)`);
          affected.push('/equationText', ...speciesAffected);
        }
      }
      if (solution.status === 'parse-error') {
        problems.push(`the species formulas cannot be balanced: ${solution.error}`);
        affected.push(...speciesAffected);
      }
      return problems.length === 0
        ? { passed: true, message: `all ${species.length} species formulas parse (${elementSet.size} distinct elements <= ${L.elements.max}, groups depth <= ${L.parenDepthMax}, no charges, no hydrate dots, subscripts 1-999 without leading zeros, <= ${L.atomsPerSpeciesMax} atoms per species) and the split matches the printed equation (formulas-parse)` }
        : { passed: false, message: `${problems.join('; ')} — ${BAL_FAILURE_MESSAGE}`, path: affected[0], affected };
    }),

    guarded('BAL-03', 'behavioral', () => {
      if (solution.status === 'unique') {
        return { passed: true, message: `the system solution [${solution.coefficients.join(', ')}] conserves every atom exactly (verified with exact integer arithmetic over ${solution.elements.join(', ')}) (atom-balance-exact)` };
      }
      const reason = solution.status === 'ambiguous'
        ? `the solution is not unique up to scale (nullspace dimension ${solution.nullity}), so there is no single system solution to verify`
        : solution.status === 'no-solution'
          ? `no positive integer solution exists (${solution.reason})`
          : `the species formulas do not parse (${solution.error})`;
      return { passed: false, message: `${reason} (atom-balance-exact requires the system-derived integer solution to balance every element) — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
    }),

    guarded('BAL-04', 'behavioral', () => {
      if (solution.status === 'unique') {
        return solution.gcd === 1
          ? { passed: true, message: `the system solution [${solution.coefficients.join(', ')}] is in lowest terms (gcd 1) (lowest-terms)` }
          : { passed: false, message: `the system solution [${solution.coefficients.join(', ')}] has gcd ${solution.gcd}, expected 1 (lowest-terms)`, path: '/species', affected: equationAffected };
      }
      return { passed: false, message: `no unique lowest-terms solution exists (status "${solution.status}"), so lowest terms cannot be shown — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
    }),

    guarded('BAL-05', 'behavioral', () => {
      if (solution.status === 'unique') {
        const out = solution.coefficients.filter(c => c < L.coefficient.min || c > L.coefficient.max);
        return out.length === 0
          ? { passed: true, message: `the system solution [${solution.coefficients.join(', ')}] exists with every coefficient within ${L.coefficient.min}-${L.coefficient.max} (solution-exists)` }
          : { passed: false, message: `the system solution has coefficient(s) ${out.join(', ')} outside ${L.coefficient.min}-${L.coefficient.max} — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
      }
      if (solution.status === 'ambiguous') {
        return { passed: false, message: `the equation is ambiguous (nullspace dimension ${solution.nullity}), so no single 1-${L.coefficient.max} solution can be keyed — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
      }
      const reason = solution.status === 'no-solution' ? solution.reason : solution.error;
      return { passed: false, message: `no solution exists within ${L.coefficient.min}-${L.coefficient.max}: ${reason} — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
    }),

    {
      id: 'BAL-06',
      kind: 'semantic',
      passed: true,
      message: 'BAL-06 coefficient-shape is retired (the values check moved to the balancer); the id is reserved and always passes',
    },

    guarded('BAL-07', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const texts = [idx.textOf(gen.sourceId), ...all];
      const check = (label: string, text: unknown, ptr: string): void => {
        const p = numbersCheckProblems(label, text, texts);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', gen.title, '/title');
      check('hint', gen.hint, '/hint');
      return problems.length === 0
        ? { passed: true, message: 'every number in the title and hint appears on the page or in the same quote (N-01); the printed equation and species formulas are equation fields and grounded by BAL-01/BAL-09 instead (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('BAL-08', 'behavioral', () => {
      if (solution.status === 'unique') {
        return { passed: true, message: 'the atom matrix has nullspace dimension exactly 1: the balanced form is unique up to scale (unique-up-to-scale)' };
      }
      if (solution.status === 'ambiguous') {
        return { passed: false, message: `ambiguous: the atom matrix nullspace has dimension ${solution.nullity}, expected exactly 1 — the reaction as split does not have a unique balanced form (unique-up-to-scale) — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
      }
      const reason = solution.status === 'no-solution' ? solution.reason : solution.error;
      return { passed: false, message: `nullspace dimension is 0, expected exactly 1 (${reason}) (unique-up-to-scale) — ${BAL_FAILURE_MESSAGE}`, path: '/species', affected: equationAffected };
    }),

    guarded('BAL-09', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        species.map((s, i) => ({ quote: s.quote, sourceId: s.sourceId, quotePtr: `/species/${i}/quote`, sourceIdPtr: `/species/${i}/sourceId`, label: `species[${i}] (${s.id})` })),
        idx,
      );
      species.forEach((s, i) => {
        if (typeof s.quote === 'string' && typeof s.formula === 'string' && idx.docById.has(s.sourceId)) {
          const nq = normalizeChemFormula(s.quote.replace(/\s+/g, ' ')).toLowerCase();
          const nf = normalizeChemFormula(s.formula).toLowerCase();
          if (nf !== '' && !nq.includes(nf)) {
            problems.push(`species[${i}] (${s.id}): the formula "${s.formula}" does not appear in its quote "${s.quote.slice(0, 60)}" after normalisation (species-quote-verbatim ties each species to the page)`);
            affected.push(`/species/${i}/quote`);
          }
        }
      });
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} species quote(s) appear verbatim in their cited source and each species formula appears in its own quote (species-quote-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source) — ${BAL_FAILURE_MESSAGE}`, path: affected[0], affected };
    }),
  ];

  return buildReport('balance-equation-v1', checks, opts.revision ?? 1);
}
