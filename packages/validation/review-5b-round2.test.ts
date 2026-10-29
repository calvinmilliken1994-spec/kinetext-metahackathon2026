// Stage 5b review round 2 — Wave A2 regression tests (S5B-11, S5B-12, S5B-13, S5B-15).
// Every case below is a reviewer probe from cache/scratch/review-5b/round2-adversarial.mjs /
// round2-e2e.mjs (or a lead positive control named in the Wave A2 brief). They encode the SAFE
// behavior the round-2 review demanded:
//   S5B-11  dates ground against COMPLETE SOURCE EXPRESSIONS inside the quote's located source
//           span — a quote edge cutting a token ('March 3' from 'March 30', '1889' from
//           '1889 BCE') never manufactures an expression, and a whitespace-normalised quote
//           never joins expressions across a source-unit (newline/sentence) boundary;
//   S5B-12  era markers are part of the range grammar ('500–400 BCE' grounds −500 and −400,
//           never +400); an era suffix on the right endpoint applies to an unmarked left
//           endpoint only when unambiguous; mixed/ambiguous eras fail closed;
//   S5B-13  approximation abbreviations ('c.', 'ca.', 'approx.') never split units, qualifiers
//           attach to the parsed expression (incl. article + day-first ordinal forms), and the
//           title-year rule shares the SAME approximation policy;
//   S5B-15  with sources present, compareTimelineRevisions derives repair authorization
//           EXCLUSIVELY from the recomputed immutable-r1 report; caller-supplied findings may
//           only narrow (intersect by check id AND exact path), never broaden; without
//           sufficient source context no date/evidence/pair unlock is granted (fail closed).
// Run: npm test (node --test packages/validation/review-5b-round2.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';

