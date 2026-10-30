// S6-V — shared helpers for the Stage 6 kit validators (packages/validation/kit/*.ts) and
// analysis-v2.ts. Conventions follow v1 (packages/validation/validate.ts):
//   - quotes are whitespace-normalised before matching (normalizeWhitespace);
//   - a quote counts as evidence only per quoteCountsAsEvidence (R-05/N-07);
//   - failing checks carry validator-owned `affected` JSON-pointer paths, one per offending
//     field occurrence; repair authorization consumes ONLY those paths;
//   - checks never throw (guarded()), plain-language messages say what failed AND what was
//     expected.
// JSON-pointer paths are relative to the GEN object the caller validates (the artifact a repair
// revises), e.g. '/cards/2/quote', '/overview/keyPoints/0/point', '/variables/1/min'.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_ID_PATTERN } from '../../contracts/kit.ts';
import {
  indexSources,
  normalizeWhitespace,
  quoteCountsAsEvidence,
  QUOTE_MESSAGE_LIMIT,
  truncate,
} from '../validate.ts';
import type { TextLookup } from '../validate.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import { normalizeChemFormula, normalizeEquationText, parseChemicalFormula } from '../chemistry.ts';

/* ------------------------------------------------------------------ */
/* Source index with paragraph/sentence context                        */
/* ------------------------------------------------------------------ */

export interface SourceIndex {
  docById: Map<string, SourceDocument>;
  /** Whitespace-normalised full text of a source (undefined when the sourceId does not resolve). */
  textOf: TextLookup;
  /** Raw text of a source (needed for blank-line paragraph structure). */
  rawTextOf: (sourceId: string) => string | undefined;
  /** Normalised paragraphs of a source (blank-line split of the raw text). */
  paragraphsOf: (sourceId: string) => string[];
  /** Offset of the normalised quote in the normalised source text, -1 when not found. */
  locate: (quote: string, sourceId: string) => number;
  /**
   * The normalised source sentence span containing ANY located occurrence of the quote
   * (sentence boundaries: [.!?] followed by whitespace or end). null when unlocatable.
   */
  sentenceOf: (quote: string, sourceId: string) => string | null;
  /**
   * The normalised paragraph containing ANY located occurrence of the quote
   * (blank-line split of the raw source text). null when unlocatable.
   */
  paragraphOf: (quote: string, sourceId: string) => string | null;
  /** Normalised texts of every provided source (for fields without their own sourceId). */
  allTexts: () => string[];
}

export function buildSourceIndex(sources: SourceDocument[]): SourceIndex {
  const { docById, textOf } = indexSources(Array.isArray(sources) ? sources : []);
  const paraCache = new Map<string, string[]>();
  const rawTextOf = (sourceId: string): string | undefined => {
    const doc = docById.get(sourceId);
    return doc !== undefined && typeof doc.text === 'string' ? doc.text : undefined;
  };
  const paragraphsOf = (sourceId: string): string[] => {
    let paras = paraCache.get(sourceId);
    if (paras === undefined) {
      const raw = rawTextOf(sourceId);
      paras = raw === undefined ? [] : raw.split(/\n\s*\n/).map(p => normalizeWhitespace(p)).filter(p => p !== '');
      paraCache.set(sourceId, paras);
    }
    return paras;
  };
  const locate = (quote: string, sourceId: string): number => {
    const text = textOf(sourceId);
    if (text === undefined || typeof quote !== 'string') return -1;
    return text.indexOf(normalizeWhitespace(quote));
  };
  const sentenceOf = (quote: string, sourceId: string): string | null => {
    const text = textOf(sourceId);
    const nq = normalizeWhitespace(quote ?? '');
    if (text === undefined || nq === '') return null;
    let from = 0;
    for (;;) {
      const start = text.indexOf(nq, from);
      if (start === -1) return null;
      const end = start + nq.length;
      // Expand left to just after the previous sentence terminator.
      let s = 0;
      for (let i = start - 1; i >= 0; i--) {
        const ch = text[i];
        if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? ''))) {
          s = i + 1;
          break;
        }
      }
      // Expand right to the end of the terminator that closes this sentence.
      let e = text.length;
      for (let i = end; i < text.length; i++) {
        const ch = text[i];
        if ((ch === '.' || ch === '!' || ch === '?') && (i + 1 >= text.length || /\s/.test(text[i + 1] ?? ''))) {
          e = i + 1;
          break;
        }
      }
      const sentence = normalizeWhitespace(text.slice(Math.min(s, start), Math.max(e, end)));
      if (sentence.includes(nq)) return sentence;
      from = start + 1;
    }
  };
  const paragraphOf = (quote: string, sourceId: string): string | null => {
    const nq = normalizeWhitespace(quote ?? '');
    if (nq === '') return null;
    for (const p of paragraphsOf(sourceId)) {
      if (p.includes(nq)) return p;
    }
    return null;
  };
  const allTexts = (): string[] => {
    const out: string[] = [];
    for (const id of docById.keys()) {
      const t = textOf(id);
      if (t !== undefined) out.push(t);
    }
    return out;
  };
  return { docById, textOf, rawTextOf, paragraphsOf, locate, sentenceOf, paragraphOf, allTexts };
}

