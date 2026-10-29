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
  atmosphereSource, clone, compareGen, dragSource, failedIds, formulaGen, quizGen,
  repairedOverviewGen, paraphrasedOverviewGen,
} from './fixtures/stage6.ts';
import type { CompareTableGen, QuizCardsGen } from '../contracts/kit.ts';

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

test('overview: a paraphrased (OV-06-failing) overview is repairable within the frozen discipline', () => {
  // The paraphrased overview fails OV-06; rewording exactly the three affected paths (never the
  // quote) is accepted by the comparator.
  const baseline = paraphrasedOverviewGen();
  const report = validateKitComponent('overview-v1', baseline, [dragSource()]);
  assert.deepEqual(report.checks.filter(c => !c.passed).map(c => c.id), ['OV-06']);
  const check = compareKitRevisions('overview-v1', baseline, repairedOverviewGen(), { sources: [dragSource()] });
  assert.equal(check.passed, true, check.message);
});

test('unknown component ids fail closed', () => {
  const check = compareKitRevisions('nope-v2', {}, { x: 1 }, { sources: [dragSource()] });
  assert.equal(check.passed, false);
});

/* ------------------------------------------------------------------ */
/* compare-table-v1 (Stage 6 compare-grid: cell identity = row x column) */
/* ------------------------------------------------------------------ */

function idEntityCompare(): CompareTableGen {
  const gen = clone(compareGen());
  gen.rows[0]!.entity = 'this-equation'; // the real live-run failure class
  return gen;
}

test('compare: the id-like entity baseline fails schema.gen with /rows/0/entity affected', () => {
  const report = validateKitComponent('compare-table-v1', idEntityCompare(), [atmosphereSource()]);
  assert.ok(failedIds(report).includes('schema.gen'));
  const gate = report.checks.find(c => c.id === 'schema.gen');
  assert.ok(gate?.affected?.includes('/rows/0/entity'));
  assert.match(gate?.message ?? '', /looks like an id; use the words the page uses/);
});

test('compare repair: renaming a flagged id-like entity to the page wording is accepted', () => {
  const check = compareKitRevisions('compare-table-v1', idEntityCompare(), compareGen(), { sources: [atmosphereSource()] });
  assert.equal(check.passed, true, check.message);
});

test('compare repair: changing a value that passed is rejected', () => {
  const next = clone(idEntityCompare());
  next.rows[0]!.entity = 'troposphere'; // authorized rename ...
  next.rows[1]!.values[0]!.value = 'temperature rises'; // ... plus an unauthorized value change
  const check = compareKitRevisions('compare-table-v1', idEntityCompare(), next, { sources: [atmosphereSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /\/rows\/1\/values\/0\/value changed .* outside the affected paths/);
});

test('compare repair: adding the missing value of a short row is authorized by CT-03 (/rows/i/values)', () => {
  const baseline = clone(compareGen());
  baseline.rows[1]!.values.pop();
  const report = validateKitComponent('compare-table-v1', baseline, [atmosphereSource()]);
  assert.deepEqual(failedIds(report), ['CT-03']);
  assert.ok(report.checks.find(c => c.id === 'CT-03')?.affected?.includes('/rows/1/values'));
  const check = compareKitRevisions('compare-table-v1', baseline, compareGen(), { sources: [atmosphereSource()] });
  assert.equal(check.passed, true, check.message);
});

test('compare repair: resizing the rows list itself stays frozen', () => {
  const baseline = clone(compareGen());
  baseline.rows[1]!.values.pop(); // CT-03 authorizes /rows/1/values only
  const next = clone(compareGen());
  next.rows.pop(); // dropping a whole row is a structural violation
  const check = compareKitRevisions('compare-table-v1', baseline, next, { sources: [atmosphereSource()] });
  assert.equal(check.passed, false);
  assert.match(check.message, /list length|structure/);
});

test('compare repair: without sources the comparator fails closed on any change', () => {
  assert.equal(compareKitRevisions('compare-table-v1', idEntityCompare(), compareGen(), {}).passed, false);
});
