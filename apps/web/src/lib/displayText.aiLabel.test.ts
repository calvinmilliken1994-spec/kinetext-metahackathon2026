/// <reference types="node" />
// aiLabel: AI-written labels, terms, options and table cells in sentence case, with display maths (presentation pass 3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiLabel, aiText, capitalFirst } from './displayText.ts';

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

// UX pair review: "Students learn that …" opened almost every AI key point (the most machine-written voice on screen).
test('aiLabel drops a leading "Students learn that / how" and capitalises what follows', () => {
  assert.equal(aiLabel('Students learn that horizontal speed stays U0 during flight.'), 'Horizontal speed stays U₀ during flight.');
  assert.equal(aiLabel('Students learn how a bill becomes law.'), 'How a bill becomes law.');
  assert.equal(aiLabel('students learn that water evaporates'), 'Water evaporates');
  assert.equal(aiLabel('Students will learn that the Sun drives the cycle.'), 'The Sun drives the cycle.');
  assert.equal(aiLabel('Students learn that a candidate needs 270 electors.'), 'A candidate needs 270 electors.');
  assert.equal(aiLabel('Students learn  that   evaporation needs heat.'), 'Evaporation needs heat.');
});

test('aiLabel keeps symbols and inner capitals after the opener', () => {
  assert.equal(aiLabel('Students learn that pH 7 is neutral.'), 'pH 7 is neutral.');
  assert.equal(aiLabel('Students learn that mRNA carries the code.'), 'mRNA carries the code.');
  assert.equal(aiLabel('Students learn that DNA is a double helix.'), 'DNA is a double helix.');
  assert.equal(aiLabel('Students learn that ymax = V0^2 / (2*g).'), 'ymax = V₀² / (2·g).');
});

test('aiLabel leaves "Students learn" alone when it is not an opener to strip', () => {
  for (const s of ['Students learn', 'Students learn.', 'Students learn that', 'Students learn that.', 'Students learn about photosynthesis.', 'What students learn that day', 'Students learnt that rocks erode.']) {
    assert.equal(aiLabel(s), s, s);
  }
});

test('aiText (sentences such as objectives) is not changed by the opener rule', () => {
  assert.equal(aiText('Students learn that water evaporates.'), 'Students learn that water evaporates.');
});
