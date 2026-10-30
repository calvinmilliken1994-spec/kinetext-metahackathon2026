/// <reference types="node" />
// aiLabel: AI-written labels, terms, options and table cells in sentence case, with display maths (presentation pass 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiLabel, capitalFirst } from './displayText.ts';

test('aiLabel: sentence case for model-written words', () => {
  assert.equal(aiLabel('drag'), 'Drag');
  assert.equal(aiLabel('horizontal speed'), 'Horizontal speed');
  assert.equal(aiLabel('highest position reached when upward motion stops'), 'Highest position reached when upward motion stops');
  assert.equal(aiLabel('energy from the sun'), 'Energy from the sun');
  assert.equal(aiLabel('flow velocity (m/s)'), 'Flow velocity (m/s)');
  assert.equal(aiLabel('how much power to allow the central government'), 'How much power to allow the central government');
});

test('aiLabel: display maths as aiText does it', () => {
  assert.equal(aiLabel('stays U0 for the whole flight'), 'Stays U₀ for the whole flight');
  assert.equal(aiLabel('1.62 m/s^2'), '1.62 m/s²');
  assert.equal(aiLabel('kg per m^3'), 'kg per m³');
});

test('aiLabel / capitalFirst: symbols, units and mixed-case words keep their case', () => {
  for (const s of ['ymax', 'ymax = V₀² / (2·g)', 'vmax is the top speed', 'xmin', 'pH', 'mRNA strand', 'kg', 'rpm of the rotor', 'x', 'g on the Moon']) {
    assert.equal(aiLabel(s), s, s);
  }
  assert.equal(capitalFirst('ymax'), 'ymax');
  assert.equal(capitalFirst('maximum height'), 'Maximum height', 'ordinary words that start like a symbol still change');
  assert.equal(capitalFirst('yesterday'), 'Yesterday');
});

test('aiLabel leaves empty text empty', () => {
  assert.equal(aiLabel(''), '');
  assert.equal(aiLabel('   '), '   ');
});
