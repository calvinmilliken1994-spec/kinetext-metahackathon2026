// TASK-020 — timeline-v1 deterministic validation (Stage 5b plan 'Revised checks' + Muse design
// review dispositions #1–#10 and the lead's title-year decision of 2026-10-28), hardened by the
// Stage 5b review round 1 (S5B-01..S5B-04, frozen design decisions 1–4 in docs/specs/STAGE-5b-plan.md).
//
// A timeline has no formula, so the SOURCE TEXT is the deterministic oracle:
//   date-grounded   every event's full stated date (year, and month/day where stated) must be
//                 stated by ONE CONNECTED DATE EXPRESSION (S5B-01, decision 3) inside one sentence
//                 unit of a counted, verbatim evidence quote: 'Month D[, ]YYYY', 'D Month YYYY',
//                 'Month [of] YYYY', 'Month D', 'YYYY', BCE forms and year-range endpoints. A day
//                 counts ONLY inside a month-day expression ('4 delegates' is never day 4) and a
//                 claimed component never combines across expressions ('March 3 ... July 4' never
//                 states March 4). The year may instead come from the source title, but only when
//                 the title is clean (S5B-02, decision 4: no approximation/range/ambiguity marker),
//                 states exactly one standalone year, the event's year equals it, ONE expression
//                 states the month (and day if claimed) without a year of its own, and the unit
//                 contains no year-like token. No other cross-sentence inheritance.
//   approximate     decade forms ("1770s") and "circa/c./ca./around/about/early/mid/late" before a
//                 year or month fire FIRST with "approximate date — remove this event"; a decade
//                 form never counts as a standalone year. S5B-02 (decision 4): the detector also
//                 runs over the FULL SOURCE SENTENCE/HEADING UNIT(S) containing each verbatim quote
//                 (a trimmed quote can never leave its 'around' qualifier behind), and a quote that
//                 occurs more than once with different qualifier contexts fails closed.
//   distinct-dates  no two events share a (year, month, day) tuple (no same-quote exception, #7).
//   case-order      every test/prediction answer is recomputed: earlierEventId must be strictly
//                 earlier at the precision BOTH events state; equal precision-truncations are
//                 ambiguous, never graded by array position (#5).
// Year matching (Muse #1, #4): grouped numbers ("1,000") are masked first; a standalone year is a
// 1–4 digit number ((^|[^0-9])YEAR($|[^0-9]) semantics via lookarounds), so ranges ground only
// their endpoints; a BCE marker ("BCE", "BC", "B.C.", "B.C.E.") directly after the number makes it
// negative and forbids the positive reading. Month names come from a fixed case-insensitive list
// incl. "Sep(t)?(ember)?" with an optional period (#9); a day is \b0?DAY(st|nd|rd|th)?\b and is
// ONLY parsed as part of a month-day expression (#2, #3, S5B-01).
//
// S5B-03 (decision 1/2): every failing timeline check (and the shared policy/grounding checks)
// emits validator-owned `affected` JSON-pointer field paths, one per offending field occurrence,
// and compareTimelineRevisions authorizes repairs ONLY from those paths — never from substring
// searches over rendered finding messages. Field scoping: a label/name/id/policy finding unlocks
// that string only (dates, evidence and pairs stay frozen; a renamed case keeps its pair); only a
// date-grounding failure (timeline.date-grounded / timeline.approximate-date /
// timeline.distinct-dates, or a recomputed grounding failure) unlocks that event's date+evidence
// (or its removal); only timeline.case-order (or a recomputed wrong/ambiguous pair) unlocks that
// case's pair.
//
// validateSpec()/compareRevisions() in ./validate.ts dispatch here when simulation.engine ===
// 'timeline-v1'. timeline-v1 is deliberately NOT in ENGINE_IDS yet (contracts stay frozen until the
// whole pipeline supports sequence engines). Nothing here throws: malformed input degrades into
// failed checks, exactly like the numeric path.

import { Ajv } from 'ajv';
import type { AnySchemaObject, ValidateFunction } from 'ajv';

import type {
  CheckKind,
  Explanation,
  RepairFinding,
  SourceDocument,
  SourceRef,
  TimelineEvent,
  ValidationCheck,
  ValidationReport,
} from '../contracts/index.ts';
import { timelineFullSchema } from '../contracts/schemas.ts';
import { sha256 } from '../sources/index.ts';
import {
  COMPARISON_MESSAGE_LIMIT,
  COMPARISON_PROBLEM_LIMIT,
  QUOTE_EQUATION_MIN_NORMALIZED_CHARS,
  QUOTE_MESSAGE_LIMIT,
  QUOTE_MIN_LETTER_DIGITS,
  QUOTE_MIN_NORMALIZED_CHARS,
  duplicates,
  errMsg,
  guarded,
  hasPublisherAttribution,
  renameableKey,
  schemaAffectedPaths,
  VALID_CASE_ID,
  indexSources,
  normalizeWhitespace,
  quoteCountsAsEvidence,
  schemaFailureMessage,
  truncate,
} from './validate.ts';
import type { TextLookup } from './validate.ts';

const timelineAjv = new Ajv({ allErrors: true });
const timelineSchemaValidate: ValidateFunction = timelineAjv.compile(timelineFullSchema as AnySchemaObject);

const TIMELINE_ENGINE_ID = 'timeline-v1';
/** SequenceDescriptor events.min — a repair may never drop below it. */
const MIN_EVENTS = 5;
/**
 * S5B-03 (frozen decision 2): the date-class finding ids. ONLY these (or a recomputed grounding
 * failure) unlock an event's date+evidence (or its removal); every other finding unlocks exactly
 * its affected fields. Authorization comes from validator-owned `affected` paths, never from
 * substring searches over finding messages.
 */
const DATE_CLASS_IDS = new Set(['timeline.approximate-date', 'timeline.date-grounded', 'timeline.distinct-dates']);
/** The four event fields a date-class finding unlocks (decision 2: 'that event's date+evidence'). */
const EVENT_DATE_FIELDS = ['year', 'month', 'day', 'evidence'] as const;
/** The affected paths of one offending event for a date-class finding. */
function eventDateAffected(index: number): string[] {
  return EVENT_DATE_FIELDS.map(f => `/simulation/events/${index}/${f}`);
}

/* ------------------------------------------------------------------ */
/* Sentence units (contract item 1)                                    */
/* ------------------------------------------------------------------ */

const ABBREV_MASK = '\u0001';
/** Era abbreviations never split units; a month abbreviation's period only survives before a number ("Sept. 4"). */
const ABBREV_PERIOD = /\b(?:B\.C\.E\.|B\.C\.|A\.D\.|B\.C\.E|B\.C|A\.D)(?![A-Za-z])|\b(?:jan|feb|mar|apr|aug|sep|sept|oct|nov|dec)\.(?=\s?[0-9])/gi;
const SENTENCE_SPLIT = /(?<=[.!?;])\s+/;
/** Global variant of SENTENCE_SPLIT for scanning split points with matchAll (S5B-02 source units). */
const SENTENCE_SPLIT_G = /(?<=[.!?;])\s+/g;

function maskAbbrevPeriods(s: string): string {
  return s.replace(ABBREV_PERIOD, m => m.replace(/\./g, ABBREV_MASK));
}

/**
 * Split a quote into sentence units: split on [.!?;] followed by whitespace/end and on newlines;
 * a '#' heading line is ONE unit (Muse #8); "B.C."/"A.D."/"B.C.E." and month abbreviations never
 * split. Units keep their trailing punctuation; empty units are dropped.
 */
export function sentenceUnits(quote: string): string[] {
  if (typeof quote !== 'string') return [];
  const units: string[] = [];
  for (const rawLine of quote.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      units.push(line);
      continue;
    }
    for (const part of maskAbbrevPeriods(line).split(SENTENCE_SPLIT)) {
      const unit = part.replaceAll(ABBREV_MASK, '.').trim();
      if (unit !== '') units.push(unit);
    }
  }
  return units;
}

/* ------------------------------------------------------------------ */
/* Year/month/day matching on a unit (contract item 2)                 */
/* ------------------------------------------------------------------ */

const GROUPED_NUMBER = /\d{1,3}(?:,\d{3})+(?![,\d])/g;
const NUMBER_MASK = '\u0002';
/** A BCE marker directly after a number (Muse #4): "500 BCE", "500 BC", "500 B.C.", "500 B.C.E.". */
const BCE_MARKER = /^\s*(?:b\.?\s?c\.?\s?e?\.?|bce)(?![a-z])/i;
/** The BCE suffix as an inline pattern fragment (must directly follow the digits, whitespace allowed). */
const BCE_PAT = '(?:\\s*(?:b\\.?\\s?c\\.?\\s?e?\\.?|bce)(?![a-z]))';

/** Muse #9: the fixed month list, case-insensitive, period optional, word boundaries. */
const MONTH_SOURCES = [
  'jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'jun(?:e)?',
  'jul(?:y)?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?',
];
const MONTH_ALT = `(?:${MONTH_SOURCES.join('|')})`;
/** A month name with word boundaries and an optional trailing period ("Sept.", "dec"). */
const MONTH_PAT = `\\b${MONTH_ALT}\\b\\.?`;
/** A day number with an optional ordinal suffix and digit boundaries ("4", "04", "19th"). */
const DAY_PAT = '(?<![0-9])(?:0?[1-9]|[12][0-9]|3[01])(?:st|nd|rd|th)?(?![0-9])';
/**
 * A standalone 1–4 digit year core: digit boundaries on both sides and never a decade form
 * ("1770s" — an 's' directly after the digits that is not itself followed by a letter).
 */
const YEAR_CORE = '(?<![0-9])[0-9]{1,4}(?![0-9])(?!s(?![a-z]))';
/** A 3–4 digit year core (never a day number) — used where no day precedes/follows. */
const YEAR34_CORE = '(?<![0-9])[0-9]{3,4}(?![0-9])(?!s(?![a-z]))';
/** The year slot of a Month-Day[-Year] / Day-Month[-Year] expression: any standalone year, BCE allowed. */
const YEAR_MDY = `(?:${YEAR_CORE}${BCE_PAT}?)`;
/**
 * The year slot of a Month[-of] Year expression: 3–4 digits, or any digits WITH a BCE marker.
 * A bare 1–2 digit number after a month name is a DAY ("April 14"), never a year.
 */
