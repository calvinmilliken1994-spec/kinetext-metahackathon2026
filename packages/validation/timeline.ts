// TASK-020 — timeline-v1 deterministic validation (Stage 5b plan 'Revised checks' + Muse design
// review dispositions #1–#10 and the lead's title-year decision of 2026-10-28).
//
// A timeline has no formula, so the SOURCE TEXT is the deterministic oracle:
//   date-grounded   every event's full stated date (year, and month/day where stated) must appear
//                 in ONE sentence unit of a counted, verbatim evidence quote. The year may instead
//                 come from the source title, but only when the title states exactly one standalone
//                 year, the event's year equals it, the unit states the month (and day if claimed)
//                 and the unit contains no year of its own. No other cross-sentence inheritance.
//   approximate     decade forms ("1770s") and "circa/c./ca./around/about/early/mid/late" before a
//                 year or month fire FIRST with "approximate date — remove this event"; a decade
//                 form never counts as a standalone year.
//   distinct-dates  no two events share a (year, month, day) tuple (no same-quote exception, #7).
//   case-order      every test/prediction answer is recomputed: earlierEventId must be strictly
//                 earlier at the precision BOTH events state; equal precision-truncations are
//                 ambiguous, never graded by array position (#5).
// Year matching (Muse #1, #4): grouped numbers ("1,000") are masked first; a year is a standalone
// 1–4 digit number ((^|[^0-9])YEAR($|[^0-9]) semantics via lookarounds), so ranges ground only
// their endpoints; a BCE marker ("BCE", "BC", "B.C.", "B.C.E.") directly after the number makes it
// negative and forbids the positive reading. Month names come from a fixed case-insensitive list
// incl. "Sep(t)?(ember)?" with an optional period (#9); a day is \b0?DAY(st|nd|rd|th)?\b and is
// only counted in the unit that also states the month (#2, #3).
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
/** Finding ids whose findings may unlock an otherwise frozen EVENT (scoped per failing check). */
const EVENT_UNLOCK_IDS = new Set([
  'schema.full',
  'timeline.unique-ids',
  'timeline.approximate-date',
  'timeline.date-grounded',
  'timeline.distinct-dates',
  'grounding.quotes',
  'policy.no-publisher-attribution',
]);
/** Finding ids whose findings may unlock an otherwise frozen CASE pair. */
const CASE_UNLOCK_IDS = new Set(['schema.full', 'timeline.unique-ids', 'timeline.case-order', 'policy.no-publisher-attribution']);

/* ------------------------------------------------------------------ */
/* Sentence units (contract item 1)                                    */
/* ------------------------------------------------------------------ */

const ABBREV_MASK = '\u0001';
/** Era abbreviations never split units; a month abbreviation's period only survives before a number ("Sept. 4"). */
const ABBREV_PERIOD = /\b(?:B\.C\.E\.|B\.C\.|A\.D\.|B\.C\.E|B\.C|A\.D)(?![A-Za-z])|\b(?:jan|feb|mar|apr|aug|sep|sept|oct|nov|dec)\.(?=\s?[0-9])/gi;
const SENTENCE_SPLIT = /(?<=[.!?;])\s+/;

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

export interface YearToken {
  /** The year as stated, signed: negative exactly when a BCE marker follows the number. */
  signed: number;
  /** Digit length as written (leading zeros included). */
  digits: number;
  bce: boolean;
}

