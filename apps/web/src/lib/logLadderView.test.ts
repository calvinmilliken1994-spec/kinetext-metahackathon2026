/// <reference types="node" />
// Stage 8a slice W-A: the log ladder's view model. Ratios come from our engine (ladderRatio, ladderDirection).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import {
  gradeLadder, ladderAxis, ladderCases, ladderWording, logLadderPresentationSteps, ratioText, spreadLabels, valueText,
} from './logLadderView.ts';

function mk(over: Partial<LogLadderSpec>): LogLadderSpec {
  return {
    schemaVersion: '0.6.0', id: 'l', componentId: 'log-ladder-v1', title: 't', sources: [], seed: 1,
    execution: { mode: 'deterministic-component', network: 'none', timeLimitMs: 1000 },
    provenance: {} as LogLadderSpec['provenance'],
    quantity: 'pH', factor: 10, factorText: '10-fold', effectPhrase: 'more acidic', increasing: false, sourceId: 's', quote: 'q',
    rungs: [
      { id: 'r1', label: 'neutral', value: 7, sourceId: 's', quote: 'q7' },
      { id: 'r2', label: 'normal rainfall', value: 5.6, sourceId: 's', quote: 'q56' },
      { id: 'r3', label: 'coal mine water', value: 2, sourceId: 's', quote: 'q2' },
    ],
    cases: [{ id: 'c1', fromValue: 7, toValue: 2 }, { id: 'c2', fromValue: 7, toValue: 5.6 }, { id: 'c3', fromValue: 2, toValue: 7 }],
    ...over,
  } as unknown as LogLadderSpec;
}

test('a whole-step case multiplies by the factor once per step: 10 → 100 → … → 100,000', () => {
  const [c] = ladderCases(mk({}));
  assert.ok(c !== undefined);
  assert.equal(c.ratio, 100000);
  assert.equal(c.direction, 'more');
  assert.deepEqual(c.steps.map((s) => [s.from, s.to, s.partial]), [[7, 6, false], [6, 5, false], [5, 4, false], [4, 3, false], [3, 2, false]]);
  assert.deepEqual(c.steps.map((s) => ratioText(s.cumulative)), ['10', '100', '1,000', '10,000', '100,000']);
  assert.equal(c.exponent, 5);
  assert.equal(c.answerText, '100,000 times more acidic');
});

test('a fractional case ends with a part step, and the ratio keeps three significant figures', () => {
  const c = ladderCases(mk({}))[1]!;
  assert.deepEqual(c.steps.map((s) => [s.from, s.to, s.partial]), [[7, 6, false], [6, 5.6, true]]);
  assert.equal(ratioText(c.ratio), '25.1');
  assert.equal(ratioText(c.steps[1]!.stepRatio), '2.51');
  assert.equal(c.exponent, 1.4);
  assert.equal(c.answerText, '25.1 times more acidic');
});

test('direction words come from the effect phrase and the scale direction', () => {
  const up = ladderCases(mk({}))[2]!;
  assert.equal(up.direction, 'less');
  assert.equal(up.answerText, '100,000 times less acidic');
  const ph = ladderWording(mk({}));
  assert.equal(ph.question, 'How many times more or less acidic?');
  assert.deepEqual(ph.dir, { more: 'more acidic', less: 'less acidic' });
  const quake = mk({ quantity: 'magnitude', effectPhrase: 'increase in measured amplitude', increasing: true, factorText: 'tenfold', cases: [{ id: 'c1', fromValue: 5.3, toValue: 6.3 }] });
  const w = ladderWording(quake);
  assert.equal(w.question, 'How many times larger or smaller is the measured amplitude?');
  assert.deepEqual(w.dir, { more: 'larger', less: 'smaller' });
  const [q] = ladderCases(quake);
  assert.equal(q?.ratio, 10);
  assert.equal(q?.steps.length, 1);
  assert.equal(q?.answerText, '10 times larger');
  const energy = ladderWording(mk({ effectPhrase: 'energy release', increasing: true }));
  assert.equal(energy.question, 'How many times more or less energy release?');
  assert.deepEqual(energy.dir, { more: 'more energy release', less: 'less energy release' });
});

test('grading uses the teaching margin (2% of the engine value) and the direction', () => {
  const [c, frac] = ladderCases(mk({}));
  assert.equal(gradeLadder(c!, 100000, 'more').status, 'right');
  assert.equal(gradeLadder(c!, 101000, 'more').status, 'right');
  assert.equal(gradeLadder(c!, 103000, 'more').status, 'off');
  assert.equal(gradeLadder(c!, 100000, 'less').status, 'wrong-way');
  assert.equal(gradeLadder(c!, Number.NaN, 'more').status, 'invalid');
  assert.equal(gradeLadder(c!, 50, 'more').status, 'off');
  assert.equal(gradeLadder(frac!, 25, 'more').status, 'right');
  assert.equal(gradeLadder(frac!, 24, 'more').status, 'off');
  assert.equal(ratioText(gradeLadder(c!, 1, 'more').margin), '2,000');
});

test('the axis spans whole steps around every rung and case; higher values sit higher', () => {
  const ax = ladderAxis(mk({}));
  assert.deepEqual([ax.min, ax.max], [2, 7]);
  assert.deepEqual(ax.ticks, [2, 3, 4, 5, 6, 7]);
  assert.equal(ax.y(7), 0);
  assert.equal(ax.y(2), 100);
  const quake = ladderAxis(mk({ rungs: [{ id: 'a', label: 'a', value: 5.3, sourceId: 's', quote: 'q' }, { id: 'b', label: 'b', value: 6.3, sourceId: 's', quote: 'q' }], cases: [{ id: 'c', fromValue: 5.3, toValue: 6.3 }] }));
  assert.deepEqual(quake.ticks, [5, 6, 7]);
});

test('rung labels that would overlap are spread apart, in order, inside the ladder', () => {
  assert.deepEqual(spreadLabels([10, 50, 90], 8, 0, 100), [10, 50, 90]);
  const s = spreadLabels([50, 51, 52], 8, 0, 100);
  assert.ok(s[1]! - s[0]! >= 8 - 1e-9 && s[2]! - s[1]! >= 8 - 1e-9);
  const edge = spreadLabels([99, 100], 8, 0, 100);
  assert.ok(edge[1]! <= 100 && edge[1]! - edge[0]! >= 8 - 1e-9);
});

test('values and ratios read as a person writes them', () => {
  assert.equal(valueText(5.6), '5.6');
  assert.equal(valueText(7), '7');
  assert.equal(ratioText(1e12), '1,000,000,000,000');
  assert.equal(ratioText(3981.0717), '3,980');
  assert.equal(ratioText(31.622776), '31.6');
});

test('presentation steps: one per case', () => {
  assert.equal(logLadderPresentationSteps(mk({})), 3);
  assert.equal(logLadderPresentationSteps(mk({ cases: [{ id: 'c', fromValue: 7, toValue: 2 }] })), 1);
});
