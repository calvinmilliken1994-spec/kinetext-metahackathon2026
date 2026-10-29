// Stage 5b review round 1 — Wave A regression tests (S5B-01..S5B-04 validation side).
// Every case below is a reviewer probe from cache/scratch/review-5b/probe-results.json (or a lead
// probe / positive control named in the Wave A brief). These encode the SAFE behavior the review
// demanded: connected date-expression grounding, source-context approximation, structured
// affected-path findings with field-scoped timeline repair authorization, and per-field analysis
// findings. Run: npm test (node --test packages/validation/review-5b.test.ts)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  affectedByCheckIdOf,
  affectedPathsOf,
  compareRevisions,
  repairFindings,
  validateAnalysis,
  validateSpec,
} from './validate.ts';
import {
  buildSourceUnitIndex,
  formatTimelineDate,
  hasApproximateDate,
  parseDateExpressions,
  quoteGroundsDate,
  sourceQuoteApproximation,
  titleYearOf,
} from './timeline.ts';
import {
  declarationSpecAndSource,
  harborSourceDoc,
  makeHarborTimelineSpec,
  makeTreatyTimelineSpec,
  treatySourceDoc,
} from './fixtures/timeline-specs.ts';
import { loadSource, sha256 } from '../sources/index.ts';
import type { SourceAnalysis, SourceDocument, TimelineActivitySpec, ValidationReport } from '../contracts/index.ts';

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
 * The reviewer's dateProbe: swap the harbor source's opening sentence (and optionally its title and
 * '#' heading), keep the sha256/spec consistent, and re-date event[0] to `date` with `quote`.
 */
function harborProbe(
  sentence: string,
  quote: string,
  date: { year: number; month: number; day: number },
  title?: string,
): { spec: TimelineActivitySpec; source: SourceDocument } {
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
  spec.simulation.events[0]!.evidence[0]!.quote = quote;
  return { spec, source };
}

/** The reviewer's guard probes: baseline with one injected violation, and a candidate "repair". */
function guardProbe(
  mutateBaseline: (spec: TimelineActivitySpec, source: SourceDocument) => void,
  mutateCandidate: (spec: TimelineActivitySpec, source: SourceDocument) => void,
): { baseline: TimelineActivitySpec; candidate: TimelineActivitySpec; source: SourceDocument; report: ValidationReport } {
  const source = harborSourceDoc();
  source.text += '\nAn earlier office opened on January 1, 1888.';
  source.sha256 = sha256(source.text);
  const baseline = makeHarborTimelineSpec();
  baseline.sources[0]!.sha256 = source.sha256;
  mutateBaseline(baseline, source);
  const candidate = structuredClone(baseline);
  mutateCandidate(candidate, source);
  const report = validateSpec(baseline, [source]);
  return { baseline, candidate, source, report };
}

/* ================================================================== */
/* S5B-01 — connected date expressions, not token bags                 */
/* ================================================================== */

test('S5B-01 day-count-as-date: "March 3 ... 4 delegates" never grounds March 4 (reviewer probe)', () => {
  const { spec, source } = harborProbe(
    'The office opened on March 3, 1889 with 4 delegates present.',
    'The office opened on March 3, 1889 with 4 delegates present.',
    { year: 1889, month: 3, day: 4 },
  );
  const report = validateSpec(spec, [source]);
  assert.equal(report.publishable, false, 'the fabricated March 4 must not publish');
  assert.deepEqual(failedIds(report), ['timeline.date-grounded'], report.checks.map(c => `${c.id}:${c.passed}`).join(' '));
  // The stated March 3 IS grounded by the one connected expression.
  assert.equal(quoteGroundsDate('The office opened on March 3, 1889 with 4 delegates present.', D(1889, 3, 3), null), true);
  assert.equal(quoteGroundsDate('The office opened on March 3, 1889 with 4 delegates present.', D(1889, 3, 4), null), false);
});

