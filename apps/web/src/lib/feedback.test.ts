import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALCULATED_SOURCE, choiceFeedback, feedbackLevel, gradeFeedback, ladderFeedback, numericFeedback, targetRule } from './feedback.ts';
import { gradePrediction, studentTolerance } from './predictions.ts';

const lift = (guess: number) => numericFeedback({ guess, actual: 18375, tolerance: studentTolerance(18375, 0.001), unit: 'N' });

test('the review case: 18,000 N against 18,375 N is "very close", just outside the 2% target, in one line', () => {
  const f = lift(18000);
  assert.equal(f.level, 'close');
  assert.equal(f.line, '18,000 N predicted · 18,375 N calculated · just outside the 2% target');
  assert.equal(f.headline, 'Very close');
  assert.equal(f.detail, 'just outside the 2% target · 375 N low');
  assert.equal(f.next, 'Aim a little higher next time.');
  assert.equal(f.margin, 'Within ±368 N counts as right here: 2% of the calculated value.');
});

test('three levels: within the margin, within twice it, further off', () => {
  assert.equal(feedbackLevel(18300, 18375, 367.5), 'within');
  assert.equal(feedbackLevel(18375 + 367.5, 18375, 367.5), 'within', 'exactly on the margin counts');
  assert.equal(feedbackLevel(18000, 18375, 367.5), 'close');
  assert.equal(feedbackLevel(18375 - 735, 18375, 367.5), 'close', 'exactly twice the margin is still very close');
  assert.equal(feedbackLevel(15000, 18375, 367.5), 'off');
  const within = lift(18300);
  assert.equal(within.line, '18,300 N predicted · 18,375 N calculated · within the 2% target');
  assert.equal(within.ok, true);
  assert.equal(within.label, 'Within the target');
  assert.equal(within.headline, 'Within the 2% target');
  const off = lift(15000);
  assert.equal(off.line, '15,000 N predicted · 18,375 N calculated · 3,380 N too low');
  assert.equal(off.headline, '3,380 N too low');
  assert.equal(off.detail, 'outside the 2% target');
  assert.equal(off.label, 'Off target');
  assert.equal(lift(20375).verdict, '2,000 N too high', 'too high reads the other way');
});

test('one next action per level, pointing to the next case when there is one', () => {
  const more = (guess: number) => numericFeedback({ guess, actual: 100, tolerance: 2, more: true });
  assert.equal(more(100).next, 'Try the next case.');
  assert.equal(more(103).next, 'Aim a little lower on the next case.');
  assert.equal(more(50).next, 'Move one input at a time and watch how the result changes.');
});

test('a case margin wider than 2% is named as the target, with its own numbers', () => {
  const f = numericFeedback({ guess: 10.4, actual: 10, tolerance: 0.5, unit: 'm' });
  assert.equal(f.level, 'within');
  assert.equal(f.verdict, 'within the ±0.5 m target');
  assert.match(f.margin, /this case’s own margin, which is wider than 2%/);
});

test('a hidden answer is never in the words: no calculated value, no margin numbers, direction only', () => {
  const f = numericFeedback({ guess: 1000, actual: 100000, tolerance: 2000, unit: 'times', hideActual: true });
  assert.equal(f.calculated, null);
  assert.equal(f.line, '1,000 times predicted · too low');
  assert.equal(f.margin, 'Within 2% of the calculated value counts as right.');
  for (const text of [f.line, f.headline, f.detail, f.margin, f.next]) {
    assert.doesNotMatch(text, /100,000|100000|2,000|2000/, `no answer in “${text}”`);
  }
  const near = numericFeedback({ guess: 97000, actual: 100000, tolerance: 2000, unit: 'times', hideActual: true });
  assert.equal(near.line, '97,000 times predicted · just outside the 2% target');
  assert.equal(near.detail, 'just outside the 2% target, a little low');
});

test('the engine’s own formatting is used for the calculated value; units are pretty', () => {
  const f = numericFeedback({ guess: 9.8, actual: 9.80665, tolerance: studentTolerance(9.80665, 0.01), unit: 'm/s^2', format: (n) => n.toFixed(2) });
  assert.equal(f.line, '9.8 m/s² predicted · 9.81 m/s² calculated · within the 2% target');
  const bare = numericFeedback({ guess: 9000, actual: 6250, tolerance: 125 });
  assert.equal(bare.line, '9,000 predicted · 6,250 calculated · 2,750 too high', 'no unit, no stray space');
});

test('gradeFeedback words a Grade exactly like the direct call', () => {
  const g = gradePrediction(18000, 18375, studentTolerance(18375, 0));
  assert.deepEqual(gradeFeedback(g, { unit: 'N' }), lift(18000));
});

test('learner-facing words never say “engine says” or “our code”; the source note is for the disclosure', () => {
  const all = [lift(18000), lift(18300), lift(15000)].flatMap((f) => [f.line, f.headline, f.detail, f.next, f.margin]);
  for (const t of all) assert.doesNotMatch(t, /engine|our code|computed by/i);
  assert.equal(targetRule(), 'Within 2% of the calculated value counts as right.');
  assert.match(CALCULATED_SOURCE, /code/);
});

test('a choice prediction in the same voice: predicted · outcome · why', () => {
  const miss = choiceFeedback({ predicted: 'it passes', outcome: 'it fails', why: '1 short of the 270 needed.', right: false });
  assert.equal(miss.line, 'It passes predicted · it fails · 1 short of the 270 needed');
  assert.equal(miss.level, 'off');
  assert.equal(miss.label, 'Not this time');
  const hit = choiceFeedback({ predicted: 'it fails', outcome: 'it fails', why: '1 short of the 270 needed.', right: true });
  assert.equal(hit.ok, true);
  assert.equal(hit.label, 'Right');
});

test('a ladder check: the answer stays out of the line until it is shown; wrong way and step hint in the same voice', () => {
  const base = { ratio: 100000, margin: 2000, chosen: 'less acidic', actualWay: 'less acidic', sameWay: true, factorText: '10' };
  const hidden = ladderFeedback({ ...base, guess: 1000, revealed: false });
  assert.equal(hidden.line, '1,000 times less acidic predicted · too low');
  assert.equal(hidden.next, 'Count the whole steps: each one multiplies by 10.');
  assert.doesNotMatch(`${hidden.line} ${hidden.margin} ${hidden.next}`, /100,000|2,000/);
  const right = ladderFeedback({ ...base, guess: 100000, revealed: true });
  assert.equal(right.line, '100,000 times less acidic predicted · 100,000 times less acidic calculated · within the 2% target');
  assert.equal(right.ok, true);
  const wrongWay = ladderFeedback({ ...base, guess: 100000, chosen: 'more acidic', sameWay: false, revealed: false });
  assert.equal(wrongWay.level, 'off');
  assert.equal(wrongWay.line, '100,000 times more acidic predicted · the right number, the wrong way');
  assert.equal(wrongWay.next, 'Check the direction: this case is less acidic.');
});
