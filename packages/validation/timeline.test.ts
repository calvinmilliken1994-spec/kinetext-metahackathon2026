// TASK-020 — timeline-v1 deterministic validation: sentence-unit date grounding (Muse review #1–#4,
// #8, #9 + the lead's title-year rule), approximate-date detection (#10), distinct dates (#5/#7),
// recomputed ordering answers, repair-finding paths, and the end-to-end fixture run.
// Every probe below is listed in the TASK-020 contract (docs/specs/STAGE-5b-plan.md item 6).
// Run: npm test (node --test packages/validation/timeline.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';

import { repairFindings, validateSpec } from './validate.ts';
import {
  formatTimelineDate,
  hasApproximateDate,
  orderAtSharedPrecision,
  quoteGroundsDate,
  sentenceUnits,
  standaloneYears,
  titleYearOf,
} from './timeline.ts';
import {
  declarationSpecAndSource,
  harborSourceDoc,
  makeHarborTimelineSpec,
  makeTreatyTimelineSpec,
  treatySourceDoc,
} from './fixtures/timeline-specs.ts';
import { makeProjectileSpec, projectileSourceDoc } from './fixtures/engine-specs.ts';
import type { TimelineActivitySpec, ValidationReport } from '../contracts/index.ts';

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

/** Assert the schema gate still passes, exactly `expected` checks fail, and the report blocks publication. */
function expectFailures(report: ValidationReport, expected: string[]): ValidationReport {
  assert.equal(checkOf(report, 'schema.full').passed, true, `mutation must keep the spec schema-valid: ${checkOf(report, 'schema.full').message}`);
  assert.deepEqual(failedIds(report), expected, failureDetail(report));
  assert.equal(report.publishable, false);
  return report;
}

const TIMELINE_CHECK_IDS = [
  'schema.full',
  'timeline.unique-ids',
  'timeline.approximate-date',
  'timeline.date-grounded',
  'timeline.distinct-dates',
  'timeline.case-order',
  'refs.sources',
  'refs.sha256',
  'grounding.quotes',
  'policy.no-publisher-attribution',
  'scope.prose-unverified',
];
const KINDS: Record<string, string> = {
  'schema.full': 'schema',
  'timeline.unique-ids': 'semantic',
  'timeline.approximate-date': 'grounding',
  'timeline.date-grounded': 'grounding',
  'timeline.distinct-dates': 'semantic',
  'timeline.case-order': 'behavioral',
  'refs.sources': 'grounding',
  'refs.sha256': 'grounding',
  'grounding.quotes': 'grounding',
  'policy.no-publisher-attribution': 'semantic',
  'scope.prose-unverified': 'semantic',
};

const D = (year: number, month = 0, day = 0) => ({ year, month, day });

/* ------------------------------------------------------------------ */
/* sentenceUnits — contract item 1                                     */
/* ------------------------------------------------------------------ */

test('sentenceUnits: splits on [.!?;] + whitespace and on newlines; a # heading line is one unit', () => {
  assert.deepEqual(
    sentenceUnits('# Heading (1776)\nBody text here. More! Really? Yes; done.'),
    ['# Heading (1776)', 'Body text here.', 'More!', 'Really?', 'Yes;', 'done.'],
  );
});

test('sentenceUnits: "B.C."/"A.D."/"B.C.E." abbreviations never split a unit', () => {
  assert.deepEqual(
    sentenceUnits('In 500 B.C. the city fell. Later text.'),
    ['In 500 B.C. the city fell.', 'Later text.'],
  );
  assert.deepEqual(
    sentenceUnits('A.D. 79 was fatal. Yes.'),
    ['A.D. 79 was fatal.', 'Yes.'],
  );
  assert.deepEqual(
    sentenceUnits('It was built in 300 B.C.E. by traders'),
    ['It was built in 300 B.C.E. by traders'],
  );
});

test('sentenceUnits: the "Sept." month abbreviation never splits a unit', () => {
  const units = sentenceUnits('Met on Sept. 4, 1776. Next day.');
  assert.deepEqual(units, ['Met on Sept. 4, 1776.', 'Next day.']);
  // The ';' IS a contract sentence separator; the "Sept." period still must not split.
  assert.deepEqual(
    sentenceUnits('Met on Sept. 4, 1776; adjourned. Next day.'),
    ['Met on Sept. 4, 1776;', 'adjourned.', 'Next day.'],
  );
});

