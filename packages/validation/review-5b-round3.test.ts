// Stage 5b review round 3 — Wave A3 regression tests (S5B-17, S5B-18, S5B-19, S5B-20 + the
// non-blocking hardening items), implementing the NEW FROZEN lead decision at the end of
// docs/specs/STAGE-5b-plan.md: 'Stage 5b review round 3 — lead decision: fail-closed date grounding'.
//
// Every case below is a reviewer probe from cache/scratch/review-5b/round3-adversarial.mjs /
// round3-repairs.mjs (or a lead control named in the Wave A3 brief). The design under test:
//   1. ONE AUTHORITY (S5B-17): with sources present, the only per-event grounding result is the
//      source-span validator's, and every event/pair unlock comes EXCLUSIVELY from the recomputed
//      revision-1 check/path map; the quote-only quoteGroundsDate fallback is gone from
//      authorization. Caller findings may only NARROW (exact check id + exact path), consistently:
//      an empty or wrong-scope findings array narrows a genuine date failure to nothing. Without
//      sources, date/evidence/pair mutation fails closed (only a policy finding's label survives,
//      and a pair that is provably wrong from the baseline spec itself may still be fixed).
//   2. ALLOW-LIST + CLEAN CONTEXT (S5B-18/19/20): a date grounds ONLY if it is one of the
//      supported exact forms (Month D[, ]YYYY; D[th] [of ]Month[, ]YYYY incl. 'the Dth of Month
//      YYYY'; Month [of ]YYYY; Month D / D[th] [of ]Month + title year; plain YYYY; YYYY BC/BCE/
//      B.C./B.C.E. and AD/A.D./CE/C.E. YYYY / YYYY AD/CE; era PREFIX forms BCE/BC YYYY and
//      AD/CE YYYY; YYYY–YYYY ranges with the explicit-era rule) AND its context is clean:
//        - the preceding two words carry no qualifier/bound (circa, c, ca, approx*, about, around,
//          roughly, nearly, almost, some, sometime, probably, possibly, perhaps, likely,
//          estimated, est, before, after, by, until, till, than, since, prior, early, mid,
//          middle, late, between, from, an unconsumed era token, 'the' + ordinal, or a
//          number + range connector), ignoring punctuation/markup/whitespace between words;
//        - the following two words carry no unconsumed era token, century/centuries/millennium,
//          'or', 'so', '?', or a range connector (– - / to until through and) followed by a
//          number;
//        - the year token carries no ordinal/decade suffix and no leading/trailing apostrophe;
//        - markup characters (* _ ` [ ] < >) neither touch nor split the expression.
//      Anything unrecognised FAILS CLOSED (false rejections of legitimate dates are accepted).
//   3. Titles use the same guard and lend only EXACTLY ONE plain (era-free) YYYY in clean
//      context; the heading candidate is the FIRST NON-EMPTY line when it is a '#' heading.
//   4. Hardening: a sentence-final period is not part of an era spelling — a quote ending at
//      'BCE' of 'March 3, 500 BCE.' grounds −500-03-03.
// Run: npm test (node --test packages/validation/review-5b-round3.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compareRevisions, repairFindings, validateSpec } from './validate.ts';
import {
  buildSourceUnitIndex,
  parseDateExpressions,
  quoteGroundsDate,
  sourceQuoteGrounding,
  standaloneYears,
  titleYearOf,
} from './timeline.ts';
import {
  declarationSpecAndSource,
  harborSourceDoc,
  makeHarborTimelineSpec,
} from './fixtures/timeline-specs.ts';
import { sha256 } from '../sources/index.ts';
import { startJob, readJob } from '../../workers/generation/jobs.ts';
import { timelineGenSchema } from '../contracts/schemas.ts';
import type { RepairFinding, SourceDocument, TimelineActivitySpec, ValidationReport } from '../contracts/index.ts';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function checkOf(report: ValidationReport, id: string) {
  const found = report.checks.find(c => c.id === id);
  assert.ok(found, `expected a check "${id}", report has [${report.checks.map(c => c.id).join(', ')}]`);
  return found;
}
function failedIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}
function failureDetail(report: ValidationReport): string {
  return report.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('\n');
}
const D = (year: number, month = 0, day = 0) => ({ year, month, day });

interface ProbeOptions {
  title?: string;
  heading?: string;
  prefix?: string;
  long?: number;
  quote?: string;
}

/**
 * The reviewer's round-3 dateProbe: swap the harbor source's opening sentence (and optionally its
 * title, '#' heading, a leading prefix and trailing filler lines), keep sha256/spec consistent,
 * and re-date event[0] with `quote` (default: the sentence itself).
 */
function harborProbe(
  sentence: string,
  tuple: { year: number; month: number; day: number },
  options: ProbeOptions = {},
): { spec: TimelineActivitySpec; source: SourceDocument; report: ValidationReport; quote: string } {
  const source = harborSourceDoc();
  const spec = makeHarborTimelineSpec();
  source.text = source.text.replace('The survey office opened on March 3, 1889 in the old customs house.', sentence);
  if (options.title !== undefined) {
    source.title = options.title;
    source.text = source.text.replace('# The Harbor Survey (1889)', `# ${options.title}`);
  }
  if (options.heading !== undefined) {
    source.text = source.text.replace('# The Harbor Survey (1889)', options.heading);
  }
  if (options.prefix !== undefined) source.text = options.prefix + source.text;
  if (options.long !== undefined) source.text += '\n' + 'Unrelated background without numbers.\n'.repeat(options.long);
  source.sha256 = sha256(source.text);
  spec.sources[0]!.sha256 = source.sha256;
  const quote = options.quote ?? sentence;
  Object.assign(spec.simulation.events[0]!, tuple);
  spec.simulation.events[0]!.evidence = [{ sourceId: source.id, quote }];
  return { spec, source, report: validateSpec(spec, [source]), quote };
}