const YEAR_MY = `(?:(?<![0-9])[0-9]{1,4}(?![0-9])${BCE_PAT}|${YEAR34_CORE})`;

/**
 * S5B-01 (frozen decision 3): ONE connected date expression. Alternation order matters — the
 * longest forms are listed first and the global scan consumes each match, so "March 3, 1889" is
 * ONE expression (never month-day + standalone year) and "April 14" is a month-day, not a
 * month-year with year 14.
 */
const DATE_EXPRESSION_RE = new RegExp(
  [
    // Month D[ay-suffix][, ]YYYY[ BCE]  — "March 3, 1889", "Sept. 4, 1776", "July 19th 1776"
    `(?<mdyM>${MONTH_PAT})\\s+(?<mdyD>${DAY_PAT})(?:(?:,?\\s+|,\\s*)(?<mdyY>${YEAR_MDY}))?`,
    // D[ay-suffix] [of ]Month[, ]YYYY[ BCE] — "25 December 1776", "4th of July 1776"
    `(?<dmyD>${DAY_PAT})\\s+(?:of\\s+)?(?<dmyM>${MONTH_PAT})(?:(?:,?\\s+|,\\s*)(?<dmyY>${YEAR_MDY}))?`,
    // Month[,] [of ]YYYY[ BCE] — "July 1776", "September of 1776", "November of 1777"
    `(?<myM>${MONTH_PAT})\\s*(?:,\\s*|\\s+)(?:of\\s+)?(?<myY>${YEAR_MY})`,
    // YYYY[-–—/]YYYY — a year range grounds exactly its two endpoints
    `(?<rngA>${YEAR34_CORE})\\s*[-\u2013\u2014/]\\s*(?<rngB>${YEAR34_CORE})`,
    // Month D[ay-suffix] (no year) — "June 10", "on July 19th", "April 14"
    `(?<mdM>${MONTH_PAT})\\s+(?<mdD>${DAY_PAT})`,
    // D[ay-suffix] [of ]Month (no year) — "25 December", "the 10th of June"
    `(?<dmD>${DAY_PAT})\\s+(?:of\\s+)?(?<dmM>${MONTH_PAT})`,
    // YYYY[ BCE] — a standalone year ("in 1855", "500 B.C.", "A.D. 79")
    `(?<yY>${YEAR_CORE})(?<yBCE>${BCE_PAT})?`,
    // Month (bare month name) — "in June of the signing year"
    `(?<mM>${MONTH_PAT})`,
  ].join('|'),
  'gi',
);

/**
 * One CONNECTED date expression parsed out of a sentence unit (S5B-01, frozen decision 3).
 * A claimed date is grounded only when ONE expression states every claimed component; components
 * never combine across expressions, and a day exists only inside a month-day expression.
 */
export interface DateExpression {
  /** Signed year as stated (negative exactly under a BCE marker); null when the expression states no year. */
  year: number | null;
  /** Digit length of the year as written (0 when absent); a year is year-LIKE at >= 3 digits or under BCE. */
  digits: number;
  bce: boolean;
  /** 1–12, null when the expression states no month. */
  month: number | null;
  /** 1–31, null when the expression states no day (a day is ONLY parsed inside a month-day expression). */
  day: number | null;
  /** The matched text (from the original, unmasked unit). */
  text: string;
}

function monthNumberOf(monthText: string): number | null {
  for (let m = 1; m <= MONTH_SOURCES.length; m++) {
    const src = MONTH_SOURCES[m - 1];
    if (src !== undefined && new RegExp(`^${src}$`, 'i').test(monthText.replace(/\.$/, ''))) return m;
  }
  return null;
}

function yearOf(yearText: string | undefined): { year: number; digits: number; bce: boolean } | null {
  if (yearText === undefined) return null;
  const digits = /[0-9]{1,4}/.exec(yearText)?.[0];
  if (digits === undefined) return null;
  const bce = BCE_MARKER.test(yearText.slice(digits.length));
  const value = Number(digits);
  return { year: bce ? -value : value, digits: digits.length, bce };
}

/**
 * Every connected date expression in a unit, left to right, non-overlapping (S5B-01). Grouped
 * numbers ("1,000") are masked first with a length-preserving mask so spans stay aligned.
 */
export function parseDateExpressions(unit: string): DateExpression[] {
  if (typeof unit !== 'string') return [];
  const masked = unit.replace(GROUPED_NUMBER, m => NUMBER_MASK.repeat(m.length));
  const exprs: DateExpression[] = [];
  const push = (
    m: RegExpExecArray | RegExpMatchArray,
    year: { year: number; digits: number; bce: boolean } | null,
    month: number | null,
    day: number | null,
  ): void => {
    const start = m.index ?? 0;
    exprs.push({
      year: year?.year ?? null,
      digits: year?.digits ?? 0,
      bce: year?.bce ?? false,
      month,
      day,
      text: unit.slice(start, start + m[0].length),
    });
  };
  for (const m of masked.matchAll(DATE_EXPRESSION_RE)) {
    const g = m.groups ?? {};
    if (g.mdyM !== undefined) {
      push(m, yearOf(g.mdyY), monthNumberOf(g.mdyM), Number(g.mdyD?.replace(/(?:st|nd|rd|th)$/i, '')));
    } else if (g.dmyD !== undefined) {
      push(m, yearOf(g.dmyY), monthNumberOf(g.dmyM), Number(g.dmyD.replace(/(?:st|nd|rd|th)$/i, '')));
    } else if (g.myM !== undefined) {
      push(m, yearOf(g.myY), monthNumberOf(g.myM), null);
    } else if (g.rngA !== undefined && g.rngB !== undefined) {
      // A range grounds exactly its two endpoints, as two standalone year expressions (#ranges).
      push(m, yearOf(g.rngA), null, null);
      const yb = yearOf(g.rngB);
      if (yb !== null) {
        exprs.push({ year: yb.year, digits: yb.digits, bce: yb.bce, month: null, day: null, text: g.rngB });
      }
    } else if (g.mdM !== undefined) {
      push(m, null, monthNumberOf(g.mdM), Number(g.mdD?.replace(/(?:st|nd|rd|th)$/i, '')));
    } else if (g.dmD !== undefined) {
      push(m, null, monthNumberOf(g.dmM), Number(g.dmD.replace(/(?:st|nd|rd|th)$/i, '')));
    } else if (g.yY !== undefined) {
      push(m, yearOf(m[0]), null, null);
    } else if (g.mM !== undefined) {
      push(m, null, monthNumberOf(g.mM), null);
    }
  }
  return exprs;
}

export interface YearToken {
  /** The year as stated, signed: negative exactly when a BCE marker follows the number. */
  signed: number;
  /** Digit length as written (leading zeros included). */
  digits: number;
  bce: boolean;
}

/** Every standalone year a unit states, as expression-derived tokens (S5B-01: never a token bag). */
function yearTokens(unit: string): YearToken[] {
  return parseDateExpressions(unit)
    .filter(e => e.year !== null)
    .map(e => ({ signed: e.year as number, digits: e.digits, bce: e.bce }));
}

/** The signed standalone years a unit states (ranges contribute both endpoints, nothing between). */
export function standaloneYears(unit: string): number[] {
  return yearTokens(unit).map(t => t.signed);
}

/**
 * A year-LIKE token for the title-year rule: a standalone 3–4 digit number, or any standalone
 * number with a BCE marker. Day numbers ("June 10") are deliberately NOT year-like, otherwise the
 * title-year rule could never apply to a dated sentence.
 */
function containsYearLike(unit: string): boolean {
  return yearTokens(unit).some(t => t.digits >= 3 || t.bce);
}

export interface TimelineDateTuple { year: number; month: number; day: number }

/**
 * True when ONE connected date expression of the unit states the full claimed date (S5B-01,
 * frozen decision 3): the year — or, via the title-year rule, the title's single year when ONE
 * year-less expression states the month (and day if claimed) and the unit contains no year-like
 * token of its own. Components from different expressions never combine.
 */
export function unitGroundsDate(unit: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  const exprs = parseDateExpressions(unit);
  const yearLike = exprs.some(e => e.year !== null && (e.digits >= 3 || e.bce));
  for (const e of exprs) {
    if (date.month !== 0) {
      if (e.month !== date.month) continue;
      if (date.day !== 0 && e.day !== date.day) continue;
      if (e.year !== null) {
        if (e.year === date.year) return true;
        continue;
      }
      // The expression states month (+day) without a year: the title-year rule may lend the year.
      if (titleYear !== null && date.year === titleYear && !yearLike) return true;
    } else if (date.day !== 0) {
      // A day claimed without a month needs one expression stating the day AND the year.
      if (e.day === date.day && e.year === date.year) return true;
    } else if (e.year === date.year) {
      return true;
    }
  }
  return false;
}

/** True when any sentence unit of the quote grounds the date (pure text; verbatim checked elsewhere). */
export function quoteGroundsDate(quote: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  return sentenceUnits(quote).some(unit => unitGroundsDate(unit, date, titleYear));
}

/**
 * S5B-02 (frozen decision 4): the title-year rule rejects any title candidate carrying an
 * approximation, range or ambiguity marker — 'circa', 'c.', 'ca.', 'around', 'about', a decade
 * form, a year range or '?'. A rejected title lends nothing (fail closed).
 */
const TITLE_APPROX_MARKER = /\b(?:circa|ca|around|about)\b|\bc\.|\?/i;
const TITLE_DECADE_FORM = /[0-9]{3,4}s(?![0-9a-z])/i;
const TITLE_YEAR_RANGE = /(?<![0-9])[0-9]{3,4}\s*[-\u2013\u2014/]\s*[0-9]{2,4}(?![0-9])/;

function titleCandidateRejected(candidate: string): boolean {
  return TITLE_APPROX_MARKER.test(candidate) || TITLE_DECADE_FORM.test(candidate) || TITLE_YEAR_RANGE.test(candidate);
}

/**
 * The lead's title-year rule: the source's title field (and its first text line when that is a '#'
 * heading) may lend its year to a date unit. Returns the year when EVERY available title candidate
 * is free of approximation/range/ambiguity markers (S5B-02), states exactly one standalone
 * year-like number and all candidates agree; otherwise null (a title with two years, a range, a
 * decade, a '?' or any 'circa/c./ca./around/about' wording grants nothing).
 */
