// S6R-A2 regression tests — independent Stage 6 review findings S6R-05 and S6R-09.
//
// S6R-05 (`balance-product-token-cut`): BAL-01/BAL-02/BAL-09 must tie the activity to a COMPLETE
// equation span in the source, with chemical-token boundaries. A species or equation cropped out
// of a longer source formula (`H2O` cut from `H2O2`) must fail; the real NOAA equations must still
// ground. The exact integer solver (BAL-03/04/05/08) is untouched.
//
// S6R-09 (`quiz-number-token-cut`): a numeric quiz answer/option must match its own card quote as
// a WHOLE SIGNED number (`2` is not the `2` inside `20`, `2.5`, `-2` or `1,200`), and the shared
// numbers check uses the same token identity instead of a substring search.
//
// Run: node --test packages/validation/stage6-review-s6r-a2.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveBalanceSolution, validateKitComponent } from './kit/index.ts';
import {
  checkOf, clone, chemistrySource, dragSource, failedIds, quizGen, synthSource,
} from './fixtures/stage6.ts';
import { loadSource } from '../sources/index.ts';
import {
  chemicallyCompleteOccurrences, chemicalFormulaTokens, contentOccursWhole,
  numbersCheckProblems, signedNumericTokens,
} from './kit/shared.ts';
import type { BalanceEquationGen, QuizCardsGen } from '../contracts/kit.ts';
import type { SourceAnalysisV2 } from '../contracts/index.ts';
import { validateAnalysisV2 } from './analysis-v2.ts';

const bal = (gen: BalanceEquationGen, sources: ReturnType<typeof chemistrySource>[]) =>
  validateKitComponent('balance-equation-v1', gen, sources);

/* ------------------------------------------------------------------ */
/* S6R-05 — the reaction must be a complete equation span in source    */
/* ------------------------------------------------------------------ */

test('S6R-05 balance-product-token-cut: a product cropped from a longer source formula fails', () => {
  // Reviewer vector, verbatim: the source prints hydrogen peroxide, the activity swaps in water.
  const quote = 'The page prints H2 + O2 -> H2O2.';
  const src = chemistrySource('chem-cut', quote);
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'A reaction from the page',
    equationText: 'H2 + O2 -> H2O',
    sourceId: 'chem-cut',
    quote,
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-cut', quote },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-cut', quote },
      { id: 'product', formula: 'H2O', side: 'right', sourceId: 'chem-cut', quote },
    ],
    hint: '',
  };
  const report = bal(gen, [src]);
  assert.equal(report.publishable, false, 'the cropped equation must not publish');
  const bal01 = checkOf(report, 'BAL-01');
  assert.equal(bal01.passed, false, 'BAL-01 must own the source-equation identity');
  assert.match(bal01.message, /H2O2/, 'the message must show the formula the source actually prints');
  // The solver is untouched: the wrong reaction still balances exactly, which is why the
  // source bridge has to carry the identity.
  const solution = deriveBalanceSolution(gen);
  assert.equal(solution.status, 'unique');
  if (solution.status === 'unique') assert.deepEqual(solution.coefficients, [2, 1, 2]);
  assert.equal(checkOf(report, 'BAL-03').passed, true, 'atom balance arithmetic is out of scope for S6R-05');
});

test('S6R-05 control: the equation the source actually prints still publishes', () => {
  const quote = 'The page prints H2 + O2 -> H2O2.';
  const src = chemistrySource('chem-cut', quote);
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'A reaction from the page',
    equationText: 'H2 + O2 -> H2O2',
    sourceId: 'chem-cut',
    quote,
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-cut', quote },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-cut', quote },
      { id: 'hydrogen-peroxide', formula: 'H2O2', side: 'right', sourceId: 'chem-cut', quote },
    ],
    hint: '',
  };
  const report = bal(gen, [src]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
});

