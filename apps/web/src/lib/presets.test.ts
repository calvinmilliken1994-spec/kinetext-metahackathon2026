/// <reference types="node" />
// Stage 7 item 4a: preset chips for values that the lesson's cases use AND the page states as whole numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLiftSpec } from '../../../../packages/validation/fixtures/engine-specs.ts';
import { activePreset, comparisonValues, numberTokens, pagePresets, sentenceAround } from './presets.ts';
import { makeMoonSpec, MOON_SOURCE_TEXT } from './moon-fixture.ts';

const MOON_SENTENCE = 'On the Moon g is about 1.62 m/s^2, roughly one sixth of the 9.8 m/s^2 we feel on Earth.';

test('Moon lesson: gravity chips are exactly the page-stated case values, labelled value + unit, titled with the page sentence', () => {
  const presets = pagePresets(makeMoonSpec(), 'gravityMps2', MOON_SOURCE_TEXT);
  assert.deepEqual(presets, [
    { value: 1.62, label: '1.62 m/s²', sentence: MOON_SENTENCE },
    { value: 9.8, label: '9.8 m/s²', sentence: MOON_SENTENCE },
  ]);
});

test('launch speeds in the Moon cases are not stated on the page, so they get no chips', () => {
  assert.deepEqual(pagePresets(makeMoonSpec(), 'horizontalSpeedMps', MOON_SOURCE_TEXT), []);
  assert.deepEqual(pagePresets(makeMoonSpec(), 'verticalSpeedMps', MOON_SOURCE_TEXT), []);
});

test('a value only in the cases (not on the page) or only on the page (not in the cases) is not a chip', () => {
  const spec = makeMoonSpec();
  assert.deepEqual(pagePresets(spec, 'gravityMps2', 'On the Moon g is about 1.62 m/s^2.').map((p) => p.value), [1.62]);
  assert.deepEqual(pagePresets(spec, 'gravityMps2', 'Mars has g = 3.71 m/s^2 and Earth 9.8 m/s^2.').map((p) => p.value), [9.8]);
});

test('whole numeric tokens only: no match inside 19.8, 9.81, V0, t^2 or 1.625', () => {
  const spec = makeMoonSpec();
  assert.deepEqual(pagePresets(spec, 'gravityMps2', 'Values 19.8 and 9.81 and 1.625 and x^9.8 appear.'), []);
  assert.deepEqual(numberTokens('U0 = 20, t^2 / 2, -3.5 and 1,000.50 or 5-3').map((t) => t.value), [20, 2, -3.5, 1000.5, 5, 3]);
});

test('a page value outside the slider range is not offered (clicking it would set a different number)', () => {
  const spec = makeMoonSpec();
  spec.simulation.gravityMps2 = { ...spec.simulation.gravityMps2, min: 2 };
  assert.deepEqual(pagePresets(spec, 'gravityMps2', MOON_SOURCE_TEXT).map((p) => p.value), [9.8]);
});

test('no page text, unknown input, or a spec with no cases → no chips', () => {
  assert.deepEqual(pagePresets(makeMoonSpec(), 'gravityMps2', null), []);
  assert.deepEqual(pagePresets(makeMoonSpec(), 'warpFactor', MOON_SOURCE_TEXT), []);
  const empty = makeMoonSpec();
  empty.predictions = [];
  empty.behavioralTests = [];
  assert.deepEqual(pagePresets(empty, 'gravityMps2', MOON_SOURCE_TEXT), []);
  assert.deepEqual(pagePresets(makeLiftSpec(), 'liftCoefficient', ''), []);
});

test('sentenceAround keeps decimals inside the sentence and stops at line breaks', () => {
  const text = 'Title line\nFirst sentence. On the Moon g is 1.62 m/s^2 here. Next one.';
  const i = text.indexOf('1.62');
  assert.equal(sentenceAround(text, i, i + 4), 'On the Moon g is 1.62 m/s^2 here.');
  const t2 = 'Heading 9.8\nBody.';
  assert.equal(sentenceAround(t2, 8, 11), 'Heading 9.8');
});

test('comparison ghosts: the other page values; none when the page states fewer than two', () => {
  const presets = pagePresets(makeMoonSpec(), 'gravityMps2', MOON_SOURCE_TEXT);
  assert.deepEqual(comparisonValues(presets, 1.62), [9.8]);
  assert.deepEqual(comparisonValues(presets, 9.8), [1.62]);
  assert.deepEqual(comparisonValues(presets, 5), [1.62, 9.8]);
  assert.deepEqual(comparisonValues(presets.slice(0, 1), 5), []);
  assert.equal(activePreset(presets, 1.62)?.label, '1.62 m/s²');
  assert.equal(activePreset(presets, 1.63), null);
});