import { compareRevisions, repairFindings, validateSpec } from './validate.ts';
import {
  buildSourceUnitIndex,
  hasApproximateDate,
  parseDateExpressions,
  quoteGroundsDate,
  sentenceUnits,
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
const D = (year: number, month = 0, day = 0) => ({ year, month, day });

/**
 * The reviewer's round-2 dateProbe: swap the harbor source's opening sentence (and optionally its
 * title and '#' heading), keep sha256/spec consistent, and re-date event[0] with `quote`.
 */
function harborProbe(
  sentence: string,
  quote: string,
  date: { year: number; month: number; day: number },
  title?: string,
): { spec: TimelineActivitySpec; source: SourceDocument; report: ValidationReport } {
  const source = harborSourceDoc();
  const spec = makeHarborTimelineSpec();
  source.text = source.text.replace('The survey office opened on March 3, 1889 in the old customs house.', sentence);
  if (title !== undefined) {
    source.title = title;
    source.text = source.text.replace('# The Harbor Survey (1889)', `# ${title}`);
  }
  source.sha256 = sha256(source.text);
  spec.sources[0]!.sha256 = source.sha256;
  Object.assign(spec.simulation.events[0]!, date);
  spec.simulation.events[0]!.evidence = [{ sourceId: source.id, quote }];
  return { spec, source, report: validateSpec(spec, [source]) };
}

/* ================================================================== */
/* S5B-11 — dates ground against the SOURCE span, not the quote's edges */
/* ================================================================== */

test('S5B-11 trim-day-token: "March 3" cut out of "March 30, 1889" never grounds 1889-03-03 (reviewer probe)', () => {
  const { report } = harborProbe(
    'The survey office opened on March 30, 1889 in the customs house.',
    'The survey office opened on March 3',
    { year: 1889, month: 3, day: 3 },
  );
  assert.equal(report.publishable, false, 'the quote-edge-truncated day must not publish');
  assert.deepEqual(failedIds(report), ['timeline.date-grounded'], report.checks.map(c => `${c.id}:${c.passed}`).join(' '));
  assert.match(checkOf(report, 'timeline.date-grounded').message, /March 30, 1889/, 'the message names the complete source expression the quote cuts');
});

test('S5B-11 trim-era: a quote stopping before "BCE" never grounds +1889 — and the cut span never grounds −1889 either (reviewer probe)', () => {
  const sentence = 'The survey office opened on March 3, 1889 BCE in the customs house.';
  const cutQuote = 'The survey office opened on March 3, 1889';
  const plus = harborProbe(sentence, cutQuote, { year: 1889, month: 3, day: 3 });
  assert.equal(plus.report.publishable, false, 'the source says −1889-03-03; the quote edge omits the era suffix');
  assert.deepEqual(failedIds(plus.report), ['timeline.date-grounded']);
  const minus = harborProbe(sentence, cutQuote, { year: -1889, month: 3, day: 3 });
  assert.equal(minus.report.publishable, false, 'a quote that CUTS the era suffix grounds nothing, even with the right sign');
  assert.deepEqual(failedIds(minus.report), ['timeline.date-grounded']);
  // The COMPLETE source expression inside a full quote grounds the negative date.
  const full = harborProbe(sentence, sentence, { year: -1889, month: 3, day: 3 });
  assert.equal(full.report.publishable, true, failedIds(full.report).join(','));
});

test('S5B-11 cross-newline: a whitespace-normalised quote never joins expressions across a source-unit boundary (reviewer probe)', () => {
  const { report } = harborProbe(
    'The survey office opened on March\n3, 1889 were reference numbers.',
    'The survey office opened on March 3, 1889 were reference numbers.',
    { year: 1889, month: 3, day: 3 },
  );
  assert.equal(report.publishable, false, 'the newline-separated source never states March 3, 1889');
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
});

test('S5B-11 range-cut: a quote cutting "1775–1783" to "1775–178" grounds no endpoint', () => {
  const { report } = harborProbe('The survey office was active during 1775\u20131783 in the harbor.', 'The survey office was active during 1775\u2013178', { year: 1775, month: 0, day: 0 });
  assert.equal(report.publishable, false);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
});

test('S5B-11 positive: a legitimate shortened quote containing a WHOLE expression still grounds', () => {
  const sentence = 'The survey office opened on March 3, 1889 in the old customs house.';
  for (const quote of [sentence, 'The survey office opened on March 3, 1889', 'opened on March 3, 1889 in the old customs house']) {
    const { report } = harborProbe(sentence, quote, { year: 1889, month: 3, day: 3 });
    assert.equal(report.publishable, true, `shortened quote "${quote}" contains the whole expression: ${failedIds(report).join(',')}`);
  }
});

test('S5B-11 sourceQuoteGrounding: statuses for cut, whole, ambiguous and unlocated quotes', () => {
  const index = buildSourceUnitIndex('The survey office opened on March 30, 1889 in the customs house.');
  const cut = sourceQuoteGrounding(index, 'The survey office opened on March 3', D(1889, 3, 3), 1889);
  assert.equal(cut.status, 'ungrounded');
  assert.deepEqual(cut.cutExpressions, ['March 30, 1889'], 'the complete source expression is cut by the quote edge');
  const whole = sourceQuoteGrounding(index, 'opened on March 30, 1889', D(1889, 3, 30), null);
  assert.equal(whole.status, 'grounded');
  // Mixed occurrences: one occurrence states the date via a complete expression, another does not.
  const mixed = buildSourceUnitIndex('Record one says the office opened on June 5, 1889 plainly. Record two says the office opened on June 5, 18890 exactly.');
  const amb = sourceQuoteGrounding(mixed, 'the office opened on June 5, 1889', D(1889, 6, 5), null);
  assert.equal(amb.status, 'ambiguous', 'occurrences that disagree fail closed');
  assert.equal(amb.occurrences, 2);
  assert.equal(amb.groundingOccurrences, 1);
  const unlocated = sourceQuoteGrounding(index, 'not in the source at all', D(1889, 3, 30), null);
  assert.equal(unlocated.status, 'unlocated');
});

test('S5B-11: the title-year rule still lends through the source span when the source unit states no year', () => {
  // "on January 19th" (whole expression inside the quote, source unit has no year-like token).
  const { report } = harborProbe('The survey office reopened on January 19th for the season.', 'The survey office reopened on January 19th', { year: 1889, month: 1, day: 19 });
  assert.equal(report.publishable, true, failedIds(report).join(','));
  // The same quote cut inside the day token never grounds.
  const cut = harborProbe('The survey office reopened on January 19th for the season.', 'The survey office reopened on January 1', { year: 1889, month: 1, day: 1 });
  assert.equal(cut.report.publishable, false);
  assert.deepEqual(failedIds(cut.report), ['timeline.date-grounded']);
});

/* ================================================================== */
/* S5B-12 — era markers are part of the range grammar                  */
/* ================================================================== */

test('S5B-12 BCE-range: "500–400 BCE" grounds −500 and −400, never a positive year (reviewer probe)', () => {
  assert.deepEqual(standaloneYears('The office was active during 500\u2013400 BCE.'), [-500, -400]);
  const wrongSign = harborProbe('The survey office was active during 500\u2013400 BCE.', 'The survey office was active during 500\u2013400 BCE.', { year: 400, month: 0, day: 0 });
  assert.equal(wrongSign.report.publishable, false, 'the worker must never publish +400 from an era-suffixed range');
  assert.deepEqual(failedIds(wrongSign.report), ['timeline.date-grounded']);
  assert.ok(!wrongSign.report.publishable || true);
  const rightSign = harborProbe('The survey office was active during 500\u2013400 BCE.', 'The survey office was active during 500\u2013400 BCE.', { year: -400, month: 0, day: 0 });
  assert.equal(rightSign.report.publishable, true, failedIds(rightSign.report).join(','));
  const leftEndpoint = harborProbe('The survey office was active during 500\u2013400 BCE.', 'The survey office was active during 500\u2013400 BCE.', { year: -500, month: 0, day: 0 });
  assert.equal(leftEndpoint.report.publishable, true, failedIds(leftEndpoint.report).join(','));
});

test('S5B-12: every BCE suffix form grounds both endpoints negatively; both-endpoint markers too', () => {
  for (const form of ['500\u2013400 BCE', '500\u2013400 BC', '500\u2013400 B.C.', '500\u2013400 B.C.E.', '500 BC\u2013400 BC', '500 B.C. \u2013 400 B.C.', '500-400 BCE']) {
    const quote = `The office was active during ${form}.`;
    const years = standaloneYears(quote);
    assert.deepEqual(years, [-500, -400], form);
    assert.equal(quoteGroundsDate(quote, D(-500), null), true, `${form} grounds −500`);
    assert.equal(quoteGroundsDate(quote, D(-400), null), true, `${form} grounds −400`);
    assert.equal(quoteGroundsDate(quote, D(500), null), false, `${form} never grounds +500`);
    assert.equal(quoteGroundsDate(quote, D(400), null), false, `${form} never grounds +400`);
    for (const e of parseDateExpressions(quote).filter(e => e.year !== null)) {
      assert.ok((e.year as number) < 0 && e.bce, `${form}: endpoint ${e.year} must be negative BCE`);
    }
  }
});

test('S5B-12: an ambiguous era range ("500 BCE–400") fails closed and suppresses title-year inheritance', () => {
  const quote = 'The office was active during 500 BCE\u2013400 in the valley.';
  assert.deepEqual(standaloneYears(quote), [], 'an ambiguous range grounds no endpoint at all');
  for (const claim of [D(-500), D(-400), D(500), D(400)]) {
    assert.equal(quoteGroundsDate(quote, claim, null), false, `${JSON.stringify(claim)} never grounds from an ambiguous range`);
  }
  const exprs = parseDateExpressions(quote);
  assert.ok(exprs.some(e => e.eraAmbiguous), 'the range is reported as era-ambiguous');
  // The ambiguous range is year-LIKE: the source unit cannot borrow a title year either.
  assert.equal(
    quoteGroundsDate('The office was active during 500 BCE\u2013400 and reopened on June 10.', D(1889, 6, 10), 1889),
    false,
  );
});

test('S5B-12: mixed eras "100 BC–AD 50" ground exactly −100 and +50 (correctly implemented, not fail-open)', () => {
  // Round-3 change: the OLD wording 'built between 100 BC–AD 50' is now (correctly) rejected by
  // the clean-context guard — 'between' is a frozen preceding bound — so the era-resolution
  // coverage uses a clean context and the bounded wording is asserted rejected below.
  const quote = 'The road was built in 100 BC\u2013AD 50 by traders.';
  assert.deepEqual(standaloneYears(quote), [-100, 50]);
  assert.equal(quoteGroundsDate(quote, D(-100), null), true);
  assert.equal(quoteGroundsDate(quote, D(50), null), true);
  assert.equal(quoteGroundsDate(quote, D(100), null), false);
  assert.equal(quoteGroundsDate(quote, D(-50), null), false);
  const bounded = 'The road was built between 100 BC\u2013AD 50 by traders.';
  assert.deepEqual(standaloneYears(bounded), [], "'between' in the preceding two words fails closed");
  assert.equal(quoteGroundsDate(bounded, D(-100), null), false);
});

test('S5B-12 controls: AD ranges keep grounding endpoints only; an abbreviated right endpoint grounds nothing new', () => {
  for (const range of ['1775-1783', '1775\u20131783', '1775/1783']) {
    const quote = `The war lasted ${range}.`;
    assert.equal(quoteGroundsDate(quote, D(1775), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1783), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1778), null), false, range);
  }
  // "1775–83": the two-digit endpoint is NOT expanded into 1783.
  assert.equal(quoteGroundsDate('The war lasted 1775\u201383.', D(1783), null), false);
  assert.equal(quoteGroundsDate('The war lasted 1775\u201383.', D(1775), null), true);
});

