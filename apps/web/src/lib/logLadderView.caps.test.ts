/// <reference types="node" />
// Set A (W-03): a valid ladder never allocates work in proportion to its values: a fixed tick budget with a stride,
// capped case steps, and a guard for values past the safe-integer range.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import { ladderAxis, ladderCases, ladderSteps, MAX_CASE_STEPS, MAX_TICKS, niceStride } from './logLadderView.ts';

const rung = (id: string, value: number) => ({ id, label: id, value, sourceId: 's', quote: 'q' });
const mk = (rungs: number[], cases: [number, number][]): Pick<LogLadderSpec, 'rungs' | 'cases'> => ({
  rungs: rungs.map((v, i) => rung(`r${i}`, v)), cases: cases.map(([a, b], i) => ({ id: `c${i}`, fromValue: a, toValue: b })),
});

test('a wide span gets at most MAX_TICKS + 1 marks with a round stride, ends included', () => {
  const ax = ladderAxis(mk([0, 1, 1_000_000], [[0, 1]]));
  assert.ok(ax.ticks.length <= MAX_TICKS + 2, `${ax.ticks.length} ticks`);
  assert.equal(ax.ticks[0], 0);
  assert.equal(ax.ticks[ax.ticks.length - 1], 1_000_000);
  assert.equal(ax.stride, 100_000);
  for (let i = 1; i < ax.ticks.length; i++) assert.ok((ax.ticks[i] ?? 0) > (ax.ticks[i - 1] ?? 0));
});

test('a normal ladder keeps one mark per whole step', () => {
  const ax = ladderAxis(mk([2, 7], [[7, 2]]));
  assert.deepEqual(ax.ticks, [2, 3, 4, 5, 6, 7]);
  assert.equal(ax.stride, 1);
});

test('values past the safe-integer range finish at once with two marks', () => {
  const ax = ladderAxis(mk([0, 1e300], [[0, 1]]));
  assert.deepEqual(ax.ticks, [0, 1e300]);
  const big = ladderAxis(mk([2 ** 60, 2 ** 60 + 4096], [[2 ** 60, 2 ** 60 + 4096]]));
  assert.ok(big.ticks.length <= MAX_TICKS + 2);
  const bad = ladderAxis(mk([Number.NaN, 3], [[3, 4]]));
  assert.deepEqual([bad.min, bad.max], [3, 4]);
});

test('a long case groups its whole steps; the multiplier still ends at the engine ratio', () => {
  const steps = ladderSteps(10, 0, 1_000_000);
  assert.ok(steps.length <= MAX_CASE_STEPS + 1, `${steps.length} steps`);
  assert.equal(steps[steps.length - 1]?.to, 1_000_000);
  const small = ladderSteps(10, 7, 2);
  assert.equal(small.length, 5);
  assert.equal(small[4]?.cumulative, 100000);
  const part = ladderSteps(2, 0, 40.5);
  assert.ok(part.length <= MAX_CASE_STEPS + 1);
  assert.equal(part[part.length - 1]?.to, 40.5);
  assert.equal(part[part.length - 1]?.partial, true);
  assert.deepEqual(ladderSteps(10, 0, Number.POSITIVE_INFINITY), []);
  assert.ok(ladderSteps(10, 0, 1e300).length <= MAX_CASE_STEPS + 1);
});

test('a small factor over a huge span stays bounded and does not hang', () => {
  const spec = { ...mk([0, 5e8], [[0, 5e8]]), factor: 1.0001, increasing: true, effectPhrase: 'larger', quantity: 'x' } as unknown as LogLadderSpec;
  const t0 = Date.now();
  const [c] = ladderCases(spec);
  assert.ok(c !== undefined && c.steps.length <= MAX_CASE_STEPS + 1);
  assert.ok(Date.now() - t0 < 500);
});

test('niceStride picks 1, 2, 5 × a power of ten', () => {
  assert.equal(niceStride(0.4), 1);
  assert.equal(niceStride(1.5), 2);
  assert.equal(niceStride(3), 5);
  assert.equal(niceStride(7), 10);
  assert.equal(niceStride(83333.3), 100000);
});
