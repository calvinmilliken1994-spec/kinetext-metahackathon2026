/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { readableNumber, sliderEndLabel } from './format.ts';

test('readable numbers keep three decimals for ordinary values and never round a small value to zero', () => {
  assert.equal(readableNumber(9.8), '9.8');
  assert.equal(readableNumber(100), '100');
  assert.equal(readableNumber(2.34567), '2.346');
  assert.equal(readableNumber(0.00356), '0.00356');
  assert.equal(readableNumber(0.00164), '0.00164');
  assert.equal(readableNumber(0), '0');
  assert.equal(readableNumber(-0), '0');
  assert.equal(readableNumber(-0.0125), '-0.0125');
  assert.equal(readableNumber(0.00000001234), '0.00000001');
  assert.equal(readableNumber(Number.NaN), 'NaN');
});

test('slider end labels carry a short unit and drop a long one so the label cannot wrap under the slider', () => {
  assert.equal(sliderEndLabel(0.5, 'kg'), '0.5 kg');
  assert.equal(sliderEndLabel(-50, 'N'), '-50 N');
  assert.equal(sliderEndLabel(1, 'kilograms'), '1');
  assert.equal(sliderEndLabel(20, 'meters per square second'), '20');
  assert.equal(sliderEndLabel(0.00164, 'degrees per foot'), '0.00164');
  assert.equal(sliderEndLabel(3, ''), '3');
});