/* ================================================================== */
/* S5B-13 — approximation abbreviations, qualifiers and titles         */
/* ================================================================== */

test('S5B-13: "c."/"ca."/"approx." never split a sentence unit', () => {
  assert.deepEqual(sentenceUnits('The office opened c. March 3, 1889 in the customs house.'), [
    'The office opened c. March 3, 1889 in the customs house.',
  ]);
  assert.deepEqual(sentenceUnits('Met ca. 1889; adjourned. Next day.'), ['Met ca. 1889;', 'adjourned.', 'Next day.']);
  assert.deepEqual(sentenceUnits('Built approx. 1900 nearby. Later text.'), ['Built approx. 1900 nearby.', 'Later text.']);
  // Era and month abbreviations stay protected (no regression).
  assert.deepEqual(sentenceUnits('In 500 B.C. the city fell. Later text.'), ['In 500 B.C. the city fell.', 'Later text.']);
  assert.deepEqual(sentenceUnits('Met on Sept. 4, 1776. Next day.'), ['Met on Sept. 4, 1776.', 'Next day.']);
  // An era abbreviation's final period doubling as the sentence end STILL splits before a new
  // capitalised sentence, so a BCE year never merges into the next sentence's unit.
  assert.deepEqual(sentenceUnits('The office opened on March 3, 500 B.C.E. Field crews began mapping.'), [
    'The office opened on March 3, 500 B.C.E.',
    'Field crews began mapping.',
  ]);
  assert.deepEqual(sentenceUnits('It was built in 300 B.C.E. by traders'), ['It was built in 300 B.C.E. by traders']);
});