test('S5B-01 cross-month-day: "March 3 ... July 4" never grounds March 4 (reviewer probe)', () => {
  const { spec, source } = harborProbe(
    'The office opened on March 3, 1889 and moved on July 4, 1889.',
    'The office opened on March 3, 1889 and moved on July 4, 1889.',
    { year: 1889, month: 3, day: 4 },
  );
  const report = validateSpec(spec, [source]);
  assert.equal(report.publishable, false);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
  const quote = 'The office opened on March 3, 1889 and moved on July 4, 1889.';
  assert.equal(quoteGroundsDate(quote, D(1889, 3, 3), null), true, 'March 3 is one expression');
  assert.equal(quoteGroundsDate(quote, D(1889, 7, 4), null), true, 'July 4 is one expression');
  assert.equal(quoteGroundsDate(quote, D(1889, 3, 4), null), false, 'day 4 never joins month 3 across expressions');
});

test('S5B-01 parseDateExpressions: a bare count is a year-like token, never a day; day needs a month', () => {
  const exprs = parseDateExpressions('The office opened on March 3, 1889 with 4 delegates present.');
  // Exactly one month-day-year expression; the stray "4" is NOT a day.
  const full = exprs.find(e => e.month === 3 && e.day === 3 && e.year === 1889);
  assert.ok(full !== undefined, 'March 3, 1889 parses as one connected expression');
  assert.ok(
    !exprs.some(e => e.day === 4),
    'the "4 delegates" count is never parsed as a day',
  );
});

test('S5B-01 lead probes stay grounded: Dec. 25 1776 / 25 December 1776 / July 19th / 300 B.C. / 1775–1783', () => {
  assert.equal(quoteGroundsDate('Washington crossed on Dec. 25, 1776 at night.', D(1776, 12, 25), null), true);
  assert.equal(quoteGroundsDate('Dated 25 December 1776 in the margin.', D(1776, 12, 25), null), true);
  // "on July 19th" grounds month+day via the title-year rule.
  assert.equal(quoteGroundsDate('On July 19th, Congress ordered the parchment engrossed.', D(1776, 7, 19), 1776), true);
  assert.equal(quoteGroundsDate('On July 19th, Congress ordered the parchment engrossed.', D(1776, 7, 19), null), false);
  // BCE.
  assert.deepEqual(
    parseDateExpressions('It was built in 300 B.C.E. by traders').filter(e => e.year !== null).map(e => e.year),
    [-300],
  );
  assert.equal(quoteGroundsDate('It was built in 300 B.C.E. by traders', D(-300), null), true);
  assert.equal(quoteGroundsDate('It was built in 300 B.C.E. by traders', D(300), null), false);
  // Range endpoints, all three separators.
  for (const range of ['1775-1783', '1775\u20131783', '1775/1783']) {
    const quote = `The war lasted ${range}.`;
    assert.equal(quoteGroundsDate(quote, D(1775), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1783), null), true, range);
    assert.equal(quoteGroundsDate(quote, D(1778), null), false, range);
  }
});

test('S5B-01: a day is only counted inside a month-day expression, never from a stray number', () => {
  assert.equal(quoteGroundsDate('June was busy. The report listed 4 delegates.', D(1776, 6, 4), 1776), false);
  assert.equal(quoteGroundsDate('There were 4 delegates in 1776.', D(1776, 6, 4), null), false);
  assert.equal(quoteGroundsDate('On July 4th the news arrived.', D(1776, 7, 4), 1776), true);
  assert.equal(quoteGroundsDate('On July 04 the news arrived.', D(1776, 7, 4), 1776), true);
});

/* ================================================================== */
/* S5B-02 — source-context approximation, not just the quoted substring */
/* ================================================================== */

test('S5B-02 trim-approximate: a quote trimmed out of "around March 3, 1889" fails approximate-date (reviewer probe)', () => {
  const { spec, source } = harborProbe(
    'The office opened around March 3, 1889 in the customs house.',
    'March 3, 1889 in the customs house.',
    { year: 1889, month: 3, day: 3 },
  );
  const report = validateSpec(spec, [source]);
  assert.equal(report.publishable, false, 'the trimmed exact date must not publish');
  assert.ok(failedIds(report).includes('timeline.approximate-date'), `expected approximate-date to fire, got ${failedIds(report)}`);
  assert.match(checkOf(report, 'timeline.approximate-date').message, /around/);
});

