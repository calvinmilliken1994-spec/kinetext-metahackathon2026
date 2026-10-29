// S6R-A3 regression tests — Stage 6 round-2 review findings S6R-05 (remaining), S6R-09
// (remaining) and the new S6R-13.
//
// S6R-05 (`balance-omitted-product`): a reaction is tied to the source by the MAXIMAL reaction
// span around the arrow, not by the generated substring. The source's own (formula, side) multiset
// must equal the generated one, and an edge that continues past whitespace into an operator or a
// printed species fails closed. `H2 + O2 -> H2O` against `H2 + O2 -> H2O + H2O2` must therefore fail
// even though every chemical-token boundary is clean. The exact integer solver is untouched.
//
// S6R-09 (`quiz-number-elsewhere-in-own-quote`): the whole-number identity is evaluated AT the
// answer occurrence that matched, so an unrelated whole `2` elsewhere in the same quote cannot
// rescue `a value of 2` inside `a value of 20`.
//
// S6R-13 (`quiz-equivalent-numeric-distractor`): two options that spell the same value (`5` and
// `5.00`) are the same answer, and index-only grading would mark one of them wrong, so the card
// must not publish.
//
// Run: node --test packages/validation/stage6-review-s6r-r3.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBalanceSolution, validateKitComponent } from './kit/index.ts';
import {
  checkOf, clone, chemistrySource, dragSource, failedIds, quizGen, synthSource,
} from './fixtures/stage6.ts';
import { loadSource } from '../sources/index.ts';
import {
  contentOccursWhole, maximalReactionSpan, numericOptionValue, signedNumericTokens,
} from './kit/shared.ts';
import type { BalanceEquationGen, QuizCardsGen } from '../contracts/kit.ts';

const bal = (gen: BalanceEquationGen, sources: ReturnType<typeof chemistrySource>[]) =>
  validateKitComponent('balance-equation-v1', gen, sources);

/* ------------------------------------------------------------------ */
/* S6R-05 — the maximal printed reaction, not the generated substring  */
/* ------------------------------------------------------------------ */

/** A water-forming activity against whatever the page prints. */
function waterGen(pageText: string, equationText = 'H2 + O2 -> H2O'): BalanceEquationGen {
  return {
    schemaVersion: 'balance-equation-v1',
    title: 'A reaction from the page',
    equationText,
    sourceId: 'chem-reaction',
    quote: pageText,
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-reaction', quote: pageText },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-reaction', quote: pageText },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-reaction', quote: pageText },
    ],
    hint: '',
  };
}

test('S6R-05 balance-omitted-product: a whole trailing product left off the equation fails', () => {
  // Reviewer vector, verbatim: the page prints hydrogen peroxide as a second product.
  const page = 'The page prints H2 + O2 -> H2O + H2O2.';
  const gen = waterGen(page);
  const report = bal(gen, [chemistrySource('chem-reaction', page)]);
  assert.equal(report.publishable, false, 'the equation must not publish when a printed product is missing');
  const bal01 = checkOf(report, 'BAL-01');
  assert.equal(bal01.passed, false, 'BAL-01 must own the source-reaction identity');
  assert.match(bal01.message, /H2O2/, bal01.message);
  assert.match(bal01.message, /H2 \+ O2 -> H2O \+ H2O2/, 'the message must quote the printed reaction');
  // BAL-02 compares the gen species split with the same source span, so it must not pass either.
  assert.equal(checkOf(report, 'BAL-02').passed, false, checkOf(report, 'BAL-02').message);
  // The exact integer solver is untouched: the truncated reaction still balances.
  const solution = deriveBalanceSolution(gen);
  assert.equal(solution.status, 'unique');
  if (solution.status === 'unique') assert.deepEqual(solution.coefficients, [2, 1, 2]);
});