test('S5B-13 circa-abbrev: even the FULL-sentence quote of "c. March 3, 1889" fails approximate-date (reviewer probe)', () => {
  const sentence = 'The office opened c. March 3, 1889 in the customs house.';
  const { report } = harborProbe(sentence, sentence, { year: 1889, month: 3, day: 3 });
  assert.equal(report.publishable, false);
  assert.ok(failedIds(report).includes('timeline.approximate-date'), failedIds(report).join(','));
  assert.match(checkOf(report, 'timeline.approximate-date').message, /c\. March 3, 1889/);
});

test('S5B-13 trim-circa-abbrev: a quote trimmed out of a "c." sentence fails approximate-date (reviewer probe)', () => {
  const { report } = harborProbe(
    'The office opened c. March 3, 1889 in the customs house.',
    'March 3, 1889 in the customs house.',
    { year: 1889, month: 3, day: 3 },
  );
  assert.equal(report.publishable, false);
  assert.ok(failedIds(report).includes('timeline.approximate-date'), failedIds(report).join(','));
});

test('S5B-13 around-ordinal: "around the 4th of July 1776" fails approximate-date (reviewer probe)', () => {
  const sentence = 'The office opened around the 4th of July 1776.';
  const { report } = harborProbe(sentence, sentence, { year: 1776, month: 7, day: 4 });
  assert.equal(report.publishable, false);
  assert.ok(failedIds(report).includes('timeline.approximate-date'), failedIds(report).join(','));
  assert.match(checkOf(report, 'timeline.approximate-date').message, /around the 4th of July 1776/);
  // The honest control without the qualifier still publishes.
  const honest = 'The office opened on the 4th of July 1776.';
  const ok = harborProbe(honest, honest, { year: 1776, month: 7, day: 4 });
  assert.equal(ok.report.publishable, true, failedIds(ok.report).join(','));
});

test('S5B-13 approx-title-early: "(early 1889)" lends no title year and the exact date fails (reviewer probe)', () => {
  assert.equal(titleYearOf({ title: 'The Harbor Survey (early 1889)' }), null);
  const { report } = harborProbe('The office opened on March 3.', 'The office opened on March 3.', { year: 1889, month: 3, day: 3 }, 'The Harbor Survey (early 1889)');
  assert.equal(report.publishable, false);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
});

