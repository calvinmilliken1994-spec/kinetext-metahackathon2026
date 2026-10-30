// Stage 7e: AI-written sentences a teacher reads (learning objectives, headings) never show raw code: powers become
// superscripts, a multiplication star becomes '·', an initial-value zero becomes a subscript (V0 → V₀, matching the
// typeset equation), and markdown code ticks or bold stars are dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { aiText, bindUnits } from './displayText.ts';

test('the Moon objective reads as maths, not code', () => {
  assert.equal(
    aiText('Calculate maximum height from vertical speed and gravity using ymax = V0^2 / (2 * g).'),
    'Calculate maximum height from vertical speed and gravity using ymax = V₀² / (2 · g).',
  );
  assert.equal(aiText('Use ymax = V0² / (2*g)'), 'Use ymax = V₀² / (2·g)');
});

test('code ticks and markdown bold are dropped; hidden characters too', () => {
  assert.equal(aiText('Use `F = m*a` to find **force**'), 'Use F = m·a to find force');
  assert.equal(aiText('Moon\u200b throw'), 'Moon throw');
});

test('ordinary text is left alone', () => {
  for (const s of ['Explain why the ball rises six times higher.', 'Compare COVID-19 and H1N1 tests.', 'Rate of 3 per cent', 'x²', 'a footnote*', '']) {
    assert.equal(aiText(s), s);
  }
  assert.equal(aiText('N0 atoms at the start'), 'N₀ atoms at the start');
  assert.equal(aiText('speeds of 10 m/s^2'), 'speeds of 10 m/s²');
});

test('bindUnits keeps a number and its unit on one line (no-break space), and nothing else changes', () => {
  assert.equal(bindUnits('horizontal speed 8 m/s and g = 1.62 m/s² for 10 s'), 'horizontal speed 8\u00a0m/s and g = 1.62\u00a0m/s² for 10\u00a0s');
  assert.equal(bindUnits('a rate of 3 per cent and 25 %'), 'a rate of 3 per cent and 25\u00a0%');
  assert.equal(bindUnits('in 1776 the colonies'), 'in 1776 the colonies', 'a following word is not a unit');
  assert.equal(bindUnits('200 kg and 4 N'), '200\u00a0kg and 4\u00a0N');
});
