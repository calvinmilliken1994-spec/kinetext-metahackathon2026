// TASK-020 — timeline-v1 deterministic validation (Stage 5b plan 'Revised checks' + Muse design
// review dispositions #1–#10 and the lead's title-year decision of 2026-10-28), hardened by the
// Stage 5b review round 1 (S5B-01..S5B-04, frozen design decisions 1–4 in docs/specs/STAGE-5b-plan.md),
// round 2 (S5B-11 source-span grounding: a date grounds only via a COMPLETE source expression
// inside the quote's located source span; S5B-12 era-aware range grammar: '500–400 BCE' grounds
// −500/−400 and ambiguous eras fail closed; S5B-13 approximation qualifiers attach to the parsed
// expression and the title-year rule shares that policy; S5B-15 repair authorization comes
// exclusively from the recomputed immutable-r1 report, caller findings may only narrow) and
// round 3 (the FROZEN lead decision 'fail-closed date grounding' at the end of the Stage 5b plan):
//   S5B-17 ONE AUTHORITY: with sources, the only per-event grounding result is the source-span
//     validator's; every event/pair unlock comes exclusively from the recomputed revision-1
//     check/path map, the quote-only quoteGroundsDate fallback is GONE from authorization, and
//     caller findings may only narrow (exact check id + exact affected path), CONSISTENTLY — an
//     empty or wrong-scope list narrows a genuine failure to nothing. Without sources,
//     date/evidence/pair mutation fails closed (only a policy finding's label survives, plus the
//     source-free ordering oracle for a provably wrong pair).
//   S5B-18/19/20 ALLOW-LIST + CLEAN CONTEXT: a date grounds ONLY if it is a supported exact form
//     (Month D[, ]YYYY; [the ]D[th] [of ]Month[, ]YYYY; Month [of ]YYYY; Month D / [the ]D[th]
//     [of ]Month + title year; plain YYYY; YYYY BC/BCE/B.C./B.C.E.; AD/A.D./CE/C.E. YYYY and
//     BCE/BC YYYY prefixes; YYYY AD/CE; YYYY–YYYY ranges with the explicit-era rule) AND its
//     context is clean — no qualifier/bound within the preceding two words, no unconsumed era
//     token / 'century' / 'or' / 'so' / '?' / range-connector+number within the following two,
//     no ordinal/decade suffix or apostrophes on the year token, no markup touching or splitting
//     the expression. Anything unrecognised FAILS CLOSED (false rejections are the accepted safe
//     cost); titles use the same guard and lend only exactly one plain YYYY, taken from the title
//     field and the FIRST NON-EMPTY '#' heading line. A sentence-final period is never part of an
//     era spelling (a quote ending at 'BCE' of 'March 3, 500 BCE.' grounds).
//
// A timeline has no formula, so the SOURCE TEXT is the deterministic oracle:
//   date-grounded   every event's full stated date (year, and month/day where stated) must be
//                 stated by ONE CONNECTED DATE EXPRESSION (S5B-01, decision 3) in a CLEAN CONTEXT
//                 (round 3) inside one sentence unit of a counted, verbatim evidence quote. A day
//                 counts ONLY inside a month-day expression ('4 delegates' is never day 4) and a
//                 claimed component never combines across expressions ('March 3 ... July 4' never
//                 states March 4). The year may instead come from the source title, but only when
//                 the title is clean (S5B-02, decision 4: no approximation/range/ambiguity marker),
//                 states exactly one plain standalone year, the event's year equals it, ONE
//                 expression states the month (and day if claimed) without a year of its own, and
//                 the unit contains no year-like token. No other cross-sentence inheritance.
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
// their explicitly resolvable endpoints; an era marker ("BCE", "BC", "B.C.", "B.C.E." after or
// "BCE/BC/AD/CE" before the number) fixes the sign and forbids the opposite reading. Month names
// come from a fixed case-insensitive list incl. "Sep(t)?(ember)?" with an optional period (#9); a
// day is \b0?DAY(st|nd|rd|th)?\b and is ONLY parsed as part of a month-day expression (#2, #3,
// S5B-01).
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
/**
 * Era abbreviations never split units; a month abbreviation's period only survives before a number
 * ("Sept. 4"). S5B-13: the approximation abbreviations "c.", "ca." and "approx." never split units
 * either, so a qualifier can never be segmented away from the date expression it governs.
 */
const ABBREV_PERIOD = /\b(?:B\.C\.E\.|B\.C\.|A\.D\.|B\.C\.E|B\.C|A\.D)(?![A-Za-z])|\b(?:jan|feb|mar|apr|aug|sep|sept|oct|nov|dec)\.(?=\s?[0-9])|\b(?:c|ca|approx)\.(?=\s)/gi;
const SENTENCE_SPLIT = /(?<=[.!?;])\s+/;
/** Global variant of SENTENCE_SPLIT for scanning split points with matchAll (S5B-02 source units). */
const SENTENCE_SPLIT_G = /(?<=[.!?;])\s+/g;