test('S5B-13: the title-year rule rejects the SAME approximation policy as the unit detector', () => {
  for (const bad of [
    'The Survey (early 1889)', 'The Survey (mid-1889)', 'The Survey (late 1889)', 'The Survey (middle 1889)',
    'The Survey (circa 1889)', 'The Survey (c. 1889)', 'The Survey (ca. 1889)', 'The Survey (approx. 1889)',
    'The Survey (around 1889)', 'The Survey (about 1889)', 'The Survey (roughly 1889)', 'The Survey (sometime in 1889)',
    'The Survey (1880s)', 'The Survey (1775-1783)', 'The Survey (1889?)',
  ]) {
    assert.equal(titleYearOf({ title: bad }), null, bad);
  }
  // Clean titles still lend.
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)' }), 1889);
  assert.equal(
    titleYearOf({ title: 'Declaration of Independence (1776) \u2014 National Archives, Milestone Documents (agency-written introduction)' }),
    1776,
  );
});

test('S5B-13 hasApproximateDate: qualifiers attach to expressions incl. article, day-first ordinal and chained part-qualifiers', () => {
  assert.equal(hasApproximateDate('The office opened c. March 3, 1889 in the customs house.'), 'c. March 3, 1889');
  assert.equal(hasApproximateDate('The office opened around the 4th of July 1776.'), 'around the 4th of July 1776');
  assert.equal(hasApproximateDate('built about mid-June 1776'), 'about mid-June 1776');
  assert.equal(hasApproximateDate('early 1889 records'), 'early 1889');
  assert.equal(hasApproximateDate('mid-1889 records'), 'mid-1889');
  assert.equal(hasApproximateDate('late 1889 records'), 'late 1889');
  assert.equal(hasApproximateDate('sometime in 1889 the office closed'), 'sometime in 1889');
  assert.equal(hasApproximateDate('built approx. 1900 nearby'), 'approx. 1900');
  assert.equal(hasApproximateDate('dated ca. March in the margin'), 'ca. March');
  // Preserved exact-match controls from round 1.
  assert.equal(hasApproximateDate('Life in the 1770s was hard'), '1770s');
  assert.equal(hasApproximateDate('dated circa 1895 in a later hand'), 'circa 1895');
});

test('S5B-13 controls: non-date counts and clean prose never fire', () => {
  assert.equal(hasApproximateDate('about 40 delegates arrived'), null);
  assert.equal(hasApproximateDate('the crew debated about taxation'), null);
  assert.equal(hasApproximateDate('The final report was signed on February 9, 1890 and mailed to the capital.'), null);
  assert.equal(hasApproximateDate('The office opened on March 3, 1889 with 4 delegates present.'), null);
  assert.equal(hasApproximateDate('around the world sailed the fleet in 1889'), null, 'a qualifier not directly before a date expression never fires');
});

test('S5B-13: a qualified expression never grounds an exact date (unit + full validator agree)', () => {
  assert.equal(quoteGroundsDate('The office opened around March 3, 1889.', D(1889, 3, 3), null), false);
  assert.equal(quoteGroundsDate('The office opened c. March 3, 1889.', D(1889, 3, 3), null), false);
  assert.equal(quoteGroundsDate('The office opened on March 3, 1889.', D(1889, 3, 3), null), true);
  const exprs = parseDateExpressions('The office opened around March 3, 1889.');
  assert.equal(exprs.length, 1);
  assert.equal(exprs[0]!.approx, 'around March 3, 1889');
  assert.equal(parseDateExpressions('The office opened on March 3, 1889.')[0]!.approx, null);
  // "about 40 delegates": the count parses as a bare year-like token but is NOT marked approximate.
  const countExprs = parseDateExpressions('about 40 delegates arrived');
  assert.equal(countExprs.some(e => e.approx !== null), false);
});

/* ================================================================== */
/* Lead positive controls through the FULL validator                   */
/* ================================================================== */

