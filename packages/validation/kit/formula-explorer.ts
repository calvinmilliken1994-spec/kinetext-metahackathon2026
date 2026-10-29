// S6-V — formula-explorer-v1 validation (FE-01..FE-08, design §2.7 + the lead freeze addendum's
// precise FE-08 definition). Muse writes inputs only; the SYSTEM computes every output
// (computeCaseOutputs below is the recomputation the pipeline stores). No eval/Function anywhere:
// the safe parser/evaluator lives in ../expression.ts and implements the frozen grammar exactly.
//
// FE-08 per the ADDENDUM (which wins over §2.7d), tightened by Stage 6 review S6R-02/03/04:
// parse the page's quoted formula line with the same grammar when possible (after the fixed
// normalisation and the pageSymbol → name mapping) and compare it with `expression` at
// INDEPENDENTLY varied points — the slider defaults, per-variable one-at-a-time variation around
// the defaults, seeded pseudo-random points and the stored case inputs (never the old correlated
// diagonal, on which x===y hid every (x-y)-shaped error) — with relative tolerance 1e-9, skipping
// non-finite points; at least 3 finite agreeing points and NO mismatch are required. The page
// formula parse is strict: trailing prose is stripped only at explicit prose boundaries and an
// unsupported mathematical character makes the line unparseable — a prefix is never silently
// parsed as the page formula. If the page formula cannot be parsed (words, subscripts, greek-only
// names), FE-08 passes ONLY with a verified FE-05 source example whose quote EXPLICITLY binds
// every variable to its value ("x = 6", "x is 6", "6 for x" — never a permutation search over the
// quote's numbers, never the stated result as an input candidate); otherwise it fails with the
// frozen §2.7h message.
//
// Recorded interpretations:
//   - FE-04 tolerance bound [1e-9, 0.25] applies to sourceExample.tolerance (cases carry no
//     tolerance in the v0.6 gen contract — S6-0 deviation: cases[].inputs is a {name,value} list).
//   - FE-06 slider ratio (<= 1e6) is enforced as max/min for strictly positive ranges; ranges
//     that include 0 or negative values have no finite ratio and only the finite/min<max/default
//     rules apply. Literal exponents in `expression` must satisfy |e| <= 100.
//   - FE-07 (N-01) checks title and variable meanings; `unit` labels are notation ("kg/m3") and
//     formula/equation fields (formulaText, expression, pageSymbol) are exempt by design (§1.6
//     A-11 exemption carried over).

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { FORMULA_CONSTANTS, FORMULA_FUNCTIONS, FORMULA_RESERVED_NAMES, FORMULA_VAR_NAME_PATTERN, KIT_LIMITS } from '../../contracts/kit.ts';
import type { FormulaExplorerGen } from '../../contracts/kit.ts';
import { guarded } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  duplicateOccurrences,
  idProblems,
  KIT_FAILURE_MESSAGES,
  normalizeWhitespace,
  numbersCheckProblems,
  numericTokens,
  quoteProblems,
  truncate,
} from './shared.ts';
import {
  astNodeCount,
  astVariables,
  compareAtPoints,
  evaluate,
  independentSamplePoints,
  lexExpression,
  normalizePageFormula,
  ONE_AT_A_TIME_FRACTIONS,
  parseExpression,
  parseTokens,
} from '../expression.ts';
import type { AstNode } from '../expression.ts';

const L = KIT_LIMITS.formulaExplorer;
export const FE_FAILURE_MESSAGE: string = KIT_FAILURE_MESSAGES['formula-explorer-v1'] as string;
/** The FE-08 one-at-a-time variation fractions (kept for the frozen constant name; S6R-02 sampling now varies variables independently — see independentSamplePoints). */
export const FE08_SAMPLE_FRACTIONS = ONE_AT_A_TIME_FRACTIONS;
export const FE08_RELATIVE_TOLERANCE = 1e-9;
export const FE08_MIN_AGREEING_POINTS = 3;

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

export function formulaExplorerStructuralProblems(gen: FormulaExplorerGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  if (gen.cases.length < L.cases.min || gen.cases.length > L.cases.max) {
    problems.push(`cases has ${gen.cases.length} entries, expected ${L.cases.min}-${L.cases.max}`);
    affected.push('/cases');
  }
  const ids = gen.cases.map(c => c.id);
  const dups = duplicateOccurrences(ids);
  gen.cases.forEach((c, i) => {
    push(idProblems(`cases[${i}].id`, c.id), `/cases/${i}/id`);
    if (dups.has(c.id)) { problems.push(`case id "${c.id}" occurs more than once (expected unique ids)`); affected.push(`/cases/${i}/id`); }
  });
  return { problems, affected };
}

/** Case inputs as a name → value record (S6-0 deviation: inputs is a list of {name, value}). */
export function caseInputsOf(kase: { inputs: { name: string; value: number }[] }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const input of kase.inputs ?? []) out[input.name] = input.value;
  return out;
}

/**
 * The system-owned recomputation of every case output (design §2.7b: "Muse writes inputs only;
 * system computes all outputs"). Returns NaN for a case the expression cannot evaluate.
 */