test('S6R-05/BAL-09: a species formula cropped from a longer token in its own quote fails alone', () => {
  const text = 'The page prints H2 + O2 -> H2O. The detail line repeats H2 + O2 -> H2O2.';
  const src = chemistrySource('chem-species-cut', text);
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'A reaction from the page',
    equationText: 'H2 + O2 -> H2O',
    sourceId: 'chem-species-cut',
    quote: 'The page prints H2 + O2 -> H2O',
    species: [
      { id: 'hydrogen', formula: 'H2', side: 'left', sourceId: 'chem-species-cut', quote: 'The page prints H2 + O2 -> H2O' },
      { id: 'oxygen', formula: 'O2', side: 'left', sourceId: 'chem-species-cut', quote: 'The page prints H2 + O2 -> H2O' },
      // The product's own quote only ever spells H2O2, so `H2O` there is a crop.
      { id: 'water', formula: 'H2O', side: 'right', sourceId: 'chem-species-cut', quote: 'The detail line repeats H2 + O2 -> H2O2' },
    ],
    hint: '',
  };
  const report = bal(gen, [src]);
  assert.deepEqual(failedIds(report), ['BAL-09'], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  const bal09 = checkOf(report, 'BAL-09');
  assert.deepEqual(bal09.affected, ['/species/2/quote']);
  assert.match(bal09.message, /as a whole formula/);
});

test('S6R-05: the real NOAA photosynthesis equation still grounds (coefficients and arrow form)', () => {
  const src = loadSource('noaa-oceanexplorer-fueling-life-on-earth');
  const quote = '6CO2 + 6H2O \u2192 C6H12O6 + 6O2';
  const species = [
    { id: 'carbon-dioxide', formula: 'CO2', side: 'left' as const },
    { id: 'water', formula: 'H2O', side: 'left' as const },
    { id: 'glucose', formula: 'C6H12O6', side: 'right' as const },
    { id: 'oxygen', formula: 'O2', side: 'right' as const },
  ].map(s => ({ ...s, sourceId: 'noaa-oceanexplorer-fueling-life-on-earth', quote }));
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'Balancing the photosynthesis reaction',
    equationText: '6CO2 + 6H2O \u2192 C6H12O6 + 6O2',
    sourceId: 'noaa-oceanexplorer-fueling-life-on-earth',
    quote,
    species,
    hint: 'Count each kind of atom on the left and right until both sides match',
  };
  const report = bal(gen, [src]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
  assert.match(checkOf(report, 'BAL-03').message, /\[6, 6, 1, 6\]/);
});

test('S6R-05: the real NOAA chemosynthesis equation still grounds (solver ambiguity is pre-existing)', () => {
  const src = loadSource('noaa-oceanexplorer-fueling-life-on-earth');
  const quote = 'CO2 + 4H2S + O2 \u2192 CH2O + 4S + 3H2O';
  const species = [
    { id: 'carbon-dioxide', formula: 'CO2', side: 'left' as const },
    { id: 'hydrogen-sulfide', formula: 'H2S', side: 'left' as const },
    { id: 'oxygen', formula: 'O2', side: 'left' as const },
    { id: 'formaldehyde', formula: 'CH2O', side: 'right' as const },
    { id: 'sulfur', formula: 'S', side: 'right' as const },
    { id: 'water', formula: 'H2O', side: 'right' as const },
  ].map(s => ({ ...s, sourceId: 'noaa-oceanexplorer-fueling-life-on-earth', quote }));
  const gen: BalanceEquationGen = {
    schemaVersion: 'balance-equation-v1',
    title: 'Balancing the chemosynthesis reaction',
    equationText: 'CO2 + 4H2S + O2 \u2192 CH2O + 4S + 3H2O',
    sourceId: 'noaa-oceanexplorer-fueling-life-on-earth',
    quote,
    species,
    hint: 'Count each kind of atom on the left and right until both sides match',
  };
  const report = bal(gen, [src]);
  // Grounding must not newly reject it: BAL-01 (complete source span) and BAL-09 (whole formula
  // per species quote) pass on the printed equation.
  for (const id of ['BAL-01', 'BAL-09']) {
    assert.equal(checkOf(report, id).passed, true, `${id}: ${checkOf(report, id).message}`);
  }
  // BAL-02 fails for two pre-existing reasons unrelated to this wave: the printed reaction has 6
  // species (the frozen limit is 2-5) and the exact solver finds a nullity-2 atom matrix, i.e. it
  // is not balanced uniquely. Neither is a source-identity defect.
  const bal02 = checkOf(report, 'BAL-02');
  assert.match(bal02.message, /species has 6 entries, expected 2-5/);
  assert.doesNotMatch(bal02.message, /does not match the printed equationText/);
  assert.match(checkOf(report, 'BAL-08').message, /ambiguous/);
});

/* ------------------------------------------------------------------ */
/* Quiz helpers for S6R-09                                             */
/* ------------------------------------------------------------------ */