/** Assert one reviewer row: publishable === expected, and when false the date checks failed. */
function expectRow(
  name: string,
  sentence: string,
  tuple: [number, number, number],
  expected: boolean,
  options: ProbeOptions = {},
): void {
  const { report } = harborProbe(sentence, { year: tuple[0], month: tuple[1], day: tuple[2] }, options);
  assert.equal(
    report.publishable,
    expected,
    `${name}: expected publishable=${expected}, got ${report.publishable} (failures: ${failedIds(report).join(', ')})`,
  );
  if (!expected) {
    assert.ok(
      failedIds(report).includes('timeline.date-grounded'),
      `${name}: an unsupported form must fail timeline.date-grounded, got [${failedIds(report).join(', ')}]`,
    );
  }
}

/* ================================================================== */
/* S5B-18 — era/range grammar: unsupported forms fail closed          */
/* ================================================================== */

test('S5B-18 reviewer rows: era prefixes, word ranges and short ranges never ground a wrong-sign year', () => {
  const d: [number, number, number] = [1889, 3, 3];
  void d;
  // The reviewer's exact rows (sentence = 'The office was active during <txt>.', claim = year only).
  const rows: [string, string, number, boolean][] = [
    ['AD-prefix', 'AD 500', 500, true],
    ['CE-prefix', 'CE 500', 500, true],
    ['BCE-prefix', 'BCE 500', 500, false],
    ['BC-prefix', 'BC 500', 500, false],
    ['BC-inside-word', '500 BCD', 500, true],
    ['BCE-inside-word', '500 BCEra', 500, true],
    ['range-spaces', '500 – 400 BCE', 500, false],
    ['range-spaces-negative', '500 – 400 BCE', -500, true],
    ['range-em-dash', '500—400 BCE', -400, true],
    ['range-short', '50–40 BCE', 50, false],
    ['range-to', '500 to 400 BCE', 500, false],
    ['range-until', '500 until 400 BCE', 500, false],
    ['range-BCE-prefix', 'BCE 500–400', 400, false],
    ['range-mixed-eras', '500 BC–400 AD', 400, true],
    ['range-CE-left', '500 CE–400 BCE', 500, true],
    ['range-CE-left-wrong', '500 CE–400 BCE', -500, false],
    ['century-number', 'the 18th century', 18, false],
    ['century-invented-start', 'the 18th century', 1700, false],
    ['century-BCE', 'the 5th century BCE', 5, false],
    ['decade', 'the 1770s', 1770, false],
  ];
  for (const [name, txt, year, expected] of rows) {
    expectRow(name, `The office was active during ${txt}.`, [year, 0, 0], expected);
  }
});

test('S5B-18: the era-prefix forms ground the CORRECT sign, and the fixed forms keep working', () => {
  // A BCE prefix grounds the negative year (never the positive reading).
  expectRow('BCE-prefix-negative', 'The office was active during BCE 500.', [-500, 0, 0], true);
  assert.deepEqual(standaloneYears('The office was active during BCE 500.'), [-500]);
  assert.deepEqual(standaloneYears('The office was active during BC 500.'), [-500]);
  assert.deepEqual(standaloneYears('The office was active during AD 500.'), [500]);
  assert.deepEqual(standaloneYears('The office was active during CE 500.'), [500]);
  assert.deepEqual(standaloneYears('A.D. 79 was fatal.'), [79]);
  // Era-suffixed ranges keep grounding both endpoints negatively (round-2 behavior preserved).
  assert.deepEqual(standaloneYears('The office was active during 500\u2013400 BCE.'), [-500, -400]);
  // Short endpoints WITH an explicit era resolve through the range grammar (never a positive year).
  assert.deepEqual(standaloneYears('The office was active during 50\u201340 BCE.'), [-50, -40]);
  // Word connectors are not a supported range form: the WHOLE expression fails closed.
  assert.deepEqual(standaloneYears('The office was active during 500 to 400 BCE.'), []);
  assert.deepEqual(standaloneYears('The office was active during 500 until 400 BCE.'), []);
  // Mixed explicit eras resolve per endpoint.
  assert.deepEqual(standaloneYears('The office was active during 500 BC\u2013400 AD.'), [-500, 400]);
  // An era-suffix-only LEFT endpoint stays ambiguous and grounds nothing (round-2 rule preserved).
  assert.deepEqual(standaloneYears('The office was active during 500 BCE\u2013400.'), []);
  // The '1775–83' control: the 3-4-digit left endpoint grounds, the short right endpoint never
  // expands into 1783.
  assert.equal(quoteGroundsDate('The war lasted 1775\u201383.', D(1775), null), true);
  assert.equal(quoteGroundsDate('The war lasted 1775\u201383.', D(1783), null), false);
  // A bare short range without any era grounds nothing (fail closed).
  assert.deepEqual(standaloneYears('The office was active during 50-40.'), []);
});

