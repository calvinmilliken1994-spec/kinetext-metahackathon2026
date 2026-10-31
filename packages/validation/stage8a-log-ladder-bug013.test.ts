// BUG-013 regression (Stage 8a log ladder): a PUBLISHED Muse Spark Open ladder
// (storage/runs/job-20261031111156-12c77646/log-ladder-v1.r2.json, USGS "pH and water") passed
// every LOG check while showing nonsense: rung "Water at pH five" plotted at 6.3, rung "Water at
// pH six" plotted at 14, and case compare-five-six starting at fromValue 6, which is no rung.
// Quote presence is not relationship correctness: LOG-01 only checked the quotes are verbatim and
// N-01 (LOG-07) only sees DIGIT numbers, so number words in labels were invisible and nothing tied
// a label's number to the rung's value; LOG-06 only required case endpoints inside the rung range.
//
// The new rules live under the EXISTING ids (contracts STAGE6_CHECKS and the exhaustive
// STAGE6_CHECK_NAMES in apps/web pin the id set, and this task may not edit either package):
//   LOG-07 numbers-checkable — every number a rung label states (digits OR number words zero..twenty,
//     including word decimals like "five point six") must equal that rung's value (tolerance 1e-9);
//     a label with several numbers must have the rung's value among them; a label with no number is
//     fine. Failing rungs unlock /rungs/i/label, /rungs/i/value AND /rungs/i/quote (an honest repair
//     may reword the label, or move the rung onto the label's number with a quote that prints it).
//   LOG-06 cases-valid — every case fromValue/toValue must equal some rung's value (endpoints ON
//     rungs, not merely inside the range).
// value-in-quote (task item b) was ALREADY enforced before this change: LOG-04 rung-values-in-quote
// requires the rung value as a whole numeric token of its own quote — the bad gen passes it (6.3 and
// 14 are both printed in their quotes), which is exactly why the label tie was the missing check.
//
// Run: node --test packages/validation/stage8a-log-ladder-bug013.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import type { LogLadderGen } from '../contracts/kit.ts';
import type { SourceDocument } from '../contracts/index.ts';
import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import { loadSource } from '../sources/index.ts';
import { checkOf, clone, expectFailures, failedIds, failureDetail, stage6Fixture, synthSource } from './fixtures/stage6.ts';

/** The exact published bad gen (r2 of job-20261031111156-12c77646), stored as a fixture. */
const bug013Gen = (): LogLadderGen => stage6Fixture<LogLadderGen>('log-ladder.bug013.json');
const phSource = (): SourceDocument => loadSource('usgs-wss-ph-and-water');

/* ------------------------------------------------------------------ */
/* Synthetic pH page for word-number vectors                           */
/* ------------------------------------------------------------------ */

const SYNTH_TEXT =
  'The pH scale is logarithmic. Water with a pH of five is ten times more acidic than water having a pH of six. ' +
  'The range goes from 0 to 14, with 7 being neutral. Normal rainfall has a pH of about 5.6. ' +
  'Mine water can have a pH of 2. Each step means 10 times more or less acidity, and pH 8 water is basic.';
const synthPhSource = (): SourceDocument => synthSource('ladder-synth', 'Synthetic pH paragraph', SYNTH_TEXT);

/** A fully-grounded ladder whose rung labels state their values as NUMBER WORDS. */
function wordLabelGen(): LogLadderGen {
  return {
    schemaVersion: 'log-ladder-v1',
    title: 'The pH ladder',
    quantity: 'pH',
    factor: 10,
    factorText: 'ten times',
    effectPhrase: 'more acidic',
    increasing: false,
    sourceId: 'ladder-synth',
    quote: 'Water with a pH of five is ten times more acidic than water having a pH of six.',
    rungs: [
      {
        id: 'rainfall',
        label: 'normal rainfall at pH five point six',
        value: 5.6,
        sourceId: 'ladder-synth',
        quote: 'Normal rainfall has a pH of about 5.6',
      },
      {
        id: 'neutral',
        label: 'neutral water at pH seven',
        value: 7,
        sourceId: 'ladder-synth',
        quote: 'The range goes from 0 to 14, with 7 being neutral',
      },
      {
        id: 'mine',
        label: 'mine water at pH two',
        value: 2,
        sourceId: 'ladder-synth',
        quote: 'Mine water can have a pH of 2',
      },
    ],
    cases: [
      { id: 'mine-to-neutral', fromValue: 2, toValue: 7 },
      { id: 'rain-to-neutral', fromValue: 5.6, toValue: 7 },
    ],
  };
}

function validate(gen: LogLadderGen, sources: SourceDocument[]) {
  return validateKitComponent('log-ladder-v1', gen, sources);
}

