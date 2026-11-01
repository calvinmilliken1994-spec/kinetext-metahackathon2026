// BUG-016: the USGS pH page writes "Water with a pH of five is ten times more acidic than water having a pH of six."
// Ladder checks only read digits in quotes, so honest rungs at 5 and 6 failed and repairs drifted to wrong printed
// numbers (the BUG-013 lesson). Number words now count in LADDER quotes only when tied to the scale word ("a pH of
// five"); the shared digits-only helper used by every other part type is unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaleStatedNumbers, validateLogLadder } from './kit/log-ladder.ts';
import { loadSource } from '../sources/index.ts';
import type { LogLadderGen } from '../contracts/kit.ts';

const PH_GEN = JSON.parse(readFileSync(new URL('../../tests/fixtures/stage6/log-ladder.ph-words.json', import.meta.url), 'utf8')) as LogLadderGen;
const SENTENCE = 'Water with a pH of five is ten times more acidic than water having a pH of six.';

test('numbers tied to the scale word are read in words and digits', () => {
  assert.deepEqual(scaleStatedNumbers(SENTENCE, 'pH'), [5, 6]);
  assert.deepEqual(scaleStatedNumbers('water from a mine can have a pH of 2, which is very acidic', 'pH'), [2]);
  assert.deepEqual(scaleStatedNumbers('a magnitude six earthquake', 'magnitude'), [6]);
});

test('number words not tied to the scale word do not count', () => {
  assert.deepEqual(scaleStatedNumbers('One of the most acidic lakes has a low pH.', 'pH'), []);
  assert.deepEqual(scaleStatedNumbers('Ten times more acidic than water at neutral pH', 'pH'), []);
});

test('the honest pH ladder from the page sentence passes LOG-04 and LOG-07', () => {
  const report = validateLogLadder(PH_GEN, [loadSource('usgs-wss-ph-and-water')]);
  for (const id of ['LOG-04', 'LOG-07']) {
    const c = report.checks.find(x => x.id === id);
    assert.equal(c?.passed, true, `${id}: ${c?.message}`);
  }
});

test('a rung grounded only by an unrelated number word still fails LOG-04', () => {
  const g = structuredClone(PH_GEN);
  g.rungs[3] = { ...g.rungs[3]!, label: 'Water at pH 1', value: 1, quote: 'Water with a pH of five is ten times more acidic than water having a pH of six.' };
  const report = validateLogLadder(g, [loadSource('usgs-wss-ph-and-water')]);
  assert.equal(report.checks.find(x => x.id === 'LOG-04')?.passed, false);
});