test('S5B-20: century ordinals are never literal years', () => {
  assert.deepEqual(standaloneYears('The office was active during the 18th century.'), []);
  assert.deepEqual(standaloneYears('The office was active during the 5th century BCE.'), []);
  assert.deepEqual(parseDateExpressions('the 18th century').filter(e => e.year !== null), []);
  // The honest day-ordinal control stays valid inside its month-day grammar.
  assert.equal(quoteGroundsDate('The office opened on the 4th of July 1776.', D(1776, 7, 4), null), true);
  assert.equal(quoteGroundsDate('On July 4th the news arrived.', D(1776, 7, 4), 1776), true);
  // A decade form stays approximate and grounds nothing.
  assert.deepEqual(standaloneYears('built in the 1770s'), []);
});

/* ================================================================== */
/* S5B-19 — the clean-context guard: qualifiers and temporal bounds    */
/* ================================================================== */

test('S5B-19 reviewer rows: qualifiers behind delimiters and temporal bounds never ground an exact date', () => {
  const d: [number, number, number] = [1889, 3, 3];
  for (const q of [
    'approximately', 'approx.', 'roughly', 'sometime in', 'circa,', 'circa (', 'around (', 'around \u201c',
    'ca.,', 'c. (', 'approximately,', 'circa\n', 'circa **', 'by', 'before', 'after', 'no later than',
    'between', 'probably in', 'circa AD',
  ]) {
    const close = q.endsWith('(') ? ')' : q.endsWith('\u201c') ? '\u201d' : q.endsWith('**') ? '**' : '';
    const name = `qualifier-${encodeURIComponent(q)}`;
    expectRow(
      name,
      `The office opened ${q} March 3, 1889${close} in the customs house.`,
      d,
      false,
      { quote: `March 3, 1889${close} in the customs house.` },
    );
  }
  // Temporal bounds stated in the full sentence (the quote alone looks exact).
  expectRow('by-year', 'The office had opened by 1776.', [1776, 0, 0], false);
  expectRow('before-year', 'The office opened before 1776.', [1776, 0, 0], false);
  expectRow('after-year', 'The office opened after 1776.', [1776, 0, 0], false);
  // The positive control: a non-date count with 'about' keeps the whole spec publishable.
  expectRow('about-headcount', 'The office opened March 3, 1889 with about 40 delegates.', d, true);
});

test('S5B-19: the two-word window is exact — a bound farther away never contaminates a clean date', () => {
  // The lead's control: 'by' is NOT within the two words before the date.
  assert.equal(quoteGroundsDate('It was signed by John Hancock on July 4, 1776.', D(1776, 7, 4), null), true);
  assert.equal(quoteGroundsDate('The office had opened by 1776.', D(1776), null), false);
  assert.equal(quoteGroundsDate('The office opened before 1776.', D(1776), null), false);
  assert.equal(quoteGroundsDate('The office opened after 1776.', D(1776), null), false);
  assert.equal(quoteGroundsDate('They arrived by train on March 3, 1889.', D(1889, 3, 3), null), true);
  // 'until' as a bound: rejected (fail closed) ...
  assert.equal(quoteGroundsDate('The plan was delayed until September of 1776.', D(1776, 9), null), false);
  // ... and a NEGATED 'until' is a bound too (round-4 S5B-22 removed the lead's round-3 exception).
  assert.equal(quoteGroundsDate('The plan was not approved until September of 1776.', D(1776, 9), null), false);
  // 'to' before an era year is not a bound ('dates to 500 B.C.' stays grounded).
  assert.equal(quoteGroundsDate('A stone dates to 500 B.C. in the valley records.', D(-500), null), true);
  // A qualifier separated by a newline can never be left behind (fail closed across the unit edge).
  assert.equal(quoteGroundsDate('The office opened circa', D(1889, 3, 3), null), false);
});

test('S5B-19: the source-span validator rejects a qualifier detached from the quote by segmentation', () => {
  // The reviewer's 'circa\n' row at the SOURCE level: the qualifier sits in the previous unit.
  const index = buildSourceUnitIndex('The office opened circa\nMarch 3, 1889 in the customs house.');
  const g = sourceQuoteGrounding(index, 'March 3, 1889 in the customs house.', D(1889, 3, 3), null);
  assert.equal(g.status, 'ungrounded');
  // Same-line delimiters: the window ignores punctuation/markup between words.
  const idx2 = buildSourceUnitIndex('The office opened circa, March 3, 1889 in the customs house.');
  assert.equal(sourceQuoteGrounding(idx2, 'March 3, 1889 in the customs house.', D(1889, 3, 3), null).status, 'ungrounded');
  const idx3 = buildSourceUnitIndex('The office opened around ( March 3, 1889) in the customs house.');
  assert.equal(sourceQuoteGrounding(idx3, 'March 3, 1889) in the customs house.', D(1889, 3, 3), null).status, 'ungrounded');
});

