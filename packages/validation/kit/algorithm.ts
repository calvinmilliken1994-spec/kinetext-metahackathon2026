// Stage 8a V-A — algorithm-trace-v1 validation (ALG-01..ALG-07, frozen in
// docs/specs/STAGE-8a-subject-engines.md §1a). Product split: Muse writes lesson DATA
// (algorithm choice, the page's own name, an example input, page-stated claims with quotes);
// our tested engine (packages/kit-engines traceAlgorithm) COMPUTES the trace; ALG-04 ties the
// gen to that engine (runs within KIT_LIMITS.algorithm.maxFrames, result recomputed and
// correct), and the grounding checks tie every quote and number to the page.
//
// Conventions follow the other kit validators (quiz.ts / balance.ts / compare.ts):
//   - every check id is ALWAYS emitted, passing or failing, in frozen order after 'schema.gen';
//   - quotes are whitespace-normalised verbatim matches (collectQuoteFailures / quoteProblems);
//   - whole-token number matching everywhere (contentOccursWhole, numbersCheckProblems — S6R-09);
//   - failing checks carry validator-owned `affected` JSON-pointers into the GEN
//     (/input, /input/2, /claims/0/text, ...); repair authorization consumes ONLY those paths;
//   - list COUNTS are owned by ALG-03 (input) and ALG-07 (input + claims), the design's explicit
//     count checks — the Ajv gate exempts minItems/maxItems from its short-circuit for exactly
//     this reason (kit/index.ts); 'schema.gen' owns the remaining structural limits (title,
//     algorithmName length, claim id/kind/text shape).
// Never throws: malformed input degrades into failed checks (guarded() + local pre-checks).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { ALGORITHM_CLAIM_KINDS, isAlgorithmId, isSearchAlgorithmId, KIT_LIMITS } from '../../contracts/kit.ts';
import type { AlgorithmClaimGen, AlgorithmTraceGen } from '../../contracts/kit.ts';
import { algorithmNamePattern, traceAlgorithm } from '../../kit-engines/algorithms.ts';
import { guarded, normalizeWhitespace } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  contentOccursWhole,
  duplicateOccurrences,
  idProblems,
  lengthProblems,
  numbersCarryingToken,
  numbersCheckProblems,
} from './shared.ts';
import type { EntryQuote } from './shared.ts';

const L = KIT_LIMITS.algorithm;

/**
 * Whole-phrase occurrence: `needle` occurs in `haystack` (whitespace-normalised,
 * case-insensitive) with no letter or digit attached on either side, so "search" never
 * matches inside "searches" and "binary search" never matches inside "nonbinary search".
 */
