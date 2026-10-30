/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { amountText, groupThousands, prettyExponents } from './displayText.ts';

test('prettyExponents: caret powers in AI-written text become superscripts', () => {
  assert.equal(prettyExponents('g is about 1.62 m/s^2, using horizontal speed 10 m/s'), 'g is about 1.62 m/s², using horizontal speed 10 m/s');
  assert.equal(prettyExponents('y_max = V0^2 / (2 g)'), 'y_max = V0² / (2 g)');
  assert.equal(prettyExponents('density in kg/m^3'), 'density in kg/m³');
  assert.equal(prettyExponents('a rate of 3 s^-1'), 'a rate of 3 s⁻¹');
  assert.equal(prettyExponents('m s^(-2)'), 'm s⁻²');
  assert.equal(prettyExponents('about 10^24 kg'), 'about 10²⁴ kg');
  assert.equal(prettyExponents('V0^2 and m/s^2'), 'V0² and m/s²', 'every power in the text');
});

test('prettyExponents leaves everything else alone', () => {
  assert.equal(prettyExponents('Predict the maximum height.'), 'Predict the maximum height.');
  assert.equal(prettyExponents('x^n grows'), 'x^n grows', 'a letter power is not a number: kept as written');
  assert.equal(prettyExponents('a ^ 2'), 'a ^ 2', 'a spaced caret is not a power');
  assert.equal(prettyExponents('already m/s²'), 'already m/s²');
  assert.equal(prettyExponents(''), '');
});

test('groupThousands groups the integer part of a plain decimal only', () => {
  assert.equal(groupThousands('1040000'), '1,040,000');
  assert.equal(groupThousands('-25000.5'), '-25,000.5');
  assert.equal(groupThousands('−25000'), '−25,000', 'the typographic minus too');
  assert.equal(groupThousands('6250'), '6,250');
  assert.equal(groupThousands('999'), '999');
  assert.equal(groupThousands('0.000123'), '0.000123');
  assert.equal(groupThousands('1e+21'), '1e+21', 'exponent form untouched');
  assert.equal(groupThousands('not defined'), 'not defined');
});

test('amountText: a gap or margin with its unit, three significant figures, grouped', () => {
  assert.equal(amountText(4.753, 'm'), '4.75 m');
  assert.equal(amountText(0.39506, 'm'), '0.395 m');
  assert.equal(amountText(7.7531, 'm'), '7.75 m');
  assert.equal(amountText(2750, ''), '2,750');
  assert.equal(amountText(1040000, 'N'), '1,040,000 N');
  assert.equal(amountText(12345.6, 'N'), '12,300 N');
  assert.equal(amountText(125, 'N'), '125 N');
  assert.equal(amountText(0.00012345, ''), '0.000123');
  assert.equal(amountText(0, 'm'), '0 m');
  assert.equal(amountText(5, 'm/s^2'), '5 m/s²', 'the unit gets the same exponent treatment');
  assert.equal(amountText(Number.NaN, 'm'), 'not defined');
});