export function titleYearOf(doc: { title?: unknown; text?: unknown } | null | undefined): number | null {
  const candidates: string[] = [];
  if (typeof doc?.title === 'string' && doc.title.trim() !== '') candidates.push(doc.title);
  if (typeof doc?.text === 'string') {
    const firstLine = doc.text.split(/\r?\n/, 1)[0]?.trim() ?? '';
    if (firstLine.startsWith('#')) candidates.push(firstLine.replace(/^#+\s*/, ''));
  }
  if (candidates.length === 0) return null;
  let shared: number | null | undefined;
  for (const candidate of candidates) {
    if (titleCandidateRejected(candidate)) return null; // S5B-02: an approximate/ambiguous title lends nothing
    const years = yearTokens(candidate).filter(t => t.digits >= 3 || t.bce);
    const value = years.length === 1 ? (years[0]?.signed ?? null) : null;
    if (shared === undefined) shared = value;
    else if (shared !== value) return null;
  }
  return shared ?? null;
}

/* ------------------------------------------------------------------ */
/* Approximate dates (contract item 3, Muse finding #10, S5B-02)       */
/* ------------------------------------------------------------------ */

const DECADE_FORM = /(?<![0-9])[0-9]{3,4}s(?![0-9a-z])/i;
const BCE_WORD = '(?:b\\.?\\s?c\\.?\\s?e?\\.?|bce)';
/** 3–4 standalone digits, any digits with a BCE marker, or a decade form. */
const YEAR_LIKE_FORM = `(?:(?<![0-9])[0-9]{3,4}(?![0-9])|(?<![0-9])[0-9]{1,4}\\s*${BCE_WORD}(?![a-z])|(?<![0-9])[0-9]{3,4}s(?![0-9a-z]))`;
const STRONG_APPROX = new RegExp(`\\b(?:circa|ca|c)\\.\\s*-?\\s*(?:(?<![0-9])[0-9]{1,4}(?![0-9])|${MONTH_ALT}\\b)`, 'i');
const CIRCA_WORD = new RegExp(`\\bcirca\\b\\s*-?\\s*(?:(?<![0-9])[0-9]{1,4}(?![0-9])|${MONTH_ALT}\\b)`, 'i');
const WEAK_APPROX = new RegExp(`\\b(?:around|about|early|mid|late)\\b\\.?\\s*-?\\s*(?:${YEAR_LIKE_FORM}|${MONTH_ALT}\\b)`, 'i');

/**
 * The matched approximate-date wording in a unit, or null. Fires on decade forms anywhere and on
 * circa/c./ca. (before any year or month) and around/about/early/mid/late (only directly before a
 * year-like number, decade or month name, so ordinary prose like "about 40 delegates" never fires).
 */
export function hasApproximateDate(unit: string): string | null {
  if (typeof unit !== 'string') return null;
  for (const re of [DECADE_FORM, STRONG_APPROX, CIRCA_WORD, WEAK_APPROX]) {
    const m = re.exec(unit);
    if (m !== null) return normalizeWhitespace(m[0]);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Source-context approximation (S5B-02, frozen decision 4)            */
/* ------------------------------------------------------------------ */

/** Whitespace-normalise `raw`, remembering which raw offset each normalised character came from. */
function normalizeWithMap(raw: string): { text: string; toRaw: number[] } {
  let text = '';
  const toRaw: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (/\s/.test(raw[i] as string)) {
      const runStart = i;
      while (i < raw.length && /\s/.test(raw[i] as string)) i++;
      // normalizeWhitespace() = replace(/\s+/g, ' ').trim(): an inner run becomes ONE space.
      if (text.length > 0 && i < raw.length) {
        text += ' ';
        toRaw.push(runStart);
      }
    } else {
      text += raw[i];
      toRaw.push(i);
      i++;
    }
  }
  return { text, toRaw };
}

/**
 * The sentence-unit spans of a RAW source text, with the same unit rules as sentenceUnits()
 * (a '#' heading line is one unit; [.!?;] + whitespace splits; month/era abbreviation periods
 * never split), but as [start, end) offsets into the raw text so a located quote can be mapped
 * back to the FULL source sentence/heading that contains it (S5B-02).
 */
function rawUnitSpans(raw: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const parts = raw.split(/(\r?\n)/);
  let pos = 0;
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi] as string;
    if (pi % 2 === 1) {
      pos += part.length; // the newline separator itself
      continue;
    }
    const lead = part.length - part.trimStart().length;
    const trimmed = part.trim();
    const lineStart = pos + lead;
    pos += part.length;
    if (trimmed === '') continue;
    if (trimmed.startsWith('#')) {
      spans.push({ start: lineStart, end: lineStart + trimmed.length });
      continue;
    }
    // maskAbbrevPeriods is length-preserving, so masked offsets are raw offsets.
    const masked = maskAbbrevPeriods(part.slice(lead));
    let cursor = 0;
    for (const sep of masked.matchAll(SENTENCE_SPLIT_G)) {
      spans.push({ start: lineStart + cursor, end: lineStart + (sep.index ?? cursor) });
      cursor = (sep.index ?? cursor) + sep[0].length;
    }
    spans.push({ start: lineStart + cursor, end: lineStart + masked.length });
  }
  return spans
    .map(s => {
      // Trim whitespace-only edges (units keep their trailing punctuation, never surrounding space).
      let { start, end } = s;
      while (start < end && /\s/.test(raw[start] as string)) start++;
      while (end > start && /\s/.test(raw[end - 1] as string)) end--;
      return { start, end };
    })
    .filter(s => s.end > s.start);
}

/** A cached per-source view: normalised text, the normalised→raw offset map and the raw unit spans. */
export interface SourceUnitIndex {
  norm: string;
  toRaw: number[];
  units: { start: number; end: number; text: string }[];
}

export function buildSourceUnitIndex(raw: string): SourceUnitIndex {
  const { text, toRaw } = normalizeWithMap(raw);
  const units = rawUnitSpans(raw).map(s => ({ ...s, text: normalizeWhitespace(raw.slice(s.start, s.end)) }));
  return { norm: text, toRaw, units };
}

/** The approximation context of one verbatim quote inside its source, or null when clean/unlocatable. */
export interface SourceQuoteContext {
  /** The first approximate-date wording found in any containing source unit. */
  marker: string;
  /** The containing source sentence/heading unit that states the marker (qualifier preserved). */
  unitText: string;
  /** How many times the quote occurs in the source. */
  occurrences: number;
  /** True when occurrences disagree on their qualifier context — always fails closed. */
  mixedContexts: boolean;
}

/**
 * S5B-02 (frozen decision 4): locate a quote in the source text (normalised exactly like
 * grounding.quotes does) and run the approximate-date detector over the FULL containing source
 * sentence/heading unit(s) of EVERY occurrence — a verbatim substring can never leave its
 * 'around/circa/...' qualifier behind. A quote occurring more than once with DIFFERENT qualifier
 * contexts fails closed (an occurrence is never cherry-picked for being conveniently unqualified).
 * Returns null when the quote is clean everywhere or cannot be located (non-verbatim quotes are
 * reported by grounding.quotes / timeline.date-grounded, not here).
 */
export function sourceQuoteApproximation(index: SourceUnitIndex, quote: string): SourceQuoteContext | null {
  const needle = normalizeWhitespace(quote);
  if (needle === '') return null;
  let clean = 0;
  let marker: string | null = null;
  let unitText = '';
  let occurrences = 0;
  let from = index.norm.indexOf(needle);
  while (from !== -1) {
    occurrences++;
    const to = from + needle.length - 1;
    const rawStart = index.toRaw[from] ?? 0;
    const rawEnd = (index.toRaw[to] ?? rawStart) + 1;
    let occurrenceMarker: string | null = null;
    for (const u of index.units) {
      if (u.start >= rawEnd || u.end <= rawStart) continue; // no overlap with this occurrence
      const m = hasApproximateDate(u.text);
      if (m !== null) {
        occurrenceMarker = m;
        unitText = u.text;
        break;
      }
    }
    if (occurrenceMarker === null) clean++;
    else if (marker === null) marker = occurrenceMarker;
    from = index.norm.indexOf(needle, from + 1);
  }
  if (occurrences === 0 || marker === null) return null;
  return { marker, unitText, occurrences, mixedContexts: clean > 0 };
}

/* ------------------------------------------------------------------ */
/* Ordering at shared precision (Muse finding #5)                      */
/* ------------------------------------------------------------------ */

function precisionOf(date: TimelineDateTuple): number {
  return date.day > 0 ? 2 : date.month > 0 ? 1 : 0;
}
const PRECISION_NAMES = ['year', 'year and month', 'year, month and day'];

/** Compare two stated dates truncated to the precision BOTH state. Never grades by array position. */
export function orderAtSharedPrecision(a: TimelineDateTuple, b: TimelineDateTuple): 'before' | 'equal' | 'after' {
  const p = Math.min(precisionOf(a), precisionOf(b));
  const ka = [a.year, p >= 1 ? a.month : 0, p >= 2 ? a.day : 0];
  const kb = [b.year, p >= 1 ? b.month : 0, p >= 2 ? b.day : 0];
  for (let i = 0; i < 3; i++) {
    if ((ka[i] ?? 0) < (kb[i] ?? 0)) return 'before';
    if ((ka[i] ?? 0) > (kb[i] ?? 0)) return 'after';
  }
  return 'equal';
}

/** '1776-06-10', '1855-06', '1855', '500 BCE' — states exactly the components the event states. */
export function formatTimelineDate(date: TimelineDateTuple): string {
  const year = date.year < 0 ? `${-date.year} BCE` : `${date.year}`;
  const month = date.month > 0 ? `-${String(date.month).padStart(2, '0')}` : '';
  const day = date.day > 0 ? `-${String(date.day).padStart(2, '0')}` : '';
  return `${year}${month}${day}`;
}

/* ------------------------------------------------------------------ */
/* validateSpec dispatch target                                        */
/* ------------------------------------------------------------------ */

type LooseTimelineCase = { earlierEventId: string; laterEventId: string };
interface LooseTimelineSpec {
  id: string;
  title: string;
  learningObjectives: string[];
  sources: SourceRef[];
  explanations: Explanation[];
  simulation: { engine: string; events: TimelineEvent[]; scenario: Record<string, string> };
  behavioralTests: (LooseTimelineCase & { name: string })[];
  predictions: (LooseTimelineCase & { id: string; prompt: string })[];
  provenance: { revision?: number };
}

/** Per-event grounding diagnosis: null when grounded, else a message naming event, date and quote. */
function eventGroundingFailure(
  ev: TimelineEvent,
  textOf: TextLookup,
  titleYearFor: (sourceId: string) => number | null,
): string | null {
  const date: TimelineDateTuple = { year: ev.year, month: ev.month, day: ev.day };
  const quoteNotes: string[] = [];
  const evidence = Array.isArray(ev?.evidence) ? ev.evidence : [];
  for (const q of evidence) {
    const quote = typeof q?.quote === 'string' ? q.quote : undefined;
    if (quote === undefined || !quoteCountsAsEvidence(quote)) {
      quoteNotes.push(
        `quote "${truncate(String(q?.quote), QUOTE_MESSAGE_LIMIT)}" does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters`,
      );
      continue;
    }
    const text = textOf(q.sourceId);
    if (text === undefined) {
      quoteNotes.push(`quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" cites sourceId "${String(q.sourceId)}", which has no matching document provided`);
      continue;
    }
    if (!text.includes(normalizeWhitespace(quote))) {
      quoteNotes.push(`quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" is not verbatim in source "${String(q.sourceId)}" after whitespace normalisation`);
      continue;
    }
    const titleYear = titleYearFor(q.sourceId);
    let best: { parts: string[]; note: string } | null = null;
    for (const unit of sentenceUnits(quote)) {
      if (unitGroundsDate(unit, date, titleYear)) return null; // grounded in this unit by ONE expression
      const note = unitGroundingDiagnosis(unit, date, titleYear);
      if (best === null || note.parts.length < best.parts.length) best = note;
    }
    quoteNotes.push(
      `quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" has no sentence unit stating ${best === null ? 'the date' : best.note}` +
        (titleYear !== null
          ? ` (the source title states year ${titleYear}, borrowable only into a unit stating the month and day in ONE expression and no other year)`
          : ''),
    );
  }
  return `event "${String(ev?.id)}" (${formatTimelineDate(date)}): date not grounded — ${quoteNotes.length > 0 ? quoteNotes.join('; ') : 'the event has no evidence quotes'}`;
}

/**
 * Why a unit fails to ground a claim (S5B-01): which claimed components no CONNECTED date
 * expression of the unit states. Components found in different expressions are reported as the
 * whole date missing from any one expression, listing what the unit actually states.
 */
function unitGroundingDiagnosis(unit: string, date: TimelineDateTuple, titleYear: number | null): { parts: string[]; note: string } {
  const exprs = parseDateExpressions(unit);
  const parts: string[] = [];
  const years = exprs.filter(e => e.year !== null).map(e => e.year);
  if (date.month !== 0 && !exprs.some(e => e.month === date.month)) parts.push(`month ${date.month}`);
  if (date.day !== 0 && !exprs.some(e => e.month === date.month && e.day === date.day)) {
    parts.push(`day ${date.day} inside a month-day expression`);
  }
  const yearStated = years.includes(date.year);
  const titleBorrowable =
    titleYear !== null &&
    date.year === titleYear &&
    date.month !== 0 &&
    exprs.some(e => e.month === date.month && (date.day === 0 || e.day === date.day) && e.year === null) &&
    !exprs.some(e => e.year !== null && (e.digits >= 3 || e.bce));
  if (!yearStated && !titleBorrowable) {
    parts.push(years.length > 0 ? `year ${date.year} (the unit states ${years.join(', ')})` : `year ${date.year}`);
  }
  if (parts.length === 0) {
    // Every component appears somewhere, but not in ONE connected expression (S5B-01).
    parts.push(
      `the full date ${formatTimelineDate(date)} as ONE connected date expression (the unit states: ${exprs.map(e => `"${e.text}"`).join(', ') || 'no date expression'})`,
    );
  }
  return { parts, note: parts.join(' and ') };
}

/**
 * Validate a full timeline-v1 activity spec against the provided source documents. Never throws.
 * Report order follows the Stage 5b plan's 'Revised checks' line: schema.full → timeline.unique-ids
 * → timeline.approximate-date → timeline.date-grounded → timeline.distinct-dates →
 * timeline.case-order → the existing quote/explanation/publisher/scope checks.
 */
export function validateTimelineSpec(spec: unknown, sources: SourceDocument[]): ValidationReport {
  const maybeId = (spec as { id?: unknown } | null | undefined)?.id;
  const artifactId = typeof maybeId === 'string' ? maybeId : 'unknown';
  let schemaOk = false;
  try {
    schemaOk = timelineSchemaValidate(spec) === true;
  } catch {
    schemaOk = false;
  }
  if (!schemaOk) {
    const affected = schemaAffectedPaths(timelineSchemaValidate);
    return {
      artifactId,
      revision: 1,
      checks: [
        {
          id: 'schema.full',
          kind: 'schema',
          passed: false,
          message: schemaFailureMessage(timelineSchemaValidate, 'spec failed schema.full'),
          ...(affected.length > 0 ? { affected } : {}),
        },
      ],
      publishable: false,
    };
  }

  // Past the gate the spec has the full timeline shape (schema-guaranteed).
  const s = spec as LooseTimelineSpec;
  const { docById, textOf } = indexSources(sources);
  const events = s.simulation.events;
  const titleYearCache = new Map<string, number | null>();
  const titleYearFor = (sourceId: string): number | null => {
    let v = titleYearCache.get(sourceId);
    if (v === undefined) {
      const doc = docById.get(sourceId);
      v = doc === undefined ? null : titleYearOf(doc);
      titleYearCache.set(sourceId, v);
    }
    return v;
  };
  // S5B-02: per-source sentence/heading unit index over the RAW text, for locating each verbatim
  // quote inside its full source sentence context.
  const unitIndexCache = new Map<string, SourceUnitIndex | null>();
  const unitIndexOf = (sourceId: string): SourceUnitIndex | null => {
    let v = unitIndexCache.get(sourceId);
    if (v === undefined) {
      const doc = docById.get(sourceId);
      v = doc !== undefined && typeof doc.text === 'string' ? buildSourceUnitIndex(doc.text) : null;
      unitIndexCache.set(sourceId, v);
    }
    return v;
  };

  const checks: ValidationCheck[] = [
    {
      id: 'schema.full',
      kind: 'schema',
      passed: true,
      message: `spec matches activity-spec.full.${TIMELINE_ENGINE_ID}.json (draft-07)`,
    },

    guarded('timeline.unique-ids', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      const note = (path: string, problem: string, paths: string[] = []): void => {
        if (firstPath === undefined) firstPath = path;
        problems.push(problem);
        affected.push(...paths);
      };
      // S5B-03 (decision 1): every occurrence of a duplicated key is an offending field occurrence.
      const dupPaths = (values: string[], pathOf: (i: number) => string): string[] => {
        const dupSet = new Set(duplicates(values));
        const out: string[] = [];
        values.forEach((v, i) => {
          if (dupSet.has(v)) out.push(pathOf(i));
        });
        return out;
      };
      const eventDups = duplicates(events.map(e => String(e.id)));
      if (eventDups.length > 0) {
        note('/simulation/events', `duplicate event ids: ${eventDups.join(', ')}`, dupPaths(events.map(e => String(e.id)), i => `/simulation/events/${i}/id`));
      }
      const expDups = duplicates(s.explanations.map(e => e.id));
      if (expDups.length > 0) {
        note('/explanations', `duplicate explanation ids: ${expDups.join(', ')}`, dupPaths(s.explanations.map(e => e.id), i => `/explanations/${i}/id`));
      }
      const predDups = duplicates(s.predictions.map(p => String(p.id)));
      if (predDups.length > 0) {
        note('/predictions', `duplicate prediction ids: ${predDups.join(', ')}`, dupPaths(s.predictions.map(p => String(p.id)), i => `/predictions/${i}/id`));
      }
      const testDups = duplicates(s.behavioralTests.map(b => String(b.name)));
      if (testDups.length > 0) {
        note('/behavioralTests', `duplicate behavioral test names: ${testDups.join(', ')}`, dupPaths(s.behavioralTests.map(b => String(b.name)), i => `/behavioralTests/${i}/name`));
      }
      const known = new Set(events.map(e => String(e.id)));
      const knownList = events.map(e => String(e.id)).join(', ') || 'none';
      const caseProblems = (
        list: 'behavioralTests' | 'predictions',
        items: LooseTimelineCase[],
        keyOf: (c: LooseTimelineCase, i: number) => string,
      ): void => {
        items.forEach((c, i) => {
          const key = keyOf(c, i);
          for (const field of ['earlierEventId', 'laterEventId'] as const) {
            if (!known.has(String(c[field]))) {
              note(
                `/${list}/${i}`,
                `${list}[${i}] "${key}" references unknown ${field} "${String(c[field])}" (expected an event id; events: ${knownList})`,
                [`/${list}/${i}/${field}`],
              );
            }
          }
          if (c.earlierEventId === c.laterEventId) {
            note(
              `/${list}/${i}`,
              `${list}[${i}] "${key}": earlierEventId and laterEventId are both "${String(c.earlierEventId)}" (expected two different events)`,
              [`/${list}/${i}/earlierEventId`, `/${list}/${i}/laterEventId`],
            );
          }
        });
      };
      caseProblems('behavioralTests', s.behavioralTests, c => String((c as { name?: unknown }).name));
      caseProblems('predictions', s.predictions, c => String((c as { id?: unknown }).id));
      return problems.length === 0
        ? {
            passed: true,
            message: `event ids, explanation ids, prediction ids and behavioral test names are unique, and all ${s.behavioralTests.length} behavioral test(s) and ${s.predictions.length} prediction(s) reference two different existing events`,
          }
        : { passed: false, message: `${problems.join('; ')} (expected unique ids and case pairs of two different existing events)`, path: firstPath, affected };
    }),

    guarded('timeline.approximate-date', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      let quoteCount = 0;
      const fail = (index: number, problem: string): void => {
        if (firstPath === undefined) firstPath = `/simulation/events/${index}`;
        problems.push(problem);
        affected.push(...eventDateAffected(index));
      };
      events.forEach((ev, i) => {
        for (const q of Array.isArray(ev.evidence) ? ev.evidence : []) {
          quoteCount++;
          if (typeof q?.quote !== 'string') continue;
          let fired = false;
          for (const unit of sentenceUnits(q.quote)) {
            const marker = hasApproximateDate(unit);
            if (marker === null) continue;
            fail(
              i,
              `event "${ev.id}" (${formatTimelineDate(ev)}): approximate date — remove this event; quote "${truncate(q.quote, QUOTE_MESSAGE_LIMIT)}" sentence unit "${truncate(unit, QUOTE_MESSAGE_LIMIT)}" states "${marker}"`,
            );
            fired = true;
            break; // one problem per quote is enough
          }
          if (fired) continue;
          // S5B-02 (decision 4): the quote is located in the SOURCE and the detector runs over the
          // FULL containing source sentence/heading unit(s) — a trimmed quote can never leave its
          // approximation qualifier behind. Every occurrence is inspected; a quote occurring more
          // than once with different qualifier contexts fails closed.
          const unitIndex = unitIndexOf(String(q?.sourceId));
          if (unitIndex === null) continue; // unresolvable references are reported by refs.sources
          const ctx = sourceQuoteApproximation(unitIndex, q.quote);
          if (ctx === null) continue; // clean everywhere, or not locatable (grounding.quotes reports that)
          fail(
            i,
            `event "${ev.id}" (${formatTimelineDate(ev)}): approximate date — remove this event; quote "${truncate(q.quote, QUOTE_MESSAGE_LIMIT)}" occurs ${ctx.occurrences}× in source "${String(q.sourceId)}" and its full source sentence/heading unit "${truncate(ctx.unitText, QUOTE_MESSAGE_LIMIT)}" states "${ctx.marker}"` +
              (ctx.mixedContexts
                ? ' (the quote occurs more than once with DIFFERENT qualifier contexts — failing closed on the ambiguity)'
                : ''),
          );
        }
      });
      return problems.length === 0
        ? {
            passed: true,
            message: `no approximate dates: none of the ${quoteCount} event quote(s) across ${events.length} event(s) — nor any FULL source sentence/heading unit containing one — states a decade form ("1770s"), "circa", "c.", "ca.", "around", "about" or "early/mid/late" before a year or month`,
          }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected exact dates stated by the source; events with only approximate dates are excluded by the prompt and must be removed)`,
            path: firstPath,
            affected: [...new Set(affected)],
          };
    }),

    guarded('timeline.date-grounded', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      let grounded = 0;
      events.forEach((ev, i) => {
        const failure = eventGroundingFailure(ev, textOf, titleYearFor);
        if (failure === null) {
          grounded++;
          return;
        }
        if (firstPath === undefined) firstPath = `/simulation/events/${i}`;
        problems.push(failure);
        affected.push(...eventDateAffected(i));
      });
      return problems.length === 0
        ? {
            passed: true,
            message: `all ${grounded} event date(s) are stated by ONE connected date expression in ONE sentence unit of a counted verbatim quote: the year (directly, or from a clean source title stating exactly one year when one expression states the month and day), plus the month and day where stated`,
          }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected each event's full stated date in ONE connected date expression inside ONE sentence unit of a verbatim evidence quote; the year may come from the source title only under the title-year rule)`,
            path: firstPath,
            affected,
          };
    }),

    guarded('timeline.distinct-dates', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      const byDate = new Map<string, { ev: TimelineEvent; index: number }>();
      events.forEach((ev, i) => {
        const key = `${ev.year}|${ev.month}|${ev.day}`;
        const prev = byDate.get(key);
        if (prev !== undefined) {
          if (firstPath === undefined) firstPath = `/simulation/events/${i}`;
          problems.push(
            `events "${prev.ev.id}" and "${ev.id}" both state ${formatTimelineDate(ev)} (expected distinct dates; ties make ordering questions ambiguous)`,
          );
          // Both occurrences of the tie are offending: a legitimate repair may re-ground either one.
          affected.push(...eventDateAffected(prev.index), ...eventDateAffected(i));
          return;
        }
        byDate.set(key, { ev, index: i });
      });
      return problems.length === 0
        ? { passed: true, message: `all ${events.length} event (year, month, day) tuples are distinct` }
        : { passed: false, message: problems.join('; '), path: firstPath, affected };
    }),

    guarded('timeline.case-order', 'behavioral', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      const byId = new Map<string, TimelineEvent>();
      for (const ev of events) {
        if (!byId.has(String(ev.id))) byId.set(String(ev.id), ev);
      }
      const lists: { list: 'behavioralTests' | 'predictions'; items: LooseTimelineCase[]; keyOf: (c: LooseTimelineCase) => string }[] = [
        { list: 'behavioralTests', items: s.behavioralTests, keyOf: c => String((c as { name?: unknown }).name) },
        { list: 'predictions', items: s.predictions, keyOf: c => String((c as { id?: unknown }).id) },
      ];
      for (const { list, items, keyOf } of lists) {
        items.forEach((c, i) => {
          const a = byId.get(String(c.earlierEventId));
          const b = byId.get(String(c.laterEventId));
          // Unknown references are reported by timeline.unique-ids (one root cause, reported once).
          if (a === undefined || b === undefined) return;
          const order = orderAtSharedPrecision(a, b);
          if (order === 'before') return;
          if (firstPath === undefined) firstPath = `/${list}/${i}`;
          problems.push(
            order === 'equal'
              ? `${list}[${i}] "${keyOf(c)}": "${a.id}" (${formatTimelineDate(a)}) and "${b.id}" (${formatTimelineDate(b)}) are equal at their shared precision (${PRECISION_NAMES[Math.min(precisionOf(a), precisionOf(b))]}) — ambiguous pair, expected earlierEventId to be strictly earlier at the precision BOTH events state`
              : `${list}[${i}] "${keyOf(c)}": earlierEventId "${a.id}" (${formatTimelineDate(a)}) is later than laterEventId "${b.id}" (${formatTimelineDate(b)}) — wrong answer, expected earlierEventId to be strictly earlier`,
          );
          // S5B-03 (decision 2): a case-order finding unlocks exactly this case's pair.
          affected.push(`/${list}/${i}/earlierEventId`, `/${list}/${i}/laterEventId`);
        });
      }
      return problems.length === 0
        ? {
            passed: true,
            message: `all ${s.behavioralTests.length} behavioral test(s) and ${s.predictions.length} prediction(s) recomputed from the event dates: earlierEventId is strictly earlier than laterEventId at the precision both events state`,
          }
        : { passed: false, message: problems.join('; '), path: firstPath, affected };
    }),

    guarded('refs.sources', 'grounding', () => {
      const specSourceIds = s.sources.map(src => String(src.id));
      const specIdSet = new Set(specSourceIds);
      const citedIds = [
        ...new Set([
          ...s.explanations.flatMap(ex => ex.evidence.map(ev => String(ev.sourceId))),
          ...events.flatMap(ev => (Array.isArray(ev.evidence) ? ev.evidence : []).map(q => String(q?.sourceId))),
        ]),
      ];
      const problems: string[] = [];
      const affected: string[] = [];
      const unknownCited = citedIds.filter(id => !specIdSet.has(id));
      if (unknownCited.length > 0) {
        problems.push(
          `evidence cites sourceId(s) not declared in spec.sources: ${unknownCited.join(', ')} (declared: ${specSourceIds.join(', ') || 'none'})`,
        );
        const unknownSet = new Set(unknownCited);
        s.explanations.forEach((ex, j) =>
          ex.evidence.forEach((ev, k) => {
            if (unknownSet.has(String(ev.sourceId))) affected.push(`/explanations/${j}/evidence/${k}/sourceId`);
          }),
        );
        events.forEach((ev, i) =>
          (Array.isArray(ev.evidence) ? ev.evidence : []).forEach((q, j) => {
            if (unknownSet.has(String(q?.sourceId))) affected.push(`/simulation/events/${i}/evidence/${j}/sourceId`);
          }),
        );
      }
      const missingDocs = specSourceIds.filter(id => !docById.has(id));
      if (missingDocs.length > 0) {
        problems.push(
          `spec.sources id(s) with no matching document provided: ${missingDocs.join(', ')} (provided: ${[...docById.keys()].join(', ') || 'none'})`,
        );
        s.sources.forEach((src, i) => {
          if (!docById.has(String(src.id))) affected.push(`/sources/${i}`);
        });
      }
      return problems.length === 0
        ? { passed: true, message: `all references resolve: ${specSourceIds.length} spec source(s), ${citedIds.length} cited sourceId(s)` }
        : { passed: false, message: problems.join('; '), path: '/sources', affected };
    }),

    guarded('refs.sha256', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      let verified = 0;
      s.sources.forEach((src, i) => {
        const doc = docById.get(String(src.id));
        if (!doc) return; // unresolvable references are reported by refs.sources
        verified++;
        const before = problems.length;
        if (doc.sha256 !== src.sha256) {
          problems.push(`source "${src.id}": spec sha256 ${String(src.sha256)} != stored document sha256 ${String(doc.sha256)}`);
        }
        const recomputed = typeof doc.text === 'string' ? sha256(doc.text) : undefined;
        if (recomputed !== src.sha256) {
          problems.push(
            `source "${src.id}": spec sha256 ${String(src.sha256)} != sha256(document.text) ${recomputed ?? '(document has no text)'}`,
          );
        }
        if (problems.length > before) affected.push(`/sources/${i}/sha256`);
      });
      return problems.length === 0
        ? { passed: true, message: `sha256 verified for ${verified} source(s): stored hash and recomputed text hash both match the spec` }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected spec sha256 == document sha256 == sha256(document.text))`,
            path: '/sources',
            affected,
          };
    }),

    guarded('grounding.quotes', 'grounding', () => {
      const failures: string[] = [];
      const affected: string[] = [];
      let firstPath: string | undefined;
      const fail = (path: string, message: string, ...affectedPaths: string[]): void => {
        if (firstPath === undefined) firstPath = path;
        failures.push(message);
        affected.push(...affectedPaths);
      };
      let counted = 0;
      let located = 0;
      s.explanations.forEach((ex, j) => {
        let countedForExplanation = 0;
        ex.evidence.forEach((ev, k) => {
          counted++;
          if (!quoteCountsAsEvidence(ev.quote)) {
            fail(
              '/explanations',
              `quote "${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
              `/explanations/${j}/evidence/${k}/quote`,
            );
            return;
          }
          countedForExplanation++;
          const text = textOf(ev.sourceId);
          if (text === undefined) return; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(ev.quote))) {
            fail(
              '/explanations',
              `"${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) not found in the source text`,
              `/explanations/${j}/evidence/${k}/quote`,
            );
          } else {
            located++;
          }
        });
        if (countedForExplanation === 0) {
          fail('/explanations', `explanation "${ex.id}" has no counted evidence quote (expected >= 1)`, `/explanations/${j}/evidence`);
        }
      });
      events.forEach((ev, i) => {
        let countedForEvent = 0;
        (Array.isArray(ev.evidence) ? ev.evidence : []).forEach((q, j) => {
          counted++;
          if (!quoteCountsAsEvidence(q?.quote)) {
            fail(
              `/simulation/events/${i}`,
              `quote "${truncate(q?.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${String(q?.sourceId)}, event "${ev.id}") does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
              `/simulation/events/${i}/evidence/${j}/quote`,
            );
            return;
          }
          countedForEvent++;
          const text = textOf(q.sourceId);
          if (text === undefined) return; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(q.quote))) {
            fail(
              `/simulation/events/${i}`,
              `"${truncate(q.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${q.sourceId}, event "${ev.id}") not found in the source text`,
              `/simulation/events/${i}/evidence/${j}/quote`,
            );
          } else {
            located++;
          }
        });
        if (countedForEvent === 0) {
          fail(`/simulation/events/${i}`, `event "${ev.id}" has no counted evidence quote (expected >= 1)`, `/simulation/events/${i}/evidence`);
        }
      });
      return failures.length === 0
        ? {
            passed: true,
            message: `all ${counted} evidence quote(s) count as evidence (>= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact "=" equation with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS}) and all ${located} resolvable quote(s) appear in their source text after whitespace normalisation; every explanation and every event has >= 1 counted quote`,
          }
        : {
            passed: false,
            message: `${failures.join('; ')} (expected counted verbatim quotes that appear in the source text after whitespace normalisation)`,
            path: firstPath,
            affected,
          };
    }),

    guarded('policy.no-publisher-attribution', 'semantic', () => {
      const scenario = (s.simulation.scenario ?? {}) as Record<string, string>;
      const fields: { path: string; text: string }[] = [
        { path: '/title', text: s.title },
        ...s.learningObjectives.map((t, i) => ({ path: `/learningObjectives/${i}`, text: t })),
        ...s.explanations.map((ex, i) => ({ path: `/explanations/${i}/text`, text: ex.text })),
        ...s.predictions.map((p, i) => ({ path: `/predictions/${i}/prompt`, text: String(p.prompt) })),
        ...s.behavioralTests.map((b, i) => ({ path: `/behavioralTests/${i}/name`, text: String(b.name) })),
        ...events.map((ev, i) => ({ path: `/simulation/events/${i}/label`, text: String(ev.label) })),
        ...['subjectLabel', 'settingLabel'].map(key => ({ path: `/simulation/scenario/${key}`, text: scenario[key] })),
      ];
      const hits = fields.filter(f => hasPublisherAttribution(f.text));
      return hits.length === 0
        ? {
            passed: true,
            message:
              'no generated display field (title, objectives, explanations, prediction prompts, behavioral test names, event labels, scenario labels) mentions the publisher or uses attribution/endorsement wording naming a source or authority; evidence quotes are exempt',
          }
        : {
            passed: false,
            message: `publisher attribution found at ${hits.map(h => `${h.path}: "${truncate(h.text, QUOTE_MESSAGE_LIMIT)}"`).join('; ')} (expected no mention of NASA / "National Aeronautics and Space Administration" anywhere, and no "according to / endorsed by / approved by / official conclusion|position of" wording naming a source or authority — a capitalised word or "the source/publisher/agency/author/text" within 40 characters — in generated display fields; NASA's AI-use guidance forbids attributing generated output to NASA)`,
            path: hits[0]?.path,
            // S5B-03 (decision 1): EVERY violating field occurrence — a policy finding unlocks
            // exactly these strings, never dates, quotes or ordering pairs.
            affected: hits.map(h => h.path),
          };
    }),

    // R-08: honest scope, identical to the numeric engines.
    {
      id: 'scope.prose-unverified',
      kind: 'semantic',
      passed: true,
      message: 'Explanation prose is AI-generated; quotes, numbers and ranges are machine-checked, the wording needs teacher review.',
    },
  ];

  return {
    artifactId,
    revision: Number.isInteger(s.provenance?.revision) ? (s.provenance.revision as number) : 1,
    checks,
    publishable: checks.every(c => c.passed),
  };
}