export function phraseOccursWhole(haystack: unknown, needle: unknown): boolean {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return false;
  const hay = normalizeWhitespace(haystack).toLowerCase();
  const ndl = normalizeWhitespace(needle).toLowerCase();
  if (ndl === '') return false;
  const esc = ndl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`).test(hay);
}

function claimsOf(gen: AlgorithmTraceGen): AlgorithmClaimGen[] {
  return Array.isArray(gen?.claims) ? gen.claims : [];
}

function inputOf(gen: AlgorithmTraceGen): unknown[] {
  return Array.isArray(gen?.input) ? gen.input : [];
}

/** Structural limits beyond the Ajv gen schema (reported under 'schema.gen'). */
export function algorithmStructuralProblems(gen: AlgorithmTraceGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen?.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  push(lengthProblems('algorithmName', gen?.algorithmName, L.name.min, L.name.max), '/algorithmName');
  const claims = claimsOf(gen);
  const ids = claims.map(c => c?.id);
  const dups = duplicateOccurrences(ids.filter((v): v is string => typeof v === 'string'));
  claims.forEach((claim, i) => {
    push(idProblems(`claims[${i}].id`, claim?.id), `/claims/${i}/id`);
    if (typeof claim?.id === 'string' && dups.has(claim.id)) {
      problems.push(`claim id "${claim.id}" occurs more than once (expected unique ids)`);
      affected.push(`/claims/${i}/id`);
    }
    if (typeof claim?.kind !== 'string' || !(ALGORITHM_CLAIM_KINDS as readonly string[]).includes(claim.kind)) {
      problems.push(`claims[${i}].kind is ${JSON.stringify(claim?.kind)}, expected one of ${ALGORITHM_CLAIM_KINDS.join(', ')}`);
      affected.push(`/claims/${i}/kind`);
    }
    push(lengthProblems(`claims[${i}].text`, claim?.text, L.claimText.min, L.claimText.max), `/claims/${i}/text`);
  });
  return { problems, affected };
}

export function validateAlgorithmTrace(gen: AlgorithmTraceGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = algorithmStructuralProblems(gen);
  const claims = claimsOf(gen);
  const input = inputOf(gen);
  const algorithm = gen?.algorithm;
  const search = isSearchAlgorithmId(algorithm);
  const hasTarget = gen?.hasTarget === true;
  const target = gen?.target;

  // Values ALG-04 needs before it may call the engine (fail cleanly, never let it throw).
  const inputIntegers = input.length >= 1 && input.every(v => typeof v === 'number' && Number.isInteger(v));
  const searchTargetOk = !search || (hasTarget && typeof target === 'number' && Number.isInteger(target));
  const traceRunnable = isAlgorithmId(algorithm) && inputIntegers && searchTargetOk;

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every algorithm-trace title, name length and claim id/kind/text shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `algorithm-trace gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('ALG-01', 'grounding', () => {
      const entries: EntryQuote[] = [
        { quote: gen?.quote, sourceId: gen?.sourceId, quotePtr: '/quote', sourceIdPtr: '/sourceId', label: 'algorithm quote' },
        ...claims.map((c, i) => ({
          quote: c?.quote,
          sourceId: c?.sourceId,
          quotePtr: `/claims/${i}/quote`,
          sourceIdPtr: `/claims/${i}/sourceId`,
          label: `claims[${i}] (${String(c?.id)})`,
        })),
      ];
      const { problems, affected, grounded } = collectQuoteFailures(entries, idx);
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('ALG-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!isAlgorithmId(algorithm)) {
        problems.push(`algorithm is ${JSON.stringify(algorithm)}, expected one of the frozen algorithm ids`);
        affected.push('/algorithm');
      } else {
        const name = typeof gen?.algorithmName === 'string' ? normalizeWhitespace(gen.algorithmName) : '';
        if (name === '') {
          problems.push(`algorithmName is ${JSON.stringify(gen?.algorithmName)}, expected the page's own name for ${algorithm} (e.g. "binary search")`);
          affected.push('/algorithmName');
        } else {
          if (!phraseOccursWhole(gen?.quote, name)) {
            problems.push(`algorithmName "${name}" does not occur as a whole phrase in the quote "${typeof gen?.quote === 'string' ? gen.quote.slice(0, 60) : String(gen?.quote)}" — the quote must contain the page's own name for the algorithm (algorithm-named-in-quote)`);
            affected.push('/algorithmName', '/quote');
          }
          const pattern = algorithmNamePattern(algorithm);
          if (!pattern.test(name)) {
            problems.push(`algorithmName "${name}" does not match the name pattern for algorithm "${algorithm}" (/${pattern.source}/i) — the name must be this algorithm's own name, e.g. binary-search is "binary search" (algorithm-named-in-quote)`);
            affected.push('/algorithmName');
          }
        }
      }
      return problems.length === 0
        ? { passed: true, message: `algorithmName "${String(gen?.algorithmName)}" occurs as a whole phrase in the quote and matches the frozen name pattern for "${String(algorithm)}" (algorithm-named-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('ALG-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!Array.isArray(gen?.input)) {
        problems.push(`input is ${JSON.stringify(gen?.input)}, expected an array of ${L.input.min}-${L.input.max} integers`);
        affected.push('/input');
      } else {
        if (input.length < L.input.min || input.length > L.input.max) {
          problems.push(`input has ${input.length} values, expected ${L.input.min}-${L.input.max}`);
          affected.push('/input');
        }
        input.forEach((v, i) => {
          if (typeof v !== 'number' || !Number.isInteger(v) || v < L.value.min || v > L.value.max) {
            problems.push(`input[${i}] is ${JSON.stringify(v)}, expected an integer ${L.value.min}-${L.value.max}`);
            affected.push(`/input/${i}`);
          }
        });
        const bad = input.some(v => typeof v !== 'number' || !Number.isInteger(v));
        if (!bad && search) {
          for (let i = 1; i < input.length; i++) {
            if ((input[i - 1] as number) >= (input[i] as number)) {
              problems.push(`input [${input.join(', ')}] is not strictly ascending — ${String(algorithm)} searches a sorted list of distinct values, so every value must be smaller than the next (input-valid)`);
              affected.push('/input');
              break;
            }
          }
        }
      }
      if (typeof gen?.hasTarget !== 'boolean') {
        problems.push(`hasTarget is ${JSON.stringify(gen?.hasTarget)}, expected a boolean`);
        affected.push('/hasTarget');
      } else if (hasTarget && !search) {
        problems.push(`hasTarget is true but "${String(algorithm)}" is not a search algorithm — a sort has no target (input-valid)`);
        affected.push('/hasTarget');
      } else if (!hasTarget && search) {
        problems.push(`hasTarget is false but "${String(algorithm)}" is a search algorithm — a search needs a target (input-valid)`);
        affected.push('/hasTarget');
      }
      if (typeof target !== 'number' || !Number.isInteger(target)) {
        problems.push(`target is ${JSON.stringify(target)}, expected an integer ${L.value.min}-${L.value.max} (0 when hasTarget is false)`);
        affected.push('/target');
      } else if (!hasTarget && target !== 0) {
        problems.push(`target is ${target} while hasTarget is false — expected the absent sentinel 0 (input-valid)`);
        affected.push('/target');
      } else if (hasTarget && (target < L.value.min || target > L.value.max)) {
        problems.push(`target ${target} is outside ${L.value.min}-${L.value.max} (input-valid)`);
        affected.push('/target');
      }
      return problems.length === 0
        ? { passed: true, message: `the input is valid: ${input.length} integer values in ${L.value.min}-${L.value.max}${search ? ', strictly ascending and distinct for the search' : ''}, hasTarget is ${search ? 'true' : 'false'} exactly for the ${search ? 'search' : 'sort'}, and the target is ${hasTarget ? `the integer ${target}` : 'the sentinel 0'} (input-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('ALG-04', 'behavioral', () => {
      if (!traceRunnable || !isAlgorithmId(algorithm)) {
        const why = !isAlgorithmId(algorithm)
          ? `algorithm ${JSON.stringify(algorithm)} is not a known algorithm id`
          : !inputIntegers
            ? `input [${input.map(v => JSON.stringify(v)).join(', ')}] must hold at least one finite integer for the tracer`
            : `"${String(algorithm)}" is a search and needs hasTarget true with an integer target`;
        return { passed: false, message: `our tracer cannot run on this gen: ${why} — fix the input first (trace-runs)`, path: '/input', affected: ['/algorithm', '/input', '/hasTarget', '/target'] };
      }
      let trace;
      try {
        trace = traceAlgorithm(algorithm, input as number[], search ? (target as number) : null, L.maxFrames);
      } catch (err) {
        return { passed: false, message: `our tracer could not run ${String(algorithm)} on this input: ${err instanceof Error ? err.message : String(err)} (trace-runs)`, path: '/input', affected: ['/input', '/target'] };
      }
      if (trace.truncated) {
        return { passed: false, message: `the trace of ${trace.frames.length}+ frames was truncated at the ${L.maxFrames}-frame limit, so the run cannot be shown to finish — use a shorter input (trace-runs)`, path: '/input', affected: ['/input'] };
      }
      if (search) {
        const at = (input as number[]).indexOf(target as number);
        const expected = at >= 0 ? at : null;
        if (trace.foundIndex !== expected) {
          return { passed: false, message: `our tracer reports ${trace.foundIndex === null ? 'that the target was not found' : `the target at position ${trace.foundIndex}`}, but ${String(target)} ${expected === null ? 'is not in the input' : `is at position ${expected}`} — the traced result is wrong (trace-runs)`, path: '/input', affected: ['/input', '/target'] };
        }
        return {
          passed: true,
          message: `our tracer ran ${String(gen?.algorithmName)} to completion in ${trace.frames.length} frame(s) (limit ${L.maxFrames}) and the result is correct: ${expected === null ? `${target} is not in the list` : `${target} is found at position ${expected}`} — computed by our tested engine, never by the model (trace-runs)`,
        };
      }
      const expected = [...(input as number[])].sort((a, b) => a - b);
      if (trace.sorted === null || trace.sorted.length !== expected.length || trace.sorted.some((v, i) => v !== expected[i])) {
        return { passed: false, message: `our tracer's sorted result [${(trace.sorted ?? []).join(', ')}] is not the ascending sort of the input [${expected.join(', ')}] — the traced result is wrong (trace-runs)`, path: '/input', affected: ['/input'] };
      }
      return {
        passed: true,
        message: `our tracer ran ${String(gen?.algorithmName)} to completion in ${trace.frames.length} frame(s) (limit ${L.maxFrames}) and the sorted result [${expected.join(', ')}] is ascending and holds every input value — computed by our tested engine, never by the model (trace-runs)`,
      };
    }),

    guarded('ALG-05', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      claims.forEach((claim, i) => {
        const text = typeof claim?.text === 'string' ? claim.text : '';
        const quote = typeof claim?.quote === 'string' ? claim.quote : '';
        if (text === '') return;
        const match = contentOccursWhole(quote, text);
        if (!match.contained) {
          problems.push(`claims[${i}] (${String(claim?.id)}): the claim text "${text}" does not occur in its quote "${quote.slice(0, 60)}" after whitespace normalisation (claims-in-quote)`);
          affected.push(`/claims/${i}/text`, `/claims/${i}/quote`);
        } else if (!match.ok) {
          // S6R-09: the words are there, but a number in the claim is only part of a different
          // number printed in the quote.
          const shown = match.missingNumbers.map(n => `"${n}"`).join(', ');
          const quoteNumbers = [...new Set(match.missingNumbers.flatMap(n => numbersCarryingToken(quote, n)))];
          problems.push(`claims[${i}] (${String(claim?.id)}): the claim text states the number ${shown} as a whole number, but the quote only contains ${quoteNumbers.length === 0 ? 'it inside a different number' : quoteNumbers.map(q => `"${q}"`).join(', ')} there — a number inside a larger number is a different value (claims-in-quote)`);
          affected.push(`/claims/${i}/text`, `/claims/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `all ${claims.length} claim text(s) occur in their own quote after whitespace normalisation, with every number matching as the same whole number (claims-in-quote)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('ALG-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const check = (label: string, text: unknown, ptr: string, texts: (string | undefined)[]): void => {
        const p = numbersCheckProblems(label, text, texts);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', gen?.title, '/title', all);
      check('algorithmName', gen?.algorithmName, '/algorithmName', all);
      claims.forEach((claim, i) => {
        const cited = typeof claim?.sourceId === 'string' ? idx.textOf(claim.sourceId) : undefined;
        check(`claims[${i}].text`, claim?.text, `/claims/${i}/text`, [cited, ...all]);
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in the title, the algorithm name and the claim texts appears on the cited page as that whole number (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('ALG-07', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!Array.isArray(gen?.input) || input.length < L.input.min || input.length > L.input.max) {
        problems.push(`input has ${Array.isArray(gen?.input) ? input.length : 'no'} values, expected ${L.input.min}-${L.input.max}`);
        affected.push('/input');
      }
      if (claims.length < L.claims.min || claims.length > L.claims.max) {
        problems.push(`claims has ${claims.length} entries, expected ${L.claims.min}-${L.claims.max}`);
        affected.push('/claims');
      }
      return problems.length === 0
        ? { passed: true, message: `the counts are valid: ${input.length} input values (${L.input.min}-${L.input.max}) and ${claims.length} claim(s) (${L.claims.min}-${L.claims.max}) (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('algorithm-trace-v1', checks, opts.revision ?? 1);
}