test('S5B-19: markup touching or splitting an expression, and unconsumed era tokens, fail closed', () => {
  // inline-markup-era: the positive year behind a markup-separated BCE never grounds.
  expectRow('inline-markup-era', 'The office opened on March 3, 1889 **BCE**.', [1889, 3, 3], false);
  // inline-markup-day: a markup-split month-day-year never grounds the full date.
  expectRow('inline-markup-day', 'The office opened on March **3**, 1889.', [1889, 3, 3], false);
  // A newline inside the expression never grounds (source units do not join).
  expectRow('newline-date', 'The office opened on March\n3, 1889.', [1889, 3, 3], false, {
    quote: 'The office opened on March 3, 1889.',
  });
  expectRow('CRLF-date', 'The office opened on March\r\n3, 1889.', [1889, 3, 3], false, {
    quote: 'The office opened on March 3, 1889.',
  });
  // An era token the expression did not consume (following window) blocks the positive reading.
  const idx = buildSourceUnitIndex('The office opened on March 3, 1889 BCE in the customs house.');
  const cut = sourceQuoteGrounding(idx, 'The office opened on March 3, 1889', D(1889, 3, 3), null);
  assert.equal(cut.status, 'ungrounded');
  // The complete era expression inside the full quote grounds the NEGATIVE date.
  const full = sourceQuoteGrounding(idx, 'The office opened on March 3, 1889 BCE', D(-1889, 3, 3), null);
  assert.equal(full.status, 'grounded');
});

/* ================================================================== */
/* Hardening — sentence punctuation is not part of an era spelling     */
/* ================================================================== */

test('hardening: a quote ending at "BCE" (without the sentence period) grounds; the period is punctuation', () => {
  expectRow('BCE-quote-before-period', 'The office opened on March 3, 500 BCE.', [-500, 3, 3], true, {
    quote: 'The office opened on March 3, 500 BCE',
  });
  assert.equal(quoteGroundsDate('The office opened on March 3, 500 BCE.', D(-500, 3, 3), null), true);
  assert.equal(quoteGroundsDate('The office opened on March 3, 500 BCE', D(-500, 3, 3), null), true);
  assert.equal(quoteGroundsDate('The office opened on March 3, 500 BCE.', D(500, 3, 3), null), false);
  // The dotted spellings behave the same way.
  assert.equal(quoteGroundsDate('It was built in 300 B.C. by traders.', D(-300), null), true);
  assert.equal(quoteGroundsDate('It was built in 300 B.C', D(-300), null), true);
  assert.equal(quoteGroundsDate('It was built in 300 B.C.E. by traders', D(-300), null), true);
  // The plain quote-before-period control stays grounded.
  expectRow('quote-before-period', 'The office opened on March 3, 1889.', [1889, 3, 3], true, {
    quote: 'The office opened on March 3, 1889',
  });
});

/* ================================================================== */
/* Positive controls that must STAY accepted                           */
/* ================================================================== */

test('round-3 positive controls: unicode, repeats, long sources and the lead controls keep grounding', () => {
  const d: [number, number, number] = [1889, 3, 3];
  expectRow('unicode-nbsp', 'The office opened on March\u00a03,\u00a01889 in the customs house.', d, true, {
    quote: 'The office opened on March 3, 1889 in the customs house.',
  });
  expectRow('unicode-quotes', 'The record says \u201cMarch 3, 1889\u201d for the office opening.', d, true);
  expectRow('repeated-identical', 'The office opened on March 3, 1889.\nThe office opened on March 3, 1889.', d, true, {
    quote: 'The office opened on March 3, 1889.',
  });
  expectRow('repeated-cut-day', 'The office opened on March 3, 1889.\nThe office opened on March 30, 1889.', d, false, {
    quote: 'The office opened on March 3',
  });
  expectRow('repeated-era', 'The office opened on March 3, 1889.\nThe office opened on March 3, 1889 BCE.', d, false, {
    quote: 'The office opened on March 3, 1889',
  });
  expectRow('long-source', 'The office opened on March 3, 1889.', d, true, { long: 200 });
  // The reviewer's normalized-quote control: the source-span validator grounds 'March 3' + the
  // title year even though the whitespace-normalised quote makes the next line's '1900' adjacent.
  expectRow('normalized-quote-control', 'The office opened on March 3\n1900 was the report serial number.', d, true, {
    quote: 'The office opened on March 3 1900 was the report serial number.',
  });
  // The lead's exact controls through the full validator.
  expectRow('dec-25', 'The office opened on Dec. 25, 1776 in the customs house.', [1776, 12, 25], true);
  expectRow('25-december', 'The office opened on 25 December 1776 in the customs house.', [1776, 12, 25], true);
  expectRow('4th-of-july', 'The office opened on the 4th of July 1776 in the customs house.', [1776, 7, 4], true);
  expectRow('sept-4th', 'The office opened on Sept. 4th, 1776 in the customs house.', [1776, 9, 4], true);
  expectRow('300-bc', 'A stone dates to 300 B.C. in the valley records.', [-300, 0, 0], true);
  expectRow('range-1775', 'The survey office was active during 1775\u20131783 in the harbor.', [1775, 0, 0], true);
  expectRow('range-1783', 'The survey office was active during 1775\u20131783 in the harbor.', [1783, 0, 0], true);
  expectRow('range-interior', 'The survey office was active during 1775\u20131783 in the harbor.', [1778, 0, 0], false);
  // 'on January 19th' + the title year (a date before the fixture's April 14 mapping event so
  // case-order is unaffected); the July 19th wording is asserted at the unit level below.
  expectRow('month-day-title-year', 'The office reopened on January 19th for the season.', [1889, 1, 19], true);
  assert.equal(quoteGroundsDate('On July 19th, Congress ordered the parchment engrossed.', D(1776, 7, 19), 1776), true);
  assert.equal(quoteGroundsDate('On July 19th, Congress ordered the parchment engrossed.', D(1776, 7, 19), null), false);
});

/* ================================================================== */
/* Titles: same guard, first NON-EMPTY heading, exactly one plain YYYY */
/* ================================================================== */