test('S5B-02 approximate-title: "The Harbor Survey (circa 1889)" lends no title year (reviewer probe)', () => {
  assert.equal(titleYearOf({ title: 'The Harbor Survey (circa 1889)' }), null);
  const { spec, source } = harborProbe(
    'The office opened on March 3.',
    'The office opened on March 3.',
    { year: 1889, month: 3, day: 3 },
    'The Harbor Survey (circa 1889)',
  );
  const report = validateSpec(spec, [source]);
  assert.equal(report.publishable, false, 'an approximate title cannot ground an exact 1889-03-03');
  assert.ok(failedIds(report).includes('timeline.date-grounded'), `got ${failedIds(report)}`);
});

test('S5B-02 title-year rule rejects approximation/range/ambiguity markers but keeps clean titles', () => {
  for (const bad of [
    'The Survey (circa 1889)',
    'The Survey (c. 1889)',
    'The Survey (ca. 1889)',
    'The Survey (around 1889)',
    'The Survey (about 1889)',
    'The Survey (1880s)',
    'The Survey (1775-1783)',
    'The Survey (1889?)',
  ]) {
    assert.equal(titleYearOf({ title: bad }), null, bad);
  }
  // Clean single-year titles still lend their year.
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)' }), 1889);
  assert.equal(
    titleYearOf({ title: 'Declaration of Independence (1776) \u2014 National Archives, Milestone Documents (agency-written introduction)' }),
    1776,
  );
});

test('S5B-02: a quote occurring twice with different qualifier contexts fails closed', () => {
  // Build a source where the SAME verbatim quote appears once inside an "around <year>" sentence and
  // once in a clean sentence. The qualifier sits in the SOURCE context, outside the quoted substring.
  const source = harborSourceDoc();
  const dup = 'the harbor office opened on March 3, 1889';
  source.text =
    '# The Harbor Survey (1889)\n\n' +
    `Sources say around 1889 ${dup}. ` +
    `The record confirms ${dup} in the customs house. ` +
    'Field crews began mapping the north shore on April 14. ' +
    'The first beacon was lit on July 1, 1889 after the tower was completed. ' +
    'A storm delayed the seawall, which was finished on November 30. ' +
    'The final report was signed on February 9, 1890 and mailed to the capital.\n';
  source.sha256 = sha256(source.text);
  const spec = makeHarborTimelineSpec();
  spec.sources[0]!.sha256 = source.sha256;
  Object.assign(spec.simulation.events[0]!, { year: 1889, month: 3, day: 3 });
  spec.simulation.events[0]!.evidence = [{ sourceId: source.id, quote: dup }];
  const report = validateSpec(spec, [source]);
  const approx = checkOf(report, 'timeline.approximate-date');
  assert.equal(approx.passed, false, 'mixed qualifier contexts fail closed');
  assert.match(approx.message, /DIFFERENT qualifier contexts/);
  // Direct unit-level confirmation: two occurrences, one qualified, one clean.
  const idx = buildSourceUnitIndex(source.text);
  const ctx = sourceQuoteApproximation(idx, dup);
  assert.ok(ctx !== null, 'the quote is locatable in the source');
  assert.equal(ctx!.occurrences, 2);
  assert.equal(ctx!.mixedContexts, true);
  assert.match(ctx!.marker, /around 1889/);
  // The exact date is otherwise grounded and the quote is verbatim, so approximate-date is the only
  // thing standing between this spec and publication.
  assert.deepEqual(failedIds(report), ['timeline.approximate-date'], report.checks.map(c => `${c.id}:${c.passed}`).join(' '));
});

test('S5B-02: hasApproximateDate still fires on quote-internal markers and stays silent on clean prose', () => {
  assert.equal(hasApproximateDate('dated circa 1895 in a later hand'), 'circa 1895');
  assert.equal(hasApproximateDate('the crew debated about taxation'), null);
  assert.equal(hasApproximateDate('The final report was signed on February 9, 1890 and mailed to the capital.'), null);
});

/* ================================================================== */
/* S5B-03 — affected-path authorization; no substring search of prose  */
/* ================================================================== */

