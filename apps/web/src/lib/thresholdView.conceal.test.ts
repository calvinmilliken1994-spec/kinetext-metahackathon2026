/// <reference types="node" />
// Set A: vote case titles never state the outcome before the reveal (UX #2), and ← hides a slide's answer even after
// the class moved the slider (W-05).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ThresholdSpec } from '../../../../packages/contracts/kit.ts';
import { neutralCounts, scenarioTitle, scenarioTitleShown, thresholdRevealState } from './thresholdView.ts';

const electoral = {
  stages: [{ id: 's1', body: 'electors', total: 538, rule: 'majority', numerator: 1, denominator: 2, statedCount: 0, sourceId: 's', quote: 'q', totalQuote: 't' }],
  scenarios: [
    { id: 'a', label: 'Candidate earns 270 electoral votes', yes: [270] },
    { id: 'b', label: 'Candidate falls just short of the threshold', yes: [269] },
    { id: 'c', label: 'Candidate earns a broad winning margin', yes: [350] },
  ],
} as unknown as ThresholdSpec;

test('before its reveal a scenario is titled by its counts only; after it, by its written title', () => {
  assert.equal(scenarioTitle(electoral, 1, false), '269 electors');
  assert.equal(scenarioTitle(electoral, 2, false), '350 electors');
  assert.equal(scenarioTitle(electoral, 1, true), 'Candidate falls just short of the threshold');
  for (let i = 0; i < 3; i++) assert.doesNotMatch(scenarioTitle(electoral, i, false), /short|win|margin|pass|fail|meets|below/i);
});

test('several stages: one count per stage, no verdict', () => {
  const two = { ...electoral, stages: [electoral.stages[0], { ...electoral.stages[0], id: 's2', body: 'States', total: 50 }] } as unknown as ThresholdSpec;
  assert.equal(neutralCounts(two, [300, 38]), '300 · 38');
});

test('a slide shows only the current step’s title, and only after R', () => {
  assert.equal(scenarioTitleShown(1, 1, true), true);
  assert.equal(scenarioTitleShown(1, 1, false), false);
  assert.equal(scenarioTitleShown(0, 1, true), false, 'an earlier step stays a question');
  assert.equal(scenarioTitleShown(2, 1, true), false, 'a later step stays a question');
});

test('W-05: R → move the slider → ← shows the question again, not the tried count’s verdict', () => {
  const afterMove = thresholdRevealState({ staged: true, presenterRevealed: true, shown: false, own: [40] });
  assert.deepEqual(afterMove, { revealed: true, own: [40] });
  const back = thresholdRevealState({ staged: true, presenterRevealed: false, shown: false, own: [40] });
  assert.deepEqual(back, { revealed: false, own: null });
  // the lesson: a learner's own count shows its verdict
  assert.deepEqual(thresholdRevealState({ staged: false, presenterRevealed: false, shown: false, own: [12] }), { revealed: true, own: [12] });
  assert.deepEqual(thresholdRevealState({ staged: false, presenterRevealed: false, shown: false, own: null }), { revealed: false, own: null });
});
