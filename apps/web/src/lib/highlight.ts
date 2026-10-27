// Pure helpers that map evidence quotes onto the ORIGINAL source text.
//
// The validator (packages/validation/validate.ts) proves a quote is grounded by checking
//   normalizeWhitespace(sourceText).includes(normalizeWhitespace(quote))
// with normalizeWhitespace(s) = s.replace(/\s+/g, ' ').trim(). We use exactly the same
// normalisation, but keep an index map so the match can be drawn on the unmodified text.

/** Same normalisation as the validator: collapse every whitespace run to one space, then trim. */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface NormalizedText {
  /** Equal to normalizeWhitespace(original). */
  norm: string;
  /** starts[i] = index in the original text where normalised char i begins. */
  starts: number[];
  /** ends[i] = exclusive index in the original text where normalised char i ends. */
  ends: number[];
}

const WS = /\s/;

/** Normalise `text` like normalizeWhitespace() while remembering where each char came from. */
export function normalizeWithMap(text: string): NormalizedText {
  const starts: number[] = [];
  const ends: number[] = [];
  let norm = '';
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (WS.test(text.charAt(i))) {
      let j = i;
      while (j < n && WS.test(text.charAt(j))) j++;
      // Leading and trailing whitespace is trimmed; interior runs become one space.
      if (norm.length > 0 && j < n) {
        norm += ' ';
        starts.push(i);
        ends.push(j);
      }
      i = j;
    } else {
      norm += text.charAt(i);
      starts.push(i);
      ends.push(i + 1);
      i++;
    }
  }
  return { norm, starts, ends };
}

export interface CharRange { start: number; end: number }

/** First occurrence of `quote` in the original text, as a [start, end) range of ORIGINAL indices. */
export function findQuoteRange(source: string | NormalizedText, quote: string): CharRange | null {
  const nt = typeof source === 'string' ? normalizeWithMap(source) : source;
  const q = normalizeWhitespace(quote);
  if (q === '') return null;
  const idx = nt.norm.indexOf(q);
  if (idx < 0) return null;
  const start = nt.starts[idx];
  const end = nt.ends[idx + q.length - 1];
  if (start === undefined || end === undefined) return null;
  return { start, end };
}

export interface QuoteInput { key: string; quote: string }

export interface Segment {
  start: number;
  end: number;
  /** Keys of every quote covering this segment (empty = plain, un-highlighted text). */
  keys: string[];
}

export interface HighlightResult {
  /** Contiguous, non-overlapping segments that exactly tile the original text. */
  segments: Segment[];
  /** Range found for each key. */
  ranges: Record<string, CharRange>;
  /** Keys whose quote could not be located (should never happen for validated specs). */
  missing: string[];
}

/**
 * Split `text` into segments so each evidence quote can be rendered as a <mark>.
 * Duplicate quotes share one range; overlapping quotes produce segments that carry several keys.
 * Only the first occurrence of each quote is highlighted.
 */
export function buildHighlights(text: string, quotes: readonly QuoteInput[]): HighlightResult {
  const nt = normalizeWithMap(text);
  const ranges: Record<string, CharRange> = {};
  const missing: string[] = [];
  for (const q of quotes) {
    const r = findQuoteRange(nt, q.quote);
    if (r === null) missing.push(q.key);
    else ranges[q.key] = r;
  }
  const bounds = new Set<number>([0, text.length]);
  for (const r of Object.values(ranges)) {
    bounds.add(r.start);
    bounds.add(r.end);
  }
  const sorted = [...bounds].filter((b) => b >= 0 && b <= text.length).sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i] as number;
    const b = sorted[i + 1] as number;
    const keys: string[] = [];
    for (const q of quotes) {
      const r = ranges[q.key];
      if (r !== undefined && r.start <= a && r.end >= b) keys.push(q.key);
    }
    segments.push({ start: a, end: b, keys });
  }
  return { segments, ranges, missing };
}
