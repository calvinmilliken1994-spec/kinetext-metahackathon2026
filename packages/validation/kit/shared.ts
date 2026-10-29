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
 * N-01: every number in an AI-written string must appear (as a whole numeric token) in the
 * cited page — or, for fields with no sourceId of their own, in ANY provided page. Returns one
 * plain-language problem per ungrounded number.
 */
export function numbersCheckProblems(label: string, text: unknown, searchTexts: (string | undefined)[]): string[] {
  if (typeof text !== 'string') return [];
  const texts = searchTexts.filter((t): t is string => typeof t === 'string');
  const problems: string[] = [];
  for (const token of [...new Set(numericTokens(text))]) {
    if (!texts.some(t => numberOccursIn(token, t))) {
      problems.push(`${label} states the number ${token}, which does not appear on the page or in the same quote (N-01)`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* A-09 / OV-03 publisher-claim tokens                                 */
/* ------------------------------------------------------------------ */

/** The frozen generic phrases (design §1.6 A-09): matched word-boundary, case-insensitive. */
export const GENERIC_PUBLISHER_PHRASES = ['according to', 'as stated by', 'official', 'endorsed'] as const;

/**
 * Words that only ever appear inside publisher names in this corpus and would false-reject
 * ordinary teaching text as single tokens ("research", "center", "national", ...). They still
 * match inside the full publisher phrase.
 */
export const COMMON_PUBLISHER_WORDS = new Set([
  'national', 'institute', 'institutes', 'archives', 'records', 'administration', 'research',
  'center', 'centre', 'consumer', 'financial', 'protection', 'bureau', 'justice', 'department',
  'office', 'agency', 'commission', 'committee', 'association', 'organization', 'organisation',
  'society', 'council', 'service', 'services', 'federal', 'united', 'states', 'state',
  'government', 'university', 'college', 'school', 'press', 'publishing', 'publications',
  'library', 'museum', 'foundation', 'corporation', 'company', 'international', 'american',
  'guide', 'guides', 'beginners', 'material', 'source', 'sources', 'teacher', 'teachers',
  'provided', 'pasted', 'text', 'page', 'pages', 'notes', 'project', 'authored', 'synthetic',
  'document', 'documents', 'introduction', 'background', 'family', 'personal', 'website',
]);

/** Acronym-like all-caps tokens that are not publisher names (roman numerals, locale marks). */
const ACRONYM_EXCLUDE = new Set(['US', 'USA', 'II', 'III', 'IV', 'VI', 'IX', 'XI', 'AI', 'UK', 'UN', 'AM', 'PM', 'ET']);

export interface PublisherTokens {
  /** Lowercased full publisher phrases (>= 2 words), matched as substrings of normalised text. */
  phrases: string[];
  /** Lowercased distinctive single words from the publisher phrase, matched word-boundary. */
  singles: Set<string>;
  /** Lowercased all-caps acronyms from the attribution metadata, matched word-boundary. */
  acronyms: Set<string>;
}

/**
 * Extract the publisher-claim token set from a source document's own metadata (title and
 * attribution only — the source TEXT is the subject matter, not a publisher claim). The
 * publisher phrase is the first comma-separated segment after "Source material:" in the
 * attribution, plus the first comma-separated segment after the dash in the title.
 */
export function publisherTokensOf(doc: Pick<SourceDocument, 'title' | 'attribution'>): PublisherTokens {
  const tokens: PublisherTokens = { phrases: [], singles: new Set(), acronyms: new Set() };
  const addPhrase = (phrase: string | undefined, withSingles: boolean): void => {
    if (phrase === undefined) return;
    const norm = normalizeWhitespace(phrase).replace(/[.,;:]+$/, '');
    if (norm === '') return;
    const words = norm.split(/\s+/).filter(w => /^[A-Za-z'][A-Za-z'-]*$/.test(w));
    if (words.length >= 2) tokens.phrases.push(norm.toLowerCase());
    if (!withSingles) return;
    for (const w of words) {
      const clean = w.replace(/[^A-Za-z]/g, '').toLowerCase();
      if (clean.length >= 4 && !COMMON_PUBLISHER_WORDS.has(clean) && !ACRONYM_EXCLUDE.has(clean.toUpperCase())) {
        tokens.singles.add(clean);
      }
    }
  };
  const attribution = typeof doc.attribution === 'string' ? doc.attribution : '';
  const title = typeof doc.title === 'string' ? doc.title : '';
  // Project convention for licensed sources: "Source material: <publisher>, <work>. ..." — only
  // this segment yields distinctive single-word tokens. Attributions without the marker (e.g.
  // teacher-pasted sources) match as full phrases only, so ordinary metadata words like
  // "teacher" or "provided" can never false-reject ordinary teaching text.
  const sourceMaterial = /Source material:\s*([^.]*\.)/i.exec(attribution)?.[1] ?? /Source material:\s*([^.]*)/i.exec(attribution)?.[1];
  if (sourceMaterial !== undefined) {
    addPhrase(sourceMaterial.split(',')[0], true);
  } else {
    addPhrase(attribution.split(/[.,;]/)[0], false);
  }
  // Title publisher part: text after an em/en dash, first comma segment.
  const titleParts = title.split(/\s+[—–]\s+/);
  if (titleParts.length >= 2) addPhrase((titleParts[titleParts.length - 1] as string).split(',')[0], true);
  for (const m of attribution.matchAll(/\b[A-Z]{2,}\b/g)) {
    const acr = m[0];
    if (!ACRONYM_EXCLUDE.has(acr)) tokens.acronyms.add(acr.toLowerCase());
  }
  return tokens;
}

export function mergePublisherTokens(list: PublisherTokens[]): PublisherTokens {
  const out: PublisherTokens = { phrases: [], singles: new Set(), acronyms: new Set() };
  for (const t of list) {
    for (const p of t.phrases) if (!out.phrases.includes(p)) out.phrases.push(p);
    for (const s of t.singles) out.singles.add(s);
    for (const a of t.acronyms) out.acronyms.add(a);
  }
  return out;
}

/**
 * The publisher-claim hit in an AI-written string, or null. Matches the frozen generic phrases
 * (according to | as stated by | official | endorsed), any publisher phrase from the sources'
 * own metadata, its distinctive single words and its acronyms (NASA, NIJ, ...).
 */
export function findPublisherClaim(text: unknown, tokens: PublisherTokens): string | null {
  if (typeof text !== 'string' || text === '') return null;
  const norm = normalizeWhitespace(text);
  const lower = norm.toLowerCase();
  for (const phrase of GENERIC_PUBLISHER_PHRASES) {
    if (new RegExp(`\\b${phrase}\\b`, 'i').test(norm)) return phrase;
  }
  for (const phrase of tokens.phrases) {
    if (lower.includes(phrase)) return phrase;
  }
  for (const single of tokens.singles) {
    if (new RegExp(`\\b${escapeRegExp(single)}\\b`, 'i').test(norm)) return single;
  }
  for (const acr of tokens.acronyms) {
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