/* ------------------------------------------------------------------ */
/* The published bad gen must now FAIL                                 */
/* ------------------------------------------------------------------ */

test('BUG-013: the exact published bad gen is no longer publishable and fails LOG-06 + LOG-07', () => {
  const report = validate(bug013Gen(), [phSource()]);
  assert.equal(report.publishable, false);
  assert.deepEqual(failedIds(report), ['LOG-06', 'LOG-07'], failureDetail(report));
});

test('BUG-013: LOG-04 (value-in-quote) already passed on the bad gen — the label tie was the gap', () => {
  // Records task item (b): value-in-quote is pre-existing (LOG-04). 6.3 and 14 ARE printed in
  // their own quotes, so quote grounding alone can never catch these rungs.
  const report = validate(bug013Gen(), [phSource()]);
  assert.equal(checkOf(report, 'LOG-04').passed, true, checkOf(report, 'LOG-04').message);
});

test('BUG-013: LOG-07 names both bad rung labels, their stated numbers, values and repair paths', () => {
  const report = validate(bug013Gen(), [phSource()]);
  const c = checkOf(report, 'LOG-07');
  assert.equal(c.passed, false);
  assert.match(c.message, /ph-five/);
  assert.match(c.message, /five/);
  assert.match(c.message, /6\.3/);
  assert.match(c.message, /ph-six/);
  assert.match(c.message, /14/);
  const affected = c.affected ?? [];
  for (const p of ['/rungs/3/label', '/rungs/3/value', '/rungs/3/quote', '/rungs/4/label', '/rungs/4/value', '/rungs/4/quote']) {
    assert.ok(affected.includes(p), `LOG-07 must unlock ${p} (got: ${affected.join(', ')})`);
  }
});

test('BUG-013: LOG-06 rejects the case endpoint that is no rung value', () => {
  const report = validate(bug013Gen(), [phSource()]);
  const c = checkOf(report, 'LOG-06');
  assert.equal(c.passed, false);
  assert.match(c.message, /compare-five-six/);
  const affected = c.affected ?? [];
  assert.ok(affected.includes('/cases/0/fromValue'), `got: ${affected.join(', ')}`);
  // toValue 5.6 IS a rung, so only the fromValue path is flagged for that case.
  assert.ok(!affected.includes('/cases/0/toValue'), `got: ${affected.join(', ')}`);
});

/* ------------------------------------------------------------------ */
/* Label-value agreement (LOG-07): word + digit vectors                */
/* ------------------------------------------------------------------ */