test('round-3 title rows: bounds, era prefixes and blank-line headings lend nothing', () => {
  const d: [number, number, number] = [1889, 3, 3];
  const rows: [string, string | undefined, string | undefined, string | undefined, boolean][] = [
    ['title-clean', 'The Harbor Survey (1889)', undefined, undefined, true],
    ['title-early', 'The Harbor Survey (early 1889)', undefined, undefined, false],
    ['heading-conflict', undefined, '# The Harbor Survey (1888)', undefined, false],
    ['heading-approx', undefined, '# The Harbor Survey (around 1889)', undefined, false],
    ['heading-after-blank', undefined, '# The Harbor Survey (around 1889)', '\n', false],
    ['title-before', 'The Harbor Survey (before 1889)', undefined, undefined, false],
    ['title-by', 'The Harbor Survey (by 1889)', undefined, undefined, false],
    ['title-BCE-prefix', 'The Harbor Survey (BCE 1889)', undefined, undefined, false],
  ];
  for (const [name, title, heading, prefix, expected] of rows) {
    expectRow(name, 'The office opened on March 3.', d, expected, { title, heading, prefix });
  }
  // Direct titleYearOf assertions.
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)' }), 1889);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (by 1889)' }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (before 1889)' }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (BCE 1889)' }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889 BCE)' }), null);
  // The FIRST NON-EMPTY line is the heading candidate (hardening item): a leading blank line can
  // no longer hide an '(around 1889)' heading behind a clean metadata title.
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)', text: '\n\n# The Harbor Survey (around 1889)\n\nBody.' }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)', text: '\n# The Harbor Survey (1889)\n\nBody.' }), 1889);
  // A year-less title against a year-bearing heading still disagrees -> lends nothing.
  assert.equal(titleYearOf({ title: 'Clean Metadata Title', text: '\n# The Harbor Survey (1889)\n\nBody.' }), null);
});

/* ================================================================== */
/* S5B-17 — one authority: the recomputed r1 map is the only unlock    */
/* ================================================================== */

/**
 * The reviewer's comparator-normalized-worker setup: the source's first unit is
 * 'The office opened on March 3' (newline) '1900 was the report serial number.'; baseline s1 is
 * 1889-03-03 and PASSES via the title-year rule; the only r1 failure is s5's label policy; the
 * candidate fixes the label but rewrites s1 to the independently grounded 1888-01-01.
 */
function normalizedBypassSetup(): { baseline: TimelineActivitySpec; candidate: TimelineActivitySpec; source: SourceDocument; report: ValidationReport } {
  const source = harborSourceDoc();
  const spec = makeHarborTimelineSpec();
  source.text = source.text.replace(
    'The survey office opened on March 3, 1889 in the old customs house.',
    'The office opened on March 3\n1900 was the report serial number.',
  );
  source.text += '\nAn earlier office opened January 1, 1888.';
  source.sha256 = sha256(source.text);
  spec.sources[0]!.sha256 = source.sha256;
  Object.assign(spec.simulation.events[0]!, { year: 1889, month: 3, day: 3 });
  spec.simulation.events[0]!.evidence = [
    { sourceId: source.id, quote: 'The office opened on March 3 1900 was the report serial number.' },
  ];
  const baseline = structuredClone(spec);
  baseline.simulation.events[4]!.label = 'NASA final report';
  const candidate = structuredClone(baseline);
  candidate.simulation.events[4]!.label = 'Final report';
  Object.assign(candidate.simulation.events[0]!, {
    year: 1888,
    month: 1,
    day: 1,
    evidence: [{ sourceId: source.id, quote: 'An earlier office opened January 1, 1888.' }],
  });
  const report = validateSpec(baseline, [source]);
  return { baseline, candidate, source, report };
}

test('S5B-17: the canonical source-span result freezes a passing event — the quote-only fallback is gone', () => {
  const { baseline, candidate, source, report } = normalizedBypassSetup();
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution'], 'the baseline fails ONLY the label policy');
  assert.equal(validateSpec(candidate, [source]).publishable, true, 'the candidate is valid on its own');
  const failed = failedIds(report);
  const variants: [string, RepairFinding[] | undefined][] = [
    ['recomputed', undefined],
    ['normal', repairFindings(report, baseline)],
    ['empty', []],
    ['unrelated', [{ id: 'timeline.date-grounded', kind: 'grounding', message: 'forged', affected: ['/simulation/events/4/year'] }]],
  ];
  for (const [name, findings] of variants) {
    const guard = compareRevisions(baseline, candidate, failed, { sources: [source], findings });
    assert.equal(guard.passed, false, `comparator-normalized-${name}: the unauthorized s1 date rewrite must be rejected`);
    assert.match(guard.message, /event "s1" changed/, name);
  }
});

