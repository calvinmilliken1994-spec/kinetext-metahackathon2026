/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWithUnit, predictionExplanation, prettyUnit, unitForValue } from './engines.ts';
import { makeHalfLifeSpec } from './engine-fixtures.ts';

// Polish fix: the UI showed "1 time units". The generic 'time' unit is the only unit word with a
// singular form ('time unit'); every other unit word stays exactly as the catalogue spells it.

test('unitForValue: "time units" is singular for exactly 1, untouched otherwise', () => {
  assert.equal(unitForValue('time units', 1), 'time unit');
  assert.equal(unitForValue('time units', 2), 'time units');
  assert.equal(unitForValue('time units', 0.5), 'time units');
  assert.equal(unitForValue('time units', 0), 'time units');
  assert.equal(unitForValue('time units', 1.0001), 'time units');
  assert.equal(unitForValue('time units', Number.NaN), 'time units');
  for (const unit of ['m/s', 'N', 'USD', 'per year', 'years', '%', 'J/(kg·K)', '']) {
    assert.equal(unitForValue(unit, 1), unit, `unit word "${unit}" must not be pluralised or singularised`);
  }
});

test('formatWithUnit: a value with its unit — "1 time unit", "2 time units", "0.5 time units"', () => {
  assert.equal(formatWithUnit(1, 'time units'), '1 time unit');
  assert.equal(formatWithUnit(2, 'time units'), '2 time units');
  assert.equal(formatWithUnit(0.5, 'time units'), '0.5 time units');
  assert.equal(formatWithUnit(8, 'time units'), '8 time units');
  // The caller's own number formatting is kept (half-life reads to 3 decimals in the view).
  assert.equal(formatWithUnit(1, 'time units', (n) => n.toFixed(2)), '1.00 time unit');
  assert.equal(formatWithUnit(2, 'time units', (n) => n.toFixed(2)), '2.00 time units');
});

test('formatWithUnit: no other unit word changes, dimensionless adds no space', () => {
  assert.equal(formatWithUnit(1, 'm/s'), '1 m/s');
  assert.equal(formatWithUnit(1, 'USD'), '1 USD');
  assert.equal(formatWithUnit(1, 'per year'), '1 per year');
  assert.equal(formatWithUnit(1, 'N'), '1 N');
  assert.equal(formatWithUnit(1, ''), '1');
  assert.equal(formatWithUnit(2, ''), '2');
  assert.equal(formatWithUnit(12250, 'm'), '12,250 m');
});

test('prettyUnit still maps the generic time unit to the plural label (the helper singularises per value)', () => {
  assert.equal(prettyUnit('time'), 'time units');
});

test('predictionExplanation: a half-life of exactly 1 reads "1 time unit", never "1 time units"', () => {
  const one = { ...makeHalfLifeSpec().predictions[0]!, halfLife: 1 };
  const text = predictionExplanation('half-life-v1', one, 25);
  assert.ok(text.includes('Half-life T = 1 time unit,'), text);
  assert.ok(!text.includes('1 time units'), text);
  // The elapsed time is still plural, and the rest of the sentence is unchanged.
  assert.ok(text.includes('Elapsed time t = 30 time units'), text);

  const two = { ...makeHalfLifeSpec().predictions[0]!, halfLife: 2 };
  assert.ok(predictionExplanation('half-life-v1', two, 25).includes('Half-life T = 2 time units'));
});