const NUM_SOURCE_ID = 'chem-numerics';

/** One numeric card replacing the golden's first card, plus syntactically valid filler cards. */
function numericQuiz(opts: {
  answer: string;
  quote: string;
  stem?: string;
  hint?: string;
  distractors?: string[];
  pageExtra?: string;
}): { gen: QuizCardsGen; sources: ReturnType<typeof synthSource>[] } {
  const gen = clone(quizGen());
  gen.cards[0] = {
    id: 'measured-value',
    stem: opts.stem ?? 'What value did the experiment record',
    options: [opts.answer, ...(opts.distractors ?? ['no value was recorded', 'the value was not stated'])],
    sourceId: NUM_SOURCE_ID,
    quote: opts.quote,
    hint: opts.hint ?? '',
  };
  const text = `The measurement section follows. ${opts.quote} ${opts.pageExtra ?? ''}`.trim();
  return {
    gen,
    sources: [synthSource(NUM_SOURCE_ID, 'Synthetic numbers paragraph', text), dragSource()],
  };
}

/* ------------------------------------------------------------------ */
/* S6R-09 — whole signed numeric-token identity                        */
/* ------------------------------------------------------------------ */

test('S6R-09 quiz-number-token-cut: `2` is not the `2` inside a quoted `20`', () => {
  // Reviewer vector, verbatim: the quote says 20, the graded key says 2, and elsewhere on the
  // page `2` appears in its own sentence.
  const { gen, sources } = numericQuiz({
    answer: '2',
    quote: 'This experiment records a value of 20.',
    stem: 'What value did the experiment record',
    distractors: ['other', 'unknown'],
    pageExtra: 'Another observation has 2 parts.',
  });
  const report = validateKitComponent('quiz-cards-v1', gen, sources);
  assert.equal(report.publishable, false, 'the truncated numeric key must not publish');
  const q02 = checkOf(report, 'Q-02');
  assert.equal(q02.passed, false, 'Q-02 owns the answer-in-quote grounding');
  assert.match(q02.message, /whole number/, q02.message);
  assert.match(q02.message, /20/, 'the message must show the quoted number');
  // Q-05 co-fails by construction (the answer is the only option that may match, and it does not).
  assert.ok(failedIds(report).includes('Q-05'), failedIds(report).join(', '));
});

test('S6R-09: a decimal fragment, a signed mismatch and a grouped fragment all fail Q-02', () => {
  const cases: { answer: string; quote: string }[] = [
    { answer: '2', quote: 'The sample weighed 2.5 grams in total.' },
    { answer: '2', quote: 'The reading fell to -2 degrees overnight.' },
    { answer: '200', quote: 'The grant was 1,200 dollars in total.' },
  ];
  for (const c of cases) {
    const { gen, sources } = numericQuiz({ answer: c.answer, quote: c.quote });
    const report = validateKitComponent('quiz-cards-v1', gen, sources);
    assert.equal(checkOf(report, 'Q-02').passed, false, `${c.answer} inside \"${c.quote}\" must fail Q-02`);
  }
});

test('S6R-09 control: whole tokens and the same value written differently still pass', () => {
  const cases: { answer: string; quote: string }[] = [
    { answer: '2', quote: 'The sample held 2 parts of salt.' },
    { answer: '-2', quote: 'The reading fell to -2 degrees overnight.' },
    { answer: '1,200', quote: 'The grant was 1,200 dollars in total.' },
    { answer: '5', quote: 'The volume was 5.0 liters in total.' }, // same value, different spelling
  ];
  for (const c of cases) {
    const { gen, sources } = numericQuiz({ answer: c.answer, quote: c.quote });
    const report = validateKitComponent('quiz-cards-v1', gen, sources);
    assert.equal(checkOf(report, 'Q-02').passed, true, `${c.answer} in \"${c.quote}\": ${checkOf(report, 'Q-02').message}`);
    assert.equal(checkOf(report, 'Q-05').passed, true, `${c.answer} in \"${c.quote}\": ${checkOf(report, 'Q-05').message}`);
  }
});