/* ------------------------------------------------------------------ */
/* Year matching on a unit — contract item 2 (Muse findings #1, #4)    */
/* ------------------------------------------------------------------ */

test('probe: "1,000 soldiers" never grounds year 1000 (grouped numbers are masked first)', () => {
  assert.deepEqual(standaloneYears('1,000 soldiers marched in 1776'), [1776]);
  assert.equal(quoteGroundsDate('The pay was 1,000 pounds that year.', D(1000), null), false);
  assert.equal(quoteGroundsDate('A force of 1000 men arrived.', D(1000), null), true);
});

test('probe: a year grounded by (^|[^0-9])YEAR($|[^0-9]) never matches inside a longer number', () => {
  assert.equal(quoteGroundsDate('The tally reached 17760 units.', D(1776), null), false);
});

test('probe: "1775–1783" (and -/–//) grounds the endpoints 1775 and 1783 but not 1778', () => {
  for (const range of ['1775-1783', '1775–1783', '1775/1783']) {
    const quote = `The war lasted ${range}.`;
    assert.equal(quoteGroundsDate(quote, D(1775), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1783), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1778), null), false, range);
  }
});

test('probe: "500 BCE" grounds -500, never 500; a BCE marker forbids the positive year', () => {
  for (const form of ['500 BCE', '500 BC', '500 B.C.', '500 B.C.E.']) {
    assert.deepEqual(standaloneYears(`The city fell in ${form}.`), [-500], form);
    assert.equal(quoteGroundsDate(`The city fell in ${form}.`, D(-500), null), true, form);
    assert.equal(quoteGroundsDate(`The city fell in ${form}.`, D(500), null), false, form);
  }
  // A positive year must NOT have a BCE marker after it.
  assert.equal(quoteGroundsDate('Dated 1776 BCE in the margin.', D(1776), null), false);
  assert.equal(quoteGroundsDate('Dated 1776 BCE in the margin.', D(-1776), null), true);
});

test('probe: the decade form "the 1770s" is not a standalone year', () => {
  assert.deepEqual(standaloneYears('built in the 1770s'), []);
  assert.equal(quoteGroundsDate('The style was popular in the 1770s.', D(1770), null), false);
});

test('probe: "July ... [sentence] ... 1776" across two sentences does not ground July 1776', () => {
  assert.equal(quoteGroundsDate('July was hot. The year 1776 began.', D(1776, 7), null), false);
  // ... while ONE unit stating both does.
  assert.equal(quoteGroundsDate('In July 1776 the delegates met.', D(1776, 7), null), true);
});

/* ------------------------------------------------------------------ */
/* Month/day matching — contract item 2 (Muse findings #3, #9)         */
/* ------------------------------------------------------------------ */

test('probe: the fixed month list matches names, abbreviations and "Sept." case-insensitively', () => {
  assert.equal(quoteGroundsDate('The court met on Sept. 4, 1776.', D(1776, 9, 4), null), true);
  assert.equal(quoteGroundsDate('The court met on september 4, 1776.', D(1776, 9, 4), null), true);
  assert.equal(quoteGroundsDate('The court met on Sep 4, 1776.', D(1776, 9, 4), null), true);
  assert.equal(quoteGroundsDate('The court met on Dec. 4, 1776.', D(1776, 12, 4), null), true);
  // A wrong month never grounds.
  assert.equal(quoteGroundsDate('The court met on Sept. 4, 1776.', D(1776, 10, 4), null), false);
});

test('probe: "4th" ordinal day grounds day 4; stray day numbers need the month in the SAME unit', () => {
  assert.equal(quoteGroundsDate('On July 4th the news arrived.', D(1776, 7, 4), 1776), true);
  assert.equal(quoteGroundsDate('On July 04 the news arrived.', D(1776, 7, 4), 1776), true);
  // "4 delegates" does not ground day 4: the month is in a different sentence unit.
  assert.equal(quoteGroundsDate('June was busy. The report listed 4 delegates.', D(1776, 6, 4), 1776), false);
  assert.equal(quoteGroundsDate('There were 4 delegates in 1776.', D(1776, 6, 4), null), false);
});

/* ------------------------------------------------------------------ */
/* Title-year rule — lead decision 2026-10-28, on the REAL source      */
/* ------------------------------------------------------------------ */