/* ------------------------------------------------------------------ */
/* compareRevisions dispatch target — repair no-weakening (Muse #6)    */
/* ------------------------------------------------------------------ */

export interface TimelineCompareContext {
  /** The source documents, for an EXACT recomputation of the baseline grounding (preferred). */
  sources?: SourceDocument[];
  /**
   * repairFindings() of the BASELINE report. S5B-03 (frozen decisions 1+2): authorization is read
   * ONLY from each finding's validator-owned `affected` field paths — a finding without affected
   * paths unlocks nothing, and finding messages/paths are display-only and NEVER searched for ids.
   */
  findings?: RepairFinding[];
}

function looseEvents(spec: LooseTimelineSpec | null | undefined): TimelineEvent[] {
  const v = spec?.simulation?.events;
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is TimelineEvent => typeof x === 'object' && x !== null);
}

function looseCases(spec: LooseTimelineSpec | null | undefined, key: 'behavioralTests' | 'predictions'): Record<string, unknown>[] {
  const v = (spec as unknown as Record<string, unknown> | null | undefined)?.[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
}

/**
 * S5B-03 (frozen decisions 1+2): the per-item repair unlock scopes, derived ONLY from failing
 * checks' validator-owned `affected` JSON-pointer field paths — never from rendered message text.
 */
interface TimelineUnlockScopes {
  /** Event indices whose year/month/day/evidence AND label may change (re-ground) or be removed. */
  eventDate: Set<number>;
  /** Event indices whose evidence quotes may change while dates and label stay frozen. */
  eventEvidence: Set<number>;
  /** Event indices whose label string may change while dates, evidence and id stay frozen. */
  eventLabel: Set<number>;
  /** Event indices that may be removed (⊇ eventDate; a unique-ids/schema id violation adds removal). */
  eventRemove: Set<number>;
  /** Case keys `${list}/${index}` whose ordering pair (earlierEventId/laterEventId) may change. */
  casePair: Set<string>;
}

function emptyScopes(): TimelineUnlockScopes {
  return { eventDate: new Set(), eventEvidence: new Set(), eventLabel: new Set(), eventRemove: new Set(), casePair: new Set() };
}

const EVENT_AFFECTED_RE = /^\/simulation\/events\/(\d+)(?:\/([^/]+))?(?:\/.*)?$/;
const CASE_AFFECTED_RE = /^\/(behavioralTests|predictions)\/(\d+)(?:\/([^/]+))?(?:\/.*)?$/;
const EVENT_DATE_FIELD_SET = new Set<string>(['year', 'month', 'day', 'evidence']);

/**
 * Classify one failing check's affected paths into unlock scopes (frozen decision 2):
 * - timeline.date-grounded / timeline.approximate-date / timeline.distinct-dates on an event →
 *   that event's date+evidence (or removal);
 * - grounding.quotes on an event's evidence → that event's evidence quotes only (an event-level
 *   quote failure that also breaks its date grounding always co-fails timeline.date-grounded,
 *   which carries the wider unlock);
 * - policy.no-publisher-attribution on an event label → that label string only;
 * - timeline.case-order (or a unique-ids/schema pair-field violation) → that case's pair only;
 * - timeline.unique-ids / schema.full on an event id → removal of that event occurrence only
 *   (renaming an event id is impossible: identity is (id, occurrence), new ids are violations);
 * - schema.full on an event date/evidence field → that event's date+evidence (structural repair);
 * - every other path (titles, objectives, explanations, prompts, scenario labels, sources) is not
 *   compared by this guard and unlocks nothing here.
 */
function addCheckScopes(checkId: string, affectedPaths: readonly string[], scopes: TimelineUnlockScopes): void {
  for (const p of affectedPaths) {
    if (typeof p !== 'string') continue;
    const em = EVENT_AFFECTED_RE.exec(p);
    const cm = CASE_AFFECTED_RE.exec(p);
    switch (checkId) {
      case 'timeline.date-grounded':
      case 'timeline.approximate-date':
      case 'timeline.distinct-dates': {
        if (em === null) break;
        const i = Number(em[1]);
        scopes.eventDate.add(i);
        scopes.eventRemove.add(i);
        break;
      }
      case 'grounding.quotes': {
        if (em === null) break;
        const field = em[2];
        if (field === undefined || field === 'evidence') scopes.eventEvidence.add(Number(em[1]));
        break;
      }
      case 'policy.no-publisher-attribution': {
        if (em !== null && em[2] === 'label') scopes.eventLabel.add(Number(em[1]));
        break;
      }
      case 'timeline.case-order': {
        if (cm === null) break;
        const field = cm[3];
        if (field === undefined || field === 'earlierEventId' || field === 'laterEventId') scopes.casePair.add(`${cm[1]}/${cm[2]}`);
        break;
      }
      case 'timeline.unique-ids': {
        if (em !== null && em[2] === 'id') scopes.eventRemove.add(Number(em[1]));
        if (cm !== null && (cm[3] === 'earlierEventId' || cm[3] === 'laterEventId')) scopes.casePair.add(`${cm[1]}/${cm[2]}`);
        break;
      }
      case 'schema.full': {
        if (em !== null) {
          const i = Number(em[1]);
          const field = em[2];
          if (field === undefined || EVENT_DATE_FIELD_SET.has(field)) {
            scopes.eventDate.add(i);
            scopes.eventRemove.add(i);
          } else if (field === 'label') {
            scopes.eventLabel.add(i);
          } else if (field === 'id') {
            scopes.eventRemove.add(i);
          }
          break;
        }
        if (cm !== null && (cm[3] === undefined || cm[3] === 'earlierEventId' || cm[3] === 'laterEventId')) {
          scopes.casePair.add(`${cm[1]}/${cm[2]}`);
        }
        break;
      }
      default:
        break; // no other check id unlocks timeline fields (S5B-03: decision-2 field scoping)
    }
  }
}

/** The affected paths of one finding-like object (junk-safe). */
function affectedOfFinding(f: unknown): string[] {
  if (typeof f !== 'object' || f === null) return [];
  const aff = (f as { affected?: unknown }).affected;
  return Array.isArray(aff) ? aff.filter((x): x is string => typeof x === 'string') : [];
}

function eventFieldChanges(a: TimelineEvent, b: TimelineEvent): { label: string[]; date: string[]; evidence: string[] } {
  const label: string[] = [];
  const date: string[] = [];
  const evidence: string[] = [];
  if (a.label !== b.label) label.push(`label "${a.label}" -> "${b.label}"`);
  if (a.year !== b.year) date.push(`year ${a.year} -> ${b.year}`);
  if (a.month !== b.month) date.push(`month ${a.month} -> ${b.month}`);
  if (a.day !== b.day) date.push(`day ${a.day} -> ${b.day}`);
  if (JSON.stringify(a.evidence) !== JSON.stringify(b.evidence)) evidence.push('evidence quotes changed');
  return { label, date, evidence };
}

function eventChanges(a: TimelineEvent, b: TimelineEvent): string[] {
  const c = eventFieldChanges(a, b);
  return [...c.label, ...c.date, ...c.evidence];
}

function sameDate(a: TimelineEvent, b: TimelineEvent): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Timeline no-weakening against the IMMUTABLE revision-1 baseline (Muse disposition #6, simplified;
 * plan line 'No-weakening for repair'; field-scoped per S5B-03, frozen decisions 1+2):
 * - the engine must be timeline-v1 on both revisions;
 * - no new event ids; the event count never exceeds the baseline and never drops below 5;
 * - an event whose date grounding passed on the baseline keeps its id, label, year, month, day and
 *   evidence unchanged unless a baseline failure's AFFECTED FIELD PATHS unlock them; an event that
 *   FAILED (date-grounded or approximate-date, recomputed here from the baseline itself, or named by
 *   a date-class finding's affected paths) may be re-grounded or removed;
 * - field scoping (decision 2): a label/name/id/policy finding unlocks that STRING only — dates,
 *   other quotes and ordering pairs stay frozen; a grounding.quotes finding on an event's evidence
 *   unlocks that evidence only; only a date-class finding (timeline.date-grounded /
 *   timeline.approximate-date / timeline.distinct-dates) or the recomputed grounding failure
 *   unlocks date+evidence (or removal); only timeline.case-order (or a recomputed wrong/ambiguous
 *   pair, or a unique-ids/schema pair-field violation) unlocks that case's pair — a renamed case
 *   keeps its pair;
 * - authorization NEVER comes from substring searches over rendered finding messages: a
 *   model-controlled label quoting another item's id unlocks nothing (S5B-03);
 * - tests/predictions keep (name/id, occurrence) identity with the numeric engines' rules, incl. the
 *   single publisher-policy rename exception; a matched case may change its pair only when the pair
 *   failed timeline.case-order on the baseline, a finding's affected paths unlock the pair, its
 *   event was removed after failing, or its event was legitimately re-grounded to a different date.
 * Grounding recomputation is EXACT when context.sources is provided (the baseline is re-validated
 * and its failing checks' affected paths are used). Without sources the quotes are matched textually
 * (title years come from the baseline spec's own SourceRef titles); when the baseline's
 * grounding.quotes also failed and no finding's affected paths unlock the event, a textually
 * grounded event fails CLOSED (stays frozen) because its verbatim status cannot be proven here.
 * Repeating a rejected revision against the baseline never changes its obligations: every unlock is
 * derived from the baseline and the findings, never from the candidate.
 * Never throws; junk input fails closed.
 */
export function compareTimelineRevisions(
  baseline: unknown,
  next: unknown,
  failedOnBaseline: string[],
  context?: TimelineCompareContext,
): ValidationCheck {
  const id = 'repair.no-weakening';
  const kind: CheckKind = 'semantic';
  try {
    const failed = new Set(Array.isArray(failedOnBaseline) ? failedOnBaseline : []);
    const problems: string[] = [];
    const p = baseline as LooseTimelineSpec | null | undefined;
    const n = next as LooseTimelineSpec | null | undefined;
    const pe = p?.simulation?.engine;
    const ne = n?.simulation?.engine;
    let enginesOk = true;
    if (pe !== TIMELINE_ENGINE_ID || ne !== TIMELINE_ENGINE_ID) {
      enginesOk = false;
      if (pe === ne) {
        problems.push(
          `cannot compare revisions: simulation.engine must be ${TIMELINE_ENGINE_ID} on both (baseline ${pe === undefined ? 'missing' : JSON.stringify(pe)}, next ${ne === undefined ? 'missing' : JSON.stringify(ne)})`,
        );
      } else {
        problems.push(`engine changed from ${String(pe)} to ${String(ne)}`);
      }
    }

    const wrap = (): ValidationCheck => {
      const shown = problems.slice(0, COMPARISON_PROBLEM_LIMIT);
      const hidden = problems.length - shown.length;
      const list =
        truncate(shown.join('; '), COMPARISON_MESSAGE_LIMIT) + (hidden > 0 ? ` (+${hidden} more violation(s))` : '');
      return {
        id,
        kind,
        passed: false,
        message: `repair weakened the spec: ${list} (a timeline repair must fix the failing checks without changing the engine, adding events, dropping the event count below ${MIN_EVENTS}, removing or rewriting an event that passed its date checks on the baseline, or changing a case pair that was strictly ordered on the baseline; only an item that failed on the baseline, or the exact fields a finding's affected paths unlock, may change)`,
      };
    };
    if (!enginesOk) return wrap();

    const pEvents = looseEvents(p);
    const nEvents = looseEvents(n);
    const findings = Array.isArray(context?.findings) ? context?.findings : undefined;
    const { docById, textOf } = indexSources(Array.isArray(context?.sources) ? (context?.sources as SourceDocument[]) : []);

    // S5B-03 (frozen decisions 1+2): the repair unlock scopes, derived ONLY from validator-owned
    // `affected` field paths — from the findings passed in and, when the source documents are
    // available, from an EXACT revalidation of the immutable baseline. Finding messages and the
    // display `path` are never searched for ids or names.
    const scopes = emptyScopes();
    if (findings !== undefined) {
      for (const f of findings) {
        if (typeof f !== 'object' || f === null) continue;
        const fid = (f as RepairFinding).id;
        addCheckScopes(typeof fid === 'string' ? fid : '', affectedOfFinding(f), scopes);
      }
    }
    if (Array.isArray(context?.sources) && context.sources.length > 0) {
      const baselineReport = validateTimelineSpec(baseline, context.sources as SourceDocument[]);
      for (const c of baselineReport.checks) {
        if (!c.passed && Array.isArray(c.affected)) addCheckScopes(c.id, c.affected, scopes);
      }
    }

    const titleYearFor = (sourceId: string): number | null => {
      const doc = docById.get(sourceId);
      if (doc !== undefined) return titleYearOf(doc);
      const ref = (Array.isArray(p?.sources) ? p.sources : []).find(r => typeof r?.id === 'string' && r.id === sourceId);
      return ref === undefined ? null : titleYearOf({ title: ref.title });
    };
    const verbatimOf = (sourceId: string, quote: string): boolean | undefined => {
      const text = textOf(sourceId);
      if (text === undefined) return undefined; // unknown without the source documents
      return text.includes(normalizeWhitespace(quote));
    };

    const eventHasApproximate = (ev: TimelineEvent): boolean =>
      (Array.isArray(ev?.evidence) ? ev.evidence : []).some(
        q => typeof q?.quote === 'string' && sentenceUnits(q.quote).some(unit => hasApproximateDate(unit) !== null),
      );

    /** Did this BASELINE event pass its date checks? Recomputed from the baseline itself. */
    const eventPassedGrounding = (ev: TimelineEvent, index: number): boolean => {
      if (typeof ev?.id !== 'string' || eventHasApproximate(ev)) return false;
      let textuallyGroundedVerbatimUnknown = false;
      for (const q of Array.isArray(ev.evidence) ? ev.evidence : []) {
        if (typeof q?.quote !== 'string' || !quoteCountsAsEvidence(q.quote)) continue;
        if (!quoteGroundsDate(q.quote, ev, titleYearFor(q.sourceId))) continue;
        const verbatim = verbatimOf(q.sourceId, q.quote);
        if (verbatim === true) return true;
        if (verbatim === false) continue;
        textuallyGroundedVerbatimUnknown = true;
      }
      if (!textuallyGroundedVerbatimUnknown) return false;
      // Without the source documents the verbatim side is unknown: trust the textual grounding only
      // while the baseline's grounding.quotes passed; otherwise fail closed unless a finding's
      // affected paths unlock this event (S5B-03: structured paths, never message substrings).
      if (!failed.has('grounding.quotes')) return true;
      return !(scopes.eventDate.has(index) || scopes.eventEvidence.has(index) || scopes.eventRemove.has(index));
    };

    /** Decision 2: a date-class unlock (or a recomputed grounding failure) frees date+evidence+label. */
    const eventMayReground = (ev: TimelineEvent, index: number): boolean =>
      scopes.eventDate.has(index) || !eventPassedGrounding(ev, index);
    const eventMayBeRemoved = (ev: TimelineEvent, index: number): boolean =>
      eventMayReground(ev, index) || scopes.eventRemove.has(index);

    // Event identity: (id, occurrence). New ids and occurrence inflation are violations.
    const pIndicesById = new Map<string, number[]>();
    pEvents.forEach((ev, i) => {
      const k = String(ev?.id);
      const bucket = pIndicesById.get(k);
      if (bucket === undefined) pIndicesById.set(k, [i]);
      else bucket.push(i);
    });
    const nById = new Map<string, TimelineEvent[]>();
    for (const ev of nEvents) {
      const k = String(ev?.id);
      const bucket = nById.get(k);
      if (bucket === undefined) nById.set(k, [ev]);
      else bucket.push(ev);
    }
    for (const [k, bucket] of nById) {
      const bCount = (pIndicesById.get(k) ?? []).length;
      if (bCount === 0) {
        problems.push(`event "${k}" is new in the repair (a repair may re-ground or remove a FAILING event, never add events)`);
        continue;
      }
      if (bucket.length > bCount) {
        problems.push(
          bCount === 1
            ? `event "${k}" appears ${bucket.length} times in the repair, expected exactly once`
            : `event "${k}" appears ${bucket.length} times in the repair, expected exactly ${bCount} (one per baseline occurrence)`,
        );
      }
    }

    const removedModifiableIds = new Set<string>();
    pEvents.forEach((ev, i) => {
      const k = String(ev?.id);
      const occurrence = (pIndicesById.get(k) ?? []).indexOf(i);
      const match = (nById.get(k) ?? [])[occurrence];
      const mayReground = eventMayReground(ev, i); // date-class unlock: date+evidence+label free
      const labelUnlocked = scopes.eventLabel.has(i); // policy/name finding: the label STRING only
      const evidenceUnlocked = scopes.eventEvidence.has(i); // grounding.quotes finding: the evidence only
      if (match === undefined) {
        if (mayReground || scopes.eventRemove.has(i)) removedModifiableIds.add(k);
        else {
          problems.push(
            `event "${k}" (${formatTimelineDate(ev)}) was removed even though its date check passed on the baseline (only an event that failed its date checks, or one a date-class finding's affected paths name, may be re-grounded or removed)`,
          );
        }
        return;
      }
      const changes = eventFieldChanges(ev, match);
      // S5B-03 (decision 2): only the fields a failure actually unlocks may change; everything else
      // stays frozen. A date-class unlock (re-ground) frees label+date+evidence; a label-only unlock
      // frees the label string; an evidence-only unlock frees the evidence quotes.
      const violations: string[] = [];
      if (!mayReground) {
        if (changes.label.length > 0 && !labelUnlocked) violations.push(...changes.label);
        if (changes.date.length > 0) violations.push(...changes.date); // dates need a date-class unlock
        if (changes.evidence.length > 0 && !evidenceUnlocked) violations.push(...changes.evidence);
      }
      if (violations.length > 0) {
        const scopeNote = mayReground
          ? ''
          : labelUnlocked || evidenceUnlocked
            ? ` (a finding unlocks only its ${[labelUnlocked ? 'label' : null, evidenceUnlocked ? 'evidence quotes' : null].filter(Boolean).join(' and ')}; dates stay frozen without a date-class finding)`
            : ' (an event that passed keeps its id, label, date and quotes unless a date-class finding names it)';
        problems.push(
          `event "${k}" changed (${violations.join(', ')}) even though its date check passed on the baseline${scopeNote}`,
        );
      }
    });

    if (nEvents.length > pEvents.length) {
      problems.push(`event count grew from ${pEvents.length} to ${nEvents.length} (a repair never adds events)`);
    }
    if (nEvents.length < MIN_EVENTS) {
      problems.push(`event count dropped to ${nEvents.length}, expected >= ${MIN_EVENTS}`);
    }

    // Case identity and pair freezing.
    const pEventById = new Map<string, TimelineEvent>();
    for (const ev of pEvents) {
      const k = String(ev?.id);
      if (!pEventById.has(k)) pEventById.set(k, ev);
    }
    const nEventIds = new Set(nEvents.map(ev => String(ev?.id)));
    const caseWasWrong = (c: Record<string, unknown>): boolean => {
      const a = pEventById.get(String(c.earlierEventId));
      const b = pEventById.get(String(c.laterEventId));
      if (a === undefined || b === undefined) return true; // never provably correct
      return orderAtSharedPrecision(a, b) !== 'before';
    };
    const caseEventRemovedAfterFailing = (c: Record<string, unknown>): boolean => {
      for (const eid of [String(c.earlierEventId), String(c.laterEventId)]) {
        const indices = pIndicesById.get(eid) ?? [];
        if (indices.length === 0) continue;
        if (!nEventIds.has(eid) && indices.some(i => eventMayBeRemoved(pEvents[i] as TimelineEvent, i))) return true;
      }
      return false;
    };
    const caseEventRegroundedToAnotherDate = (c: Record<string, unknown>): boolean => {
      for (const eid of [String(c.earlierEventId), String(c.laterEventId)]) {
        const indices = pIndicesById.get(eid) ?? [];
        if (indices.length === 0) continue;
        const bucket = nById.get(eid) ?? [];
        if (indices.some((i, occ) => eventMayReground(pEvents[i] as TimelineEvent, i) && bucket[occ] !== undefined && !sameDate(pEvents[i] as TimelineEvent, bucket[occ] as TimelineEvent))) {
          return true;
        }
      }
      return false;
    };

    const compareCases = (prev: Record<string, unknown>[], nextList: Record<string, unknown>[], keyField: 'name' | 'id', list: string): void => {
      const nextByKey = new Map<string, Record<string, unknown>[]>();
      for (const c of nextList) {
        const k = c[keyField];
        if (typeof k !== 'string') continue;
        const bucket = nextByKey.get(k);
        if (bucket === undefined) nextByKey.set(k, [c]);
        else bucket.push(c);
      }
      const baselineCountByKey = new Map<string, number>();
      for (const c of prev) {
        const k = c[keyField];
        if (typeof k !== 'string') continue;
        baselineCountByKey.set(k, (baselineCountByKey.get(k) ?? 0) + 1);
      }
      const caseMayChange = (bc: Record<string, unknown>, baselineIndex: number): boolean =>
        caseWasWrong(bc) ||
        scopes.casePair.has(`${list}/${baselineIndex}`) ||
        caseEventRemovedAfterFailing(bc) ||
        caseEventRegroundedToAnotherDate(bc);

      const comparePair = (bc: Record<string, unknown>, nc: Record<string, unknown>, k: string, baselineIndex: number): void => {
        const pairChanged = bc.earlierEventId !== nc.earlierEventId || bc.laterEventId !== nc.laterEventId;
        if (!pairChanged) return;
        if (caseMayChange(bc, baselineIndex)) return;
        problems.push(
          `${list} "${k}" changed its pair (${String(bc.earlierEventId)} -> ${String(bc.laterEventId)} became ${String(nc.earlierEventId)} -> ${String(nc.laterEventId)}) even though the pair was strictly ordered on the baseline (only a pair that failed timeline.case-order, a pair whose fields a case-order finding's affected paths unlock, or a pair whose event was removed or re-grounded after failing may change)`,
        );
      };
      const missingMessage = (k: string, occurrence: number): string => {
        const count = baselineCountByKey.get(k) ?? 1;
        const label = count === 1 ? `"${k}"` : `"${k}" (occurrence ${occurrence + 1} of ${count})`;
        return `${list} ${label} from the baseline is missing from the repair (only a case that failed on the baseline, a case whose pair fields a finding's affected paths unlock, or a case whose event was removed after failing its date checks may disappear)`;
      };

      // Pass 1 — identity is (key, occurrence); a policy-violating key without a match is deferred
      // to the positional rename exception (pass 2), exactly like the numeric engines.
      const claimed = new Set<Record<string, unknown>>();
      const deferred: { index: number; bc: Record<string, unknown>; key: string; occurrence: number }[] = [];
      const occurrenceSeen = new Map<string, number>();
      for (let i = 0; i < prev.length; i++) {
        const bc = prev[i] as Record<string, unknown>;
        const k = bc[keyField];
        if (typeof k !== 'string') {
          problems.push(`${list}[${i}] has no usable ${keyField} in the baseline, so its preservation cannot be verified`);
          continue;
        }
        const occurrence = occurrenceSeen.get(k) ?? 0;
        occurrenceSeen.set(k, occurrence + 1);
        const bucket = nextByKey.get(k) ?? [];
        if (occurrence < bucket.length) {
          const nc = bucket[occurrence] as Record<string, unknown>;
          claimed.add(nc);
          comparePair(bc, nc, k, i);
          continue;
        }
        if (renameableKey(keyField, k)) {
          deferred.push({ index: i, bc, key: k, occurrence });
          continue;
        }
        if (caseMayChange(bc, i)) continue; // a failing/pair-unlocked/orphaned case may be dropped
        problems.push(missingMessage(k, occurrence));
      }

      // Pass 2 — the single rename exception: a baseline case whose own name/id violates the
      // publisher policy may be renamed by position, to a policy-clean key that is not another
      // baseline key.
      for (const d of deferred) {
        const nc: Record<string, unknown> | undefined = nextList[d.index];
        const nk = nc?.[keyField];
        if (nc === undefined || claimed.has(nc) || typeof nk !== 'string' || nk === d.key) {
          if (!caseMayChange(d.bc, d.index)) problems.push(missingMessage(d.key, d.occurrence));
          continue;
        }
        const why = hasPublisherAttribution(d.key) ? 'violates the publisher-attribution policy' : `is not a valid ${keyField}`;
        if (hasPublisherAttribution(nk)) {
          problems.push(
            `${list}[${d.index}] "${d.key}" ${why} and may be renamed to fix it, but the repair renames it to "${nk}", which violates the policy too`,
          );
          continue;
        }
        if (keyField === 'id' && !VALID_CASE_ID.test(nk)) {
          problems.push(
            `${list}[${d.index}] "${d.key}" ${why} and may be renamed to fix it, but the repair renames it to "${nk}", which is not a valid id either (expected ${VALID_CASE_ID.source})`,
          );
          continue;
        }
        if (baselineCountByKey.has(nk)) {
          problems.push(
            `${list}[${d.index}] "${d.key}" ${why} and may be renamed to fix it, but only to a ${keyField} that is not another baseline ${keyField}; the repair renames it to "${nk}"`,
          );
          continue;
        }
        claimed.add(nc);
        comparePair(d.bc, nc, d.key, d.index);
      }

      for (const [k, bCount] of baselineCountByKey) {
        const nCount = (nextByKey.get(k) ?? []).length;
        if (nCount > bCount) {
          problems.push(
            bCount === 1
              ? `${list} "${k}" appears ${nCount} times in the repair, expected exactly once`
              : `${list} "${k}" appears ${nCount} times in the repair, expected exactly ${bCount} (one per baseline occurrence)`,
          );
        }
      }
    };

    const pTests = looseCases(p, 'behavioralTests');
    const nTests = looseCases(n, 'behavioralTests');
    const pPreds = looseCases(p, 'predictions');
    const nPreds = looseCases(n, 'predictions');
    compareCases(pTests, nTests, 'name', 'behavioralTests');
    compareCases(pPreds, nPreds, 'id', 'predictions');

    if (problems.length === 0) {
      return {
        id,
        kind,
        passed: true,
        message: `no weakening: engine ${TIMELINE_ENGINE_ID} unchanged, every event that passed date grounding on the baseline keeps its id, label, date and quotes, no events were added, the event count (${nEvents.length}) stayed within [${MIN_EVENTS}, ${pEvents.length}], and every behavioral test (${nTests.length}) and prediction (${nPreds.length}) keeps its (name, occurrence) identity and pair`,
      };
    }
    return wrap();
  } catch (err) {
    return { id, kind, passed: false, message: `comparison crashed before it could pass or fail cleanly: ${errMsg(err)}` };
  }
}
