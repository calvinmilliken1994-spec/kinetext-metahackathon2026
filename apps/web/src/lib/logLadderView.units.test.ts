/// <reference types="node" />
// UX pair review #6: the pH ladder said "each step is ×10" beside ticks two units apart labelled ×100. One unit wording now:
// "Each pH unit is ×10", and a 0–14 scale marks every whole unit, so its gaps read ×10 too.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import { gapText, ladderAxis, unitRule, unitsText, unitWords } from './logLadderView.ts';

const ph = { quantity: 'pH', factor: 10 } as Pick<LogLadderSpec, 'quantity' | 'factor'>;

test('unit wording names the quantity: "Each pH unit is ×10."', () => {
  assert.deepEqual(unitWords(ph), { one: 'pH unit', many: 'pH units' });
  assert.equal(unitRule(ph), 'Each pH unit is ×10.');
  assert.equal(unitRule({ quantity: 'magnitude', factor: 10 }), 'Each magnitude unit is ×10.');
  assert.equal(unitsText(5, ph), '5 pH units');
  assert.equal(unitsText(1, ph), '1 pH unit');
  assert.equal(unitsText(1.4, ph), '1.4 pH units');
});

test('a long quantity name falls back to "step"', () => {
  const long = { quantity: 'sound intensity level in decibels', factor: 10 };
  assert.deepEqual(unitWords(long), { one: 'step', many: 'steps' });
  assert.equal(unitRule(long), 'Each step on the scale is ×10.');
  assert.equal(unitsText(2, long), '2 steps');
});

test('the pH scale 0–14 marks every whole unit, so each gap reads ×10', () => {
  const ax = ladderAxis({ rungs: [{ value: 0 }, { value: 14 }, { value: 7 }], cases: [{ fromValue: 2, toValue: 7 }] } as unknown as LogLadderSpec);
  assert.equal(ax.stride, 1);
  assert.deepEqual(ax.ticks, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const gaps = ax.ticks.slice(1).map((v, i) => gapText(10, ax.ticks[i] as number, v));
  assert.ok(gaps.every((g) => g === '×10'), gaps.join(','));
});