test('S5B-17: caller findings narrow CONSISTENTLY — empty or wrong scopes narrow a genuine date failure to nothing', () => {
  const { spec: base, source } = (() => {
    const s = harborSourceDoc();
    const p = makeHarborTimelineSpec();
    // A clean title '(1889)' source; the baseline claims 1887 for the March 3 event -> date-grounded fails.
    Object.assign(p.simulation.events[0]!, { year: 1887, month: 3, day: 3 });
    return { spec: p, source: s };
  })();
  const next = structuredClone(base);
  Object.assign(next.simulation.events[0]!, { year: 1889, month: 3, day: 3 }); // the honest fix
  const report = validateSpec(base, [source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
  const failed = failedIds(report);
  // findings omitted -> the full recomputed map authorizes the honest fix.
  assert.equal(compareRevisions(base, next, failed, { sources: [source] }).passed, true);
  // The exact pipeline-shaped findings also authorize it.
  assert.equal(compareRevisions(base, next, failed, { sources: [source], findings: repairFindings(report, base) }).passed, true);
  // An EMPTY findings array narrows everything away: the genuine failure unlocks nothing.
  assert.equal(compareRevisions(base, next, failed, { sources: [source], findings: [] }).passed, false);
  // A wrong-check-id finding narrows everything away.
  const wrongId: RepairFinding[] = [
    { id: 'policy.no-publisher-attribution', kind: 'semantic', message: 'wrong id', affected: ['/simulation/events/0/year'] },
  ];
  assert.equal(compareRevisions(base, next, failed, { sources: [source], findings: wrongId }).passed, false);
  // A right-id finding naming a path the recomputed failure does not name narrows everything away.
  const wrongField: RepairFinding[] = [
    { id: 'timeline.date-grounded', kind: 'grounding', message: 'wrong field', affected: ['/simulation/events/0/label'] },
  ];
  assert.equal(compareRevisions(base, next, failed, { sources: [source], findings: wrongField }).passed, false);
  // An exact-path subset of the recomputed failure still authorizes the event.
  const narrow: RepairFinding[] = [
    { id: 'timeline.date-grounded', kind: 'grounding', message: 'narrowed', affected: ['/simulation/events/0/year'] },
  ];
  assert.equal(compareRevisions(base, next, failed, { sources: [source], findings: narrow }).passed, true);
});

test('S5B-17: without sources, date/evidence mutation fails closed even for honest findings', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[5]!.year = 1777; // e6 fails timeline.date-grounded (recomputable only WITH the source)
  const report = validateSpec(spec, [source]);
  const findings = repairFindings(report, spec);
  const next = structuredClone(spec);
  next.simulation.events[5]!.year = 1776;
  const failed = failedIds(report);
  // Without the source documents the baseline cannot be recomputed: fail closed.
  assert.equal(compareRevisions(spec, next, failed, { findings }).passed, false);
  assert.equal(compareRevisions(spec, next, failed).passed, false);
  // With sources the recomputed map authorizes the honest fix.
  assert.equal(compareRevisions(spec, next, failed, { sources: [source], findings }).passed, true);
  // Without sources a policy finding still unlocks ONLY the label string.
  const labelBaseline = makeHarborTimelineSpec();
  labelBaseline.simulation.events[0]!.label = 'NASA office';
  const labelSource = harborSourceDoc();
  const labelReport = validateSpec(labelBaseline, [labelSource]);
  const labelFix = structuredClone(labelBaseline);
  labelFix.simulation.events[0]!.label = 'Survey office opens';
  assert.equal(
    compareRevisions(labelBaseline, labelFix, failedIds(labelReport), { findings: repairFindings(labelReport, labelBaseline) }).passed,
    true,
  );
  // Without sources a pair that is provably wrong from the baseline spec itself may still be fixed
  // (the ordering oracle needs no source text), while a correct pair stays frozen.
  const pairBaseline = makeHarborTimelineSpec();
  pairBaseline.behavioralTests[0] = { name: 'opening-before-mapping', earlierEventId: 's2', laterEventId: 's1' };
  const pairFix = structuredClone(pairBaseline);
  pairFix.behavioralTests[0] = { name: 'opening-before-mapping', earlierEventId: 's1', laterEventId: 's2' };
  assert.equal(compareRevisions(pairBaseline, pairFix, ['timeline.case-order']).passed, true);
  const wrongPair = structuredClone(pairBaseline);
  wrongPair.behavioralTests[1] = { name: 'mapping-before-beacon', earlierEventId: 's3', laterEventId: 's2' };
  assert.equal(compareRevisions(pairBaseline, wrongPair, ['timeline.case-order']).passed, false);
});

/* ================================================================== */
/* Worker regressions (real stage machine, fake clients)               */
/* ================================================================== */

function projectToGen(v: unknown, s: { type?: string; properties?: Record<string, unknown>; items?: unknown }): unknown {
  const schema = s as { type?: string; properties?: Record<string, unknown>; items?: unknown };
  if (schema.type === 'object' && schema.properties) {
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(schema.properties)
        .filter(([k]) => k in obj)
        .map(([k, sub]) => [k, projectToGen(obj[k], sub as typeof s)]),
    );
  }
  if (schema.type === 'array') return (v as unknown[]).map(item => projectToGen(item, schema.items as typeof s));
  return v;
}

interface WorkerRun {
  summary: { status: string; publishedRevision: number | null };
  revisions: { revision: number; publishable: boolean; failed: string[] }[];
  event0: [number, number, number];
}