test('S6R-05 control: a page that really prints two products still publishes', () => {
  const page = 'The page prints 2H2O2 -> 2H2O + O2.';
  const gen: BalanceEquationGen = {
    ...waterGen(page, '2H2O2 -> 2H2O + O2'),
    species: [
      { id: 'peroxide', formula: 'H2O2', side: 'left', sourceId: 'chem-reaction', quote: page },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-reaction', quote: page },
      { id: 'oxygen', formula: 'O2', side: 'right', sourceId: 'chem-reaction', quote: page },
    ],
  };
  const report = bal(gen, [chemistrySource('chem-reaction', page)]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'BAL-03').message, /\[2, 2, 1\]/);
});

test('S6R-05: a printed reactant left off the front of the equation also fails closed', () => {
  const page = 'The page prints glucose + 6CO2 + 6H2O -> C6H12O6 + 6O2.';
  const gen: BalanceEquationGen = {
    ...waterGen(page, '6CO2 + 6H2O -> C6H12O6 + 6O2'),
    species: [
      { id: 'carbon-dioxide', formula: 'CO2', side: 'left', sourceId: 'chem-reaction', quote: page },
      { id: 'water', formula: 'H2O', side: 'left', sourceId: 'chem-reaction', quote: page },
      { id: 'glucose', formula: 'C6H12O6', side: 'right', sourceId: 'chem-reaction', quote: page },
      { id: 'oxygen', formula: 'O2', side: 'right', sourceId: 'chem-reaction', quote: page },
    ],
  };
  const report = bal(gen, [chemistrySource('chem-reaction', page)]);
  const bal01 = checkOf(report, 'BAL-01');
  assert.equal(bal01.passed, false, bal01.message);
  assert.match(bal01.message, /glucose \+ 6CO2 \+ 6H2O/, bal01.message);
});

test('S6R-05: a species that continues after whitespace without a plus fails closed', () => {
  const page = 'The page prints H2 + O2 -> H2O H2O2.';
  const report = bal(waterGen(page), [chemistrySource('chem-reaction', page)]);
  const bal01 = checkOf(report, 'BAL-01');
  assert.equal(bal01.passed, false, 'a second printed species after whitespace must not be ignored');
  assert.match(bal01.message, /H2O2/, bal01.message);
});

test('S6R-05: coefficient-led and state-symbol edges are part of the span, not a boundary', () => {
  const page = 'It gives 2H2(g) + O2(g) -> 2H2O(l) in the flask.';
  const gen: BalanceEquationGen = {
    ...waterGen(page, '2H2 + O2 -> 2H2O'),
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-reaction', quote: page },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-reaction', quote: page },
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-reaction', quote: page },
    ],
  };
  const report = bal(gen, [chemistrySource('chem-reaction', page)]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
});

test('S6R-05 helper: maximalReactionSpan returns the whole printed reaction', () => {
  const omitted = maximalReactionSpan('The page prints H2 + O2 -> H2O + H2O2.', 'H2 + O2 -> H2O');
  assert.ok(omitted !== null);
  assert.equal(omitted.text, 'H2 + O2 -> H2O + H2O2');
  assert.equal(omitted.continues, false);

  const exact = maximalReactionSpan('The page prints H2 + O2 -> H2O.', 'H2 + O2 -> H2O');
  assert.ok(exact !== null);
  assert.equal(exact.text, 'H2 + O2 -> H2O');
  assert.equal(exact.continues, false);

  // Real NOAA wording: the equation sits alone, so prose on either side is not part of the span.
  const src = loadSource('noaa-oceanexplorer-fueling-life-on-earth');
  const noaa = maximalReactionSpan(src.text, '6CO2 + 6H2O \u2192 C6H12O6 + 6O2');
  assert.ok(noaa !== null);
  assert.equal(noaa.text, '6CO2 + 6H2O -> C6H12O6 + 6O2');
  assert.equal(noaa.continues, false);
  const chemosynthesis = maximalReactionSpan(src.text, 'CO2 + 4H2S + O2 \u2192 CH2O + 4S + 3H2O');
  assert.ok(chemosynthesis !== null);
  assert.equal(chemosynthesis.text, 'CO2 + 4H2S + O2 -> CH2O + 4S + 3H2O');
  assert.equal(chemosynthesis.continues, false);

  // An operator keeps the printed term inside the span, so the multiset comparison names it.
  const absorbed = maximalReactionSpan('glucose + 6CO2 + 6H2O -> C6H12O6 + 6O2', '6CO2 + 6H2O -> C6H12O6 + 6O2');
  assert.ok(absorbed !== null);
  assert.equal(absorbed.text, 'glucose + 6CO2 + 6H2O -> C6H12O6 + 6O2');
  assert.equal(absorbed.continues, false);
  const bare = maximalReactionSpan('The page prints H2 + O2 -> H2O H2O2.', 'H2 + O2 -> H2O');
  assert.ok(bare !== null);
  assert.equal(bare.continues, true);

  // A crop of a longer formula is still not an occurrence at all.
  assert.equal(maximalReactionSpan('The page prints H2 + O2 -> H2O2.', 'H2 + O2 -> H2O'), null);
});