test('lead controls: Dec. 25 / 25 December / on January 19th + title-year / 300 B.C. / the 4th of July / Sept. 4th / range endpoints all publish', () => {
  // (Dates stay before the harbor fixture's April 14 mapping event so case-order is unaffected.)
  const cases: [string, string, { year: number; month: number; day: number }][] = [
    ['The office opened on Dec. 25, 1776 in the customs house.', 'The office opened on Dec. 25, 1776 in the customs house.', { year: 1776, month: 12, day: 25 }],
    ['The office opened on 25 December 1776 in the customs house.', 'The office opened on 25 December 1776', { year: 1776, month: 12, day: 25 }],
    ['The office reopened on January 19th for the season.', 'The office reopened on January 19th', { year: 1889, month: 1, day: 19 }],
    ['The office opened on the 4th of July 1776 in the customs house.', 'The office opened on the 4th of July 1776', { year: 1776, month: 7, day: 4 }],
    ['The office opened on Sept. 4th, 1776 in the customs house.', 'The office opened on Sept. 4th, 1776', { year: 1776, month: 9, day: 4 }],
    ['A stone dates to 300 B.C. in the valley records.', 'A stone dates to 300 B.C. in the valley records.', { year: -300, month: 0, day: 0 }],
    ['The survey office was active during 1775\u20131783 in the harbor.', 'The survey office was active during 1775\u20131783', { year: 1775, month: 0, day: 0 }],
    ['The survey office was active during 1775\u20131783 in the harbor.', 'during 1775\u20131783 in the harbor', { year: 1783, month: 0, day: 0 }],
  ];
  for (const [sentence, quote, date] of cases) {
    const { report } = harborProbe(sentence, quote, date);
    assert.equal(report.publishable, true, `${quote} -> ${JSON.stringify(date)}: ${failedIds(report).join(',')}`);
  }
  // Unit-level with the exact 1776 wordings from the brief.
  assert.equal(quoteGroundsDate('Washington crossed on Dec. 25, 1776 at night.', D(1776, 12, 25), null), true);
  assert.equal(quoteGroundsDate('Dated 25 December 1776 in the margin.', D(1776, 12, 25), null), true);
  assert.equal(quoteGroundsDate('On July 19th, Congress ordered the parchment engrossed.', D(1776, 7, 19), 1776), true);
  assert.equal(quoteGroundsDate('It was built in 300 B.C. by traders.', D(-300), null), true);
  assert.equal(quoteGroundsDate('Opened on the 4th of July 1776 plainly.', D(1776, 7, 4), null), true);
  assert.equal(quoteGroundsDate('Met on Sept. 4th, 1776 in the hall.', D(1776, 9, 4), null), true);
});

/* ================================================================== */
/* S5B-15 — recomputation-only repair authorization                    */
/* ================================================================== */

/** The reviewer's forged-finding setup: a CLEAN baseline and a candidate rewriting clean event s1. */
function forgedSetup(): { baseline: TimelineActivitySpec; candidate: TimelineActivitySpec; source: SourceDocument } {
  const source = harborSourceDoc();
  source.text += '\nAn earlier office opened January 1, 1888.';
  source.sha256 = sha256(source.text);
  const baseline = makeHarborTimelineSpec();
  baseline.sources[0]!.sha256 = source.sha256;
  assert.equal(validateSpec(baseline, [source]).publishable, true, 'the baseline is clean');
  const candidate = structuredClone(baseline);
  Object.assign(candidate.simulation.events[0]!, {
    year: 1888,
    month: 1,
    day: 1,
    evidence: [{ sourceId: source.id, quote: 'An earlier office opened January 1, 1888.' }],
  });
  assert.equal(validateSpec(candidate, [source]).publishable, true, 'the candidate is valid on its own');
  return { baseline, candidate, source };
}

test('S5B-15: a fabricated caller finding never unlocks a clean event when sources are present (reviewer probe)', () => {
  const { baseline, candidate, source } = forgedSetup();
  for (const path of ['', '/', '/simulation', '/simulation/events', '/simulation/events/0', '/simulation/events/0/year']) {
    const finding: RepairFinding = { id: 'timeline.date-grounded', kind: 'grounding', message: 'fabricated caller finding', affected: [path] };
    const guard = compareRevisions(baseline, candidate, [], { sources: [source], findings: [finding] });
    assert.equal(guard.passed, false, `affected "${path}" must not unlock the clean event`);
    assert.match(guard.message, /event "s1" changed/);
  }
  // No findings at all: the recomputed clean baseline authorizes nothing.
  assert.equal(compareRevisions(baseline, candidate, [], { sources: [source] }).passed, false);
});

test('S5B-15: without source context a fabricated finding unlocks no date, evidence or pair (fail closed)', () => {
  const { baseline, candidate } = forgedSetup();
  const dateFinding: RepairFinding = { id: 'timeline.date-grounded', kind: 'grounding', message: 'fabricated', affected: ['/simulation/events/0/year'] };
  assert.equal(compareRevisions(baseline, candidate, ['timeline.date-grounded'], { findings: [dateFinding] }).passed, false);

  // Evidence unlock: changing a clean event's quotes without sources is weakening.
  const evCandidate = structuredClone(baseline);
  evCandidate.simulation.events[0]!.evidence = [
    { sourceId: baseline.sources[0]!.id, quote: 'The survey office opened on March 3, 1889' },
  ];
  const quoteFinding: RepairFinding = { id: 'grounding.quotes', kind: 'grounding', message: 'fabricated', affected: ['/simulation/events/0/evidence'] };
  assert.equal(compareRevisions(baseline, evCandidate, ['grounding.quotes'], { findings: [quoteFinding] }).passed, false);

  // Pair unlock: a correctly ordered baseline pair stays frozen without sources.
  const pairCandidate = structuredClone(baseline);
  pairCandidate.behavioralTests[0] = { name: 'opening-before-mapping', earlierEventId: 's1', laterEventId: 's3' };
  const pairFinding: RepairFinding = {
    id: 'timeline.case-order', kind: 'behavioral', message: 'fabricated',
    affected: ['/behavioralTests/0/earlierEventId', '/behavioralTests/0/laterEventId'],
  };
  assert.equal(compareRevisions(baseline, pairCandidate, ['timeline.case-order'], { findings: [pairFinding] }).passed, false);
});