export function computeCaseOutputs(gen: FormulaExplorerGen): { id: string; inputs: Record<string, number>; output: number }[] {
  const parsed = parseExpression(gen.expression);
  return gen.cases.map(c => {
    const inputs = caseInputsOf(c);
    return { id: c.id, inputs, output: parsed.ok ? evaluate(parsed.ast, inputs) : NaN };
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Map every pageSymbol to its variable name (token boundaries, longest symbol first) and cut the
 * string at the first prose boundary, so "V = a * t where a is ..." yields the parseable "a*t".
 */
export function mapPageSymbols(rhs: string, variables: { name: string; pageSymbol: string }[]): string {
  let out = rhs;
  const ordered = [...variables].sort((a, b) => (b.pageSymbol?.length ?? 0) - (a.pageSymbol?.length ?? 0));
  for (const v of ordered) {
    if (typeof v.pageSymbol !== 'string' || v.pageSymbol === '' || v.pageSymbol === v.name) continue;
    out = out.replace(new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(v.pageSymbol)}(?![A-Za-z0-9_])`, 'g'), `$1${v.name}`);
  }
  return out;
}

export interface PageFormulaAttempt {
  status: 'parsed' | 'unparseable';
  ast?: AstNode;
  rhs?: string;
  error?: string;
}

/**
 * The small explicit list of prose-boundary connectives (S6R-03): whitespace + one of these
 * words ends the formula line. Trailing prose is stripped ONLY here and at punctuation
 * boundaries (comma/semicolon, sentence-ending period) or as a trailing run of pure-letter
 * words — never at an unsupported mathematical character, which makes the line unparseable.
 */
const PROSE_BOUNDARY_WORDS = ['where', 'when', 'if', 'so', 'thus', 'which', 'then', 'and', 'or', 'with', 'for', 'is', 'are'] as const;

/** Cut the RHS at the first explicit prose boundary (comma/semicolon, sentence period, connective word). */
function cutAtProseBoundary(rhs: string): string {
  let cut = rhs.length;
  const comma = rhs.search(/[,;]/);
  if (comma >= 0) cut = Math.min(cut, comma);
  const period = rhs.search(/\.(?!\d)/); // a period that is not a decimal point ends the sentence
  if (period >= 0) cut = Math.min(cut, period);
  const word = new RegExp(`\\s+(?:${PROSE_BOUNDARY_WORDS.join('|')})\\b`, 'i').exec(rhs);
  if (word !== null) cut = Math.min(cut, word.index);
  return rhs.slice(0, cut).trim();
}

/**
 * Drop a trailing run of whitespace-separated pure-letter words (>= 2 letters) that are not a
 * page symbol, variable name, function or constant — i.e. trailing prose like "... / 2 exactly".
 * Single letters, digits and anything mathematical are NEVER dropped: they make the strict
 * whole-string parse fail instead (S6R-03: no silent prefix parses).
 */
function dropTrailingProseWords(rhs: string, formulaWords: ReadonlySet<string>): string {
  let out = rhs;
  for (;;) {
    const m = /^(.*\s)([A-Za-z]{2,})$/.exec(out);
    if (m === null) {
      if (/^[A-Za-z]{2,}$/.test(out) && !formulaWords.has(out)) return '';
      return out;
    }
    if (formulaWords.has(m[2] as string)) return out;
    out = (m[1] as string).trim();
  }
}

/**
 * Extract and parse the page's formula line from the (verbatim) quote: split at the first '=',
 * strip trailing prose ONLY at explicit prose boundaries, map pageSymbols to variable names,
 * apply the fixed normalisation and lex+parse the COMPLETE remaining RHS with the same
 * lexer/grammar. S6R-03: an unsupported mathematical character anywhere in the remaining RHS
 * (÷, √, '=', greek letters, subscript unicode, stranded digits or adjacent letters) yields
 * 'unparseable' — the parser never succeeds on a truncated prefix and silently discards real
 * mathematical content.
 */
export function parsePageFormulaFromQuote(
  quote: string,
  variables: { name: string; pageSymbol: string }[],
): PageFormulaAttempt {
  if (typeof quote !== 'string' || !quote.includes('=')) {
    return { status: 'unparseable', error: 'the quote contains no "=" formula line' };
  }
  const normQuote = quote.replace(/\s+/g, ' ').trim();
  const eq = normQuote.indexOf('=');
  const lhs = normQuote.slice(0, eq).trim();
  const rhsRaw = normQuote.slice(eq + 1).trim();
  if (lhs === '' || rhsRaw === '') return { status: 'unparseable', error: 'the quote has an empty side around "="', rhs: rhsRaw };
  const names = variables.map(v => v.name);
  const formulaWords = new Set<string>(
    [...names, ...variables.map(v => v.pageSymbol), ...FORMULA_FUNCTIONS, ...FORMULA_CONSTANTS].filter(
      (w): w is string => typeof w === 'string' && w !== '',
    ),
  );
  const rhs = dropTrailingProseWords(cutAtProseBoundary(rhsRaw), formulaWords);
  if (rhs === '') {
    return { status: 'unparseable', rhs: rhsRaw, error: 'the formula line has no parseable tokens (only prose after the "=")' };
  }
  const mapped = mapPageSymbols(rhs, variables);
  const lexed = lexExpression(normalizePageFormula(mapped));
  if (!lexed.ok) {
    return { status: 'unparseable', rhs, error: `the complete formula line could not be lexed (${lexed.error}); unsupported mathematical content is never truncated away` };
  }
  if (lexed.tokens.length === 0) return { status: 'unparseable', rhs, error: 'the formula line has no parseable tokens' };
  const parsed = parseTokens(lexed.tokens, { knownVariables: names, maxNodes: L.astMaxNodes });
  if (!parsed.ok) {
    return { status: 'unparseable', rhs, error: `the complete formula line does not parse in the frozen grammar (${parsed.error})` };
  }
  return { status: 'parsed', ast: parsed.ast, rhs };
}

/* ------------------------------------------------------------------ */
/* Complete-formula quote edges (S6R-03)                               */
/* ------------------------------------------------------------------ */

/**
 * Characters that extend a mathematical token. When one of these sits at a formula-quote edge
 * (immediately, or after whitespace for the right edge), the quote cropped real formula content
 * — e.g. quoting "z = x/y" out of the page's "z = x/y^2" manufactures a shorter, wrong formula.
 */
const MATH_EDGE_SYMBOLS = new Set(['^', '*', '/', '+', '-', '=', '÷', '×', '√', '·', '∙', '⋅', '\u2212', '±', '<', '>', '≈', '≤', '≥', '%']);
const SUPERSCRIPT_EDGE_CHARS = new Set(['\u2070', '\u00b9', '\u00b2', '\u00b3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079', '\u207a', '\u207b']);

function isMathEdgeChar(ch: string, lettersBad: boolean): boolean {
  if (MATH_EDGE_SYMBOLS.has(ch) || SUPERSCRIPT_EDGE_CHARS.has(ch)) return true;
  if (/[0-9]/.test(ch)) return true;
  if (lettersBad && /[A-Za-z_]/.test(ch)) return true;
  return false;
}

/** True when the character sequence starting at `end` cuts a mathematical token (right edge). */
function rightEdgeCuts(text: string, end: number, lettersBad: boolean): boolean {
  if (end >= text.length) return false; // end of text: clean
  const next = text[end] as string;
  if (/\s/.test(next)) {
    // After whitespace only mathematical symbols/digits betray a cut; prose words are fine
    // ("W = m * g since ...", "V = a * t X = (1/2)*a*t^2 ...").
    let i = end;
    while (i < text.length && /\s/.test(text[i] as string)) i += 1;
    const c = text[i];
    return c !== undefined && isMathEdgeChar(c, false);
  }
  if (next === '.') return /\d/.test(text[end + 1] ?? ''); // sentence end is clean; "x/y.5" is a cut
  if (next === ')') return false; // closing a parenthesised formula: clean
  return isMathEdgeChar(next, lettersBad) || next === '('; // "(...)" right after is implicit multiplication
}

/** True when the character before `start` cuts a mathematical token (left edge). */
function leftEdgeCuts(text: string, start: number, lettersBad: boolean): boolean {
  if (start <= 0) return false; // start of text: clean
  const prev = text[start - 1] as string;
  if (/\s/.test(prev)) return false; // prose across whitespace is clean
  if (prev === '.') return /\d/.test(text[start - 2] ?? ''); // a decimal point cut ("459.7" quoted as "7")
  if (prev === '(') return false; // "(V = a * t)": an opening parenthesis is a clean frame
  return isMathEdgeChar(prev, lettersBad) || prev === ')';
}

/** True when at least one occurrence of `needle` in `haystack` has clean mathematical edges. */
function hasCompleteOccurrence(haystack: string, needle: string, lettersBad = true): boolean {
  if (needle === '') return false;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    if (!leftEdgeCuts(haystack, at, lettersBad) && !rightEdgeCuts(haystack, at + needle.length, lettersBad)) return true;
    from = at + 1;
  }
}

/**
 * S6R-03: the formula quote and formulaText must each be a COMPLETE source formula. Locates the
 * (whitespace-normalised) quote's occurrences in the (whitespace-normalised) source text and the
 * formulaText's occurrences in the quote, and rejects an occurrence set whose every occurrence
 * has a mathematical token cut at an edge (source "z = x/y^2" quoted as "z = x/y" fails; prose
 * continuations after whitespace stay fine). When the formulaText only matches the quote after
 * the page-formula normalisation (whitespace removed), letters can no longer be told apart from
 * prose, so only symbols/digits count as cuts there. Returns plain-language problems + the
 * affected pointers ('/quote', '/formulaText'). An unlocatable source text is not judged here —
 * the FE-01 verbatim-quote rule owns that failure.
 */
export function formulaCompletenessProblems(
  quote: unknown,
  formulaText: unknown,
  sourceText: string | undefined,
): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  if (typeof quote !== 'string' || typeof formulaText !== 'string') return { problems, affected };
  const nq = normalizeWhitespace(quote);
  const nft = normalizeWhitespace(formulaText);
  if (nq === '' || nft === '') return { problems, affected };
  const nSource = typeof sourceText === 'string' ? normalizeWhitespace(sourceText) : undefined;
  if (nSource !== undefined && nSource !== '' && nq !== '') {
    if (!hasCompleteOccurrence(nSource, nq)) {
      problems.push(`formula quote "${truncate(quote, 60)}" is not a complete formula in source: the page's mathematical content continues right at the quote edge (an operator, exponent, digit or adjacent letter follows) — quote the formula exactly as the page prints it, whole`);
      affected.push('/quote', '/formulaText');
    }
  }
  if (nq.includes(nft)) {
    if (!hasCompleteOccurrence(nq, nft)) {
      problems.push(`formulaText "${truncate(formulaText, 60)}" cuts a mathematical token inside the formula quote "${truncate(quote, 60)}" — formulaText must be the complete formula as printed`);
      affected.push('/formulaText', '/quote');
    }
  } else {
    const pq = normalizePageFormula(quote);
    const pft = normalizePageFormula(formulaText);
    if (pft !== '' && pq.includes(pft) && !hasCompleteOccurrence(pq, pft, false)) {
      problems.push(`formulaText "${truncate(formulaText, 60)}" cuts a mathematical token inside the formula quote "${truncate(quote, 60)}" after the fixed normalisation — formulaText must be the complete formula as printed`);
      affected.push('/formulaText', '/quote');
    }
  }
  return { problems, affected };
}

/** The FE-05 verdict, shared with FE-08's unparseable fallback. */
interface SourceExampleVerdict { passed: boolean; problems: string[]; affected: string[] }

/* ------------------------------------------------------------------ */
/* Explicit source-example bindings (S6R-04)                           */
/* ------------------------------------------------------------------ */

export interface SourceExampleBindings {
  ok: boolean;
  /** Variable NAME → value, for every declared variable (partial when !ok). */
  bindings: Record<string, number>;
  problems: string[];
}

/** A plain decimal number, optionally signed (unicode minus is normalised before matching). */
const BIND_VALUE = String.raw`[+-]?\d+(?:\.\d+)?`;
/** A bound value never swallows a following digit or thousands-comma ("1,000" is not "1"). */
const BIND_VALUE_GUARD = String.raw`(?!\d)(?!,\d)`;

/**
 * S6R-04: bind every declared variable to the value the source-example quote EXPLICITLY states
 * for it. Supported patterns (a small explicit list; <sym> is the variable's pageSymbol or name,
 * matched case-sensitively as a whole token):
 *   - "<sym> = <num>" and "<sym> equals <num>"
 *   - "<sym> is <num>"
 *   - "<num> for <sym>"
 * Repeated equal input values ("x = 3 and y = 3") are supported. A variable with no explicit
 * binding, or with conflicting bindings, fails closed: the quote's numbers are NEVER permuted
 * to make the stated result work, and the result token is never an input candidate.
 */
export function bindSourceExampleInputs(
  quote: string,
  variables: readonly { name: string; pageSymbol: string }[],
): SourceExampleBindings {
  const problems: string[] = [];
  const bindings: Record<string, number> = {};
  const text = (typeof quote === 'string' ? quote : '').replace(/[\u2212\u2010\u2011]/g, '-').replace(/\s+/g, ' ');
  for (const v of Array.isArray(variables) ? variables : []) {
    if (typeof v?.name !== 'string' || v.name === '') continue;
    const syms = [...new Set([v.pageSymbol, v.name].filter((s): s is string => typeof s === 'string' && s !== ''))];
    const shown = syms[0] ?? v.name;
    const values: number[] = [];
    for (const sym of syms) {
      const esc = escapeRegExp(sym);
      const before = String.raw`(?<![A-Za-z0-9_])`;
      const after = String.raw`(?![A-Za-z0-9_])`;
      const patterns = [
        new RegExp(`${before}${esc}\\s*(?:=|[eE]quals)\\s*(${BIND_VALUE})${BIND_VALUE_GUARD}`, 'g'),
        new RegExp(`${before}${esc}\\s+[iI]s\\s+(${BIND_VALUE})${BIND_VALUE_GUARD}`, 'g'),
        new RegExp(String.raw`(?<![\d.])` + `(${BIND_VALUE})${BIND_VALUE_GUARD}\\s+[fF]or\\s+${esc}${after}`, 'g'),
      ];
      for (const re of patterns) {
        for (const m of text.matchAll(re)) {
          const n = Number(m[1]);
          if (Number.isFinite(n)) values.push(n);
        }
      }
    }
    const distinct = [...new Set(values)];
    if (distinct.length === 0) {
      problems.push(`the sourceExample quote does not explicitly bind "${shown}" to a value (supported patterns: "${shown} = <number>", "${shown} is <number>", "<number> for ${shown}") — unbound quote numbers are never assigned to variables`);
    } else if (distinct.length > 1) {
      problems.push(`the sourceExample quote binds "${shown}" to conflicting values (${distinct.join(', ')}); the binding must be unambiguous`);
    } else {
      bindings[v.name] = distinct[0] as number;
    }
  }
  return { ok: problems.length === 0, bindings, problems };
}

function checkSourceExample(gen: FormulaExplorerGen, idx: ReturnType<typeof buildSourceIndex>): SourceExampleVerdict {
  const problems: string[] = [];
  const affected: string[] = [];
  const ex = gen.sourceExample;
  if (gen.hasSourceExample !== true) {
    if (ex.quote !== '' || ex.resultNumber !== 0 || ex.tolerance !== 0) {
      problems.push(`hasSourceExample=false but sourceExample is ${JSON.stringify(ex)}, expected {"quote":"","resultNumber":0,"tolerance":0}`);
      affected.push('/sourceExample/quote', '/sourceExample/resultNumber', '/sourceExample/tolerance', '/hasSourceExample');
    }
    return { passed: problems.length === 0, problems, affected };
  }
  // A declared example: quote grounded in the explorer's own sourceId source (S6-0 deviation),
  // result stated in the quote, tolerance within [1e-9, 0.25], and the evaluation must match.
  const qp = idx.docById.has(gen.sourceId) ? quoteProblems(ex.quote, gen.sourceId, idx) : [`sourceExample quote cites sourceId ${JSON.stringify(gen.sourceId)}, which is not among the provided sources`];
  if (qp.length > 0) {
    problems.push(...qp.map(m => `sourceExample: ${m}`));
    affected.push('/sourceExample/quote');
  }
  if (!isFiniteNumber(ex.resultNumber)) {
    problems.push(`sourceExample.resultNumber is ${String(ex.resultNumber)}, expected a finite number stated in the quote`);
    affected.push('/sourceExample/resultNumber');
  }
  if (!isFiniteNumber(ex.tolerance) || ex.tolerance < L.tolerance.min || ex.tolerance > L.tolerance.max) {
    problems.push(`sourceExample.tolerance is ${String(ex.tolerance)}, expected a number in [${L.tolerance.min}, ${L.tolerance.max}]`);
    affected.push('/sourceExample/tolerance');
  }
  if (typeof ex.quote === 'string' && isFiniteNumber(ex.resultNumber)) {
    if (!numericTokens(ex.quote).includes(String(ex.resultNumber))) {
      problems.push(`sourceExample.resultNumber ${ex.resultNumber} does not appear as a number in the sourceExample quote (the result must be stated in the quoted passage)`);
      affected.push('/sourceExample/resultNumber', '/sourceExample/quote');
    }
  }
  if (problems.length === 0) {
    // S6R-04: the quoted passage must EXPLICITLY bind every declared variable to its value
    // ("x = 6", "x is 6", "6 for x"); the recomputation happens at those bindings ONLY. The
    // quote's numbers are never permuted to make the stated result work, and the result token is
    // never an input candidate. Unbound/ambiguous bindings fail closed — the bridge then does
    // not count as grounding for FE-08.
    const parsed = parseExpression(gen.expression);
    if (!parsed.ok) {
      problems.push(`sourceExample cannot be recomputed because the expression does not parse (${parsed.error})`);
      affected.push('/expression');
    } else {
      const bound = bindSourceExampleInputs(ex.quote, gen.variables);
      if (!bound.ok) {
        problems.push(...bound.problems);
        affected.push('/sourceExample/quote');
      } else {
        const shown = Object.entries(bound.bindings).map(([k, x]) => `${k}=${x}`).join(', ');
        const value = evaluate(parsed.ast, bound.bindings);
        if (!Number.isFinite(value)) {
          problems.push(`sourceExample does not match the recomputation: at the source-stated bindings (${shown}) the expression ${gen.expression} is not finite`);
          affected.push('/sourceExample/resultNumber', '/sourceExample/quote', '/expression');
        } else if (Math.abs(value - ex.resultNumber) > ex.tolerance) {
          problems.push(`sourceExample does not match the recomputation at the source-stated bindings (${shown}): ${gen.expression} evaluates to ${value}, the quote states ${ex.resultNumber} (tolerance ${ex.tolerance})`);
          affected.push('/sourceExample/resultNumber', '/sourceExample/quote', '/expression');
        }
      }
    }
  }
  return { passed: problems.length === 0, problems, affected };
}

export function validateFormulaExplorer(gen: FormulaExplorerGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = formulaExplorerStructuralProblems(gen);
  const parsedExpr = parseExpression(gen.expression ?? '');
  const names = Array.isArray(gen.variables) ? gen.variables.map(v => v.name) : [];
  const sourceExampleVerdict = checkSourceExample(gen, idx);

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every formula-explorer case id and title shape is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `formula-explorer gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('FE-01', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const { problems: qp, affected: qa, grounded } = collectQuoteFailures(
        [{ quote: gen.quote, sourceId: gen.sourceId, quotePtr: '/quote', sourceIdPtr: '/sourceId', label: 'formula quote' }],
        idx,
      );
      problems.push(...qp);
      affected.push(...qa);
      if (typeof gen.formulaText !== 'string' || gen.formulaText === '') {
        problems.push('formulaText is empty, expected the formula as printed on the page (<= 120 characters)');
        affected.push('/formulaText');
      } else if (gen.formulaText.length > L.expressionMaxChars) {
        problems.push(`formulaText is ${gen.formulaText.length} characters, expected <= ${L.expressionMaxChars}`);
        affected.push('/formulaText');
      } else {
        const inQuote = normalizePageFormula(gen.quote ?? '').includes(normalizePageFormula(gen.formulaText));
        if (!inQuote) {
          problems.push(`formulaText "${gen.formulaText}" does not occur in the formula quote "${String(gen.quote).slice(0, 60)}" after the fixed normalisation (the formula itself must be quoted, not paraphrased)`);
          affected.push('/formulaText', '/quote');
        } else if (qp.length === 0) {
          // S6R-03: the quote is grounded — now require that its occurrence in the source (and the
          // formulaText's occurrence in the quote) does not cut a mathematical token at an edge.
          const comp = formulaCompletenessProblems(gen.quote, gen.formulaText, idx.textOf(gen.sourceId));
          problems.push(...comp.problems);
          affected.push(...comp.affected);
        }
      }
      return problems.length === 0
        ? { passed: true, message: `the formula quote (${grounded} quote) appears verbatim in source "${gen.sourceId}" and formulaText occurs inside the quote after normalisation, with no mathematical token cut at the quote edges (formula-quoted)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-02', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!parsedExpr.ok) {
        problems.push(`expression "${gen.expression}" does not parse in the frozen calculator grammar: ${parsedExpr.error}`);
        affected.push('/expression');
      } else {
        const used = astVariables(parsedExpr.ast);
        const usedSet = new Set(used);
        const declaredSet = new Set(names.filter(n => typeof n === 'string'));
        for (const u of used) {
          if (!declaredSet.has(u)) {
            problems.push(`expression uses "${u}", which is not a declared variable name (the variable sets must be equal)`);
            affected.push('/expression');
          }
        }
        names.forEach((n, i) => {
          if (typeof n === 'string' && !usedSet.has(n)) {
            problems.push(`variable "${n}" is declared but never used in the expression (the variable sets must be equal)`);
            affected.push(`/variables/${i}/name`, '/expression');
          }
        });
        const nodeCount = astNodeCount(parsedExpr.ast);
        if (nodeCount > L.astMaxNodes) {
          problems.push(`the expression AST has ${nodeCount} nodes, expected <= ${L.astMaxNodes}`);
          affected.push('/expression');
        }
      }
      return problems.length === 0
        ? { passed: true, message: `expression parses in the frozen grammar (<= ${L.expressionMaxChars} chars, AST <= ${L.astMaxNodes} nodes, no "**", no implicit multiplication) and its variable set equals the declared set (expression-parses)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-03', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (!Array.isArray(gen.variables) || gen.variables.length < L.variables.min || gen.variables.length > L.variables.max) {
        problems.push(`variables has ${Array.isArray(gen.variables) ? gen.variables.length : typeof gen.variables} entries, expected ${L.variables.min}-${L.variables.max}`);
        affected.push('/variables');
      }
      const dups = duplicateOccurrences(names.filter(n => typeof n === 'string'));
      gen.variables.forEach((v, i) => {
        if (typeof v.name !== 'string' || !FORMULA_VAR_NAME_PATTERN.test(v.name)) {
          problems.push(`variables[${i}].name is ${JSON.stringify(v.name)}, expected to match ${FORMULA_VAR_NAME_PATTERN.source}`);
          affected.push(`/variables/${i}/name`);
        } else if ((FORMULA_RESERVED_NAMES as readonly string[]).includes(v.name)) {
          problems.push(`variables[${i}].name "${v.name}" is reserved (function/constant names are never variable names)`);
          affected.push(`/variables/${i}/name`);
        } else if (dups.has(v.name)) {
          problems.push(`variables[${i}].name "${v.name}" occurs more than once (expected unique names)`);
          affected.push(`/variables/${i}/name`);
        }
        if (typeof v.pageSymbol !== 'string' || v.pageSymbol === '') {
          problems.push(`variables[${i}].pageSymbol is ${JSON.stringify(v.pageSymbol)}, expected the exact page token (e.g. "Cd", "rho", "V")`);
          affected.push(`/variables/${i}/pageSymbol`);
        }
        if (typeof v.meaning !== 'string' || v.meaning === '') {
          problems.push(`variables[${i}].meaning must be a non-empty plain-text string`);
          affected.push(`/variables/${i}/meaning`);
        }
        if (v.meaningQuoted === true && typeof v.meaning === 'string' && typeof v.quote === 'string') {
          const nq = v.quote.replace(/\s+/g, ' ').toLowerCase();
          if (!nq.includes(v.meaning.replace(/\s+/g, ' ').toLowerCase())) {
            problems.push(`variables[${i}]: meaningQuoted=true but the meaning "${v.meaning}" does not occur in the variable's quote`);
            affected.push(`/variables/${i}/meaning`, `/variables/${i}/quote`);
          }
        }
        // Variable quotes use the explorer's TOP-LEVEL sourceId (S6-0 deviation note).
        const qp = idx.docById.has(gen.sourceId) ? quoteProblems(v.quote, gen.sourceId, idx) : [`quote cites sourceId ${JSON.stringify(gen.sourceId)}, which is not among the provided sources`];
        if (qp.length > 0) {
          problems.push(...qp.map(m => `variables[${i}]: ${m}`));
          affected.push(`/variables/${i}/quote`);
        }
      });
      if (typeof gen.xVariable !== 'string' || !names.includes(gen.xVariable)) {
        problems.push(`xVariable is ${JSON.stringify(gen.xVariable)}, expected one of the declared variable names (${names.join(', ')})`);
        affected.push('/xVariable');
      }
      return problems.length === 0
        ? { passed: true, message: `all ${gen.variables.length} variables are declared with valid unique non-reserved names, exact page symbols, grounded quotes (top-level sourceId) and xVariable "${gen.xVariable}" is one of them (variables-declared)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-04', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const declared = new Set(names);
      gen.cases.forEach((c, i) => {
        const inputs = c.inputs ?? [];
        const caseNames = inputs.map(inp => inp.name);
        const caseSet = new Set(caseNames);
        if (caseNames.length !== inputs.length || caseSet.size !== declared.size || ![...caseSet].every(n => declared.has(n))) {
          problems.push(`cases[${i}] (${c.id}): input names [${caseNames.join(', ')}] must equal the declared variable names exactly (${names.join(', ')})`);
          affected.push(`/cases/${i}/inputs`);
          return;
        }
        const point: Record<string, number> = {};
        inputs.forEach((inp, j) => {
          const v = gen.variables.find(x => x.name === inp.name);
          if (!isFiniteNumber(inp.value)) {
            problems.push(`cases[${i}] (${c.id}): input ${inp.name} is ${String(inp.value)}, expected a finite number`);
            affected.push(`/cases/${i}/inputs/${j}/value`);
            return;
          }
          if (v !== undefined && isFiniteNumber(v.min) && isFiniteNumber(v.max) && (inp.value < v.min || inp.value > v.max)) {
            problems.push(`cases[${i}] (${c.id}): input ${inp.name}=${inp.value} is outside the slider range [${v.min}, ${v.max}]`);
            affected.push(`/cases/${i}/inputs/${j}/value`);
          }
          point[inp.name] = inp.value;
        });
        if (parsedExpr.ok && Object.keys(point).length === declared.size) {
          const output = evaluate(parsedExpr.ast, point);
          if (!Number.isFinite(output)) {
            problems.push(`cases[${i}] (${c.id}): the expression evaluates to ${Number.isNaN(output) ? 'NaN (a domain error: division by zero, sqrt(<0), log(<=0), 0^negative, |exponent|>100 or overflow)' : String(output)} at these inputs, expected a finite result`);
            affected.push(`/cases/${i}/inputs`);
          }
        }
      });
      return problems.length === 0
        ? { passed: true, message: `all ${gen.cases.length} case(s) carry exactly the declared variables with finite in-range inputs and every recomputed output is finite (the system sets the outputs) (cases-recomputed)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-05', 'behavioral', () => {
      const v = sourceExampleVerdict;
      return v.passed
        ? {
            passed: true,
            message: gen.hasSourceExample
              ? 'the declared source example is quoted verbatim, states its result, and matches the recomputation within its tolerance (sourceExample-check)'
              : 'hasSourceExample=false with the empty sourceExample shape (sourceExample-check)',
          }
        : { passed: false, message: `${v.problems.join('; ')} (expected a single quotable passage that explicitly binds every variable — "x = 6", "x is 6" or "6 for x" — and states the result, matching our evaluation at those bindings within a tolerance in [${L.tolerance.min}, ${L.tolerance.max}])`, path: v.affected[0], affected: v.affected };
    }),

    guarded('FE-06', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.variables.forEach((v, i) => {
        if (!isFiniteNumber(v.min) || !isFiniteNumber(v.max) || !isFiniteNumber(v.default)) {
          problems.push(`variables[${i}] (${v.name}): min/max/default must be finite numbers (got ${String(v.min)}, ${String(v.max)}, ${String(v.default)})`);
          affected.push(`/variables/${i}/min`, `/variables/${i}/max`, `/variables/${i}/default`);
          return;
        }
        if (!(v.min < v.max)) {
          problems.push(`variables[${i}] (${v.name}): min (${v.min}) must be < max (${v.max})`);
          affected.push(`/variables/${i}/min`, `/variables/${i}/max`);
        }
        if (!(v.min <= v.default && v.default <= v.max)) {
          problems.push(`variables[${i}] (${v.name}): default (${v.default}) must satisfy min (${v.min}) <= default <= max (${v.max})`);
          affected.push(`/variables/${i}/default`);
        }
        if (v.min > 0 && v.max / v.min > L.sliderRatioMax) {
          problems.push(`variables[${i}] (${v.name}): slider ratio max/min = ${v.max / v.min} exceeds ${L.sliderRatioMax}`);
          affected.push(`/variables/${i}/min`, `/variables/${i}/max`);
        }
      });
      if (parsedExpr.ok) {
        const bigExponents: string[] = [];
        const walk = (n: AstNode): void => {
          if (n.kind === 'bin') {
            if (n.op === '^' && n.right.kind === 'num' && Math.abs(n.right.value) > L.exponentAbsMax) bigExponents.push(String(n.right.value));
            walk(n.left); walk(n.right);
          } else if (n.kind === 'neg') walk(n.operand);
          else if (n.kind === 'call') walk(n.arg);
        };
        walk(parsedExpr.ast);
        if (bigExponents.length > 0) {
          problems.push(`expression has literal exponent(s) ${bigExponents.join(', ')} with |exponent| > ${L.exponentAbsMax}`);
          affected.push('/expression');
        }
      }
      return problems.length === 0
        ? { passed: true, message: `every slider range is sane (finite, min < max, default inside, positive-range ratio <= ${L.sliderRatioMax}) and no literal exponent exceeds ${L.exponentAbsMax} (ranges-sane)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-07', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const texts = [idx.textOf(gen.sourceId), ...all];
      const check = (label: string, text: unknown, ptr: string): void => {
        const p = numbersCheckProblems(label, text, texts);
        if (p.length > 0) { problems.push(...p); affected.push(ptr); }
      };
      check('title', gen.title, '/title');
      gen.variables.forEach((v, i) => check(`variables[${i}].meaning`, v.meaning, `/variables/${i}/meaning`));
      return problems.length === 0
        ? { passed: true, message: 'every number in the title and variable meanings appears on the page or in the same quote (N-01); units and formula fields are notation and exempt (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('FE-08', 'behavioral', () => {
      const affected = ['/expression', '/quote', '/formulaText', '/hasSourceExample', '/sourceExample/quote', '/sourceExample/resultNumber', '/sourceExample/tolerance'];
      gen.variables.forEach((v, i) => affected.push(`/variables/${i}/pageSymbol`));
      if (!parsedExpr.ok) {
        return { passed: false, message: `FE-08 cannot compare because the expression does not parse (${parsedExpr.error}). ${FE_FAILURE_MESSAGE}`, path: '/expression', affected: ['/expression'] };
      }
      const attempt = parsePageFormulaFromQuote(gen.quote ?? '', gen.variables ?? []);
      if (attempt.status === 'parsed' && attempt.ast !== undefined) {
        // Numeric comparison at INDEPENDENTLY varied points (S6R-02): the slider defaults,
        // per-variable one-at-a-time variation around them, seeded pseudo-random points and the
        // stored case inputs — never the old correlated diagonal, on which x===y at every sample
        // hid every (x-y)-shaped error.
        const points = independentSamplePoints(
          gen.variables.map(v => ({ name: v.name, min: v.min, max: v.max, default: v.default })),
          gen.cases.map(caseInputsOf),
        );
        const cmp = compareAtPoints(parsedExpr.ast, attempt.ast, points, FE08_RELATIVE_TOLERANCE);
        if (cmp.finite < FE08_MIN_AGREEING_POINTS) {
          return { passed: false, message: `only ${cmp.finite} of the ${points.length} independent comparison points give finite results on both sides, expected >= ${FE08_MIN_AGREEING_POINTS} finite agreeing points. ${FE_FAILURE_MESSAGE}`, path: '/expression', affected };
        }
        if (cmp.agreeing < FE08_MIN_AGREEING_POINTS || cmp.mismatches.length > 0) {
          const shown = cmp.mismatches.slice(0, 3).map(m => `at {${Object.entries(m.point).map(([k, x]) => `${k}=${x}`).join(', ')}}: expression=${m.a}, page formula="${attempt.rhs}"=${m.b}`);
          return { passed: false, message: `the expression "${gen.expression}" does not match the page formula "${attempt.rhs}" from the quote: ${cmp.agreeing}/${cmp.finite} finite independent comparison points (defaults, one-variable-at-a-time, seeded pseudo-random and stored case inputs) agree within relative ${FE08_RELATIVE_TOLERANCE} (need >= ${FE08_MIN_AGREEING_POINTS} agreeing and no mismatch). ${shown.join('; ')}. ${FE_FAILURE_MESSAGE}`, path: '/expression', affected };
        }
        return { passed: true, message: `the expression matches the page formula "${attempt.rhs}" parsed from the quote with the same grammar: ${cmp.agreeing}/${cmp.finite} finite independent comparison points agree within relative ${FE08_RELATIVE_TOLERANCE} with no mismatch (expression-matches-page-formula)` };
      }
      // Unparseable page formula (words, subscripts, greek-only names): publishes ONLY with a
      // verified FE-05 source example (addendum); else fail with the frozen message.
      if (sourceExampleVerdict.passed && gen.hasSourceExample === true) {
        return { passed: true, message: `the page formula line could not be parsed with the calculator grammar (${attempt.error ?? 'no parseable "=" line'}), but a verified source example grounds the expression — the UI shows "Formula entered by AI from the quoted line - compare with the quote" (expression-matches-page-formula via the FE-05 bridge)` };
      }
      return {
        passed: false,
        message: `the page formula line could not be parsed with the calculator grammar (${attempt.error ?? 'no parseable "=" line'}) and there is no verified FE-05 source example to ground the expression; an unparseable page formula publishes ONLY with a verified source example. ${FE_FAILURE_MESSAGE}`,
        path: '/expression',
        affected,
      };
    }),
  ];

  return buildReport('formula-explorer-v1', checks, opts.revision ?? 1);
}
