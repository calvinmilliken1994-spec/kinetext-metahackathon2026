// Stage 5b review round 4 — S5B-22, S5B-23, S5B-24 (docs/reviews/stage-5b-review.md, '## Re-review
// (round 4)'). Rows are the reviewer's own, from cache/scratch/review-5b/round4-adversarial.mjs,
// run at VALIDATOR level (validateSpec on the harbor fixture, sentence swapped into event 0).
//   S5B-22 the negated-'until' exception is gone: 'until' is always a temporal bound.
//   S5B-23 every numeric part of a date is a WHOLE token: no letter, digit or apostrophe attached
//          on either side (an ordinal day suffix st|nd|rd|th followed by a non-alphanumeric is the
//          only exception, and an attached era suffix such as '500BCE'). A poisoned token grounds
//          nothing, never lends a title year, and no interior numeric prefix is retried.
//   S5B-24 a prefix era and a suffix era on ONE year/endpoint that disagree ('AD 500 BCE',
//          'BCE 500 AD') make the whole expression ungroundable; mixed eras on DIFFERENT range
//          endpoints ('500 BC–400 AD') stay supported.
// S5B-21 (context-window phrasing) is an accepted known limit and is deliberately not tested here.
import test from 'node:test';
import assert from 'node:assert/strict';

import { validateSpec } from './validate.ts';
import { parseDateExpressions, quoteGroundsDate, titleYearOf } from './timeline.ts';
import { harborSourceDoc, makeHarborTimelineSpec } from './fixtures/timeline-specs.ts';
import { sha256 } from '../sources/index.ts';
import type { ValidationReport } from '../contracts/index.ts';

const D = (year: number, month = 0, day = 0) => ({ year, month, day });
const d: [number, number, number] = [1889, 3, 3];
const failedIds = (r: ValidationReport): string[] => r.checks.filter(c => !c.passed).map(c => c.id);

interface Opts {
  title?: string;
  quote?: string;
}