/* ------------------------------------------------------------------ */
/* S6R-09 — the number must be whole at the matched answer occurrence  */
/* ------------------------------------------------------------------ */

function numericQuiz(opts: { answer: string; quote: string; distractors?: string[]; pageExtra?: string }): {
  gen: QuizCardsGen;
  sources: ReturnType<typeof synthSource>[];
} {
  const gen = clone(quizGen());
  gen.cards[0] = {
    id: 'measured-value',
    stem: 'What value did the experiment record',
    options: [opts.answer, ...(opts.distractors ?? ['no value was recorded', 'the value was not stated'])],
    sourceId: 'chem-numerics',
    quote: opts.quote,
    hint: '',
  };
  const text = `The measurement section follows. ${opts.quote} ${opts.pageExtra ?? ''}`.trim();
  return { gen, sources: [synthSource('chem-numerics', 'Synthetic numbers paragraph', text), dragSource()] };
}

test('S6R-09 quiz-number-elsewhere-in-own-quote: a later whole `2` cannot rescue `a value of 2`', () => {
  // Reviewer vector, verbatim.
  const { gen, sources } = numericQuiz({
    answer: 'a value of 2',
    quote: 'The experiment records a value of 20 in sample 2.',
    distractors: ['other', 'unknown'],
  });
  const report = validateKitComponent('quiz-cards-v1', gen, sources);
  assert.equal(report.publishable, false, 'the cropped answer must not publish');
  const q02 = checkOf(report, 'Q-02');
  assert.equal(q02.passed, false, 'Q-02 owns the answer-in-quote grounding');
  assert.match(q02.message, /whole number/, q02.message);
  assert.match(q02.message, /20/, 'the message must show the quoted number the crop stops inside');
});

test('S6R-09 controls: the same quote still accepts answers that are whole tokens there', () => {
  for (const answer of ['a value of 20', 'sample 2']) {
    const { gen, sources } = numericQuiz({ answer, quote: 'The experiment records a value of 20 in sample 2.' });
    const report = validateKitComponent('quiz-cards-v1', gen, sources);
    assert.deepEqual(failedIds(report), [], `${answer}: ${report.checks.filter(c => !c.passed).map(c => c.message).join('\n')}`);
  }
});

test('S6R-09 helper: whole-token identity is evaluated at the matched occurrence', () => {
  const quote = 'The experiment records a value of 20 in sample 2.';
  assert.equal(contentOccursWhole(quote, 'a value of 2').ok, false);
  assert.equal(contentOccursWhole(quote, 'a value of 20').ok, true);
  assert.equal(contentOccursWhole(quote, 'sample 2').ok, true);
  // Value identity still crosses spelling: 5 matches a printed 5.0 written at that position.
  assert.equal(contentOccursWhole('The volume was 5.0 liters in total.', '5').ok, true);
  assert.equal(contentOccursWhole('The volume was 5.0 liters in total.', '5.00').contained, false);
  // A decimal, a sign and a grouped number are still their own values.
  assert.equal(contentOccursWhole('records a value of 20', '2').ok, false);
  assert.equal(contentOccursWhole('the table lists 1,200 entries', '200').ok, false);
  assert.equal(contentOccursWhole('it fell to -2 degrees', '2').ok, false);
  assert.equal(contentOccursWhole('it fell to -2 degrees', '-2').ok, true);
  assert.equal(contentOccursWhole('the grant was 1,200 dollars', '1200').contained, false); // no such spelling in the quote
  assert.equal(contentOccursWhole('the grant was 1200 dollars', '1,200').contained, false);
});