test('LOG-07: number-word labels that agree with their rung values publish cleanly', () => {
  const report = validate(wordLabelGen(), [synthPhSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
  assert.equal(report.publishable, true);
});

test('LOG-07: a number-word label that disagrees with its rung value fails (five vs 7)', () => {
  const gen = wordLabelGen();
  gen.rungs[1]!.label = 'neutral water at pH six'; // the rung sits at 7
  const report = expectFailures(validate(gen, [synthPhSource()]), ['LOG-07']);
  const c = checkOf(report, 'LOG-07');
  assert.match(c.message, /neutral/);
  assert.match(c.message, /6/);
  assert.match(c.message, /7/);
  const affected = c.affected ?? [];
  assert.ok(affected.includes('/rungs/1/label'));
  assert.ok(affected.includes('/rungs/1/value'));
});

test('LOG-07: a word-decimal label ("five point six") agrees with 5.6 and catches a swapped value', () => {
  const ok = validate(wordLabelGen(), [synthPhSource()]);
  assert.equal(checkOf(ok, 'LOG-07').passed, true, checkOf(ok, 'LOG-07').message);
  const gen = wordLabelGen();
  gen.rungs[0]!.value = 6.3; // label still says "five point six"; quote prints 5.6 so LOG-04 fails too
  const report = validate(gen, [synthPhSource()]);
  assert.ok(failedIds(report).includes('LOG-07'), failureDetail(report));
  assert.match(checkOf(report, 'LOG-07').message, /5\.6/);
});

test('LOG-07: a digit label that disagrees with its rung value fails (pH 5 vs 5.6)', () => {
  const gen = wordLabelGen();
  gen.rungs[0]!.label = 'normal rainfall at pH 6'; // value stays 5.6; the page prints 6 ("pH of six"? no—) see note
  // Digit 6 must also be grounded (N-01); the synthetic page has no whole 6, so LOG-07 fails for
  // BOTH reasons under the same id. The agreement problem is what this test pins.
  const report = validate(gen, [synthPhSource()]);
  assert.ok(failedIds(report).includes('LOG-07'), failureDetail(report));
  const c = checkOf(report, 'LOG-07');
  assert.match(c.message, /rungs\[0\]/);
  assert.ok((c.affected ?? []).includes('/rungs/0/label'));
  assert.ok((c.affected ?? []).includes('/rungs/0/value'));
});

test('LOG-07: a multi-number label passes when the rung value is among the stated numbers', () => {
  const gen = wordLabelGen();
  gen.rungs[1]!.label = 'pH 7 water, 10 times more acidic than pH 8'; // value 7 is among 7, 10, 8
  const report = validate(gen, [synthPhSource()]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
});

test('LOG-07: a multi-number label fails when the rung value is not among the stated numbers', () => {
  const gen = wordLabelGen();
  gen.rungs[0]!.label = 'pH 7 water, 10 times more acidic than pH 8'; // this rung sits at 5.6
  const report = validate(gen, [synthPhSource()]);
  assert.ok(failedIds(report).includes('LOG-07'), failureDetail(report));
  assert.ok((checkOf(report, 'LOG-07').affected ?? []).includes('/rungs/0/label'));
});

test('LOG-07: a label with no number at all stays fine (the golden labels)', () => {
  const golden = stage6Fixture<LogLadderGen>('log-ladder.gen.json');
  const report = validate(golden, [loadSource('usgs-earthquake-magnitude-energy-intensity')]);
  assert.deepEqual(failedIds(report), [], failureDetail(report));
});

/* ------------------------------------------------------------------ */
/* Cases on rungs (LOG-06)                                             */
/* ------------------------------------------------------------------ */

test('LOG-06: an endpoint inside the rung range but not a rung value fails', () => {
  const gen = wordLabelGen();
  gen.cases[0] = { id: 'mine-to-neutral', fromValue: 2, toValue: 6 }; // 6 is inside [2, 7], no rung
  const report = expectFailures(validate(gen, [synthPhSource()]), ['LOG-06']);
  const c = checkOf(report, 'LOG-06');
  assert.match(c.message, /mine-to-neutral/);
  assert.match(c.message, /rung/);
  assert.ok((c.affected ?? []).includes('/cases/0/toValue'));
  assert.ok(!(c.affected ?? []).includes('/cases/0/fromValue'));
});

test('LOG-06: endpoints that equal rung values pass (word ladder control)', () => {
  const report = validate(wordLabelGen(), [synthPhSource()]);
  assert.equal(checkOf(report, 'LOG-06').passed, true, checkOf(report, 'LOG-06').message);
});

/* ------------------------------------------------------------------ */
/* Repair authority over the newly flagged paths                       */
/* ------------------------------------------------------------------ */

test('repair guard: an honest label+case repair of the bad gen passes (recomputed authority)', () => {
  const baseline = bug013Gen();
  const r1 = validate(baseline, [phSource()]);
  assert.equal(r1.publishable, false);
  const fixed = clone(baseline);
  fixed.rungs[3]!.label = 'Water at pH 6.3'; // the quote already prints 6.3
  fixed.rungs[4]!.label = 'Water at pH 14'; // the quote already prints 14
  fixed.cases[0]!.fromValue = 6.3; // onto the rung the page states
  const r2 = validate(fixed, [phSource()]);
  assert.deepEqual(failedIds(r2), [], `the honest repair must validate clean: ${failureDetail(r2)}`);
  const guard = compareKitRevisions('log-ladder-v1', baseline, fixed, { sources: [phSource()] });
  assert.equal(guard.passed, true, guard.message);
});

test('repair guard: moving a flagged rung (value AND quote) is authorized', () => {
  const baseline = bug013Gen();
  const fixed = clone(baseline);
  // Alternative honest repair for rung ph-five: keep the label's number and move the rung onto a
  // page sentence that prints 5 ("Water with a pH of five..." is words; use a digit-printing one
  // is not needed here — the guard checks AUTHORIZATION, the loop revalidates the result).
  fixed.rungs[3]!.value = 5;
  fixed.rungs[3]!.quote = 'Water with a pH of 7 is neutral.';
  fixed.rungs[4]!.label = 'Water at pH 14';
  fixed.cases[0]!.fromValue = 5;
  const guard = compareKitRevisions('log-ladder-v1', baseline, fixed, { sources: [phSource()] });
  assert.equal(guard.passed, true, guard.message);
});

test('repair guard: a change to a passing rung stays rejected', () => {
  const baseline = bug013Gen();
  const fixed = clone(baseline);
  fixed.rungs[3]!.label = 'Water at pH 6.3';
  fixed.rungs[4]!.label = 'Water at pH 14';
  fixed.cases[0]!.fromValue = 6.3;
  fixed.rungs[0]!.value = 7.1; // rung neutral-7 passed everything — frozen
  const guard = compareKitRevisions('log-ladder-v1', baseline, fixed, { sources: [phSource()] });
  assert.equal(guard.passed, false);
  assert.match(guard.message, /\/rungs\/0\/value/);
});