function maskAbbrevPeriods(s: string): string {
  // An era abbreviation's FINAL period ("B.C.E.") often doubles as the sentence-ending period.
  // When it is followed by whitespace + a capitalised word (a real sentence boundary), keep it
  // unmasked so the unit still splits there — otherwise a BCE year and the NEXT sentence merge
  // into one unit and its year-like token would wrongly suppress title-year inheritance (S5B-11/12).
  return s.replace(ABBREV_PERIOD, (m, offset: number, str: string) => {
    if (m.endsWith('.') && /^(?:B\.C|A\.D)/i.test(m) && /^\s+[A-Z]/.test(str.slice(offset + m.length))) {
      return m.slice(0, -1).replace(/\./g, ABBREV_MASK) + '.';
    }
    return m.replace(/\./g, ABBREV_MASK);
  });
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

/* ------------------------------------------------------------------ */
/* Era spellings (round-3 allow-list + hardening)                      */
/* ------------------------------------------------------------------ */
/**
 * HARDENING (round 3): a sentence-final period is never part of an era SUFFIX spelling — the
 * suffix patterns stop before a trailing '.' (they still match the dotted spellings internally),
 * so a quote ending at 'BCE' of 'March 3, 500 BCE.' contains the COMPLETE expression. A PREFIX
 * may keep its final period because digits always follow it ('A.D. 79').
 */
/** Negative-era suffix core: BCE / BC / B.C. / B.C.E. (final period excluded from the span). */
const ERA_NEG_SUF = 'b\\.?\\s?c\\.?\\s?e?';
/** Positive-era suffix core: AD / A.D. / CE / C.E. (final period excluded from the span). */
const ERA_POS_SUF = 'a\\.?\\s?d|c\\.?\\s?e';
/** Either era suffix directly after the digits (whitespace allowed), never inside a word. The
 * trailing period of a dotted spelling is NEVER consumed (hardening): '(?<!\.)' forces the match
 * to backtrack off it, so a quote ending at 'B.C' of '500 B.C.' contains the complete expression. */
const ERA_SUF = `(?:\\s*(?:${ERA_NEG_SUF}|${ERA_POS_SUF})(?![a-z])(?<!\\.))`;
/** An era prefix before the digits: BCE/BC/B.C./B.C.E. (negative) or AD/A.D./CE/C.E. (positive). */
const ERA_PRE = `(?<![a-z0-9])(?:b\\.?\\s?c\\.?\\s?e?\\.?|a\\.?\\s?d\\.?|c\\.?\\s?e\\.?)(?![a-z0-9])\\s*`;
/** The negative-era marker at the start of a year slot's trailing text (Muse #4 + round 3). */
const ERA_NEG_MARKER = new RegExp(`^\\s*(?:${ERA_NEG_SUF})(?![a-z])`, 'i');
/** The positive-era marker (AD/CE) at the start of a year slot's trailing text. */
const ERA_POS_MARKER = new RegExp(`^\\s*(?:${ERA_POS_SUF})(?![a-z])`, 'i');

/** 'neg' when the trailing text states a BCE-family era, 'pos' for AD/CE, null when era-free. */
function eraOfText(rest: string): 'neg' | 'pos' | null {
  if (ERA_NEG_MARKER.test(rest)) return 'neg';
  if (ERA_POS_MARKER.test(rest)) return 'pos';
  return null;
}
/** True when an era-prefix token is a BCE-family spelling. */
function prefixIsNegative(prefix: string): boolean {
  return /^b/i.test(prefix.trim());
}

/* ------------------------------------------------------------------ */
/* Approximation qualifiers attached to expressions (S5B-13)           */
/* ------------------------------------------------------------------ */

/** Deliberate approximation wording: attaches to ANY parsed date expression. */
const STRONG_QUALIFIER_PAT = '(?:\\bcirca\\b\\.?|\\bapprox(?:imately)?\\b\\.?|\\b(?:c|ca)\\.)';
/** Loose prose qualifiers: attach only to DATE-LIKE expressions, so "about 40 delegates" never fires. */
const WEAK_QUALIFIER_PAT = '(?:\\baround\\b|\\babout\\b|\\broughly\\b|\\bsometime?s?\\s+in\\b)';
/** Part-of-period qualifiers ("early 1889", "mid-June", "late July"), optionally hyphenated. */
const PART_QUALIFIER_PAT = '(?:\\b(?:early|mid|late|middle)\\b\\s*[-\u2013\u2014]?\\s*)';
/** The optional article of day-first ordinal forms ("around THE 4th of July 1776"). */
const ARTICLE_PAT = '(?:\\bthe\\b\\s+)';
/** How far before an expression a qualifier is still considered attached. */
const QUALIFIER_LOOKBACK_WINDOW = 64;
/**
 * An approximation qualifier stated IMMEDIATELY BEFORE a date expression (S5B-13), anchored at the
 * end of the preceding text: a strong or weak qualifier, an optional chained part-qualifier
 * ("about mid-"), an optional article ("around the 4th of July"), or a part-qualifier alone
 * ("early 1889", "mid-June").
 */
const QUALIFIER_LOOKBACK = new RegExp(
  `(?:${STRONG_QUALIFIER_PAT}|${WEAK_QUALIFIER_PAT})\\s*-?\\s*${PART_QUALIFIER_PAT}?${ARTICLE_PAT}?$|${PART_QUALIFIER_PAT}${ARTICLE_PAT}?$`,
  'i',
);
const STRONG_QUALIFIER_START = new RegExp(`^${STRONG_QUALIFIER_PAT}`, 'i');

function qualifierBefore(preceding: string): { strong: boolean; text: string } | null {
  const m = QUALIFIER_LOOKBACK.exec(preceding);
  if (m === null) return null;
  return { strong: STRONG_QUALIFIER_START.test(m[0].trimStart()), text: m[0] };
}

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
 * A standalone 1–4 digit year core (round-3 allow-list): digit boundaries on both sides, never a
 * decade form ("1770s" — S5B-13), never an ordinal ("18th" — S5B-20: a century ordinal is never a
 * literal year) and never apostrophe-clipped ("'76", "1776'" — round-3 decision 3).
 */
const YEAR_CORE =
  "(?<![0-9'\u2019])[0-9]{1,4}(?![0-9])(?!s(?![a-z]))(?!(?:st|nd|rd|th)(?![a-z]))(?!['\u2019])";
/** A 3–4 digit year core (never a day number) — used where no day precedes/follows. */
const YEAR34_CORE =
  "(?<![0-9'\u2019])[0-9]{3,4}(?![0-9])(?!s(?![a-z]))(?!(?:st|nd|rd|th)(?![a-z]))(?!['\u2019])";
/** The year slot of a Month-Day[-Year] / Day-Month[-Year] expression: any standalone year, era-suffixed allowed. */
const YEAR_MDY = `(?:${YEAR_CORE}${ERA_SUF}?)`;
/**
 * The year slot of a Month[-of] Year expression: 3–4 digits, or any digits WITH an era suffix.
 * A bare 1–2 digit number after a month name is a DAY ("April 14"), never a year.
 */
const YEAR_MY = `(?:(?<![0-9'\u2019])[0-9]{1,4}(?![0-9])${ERA_SUF}|${YEAR34_CORE})`;

/**
 * S5B-01 (frozen decision 3) + the round-3 lead decision (allow-list of supported EXACT forms):
 * ONE connected date expression. Alternation order matters — the longest forms are listed first
 * and the global scan consumes each match, so "March 3, 1889" is ONE expression (never month-day
 * + standalone year) and "April 14" is a month-day, not a month-year with year 14.
 * S5B-12/S5B-18: era markers are part of the RANGE grammar — a range match consumes era prefixes
 * and suffixes on both endpoints; the code-side resolution below grounds the endpoints only for
 * EXPLICITLY resolvable eras and fails closed on anything else (a range never re-exposes its
 * interior to the standalone-year branch).
 */
const DATE_EXPRESSION_RE = new RegExp(
  [
    // Month D[ay-suffix][, ]YYYY[ era]  — "March 3, 1889", "Sept. 4, 1776", "March 3, 500 BCE"
    `(?<mdyM>${MONTH_PAT})\\s+(?<mdyD>${DAY_PAT})(?:(?:,?\\s+|,\\s*)(?<mdyY>${YEAR_MDY}))?`,
    // [the ]D[ay-suffix] [of ]Month[, ]YYYY[ era] — "25 December 1776", "the 4th of July 1776"
    `(?:(?<dmyThe>the)\\s+)?(?<dmyD>${DAY_PAT})\\s+(?:of\\s+)?(?<dmyM>${MONTH_PAT})(?:(?:,?\\s+|,\\s*)(?<dmyY>${YEAR_MDY}))?`,
    // Month[,] [of ]YYYY[ era] — "July 1776", "September of 1776", "November of 1777"
    `(?<myM>${MONTH_PAT})\\s*(?:,\\s*|\\s+)(?:of\\s+)?(?<myY>${YEAR_MY})`,
    // [era ]YYYY[ era] SEP [era ]YYYY[ era] — era-explicit year ranges (S5B-12/S5B-18): the
    // code-side resolution grounds only explicitly resolvable endpoints, short endpoints only
    // with an explicit era, and never expands an abbreviated endpoint ('1775–83' grounds 1775).
    // The separator may follow a dotted era spelling's final period ('500 B.C. – 400 B.C.').
    `(?<rngAPre>${ERA_PRE})?(?<rngA>${YEAR_CORE})(?<rngASuf>${ERA_SUF})?\\.?\\s*[-\u2013\u2014/]\\s*(?<rngBPre>${ERA_PRE})?(?<rngB>${YEAR_CORE})(?<rngBSuf>${ERA_SUF})?`,
    // Month D[ay-suffix] (no year) — "June 10", "on July 19th", "April 14"
    `(?<mdM>${MONTH_PAT})\\s+(?<mdD>${DAY_PAT})`,
    // [the ]D[ay-suffix] [of ]Month (no year) — "25 December", "the 10th of June"
    `(?:(?<dmThe>the)\\s+)?(?<dmD>${DAY_PAT})\\s+(?:of\\s+)?(?<dmM>${MONTH_PAT})`,
    // [era ]YYYY[ era] — a standalone year ("in 1855", "500 B.C.", "A.D. 79", "BCE 500")
    `(?<yPre>${ERA_PRE})?(?<yY>${YEAR_CORE})(?<ySuf>${ERA_SUF})?`,
    // Month (bare month name) — "in June of the signing year"
    `(?<mM>${MONTH_PAT})`,
  ].join('|'),
  'gi',
);

/**
 * One CONNECTED date expression parsed out of a sentence unit (S5B-01, frozen decision 3), under
 * the round-3 lead decision: an expression grounds a date ONLY if it is one of the supported
 * exact forms AND its context is clean (the fail-closed clean-context guard below). A claimed
 * date's components never combine across expressions, and a day exists only inside a month-day
 * expression. S5B-11: every expression carries its exact [start, end) span in the parsed string
 * so grounding can require the COMPLETE source expression to lie inside a located quote's source
 * span — a quote edge cutting a token never manufactures an expression end.
 */
export interface DateExpression {
  /** Signed year as stated (negative exactly under a BCE-family era); null when the expression states no year. */
  year: number | null;
  /** Digit length of the year as written (0 when absent); a year is year-LIKE at >= 3 digits or under a BCE era. */
  digits: number;
  bce: boolean;
  /** 1–12, null when the expression states no month. */
  month: number | null;
  /** 1–31, null when the expression states no day (a day is ONLY parsed inside a month-day expression). */
  day: number | null;
  /** The matched text (from the original, unmasked unit). */
  text: string;
  /** Exact raw span [start, end) of the COMPLETE expression in the parsed string (S5B-11). */
  start: number;
  end: number;
  /**
   * S5B-13: the normalised approximation qualifier attached to this expression ("around the 4th of
   * July 1776"), or null. A qualified expression never grounds an exact date.
   */
  approx: string | null;
  /**
   * S5B-12: true for a year range whose era markers cannot be resolved unambiguously
   * ("500 BCE–400" — is the unmarked endpoint inherited BCE or CE?). Such an expression grounds
   * nothing (fail closed) but still counts as year-LIKE, suppressing title-year inheritance.
   */
  eraAmbiguous: boolean;
  /** The supported exact form this expression matched (round-3 allow-list). */
  form: 'mdy' | 'dmy' | 'my' | 'range' | 'md' | 'dm' | 'year' | 'month';
  /** True when an era prefix/suffix is part of the expression (a title may lend only a BARE year). */
  eraMarked: boolean;
  /**
   * Round-3 clean-context guard: the reason this expression's surrounding context is NOT clean —
   * a qualifier/temporal bound or unconsumed era token in the preceding two words, "the"+ordinal
   * or number+range-connector before it, an unconsumed era token / "century" wording / "or" /
   * "so" / "?" / a range connector followed by a number in the following two words, or markup
   * touching or splitting the expression — or null when the context is clean. A context-rejected
   * expression GROUNDS NOTHING (fail closed) but still counts as year-LIKE for the title-year rule.
   */
  contextRejected: string | null;
}

/* ------------------------------------------------------------------ */
/* The round-3 clean-context guard (lead decision: fail closed)        */
/* ------------------------------------------------------------------ */

/** Markup characters that may never touch or split a supported date expression. */
const MARKUP_CHARS = new Set(['*', '_', '`', '[', ']', '<', '>']);
/**
 * Words in the TWO PRECEDING window tokens that disqualify an expression: approximation
 * qualifiers and temporal bounds (the round-3 frozen lexicon), plus an era token the expression
 * did not consume. Punctuation/markup/whitespace between words is ignored.
 */
const PRECEDING_DISQUALIFIERS = new Set([
  'circa', 'c', 'ca', 'approx', 'approximate', 'approximately', 'about', 'around', 'roughly',
  'nearly', 'almost', 'some', 'sometime', 'sometimes', 'probably', 'possibly', 'perhaps',
  'likely', 'estimated', 'est', 'before', 'after', 'by', 'until', 'till', 'than', 'since',
  'prior', 'early', 'mid', 'middle', 'late', 'between', 'from',
  'bc', 'bce', 'ad', 'ce',
]);
/** Following-window tokens that disqualify on their own (unconsumed eras, century wording, doubt). */
const FOLLOWING_DISQUALIFIERS = new Set(['bc', 'bce', 'ad', 'ce', 'century', 'centuries', 'millennium', 'or', 'so', '?']);
/** Range connectors: connector + number after (or number + connector before) is a range continuation. */
const RANGE_CONNECTORS = new Set(['to', 'until', 'till', 'through', 'and', 'or', '-', '\u2013', '\u2014', '/']);
/** Era tokens (for the number/era + connector continuation rule). */
const ERA_TOKENS = new Set(['bc', 'bce', 'ad', 'ce']);
/**
 * Window tokens: words (dotted abbreviations glued: "B.C.E" -> one token), numbers with an
 * optional ordinal suffix, connector characters and '?'. Every other character is word-internal
 * punctuation and is skipped ("ignoring punctuation/markup/whitespace between words").
 */
const WINDOW_TOKEN_RE = /[A-Za-z]+(?:\.[A-Za-z]+)*\.?|[0-9]{1,4}(?:st|nd|rd|th)?|[-\u2013\u2014/]|\?/g;
const ORDINAL_TOKEN_RE = /^[0-9]{1,4}(?:st|nd|rd|th)$/;
/** How far the guard looks on each side while collecting its two window tokens. */
const CONTEXT_WINDOW_CHARS = 160;
/**
 * Abbreviation words whose final period never acts as a sentence stop inside the guard window
 * ("c. March 3, 1889" — the qualifier can never hide behind its own period).
 */
const ABBREV_STOP_WORDS = new Set([
  'c', 'ca', 'approx', 'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'sept',
  'oct', 'nov', 'dec', 'ad', 'bc', 'bce', 'ce',
]);

/** True when the '.' at `dotIndex` of `text` belongs to an abbreviation rather than ending a sentence. */
function isAbbrevPeriod(text: string, dotIndex: number): boolean {
  if (text[dotIndex] !== '.') return false;
  const before = text.slice(Math.max(0, dotIndex - 12), dotIndex);
  const word = /[A-Za-z]+$/.exec(before)?.[0] ?? '';
  if (word.length === 0) return false;
  // A dotted single-letter chain ("B.C.E.") or a single letter at a token boundary ("c."): the
  // period belongs to the abbreviation, not to a sentence end.
  if (word.length === 1) {
    const chain = before.slice(0, before.length - 1);
    return chain === '' || /(?:^|[^A-Za-z])$/.test(chain) || /(?:[A-Za-z]\.)+$/.test(chain);
  }
  // A known abbreviation word ("Sept.", "approx.", "c." handled above): the word must start at a
  // token boundary. Plain words ("house.", "left.") end sentences.
  return ABBREV_STOP_WORDS.has(word.toLowerCase()) && /(?:^|[^A-Za-z])$/.test(before.slice(0, before.length - word.length));
}

/** Tokenise a window slice into guard tokens (words glued across dots, lower-cased). */
function tokenizeWindow(slice: string): string[] {
  const tokens: string[] = [];
  for (const m of slice.matchAll(WINDOW_TOKEN_RE)) tokens.push(m[0].replaceAll('.', '').toLowerCase());
  return tokens;
}

/**
 * The (up to) two tokens preceding `pos`, scanning over punctuation/markup/whitespace and
 * stopping at a sentence-terminal [.!?;] that is not an abbreviation period — so a qualifier can
 * never be segmented away (S5B-19: "circa,", "around (", "circa\n" all still disqualify), while a
 * genuine sentence boundary delimits the window ("...controlled by the ...\n\n1900 Aircraft"
 * stays clean).
 */
function tokensBefore(text: string, pos: number): string[] {
  const slice = text.slice(Math.max(0, pos - CONTEXT_WINDOW_CHARS), pos);
  let cut = -1;
  for (let i = slice.length - 1; i >= 0; i--) {
    const ch = slice[i] as string;
    if (ch === '.' || ch === '!' || ch === '?' || ch === ';') {
      if (ch === '.' && isAbbrevPeriod(slice, i)) continue;
      cut = i;
      break;
    }
  }
  return tokenizeWindow(cut === -1 ? slice : slice.slice(cut + 1)).slice(-2);
}

/**
 * The (up to) two tokens following `pos`; a '?' is collected as a token (it disqualifies) and
 * every sentence-terminal stops the scan.
 */
function tokensAfter(text: string, pos: number): string[] {
  const slice = text.slice(pos, pos + CONTEXT_WINDOW_CHARS);
  let end = slice.length;
  for (let i = 0; i < slice.length; i++) {
    const ch = slice[i] as string;
    if (ch === '?') {
      end = i + 1; // include the '?' token, then stop
      break;
    }
    if (ch === '.' || ch === '!' || ch === ';') {
      if (ch === '.' && isAbbrevPeriod(slice, i)) continue;
      end = i;
      break;
    }
  }
  return tokenizeWindow(slice.slice(0, end)).slice(0, 2);
}

function isNumberToken(token: string): boolean {
  return /^[0-9]/.test(token);
}

/**
 * True when the "until"/"till" directly before `pos` is negated within its own clause: one of the
 * (up to) four words before it is "not"/"never" or ends in "n't". Only the clause containing
 * "until" counts (the scan stops at , ; : . ! ?), so a distant or earlier-sentence "not" never
 * applies. Un-negated "until" (deferred/delayed until, from X until Y) stays a temporal bound.
 */
function negatedUntil(text: string, pos: number): boolean {
  const slice = text.slice(Math.max(0, pos - CONTEXT_WINDOW_CHARS), pos);
  const m = /\b(?:until|till)\W*$/i.exec(slice);
  if (m === null) return false;
  const head = slice.slice(0, m.index);
  const clauseStart = Math.max(...[',', ';', ':', '.', '!', '?'].map((c) => head.lastIndexOf(c)));
  const words = head.slice(clauseStart + 1).split(/\s+/).filter((w) => w !== '').slice(-4);
  return words.some((w) => /^(?:not|never)$/i.test(w.replace(/[^A-Za-z']/g, '')) || /n['\u2019]t$/i.test(w));
}

/**
 * The round-3 clean-context guard: why this expression's context is NOT clean, or null. Anything
 * not recognised as a supported exact form in clean context does not ground (fail closed); false
 * rejections of legitimate dates are the accepted safe cost.
 */
function contextRejection(text: string, start: number, end: number): string | null {
  // Markup splitting the expression or directly touching it.
  for (let i = start; i < end; i++) {
    if (MARKUP_CHARS.has(text[i] as string)) return `markup splits the expression (${text[i]})`;
  }
  if (start > 0 && MARKUP_CHARS.has(text[start - 1] as string)) return `markup touches the expression (${text[start - 1]})`;
  if (end < text.length && MARKUP_CHARS.has(text[end] as string)) return `markup touches the expression (${text[end]})`;
  const before = tokensBefore(text, start);
  for (let k = 0; k < before.length; k++) {
    const t = before[k] as string;
    // Lead decision (round-3 STOP items): a NEGATED "until" directly before the date states when
    // the event happened ("was not approved until September of 1776"), so it is not a bound.
    if ((t === 'until' || t === 'till') && k === before.length - 1 && negatedUntil(text, start)) continue;
    if (PRECEDING_DISQUALIFIERS.has(t)) return `the preceding word "${t}" is an approximation qualifier or temporal bound`;
  }
  if (before.length === 2 && before[0] === 'the' && ORDINAL_TOKEN_RE.test(before[1] as string)) {
    return `the preceding words "the ${before[1]}" are an article + ordinal (an ordinal is never a year)`;
  }
  if (
    before.length === 2 &&
    RANGE_CONNECTORS.has(before[1] as string) &&
    (isNumberToken(before[0] as string) || ERA_TOKENS.has(before[0] as string))
  ) {
    return `the preceding words "${before[0]} ${before[1]}" continue an unsupported range expression`;
  }
  const after = tokensAfter(text, end);
  for (const t of after) {
    if (FOLLOWING_DISQUALIFIERS.has(t)) {
      return t === '?'
        ? 'the expression ends a question (an uncertain claim, never an exact date)'
        : ERA_TOKENS.has(t)
          ? `the following word "${t}" is an era token the expression did not consume (the stated era is part of the date)`
          : `the following word "${t}" makes the expression inexact (century wording, alternatives or doubt)`;
    }
  }
  if (after.length === 2 && RANGE_CONNECTORS.has(after[0] as string) && isNumberToken(after[1] as string)) {
    return `the following words "${after[0]} ${after[1]}" are a range connector followed by a number (an unsupported range form)`;
  }
  return null;
}

function monthNumberOf(monthText: string): number | null {
  for (let m = 1; m <= MONTH_SOURCES.length; m++) {
    const src = MONTH_SOURCES[m - 1];
    if (src !== undefined && new RegExp(`^${src}$`, 'i').test(monthText.replace(/\.$/, ''))) return m;
  }
  return null;
}

function yearOf(
  yearText: string | undefined,
): { year: number; digits: number; bce: boolean; eraMarked: boolean } | null {
  if (yearText === undefined) return null;
  const digits = /[0-9]{1,4}/.exec(yearText)?.[0];
  if (digits === undefined) return null;
  const era = eraOfText(yearText.slice(digits.length));
  const value = Number(digits);
  return { year: era === 'neg' ? -value : value, digits: digits.length, bce: era === 'neg', eraMarked: era !== null };
}

/**
 * Every connected date expression in a unit, left to right, non-overlapping (S5B-01), under the
 * round-3 allow-list: grouped numbers ("1,000") are masked first with a length-preserving mask so
 * spans stay aligned. Each expression carries its exact [start, end) span (S5B-11), any
 * approximation qualifier stated immediately before it (S5B-13), era-aware range resolution that
 * fails closed on ambiguity (S5B-12/S5B-18), and the clean-context guard verdict computed against
 * `unit` as the available context — buildSourceUnitIndex RECOMPUTES the verdict against the full
 * raw source, so a qualifier detached by a newline can never be left behind. A context-rejected
 * expression grounds nothing but stays year-LIKE for the title-year rule.
 */
export function parseDateExpressions(unit: string): DateExpression[] {
  if (typeof unit !== 'string') return [];
  const masked = unit.replace(GROUPED_NUMBER, m => NUMBER_MASK.repeat(m.length));
  const exprs: DateExpression[] = [];
  let lastEnd = 0;
  const dayNumberOf = (d: string | undefined): number | null =>
    d === undefined ? null : Number(d.replace(/(?:st|nd|rd|th)$/i, ''));
  for (const m of masked.matchAll(DATE_EXPRESSION_RE)) {
    const g = m.groups ?? {};
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const fullText = unit.slice(start, end);
    // S5B-13: an approximation qualifier stated immediately before this expression attaches to it.
    // A WEAK qualifier attaches only when the expression is date-like (a month, a month-day day, or
    // a year-LIKE year: >= 3 digits or BCE), so "about 40 delegates" never fires; a STRONG
    // qualifier ("circa", "c.", "ca.", "approx.") attaches to any parsed expression.
    const qual = qualifierBefore(unit.slice(Math.max(lastEnd, start - QUALIFIER_LOOKBACK_WINDOW), start));
    lastEnd = end;
    // Round-3 clean-context guard, computed against the parsed string (unit-local here; the raw
    // source layer overrides it in buildSourceUnitIndex).
    const contextRejected = contextRejection(masked, start, end);
    const approxFor = (year: number | null, digits: number, bce: boolean, month: number | null, day: number | null): string | null => {
      if (qual === null) return null;
      const dateLike = month !== null || day !== null || (year !== null && (digits >= 3 || bce));
      return qual.strong || dateLike ? normalizeWhitespace(qual.text + fullText) : null;
    };
    const pushOne = (
      form: DateExpression['form'],
      year: number | null,
      digits: number,
      bce: boolean,
      eraMarked: boolean,
      month: number | null,
      day: number | null,
      eraAmbiguous = false,
    ): void => {
      exprs.push({
        year,
        digits,
        bce,
        month,
        day,
        text: fullText,
        start,
        end,
        approx: approxFor(year, digits, bce, month, day),
        eraAmbiguous,
        form,
        eraMarked,
        contextRejected,
      });
    };
    if (g.mdyM !== undefined) {
      const y = yearOf(g.mdyY);
      pushOne('mdy', y?.year ?? null, y?.digits ?? 0, y?.bce ?? false, y?.eraMarked ?? false, monthNumberOf(g.mdyM), dayNumberOf(g.mdyD));
    } else if (g.dmyD !== undefined) {
      const y = yearOf(g.dmyY);
      pushOne('dmy', y?.year ?? null, y?.digits ?? 0, y?.bce ?? false, y?.eraMarked ?? false, monthNumberOf(g.dmyM), dayNumberOf(g.dmyD));
    } else if (g.myM !== undefined) {
      const y = yearOf(g.myY);
      pushOne('my', y?.year ?? null, y?.digits ?? 0, y?.bce ?? false, y?.eraMarked ?? false, monthNumberOf(g.myM), null);
    } else if (g.rngA !== undefined && g.rngB !== undefined) {
      // A range grounds ONLY its explicitly resolvable endpoints (S5B-12/S5B-18). Both endpoints
      // carry the WHOLE range's span: a quote that cuts any part of it (including an era suffix)
      // grounds neither endpoint (S5B-11). Unsupported combinations fail closed, and the consumed
      // span keeps their interior out of the standalone-year branch.
      const aPre = g.rngAPre;
      const aSuf = g.rngASuf;
      const bPre = g.rngBPre;
      const bSuf = g.rngBSuf;
      const aMarked = aPre !== undefined || aSuf !== undefined;
      const bMarked = bPre !== undefined || bSuf !== undefined;
      const aNeg = aPre !== undefined ? prefixIsNegative(aPre) : aSuf !== undefined && eraOfText(aSuf) === 'neg';
      const bNeg = bPre !== undefined ? prefixIsNegative(bPre) : bSuf !== undefined && eraOfText(bSuf) === 'neg';
      const pushEndpoint = (part: string, neg: boolean, eraMarked: boolean): void => {
        const value = Number(part);
        pushOne('range', neg ? -value : value, part.length, neg, eraMarked, null, null);
      };
      if (!aMarked && !bMarked) {
        // No era anywhere: only 3–4 digit endpoints are years ('1775–1783'). An abbreviated right
        // endpoint ('1775–83') is NEVER expanded; a short left endpoint grounds nothing.
        if (g.rngA.length >= 3) pushEndpoint(g.rngA, false, false);
        if (g.rngB.length >= 3) pushEndpoint(g.rngB, false, false);
      } else if (aMarked && bMarked) {
        // Both endpoints carry an explicit era: each takes its own sign ('500 BC–400 AD').
        pushEndpoint(g.rngA, aNeg, true);
        pushEndpoint(g.rngB, bNeg, true);
      } else if (bSuf !== undefined) {
        // A right-endpoint era SUFFIX inherits to the unmarked left endpoint ('500–400 BCE',
        // '50–40 BCE'): an era-suffixed range NEVER emits a positive year.
        pushEndpoint(g.rngA, bNeg, true);
        pushEndpoint(g.rngB, bNeg, true);
      } else if (aPre !== undefined) {
        // A left-endpoint era PREFIX inherits to the unmarked right endpoint ('BCE 500–400').
        pushEndpoint(g.rngA, aNeg, true);
        pushEndpoint(g.rngB, aNeg, true);
      } else {
        // '500 BCE–400' (left suffix only) or '500–BCE 400' (right prefix only): the unmarked
        // endpoint's era is ambiguous — fail closed, but stay year-LIKE for the title-year rule.
        pushOne('range', null, 0, false, true, null, null, true);
      }
    } else if (g.mdM !== undefined) {
      pushOne('md', null, 0, false, false, monthNumberOf(g.mdM), dayNumberOf(g.mdD));
    } else if (g.dmD !== undefined) {
      pushOne('dm', null, 0, false, false, monthNumberOf(g.dmM), dayNumberOf(g.dmD));
    } else if (g.yY !== undefined) {
      // A standalone year with the round-3 era prefix/suffix support: 'in 1855', '500 B.C.',
      // 'A.D. 79', 'BCE 500' (grounds −500, never +500). A suffix wins over a prefix.
      const digitsText = /[0-9]{1,4}/.exec(g.yY)?.[0] ?? '';
      const value = Number(digitsText);
      const sufEra = g.ySuf !== undefined ? eraOfText(g.ySuf) : null;
      const preEra = g.yPre !== undefined ? (prefixIsNegative(g.yPre) ? 'neg' : 'pos') : null;
      const era = sufEra ?? preEra;
      const neg = era === 'neg';
      pushOne('year', neg ? -value : value, digitsText.length, neg, era !== null, null, null);
    } else if (g.mM !== undefined) {
      pushOne('month', null, 0, false, false, monthNumberOf(g.mM), null);
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

/** Every standalone year a unit GROUNDS, as expression-derived tokens (S5B-01: never a token bag;
 * round 3: a context-rejected expression grounds nothing, so it contributes no token). */
function yearTokens(unit: string): YearToken[] {
  return parseDateExpressions(unit)
    .filter(e => e.year !== null && e.contextRejected === null)
    .map(e => ({ signed: e.year as number, digits: e.digits, bce: e.bce }));
}

/** The signed standalone years a unit states (ranges contribute both endpoints, nothing between). */
export function standaloneYears(unit: string): number[] {
  return yearTokens(unit).map(t => t.signed);
}

/**
 * A scope is year-LIKE for the title-year rule when any expression states a standalone 3–4 digit
 * year or any BCE year, or is an era-ambiguous range (S5B-12: an ambiguous range still counts as a
 * year token of the unit). Day numbers ("June 10") are deliberately NOT year-like, otherwise the
 * title-year rule could never apply to a dated sentence.
 */
function hasYearLike(exprs: readonly DateExpression[]): boolean {
  return exprs.some(e => e.eraAmbiguous || (e.year !== null && (e.digits >= 3 || e.bce)));
}

export interface TimelineDateTuple { year: number; month: number; day: number }

/**
 * True when ONE connected date expression states the full claimed date (S5B-01, frozen decision 3):
 * the year — or, via the title-year rule, the title's single year when ONE year-less expression
 * states the month (and day if claimed) and the scope contains no year-like token of its own.
 * Components from different expressions never combine. S5B-13: an approximation-qualified
 * expression grounds nothing; S5B-12: an era-ambiguous range grounds nothing; round 3: an
 * expression whose context is NOT clean (qualifier/bound/era/century/connector/markup within its
 * two-word windows) grounds nothing — fail closed.
 */
function expressionsGroundDate(
  exprs: readonly DateExpression[],
  date: TimelineDateTuple,
  titleYear: number | null,
  yearLike: boolean,
): boolean {
  for (const e of exprs) {
    if (e.approx !== null || e.eraAmbiguous || e.contextRejected !== null) continue;
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

/** Textual unit-level grounding (the expression spans are the unit's own). */
export function unitGroundsDate(unit: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  const exprs = parseDateExpressions(unit);
  return expressionsGroundDate(exprs, date, titleYear, hasYearLike(exprs));
}

/**
 * True when any sentence unit of the quote grounds the date TEXTUALLY (pure quote text). This is
 * the fallback used only where the source documents are unavailable (compareTimelineRevisions
 * without sources); validateSpec grounds against the SOURCE spans instead (S5B-11,
 * sourceQuoteGrounding) — a quote edge cutting a source token grounds nothing there.
 */
export function quoteGroundsDate(quote: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  return sentenceUnits(quote).some(unit => unitGroundsDate(unit, date, titleYear));
}

/**
 * S5B-02 (frozen decision 4) + S5B-13: the title-year rule rejects any title candidate carrying an
 * approximation, range or ambiguity marker — the SAME approximation policy as the unit detector
 * ('circa', 'c.', 'ca.', 'approx.', 'around', 'about', 'roughly', 'sometime', 'early/mid/late/
 * middle'), plus decade forms, year ranges and '?'. A rejected title lends nothing (fail closed).
 */
const TITLE_APPROX_MARKER =
  /\b(?:circa|ca|around|about|roughly|early|mid|late|middle|approx|approximate|approximately|sometime|sometimes)\b|\b(?:c|ca|approx)\.|\?/i;
const TITLE_DECADE_FORM = /[0-9]{3,4}s(?![0-9a-z])/i;
const TITLE_YEAR_RANGE = /(?<![0-9])[0-9]{3,4}\s*[-\u2013\u2014/]\s*[0-9]{2,4}(?![0-9])/;

function titleCandidateRejected(candidate: string): boolean {
  return (
    TITLE_APPROX_MARKER.test(candidate) ||
    TITLE_DECADE_FORM.test(candidate) ||
    TITLE_YEAR_RANGE.test(candidate) ||
    hasApproximateDate(candidate) !== null
  );
}

/**
 * The lead's title-year rule (round-3 decision 4): the source's title field, and the FIRST
 * NON-EMPTY line when that is a '#' heading (hardening: a leading blank line can no longer hide an
 * '(around 1889)' heading), may lend a year to a date unit — but ONLY when EVERY candidate is free
 * of approximation/range/ambiguity markers (S5B-02) AND contains EXACTLY ONE plain (era-free)
 * standalone YYYY whose context passes the SAME clean-context guard as body dates. '(before 1889)',
 * '(by 1889)', '(BCE 1889)' and '(1889 BCE)' lend nothing; candidates that disagree lend nothing.
 */
export function titleYearOf(doc: { title?: unknown; text?: unknown } | null | undefined): number | null {
  const candidates: string[] = [];
  if (typeof doc?.title === 'string' && doc.title.trim() !== '') candidates.push(doc.title);
  if (typeof doc?.text === 'string') {
    const firstLine =
      doc.text
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l !== '') ?? '';
    if (firstLine.startsWith('#')) candidates.push(firstLine.replace(/^#+\s*/, ''));
  }
  if (candidates.length === 0) return null;
  let shared: number | null | undefined;
  for (const candidate of candidates) {
    if (titleCandidateRejected(candidate)) return null; // S5B-02: an approximate/ambiguous title lends nothing
    // Round-3 decision 4: exactly one PLAIN YYYY in clean context — an era-marked year, a range
    // endpoint, a qualified year or a context-rejected year is not a lendable title year.
    const plain = parseDateExpressions(candidate).filter(
      e =>
        e.form === 'year' &&
        e.year !== null &&
        e.digits >= 3 &&
        !e.bce &&
        !e.eraMarked &&
        e.approx === null &&
        e.contextRejected === null,
    );
    const value = plain.length === 1 ? (plain[0]?.year ?? null) : null;
    if (shared === undefined) shared = value;
    else if (shared !== value) return null;
  }
  return shared ?? null;
}

/* ------------------------------------------------------------------ */
/* Approximate dates (contract item 3, Muse finding #10, S5B-02/13)    */
/* ------------------------------------------------------------------ */

const DECADE_FORM = /(?<![0-9])[0-9]{3,4}s(?![0-9a-z])/i;

/**
 * The matched approximate-date wording in a unit, or null. Fires on decade forms anywhere and on an
 * approximation qualifier ATTACHED to a parsed date expression (S5B-13): strong qualifiers
 * ("circa", "c.", "ca.", "approx.") before any expression, weak qualifiers ("around", "about",
 * "roughly", "sometime in") and part-of-period qualifiers ("early/mid/late/middle") only before a
 * DATE-LIKE expression — a month, a month-day day, or a year-like year (>= 3 digits or BCE) — so
 * ordinary prose like "about 40 delegates" never fires. Attachment sees through optional articles
 * and day-first ordinal forms ("around the 4th of July 1776", "about mid-June 1776"), and "c." is
 * protected during unit segmentation, so the qualifier can never be split away from its expression.
 */
export function hasApproximateDate(unit: string): string | null {
  if (typeof unit !== 'string') return null;
  const decade = DECADE_FORM.exec(unit);
  if (decade !== null) return normalizeWhitespace(decade[0]);
  for (const e of parseDateExpressions(unit)) {
    if (e.approx !== null) return e.approx;
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

/** One date expression of a source unit, with its span as RAW offsets into the source text (S5B-11). */
export interface SourceUnitExpression extends DateExpression {
  rawStart: number;
  rawEnd: number;
}

/** A cached per-source view: normalised text, the normalised→raw offset map and the raw unit spans. */
export interface SourceUnitIndex {
  norm: string;
  toRaw: number[];
  units: { start: number; end: number; text: string; exprs: SourceUnitExpression[] }[];
}

export function buildSourceUnitIndex(raw: string): SourceUnitIndex {
  const { text, toRaw } = normalizeWithMap(raw);
  const units = rawUnitSpans(raw).map(s => {
    const slice = raw.slice(s.start, s.end);
    return {
      ...s,
      text: normalizeWhitespace(slice),
      // S5B-11: the date expressions are parsed out of the RAW source unit, so their spans are raw
      // offsets — a located quote can only ground a date through a COMPLETE source expression, and
      // an expression can never cross a source-unit (newline/sentence) boundary.
      // Round 3: the clean-context guard is RECOMPUTED against the FULL raw document, so a
      // qualifier detached by a newline ('circa\nMarch 3, 1889') still disqualifies the expression
      // while a genuine sentence-terminal period delimits the window (S5B-19 fail-closed).
      exprs: parseDateExpressions(slice).map(e => {
        const rawStart = s.start + e.start;
        const rawEnd = s.start + e.end;
        return { ...e, rawStart, rawEnd, contextRejected: contextRejection(raw, rawStart, rawEnd) };
      }),
    };
  });
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
/* Source-span date grounding (S5B-11)                                 */
/* ------------------------------------------------------------------ */

/** How a located quote's source span grounds a claimed date (S5B-11). */
export interface SourceQuoteGrounding {
  /**
   * 'grounded'   — EVERY occurrence's quote span contains a COMPLETE source expression stating the date;
   * 'ungrounded' — no occurrence does;
   * 'ambiguous'  — the occurrences disagree (some state the date, some do not) — always fails closed;
   * 'unlocated'  — the quote does not occur in the source (the verbatim checks report that).
   */
  status: 'grounded' | 'ungrounded' | 'ambiguous' | 'unlocated';
  occurrences: number;
  groundingOccurrences: number;
  /** Complete source expressions CUT by the quote edge (a quote edge never completes an expression). */
  cutExpressions: string[];
  /** The complete source expressions lying wholly inside the quote span (diagnosis). */
  statedExpressions: string[];
  /**
   * Round 3: contained expressions whose source context is NOT clean (qualifier/bound/era/
   * century/connector/markup within the two-word windows) — they ground nothing (fail closed).
   * Each entry is '"<expression>" (<reason>)' for the repair-prompt diagnosis.
   */
  contextRejectedExpressions: string[];
}

/**
 * S5B-11: ground a claimed date against the SOURCE, not the quote's edges. Every occurrence of the
 * whitespace-normalised quote is located and mapped back to its raw source span; the date is
 * grounded only by a COMPLETE source date expression — parsed out of ONE source sentence/heading
 * unit with its era/range syntax intact — lying wholly inside the quoted span. A quote edge
 * cutting a token ('March 3' from 'March 30', '1889' from '1889 BCE') manufactures nothing, and a
 * normalised quote crossing a source-unit boundary never joins expressions across it. Sign,
 * precision and title-year inheritance are read from the complete source expression and its unit;
 * approximation-qualified expressions ground nothing (S5B-13), and — round-3 lead decision — an
 * expression whose surrounding source context is not clean grounds nothing either (fail closed).
 * Occurrences that disagree on grounding fail closed, exactly like the S5B-02 mixed-context rule.
 */
export function sourceQuoteGrounding(
  index: SourceUnitIndex,
  quote: string,
  date: TimelineDateTuple,
  titleYear: number | null,
): SourceQuoteGrounding {
  const result: SourceQuoteGrounding = {
    status: 'unlocated',
    occurrences: 0,
    groundingOccurrences: 0,
    cutExpressions: [],
    statedExpressions: [],
    contextRejectedExpressions: [],
  };
  const needle = normalizeWhitespace(quote);
  if (needle === '') return result;
  const cut = new Set<string>();
  const stated = new Set<string>();
  const rejected = new Set<string>();
  let from = index.norm.indexOf(needle);
  while (from !== -1) {
    result.occurrences++;
    const to = from + needle.length - 1;
    const rawStart = index.toRaw[from] ?? 0;
    const rawEnd = (index.toRaw[to] ?? rawStart) + 1;
    let occurrenceGrounded = false;
    for (const u of index.units) {
      if (u.start >= rawEnd || u.end <= rawStart) continue; // no overlap with this occurrence
      const contained = u.exprs.filter(e => e.rawStart >= rawStart && e.rawEnd <= rawEnd);
      for (const e of u.exprs) {
        const overlaps = e.rawStart < rawEnd && e.rawEnd > rawStart;
        if (overlaps && !(e.rawStart >= rawStart && e.rawEnd <= rawEnd)) cut.add(normalizeWhitespace(e.text));
      }
      const clean = contained.filter(e => e.contextRejected === null);
      for (const e of clean) stated.add(normalizeWhitespace(e.text));
      for (const e of contained) {
        if (e.contextRejected !== null) {
          rejected.add(`"${normalizeWhitespace(e.text)}" (${e.contextRejected})`);
        }
      }
      // The title-year rule reads year-likeness from the FULL source unit, not the quoted fragment
      // (a context-rejected year still counts as year-LIKE and suppresses title-year inheritance).
      if (expressionsGroundDate(clean, date, titleYear, hasYearLike(u.exprs))) occurrenceGrounded = true;
    }
    if (occurrenceGrounded) result.groundingOccurrences++;
    from = index.norm.indexOf(needle, from + 1);
  }
  if (result.occurrences === 0) return result;
  result.cutExpressions = [...cut];
  result.statedExpressions = [...stated];
  result.contextRejectedExpressions = [...rejected];
  result.status =
    result.groundingOccurrences === result.occurrences
      ? 'grounded'
      : result.groundingOccurrences === 0
        ? 'ungrounded'
        : 'ambiguous';
  return result;
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
  unitIndexOf: (sourceId: string) => SourceUnitIndex | null,
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
    // S5B-11: ground against the SOURCE span of the located quote, never against the quote's own
    // tokenisation — only a COMPLETE source date expression inside the quoted span counts.
    const index = unitIndexOf(String(q.sourceId));
    if (index === null) {
      quoteNotes.push(`quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" cites source "${String(q.sourceId)}", whose text could not be indexed`);
      continue;
    }
    const titleYear = titleYearFor(q.sourceId);
    const g = sourceQuoteGrounding(index, quote, date, titleYear);
    if (g.status === 'grounded') return null; // grounded by ONE complete source expression
    if (g.status === 'ambiguous') {
      quoteNotes.push(
        `quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" occurs ${g.occurrences}× in source "${String(q.sourceId)}" and only ${g.groundingOccurrences} of those occurrences contain a COMPLETE source date expression stating ${formatTimelineDate(date)} — failing closed on the ambiguity`,
      );
      continue;
    }
    if (g.status === 'unlocated') {
      // Defensive: the verbatim check above already passed, so this should not occur.
      quoteNotes.push(`quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" could not be located in source "${String(q.sourceId)}"`);
      continue;
    }
    const cutNote =
      g.cutExpressions.length > 0
        ? ` — the source states ${g.cutExpressions.map(t => `"${truncate(t, QUOTE_MESSAGE_LIMIT)}"`).join(', ')} but the quote CUTS that expression at its edge (a quote edge inside a token never completes a date expression; quote the expression exactly as the source states it)`
        : '';
    const rejectedNote =
      g.contextRejectedExpressions.length > 0
        ? ` — the quote contains ${g.contextRejectedExpressions.map(t => truncate(t, QUOTE_MESSAGE_LIMIT)).join(', ')} but that expression's source context is NOT clean (an approximation qualifier, temporal bound, unconsumed era token, century wording, alternative, range connector + number, '?' or markup within two words of it grounds nothing — fail closed)`
        : '';
    const statedNote =
      g.statedExpressions.length > 0
        ? ` (the complete, clean-context source expressions inside the quote state: ${g.statedExpressions.map(t => `"${truncate(t, QUOTE_MESSAGE_LIMIT)}"`).join(', ')})`
        : ` (the quote contains no complete clean-context source date expression at all)`;
    quoteNotes.push(
      `quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" contains no COMPLETE source date expression stating ${formatTimelineDate(date)} as ONE connected expression in a CLEAN context${cutNote}${rejectedNote}${statedNote}` +
        (titleYear !== null
          ? ` (the source title states year ${titleYear}, borrowable only into a COMPLETE year-less source expression stating the month and day in ONE expression, in a source unit with no other year)`
          : ''),
    );
  }
  return `event "${String(ev?.id)}" (${formatTimelineDate(date)}): date not grounded — ${quoteNotes.length > 0 ? quoteNotes.join('; ') : 'the event has no evidence quotes'}`;
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
            message: `no approximate dates: none of the ${quoteCount} event quote(s) across ${events.length} event(s) — nor any FULL source sentence/heading unit containing one — states a decade form ("1770s") or attaches an approximation qualifier ("circa", "c.", "ca.", "approx.", "around", "about", "roughly", "sometime in", "early/mid/late" — including article and day-first forms like "around the 4th of July 1776") to a date expression`,
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
        const failure = eventGroundingFailure(ev, textOf, titleYearFor, unitIndexOf);
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
            message: `all ${grounded} event date(s) are stated by ONE COMPLETE connected date expression of the SOURCE in a CLEAN context (round-3 allow-list: no qualifier, temporal bound, unconsumed era token, century wording, alternative, range connector + number, '?' or markup within two words) lying inside ONE sentence unit of a counted verbatim quote's located source span: the year (directly, or from a clean source title stating exactly one plain year when one expression states the month and day), plus the month and day where stated`,
          }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected each event's full stated date in ONE COMPLETE connected source date expression IN A CLEAN CONTEXT inside ONE sentence unit of the quote's located source span — a quote edge cutting a source token grounds nothing, an unrecognised or unclean form fails closed, and the year may come from the source title only under the title-year rule)`,
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
  /** The source documents, for an EXACT recomputation of the baseline grounding (the ONLY
   * authoritative path — without them date/evidence/pair mutation fails closed, S5B-17). */
  sources?: SourceDocument[];
  /**
   * repairFindings() of the BASELINE report. S5B-03 (frozen decisions 1+2): authorization is read
   * ONLY from validator-owned `affected` field paths — never from finding messages. S5B-15/S5B-17:
   * when `sources` are present these findings may only NARROW the recomputed immutable-r1
   * authority (intersection by exact check id AND exact affected path), CONSISTENTLY — an empty
   * or wrong-scope list narrows a genuine failure to nothing; without sources they unlock at most
   * the label string of a policy finding.
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
 * plan line 'No-weakening for repair'; field-scoped per S5B-03, frozen decisions 1+2; ONE
 * AUTHORITY per S5B-17 and the round-3 lead decision):
 * - the engine must be timeline-v1 on both revisions;
 * - no new event ids; the event count never exceeds the baseline and never drops below 5;
 * - WITH SOURCES (the only authoritative path): the ONLY per-event grounding result is the
 *   source-span validator's, read from an EXACT revalidation of the immutable baseline
 *   (validateTimelineSpec). Every event/pair unlock is derived EXCLUSIVELY from that recomputed
 *   revision-1 check/path map — the quote-only quoteGroundsDate fallback is GONE from
 *   authorization (S5B-17: it disagreed with the source-span validator and let a worker rewrite a
 *   PASSING event's date while repairing an unrelated label). Caller-supplied findings may only
 *   NARROW the recomputed authority (intersection by exact check id AND exact affected path),
 *   CONSISTENTLY: an empty findings array, a wrong-check-id finding or a wrong-field finding
 *   narrows a genuine date failure to nothing (fail closed);
 * - WITHOUT SOURCES the baseline cannot be recomputed: date/evidence/pair mutation fails closed —
 *   every event stays frozen, caller findings unlock at most the label string of a policy finding,
 *   and the only pair exception is a pair that is provably wrong/ambiguous from the baseline
 *   spec's OWN event dates (the ordering oracle needs no source text);
 * - field scoping (decision 2): a label/name/id/policy finding unlocks that STRING only — dates,
 *   other quotes and ordering pairs stay frozen; a grounding.quotes finding on an event's evidence
 *   unlocks that evidence only; only a date-class path (timeline.date-grounded /
 *   timeline.approximate-date / timeline.distinct-dates) of the recomputed map unlocks
 *   date+evidence (or removal); only timeline.case-order (or a unique-ids/schema pair-field
 *   violation, or an event removed/re-grounded under its own unlock) unlocks that case's pair — a
 *   renamed case keeps its pair;
 * - authorization NEVER comes from substring searches over rendered finding messages: a
 *   model-controlled label quoting another item's id unlocks nothing (S5B-03);
 * - tests/predictions keep (name/id, occurrence) identity with the numeric engines' rules, incl.
 *   the single publisher-policy rename exception.
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
  // S5B-17: `failedOnBaseline` is caller-supplied display metadata; with sources the recomputed
  // baseline report is the only authority, and without sources nothing is recomputable — so the
  // list no longer authorizes anything on either path (the without-sources pair exception below
  // recomputes the ordering from the baseline spec itself).
  void failedOnBaseline;
  try {
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
        message: `repair weakened the spec: ${list} (a timeline repair must fix the failing checks without changing the engine, adding events, dropping the event count below ${MIN_EVENTS}, removing or rewriting an event that passed its date checks on the baseline, or changing a case pair that was strictly ordered on the baseline; only an item that failed the recomputed baseline checks, or the exact fields where a finding's affected paths intersect the recomputed baseline failures, may change)`,
      };
    };
    if (!enginesOk) return wrap();

    const pEvents = looseEvents(p);
    const nEvents = looseEvents(n);
    const findings = Array.isArray(context?.findings) ? context?.findings : undefined;

    // S5B-03 (frozen decisions 1+2) + S5B-15 + S5B-17 (round-3 lead decision, ONE AUTHORITY): the
    // repair unlock scopes. When the source documents are present, authorization is derived
    // EXCLUSIVELY from the failing checks of an EXACT revalidation of the immutable baseline;
    // caller-supplied findings may only NARROW that authority (intersection by check id AND exact
    // affected path), never broaden it — CONSISTENTLY, so a finding list that is empty, names a
    // check that passed on recomputation, or names a path the recomputed failure does not name,
    // unlocks NOTHING (a genuine date failure then stays frozen: fail closed rather than letting a
    // second authority disagree with the source-span validator). Without sufficient source context
    // the comparator fails closed: caller-supplied findings can never unlock an event's
    // date/evidence (or removal) or a case pair; only the label-string unlock of a policy finding
    // survives. Finding messages and the display `path` are never searched for ids or names.
    const scopes = emptyScopes();
    const sourceDocs = Array.isArray(context?.sources) ? (context?.sources as SourceDocument[]) : [];
    /**
     * S5B-17: the CANONICAL per-event grounding result — the event indices whose date checks
     * FAILED on the recomputed revision-1 report (the source-span validator is the single
     * authority). Empty without sources, where every event is treated as frozen (fail closed).
     */
    const canonicalFailedEvents = new Set<number>();
    const canonicalKnown = sourceDocs.length > 0;
    if (canonicalKnown) {
      const baselineReport = validateTimelineSpec(baseline, sourceDocs);
      const failingPaths = new Map<string, Set<string>>();
      for (const c of baselineReport.checks) {
        if (!c.passed) {
          failingPaths.set(c.id, new Set(Array.isArray(c.affected) ? c.affected.filter((x): x is string => typeof x === 'string') : []));
        }
      }
      for (const [checkId, paths] of failingPaths) {
        if (!DATE_CLASS_IDS.has(checkId)) continue;
        for (const path of paths) {
          const m = EVENT_AFFECTED_RE.exec(path);
          if (m !== null) canonicalFailedEvents.add(Number(m[1]));
        }
      }
      if (findings === undefined) {
        for (const [checkId, paths] of failingPaths) addCheckScopes(checkId, [...paths], scopes);
      } else {
        for (const f of findings) {
          if (typeof f !== 'object' || f === null) continue;
          const fid = (f as RepairFinding).id;
          if (typeof fid !== 'string') continue;
          const allowed = failingPaths.get(fid);
          if (allowed === undefined) continue; // S5B-15: a check that PASSED on recomputation authorizes nothing
          const paths = affectedOfFinding(f).filter(p => allowed.has(p));
          if (paths.length > 0) addCheckScopes(fid, paths, scopes);
        }
      }
    } else if (findings !== undefined) {
      // S5B-15/S5B-17 fail closed: without the source documents the baseline cannot be recomputed,
      // so caller-supplied findings unlock ONLY the label string of a policy finding — never an
      // event's date/evidence (or removal) and never a case pair.
      for (const f of findings) {
        if (typeof f !== 'object' || f === null) continue;
        const fid = (f as RepairFinding).id;
        if (fid !== 'policy.no-publisher-attribution') continue;
        addCheckScopes(fid, affectedOfFinding(f), scopes);
      }
    }

    /**
     * S5B-17: unlocks come ONLY from `scopes` — the recomputed revision-1 check/path map, narrowed
     * by the caller findings when present. There is NO textual fallback: with sources the canonical
     * source-span result is already encoded in the map, and without sources nothing may re-ground.
     */
    const eventMayReground = (_ev: TimelineEvent, index: number): boolean => scopes.eventDate.has(index);
    const eventMayBeRemoved = (_ev: TimelineEvent, index: number): boolean =>
      scopes.eventDate.has(index) || scopes.eventRemove.has(index);

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
      // S5B-17: with sources the canonical per-event result says whether this event's date checks
      // FAILED on the recomputed baseline; without sources every event is frozen (fail closed) and
      // the wording stays the conservative 'passed' phrasing.
      const canonicallyFailed = canonicalKnown && canonicalFailedEvents.has(i);
      const lockedFailureNote = canonicallyFailed
        ? ' without authorization: its baseline date-check failure is NOT unlocked (caller findings may only narrow the recomputed revision-1 affected paths by exact check id and path, and nothing named this event)'
        : ' even though its date check passed on the baseline';
      if (match === undefined) {
        if (mayReground || scopes.eventRemove.has(i)) removedModifiableIds.add(k);
        else {
          problems.push(
            canonicallyFailed
              ? `event "${k}" (${formatTimelineDate(ev)}) was removed${lockedFailureNote}`
              : `event "${k}" (${formatTimelineDate(ev)}) was removed even though its date check passed on the baseline (only an event that failed its date checks, or one a date-class finding's affected paths name, may be re-grounded or removed)`,
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
        const scopeNote = mayReground || canonicallyFailed
          ? ''
          : labelUnlocked || evidenceUnlocked
            ? ` (a finding unlocks only its ${[labelUnlocked ? 'label' : null, evidenceUnlocked ? 'evidence quotes' : null].filter(Boolean).join(' and ')}; dates stay frozen without a date-class finding)`
            : ' (an event that passed keeps its id, label, date and quotes unless a date-class finding names it)';
        problems.push(`event "${k}" changed (${violations.join(', ')})${lockedFailureNote}${scopeNote}`);
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
        // S5B-17: with sources the recomputed revision-1 map is the ONLY pair authority (a wrong or
        // ambiguous pair fails timeline.case-order there and lands in scopes.casePair; an unknown
        // reference lands there via timeline.unique-ids). Without sources nothing is recomputable
        // from text, but the ordering oracle itself needs no source: a pair that is provably
        // wrong/ambiguous from the baseline spec's OWN event dates may still be fixed.
        scopes.casePair.has(`${list}/${baselineIndex}`) ||
        (!canonicalKnown && caseWasWrong(bc)) ||
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