test('titleYearOf: the real NARA title (field and # heading line) grants exactly 1776', () => {
  const { source } = declarationSpecAndSource();
  assert.equal(titleYearOf(source), 1776);
  assert.equal(titleYearOf({ title: 'Declaration of Independence (1776) — National Archives, Milestone Documents (agency-written introduction)' }), 1776);
  assert.equal(titleYearOf({ text: '# Declaration of Independence (1776)\n\nBody.' }), 1776);
});

test('titleYearOf: a title with two years (or none) grants nothing', () => {
  assert.equal(titleYearOf({ title: 'War Years (1775-1783)' }), null);
  assert.equal(titleYearOf({ title: 'No year here' }), null);
  assert.equal(titleYearOf({ title: '' }), null);
});

test('probe: title-year rule positive — "Congress appointed on June 10 a committee..." grounds 1776-06-10 via the "(1776)" title', () => {
  const quote = 'Congress appointed on June 10 a committee of five to draft a statement of independence for the colonies';
  assert.equal(quoteGroundsDate(quote, D(1776, 6, 10), 1776), true);
  // Without the title there is no year in the unit.
  assert.equal(quoteGroundsDate(quote, D(1776, 6, 10), null), false);
});

test('probe: title-year rule negative — a quote with no month can never borrow the title year', () => {
  assert.equal(quoteGroundsDate('Congress appointed a committee of five that year.', D(1776), 1776), false);
  assert.equal(quoteGroundsDate('On the 10th a committee was appointed.', D(1776), 1776), false);
});

test('probe: title-year rule negative — a date unit containing another year cannot borrow', () => {
  assert.equal(
    quoteGroundsDate('After 1775 tensions rose, on June 10 a committee was appointed.', D(1776, 6, 10), 1776),
    false,
  );
  // The same quote grounds 1775-06-10 directly... the unit states 1775 with month and day.
  assert.equal(
    quoteGroundsDate('After 1775 tensions rose, on June 10 a committee was appointed.', D(1775, 6, 10), null),
    true,
  );
});

/* ------------------------------------------------------------------ */
/* Approximate dates — contract item 3 (Muse finding #10)              */
/* ------------------------------------------------------------------ */

test('probe: "the 1770s" is approximate; circa/c./ca./around/about/early/mid/late before a date are approximate', () => {
  assert.equal(hasApproximateDate('Life in the 1770s was hard'), '1770s');
  for (const unit of [
    'founded circa 500 B.C.',
    'dated c. 1776 in the margin',
    'dated ca. 1776 in the margin',
    'around 1776 the mood shifted',
    'about June the crews arrived',
    'early 1800s records',
    'late July brought heat',
    'mid-1776 correspondence',
  ]) {
    assert.notEqual(hasApproximateDate(unit), null, unit);
  }
});

test('approximate markers not followed by a year/month never fire', () => {
  assert.equal(hasApproximateDate('the crew debated about taxation'), null);
  assert.equal(hasApproximateDate('about 40 delegates arrived'), null);
  assert.equal(hasApproximateDate('The final report was signed on February 9, 1890 and mailed to the capital.'), null);
});

/* ------------------------------------------------------------------ */
/* Ordering at shared precision — Muse finding #5                      */
/* ------------------------------------------------------------------ */

test('orderAtSharedPrecision: compares only at the precision BOTH events state; BCE years order naturally', () => {
  assert.equal(orderAtSharedPrecision(D(1855), D(1855, 6)), 'equal');
  assert.equal(orderAtSharedPrecision(D(1776, 6, 10), D(1776, 7, 4)), 'before');
  assert.equal(orderAtSharedPrecision(D(1776, 7, 4), D(1776, 6, 10)), 'after');
  assert.equal(orderAtSharedPrecision(D(-500), D(1855)), 'before');
  assert.equal(orderAtSharedPrecision(D(-500), D(-400)), 'before');
  assert.equal(orderAtSharedPrecision(D(1776, 7, 4), D(1776, 7)), 'equal');
});

test('formatTimelineDate renders stated components and BCE years', () => {
  assert.equal(formatTimelineDate(D(1776, 6, 10)), '1776-06-10');
  assert.equal(formatTimelineDate(D(1855, 6)), '1855-06');
  assert.equal(formatTimelineDate(D(1855)), '1855');
  assert.equal(formatTimelineDate(D(-500)), '500 BCE');
});

/* ------------------------------------------------------------------ */
/* End-to-end: the assembled real-Declaration fixture is publishable   */
/* ------------------------------------------------------------------ */

