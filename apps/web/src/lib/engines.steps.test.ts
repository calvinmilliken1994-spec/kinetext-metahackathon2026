/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultInputs, sliderModels } from './engines.ts';
import { makeMoonSpec } from './moon-fixture.ts';
import { onStepGrid } from './sliderSteps.ts';

test('Moon lesson: the g slider steps by 0.02, so the opening g = 1.62 and the 9.8 case sit exactly on the slider', () => {
  const spec = makeMoonSpec();
  const g = sliderModels(spec).find((m) => m.key === 'gravityMps2');
  assert.ok(g);
  assert.equal(g.step, 0.02);
  assert.equal(defaultInputs(spec)['gravityMps2'], 1.62);
  assert.ok(onStepGrid(g.min, g.step, 1.62));
  assert.ok(onStepGrid(g.min, g.step, 9.8));
});

test('every Moon slider reaches every case value it covers', () => {
  const spec = makeMoonSpec();
  for (const m of sliderModels(spec)) {
    for (const p of spec.predictions) {
      const v = (p as unknown as Record<string, number>)[m.key];
      if (v === undefined || v < m.min || v > m.max) continue;
      assert.ok(onStepGrid(m.min, m.step, v), `${m.key} = ${v} on step ${m.step}`);
    }
  }
});
