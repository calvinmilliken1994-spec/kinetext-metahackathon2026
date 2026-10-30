/// <reference types="node" />
// Stage 7e: slider names read as a teacher writes them — symbols typeset (U₀, V₀, ρ, γ, N₀), never the code-like 'U0'/'V0'
// or 'rho'/'gamma' of the engine catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliderModels, teacherInputLabel } from './engines.ts';
import { makeMoonSpec } from './moon-fixture.ts';

test('the Moon projectile sliders are named with typeset symbols', () => {
  assert.deepEqual(sliderModels(makeMoonSpec()).map((m) => m.label), [
    'Initial horizontal speed U₀', 'Initial vertical speed V₀', 'Gravitational acceleration g',
  ]);
});

test('teacherInputLabel typesets the catalogue symbols and leaves words alone', () => {
  assert.equal(teacherInputLabel('Air density rho'), 'Air density ρ');
  assert.equal(teacherInputLabel('Ratio of specific heats gamma'), 'Ratio of specific heats γ');
  assert.equal(teacherInputLabel('Starting amount N0 (any unit: grams, atoms or percent)'), 'Starting amount N₀ (any unit: grams, atoms or percent)');
  assert.equal(teacherInputLabel('Lift coefficient Cl'), 'Lift coefficient Cl');
  assert.equal(teacherInputLabel('Velocity V'), 'Velocity V');
  assert.equal(teacherInputLabel('Time t'), 'Time t');
});