function row(name: string, sentence: string, tuple: [number, number, number], expected: boolean, opts: Opts = {}): void {
  const source = harborSourceDoc();
  const spec = makeHarborTimelineSpec();
  source.text = source.text.replace('The survey office opened on March 3, 1889 in the old customs house.', sentence);
  if (opts.title !== undefined) {
    source.title = opts.title;
    source.text = source.text.replace('# The Harbor Survey (1889)', `# ${opts.title}`);
  }
  source.sha256 = sha256(source.text);
  spec.sources[0]!.sha256 = source.sha256;
  Object.assign(spec.simulation.events[0]!, { year: tuple[0], month: tuple[1], day: tuple[2] });
  spec.simulation.events[0]!.evidence = [{ sourceId: source.id, quote: opts.quote ?? sentence }];
  const report = validateSpec(spec, [source]);
  assert.equal(
    report.publishable,
    expected,
    `${name}: expected publishable=${expected}, got ${report.publishable} (failures: ${failedIds(report).join(', ')})`,
  );
  if (!expected) {
    assert.ok(
      failedIds(report).includes('timeline.date-grounded'),
      `${name}: must fail timeline.date-grounded, got [${failedIds(report).join(', ')}]`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* S5B-22 — 'until' is always a bound                                  */
/* ------------------------------------------------------------------ */

test('S5B-22: no "until" exception — negated, misplaced-negation and double-negative rows all fail to ground', () => {
  for (const [name, text] of [
    ['until-control', 'The office was not opened until March 3, 1889.'],
    ['until-about', 'The office was not opened until about March 3, 1889.'],
    ['until-not', 'The office stayed open until not March 3, 1889 but March 4, 1889.'],
    ['double-not', 'The office was not not opened until March 3, 1889.'],
    ['not-never', 'The office was not never opened until March 3, 1889.'],
    ['not-only', 'The office was not only open until March 3, 1889.'],
    ['parenthetical-not', 'The office (not the museum) operated until March 3, 1889.'],
    ['comma-not', 'The office was not opened, until March 3, 1889.'],
    ['parenthetical-aside', 'The office was not opened (despite protests) until March 3, 1889.'],
    ['uncertain-not', 'The office was probably not opened until March 3, 1889.'],
    ['until-lower-bound', 'The office was not opened until March 3, 1889 at the earliest.'],
    ['until-no-occurrence', 'The office could not open until March 3, 1889, and in fact opened in 1890.'],
    ['until-positive', 'The office remained open until March 3, 1889.'],
    ['until-not-far', 'The office was not opened for any public business until March 3, 1889.'],
  ] as const) {
    row(name, text, d, false);
  }
  row('until-trim-quote', 'The office (not the museum) operated until March 3, 1889.', d, false, {
    quote: 'operated until March 3, 1889.',
  });
  row('until-valid-trim', 'The office was not opened until March 3, 1889.', d, false, { quote: 'opened until March 3, 1889.' });
  // Contractions and 'never' (the former exception's own examples) are bounds again.
  row('wasnt-until', "The treaty wasn't signed until March 3, 1889.", d, false);
  row('never-until', 'The office never opened its doors until 1902.', [1902, 0, 0], false);
  row('lee-resolution', 'The plan for making treaties was not approved until September of 1776.', [1776, 9, 0], false);
  // 'till' is a bound too.
  row('till', 'The office was not opened till March 3, 1889.', d, false);
  // Positive control: the same date without any bound grounds.
  row('ordinary', 'The office opened March 3, 1889.', d, true);
});

/* ------------------------------------------------------------------ */
/* S5B-23 — whole numeric tokens                                       */
/* ------------------------------------------------------------------ */

test('S5B-23: a poisoned numeric token grounds nothing (year, day, mdy, fragments, apostrophes)', () => {
  row('year-ish', 'The office opened in 1888ish.', [1888, 0, 0], false);
  row('day-ish', 'The office opened on March 3ish.', d, false);
  row('year-word-suffix', 'The office record was 1889xyz.', [1889, 0, 0], false);
  row('year-word-prefix', 'The office record was xyz1889.', [1889, 0, 0], false);
  row('year-ordinal-fragment', 'The office record was 18thousand.', [18, 0, 0], false);
  row('mdy-word-suffix', 'The office record was March 3, 1889xyz.', d, false);
  row('day-word-suffix', 'The office record was March 3xyz.', d, false);
  row('apostrophe-curly', 'The office opened in 1889\u2019.', [1889, 0, 0], false);
  row('apostrophe-straight', "The office opened in '76.", [76, 0, 0], false);
  row('decade', 'The office opened in the 1770s.', [1770, 0, 0], false);
  row('year-ish-d1', 'The office opened in 1888ish.', [188, 0, 0], false);
  row('year-ish-d2', 'The office opened in 1888ish.', [18, 0, 0], false);
  row('range-endpoint-ish-2', 'The office was active in 1775\u20131783ish.', [1775, 0, 0], false);
  row('dmy-day-ish', 'The office opened on 3ish March 1889.', d, false);
  row('dmy-year-ish', 'The office opened on 3 March 1889ish.', d, false);
  // A poisoned token in a month expression must not combine with the title year either.
  row('md-then-poisoned-year', 'The office opened on March 3, 1888ish.', d, false);
});

test('S5B-23: a poisoned title year lends nothing', () => {
  row('title-word-suffix', 'The office opened March 3.', d, false, { title: 'The Harbor Survey (1889xyz)' });
  row('title-ish', 'The office opened March 3.', d, false, { title: 'The Harbor Survey (1889ish)' });
  row('title-two-years-one-poisoned', 'The office opened March 3.', d, false, { title: 'The Harbor Survey 1889 (1889xyz)' });
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889xyz)' }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889ish)' }), null);
  assert.equal(titleYearOf({ title: "The Harbor Survey ('1889)" }), null);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (1889)' }), 1889);
  // Control: a non-year numeric word in the title does not poison a clean year.
  assert.equal(titleYearOf({ title: 'H1N1 Survey (1889)' }), 1889);
});

test('S5B-23: no interior numeric prefix is retried and poisoned tokens expose no expression', () => {
  const years = (s: string) => parseDateExpressions(s).filter(e => e.year !== null).map(e => e.year);
  assert.deepEqual(years('It opened in 1888ish.'), []);
  assert.deepEqual(years('It opened in 18thousand.'), []);
  assert.deepEqual(years('It opened in 1889xyz.'), []);
  assert.deepEqual(years("It opened in '76."), []);
  assert.deepEqual(years('It opened in the 1770s.'), []);
  const days = (s: string) => parseDateExpressions(s).filter(e => e.day !== null).map(e => e.day);
  assert.deepEqual(days('It opened on March 3ish.'), []);
  assert.deepEqual(days('It opened on March 3xyz, 1889.'), []);
});

