// S6-V — v2 kit repair comparison tests (compareKitRevisions, design §5.4 frozen discipline):
// changes only at affected paths recomputed from revision 1, ids stable, item counts frozen
// (the system prunes, never the model), tolerance never increased, slider ranges never narrowed
// unless FE-06 itself failed. The authority is the recomputed baseline report; caller findings
// may only narrow it.
// Run: node --test packages/validation/stage6-kit-repair.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { compareKitRevisions, validateKitComponent } from './kit/index.ts';
import {
  clone, dragSource, failedIds, formulaGen, quizGen, repairedOverviewGen, overviewGen,
} from './fixtures/stage6.ts';
import type { QuizCardsGen } from '../contracts/kit.ts';

function brokenQuiz(): QuizCardsGen {
  const gen = clone(quizGen());
  gen.cards[0]!.quote = 'A fabricated quiz sentence naming the drag coefficient only.';
  return gen;
}

test('the broken quiz baseline fails exactly Q-01 with the quote path affected', () => {
  const report = validateKitComponent('quiz-cards-v1', brokenQuiz(), [dragSource()]);
  assert.deepEqual(failedIds(report), ['Q-01']);
  assert.deepEqual(report.checks.find(c => c.id === 'Q-01')?.affected, ['/cards/0/quote']);
});

test('repair: fixing exactly the affected quote passes', () => {
  const check = compareKitRevisions('quiz-cards-v1', brokenQuiz(), quizGen(), { sources: [dragSource()] });
  assert.equal(check.passed, true, check.message);
  assert.equal(check.id, 'repair.no-weakening');
});

test('repair: a change outside the affected paths is rejected', () => {
  const next = clone(quizGen());
  next.cards[0]!.stem = 'A brand new stem about the drag coefficient and its effects.';
  const check = compareKitRevisions('quiz-cards-v1', brokenQuiz(), next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/cards\/0\/stem changed .* outside the affected paths/);
});

test('repair: dropping an item is a structural violation (the system prunes, not the model)', () => {
  const next = clone(quizGen());
  next.cards.pop();
  const check = compareKitRevisions('quiz-cards-v1', brokenQuiz(), next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /list length|structure/);
});

test('repair: renaming an id that the authority does not name is rejected (ids stable)', () => {
  const next = clone(quizGen());
  next.cards[0]!.id = 'renamed-card';
  const check = compareKitRevisions('quiz-cards-v1', brokenQuiz(), next, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/cards\/0\/id changed/);
});

test('repair: caller findings may only narrow the recomputed authority', () => {
  const findingNoAffected = compareKitRevisions('quiz-cards-v1', brokenQuiz(), quizGen(), {
    sources: [dragSource()],
    findings: [{ id: 'Q-01', kind: 'grounding', message: 'fabricated quote' }],
  });
  assert.equal(findingNoAffected.passed, false, 'a finding without affected paths unlocks nothing');
  const exact = compareKitRevisions('quiz-cards-v1', brokenQuiz(), quizGen(), {
    sources: [dragSource()],
    findings: [{ id: 'Q-01', kind: 'grounding', message: 'fabricated quote', affected: ['/cards/0/quote'] }],
  });
  assert.equal(exact.passed, true, exact.message);
  const wrongCheck = compareKitRevisions('quiz-cards-v1', brokenQuiz(), quizGen(), {
    sources: [dragSource()],
    findings: [{ id: 'Q-02', kind: 'semantic', message: 'x', affected: ['/cards/0/quote'] }],
  });
  assert.equal(wrongCheck.passed, false, 'a finding naming a check that passed on recomputation unlocks nothing');
});

test('repair: without sources the comparator fails closed on any change', () => {
  assert.equal(compareKitRevisions('quiz-cards-v1', brokenQuiz(), quizGen(), {}).passed, false);
  assert.equal(compareKitRevisions('quiz-cards-v1', brokenQuiz(), clone(brokenQuiz()), {}).passed, true);
});

