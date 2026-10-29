/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitMark } from './marks.ts';

test('a leading tick or cross becomes a mark and the words stay as graded', () => {
  assert.deepEqual(splitMark('✓ Correct — all 4 steps are in order.'), { mark: 'ok', text: 'Correct — all 4 steps are in order.' });
  assert.deepEqual(splitMark('✗ 2 of 4 events are in the right place.'), { mark: 'bad', text: '2 of 4 events are in the right place.' });
  assert.deepEqual(splitMark('3 of 5 items are in the right group.'), { mark: null, text: '3 of 5 items are in the right group.' });
});