test('S5B-03 message-quoted-id-unlocks-clean-event: a label quoting "s1" does NOT unlock clean s1 (reviewer probe)', () => {
  const { baseline, candidate, source, report } = guardProbe(
    spec => {
      spec.simulation.events[4]!.label = 'NASA says "s1"';
    },
    (spec, src) => {
      // Honest fix of s5's label ...
      spec.simulation.events[4]!.label = 'Final report signed';
      // ... plus a silent rewrite of the CLEAN event s1 into a different 1888 event.
      Object.assign(spec.simulation.events[0]!, {
        label: 'Earlier office',
        year: 1888,
        month: 1,
        day: 1,
        evidence: [{ sourceId: src.id, quote: 'An earlier office opened on January 1, 1888.' }],
      });
    },
  );
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution'], 'baseline fails only the label policy');
  // The finding's message reflects the quoted "s1", but its affected path points only at s5's label.
  const findings = repairFindings(report, baseline);
  const policy = findings.find(f => f.id === 'policy.no-publisher-attribution');
  assert.ok(policy !== undefined);
  assert.ok(policy.message.includes('"s1"'), 'the display message quotes s1 (untrusted prose)');
  assert.deepEqual(policy.affected, ['/simulation/events/4/label'], 'affected is validator-owned and names only s5');
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  assert.equal(guard.passed, false, 'rewriting the clean event s1 is weakening');
  assert.match(guard.message, /event "s1" changed/);
});

