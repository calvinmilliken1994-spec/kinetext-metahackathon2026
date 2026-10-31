/// <reference types="node" />
// Set A item 6 (W2-05): a gravity chip is "page-stated" only when the page writes the value AS an acceleration: the number
// followed by an m/s² form. A duration, a mass or a bare number that happens to equal a case value is never a chip and
// never a "value the page states" comparison arc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { comparisonValues, pagePresets, unitFollows } from './presets.ts';
import { makeMoonSpec, MOON_SOURCE_TEXT } from './moon-fixture.ts';

const g = (text: string): number[] => pagePresets(makeMoonSpec(), 'gravityMps2', text).map((p) => p.value);

test('W2-05 probe: a duration of 9.8 seconds is not a 9.8 m/s² preset, and draws no comparison arc', () => {
  const text = 'The Moon has gravity 1.62 metres per second squared. The experiment lasts 9.8 seconds.';
  const presets = pagePresets(makeMoonSpec(), 'gravityMps2', text);
  assert.deepEqual(presets.map((p) => p.value), [1.62]);
  assert.equal(presets[0]?.label, '1.62 m/s²');
  assert.deepEqual(comparisonValues(presets, 1.62), []);
});

test('accepted m/s² forms: symbol, caret, superscript, negative exponent, per second squared, per second per second', () => {
  for (const form of ['m/s^2', 'm/s²', 'm/s2', 'm s^-2', 'm s⁻²', 'm·s⁻²', 'm⋅s^-2', 'ms^-2', 'm/sec^2', 'm/sec²', 'metres per second squared', 'meters per second squared', 'meter per second squared', 'metres per second per second', 'm per second squared']) {
    assert.deepEqual(g(`On the Moon g is 1.62 ${form}.`), [1.62], form);
    assert.deepEqual(g(`On the Moon g is 1.62${form.startsWith('m') && !form.startsWith('me') ? '' : ' '}${form}.`), [1.62], `glued ${form}`);
  }
});

test('the unit must follow the number directly: other units or words in between do not count', () => {
  assert.deepEqual(g('It falls 1.62 m in the first second.'), []);
  assert.deepEqual(g('It moves at 1.62 m/s at first.'), []);
  assert.deepEqual(g('A 9.8 kg mass and 1.62 seconds.'), []);
  assert.deepEqual(g('9.8 is a number; gravity is measured in m/s^2.'), []);
  assert.deepEqual(g('1.62 mm/s^2 is tiny.'), []);
  assert.deepEqual(g('1.62 m/s^3 is a jerk.'), []);
  assert.deepEqual(g('1.62 m/s^20 is not a unit.'), []);
});

test('the first page token with the unit wins; an earlier bare token of the same value is skipped', () => {
  const text = 'Wait 9.8 seconds. Earth pulls with 9.8 m/s^2.';
  const presets = pagePresets(makeMoonSpec(), 'gravityMps2', text);
  assert.deepEqual(presets.map((p) => p.value), [9.8]);
  assert.equal(presets[0]?.sentence, 'Earth pulls with 9.8 m/s^2.');
});

test('the Moon fixture still yields both page-stated gravities', () => {
  assert.deepEqual(g(MOON_SOURCE_TEXT), [1.62, 9.8]);
});

test('a slider whose unit we cannot bind on the page gets no chips (never number-only matching)', () => {
  // The launch speeds are in m/s; the Moon page states none of the case speeds, and a bare "20" never counts.
  assert.deepEqual(pagePresets(makeMoonSpec(), 'horizontalSpeedMps', 'Throw it at 20 and then 10.'), []);
  assert.deepEqual(pagePresets(makeMoonSpec(), 'horizontalSpeedMps', 'Throw it at 20 m/s and then 10 m/s.').map((p) => p.value), [20, 10]);
});

test('unitFollows reads the text right after a number', () => {
  assert.equal(unitFollows(' m/s^2.', 'm/s^2'), true);
  assert.equal(unitFollows(' seconds', 'm/s^2'), false);
  assert.equal(unitFollows(' m/s.', 'm/s'), true);
  assert.equal(unitFollows(' m/s^2', 'm/s'), false);
  assert.equal(unitFollows(' metres per second', 'm/s'), true);
  assert.equal(unitFollows(' metres per second squared', 'm/s'), false);
  assert.equal(unitFollows(' kg', 'furlongs'), false);
});