test('S6R-09: numeric distractors use the same whole-token boundary (a fragment is not a match)', () => {
  const { gen, sources } = numericQuiz({
    answer: '20',
    quote: 'This experiment records a value of 20.',
    distractors: ['2', 'no value was recorded'],
  });
  const report = validateKitComponent('quiz-cards-v1', gen, sources);
  // `2` is a fragment of the quoted `20`, so it is a legitimate distractor: it must not count as
  // "occurs in the quote" for Q-05, and it must not trip Q-07 either.
  assert.equal(checkOf(report, 'Q-05').passed, true, checkOf(report, 'Q-05').message);
  assert.equal(checkOf(report, 'Q-07').passed, true, checkOf(report, 'Q-07').message);
  // A distractor that really is the quoted number still trips Q-05 and Q-07.
  const dup = numericQuiz({ answer: '20', quote: 'This experiment records a value of 20.', distractors: ['20', 'unknown'] });
  const dupReport = validateKitComponent('quiz-cards-v1', dup.gen, dup.sources);
  assert.ok(failedIds(dupReport).includes('Q-05'), failedIds(dupReport).join(', '));
});

test('S6R-09/N-01: a number grounded only inside a longer page number fails Q-06', () => {
  const { gen, sources } = numericQuiz({
    answer: '20',
    quote: 'This experiment records a value of 20.',
    hint: 'Recall the 200 figure from the table.', // the page only ever prints 1,200
    pageExtra: 'The appendix table lists 1,200 entries in all.',
  });
  const report = validateKitComponent('quiz-cards-v1', gen, sources);
  assert.equal(checkOf(report, 'Q-06').passed, false, 'Q-06 must not ground 200 inside 1,200');
  assert.match(checkOf(report, 'Q-06').message, /200/);
  // Control: the whole number written the same way on the page passes.
  const ok = numericQuiz({
    answer: '20',
    quote: 'This experiment records a value of 20.',
    hint: 'Recall the 1,200 figure from the table.',
    pageExtra: 'The appendix table lists 1,200 entries in all.',
  });
  const okReport = validateKitComponent('quiz-cards-v1', ok.gen, ok.sources);
  assert.equal(checkOf(okReport, 'Q-06').passed, true, checkOf(okReport, 'Q-06').message);
});

test('S6R-09 control: the untouched golden quiz still passes every Q check', () => {
  const report = validateKitComponent('quiz-cards-v1', quizGen(), [dragSource()]);
  assert.deepEqual(failedIds(report), [], report.checks.filter(c => !c.passed).map(c => c.message).join('\n'));
});

/* ------------------------------------------------------------------ */
/* A-10 / N-01 on REAL page numbers (live-run false rejections)         */
/* ------------------------------------------------------------------ */

/**
 * A minimal usable analysis around one key point — A-10 (N-01) is the only check under test, so
 * other checks failing on this synthetic envelope is irrelevant and never asserted.
 */
function analysisAround(point: string, quote: string, sourceId: string): SourceAnalysisV2 {
  return {
    analysisVersion: 2,
    subject: 'history',
    usable: true,
    declineCode: '',
    declineSummary: '',
    pageCoverage: 'Page covers the transaction and what it meant for the country.',
    overview: {
      headline: 'The page explains a national land transaction',
      keyPoints: [{ id: 'first-point', point, sourceId, quote }],
      keyTerms: [{ id: 'first-term', term: 'land', gloss: 'ground that a nation owns', sourceId, quote }],
    },
    componentPlan: [{
      componentId: 'sequence-v1',
      pedagogicalReason: 'Sequence shows how the transaction unfolded over time',
      focusQuote: quote,
      focusSourceId: sourceId,
    }],
  } as SourceAnalysisV2;
}

test('A-10/N-01: a grouped page number is the same number as the AI text (real NARA page)', () => {
  const src = loadSource('nara-louisiana-purchase-treaty');
  // The page: "...purchased 828,000 square miles of land west of the Mississippi River for $15 million."
  const quote = 'the United States purchased 828,000 square miles of land west of the Mississippi River for $15 million.';
  assert.ok(src.text.includes(quote), 'the fixture quote must be verbatim from the stored source');
  const analysis = analysisAround(
    'United States purchased 828,000 square miles west of Mississippi River for $15 million doubling size at roughly 4 cents an acre',
    quote,
    'nara-louisiana-purchase-treaty',
  );
  const report = validateAnalysisV2(analysis, [src]);
  assert.equal(checkOf(report, 'A-10').passed, true, checkOf(report, 'A-10').message);
});