test('S5B-23 positive controls keep grounding', () => {
  row('ordinal-3rd', 'The office opened on March 3rd, 1889.', d, true);
  row('the-3rd-of', 'The office opened the 3rd of March 1889.', d, true);
  row('day-first', 'The office opened 3 March 1889.', d, true);
  row('july-4th', 'The office opened on July 4th, 1776.', [1776, 7, 4], true);
  row('the-4th-of-july', 'The office opened the 4th of July 1776.', [1776, 7, 4], true);
  row('sept-4th', 'The office opened on Sept. 4th, 1776.', [1776, 9, 4], true);
  row('dec-25', 'The office opened on Dec. 25, 1776.', [1776, 12, 25], true);
  row('300-bc', 'The office was founded in 300 B.C.', [-300, 0, 0], true);
  row('500-400-bce', 'The office operated in 500\u2013400 BCE.', [-500, 0, 0], true);
  row('500-400-bce-b', 'The office operated in 500\u2013400 BCE.', [-400, 0, 0], true);
  row('1775-1783', 'The war lasted 1775\u20131783.', [1775, 0, 0], true);
  row('attached-era', 'The office was founded in 500BCE.', [-500, 0, 0], true);
  row('headcount', 'About 40 delegates saw the office open on March 3, 1889.', d, true);
  row('month-day-title-year', 'The office opened on March 3.', d, true);
  assert.equal(quoteGroundsDate('The office opened on July 4th, 1776.', D(1776, 7, 4), null), true);
  assert.equal(quoteGroundsDate('The office opened on the 3rd of March, 1889.', D(1889, 3, 3), null), true);
  assert.equal(quoteGroundsDate('It was built in 300 B.C. by traders.', D(-300), null), true);
  assert.equal(quoteGroundsDate('The war lasted 1775\u20131783.', D(1783), null), true);
});

/* ------------------------------------------------------------------ */
/* S5B-24 — era agreement                                              */
/* ------------------------------------------------------------------ */

test('S5B-24: a prefix and suffix era that disagree make the whole expression ungroundable', () => {
  row('era-conflict', 'The office operated in AD 500 BCE.', [-500, 0, 0], false);
  row('era-conflict-pos', 'The office operated in AD 500 BCE.', [500, 0, 0], false);
  row('era-conflict-positive', 'The office operated in BCE 500 AD.', [500, 0, 0], false);
  row('era-conflict-negative', 'The office operated in BCE 500 AD.', [-500, 0, 0], false);
  row('era-conflict-dotted', 'The office operated in A.D. 500 B.C.E.', [-500, 0, 0], false);
  row('era-conflict-dotted-pos', 'The office operated in B.C. 500 C.E.', [500, 0, 0], false);
  // Range endpoints: a conflicting prefix+suffix on ONE endpoint kills the whole expression.
  row('range-conflict-a', 'The office operated in AD 500 BCE\u2013400 BCE.', [-400, 0, 0], false);
  row('range-conflict-a2', 'The office operated in AD 500 BCE\u2013400 BCE.', [-500, 0, 0], false);
  row('range-conflict-b', 'The office operated in 500 BC\u2013AD 400 BC.', [-500, 0, 0], false);
  row('range-conflict-b2', 'The office operated in 500 BC\u2013AD 400 BC.', [400, 0, 0], false);
  const exprs = parseDateExpressions('The office operated in AD 500 BCE.');
  assert.deepEqual(exprs.filter(e => e.year !== null && e.contextRejected === null), []);
  assert.equal(titleYearOf({ title: 'The Harbor Survey (AD 1889 BCE)' }), null);
});

test('S5B-24 controls: agreeing eras, single eras and mixed eras on DIFFERENT range endpoints stay supported', () => {
  row('era-prefix', 'The office operated in A.D. 79.', [79, 0, 0], true);
  row('era-dot', 'The office operated in 500 B.C.E.', [-500, 0, 0], true);
  row('short-bce', 'The office operated in 50\u201340 BCE.', [-50, 0, 0], true);
  row('bce-prefix', 'The office operated in BCE 500.', [-500, 0, 0], true);
  row('mixed-range-a', 'The office operated in 500 BC\u2013400 AD.', [-500, 0, 0], true);
  row('mixed-range-b', 'The office operated in 500 BC\u2013400 AD.', [400, 0, 0], true);
  row('agreeing-both', 'The office operated in AD 500 CE.', [500, 0, 0], true);
});
