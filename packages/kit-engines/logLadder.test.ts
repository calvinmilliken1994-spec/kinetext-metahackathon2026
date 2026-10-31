import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ladderDirection, ladderRatio } from './logLadder.ts';

test('ratio 10^(6.3-5.3) is 10', () => {
  const r = ladderRatio(10, 5.3, 6.3);
  assert.ok(Math.abs(r - 10) < 1e-9);
});

test('ratio 32^2 is 1024', () => {
  assert.equal(ladderRatio(32, 4, 6), 1024);
});

test('ratio is symmetric in direction', () => {
  assert.equal(ladderRatio(10, 6, 6), 1);
  assert.equal(ladderRatio(10, 1, 3), ladderRatio(10, 3, 1));
  assert.equal(ladderRatio(2, 0, 10), 1024);
});

test('direction follows the increasing flag', () => {
  assert.equal(ladderDirection(true, 5, 6), 'more');
  assert.equal(ladderDirection(true, 6, 5), 'less');
  assert.equal(ladderDirection(false, 5, 6), 'less');
  assert.equal(ladderDirection(false, 6, 5), 'more');
});

test('invalid ladder inputs throw RangeError', () => {
  assert.throws(() => ladderRatio(1, 5, 6), /LADDER_INPUT_INVALID/);
  assert.throws(() => ladderRatio(0.5, 5, 6), /LADDER_INPUT_INVALID/);
  assert.throws(() => ladderRatio(2000, 5, 6), /LADDER_INPUT_INVALID/);
  assert.throws(() => ladderRatio(NaN, 5, 6), /LADDER_INPUT_INVALID/);
  assert.throws(() => ladderRatio(10, NaN, 6), /LADDER_INPUT_INVALID/);
  assert.throws(() => ladderDirection(true, NaN, 6), /LADDER_INPUT_INVALID/);
});
