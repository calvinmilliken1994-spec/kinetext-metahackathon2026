/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { caseFriendlyStep, onStepGrid } from './sliderSteps.ts';
import { sliderStep } from './track.ts';

test('onStepGrid: a value is reachable when (value − min) is a whole number of steps (float noise allowed)', () => {
  assert.equal(onStepGrid(1.6, 0.2, 1.6), true);
  assert.equal(onStepGrid(1.6, 0.2, 9.8), true);
  assert.equal(onStepGrid(1.6, 0.2, 1.62), false);
  assert.equal(onStepGrid(1.6, 0.02, 1.62), true);
  assert.equal(onStepGrid(0, 0.1, 0.3), true);
});

test('the Moon slider (g 1.6–24.8, base step 0.2) gets a step that lands on 1.62 and 9.8', () => {
  const base = sliderStep(1.6, 24.8);
  assert.equal(base, 0.2);
  const step = caseFriendlyStep(1.6, 24.8, base, [1.62, 9.8, 1.62]);
  assert.equal(step, 0.02);
  assert.ok(onStepGrid(1.6, step, 1.62) && onStepGrid(1.6, step, 9.8));
});

test('the base step is kept when it already hits every case value', () => {
  assert.equal(caseFriendlyStep(5, 30, 0.2, [15, 12, 5.4]), 0.2);
  assert.equal(caseFriendlyStep(0, 100, 1, []), 1);
});

test('values outside the slider are ignored; the opening (first) value wins when no step fits them all', () => {
  // 1.62 needs 0.02; 3.14159 would need a step far finer than range/10000, so only the opening value is honoured.
  assert.equal(caseFriendlyStep(1.6, 24.8, 0.2, [1.62, 3.14159, 99]), 0.02);
  // The opening value itself is unreachable on any decimal grid within the limit: the base step stays.
  assert.equal(caseFriendlyStep(0, 10, 0.1, [Math.PI]), 0.1);
});

test('a non-decimal base (the explorer’s range/100) falls back to a decimal grid that hits the case', () => {
  const base = (24.8 - 1.6) / 100; // 0.232
  const step = caseFriendlyStep(1.6, 24.8, base, [1.62]);
  assert.equal(step, 0.02);
  // …and keeps the base when it already hits.
  assert.equal(caseFriendlyStep(0, 10, 0.1, [0.3]), 0.1);
});