test('S5B-15: without source context a policy finding still unlocks ONLY the label string', () => {
  const source = harborSourceDoc();
  const baseline = makeHarborTimelineSpec();
  baseline.simulation.events[0]!.label = 'NASA office';
  const report = validateSpec(baseline, [source]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);
  const candidate = structuredClone(baseline);
  candidate.simulation.events[0]!.label = 'Survey office opens';
  const guard = compareRevisions(baseline, candidate, failedIds(report), { findings: repairFindings(report, baseline) });
  assert.equal(guard.passed, true, guard.message);
  // The same finding never unlocks the date without sources.
  const sneaky = structuredClone(candidate);
  sneaky.simulation.events[0]!.year = 1890;
  assert.equal(compareRevisions(baseline, sneaky, failedIds(report), { findings: repairFindings(report, baseline) }).passed, false);
});

test('S5B-15: a wrong-check-id finding intersected against the recomputed report unlocks nothing extra', () => {
  const source = harborSourceDoc();
  source.text += '\nAn earlier office opened January 1, 1888.';
  source.sha256 = sha256(source.text);
  const baseline = makeHarborTimelineSpec();
  baseline.sources[0]!.sha256 = source.sha256;
  baseline.simulation.events[0]!.label = 'NASA office'; // fails ONLY the policy check
  const report = validateSpec(baseline, [source]);
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);
  const candidate = structuredClone(baseline);
  candidate.simulation.events[0]!.label = 'Survey office opens';
  Object.assign(candidate.simulation.events[0]!, {
    year: 1888, month: 1, day: 1,
    evidence: [{ sourceId: source.id, quote: 'An earlier office opened January 1, 1888.' }],
  });
  const forged: RepairFinding[] = [
    ...repairFindings(report, baseline),
    { id: 'timeline.date-grounded', kind: 'grounding', message: 'fabricated', affected: ['/simulation/events/0/year', '/simulation/events/0/evidence'] },
  ];
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings: forged });
  assert.equal(guard.passed, false, 'a finding for a check that PASSED on recomputation is ignored');
  assert.match(guard.message, /event "s1" changed/);
  // The honest label-only fix still passes with the same real findings.
  const honest = structuredClone(baseline);
  honest.simulation.events[0]!.label = 'Survey office opens';
  assert.equal(compareRevisions(baseline, honest, failedIds(report), { sources: [source], findings: forged }).passed, true);
});