/* ------------------------------------------------------------------ */
/* S6R-13 — value-equal numeric options are one answer                  */
/* ------------------------------------------------------------------ */

test('S6R-13 quiz-equivalent-numeric-distractor: `5` and `5.00` must not both be offered', () => {
  const { gen, sources } = numericQuiz({
    answer: '5',
    quote: 'The experiment records a value of 5.0.',
    distractors: ['5.00', 'unknown'],
  });
  const report = validateKitComponent('quiz-cards-v1', gen, sources);
  assert.equal(report.publishable, false, 'a card with two equal-valued numeric options must not publish');
  const q03 = checkOf(report, 'Q-03');
  assert.equal(q03.passed, false, 'Q-03 owns option distinctness');
  assert.match(q03.message, /same number/, q03.message);
  assert.deepEqual(q03.affected, ['/cards/0/options/0', '/cards/0/options/1'], q03.message);
});

test('S6R-13: a value-equal distractor of the correct answer fails in both spelling directions', () => {
  const vectors: { answer: string; distractor: string; quote: string }[] = [
    { answer: '5', distractor: '5.00', quote: 'The experiment records a value of 5.0.' },
    { answer: '5.0', distractor: '5', quote: 'The experiment records a value of 5.0.' },
    { answer: '1200', distractor: '1,200', quote: 'The sample held 1200 units in total.' },
  ];
  for (const v of vectors) {
    const { gen, sources } = numericQuiz({ answer: v.answer, quote: v.quote, distractors: [v.distractor, 'unknown'] });
    const report = validateKitComponent('quiz-cards-v1', gen, sources);
    assert.equal(checkOf(report, 'Q-03').passed, false, `${v.answer} vs ${v.distractor}: ${checkOf(report, 'Q-03').message}`);
  }
});

test('S6R-13 controls: distinct numeric options and non-numeric options still publish', () => {
  const distinct = numericQuiz({
    answer: '5',
    quote: 'The experiment records a value of 5.0.',
    distractors: ['4', '7'],
    pageExtra: 'The earlier trial ruled out 4 and 7.',
  });
  const distinctReport = validateKitComponent('quiz-cards-v1', distinct.gen, distinct.sources);
  assert.deepEqual(failedIds(distinctReport), [], distinctReport.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  // Signed values are different values.
  const signed = numericQuiz({
    answer: '-5',
    quote: 'The reading fell to -5 degrees overnight.',
    distractors: ['5', 'unknown'],
  });
  const signedReport = validateKitComponent('quiz-cards-v1', signed.gen, signed.sources);
  assert.equal(checkOf(signedReport, 'Q-03').passed, true, checkOf(signedReport, 'Q-03').message);
});

test('S6R-13 helper: only a bare number carries an option value', () => {
  assert.equal(numericOptionValue('5'), '5');
  assert.equal(numericOptionValue('5.00'), '5');
  assert.equal(numericOptionValue(' 5.0 '), '5');
  assert.equal(numericOptionValue('1,200'), '1200');
  assert.equal(numericOptionValue('-5'), '-5');
  assert.equal(numericOptionValue('a value of 2'), null);
  assert.equal(numericOptionValue('5 kg'), null);
  assert.equal(numericOptionValue('5%'), null);
  assert.deepEqual(signedNumericTokens('5.0 and 5 and 05'), ['5']);
});