/** Run the real worker over a custom harbor-derived source with a scripted fake client. */
async function runWorker(
  source: SourceDocument,
  r1Spec: TimelineActivitySpec,
  repairSpecs: TimelineActivitySpec[],
): Promise<WorkerRun> {
  const storageDir = mkdtempSync(join(tmpdir(), 'review-5b-round3-'));
  const sourcesDir = join(storageDir, 'sources') + '/';
  mkdirSync(sourcesDir, { recursive: true });
  writeFileSync(join(sourcesDir, `${source.id}.txt`), source.text ?? '');
  writeFileSync(
    join(sourcesDir, `${source.id}.json`),
    JSON.stringify({ ...source, text: undefined, textFile: `${source.id}.txt` }),
  );
  const analysis = {
    supported: true,
    activity: 'timeline-v1',
    unsupportedReason: '',
    concepts: [
      {
        id: 'survey',
        name: 'Harbor survey',
        evidence: [{ sourceId: source.id, quote: 'The first beacon was lit on July 1, 1889 after the tower was completed.' }],
      },
    ],
    objectives: ['Order the survey events.'],
  };
  let calls = 0;
  const repairs = repairSpecs.map(s => structuredClone(s));
  const client = {
    complete: async (req: { schemaName: string }): Promise<unknown> => ({
      data:
        req.schemaName === 'source_analysis'
          ? analysis
          : projectToGen(
              req.schemaName === 'activity_spec_repair' && repairs.length > 0 ? repairs.shift() : r1Spec,
              timelineGenSchema as unknown as { type?: string },
            ),
      receipt: {
        purpose: 'test-live',
        requestedModel: 'muse-spark-1.3',
        returnedModel: 'muse-spark-1.3',
        responseId: `fake-${++calls}`,
        usage: null,
        latencyMs: 1,
        estCostUSD: 0.01,
        finishReason: 'stop',
        attempts: 1,
      },
    }),
  };
  const run = startJob(source.id, {
    client: client as never,
    storageDir,
    sourcesDir: pathToFileURL(sourcesDir),
    purpose: 'test-live',
  });
  await run.done;
  const disk = readJob(storageDir, run.jobId);
  assert.ok(disk !== null);
  const spec = disk.spec as { simulation: { events: { year: number; month: number; day: number }[] } } | undefined;
  const ev0 = spec?.simulation.events[0];
  return {
    summary: { status: disk.summary.status, publishedRevision: disk.summary.publishedRevision ?? null },
    revisions: disk.revisions.map(r => {
      const report = r.report as ValidationReport;
      return {
        revision: r.revision,
        publishable: report.publishable,
        failed: report.checks.filter(c => !c.passed).map(c => c.id),
      };
    }),
    event0: ev0 ? [ev0.year, ev0.month, ev0.day] : [0, 0, 0],
  };
}

/** The reviewer's repair-job source: the opening sentence replaced + the 1888 sentence appended. */
function repairSource(sentence: string): SourceDocument {
  const source = harborSourceDoc();
  source.text =
    source.text.replace('The survey office opened on March 3, 1889 in the old customs house.', sentence) +
    '\nAn earlier office opened January 1, 1888.';
  source.sha256 = sha256(source.text);
  return source;
}

function repairBaseline(source: SourceDocument, date: [number, number, number], quote: string): TimelineActivitySpec {
  const spec = makeHarborTimelineSpec();
  spec.sources[0]!.sha256 = source.sha256;
  Object.assign(spec.simulation.events[0]!, { year: date[0], month: date[1], day: date[2] });
  spec.simulation.events[0]!.evidence = [{ sourceId: source.id, quote }];
  return spec;
}

test('S5B-17 worker: the normalized-quote bypass never publishes the unauthorized date rewrite (r2 or r3)', async () => {
  // Variant 1 (comparator-normalized-worker): every repair returns label-fix + s1 rewrite.
  const { baseline, candidate, source } = normalizedBypassSetup();
  const run1 = await runWorker(source, baseline, [candidate, structuredClone(candidate)]);
  assert.equal(run1.summary.publishedRevision, null, 'no revision may publish');
  assert.notEqual(run1.summary.status, 'succeeded');
  for (const rev of run1.revisions.slice(1)) {
    assert.ok(rev.failed.includes('repair.no-weakening'), `r${rev.revision} must fail the repair guard`);
  }

  // Variant 2 (normalized-bypass-r3): the first repair ALSO breaks a pair; the second repair keeps
  // the unauthorized rewrite. Both are rejected; nothing publishes.
  const source2 = repairSource('The office opened on March 3\n1900 was the report serial number.');
  const base2 = repairBaseline(source2, [1889, 3, 3], 'The office opened on March 3 1900 was the report serial number.');
  base2.simulation.events[4]!.label = 'NASA final report';
  const badPair = structuredClone(base2);
  badPair.simulation.events[4]!.label = 'Final report signed';
  Object.assign(badPair.simulation.events[0]!, {
    year: 1888, month: 1, day: 1,
    evidence: [{ sourceId: source2.id, quote: 'An earlier office opened January 1, 1888.' }],
  });
  badPair.behavioralTests[0]!.earlierEventId = badPair.behavioralTests[0]!.laterEventId;
  const goodPair = structuredClone(badPair);
  goodPair.behavioralTests[0] = { name: 'opening-before-mapping', earlierEventId: 's1', laterEventId: 's2' };
  const run2 = await runWorker(source2, base2, [badPair, goodPair]);
  assert.equal(run2.summary.publishedRevision, null, 'the r3 date rewrite must not publish either');
  assert.notEqual(run2.summary.status, 'succeeded');
});