test('S5B-03 event-policy-date-rewrite: fixing an event label never unlocks its grounded date/evidence (reviewer probe)', () => {
  const { baseline, candidate, source, report } = guardProbe(
    spec => {
      spec.simulation.events[0]!.label = 'NASA office';
    },
    (spec, src) => {
      Object.assign(spec.simulation.events[0]!, {
        label: 'Earlier office',
        year: 1888,
        month: 1,
        day: 1,
        evidence: [{ sourceId: src.id, quote: 'An earlier office opened on January 1, 1888.' }],
      });
    },
  );
  assert.deepEqual(failedIds(report), ['policy.no-publisher-attribution']);
  const findings = repairFindings(report, baseline);
  assert.deepEqual(findings.find(f => f.id === 'policy.no-publisher-attribution')?.affected, ['/simulation/events/0/label']);
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  assert.equal(guard.passed, false);
  assert.match(guard.message, /event "s1" changed \(year 1889 -> 1888/);
});

test('S5B-03 positive: a label-only fix of the named event passes (no collateral change)', () => {
  const { baseline, source, report } = guardProbe(
    spec => {
      spec.simulation.events[0]!.label = 'NASA office';
    },
    () => {},
  );
  const candidate = structuredClone(baseline);
  candidate.simulation.events[0]!.label = 'Survey office opens'; // policy-clean, everything else identical
  const findings = repairFindings(report, baseline);
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  assert.equal(guard.passed, true, guard.message);
  assert.equal(validateSpec(candidate, [source]).publishable, true);
});

test('S5B-03 case-policy-pair-rewrite: renaming a case never unlocks its already-correct pair (reviewer probe)', () => {
  const { baseline, candidate, source, report } = guardProbe(
    spec => {
      spec.behavioralTests[0]!.name = 'NASA opening';
    },
    spec => {
      spec.behavioralTests[0] = { name: 'renamed-opening', earlierEventId: 's3', laterEventId: 's5' };
    },
  );
  assert.ok(failedIds(report).includes('policy.no-publisher-attribution'));
  const findings = repairFindings(report, baseline);
  assert.deepEqual(findings.find(f => f.id === 'policy.no-publisher-attribution')?.affected, ['/behavioralTests/0/name']);
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  assert.equal(guard.passed, false, 'the s1->s2 pair was correct on the baseline and stays frozen');
  assert.match(guard.message, /changed its pair/);
});

test('S5B-03 positive: renaming a policy-violating case name with its pair frozen passes', () => {
  const { baseline, source, report } = guardProbe(
    spec => {
      spec.behavioralTests[0]!.name = 'NASA opening';
    },
    () => {},
  );
  const candidate = structuredClone(baseline);
  candidate.behavioralTests[0]!.name = 'opening-before-mapping-clean'; // pair s1->s2 untouched
  const findings = repairFindings(report, baseline);
  const guard = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  assert.equal(guard.passed, true, guard.message);
});

test('S5B-03: repeating a rejected candidate against the baseline never changes its obligations', () => {
  const { baseline, candidate, source, report } = guardProbe(
    spec => {
      spec.simulation.events[0]!.label = 'NASA office';
    },
    (spec, src) => {
      Object.assign(spec.simulation.events[0]!, {
        label: 'Earlier office',
        year: 1888,
        month: 1,
        day: 1,
        evidence: [{ sourceId: src.id, quote: 'An earlier office opened on January 1, 1888.' }],
      });
    },
  );
  const findings = repairFindings(report, baseline);
  const first = compareRevisions(baseline, candidate, failedIds(report), { sources: [source], findings });
  // Repeat the SAME rejected candidate twice more against the immutable baseline.
  const second = compareRevisions(baseline, structuredClone(candidate), failedIds(report), { sources: [source], findings });
  const third = compareRevisions(baseline, structuredClone(candidate), failedIds(report), { sources: [source], findings });
  assert.equal(first.passed, false);
  assert.equal(second.passed, false);
  assert.equal(third.passed, false);
  assert.equal(first.message, second.message, 'obligations are identical on repetition');
  assert.equal(second.message, third.message);
});

test('S5B-03 affected conventions: date-grounded, case-order and policy checks emit exact field paths', () => {
  // date-grounded -> the offending event's date+evidence fields.
  const decl = declarationSpecAndSource();
  decl.spec.simulation.events[5]!.year = 1777;
  const declReport = validateSpec(decl.spec, [decl.source]);
  const grounded = checkOf(declReport, 'timeline.date-grounded');
  assert.deepEqual(grounded.affected, [
    '/simulation/events/5/year',
    '/simulation/events/5/month',
    '/simulation/events/5/day',
    '/simulation/events/5/evidence',
  ]);
  // case-order -> the offending pair's two fields.
  const treaty = makeTreatyTimelineSpec();
  treaty.behavioralTests[2]!.earlierEventId = 'b5';
  treaty.behavioralTests[2]!.laterEventId = 'b4';
  const order = checkOf(validateSpec(treaty, [treatySourceDoc()]), 'timeline.case-order');
  assert.deepEqual(order.affected, ['/behavioralTests/2/earlierEventId', '/behavioralTests/2/laterEventId']);
  // policy (event label) -> exactly that label field.
  const decl2 = declarationSpecAndSource();
  decl2.spec.simulation.events[0]!.label = 'According to NASA, a committee was appointed';
  const policy = checkOf(validateSpec(decl2.spec, [decl2.source]), 'policy.no-publisher-attribution');
  assert.deepEqual(policy.affected, ['/simulation/events/0/label']);
});

test('S5B-03: a date-class finding DOES unlock re-grounding the named failing event (positive control)', () => {
  const decl = declarationSpecAndSource();
  decl.spec.simulation.events[5]!.year = 1777; // fails timeline.date-grounded only
  const report = validateSpec(decl.spec, [decl.source]);
  assert.deepEqual(failedIds(report), ['timeline.date-grounded']);
  const findings = repairFindings(report, decl.spec);
  const next = structuredClone(decl.spec);
  next.simulation.events[5]!.year = 1776; // honest re-ground
  assert.equal(compareRevisions(decl.spec, next, failedIds(report), { sources: [decl.source], findings }).passed, true);
});

/* ================================================================== */
/* S5B-04 (validation side) — per-field analysis findings              */
/* ================================================================== */

const recordedAnalysis = (): SourceAnalysis =>
  JSON.parse(readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8')) as SourceAnalysis;
const grcSource = (): SourceDocument => loadSource('nasa-grc-equations-of-motion');

test('S5B-04 analysis-id-unlocks-entire-concepts: only the bad concept id is affected (reviewer probe, validation side)', () => {
  const base = recordedAnalysis();
  base.concepts[0]!.id = 'x'.repeat(41); // over-long id on concept 0 only
  const report = validateAnalysis(base, [grcSource()]);
  assert.deepEqual(failedIds(report), ['analysis.concept-ids']);
  const ids = checkOf(report, 'analysis.concept-ids');
  assert.deepEqual(ids.affected, ['/concepts/0/id'], 'only the offending id, not the whole concepts array');
  assert.deepEqual(affectedPathsOf(report), ['/concepts/0/id']);
});

test('S5B-04 multiple-policy-groups: EVERY violating field is affected, not just the first (reviewer probe)', () => {
  const base = recordedAnalysis();
  base.concepts[0]!.name = 'NASA concept';
  base.objectives[0] = 'According to NASA, learn acceleration.';
  const source = grcSource();
  const report = validateAnalysis(base, [source]);
  assert.ok(failedIds(report).includes('policy.no-publisher-attribution'));
  const policy = checkOf(report, 'policy.no-publisher-attribution');
  assert.deepEqual(policy.affected, ['/concepts/0/name', '/objectives/0'], 'both groups are named, so a legitimate multi-field fix is authorizable');
  // affectedByCheckIdOf exposes them keyed by check id for the Wave B guard.
  assert.deepEqual(affectedByCheckIdOf(report).get('policy.no-publisher-attribution'), ['/concepts/0/name', '/objectives/0']);
});

test('S5B-04 empty-concepts-decline-escape: an empty concepts list affects /concepts, NOT the decision (reviewer probe)', () => {
  const base = recordedAnalysis();
  const empty = { ...base, concepts: [], objectives: [] } as unknown as SourceAnalysis;
  const report = validateAnalysis(empty, [grcSource()]);
  assert.ok(failedIds(report).includes('analysis.invariants'));
  const inv = checkOf(report, 'analysis.invariants');
  assert.deepEqual(inv.affected, ['/concepts', '/objectives'], 'the lists are affected, never /supported or /activity');
  assert.ok(!(inv.affected ?? []).includes('/supported'));
  assert.ok(!(inv.affected ?? []).includes('/activity'));
});

test('S5B-04 invariants: a decision inconsistency DOES affect /supported and /activity', () => {
  const base = recordedAnalysis();
  const bad = { ...base, supported: false, activity: 'forces-1d-v1', unsupportedReason: 'Nope.' } as unknown as SourceAnalysis;
  const inv = checkOf(validateAnalysis(bad, [grcSource()]), 'analysis.invariants');
  assert.equal(inv.passed, false);
  assert.ok((inv.affected ?? []).includes('/supported') && (inv.affected ?? []).includes('/activity'));
});

test('S5B-04 grounding.quotes: each bad concept quote gets its own affected path', () => {
  const base = recordedAnalysis();
  base.concepts[1]!.evidence[0]!.quote = 'a paraphrase that is not verbatim in the source at all';
  const report = validateAnalysis(base, [grcSource()]);
  const quotes = checkOf(report, 'grounding.quotes');
  assert.equal(quotes.passed, false);
  assert.deepEqual(quotes.affected, ['/concepts/1/evidence/0/quote']);
});

test('S5B-04 affectedPathsOf/affectedByCheckIdOf are pure and skip passing checks', () => {
  const clean = validateAnalysis(recordedAnalysis(), [grcSource()]);
  assert.equal(clean.publishable, true);
  assert.deepEqual(affectedPathsOf(clean), []);
  assert.equal(affectedByCheckIdOf(clean).size, 0);
  // Junk never throws.
  assert.deepEqual(affectedPathsOf(null as unknown as ValidationReport), []);
  assert.deepEqual(affectedPathsOf({ checks: 'nope' } as unknown as ValidationReport), []);
});

/* ================================================================== */
/* Cross-cutting: the integrated fixtures still publish                */
/* ================================================================== */

test('the real Declaration, harbor and treaty fixtures still publish with every timeline check passing', () => {
  const decl = declarationSpecAndSource();
  assert.equal(validateSpec(decl.spec, [decl.source]).publishable, true, 'Declaration');
  assert.equal(validateSpec(makeHarborTimelineSpec(), [harborSourceDoc()]).publishable, true, 'harbor');
  assert.equal(validateSpec(makeTreatyTimelineSpec(), [treatySourceDoc()]).publishable, true, 'treaty');
});

test('formatTimelineDate is unchanged for the affected-path messages', () => {
  assert.equal(formatTimelineDate(D(1889, 3, 3)), '1889-03-03');
  assert.equal(formatTimelineDate(D(-300)), '300 BCE');
});
