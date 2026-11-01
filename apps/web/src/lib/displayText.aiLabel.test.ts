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

// Demo pair review #14: the other stock openers Muse uses on key points go the same way as "Students learn".
test('aiLabel drops the other stock openers (explain/describe/show/understand/see/discover/find out + that / how)', () => {
  assert.equal(aiLabel('Students explain that water vapour condenses into clouds.'), 'Water vapour condenses into clouds.');
  assert.equal(aiLabel('Students describe how a bill becomes law.'), 'How a bill becomes law.');
  assert.equal(aiLabel('Students show that the bars level at 6, 6, 1, 6.'), 'The bars level at 6, 6, 1, 6.');
  assert.equal(aiLabel('Students understand that DNA is a double helix.'), 'DNA is a double helix.');
  assert.equal(aiLabel('Students see that pH 7 is neutral.'), 'pH 7 is neutral.');
  assert.equal(aiLabel('Students discover that a candidate needs 270 electors.'), 'A candidate needs 270 electors.');
  assert.equal(aiLabel('Students find out how the Sun drives the cycle.'), 'How the Sun drives the cycle.');
  assert.equal(aiLabel('students  will   explain that   evaporation needs heat'), 'Evaporation needs heat');
  assert.equal(aiLabel('Students can describe that mRNA carries the code.'), 'mRNA carries the code.');
});

test('aiLabel leaves the other openers alone when they are not an opener to strip', () => {
  for (const s of [
    'Students explain', 'Students explain.', 'Students explain that', 'Students explain that.', 'Students describe how',
    'Students describe the water cycle.', 'Students show their work.', 'Students see the figure.', 'Students find out',
    'Students explained that rocks erode.', 'Students showed how ice melts.', 'What students describe that day',
    'Students understanding that matters', 'Students find that rocks erode.',
  ]) {
    assert.equal(aiLabel(s), s, s);
  }
});

test('aiText (sentences such as objectives) is not changed by the opener rule', () => {
  assert.equal(aiText('Students explain that water evaporates.'), 'Students explain that water evaporates.');
  assert.equal(aiText('Students learn that water evaporates.'), 'Students learn that water evaporates.');
});

// Measured over every stored run (2026-11-01): after "learn that" (2,214) the openers left were "learn the/a/an …" (204),
// "learn how/why/which …", "learn to …" (44), "learn <clause>" ("Students learn DNA is …") and "state / recognize /
// apply / trace / explore that|how …". They go the same way. Openers naming a classroom activity ("Students compare …",
// "Students examine …") stay: they say what the class does, not boilerplate.
test('aiLabel drops the remaining stock openers measured across stored runs', () => {
  assert.equal(aiLabel('Students learn the convention convened in Philadelphia to revise the Articles.'), 'The convention convened in Philadelphia to revise the Articles.');
  assert.equal(aiLabel('Students learn a good rule to save 10 percent of earnings.'), 'A good rule to save 10 percent of earnings.');
  assert.equal(aiLabel('Students learn DNA is the hereditary material in humans.'), 'DNA is the hereditary material in humans.');
  assert.equal(aiLabel('Students learn compound interest means earning interest on interest.'), 'Compound interest means earning interest on interest.');
  assert.equal(aiLabel('Students learn why midpoint calculation overflows for large values.'), 'Why midpoint calculation overflows for large values.');
  assert.equal(aiLabel('Students learn which planets have a ring system.'), 'Which planets have a ring system.');
  assert.equal(aiLabel('Students learn to calculate drag from coefficient, density, velocity and area.'), 'How to calculate drag from coefficient, density, velocity and area.');
  assert.equal(aiLabel('Students state that a proposed amendment becomes part of the Constitution.'), 'A proposed amendment becomes part of the Constitution.');
  assert.equal(aiLabel('Students recognize that scientists combined the constant with earth mass.'), 'Scientists combined the constant with earth mass.');
  assert.equal(aiLabel('Students apply that weight is mass times gravitational acceleration.'), 'Weight is mass times gravitational acceleration.');
  assert.equal(aiLabel('Students trace how the Archivist submits the amendment to the States.'), 'How the Archivist submits the amendment to the States.');
  assert.equal(aiLabel('Students explore how velocity and density change the dynamic term.'), 'How velocity and density change the dynamic term.');
  assert.equal(aiLabel('Students should explain why the bars level.'), 'Why the bars level.');
});

test('aiLabel keeps activity openers and short or odd "learn" lines as written', () => {
  for (const s of [
    'Students compare Orbital Period values for Mercury and Earth.', 'Students examine Mean Temperature extremes.',
    'Students contrast energy sources for both paths', 'Students learn about photosynthesis.', 'Students learn it.',
    'Students learn', 'Students learn to', 'Students learn why', 'Students state the rule.',
  ]) assert.equal(aiLabel(s), s, s);
});