test('S5B-17/S5B-18 workers: the three honest repairs still publish revision 2', async () => {
  // (1) span-honest: a quote cut inside 'March 30' is re-quoted completely and the day corrected.
  const spanSource = repairSource('The office opened on March 30, 1889.');
  const spanBase = repairBaseline(spanSource, [1889, 3, 3], 'The office opened on March 3');
  const spanNext = structuredClone(spanBase);
  spanNext.simulation.events[0]!.day = 30;
  spanNext.simulation.events[0]!.evidence = [{ sourceId: spanSource.id, quote: 'The office opened on March 30, 1889.' }];
  const spanRun = await runWorker(spanSource, spanBase, [spanNext]);
  assert.equal(spanRun.summary.publishedRevision, 2, JSON.stringify(spanRun.revisions));
  assert.deepEqual(spanRun.event0, [1889, 3, 30]);

  // (2) era-honest: '+400' from '500–400 BCE' is corrected to the grounded '−400'.
  const eraSource = repairSource('The office operated in 500\u2013400 BCE.');
  const eraBase = repairBaseline(eraSource, [400, 0, 0], 'The office operated in 500\u2013400 BCE.');
  const eraNext = structuredClone(eraBase);
  eraNext.simulation.events[0]!.year = -400;
  const eraRun = await runWorker(eraSource, eraBase, [eraNext]);
  assert.equal(eraRun.summary.publishedRevision, 2, JSON.stringify(eraRun.revisions));
  assert.deepEqual(eraRun.event0, [-400, 0, 0]);

  // (3) approx-honest: a 'c. March 3, 1889' event is re-grounded to a separately stated exact date.
  const approxSource = repairSource('The office opened c. March 3, 1889.');
  const approxBase = repairBaseline(approxSource, [1889, 3, 3], 'The office opened c. March 3, 1889.');
  const approxNext = structuredClone(approxBase);
  Object.assign(approxNext.simulation.events[0]!, {
    year: 1888, month: 1, day: 1,
    evidence: [{ sourceId: approxSource.id, quote: 'An earlier office opened January 1, 1888.' }],
  });
  const approxRun = await runWorker(approxSource, approxBase, [approxNext]);
  assert.equal(approxRun.summary.publishedRevision, 2, JSON.stringify(approxRun.revisions));
  assert.deepEqual(approxRun.event0, [1888, 1, 1]);
});

test('S5B-18/19/20 workers: the reviewer negative-control jobs never publish r1', async () => {
  const cases: [string, string, [number, number, number], string | undefined][] = [
    ['range-short', 'The office was active during 50\u201340 BCE.', [50, 0, 0], undefined],
    ['range-to', 'The office was active during 500 to 400 BCE.', [500, 0, 0], undefined],
    ['BCE-prefix', 'The office was active during BCE 500.', [500, 0, 0], undefined],
    ['by-year', 'The office had opened by 1776.', [1776, 0, 0], undefined],
    ['inline-markup-era', 'The office opened on March 3, 1889 **BCE**.', [1889, 3, 3], undefined],
    ['century-number', 'The office was active during the 18th century.', [18, 0, 0], undefined],
    [
      'qualifier-circa%2C',
      'The office opened circa, March 3, 1889 in the customs house.',
      [1889, 3, 3],
      'March 3, 1889 in the customs house.',
    ],
    [
      'heading-after-blank',
      'The office opened on March 3.',
      [1889, 3, 3],
      undefined,
    ],
  ];
  for (const [name, sentence, tuple, quote] of cases) {
    const source = name === 'heading-after-blank' ? harborSourceDoc() : repairSource(sentence);
    if (name === 'heading-after-blank') {
      source.text = '\n' + source.text.replace('# The Harbor Survey (1889)', '# The Harbor Survey (around 1889)')
        .replace('The survey office opened on March 3, 1889 in the old customs house.', sentence);
      source.sha256 = sha256(source.text);
    }
    const base = repairBaseline(source, tuple, quote ?? sentence);
    const run = await runWorker(source, base, [structuredClone(base)]);
    assert.equal(run.summary.publishedRevision, null, `${name}: must not publish (revisions: ${JSON.stringify(run.revisions)})`);
    assert.ok(
      run.revisions[0] !== undefined && run.revisions[0].failed.includes('timeline.date-grounded'),
      `${name}: r1 must fail timeline.date-grounded, got ${JSON.stringify(run.revisions[0])}`,
    );
  }
});

/* ================================================================== */
/* Round-1/2 regressions stay closed under the stricter guard          */
/* ================================================================== */

test('round-3: the fixtures and the real Declaration still publish; round-2 rejections stay rejected', () => {
  const decl = declarationSpecAndSource();
  const declReport = validateSpec(decl.spec, [decl.source]);
  assert.equal(declReport.publishable, true, failureDetail(declReport));
  const harborReport = validateSpec(makeHarborTimelineSpec(), [harborSourceDoc()]);
  assert.equal(harborReport.publishable, true, failureDetail(harborReport));
  // Round-2 trim/cut attacks stay rejected.
  const trim = harborProbe('The survey office opened on March 30, 1889 in the customs house.', D(1889, 3, 3), {
    quote: 'The survey office opened on March 3',
  });
  assert.equal(trim.report.publishable, false);
  assert.deepEqual(failedIds(trim.report), ['timeline.date-grounded']);
  assert.match(checkOf(trim.report, 'timeline.date-grounded').message, /March 30, 1889/);
  const trimEra = harborProbe('The survey office opened on March 3, 1889 BCE in the customs house.', D(1889, 3, 3), {
    quote: 'The survey office opened on March 3, 1889',
  });
  assert.equal(trimEra.report.publishable, false);
  assert.deepEqual(failedIds(trimEra.report), ['timeline.date-grounded']);
});