/** Every standalone year number in a unit: grouped numbers masked first, decade forms excluded. */
function yearTokens(unit: string): YearToken[] {
  const masked = typeof unit === 'string' ? unit.replace(GROUPED_NUMBER, NUMBER_MASK) : '';
  const tokens: YearToken[] = [];
  for (const m of masked.matchAll(/(?<![0-9])([0-9]{1,4})(?![0-9])/g)) {
    const rest = masked.slice((m.index ?? 0) + m[0].length);
    // A decade form ("the 1770s") is approximate and never a standalone year (plan: out of scope).
    if (/^s(?![a-z])/i.test(rest)) continue;
    const bce = BCE_MARKER.test(rest);
    const value = Number(m[1]);
    tokens.push({ signed: bce ? -value : value, digits: (m[1] ?? '').length, bce });
  }
  return tokens;
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

/** Muse #9: the fixed month list, case-insensitive, period optional, word boundaries. */
const MONTH_SOURCES = [
  'jan(?:uary)?', 'feb(?:ruary)?', 'mar(?:ch)?', 'apr(?:il)?', 'may', 'jun(?:e)?',
  'jul(?:y)?', 'aug(?:ust)?', 'sep(?:t(?:ember)?)?', 'oct(?:ober)?', 'nov(?:ember)?', 'dec(?:ember)?',
];

export function monthInUnit(unit: string, month: number): boolean {
  const src = MONTH_SOURCES[month - 1];
  if (src === undefined) return false;
  return new RegExp(`\\b${src}\\b\\.?`, 'i').test(unit);
}

/** Muse #1: day = \b0?DAY(st|nd|rd|th)?\b, case-insensitive ("4", "04", "4th"). */
export function dayInUnit(unit: string, day: number): boolean {
  if (!Number.isInteger(day) || day < 1 || day > 31) return false;
  return new RegExp(`\\b0?${day}(?:st|nd|rd|th)?\\b`, 'i').test(unit);
}

export interface TimelineDateTuple { year: number; month: number; day: number }

/**
 * True when ONE unit states the full claimed date: the year (signed rule) — or, via the title-year
 * rule, the title's single year when the unit states the month (and day if claimed) and contains no
 * year-like token of its own — plus the month and day where the event states them.
 */
export function unitGroundsDate(unit: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  if (date.month !== 0 && !monthInUnit(unit, date.month)) return false;
  if (date.day !== 0 && !dayInUnit(unit, date.day)) return false;
  if (standaloneYears(unit).includes(date.year)) return true;
  return titleYear !== null && date.year === titleYear && date.month !== 0 && !containsYearLike(unit);
}

/** True when any sentence unit of the quote grounds the date (pure text; verbatim checked elsewhere). */
export function quoteGroundsDate(quote: string, date: TimelineDateTuple, titleYear: number | null): boolean {
  return sentenceUnits(quote).some(unit => unitGroundsDate(unit, date, titleYear));
}

/**
 * The lead's title-year rule: the source's title field (and its first text line when that is a '#'
 * heading) may lend its year to a date unit. Returns the year when EVERY available title candidate
 * states exactly one standalone year-like number and all candidates agree; otherwise null (a title
 * with two years grants nothing).
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
    const years = yearTokens(candidate).filter(t => t.digits >= 3 || t.bce);
    const value = years.length === 1 ? (years[0]?.signed ?? null) : null;
    if (shared === undefined) shared = value;
    else if (shared !== value) return null;
  }
  return shared ?? null;
}

/* ------------------------------------------------------------------ */
/* Approximate dates (contract item 3, Muse finding #10)               */
/* ------------------------------------------------------------------ */

const MONTH_ALT = `(?:${MONTH_SOURCES.join('|')})`;
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
    let best: string[] | null = null;
    for (const unit of sentenceUnits(quote)) {
      const missing: string[] = [];
      const years = standaloneYears(unit);
      const yearOk =
        years.includes(ev.year) ||
        (titleYear !== null && ev.year === titleYear && ev.month !== 0 && !containsYearLike(unit));
      if (!yearOk) {
        missing.push(years.length > 0 ? `year ${ev.year} (the unit states ${years.join(', ')})` : `year ${ev.year}`);
      }
      if (ev.month !== 0 && !monthInUnit(unit, ev.month)) missing.push(`month ${ev.month}`);
      if (ev.day !== 0 && !dayInUnit(unit, ev.day)) missing.push(`day ${ev.day}`);
      if (missing.length === 0) return null; // grounded in this unit
      if (best === null || missing.length < best.length) best = missing;
    }
    quoteNotes.push(
      `quote "${truncate(quote, QUOTE_MESSAGE_LIMIT)}" has no sentence unit stating ${best === null ? 'the date' : best.join(' and ')}` +
        (titleYear !== null
          ? ` (the source title states year ${titleYear}, borrowable only into a unit that states the month and no other year)`
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
    return {
      artifactId,
      revision: 1,
      checks: [
        {
          id: 'schema.full',
          kind: 'schema',
          passed: false,
          message: schemaFailureMessage(timelineSchemaValidate, 'spec failed schema.full'),
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

  const checks: ValidationCheck[] = [
    {
      id: 'schema.full',
      kind: 'schema',
      passed: true,
      message: `spec matches activity-spec.full.${TIMELINE_ENGINE_ID}.json (draft-07)`,
    },

    guarded('timeline.unique-ids', 'semantic', () => {
      const problems: string[] = [];
      let firstPath: string | undefined;
      const note = (path: string, problem: string): void => {
        if (firstPath === undefined) firstPath = path;
        problems.push(problem);
      };
      const eventDups = duplicates(events.map(e => String(e.id)));
      if (eventDups.length > 0) note('/simulation/events', `duplicate event ids: ${eventDups.join(', ')}`);
      const expDups = duplicates(s.explanations.map(e => e.id));
      if (expDups.length > 0) note('/explanations', `duplicate explanation ids: ${expDups.join(', ')}`);
      const predDups = duplicates(s.predictions.map(p => String(p.id)));
      if (predDups.length > 0) note('/predictions', `duplicate prediction ids: ${predDups.join(', ')}`);
      const testDups = duplicates(s.behavioralTests.map(b => String(b.name)));
      if (testDups.length > 0) note('/behavioralTests', `duplicate behavioral test names: ${testDups.join(', ')}`);
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
              note(`/${list}/${i}`, `${list}[${i}] "${key}" references unknown ${field} "${String(c[field])}" (expected an event id; events: ${knownList})`);
            }
          }
          if (c.earlierEventId === c.laterEventId) {
            note(`/${list}/${i}`, `${list}[${i}] "${key}": earlierEventId and laterEventId are both "${String(c.earlierEventId)}" (expected two different events)`);
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
        : { passed: false, message: `${problems.join('; ')} (expected unique ids and case pairs of two different existing events)`, path: firstPath };
    }),

    guarded('timeline.approximate-date', 'grounding', () => {
      const problems: string[] = [];
      let firstPath: string | undefined;
      let quoteCount = 0;
      events.forEach((ev, i) => {
        for (const q of Array.isArray(ev.evidence) ? ev.evidence : []) {
          quoteCount++;
          if (typeof q?.quote !== 'string') continue;
          for (const unit of sentenceUnits(q.quote)) {
            const marker = hasApproximateDate(unit);
            if (marker === null) continue;
            if (firstPath === undefined) firstPath = `/simulation/events/${i}`;
            problems.push(
              `event "${ev.id}" (${formatTimelineDate(ev)}): approximate date — remove this event; quote "${truncate(q.quote, QUOTE_MESSAGE_LIMIT)}" sentence unit "${truncate(unit, QUOTE_MESSAGE_LIMIT)}" states "${marker}"`,
            );
            break; // one problem per quote is enough
          }
        }
      });
      return problems.length === 0
        ? {
            passed: true,
            message: `no approximate dates: none of the ${quoteCount} event quote(s) across ${events.length} event(s) states a decade form ("1770s"), "circa", "c.", "ca.", "around", "about" or "early/mid/late" before a year or month`,
          }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected exact dates stated by the source; events with only approximate dates are excluded by the prompt and must be removed)`,
            path: firstPath,
          };
    }),

    guarded('timeline.date-grounded', 'grounding', () => {
      const problems: string[] = [];
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
      });
      return problems.length === 0
        ? {
            passed: true,
            message: `all ${grounded} event date(s) are stated in ONE sentence unit of a counted verbatim quote: the year (directly, or from a source title stating exactly one year when the unit states the month), plus the month and day where stated`,
          }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected each event's full stated date in ONE sentence unit of a verbatim evidence quote; the year may come from the source title only under the title-year rule)`,
            path: firstPath,
          };
    }),

    guarded('timeline.distinct-dates', 'semantic', () => {
      const problems: string[] = [];
      let firstPath: string | undefined;
      const byDate = new Map<string, TimelineEvent>();
      events.forEach((ev, i) => {
        const key = `${ev.year}|${ev.month}|${ev.day}`;
        const prev = byDate.get(key);
        if (prev !== undefined) {
          if (firstPath === undefined) firstPath = `/simulation/events/${i}`;
          problems.push(
            `events "${prev.id}" and "${ev.id}" both state ${formatTimelineDate(ev)} (expected distinct dates; ties make ordering questions ambiguous)`,
          );
          return;
        }
        byDate.set(key, ev);
      });
      return problems.length === 0
        ? { passed: true, message: `all ${events.length} event (year, month, day) tuples are distinct` }
        : { passed: false, message: problems.join('; '), path: firstPath };
    }),

    guarded('timeline.case-order', 'behavioral', () => {
      const problems: string[] = [];
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
        });
      }
      return problems.length === 0
        ? {
            passed: true,
            message: `all ${s.behavioralTests.length} behavioral test(s) and ${s.predictions.length} prediction(s) recomputed from the event dates: earlierEventId is strictly earlier than laterEventId at the precision both events state`,
          }
        : { passed: false, message: problems.join('; '), path: firstPath };
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
      const unknownCited = citedIds.filter(id => !specIdSet.has(id));
      if (unknownCited.length > 0) {
        problems.push(
          `evidence cites sourceId(s) not declared in spec.sources: ${unknownCited.join(', ')} (declared: ${specSourceIds.join(', ') || 'none'})`,
        );
      }
      const missingDocs = specSourceIds.filter(id => !docById.has(id));
      if (missingDocs.length > 0) {
        problems.push(
          `spec.sources id(s) with no matching document provided: ${missingDocs.join(', ')} (provided: ${[...docById.keys()].join(', ') || 'none'})`,
        );
      }
      return problems.length === 0
        ? { passed: true, message: `all references resolve: ${specSourceIds.length} spec source(s), ${citedIds.length} cited sourceId(s)` }
        : { passed: false, message: problems.join('; '), path: '/sources' };
    }),

    guarded('refs.sha256', 'grounding', () => {
      const problems: string[] = [];
      let verified = 0;
      for (const src of s.sources) {
        const doc = docById.get(String(src.id));
        if (!doc) continue; // unresolvable references are reported by refs.sources
        verified++;
        if (doc.sha256 !== src.sha256) {
          problems.push(`source "${src.id}": spec sha256 ${String(src.sha256)} != stored document sha256 ${String(doc.sha256)}`);
        }
        const recomputed = typeof doc.text === 'string' ? sha256(doc.text) : undefined;
        if (recomputed !== src.sha256) {
          problems.push(
            `source "${src.id}": spec sha256 ${String(src.sha256)} != sha256(document.text) ${recomputed ?? '(document has no text)'}`,
          );
        }
      }
      return problems.length === 0
        ? { passed: true, message: `sha256 verified for ${verified} source(s): stored hash and recomputed text hash both match the spec` }
        : {
            passed: false,
            message: `${problems.join('; ')} (expected spec sha256 == document sha256 == sha256(document.text))`,
            path: '/sources',
          };
    }),

    guarded('grounding.quotes', 'grounding', () => {
      const failures: string[] = [];
      let firstPath: string | undefined;
      const fail = (path: string, message: string): void => {
        if (firstPath === undefined) firstPath = path;
        failures.push(message);
      };
      let counted = 0;
      let located = 0;
      for (const ex of s.explanations) {
        let countedForExplanation = 0;
        for (const ev of ex.evidence) {
          counted++;
          if (!quoteCountsAsEvidence(ev.quote)) {
            fail(
              '/explanations',
              `quote "${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
            );
            continue;
          }
          countedForExplanation++;
          const text = textOf(ev.sourceId);
          if (text === undefined) continue; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(ev.quote))) {
            fail('/explanations', `"${truncate(ev.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${ev.sourceId}, explanation ${ex.id}) not found in the source text`);
          } else {
            located++;
          }
        }
        if (countedForExplanation === 0) {
          fail('/explanations', `explanation "${ex.id}" has no counted evidence quote (expected >= 1)`);
        }
      }
      events.forEach((ev, i) => {
        let countedForEvent = 0;
        for (const q of Array.isArray(ev.evidence) ? ev.evidence : []) {
          counted++;
          if (!quoteCountsAsEvidence(q?.quote)) {
            fail(
              `/simulation/events/${i}`,
              `quote "${truncate(q?.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${String(q?.sourceId)}, event "${ev.id}") does not count as evidence: expected >= ${QUOTE_MIN_NORMALIZED_CHARS} normalised characters with >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits, or a compact equation containing "=" with >= ${QUOTE_EQUATION_MIN_NORMALIZED_CHARS} normalised characters and >= ${QUOTE_MIN_LETTER_DIGITS} letters/digits`,
            );
            continue;
          }
          countedForEvent++;
          const text = textOf(q.sourceId);
          if (text === undefined) continue; // unresolvable references are reported by refs.sources
          if (!text.includes(normalizeWhitespace(q.quote))) {
            fail(`/simulation/events/${i}`, `"${truncate(q.quote, QUOTE_MESSAGE_LIMIT)}" (sourceId ${q.sourceId}, event "${ev.id}") not found in the source text`);
          } else {
            located++;
          }
        }
        if (countedForEvent === 0) {
          fail(`/simulation/events/${i}`, `event "${ev.id}" has no counted evidence quote (expected >= 1)`);
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
  /** repairFindings() of the BASELINE report: a finding names the item its path/message points at. */
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

/** True when a finding's path points at the item, or an allowed-id finding's message quotes its name. */
function findingNamesItem(
  findings: RepairFinding[] | undefined,
  allowedIds: Set<string>,
  path: string,
  quotedNames: string[],
): boolean {
  if (!Array.isArray(findings)) return false;
  for (const f of findings) {
    if (typeof f !== 'object' || f === null) continue;
    if (typeof f.path === 'string' && (f.path === path || f.path.startsWith(`${path}/`))) return true;
    if (typeof f.id === 'string' && allowedIds.has(f.id) && typeof f.message === 'string') {
      for (const name of quotedNames) {
        if (name !== '' && f.message.includes(`"${name}"`)) return true;
      }
    }
  }
  return false;
}

function eventChanges(a: TimelineEvent, b: TimelineEvent): string[] {
  const changes: string[] = [];
  if (a.label !== b.label) changes.push(`label "${a.label}" -> "${b.label}"`);
  if (a.year !== b.year) changes.push(`year ${a.year} -> ${b.year}`);
  if (a.month !== b.month) changes.push(`month ${a.month} -> ${b.month}`);
  if (a.day !== b.day) changes.push(`day ${a.day} -> ${b.day}`);
  if (JSON.stringify(a.evidence) !== JSON.stringify(b.evidence)) changes.push('evidence quotes changed');
  return changes;
}

function sameDate(a: TimelineEvent, b: TimelineEvent): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Timeline no-weakening against the IMMUTABLE revision-1 baseline (Muse disposition #6, simplified;
 * plan line 'No-weakening for repair'):
 * - the engine must be timeline-v1 on both revisions;
 * - no new event ids; the event count never exceeds the baseline and never drops below 5;
 * - an event whose date grounding passed on the baseline keeps its id, label, year, month, day and
 *   evidence unchanged unless a baseline finding names it; an event that FAILED (date-grounded or
 *   approximate-date, recomputed here from the baseline itself) may be re-grounded or removed;
 * - tests/predictions keep (name/id, occurrence) identity with the numeric engines' rules, incl. the
 *   single publisher-policy rename exception; a matched case may change its pair only when the pair
 *   failed timeline.case-order on the baseline, a finding names it, its event was removed after
 *   failing, or its event was legitimately re-grounded to a different date.
 * Grounding recomputation is EXACT when context.sources is provided. Without sources the quotes are
 * matched textually (title years come from the baseline spec's own SourceRef titles); when the
 * baseline's grounding.quotes also failed and no finding names the event, a textually grounded event
 * fails CLOSED (stays frozen) because its verbatim status cannot be proven here.
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
        message: `repair weakened the spec: ${list} (a timeline repair must fix the failing checks without changing the engine, adding events, dropping the event count below ${MIN_EVENTS}, removing or rewriting an event that passed its date checks on the baseline, or changing a case pair that was strictly ordered on the baseline; only an item that failed on the baseline or that a finding names may change)`,
      };
    };
    if (!enginesOk) return wrap();

    const pEvents = looseEvents(p);
    const nEvents = looseEvents(n);
    const findings = Array.isArray(context?.findings) ? context?.findings : undefined;
    const { docById, textOf } = indexSources(Array.isArray(context?.sources) ? (context?.sources as SourceDocument[]) : []);

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
      // while the baseline's grounding.quotes passed; otherwise fail closed unless a finding names
      // this event (the finding proves the baseline validator failed it).
      if (!failed.has('grounding.quotes')) return true;
      return !findingNamesItem(findings, EVENT_UNLOCK_IDS, `/simulation/events/${index}`, [ev.id]);
    };

    const modifiable = (ev: TimelineEvent, index: number): boolean =>
      !eventPassedGrounding(ev, index) ||
      findingNamesItem(findings, EVENT_UNLOCK_IDS, `/simulation/events/${index}`, [String(ev?.id)]);

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
      const isModifiable = modifiable(ev, i);
      if (match === undefined) {
        if (isModifiable) removedModifiableIds.add(k);
        else {
          problems.push(
            `event "${k}" (${formatTimelineDate(ev)}) was removed even though its date check passed on the baseline (only an event that failed its date checks, or one a finding names, may be re-grounded or removed)`,
          );
        }
        return;
      }
      if (!isModifiable) {
        const changes = eventChanges(ev, match);
        if (changes.length > 0) {
          problems.push(
            `event "${k}" changed (${changes.join(', ')}) even though its date check passed on the baseline (an event that passed keeps its id, label, date and quotes unless a finding names it)`,
          );
        }
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
        if (!nEventIds.has(eid) && indices.some(i => modifiable(pEvents[i] as TimelineEvent, i))) return true;
      }
      return false;
    };
    const caseEventRegroundedToAnotherDate = (c: Record<string, unknown>): boolean => {
      for (const eid of [String(c.earlierEventId), String(c.laterEventId)]) {
        const indices = pIndicesById.get(eid) ?? [];
        if (indices.length === 0) continue;
        const bucket = nById.get(eid) ?? [];
        if (indices.some((i, occ) => modifiable(pEvents[i] as TimelineEvent, i) && bucket[occ] !== undefined && !sameDate(pEvents[i] as TimelineEvent, bucket[occ] as TimelineEvent))) {
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
      const caseMayChange = (bc: Record<string, unknown>, baselineIndex: number, k: string): boolean =>
        caseWasWrong(bc) ||
        findingNamesItem(findings, CASE_UNLOCK_IDS, `/${list}/${baselineIndex}`, [k]) ||
        caseEventRemovedAfterFailing(bc) ||
        caseEventRegroundedToAnotherDate(bc);

      const comparePair = (bc: Record<string, unknown>, nc: Record<string, unknown>, k: string, baselineIndex: number): void => {
        const pairChanged = bc.earlierEventId !== nc.earlierEventId || bc.laterEventId !== nc.laterEventId;
        if (!pairChanged) return;
        if (caseMayChange(bc, baselineIndex, k)) return;
        problems.push(
          `${list} "${k}" changed its pair (${String(bc.earlierEventId)} -> ${String(bc.laterEventId)} became ${String(nc.earlierEventId)} -> ${String(nc.laterEventId)}) even though the pair was strictly ordered on the baseline (only a pair that failed timeline.case-order, a pair a finding names, or a pair whose event was removed or re-grounded after failing may change)`,
        );
      };
      const missingMessage = (k: string, occurrence: number): string => {
        const count = baselineCountByKey.get(k) ?? 1;
        const label = count === 1 ? `"${k}"` : `"${k}" (occurrence ${occurrence + 1} of ${count})`;
        return `${list} ${label} from the baseline is missing from the repair (only a case that failed on the baseline, a case a finding names, or a case whose event was removed after failing its date checks may disappear)`;
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
        if (caseMayChange(bc, i, k)) continue; // a failing/named/orphaned case may be dropped
        problems.push(missingMessage(k, occurrence));
      }

      // Pass 2 — the single rename exception: a baseline case whose own name/id violates the
      // publisher policy may be renamed by position, to a policy-clean key that is not another
      // baseline key.
      for (const d of deferred) {
        const nc: Record<string, unknown> | undefined = nextList[d.index];
        const nk = nc?.[keyField];
        if (nc === undefined || claimed.has(nc) || typeof nk !== 'string' || nk === d.key) {
          if (!caseMayChange(d.bc, d.index, d.key)) problems.push(missingMessage(d.key, d.occurrence));
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