test('A-10/N-01: a grouped dollar amount and a sentence-final number are grounded (real CFPB page)', () => {
  const src = loadSource('cfpb-teenagers-and-saving');
  const quote = "If they set aside $100 every year starting at age 14, they'd have about $23,000 at age 65.";
  assert.ok(src.text.includes(quote), 'the fixture quote must be verbatim from the stored source');
  const analysis = analysisAround(
    'Setting aside $100 every year from age 14 can grow to about $23,000 by age 65 at 5 percent',
    quote,
    'cfpb-teenagers-and-saving',
  );
  const report = validateAnalysisV2(analysis, [src]);
  assert.equal(checkOf(report, 'A-10').passed, true, checkOf(report, 'A-10').message);
  // A different grouped number is still a different number.
  const wrong = analysisAround(
    'Setting aside $100 every year from age 14 can grow to about $2,300 by age 65 at 5 percent',
    quote,
    'cfpb-teenagers-and-saving',
  );
  const wrongReport = validateAnalysisV2(wrong, [src]);
  assert.equal(checkOf(wrongReport, 'A-10').passed, false, '2300 must not be grounded by 23,000');
});

test('A-10/N-01 control: a number inside a larger page number is still rejected (2 vs 20)', () => {
  const src = synthSource('nara-louisiana-purchase-treaty', 'Synthetic stand-in', 'The survey recorded 20 plots in the parish.');
  const analysis = analysisAround('The survey recorded 2 plots in the parish', 'The survey recorded 20 plots', 'nara-louisiana-purchase-treaty');
  const report = validateAnalysisV2(analysis, [src]);
  assert.equal(checkOf(report, 'A-10').passed, false, '2 must not be grounded by 20');
});

test('S6R-09 helper: signed numbers are tokenised by value, not by substring', () => {
  assert.deepEqual(signedNumericTokens('a 2, b 20, c 2.5, d -2, e 1,200, f -0.5, g .00326'), ['2', '20', '2.5', '-2', '1200', '-0.5', '0.00326']);
  assert.deepEqual(signedNumericTokens('5.0 and 5 and 05'), ['5']); // one value, three spellings
  assert.deepEqual(signedNumericTokens('range 2-3 has two numbers'), ['2', '3']); // a dash is not a sign
  assert.equal(contentOccursWhole('records a value of 20', '2').ok, false);
  assert.equal(contentOccursWhole('records a value of 20', '20').ok, true);
  assert.equal(contentOccursWhole('the table lists 1,200 entries', '200').ok, false);
  assert.equal(contentOccursWhole('it fell to -2 degrees', '2').ok, false);
  assert.equal(contentOccursWhole('it fell to -2 degrees', '-2').ok, true);
  // A number at the end of a sentence is a whole number, not a decimal in progress.
  assert.equal(numbersCheckProblems('hint', 'published in 1686.', ['published in 1686.']).length, 0);
  assert.deepEqual(numbersCheckProblems('hint', 'cost 250 total', ['cost 1,250 total']), [
    'hint states the number 250, which does not appear as that whole number on the page or in the same quote (N-01)',
  ]);
});

test('S6R-05 helper: chemical formula tokens keep the longest run and equation spans need boundaries', () => {
  assert.deepEqual(chemicalFormulaTokens('The page prints H2 + O2 -> H2O2.'), ['The', 'H2', 'O2', 'H2O2']);
  assert.deepEqual(chemicalFormulaTokens('6CO2 and 6H2O and Ca(OH)2'), ['CO2', 'H2O', 'Ca(OH)2']); // coefficients are not formulas
  assert.deepEqual(chemicalFormulaTokens('The Steps: none'), ['The', 'Steps']);
  const src = 'The page prints H2 + O2 -> H2O2.';
  assert.equal(chemicallyCompleteOccurrences(src, 'H2 + O2 -> H2O').length, 0);
  assert.equal(chemicallyCompleteOccurrences(src, 'H2 + O2 -> H2O2').length, 1);
  // The same rule survives unicode subscripts and either arrow form.
  assert.equal(chemicallyCompleteOccurrences('It prints H\u2082 + O\u2082 \u27f6 H\u2082O\u2082 today.', 'H2 + O2 -> H2O').length, 0);
  assert.equal(chemicallyCompleteOccurrences('It prints H\u2082 + O\u2082 \u27f6 H\u2082O\u2082 today.', 'H2 + O2 -> H2O2').length, 1);
});