/* ------------------------------------------------------------------ */
/* Quote grounding                                                     */
/* ------------------------------------------------------------------ */

/**
 * The shared verbatim-quote rule (design §2 conventions): a quote must be 1-150 characters,
 * count as evidence (R-05/N-07), cite a provided sourceId, and appear in that source's text
 * after whitespace normalisation. Returns plain-language problems (empty when grounded).
 */
export function quoteProblems(quote: unknown, sourceId: unknown, idx: SourceIndex): string[] {
  const problems: string[] = [];
  const shown = typeof quote === 'string' ? `"${truncate(quote, QUOTE_MESSAGE_LIMIT)}"` : JSON.stringify(quote);
  if (typeof quote !== 'string' || quote === '') {
    problems.push(`quote ${shown} is empty, expected 1-${KIT_LIMITS.common.quote.max} characters copied from the source`);
    return problems;
  }
  if (quote.length > KIT_LIMITS.common.quote.max) {
    problems.push(`quote ${shown} is ${quote.length} characters, expected <= ${KIT_LIMITS.common.quote.max}`);
  }
  if (!quoteCountsAsEvidence(quote)) {
    problems.push(`quote ${shown} does not count as evidence: expected >= 8 normalised characters with >= 3 letters/digits, or a compact equation containing "="`);
  }
  if (typeof sourceId !== 'string' || !idx.docById.has(sourceId)) {
    problems.push(`quote ${shown} cites sourceId ${JSON.stringify(sourceId)}, which is not among the provided sources (${[...idx.docById.keys()].join(', ') || 'none'})`);
    return problems;
  }
  const text = idx.textOf(sourceId);
  if (text === undefined || !text.includes(normalizeWhitespace(quote))) {
    problems.push(`quote ${shown} was not found verbatim in source "${sourceId}" after whitespace normalisation`);
  }
  return problems;
}

/** True when the (normalised) `needle` occurs in the (normalised) `haystack`, case-insensitively. */
export function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeWhitespace(haystack).toLowerCase().includes(normalizeWhitespace(needle).toLowerCase());
}

export interface EntryQuote {
  quote: unknown;
  sourceId: unknown;
  /** JSON pointer of the quote field, e.g. '/cards/2/quote'. */
  quotePtr: string;
  /** JSON pointer of the sourceId field, e.g. '/cards/2/sourceId'. */
  sourceIdPtr: string;
  label: string;
}

/**
 * Shared verbatim-quote sweep (every *-01 quotes check): an unresolvable sourceId unlocks both
 * the sourceId and the quote field (the citation itself must change); any other quote problem
 * unlocks the quote field only (v1 grounding.quotes convention).
 */
export function collectQuoteFailures(entries: EntryQuote[], idx: SourceIndex): { problems: string[]; affected: string[]; grounded: number } {
  const problems: string[] = [];
  const affected: string[] = [];
  let grounded = 0;
  for (const e of entries) {
    if (typeof e.sourceId !== 'string' || !idx.docById.has(e.sourceId)) {
      problems.push(`${e.label}: quote cites sourceId ${JSON.stringify(e.sourceId)}, which is not among the provided sources (${[...idx.docById.keys()].join(', ') || 'none'})`);
      affected.push(e.sourceIdPtr, e.quotePtr);
      continue;
    }
    const p = quoteProblems(e.quote, e.sourceId, idx);
    if (p.length > 0) {
      problems.push(...p.map(m => `${e.label}: ${m}`));
      affected.push(e.quotePtr);
    } else {
      grounded++;
    }
  }
  return { problems, affected, grounded };
}

/* ------------------------------------------------------------------ */
/* N-01 numbers-checkable                                              */
/* ------------------------------------------------------------------ */

/**
 * Numeric tokens of an AI-written string: digit runs with an optional decimal part, after
 * un-grouping thousands separators ("1,000" → one token "1000"). Words ("ten") carry no digits
 * and are not claims under N-01.
 */
