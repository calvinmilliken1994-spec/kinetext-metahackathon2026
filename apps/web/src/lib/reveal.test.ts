/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONCEALED, concealNumbers, initialConcealed, nextConcealed } from './reveal.ts';
import type { RevealEvent } from './reveal.ts';

test('a lesson with a first case opens with its answer hidden; one without cases shows everything', () => {
  assert.equal(initialConcealed(2), true);
  assert.equal(initialConcealed(1), true);
  assert.equal(initialConcealed(0), false);
});

test('running any case, moving a slider, a page-value chip, Play or scrubbing reveals; Reset alone does not', () => {
  for (const ev of ['run-case', 'slider', 'preset', 'play', 'scrub'] as RevealEvent[]) {
    assert.equal(nextConcealed(true, ev), false, ev);
  }
  assert.equal(nextConcealed(true, 'reset'), true);
});

test('once revealed, nothing hides the answer again (Reset returns to the opening case, still shown)', () => {
  for (const ev of ['run-case', 'slider', 'preset', 'play', 'scrub', 'reset'] as RevealEvent[]) {
    assert.equal(nextConcealed(false, ev), false, ev);
  }
});

test('concealNumbers hides every number in a label, keeps its words and unit', () => {
  assert.equal(concealNumbers('max height 69.44 m'), `max height ${CONCEALED} m`);
  assert.equal(concealNumbers('L = 12,345.6 N'), `L = ${CONCEALED} N`);
  assert.equal(concealNumbers('N = -0.25'), `N = ${CONCEALED}`);
  assert.equal(concealNumbers('$1,628.89'), CONCEALED);
  assert.equal(concealNumbers('a = 1.2e-3 m/s'), `a = ${CONCEALED} m/s`);
  assert.equal(concealNumbers('no number here'), 'no number here');
});