test('e2e probe: assembleTimelineSpec(fixture) → validateSpec publishes with every timeline check passing', () => {
  const { spec, source } = declarationSpecAndSource();
  const report = validateSpec(spec, [source]);
  assert.deepEqual(report.checks.map(c => c.id), TIMELINE_CHECK_IDS, failureDetail(report));
  for (const c of report.checks) {
    assert.equal(c.kind, KINDS[c.id], `check ${c.id} kind`);
    assert.equal(c.passed, true, `${c.id}: ${c.message}`);
  }
  assert.equal(report.publishable, true, failureDetail(report));
  assert.equal(report.artifactId, 'tl-declaration-fixture');
  assert.equal(report.revision, 1);
  // The title-year rule grounded "on June 10" (e1) on the real page titled "... (1776)".
  assert.match(checkOf(report, 'timeline.date-grounded').message, /6 event/);
});

test('e2e: the synthetic harbor and treaty specs publish with every timeline check passing', () => {
  const harbor = validateSpec(makeHarborTimelineSpec(), [harborSourceDoc()]);
  assert.equal(harbor.publishable, true, failureDetail(harbor));
  assert.deepEqual(harbor.checks.map(c => c.id), TIMELINE_CHECK_IDS);
  const treaty = validateSpec(makeTreatyTimelineSpec(), [treatySourceDoc()]);
  assert.equal(treaty.publishable, true, failureDetail(treaty));
  // The BCE event grounded via "500 B.C." in one unit.
  assert.equal(checkOf(treaty, 'timeline.date-grounded').passed, true, treaty.checks.map(c => c.message).join('\n'));
});

test('numeric engines are untouched: the projectile fixture still publishes through the same dispatch', () => {
  const report = validateSpec(makeProjectileSpec(), [projectileSourceDoc()]);
  assert.equal(report.publishable, true, failureDetail(report));
});

/* ------------------------------------------------------------------ */
/* Schema gate + engine dispatch                                       */
/* ------------------------------------------------------------------ */

test('schema.full gate: an invalid timeline spec short-circuits into one failed schema.full check', () => {
  const spec = declarationSpecAndSource().spec as unknown as { simulation: { events: { year: number }[] } };
  spec.simulation.events[0]!.year = 0; // year 0 is forbidden
  const { source } = declarationSpecAndSource();
  const report = validateSpec(spec, [source]);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.full']);
  assert.equal(report.checks[0]!.passed, false);
  assert.match(report.checks[0]!.message, /spec failed schema\.full/);
  assert.equal(report.publishable, false);
});

test('engine dispatch: timeline-v1 validates; an unknown engine still reports the numeric ENGINE_IDS list', () => {
  const report = validateSpec({ id: 'x', simulation: { engine: 'timeline-v2' } }, []);
  assert.deepEqual(report.checks.map(c => c.id), ['schema.full']);
  assert.match(report.checks[0]!.message, /expected one of forces-1d-v1/);
  assert.ok(!report.checks[0]!.message.includes('timeline-v1'), 'timeline-v1 is not an ENGINE_IDS member yet');
  assert.equal(report.publishable, false);
});

/* ------------------------------------------------------------------ */
/* timeline.unique-ids                                                 */
/* ------------------------------------------------------------------ */

test('timeline.unique-ids: duplicate event ids fail exactly that check', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[1]!.id = 'e1';
  expectFailures(validateSpec(spec, [source]), ['timeline.unique-ids']);
});

test('timeline.unique-ids: a case referencing an unknown event fails exactly that check', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.behavioralTests[0]!.laterEventId = 'e9';
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.unique-ids']);
  assert.match(checkOf(report, 'timeline.unique-ids').message, /references unknown laterEventId "e9"/);
});

test('timeline.unique-ids: a case pairing an event with itself fails (and case-order reports the ambiguity)', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.predictions[0]!.earlierEventId = 'e3';
  spec.predictions[0]!.laterEventId = 'e3';
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.unique-ids', 'timeline.case-order']);
  assert.match(checkOf(report, 'timeline.unique-ids').message, /earlierEventId and laterEventId are both "e3"/);
});

/* ------------------------------------------------------------------ */
/* timeline.approximate-date                                           */
/* ------------------------------------------------------------------ */