test('S5B-15: a stale finding pointing at another event never unlocks it — and consistently narrows the genuine failure away (S5B-17)', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[5]!.year = 1777; // e6 fails timeline.date-grounded (recomputed)
  const report = validateSpec(spec, [source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
  const stale: RepairFinding[] = [
    { id: 'timeline.date-grounded', kind: 'grounding', message: 'stale', affected: ['/simulation/events/0/year', '/simulation/events/0/month', '/simulation/events/0/day', '/simulation/events/0/evidence'] },
  ];
  const honest = structuredClone(spec);
  honest.simulation.events[5]!.year = 1776;
  // ROUND-3 FLIP (S5B-17, consistent narrowing): caller findings are the narrowing layer over the
  // recomputed revision-1 map. A stale finding list that does not intersect the genuine failure
  // narrows the authority to NOTHING — even the honest fix of e6 is rejected (fail closed). The
  // old behavior OR'ed a separate textual grounding result back in, which the round-3 review
  // showed lets a second authority disagree with the source-span validator.
  assert.equal(compareRevisions(spec, honest, failedIds(report), { sources: [source], findings: stale }).passed, false);
  // Without caller findings the recomputed map alone authorizes the honest fix.
  assert.equal(compareRevisions(spec, honest, failedIds(report), { sources: [source] }).passed, true);
  // ... and the stale finding does not unlock clean event e1 (index 0) either.
  const sneaky = structuredClone(honest);
  sneaky.simulation.events[0]!.day = 11;
  const guard = compareRevisions(spec, sneaky, failedIds(report), { sources: [source], findings: stale });
  assert.equal(guard.passed, false);
  assert.match(guard.message, /event "e1" changed/);
});

test('S5B-15: findings may narrow — an exact-path subset of the recomputed failure still authorizes that event', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[5]!.year = 1777;
  const report = validateSpec(spec, [source]);
  const narrow: RepairFinding[] = [{ id: 'timeline.date-grounded', kind: 'grounding', message: 'narrowed', affected: ['/simulation/events/5/year'] }];
  const next = structuredClone(spec);
  next.simulation.events[5]!.year = 1776;
  assert.equal(compareRevisions(spec, next, failedIds(report), { sources: [source], findings: narrow }).passed, true);
  // ROUND-3 FLIP (S5B-17, consistent narrowing): a finding whose paths do NOT intersect the
  // recomputed failure authorizes nothing at all — the genuine failure stays frozen (fail closed)
  // instead of being re-unlocked by a separate textual grounding result.
  const disjoint: RepairFinding[] = [{ id: 'timeline.date-grounded', kind: 'grounding', message: 'disjoint', affected: ['/simulation/events/1/year'] }];
  assert.equal(compareRevisions(spec, next, failedIds(report), { sources: [source], findings: disjoint }).passed, false);
  const sneaky = structuredClone(next);
  sneaky.simulation.events[1]!.day = 3; // e2 (July 2) is clean on the baseline
  assert.equal(compareRevisions(spec, sneaky, failedIds(report), { sources: [source], findings: disjoint }).passed, false);
});

test('S5B-15: real pipeline-shaped findings (repairFindings of the recomputed report) behave exactly like findings-less recomputation', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[5]!.year = 1777;
  const report = validateSpec(spec, [source]);
  const findings = repairFindings(report, spec);
  const next = structuredClone(spec);
  next.simulation.events[5]!.year = 1776;
  const withFindings = compareRevisions(spec, next, failedIds(report), { sources: [source], findings });
  const without = compareRevisions(spec, next, failedIds(report), { sources: [source] });
  assert.equal(withFindings.passed, true, withFindings.message);
  assert.equal(without.passed, true, without.message);
});

/* ================================================================== */
/* Round-1 regressions stay closed under the new grounding             */
/* ================================================================== */

test('round-1 probes stay rejected under source-span grounding', () => {
  const dayCount = harborProbe('The office opened on March 3, 1889 with 4 delegates present.', 'The office opened on March 3, 1889 with 4 delegates present.', { year: 1889, month: 3, day: 4 });
  assert.equal(dayCount.report.publishable, false);
  assert.deepEqual(failedIds(dayCount.report), ['timeline.date-grounded']);
  const crossMonth = harborProbe('The office opened on March 3, 1889 and moved on July 4, 1889.', 'The office opened on March 3, 1889 and moved on July 4, 1889.', { year: 1889, month: 3, day: 4 });
  assert.equal(crossMonth.report.publishable, false);
  assert.deepEqual(failedIds(crossMonth.report), ['timeline.date-grounded']);
  const trimAround = harborProbe('The office opened around March 3, 1889 in the customs house.', 'March 3, 1889 in the customs house.', { year: 1889, month: 3, day: 3 });
  assert.equal(trimAround.report.publishable, false);
  assert.ok(failedIds(trimAround.report).includes('timeline.approximate-date'));
  const circaTitle = harborProbe('The office opened on March 3.', 'The office opened on March 3.', { year: 1889, month: 3, day: 3 }, 'The Harbor Survey (circa 1889)');
  assert.equal(circaTitle.report.publishable, false);
  assert.ok(failedIds(circaTitle.report).includes('timeline.date-grounded'));
});

test('the real Declaration, harbor and treaty fixtures still publish after Wave A2', async () => {
  const { makeTreatyTimelineSpec, treatySourceDoc } = await import('./fixtures/timeline-specs.ts');
  const decl = declarationSpecAndSource();
  assert.equal(validateSpec(decl.spec, [decl.source]).publishable, true, 'Declaration');
  assert.equal(validateSpec(makeHarborTimelineSpec(), [harborSourceDoc()]).publishable, true, 'harbor');
  assert.equal(validateSpec(makeTreatyTimelineSpec(), [treatySourceDoc()]).publishable, true, 'treaty');
});
