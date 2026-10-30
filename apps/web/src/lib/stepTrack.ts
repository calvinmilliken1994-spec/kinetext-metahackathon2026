// Step track for sequence-v1 (pure): station positions along a line and, after a check, which steps the learner placed right.

/** x of n evenly spaced stations between `inset` and `width - inset` (a single station sits in the middle). */
export function stationXs(n: number, width: number, inset: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [width / 2];
  const span = width - 2 * inset;
  return Array.from({ length: n }, (_, i) => Math.round((inset + (span * i) / (n - 1)) * 1000) / 1000);
}

/** Step id -> true when the learner's list had that step in its right place (positions are aligned to the learner's list). */
export function stationResults(grade: { positions: readonly boolean[] }, order: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(order.map((id, i) => [id, grade.positions[i] === true]));
}

// ---- a date stated in a step's quote ------------------------------------------------------------------------------

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const ERA = '(?: (?:BCE|BC|CE|AD))';
/** Supported forms, each a whole-token match in the quote; longer forms win where they overlap. */
const DATE_FORMS: RegExp[] = [
  new RegExp(`\\b${MONTH} \\d{1,2}, \\d{3,4}${ERA}?(?![\\w])`, 'g'), // May 14, 1787
  new RegExp(`\\b\\d{1,2} ${MONTH} \\d{3,4}${ERA}?(?![\\w])`, 'g'), // 4 July 1776
  new RegExp(`\\b${MONTH} \\d{3,4}${ERA}?(?![\\w])`, 'g'), // April 1803
  new RegExp(`\\b${MONTH} \\d{1,2}(?![\\w,]|,\\s?\\d)`, 'g'), // May 25 (no year stated)
  // in 1803, in 500 BCE — not 'of 2000 miles' or 'in 1500 square miles' (a number followed by a unit is an amount)
  new RegExp(`(?<=\\b(?:[Ii]n|[Ss]ince|[Uu]ntil|[Yy]ear) )(?:\\d{4}|\\d{1,4}${ERA})(?![\\w,.]\\d|[\\w%]| (?:square|miles?|km|kilomet|feet|foot|acres?|people|men|troops|soldiers|dollars|years?|tons?|pounds?)\\b)`, 'g'),
];

const BOUND_BEFORE = /\b(after|before|by|until|not until|since|as of|around|about|circa|c\.|early|late|from|between)\s+$/i;

/**
 * The one date a step's quote states, exactly as written there ('May 14, 1787', 'May 25', 'April 1803', '1803'), or null
 * when the quote states none, or more than one different date (then it is not clear which belongs to the step). Nothing
 * is completed from other steps: 'May 25' stays 'May 25', and a bound before the date is kept ('After January 1, 1863'). Month names must be capitalised, so 'may' is never a month.
 */
export function quoteDate(quote: string): string | null {
  const found: { start: number; end: number; text: string }[] = [];
  for (const re of DATE_FORMS) {
    re.lastIndex = 0;
    for (const m of quote.matchAll(re)) found.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] });
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: typeof found = [];
  for (const f of found) {
    const last = kept[kept.length - 1];
    if (last !== undefined && f.start < last.end) continue; // inside a longer match
    kept.push(f);
  }
  // a bound or hedge right before the date belongs to it ('After January 1, 1863' is not the same claim as the date)
  const withBound = kept.map((k) => {
    const m = BOUND_BEFORE.exec(quote.slice(Math.max(0, k.start - 24), k.start));
    return m === null ? k.text : `${m[1] as string} ${k.text}`;
  });
  const distinct = [...new Set(withBound)];
  return distinct.length === 1 ? (distinct[0] as string) : null;
}