test('mutation: re-dating an event to "circa 1895" fails exactly timeline.approximate-date', () => {
  const spec = makeHarborTimelineSpec();
  const source = harborSourceDoc();
  const e5 = spec.simulation.events[4]!;
  e5.year = 1895;
  e5.month = 0;
  e5.day = 0;
  e5.evidence = [{ sourceId: source.id, quote: 'A later hand dated the margin notes circa 1895.' }];
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.approximate-date']);
  const msg = checkOf(report, 'timeline.approximate-date').message;
  assert.match(msg, /approximate date — remove this event/);
  assert.match(msg, /"s5"/);
  assert.match(msg, /circa 1895/);
  assert.equal(checkOf(report, 'timeline.approximate-date').path, '/simulation/events/4');
});

/* ------------------------------------------------------------------ */
/* timeline.date-grounded                                              */
/* ------------------------------------------------------------------ */

test('mutation probe: an ungrounded year (model knowledge) fails exactly timeline.date-grounded and names event, date and quote', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[5]!.year = 1777; // the quote says "on August 2, 1776"
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.date-grounded']);
  const check = checkOf(report, 'timeline.date-grounded');
  assert.match(check.message, /"e6"/);
  assert.match(check.message, /1777/);
  assert.match(check.message, /on August 2, 1776, delegates began signing it\./);
  assert.equal(check.path, '/simulation/events/5');
});

test('mutation: an ungrounded month fails exactly timeline.date-grounded', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[0]!.month = 5; // quote says "on June 10"
  expectFailures(validateSpec(spec, [source]), ['timeline.date-grounded']);
});

test('probe: a year-only event can never borrow the title year (month required) — the REAL "on June 10" quote', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[0]!.month = 0;
  spec.simulation.events[0]!.day = 0;
  // date-grounded must fail; the t1 pair (e1, e3) also becomes ambiguous at year precision.
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.date-grounded', 'timeline.case-order']);
  assert.match(checkOf(report, 'timeline.date-grounded').message, /"e1"/);
});

test('a fabricated event quote fails grounding.quotes AND timeline.date-grounded, both naming the event', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[2]!.evidence = [
    { sourceId: source.id, quote: 'The Continental Congress adopted the Declaration of Independence on July 4, 1776, at high noon.' },
  ];
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.date-grounded', 'grounding.quotes']);
  assert.match(checkOf(report, 'timeline.date-grounded').message, /"e3"/);
  assert.match(checkOf(report, 'grounding.quotes').message, /event "e3"/);
});

/* ------------------------------------------------------------------ */
/* timeline.distinct-dates                                             */
/* ------------------------------------------------------------------ */

test('mutation: two events with the identical full date fail exactly timeline.distinct-dates', () => {
  const spec = makeHarborTimelineSpec();
  const source = harborSourceDoc();
  const s4 = spec.simulation.events[3]!;
  s4.year = 1889;
  s4.month = 7;
  s4.day = 1;
  s4.evidence = [{ sourceId: source.id, quote: 'The customs office reopened on July 1, 1889 after repairs.' }];
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.distinct-dates']);
  const msg = checkOf(report, 'timeline.distinct-dates').message;
  assert.match(msg, /"s3"/);
  assert.match(msg, /"s4"/);
  assert.match(msg, /1889-07-01/);
  assert.equal(checkOf(report, 'timeline.distinct-dates').path, '/simulation/events/3');
});

test('distinct dates compare the full tuple: same year+month with different days is fine', () => {
  const { spec, source } = declarationSpecAndSource();
  // e2 (Jul 2) and e3 (Jul 4) share year+month — the fixture already proves tuple distinctness passes.
  assert.equal(validateSpec(spec, [source]).publishable, true);
});

/* ------------------------------------------------------------------ */
/* timeline.case-order                                                 */
/* ------------------------------------------------------------------ */

test('mutation probe: a wrong-order pair fails exactly timeline.case-order with "wrong answer"', () => {
  const spec = makeTreatyTimelineSpec();
  spec.behavioralTests[2]!.earlierEventId = 'b5';
  spec.behavioralTests[2]!.laterEventId = 'b4';
  const report = expectFailures(validateSpec(spec, [treatySourceDoc()]), ['timeline.case-order']);
  const check = checkOf(report, 'timeline.case-order');
  assert.match(check.message, /wrong answer/);
  assert.match(check.message, /"map-before-revision"/);
  assert.equal(check.path, '/behavioralTests/2');
});

test('mutation: swapping a Declaration pair fails exactly timeline.case-order', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.behavioralTests[0]!.earlierEventId = 'e3';
  spec.behavioralTests[0]!.laterEventId = 'e1';
  expectFailures(validateSpec(spec, [source]), ['timeline.case-order']);
});