export function numericTokens(text: string): string[] {
  if (typeof text !== 'string') return [];
  const ungrouped = text.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return ungrouped.match(/\d+(?:\.\d+)?/g) ?? [];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `token` occurs in `text` as a whole numeric token (no digit or dot attached). */
export function numberOccursIn(token: string, text: string): boolean {
  const re = new RegExp(`(?<![\\d.])${escapeRegExp(token)}(?![\\d.])`);
  return re.test(text);
}

/**
 * N-01: every number in an AI-written string must appear (as a WHOLE SIGNED numeric token, by
 * value) in the cited page — or, for fields with no sourceId of their own, in ANY provided page.
 * Returns one plain-language problem per ungrounded number.
 *
 * Comparison is token-by-value on both sides, so a page's "828,000" grounds the text's "828000"
 * and "$23,000" grounds "23000", while `2` is still NOT grounded by `20`, `2.5`, `-2` or `1,200`
 * (S6R-09 / A-10 live-run false rejections).
 */
export function numbersCheckProblems(label: string, text: unknown, searchTexts: (string | undefined)[]): string[] {
  if (typeof text !== 'string') return [];
  const texts = searchTexts.filter((t): t is string => typeof t === 'string');
  const problems: string[] = [];
  for (const value of signedNumericTokens(text)) {
    if (!texts.some(t => signedNumberOccursIn(value, t))) {
      problems.push(`${label} states the number ${value}, which does not appear as that whole number on the page or in the same quote (N-01)`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Whole signed numeric tokens (S6R-09)                                */
/* ------------------------------------------------------------------ */

export interface SignedNumberToken {
  /** The token exactly as written, e.g. "1,200", "-2", ".00326". */
  raw: string;
  /** Canonical value string, e.g. "1200", "-2", "0.00326" ("5.0" and "5" share one value). */
  value: string;
}

/**
 * A signed numeric token: optional sign, digits with optional thousands grouping, optional
 * decimal part (a leading decimal point is allowed: ".00326"). A hyphen/dash that follows a
 * digit is not a sign ("2-3" holds 2 and 3, never -3), and a token never begins inside another
 * number, its grouping or its decimal part.
 */
const SIGNED_NUMBER_RE = /(?<![\d.,])(?:([-\u2212])?(?:(\d{1,3}(?:,\d{3})+)(?!\d)|(\d+))(?:\.(\d+))?|([-\u2212])?\.(\d+))/g;

/** Canonical value string of a numeric token (sign kept, grouping removed, trailing zeros dropped). */
function canonicalNumber(sign: string | undefined, intPart: string, fracPart: string): string {
  const digits = intPart.replace(/,/g, '').replace(/^0+(?=\d)/, '') || '0';
  const frac = fracPart.replace(/0+$/, '');
  const negative = (sign === '-' || sign === '\u2212') && !(digits === '0' && frac === '');
  return `${negative ? '-' : ''}${digits}${frac === '' ? '' : `.${frac}`}`;
}

/** A whole signed numeric token together with its offsets in the scanned string. */
export interface SignedNumberSpan extends SignedNumberToken {
  start: number;
  end: number;
}

/** Every whole signed numeric token of a string, with its canonical value AND its offsets. */
export function signedNumberTokenSpans(text: string): SignedNumberSpan[] {
  const out: SignedNumberSpan[] = [];
  if (typeof text !== 'string' || text === '') return out;
  for (const m of text.matchAll(SIGNED_NUMBER_RE)) {
    const start = m.index ?? 0;
    const prev = start === 0 ? undefined : text[start - 1];
    // A token never begins inside another number, its grouping or its decimal part.
    if (prev !== undefined && /[0-9.,]/.test(prev)) continue;
    const sign = m[1] ?? m[5];
    const intPart = m[2] ?? m[3] ?? '';
    const fracPart = m[4] ?? m[6] ?? '';
    out.push({ raw: m[0], value: canonicalNumber(sign, intPart, fracPart), start, end: start + m[0].length });
  }
  return out;
}

/** Every whole signed numeric token of a string, with its canonical value. */
export function signedNumberTokens(text: string): SignedNumberToken[] {
  return signedNumberTokenSpans(text).map(({ raw, value }) => ({ raw, value }));
}

/** The canonical values of every whole signed numeric token of a string. */
export function signedNumericTokens(text: string): string[] {
  return [...new Set(signedNumberTokens(text).map(t => t.value))];
}

/** True when `value` (a canonical number) occurs in `text` as a whole signed numeric token. */
export function signedNumberOccursIn(value: string, text: string): boolean {
  return signedNumberTokens(text).some(t => t.value === value);
}

/** Canonical numbers stated in `content` that do NOT occur in `text` as the same whole number. */
export function missingSignedNumbers(content: string, text: string): string[] {
  const present = new Set(signedNumberTokens(text).map(t => t.value));
  return signedNumericTokens(content).filter(v => !present.has(v));
}

/**
 * The numbers of `text` that carry `value` inside themselves ("1,200" carries 200, "20" carries
 * 2, "-2" carries 2). Used only for plain-language messages: "the quote prints 20 there".
 */
export function numbersCarryingToken(text: string, value: string): string[] {
  const digits = value.replace(/^-/, '');
  return signedNumberTokens(text)
    .filter(t => t.value !== value && t.value.replace(/^-/, '').includes(digits))
    .map(t => t.raw);
}

/**
 * S6R-09: `content` occurs in `text` after normalisation AND, AT A MATCHED OCCURRENCE, every number
 * in `content` is the same whole signed number there. The identity is checked at the occurrence
 * itself, not anywhere in `text`, so an unrelated whole `2` later in the same quote cannot rescue
 * `a value of 2` printed inside `a value of 20`. Values still cross spelling (`5` matches a printed
 * `5.0`), while `2` never matches inside `20`, `2.5`, `-2` or `1,200`.
 */
export function contentOccursWhole(text: string, content: string): { ok: boolean; contained: boolean; missingNumbers: string[] } {
  const hay = normalizeWhitespace(typeof text === 'string' ? text : '').toLowerCase();
  const ndl = normalizeWhitespace(typeof content === 'string' ? content : '').toLowerCase();
  if (hay === '' || ndl === '') return { ok: false, contained: false, missingNumbers: [] };
  const first = hay.indexOf(ndl);
  if (first === -1) return { ok: false, contained: false, missingNumbers: [] };
  const hayNumbers = signedNumberTokenSpans(hay);
  const contentNumbers = signedNumberTokenSpans(ndl);
  let best: string[] | null = null;
  for (let at = first; at !== -1; at = hay.indexOf(ndl, at + 1)) {
    const missing: string[] = [];
    for (const n of contentNumbers) {
      const from = at + n.start;
      const to = at + n.end;
      // The whole number printed at this position may be longer than the matched slice (the `20`
      // that a cropped `2` sits inside); its VALUE is what has to agree.
      const whole = hayNumbers.find(h => h.start <= from && h.end >= to);
      if (whole === undefined || whole.value !== n.value) missing.push(n.value);
    }
    if (missing.length === 0) return { ok: true, contained: true, missingNumbers: [] };
    if (best === null || missing.length < best.length) best = missing;
  }
  return { ok: false, contained: true, missingNumbers: [...new Set(best ?? [])] };
}

/**
 * S6R-13: the value of an option that is nothing but one number (`5`, `5.00`, `1,200`, `-5`), or
 * null when the option carries any wording, unit, percent or currency mark. Two options with the
 * same value are the same answer, and index-only grading cannot tell them apart.
 */
export function numericOptionValue(option: string): string | null {
  if (typeof option !== 'string') return null;
  const token = normalizeWhitespace(option).trim();
  if (token === '') return null;
  const spans = signedNumberTokenSpans(token);
  if (spans.length !== 1) return null;
  const only = spans[0] as SignedNumberSpan;
  if (only.raw !== token) return null; // wording, units or marks around the number
  return only.value;
}

/* ------------------------------------------------------------------ */
/* Chemical-token boundaries (S6R-05)                                  */
/* ------------------------------------------------------------------ */

/** Characters that continue a chemical token: letters, digits and unicode subscripts. */
const CHEMICAL_CONTINUATION = /[0-9A-Za-z\u2080-\u2089]/;

/** True when `ch` would continue a formula, so a match next to it is a crop, not a species. */
export function isChemicalContinuation(ch: string | undefined): boolean {
  return typeof ch === 'string' && ch !== '' && CHEMICAL_CONTINUATION.test(ch);
}

export interface TextSpan {
  start: number;
  end: number;
  /** The matched text after equation normalisation (subscripts → ASCII, arrows → '->'). */
  text: string;
}

/**
 * Occurrences of `needle` in `haystack` that are complete chemical tokens: the characters right
 * before and right after the match must not continue a formula. Both sides are compared after
 * `normalizeEquationText`, so a printed "H2O2" and a written "H2O" are distinguishable even with
 * unicode subscripts or a different arrow.
 */
export function chemicallyCompleteOccurrences(haystack: string, needle: string): TextSpan[] {
  const hay = normalizeEquationText(typeof haystack === 'string' ? haystack : '');
  const ndl = normalizeEquationText(typeof needle === 'string' ? needle : '');
  const out: TextSpan[] = [];
  if (ndl === '') return out;
  for (let from = 0; from <= hay.length - ndl.length;) {
    const start = hay.indexOf(ndl, from);
    if (start === -1) break;
    const end = start + ndl.length;
    if (!isChemicalContinuation(start === 0 ? undefined : hay[start - 1]) && !isChemicalContinuation(end >= hay.length ? undefined : hay[end])) {
      out.push({ start, end, text: ndl });
    }
    from = start + 1;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Maximal printed reaction span (S6R-05)                              */
/* ------------------------------------------------------------------ */

/** Characters that continue a printed reaction term (formula, coefficient, group). Subscripts are ASCII here. */
const REACTION_TERM_CHAR = /[0-9A-Za-z()[\]{}]/;

/** True when `term` is `[coefficient]formula` and the formula parses, so it is a printed species. */
function isFormulaTerm(term: string): boolean {
  const formula = term.replace(/^[0-9]+/, '');
  if (formula === '') return false;
  return parseChemicalFormula(formula).ok;
}

/**
 * A neighbouring whitespace-delimited token counts as a continued printed species only when it is a
 * formula WITH a subscript or a group. That keeps ordinary capitalised words out (`Carbon`, `Water`
 * and even element-looking words such as `In` are prose, not a leg this span should absorb).
 */
function isPrintedSpeciesToken(token: string): boolean {
  const cleaned = token.replace(/^[^A-Za-z0-9([]+/, '').replace(/[^A-Za-z0-9)\]}]+$/, '');
  if (cleaned === '' || !/[0-9()[\]{}]/.test(cleaned)) return false;
  return isFormulaTerm(cleaned);
}

export interface ReactionSpan {
  start: number;
  end: number;
  /**
   * The MAXIMAL reaction printed around the arrow, normalised (subscripts ASCII, arrows `->`), e.g.
   * `H2 + O2 -> H2O + H2O2`. Not the generated substring: whole printed terms on both sides of the
   * arrow belong to it.
   */
  text: string;
  /**
   * True when the printed reaction visibly runs on past this span (a further species printed after
   * whitespace without an operator, or a dangling operator). Callers fail closed.
   */
  continues: boolean;
}

/**
 * S6R-05: the maximal reaction span of `haystack` around the occurrence of `needle`. Starting from a
 * token-boundary occurrence, both edges extend over `+`, arrow, coefficients, species and state
 * symbols (state symbols are stripped by the equation normalisation) until a non-reaction token, so
 * a whole printed term can never be silently dropped. `null` when `needle` does not occur as a
 * complete chemical-token run at all (e.g. `H2O` cut out of `H2O2`).
 */
export function maximalReactionSpan(haystack: string, needle: string): ReactionSpan | null {
  const hay = normalizeEquationText(typeof haystack === 'string' ? haystack : '');
  const ndl = normalizeEquationText(typeof needle === 'string' ? needle : '');
  if (hay === '' || ndl === '') return null;
  const occurrence = chemicallyCompleteOccurrences(hay, ndl)[0];
  if (occurrence === undefined) return null;
  let start = occurrence.start;
  let end = occurrence.end;
  // Extend LEFT one printed term at a time across "term +" / "term ->" boundaries.
  for (;;) {
    const op = /(\s*(?:\+|->)\s*)$/.exec(hay.slice(0, start));
    if (op === null) break;
    const opStart = start - (op[0] as string).length;
    let termStart = opStart;
    while (termStart > 0 && REACTION_TERM_CHAR.test(hay[termStart - 1] as string)) termStart--;
    if (termStart === opStart) break; // an operator with no printed term before it
    start = termStart;
  }
  // Extend RIGHT symmetrically.
  for (;;) {
    const op = /^(\s*(?:\+|->)\s*)/.exec(hay.slice(end));
    if (op === null) break;
    const termStart = end + (op[0] as string).length;
    let termEnd = termStart;
    while (termEnd < hay.length && REACTION_TERM_CHAR.test(hay[termEnd] as string)) termEnd++;
    if (termEnd === termStart) break; // an operator with no printed term after it
    end = termEnd;
  }
  const before = hay.slice(0, start);
  const after = hay.slice(end);
  const lastBefore = /(\S+)\s*$/.exec(before)?.[1] ?? '';
  const firstAfter = /^\s*(\S+)/.exec(after)?.[1] ?? '';
  const continues =
    /(\+|->)\s*$/.test(before) ||
    /^\s*(?:\+|->)/.test(after) ||
    (lastBefore !== '' && isPrintedSpeciesToken(lastBefore)) ||
    (firstAfter !== '' && isPrintedSpeciesToken(firstAfter));
  return { start, end, text: hay.slice(start, end), continues };
}

/** The source text around any occurrence of `needle` (±`pad` characters), for messages. Null when absent. */
export function occurrenceContext(haystack: string, needle: string, pad = 28): string | null {
  const hay = normalizeEquationText(typeof haystack === 'string' ? haystack : '');
  const ndl = normalizeEquationText(typeof needle === 'string' ? needle : '');
  if (ndl === '' || hay === '') return null;
  const start = hay.indexOf(ndl);
  if (start === -1) return null;
  const end = start + ndl.length;
  const from = Math.max(0, start - pad);
  const to = Math.min(hay.length, end + pad);
  return `${from > 0 ? '...' : ''}${hay.slice(from, to)}${to < hay.length ? '...' : ''}`;
}

/**
 * Every complete chemical formula token in `text` (subscripts → ASCII, state symbols stripped).
 * Tokenising the whole maximal run is what makes "H2O" inside "H2O2" or "H2O(water)" fail: only
 * the longest run is a token.
 */
export function chemicalFormulaTokens(text: string): string[] {
  const norm = normalizeEquationText(typeof text === 'string' ? text : '');
  const out: string[] = [];
  for (const m of norm.matchAll(/[A-Z][A-Za-z0-9()[\]]*/g)) out.push(normalizeChemFormula(m[0]));
  return out;
}

/* ------------------------------------------------------------------ */
/* Publisher-claim tokens (kit policy sweep, A-09, OV-03)              */
/* ------------------------------------------------------------------ */

/** The frozen generic phrases (design §1.6 A-09): matched word-boundary, case-insensitive. */
export const GENERIC_PUBLISHER_PHRASES = ['according to', 'as stated by', 'official', 'endorsed'] as const;

/** Acronym-like all-caps tokens that are not publisher names (roman numerals, locale marks). */
const ACRONYM_EXCLUDE = new Set(['US', 'USA', 'II', 'III', 'IV', 'VI', 'IX', 'XI', 'AI', 'UK', 'UN', 'AM', 'PM', 'ET']);

export interface PublisherTokens {
  /** Lowercased full publisher phrases (>= 2 words), matched as substrings of normalised text. */
  phrases: string[];
  /**
   * Acronyms of the publisher NAME (lead ruling 4): the all-caps words of the publisher phrase
   * (NASA, NOAA) or the initials of its content words (NARA, CFPB, NIJ, NRC, USGS). Never
   * ordinary words, never loose all-caps metadata words (FAQ, URL) and never all-caps words of a
   * page title quoted inside the attribution (PCR, DNA).
   */
  nameAcronyms: Set<string>;
  /** The full publisher name without a leading "U.S." / "the" (>= 2 words), lowercased. */
  namePhrases: string[];
}

const NAME_STOPWORDS = new Set(['and', 'of', 'the', 'for', 'on', 'in', '&']);

/** Kit-mode tokens of one publisher phrase: name acronyms + the "U.S."-stripped full name. */
function kitNameTokens(norm: string, out: { nameAcronyms: Set<string>; namePhrases: string[] }, allowInitials: boolean): void {
  const raw = norm.replace(/\([^)]*\)/g, ' ').split(/\s+/).map(w => w.replace(/^[^A-Za-z]+|[^A-Za-z.]+$/g, '')).filter(w => w !== '');
  // All-caps words of the phrase itself (NASA, NOAA — including a parenthetical "(NOAA Ocean Exploration)").
  for (const m of norm.matchAll(/\b[A-Z]{2,}\b/g)) {
    if (!ACRONYM_EXCLUDE.has(m[0])) out.nameAcronyms.add(m[0].toLowerCase());
  }
  const hasUS = raw.length > 0 && /^U\.?S\.?$/.test(raw[0] as string);
  const content = raw.slice(hasUS ? 1 : 0).filter(w => !NAME_STOPWORDS.has(w.toLowerCase().replace(/\./g, '')) && /^[A-Za-z][A-Za-z'-]*$/.test(w));
  const hasCaps = /\b[A-Z]{2,}\b/.test(norm.replace(/\b(U\.?S\.?)\b/, ''));
  if (!allowInitials) {
    // title publisher segments: all-caps words and the U.S.-stripped name only, no derived initials
  } else if (!hasCaps && content.length >= 3) {
    const initials = content.map(w => (w[0] as string).toLowerCase()).join('');
    out.nameAcronyms.add(initials);
    if (hasUS) out.nameAcronyms.add(`us${initials}`);
  } else if (!hasCaps && content.length === 2 && hasUS) {
    out.nameAcronyms.add(`us${content.map(w => (w[0] as string).toLowerCase()).join('')}`);
  }
  if (hasUS && content.length >= 2) {
    const stripped = raw.slice(1).join(' ').toLowerCase();
    if (!out.namePhrases.includes(stripped)) out.namePhrases.push(stripped);
  }
}

/**
 * Extract the publisher-claim token set from a source document's own metadata (title and
 * attribution only — the source TEXT is the subject matter, not a publisher claim). The
 * publisher phrase is the first comma-separated segment after "Source material:" in the
 * attribution, plus the first comma-separated segment after the dash in the title.
 *
 * Narrowed builder (2026-10-30, lead rulings 3-4 extended to A-09/OV-03): only FULL publisher
 * name phrases and NAME acronyms are produced. The old distinctive-single-word set ("census" from
 * "U.S. Census Bureau", "general" from "(U.S. General Services Administration)") and the loose
 * all-caps scan of the WHOLE attribution (which caught page-title words quoted there — "PCR",
 * "DNA" — and credit junk like FAQ/URL/NSF/WHOI) are gone: on 2026-10-30 they caused 12 of 13
 * Spark 1.3 analysis repairs, and every inspected one degraded true page content
 * (docs/evidence/stage-7/batch-2026-10-30/README.md).
 */
export function publisherTokensOf(doc: Pick<SourceDocument, 'title' | 'attribution'>): PublisherTokens {
  const tokens: PublisherTokens = { phrases: [], nameAcronyms: new Set(), namePhrases: [] };
  const addPhrase = (phrase: string | undefined): void => {
    if (phrase === undefined) return;
    const norm = normalizeWhitespace(phrase).replace(/[.,;:]+$/, '');
    if (norm === '') return;
    const words = norm.split(/\s+/).filter(w => /^[A-Za-z'][A-Za-z'-]*$/.test(w));
    if (words.length >= 2) tokens.phrases.push(norm.toLowerCase());
  };
  const attribution = typeof doc.attribution === 'string' ? doc.attribution : '';
  const title = typeof doc.title === 'string' ? doc.title : '';
  // Project convention for licensed sources: "Source material: <publisher>, <work>. ..." Attributions
  // without the marker (e.g. teacher-pasted sources) match as full phrases only, so ordinary
  // metadata words like "teacher" or "provided" can never false-reject ordinary teaching text.
  const sourceMaterial = /Source material:\s*([^.]*\.)/i.exec(attribution)?.[1] ?? /Source material:\s*([^.]*)/i.exec(attribution)?.[1];
  if (sourceMaterial !== undefined) {
    addPhrase(sourceMaterial.split(',')[0]);
  } else {
    addPhrase(attribution.split(/[.,;]/)[0]);
  }
  // Title publisher part: text after an em/en dash, first comma segment.
  const titleParts = title.split(/\s+[—–]\s+/);
  if (titleParts.length >= 2) addPhrase((titleParts[titleParts.length - 1] as string).split(',')[0]);
  // Name tokens (lead ruling 4): the publisher name is the whole first comma segment after
  // "Source material:" (so "U.S. Nuclear Regulatory Commission" keeps its dots) — initials
  // derived — plus the title's publisher segment (no initials). Neither ever sees the quoted
  // page-title or credit parts of the attribution.
  const kitSegment = /Source material:\s*([^,]+)/i.exec(attribution)?.[1];
  if (kitSegment !== undefined) kitNameTokens(normalizeWhitespace(kitSegment).replace(/[;:]+$/, ''), tokens, true);
  if (titleParts.length >= 2) kitNameTokens(normalizeWhitespace((titleParts[titleParts.length - 1] as string).split(',')[0] as string), tokens, false);
  return tokens;
}

export function mergePublisherTokens(list: PublisherTokens[]): PublisherTokens {
  const out: PublisherTokens = { phrases: [], nameAcronyms: new Set(), namePhrases: [] };
  for (const t of list) {
    for (const p of t.phrases) if (!out.phrases.includes(p)) out.phrases.push(p);
    for (const a of t.nameAcronyms) out.nameAcronyms.add(a);
    for (const p of t.namePhrases) if (!out.namePhrases.includes(p)) out.namePhrases.push(p);
  }
  return out;
}

/** Words (letters, digits, apostrophes, dots) of `text`, with the character offset of each word's start. */
function wordStarts(text: string): number[] {
  return [...text.matchAll(/[A-Za-z0-9][A-Za-z0-9'.-]*/g)].map(m => m.index as number);
}

/** How many words may sit between "according to" and the publisher name that follows it (lead ruling 3). */
const ACCORDING_TO_WINDOW_WORDS = 4;

/** The publisher name/acronym token that starts within the window after "according to", or null. */
function publisherAfterAccordingTo(norm: string, tokens: PublisherTokens): string | null {
  const re = /\baccording to\b/gi;
  for (let m = re.exec(norm); m !== null; m = re.exec(norm)) {
    const after = norm.slice(m.index + m[0].length);
    const lower = after.toLowerCase();
    const starts = wordStarts(after);
    const limit = starts[ACCORDING_TO_WINDOW_WORDS] ?? after.length + 1; // start offset of the 5th word
    const names = [...tokens.phrases, ...tokens.namePhrases];
    for (const phrase of names) {
      const at = lower.indexOf(phrase);
      if (at >= 0 && at < limit) return `according to ${phrase}`;
    }
    for (const acr of tokens.nameAcronyms) {
      const hit = new RegExp(`\\b${escapeRegExp(acr)}\\b`, 'i').exec(after);
      if (hit !== null && hit.index < limit) return `according to ${acr}`;
    }
  }
  return null;
}

/**
 * The publisher-claim hit in an AI-written string, or null. ONE narrowed rule for every publisher
 * sweep (kit policy, A-09 analysis, OV-03 overview — lead rulings 3-4, extended to the analysis
 * side on 2026-10-30): matches "as stated by" / "official" / "endorsed", the FULL publisher name
 * and the name acronyms; "according to" counts only when a publisher name or acronym follows
 * within ~4 words ("according to the definition" passes), and ordinary single words of the name
 * ("ocean" in "NOAA Office of Ocean Exploration", "census" in "U.S. Census Bureau") never match
 * on their own.
 */
export function findPublisherClaim(text: unknown, tokens: PublisherTokens): string | null {
  if (typeof text !== 'string' || text === '') return null;
  const norm = normalizeWhitespace(text);
  const lower = norm.toLowerCase();
  for (const phrase of GENERIC_PUBLISHER_PHRASES) {
    if (phrase === 'according to') continue;
    if (new RegExp(`\\b${phrase}\\b`, 'i').test(norm)) return phrase;
  }
  const afterAccordingTo = publisherAfterAccordingTo(norm, tokens);
  if (afterAccordingTo !== null) return afterAccordingTo;
  for (const phrase of [...tokens.phrases, ...tokens.namePhrases]) {
    if (lower.includes(phrase)) return phrase;
  }
  for (const acr of tokens.nameAcronyms) {
    if (new RegExp(`\\b${escapeRegExp(acr)}\\b`, 'i').test(norm)) return acr;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* A-11 plain text                                                     */
/* ------------------------------------------------------------------ */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const URL_PATTERN = /(https?:\/\/|www\.)\S/i;
const MARKDOWN_PATTERNS: { re: RegExp; name: string }[] = [
  { re: /(^|\n)#{1,6}\s/, name: 'markdown heading "# "' },
  { re: /\[[^\]]*\]\([^)]*\)/, name: 'markdown link "[](" ' },
  { re: /\*\*/, name: 'markdown emphasis "**"' },
  { re: /__/, name: 'markdown emphasis "__"' },
];

/** A-11: forbidden markup in an AI-written plain-text field. Returns problems (empty = plain). */
export function plainTextProblems(label: string, text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const problems: string[] = [];
  if (text.includes('<') || text.includes('>')) problems.push(`${label} contains "<" or ">" (expected plain text, no markup)`);
  if (text.includes('`')) problems.push(`${label} contains a backtick (expected plain text)`);
  if (CONTROL_CHARS.test(text)) problems.push(`${label} contains control characters (expected plain text)`);
  if (URL_PATTERN.test(text)) problems.push(`${label} contains a URL (expected plain text)`);
  for (const { re, name } of MARKDOWN_PATTERNS) {
    if (re.test(text)) problems.push(`${label} contains ${name} (expected plain text)`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Structural field helpers                                            */
/* ------------------------------------------------------------------ */

export function idProblems(label: string, id: unknown): string[] {
  if (typeof id !== 'string' || !KIT_ID_PATTERN.test(id)) {
    return [`${label} is ${JSON.stringify(id)}, expected a lowercase-kebab id matching ${KIT_ID_PATTERN.source}`];
  }
  return [];
}

export function lengthProblems(label: string, text: unknown, min: number, max: number): string[] {
  if (typeof text !== 'string') return [`${label} is ${JSON.stringify(text)}, expected a string of ${min}-${max} characters`];
  if (text.length < min || text.length > max) {
    return [`${label} is ${text.length} characters, expected ${min}-${max}`];
  }
  return [];
}

/** '' or min..max characters (hint/orderNote-style optional fields). */
export function optionalLengthProblems(label: string, text: unknown, min: number, max: number): string[] {
  if (text === '') return [];
  return lengthProblems(label, text, min, max);
}

export function duplicateOccurrences(values: string[]): Set<string> {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) {
    if (seen.has(v)) dups.add(v);
    seen.add(v);
  }
  return dups;
}

/* ------------------------------------------------------------------ */
/* OV-06 content-word overlap                                          */
/* ------------------------------------------------------------------ */

/** The frozen OV-06 stoplist (design §2.1d). */
export const OVERLAP_STOPLIST = new Set(['this', 'that', 'with', 'from', 'have', 'are', 'was', 'will', 'when', 'which']);

/** Distinct content words of a string: alphabetic, >= 4 letters, not stoplisted, lowercased. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length >= 4 && !OVERLAP_STOPLIST.has(raw)) out.add(raw);
  }
  return out;
}

export function sharedContentWords(a: string, b: string): string[] {
  const wa = contentWords(a);
  const out: string[] = [];
  for (const w of contentWords(b)) if (wa.has(w)) out.push(w);
  return [...new Set(out)].sort();
}

/* ------------------------------------------------------------------ */
/* Report assembly + prune scaffolding                                 */
/* ------------------------------------------------------------------ */

/** The exact component-level failure strings frozen in the design (§2.2-§3 f). */
export const KIT_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  'quiz-cards-v1': 'Quiz cards could not be verified against the page.',
  'sequence-v1': 'Steps could not be ordered from the page wording.',
  'sort-groups-v1': 'Group membership could not be verified against the page.',
  'concept-map-v1': 'Connections could not be verified against the page.',
  'compare-table-v1': 'Comparison could not be verified against the page.',
  'formula-explorer-v1': 'The formula could not be checked with our calculator.',
  'balance-equation-v1': 'The reaction equation could not be verified against the page.',
  'overview-v1': 'The page overview could not be verified against the page.',
};

export function buildReport(artifactId: string, checks: ValidationCheck[], revision = 1): ValidationReport {
  return { artifactId, revision, checks, publishable: checks.every(c => c.passed) };
}

/**
 * Indices of list items named by a report's failing checks' affected paths under `listPath`
 * (e.g. '/cards'). Used by the prune helpers to find item-scoped failures.
 */
export function itemIndicesWithFailures(report: ValidationReport, listPath: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const prefix = listPath.replace(/\/$/, '') + '/';
  for (const check of report.checks) {
    if (check.passed || !Array.isArray(check.affected)) continue;
    for (const p of check.affected) {
      if (typeof p !== 'string' || !p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const idx = Number(rest.split('/')[0]);
      if (!Number.isInteger(idx) || idx < 0) continue;
      const list = out.get(idx) ?? [];
      if (!list.includes(check.id)) list.push(check.id);
      out.set(idx, list);
    }
  }
  return out;
}

/** True when every failing check of a report names at least one item under `listPath`. */
export function failuresAreItemScoped(report: ValidationReport, listPath: string, allow: string[]): boolean {
  const allowed = new Set(allow);
  for (const check of report.checks) {
    if (check.passed) continue;
    if (!allowed.has(check.id)) return false;
  }
  return true;
}

export { normalizeWhitespace, quoteCountsAsEvidence, truncate };