test('formula explorer: a tolerance never increases, even under an affected path', () => {
  const baseline = clone(formulaGen());
  baseline.hasSourceExample = true;
  baseline.sourceExample = { quote: 'D = Cd * (rho * V^2 * A) / 2', resultNumber: 42, tolerance: 0.5 };
  const report = validateKitComponent('formula-explorer-v1', baseline, [dragSource()]);
  assert.deepEqual(report.checks.filter(c => !c.passed).map(c => c.id), ['FE-05']);
  const affected = report.checks.find(c => c.id === 'FE-05')?.affected ?? [];
  assert.ok(affected.includes('/sourceExample/tolerance'));
  // Increasing the tolerance sits under an authorized path but violates the absolute rule:
  const widened = clone(baseline);
  widened.sourceExample.tolerance = 0.75;
  const check = compareKitRevisions('formula-explorer-v1', baseline, widened, { sources: [dragSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /tolerance increased/);
  // Lowering it and fixing the result number is a legal repair direction:
  const lowered = clone(baseline);
  lowered.sourceExample.tolerance = 0.25;
  lowered.sourceExample.resultNumber = 2;
  const ok = compareKitRevisions('formula-explorer-v1', baseline, lowered, { sources: [dragSource()] });
  assert.equal(ok.passed, true, ok.message);
});

test('formula explorer: range width may shrink only when FE-06 failed on the baseline', () => {
  // FE-06 failing baseline (slider ratio 1e7): the repair may widen/narrow that variable's range.
  const baseline = clone(formulaGen());
  baseline.variables[2]!.min = 0.00001; // v: ratio 100/0.00001 = 1e7 > 1e6
  const report = validateKitComponent('formula-explorer-v1', baseline, [dragSource()]);
  assert.deepEqual(report.checks.filter(c => !c.passed).map(c => c.id), ['FE-06']);
  const fixed = clone(baseline);
  fixed.variables[2]!.min = 1;
  fixed.variables[2]!.max = 50; // width shrank, but FE-06 failed → allowed
  const ok = compareKitRevisions('formula-explorer-v1', baseline, fixed, { sources: [dragSource()] });
  assert.equal(ok.passed, true, ok.message);
  // FE-04 failing baseline: shrinking an untouched variable's range is rejected twice over
  // (unauthorized path AND the never-narrow-a-sane-range rule).
  const baseline2 = clone(formulaGen());
  baseline2.cases[0]!.inputs[2]!.value = 1000;
  const report2 = validateKitComponent('formula-explorer-v1', baseline2, [dragSource()]);
  assert.deepEqual(report2.checks.filter(c => !c.passed).map(c => c.id), ['FE-04']);
  const shrunk = clone(baseline2);
  shrunk.cases[0]!.inputs[2]!.value = 50;
  shrunk.variables[2]!.max = 60;
  const bad = compareKitRevisions('formula-explorer-v1', baseline2, shrunk, { sources: [dragSource()] });
  assert.equal(bad.passed, false);
  assert.match(bad.message, /\/variables\/2\/max changed/);
});

test('overview: the golden OV-06 gap is repairable within the frozen discipline', () => {
  // The raw golden overview fails OV-06; the repaired wording changes exactly the three
  // affected paths, so the comparator accepts it.
  const baseline = overviewGen();
  const report = validateKitComponent('overview-v1', baseline, [dragSource()]);
  assert.deepEqual(report.checks.filter(c => !c.passed).map(c => c.id), ['OV-06']);
  const check = compareKitRevisions('overview-v1', baseline, repairedOverviewGen(), { sources: [dragSource()] });
  assert.equal(check.passed, true, check.message);
});

test('unknown component ids fail closed', () => {
  const check = compareKitRevisions('nope-v2', {}, { x: 1 }, { sources: [dragSource()] });
  assert.equal(check.passed, false);
});