test('mutation probe: a year-only pair against a month-only event of the same year is ambiguous, not array order', () => {
  const spec = makeTreatyTimelineSpec();
  spec.predictions[0]!.earlierEventId = 'b1'; // (1855)
  spec.predictions[0]!.laterEventId = 'b2'; // (1855-06)
  const report = expectFailures(validateSpec(spec, [treatySourceDoc()]), ['timeline.case-order']);
  assert.match(checkOf(report, 'timeline.case-order').message, /ambiguous/);
  assert.equal(checkOf(report, 'timeline.case-order').path, '/predictions/0');
});

test('BCE ordering: a -500 event is strictly earlier than an 1855 event (no calendar conversion)', () => {
  const spec = makeTreatyTimelineSpec();
  const report = validateSpec(spec, [treatySourceDoc()]);
  assert.equal(checkOf(report, 'timeline.case-order').passed, true, checkOf(report, 'timeline.case-order').message);
});

/* ------------------------------------------------------------------ */
/* Generic checks over event evidence                                  */
/* ------------------------------------------------------------------ */

test('refs.sources: event evidence citing an undeclared sourceId fails exactly refs.sources', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[0]!.evidence.push({ sourceId: 'not-declared', quote: 'an extra description of the committee work' });
  const report = expectFailures(validateSpec(spec, [source]), ['refs.sources']);
  assert.match(checkOf(report, 'refs.sources').message, /not-declared/);
});

test('policy.no-publisher-attribution: an event label naming the publisher fails exactly that check', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[0]!.label = 'According to NASA, a committee was appointed';
  const report = expectFailures(validateSpec(spec, [source]), ['policy.no-publisher-attribution']);
  assert.equal(checkOf(report, 'policy.no-publisher-attribution').path, '/simulation/events/0/label');
});

test('grounding.quotes: event evidence counts toward the verbatim quote check', () => {
  const { spec, source } = declarationSpecAndSource();
  spec.simulation.events[4]!.evidence = [{ sourceId: source.id, quote: 'On July 19th, Congress ordered the parchment ENGROSSED with a new title.' }];
  const report = expectFailures(validateSpec(spec, [source]), ['timeline.date-grounded', 'grounding.quotes']);
  assert.match(checkOf(report, 'grounding.quotes').message, /event "e5"/);
});

/* ------------------------------------------------------------------ */
/* repairFindings — contract item 5                                    */
/* ------------------------------------------------------------------ */

test('repairFindings: timeline failures carry item paths like /simulation/events/5 and /behavioralTests/2', () => {
  const decl = declarationSpecAndSource();
  decl.spec.simulation.events[5]!.year = 1777;
  const declReport = validateSpec(decl.spec, [decl.source]);
  const declFindings = repairFindings(declReport, decl.spec);
  assert.deepEqual(declFindings.map(f => [f.id, f.path]), [['timeline.date-grounded', '/simulation/events/5']]);
  assert.match(declFindings[0]!.message, /"e6"/);
  assert.equal(declFindings[0]!.kind, 'grounding');

  const treaty = makeTreatyTimelineSpec();
  treaty.behavioralTests[2]!.earlierEventId = 'b5';
  treaty.behavioralTests[2]!.laterEventId = 'b4';
  const treatyFindings = repairFindings(validateSpec(treaty, [treatySourceDoc()]), treaty);
  assert.deepEqual(treatyFindings.map(f => [f.id, f.path]), [['timeline.case-order', '/behavioralTests/2']]);

  // Numeric findings keep their structured numbers (no regression).
  const bad = makeProjectileSpec();
  (bad.behavioralTests[0] as unknown as Record<string, number>).expectedMaxHeightM += 0.05;
  const numeric = repairFindings(validateSpec(bad, [projectileSourceDoc()]), bad);
  assert.equal(numeric[0]!.id, 'behavior.tests');
  assert.equal(typeof numeric[0]!.computed, 'number');
});

test('validateSpec never throws on junk timeline input', () => {
  const junk: unknown[] = [null, undefined, 42, 'timeline-v1', { simulation: { engine: 'timeline-v1' } }, { simulation: { engine: 'timeline-v1', events: 'x' } }];
  for (const j of junk) {
    const report = validateSpec(j, []);
    assert.equal(report.publishable, false);
    assert.ok(report.checks.length >= 1);
  }
});
