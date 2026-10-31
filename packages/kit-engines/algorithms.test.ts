import { test } from 'node:test';
import assert from 'node:assert/strict';
import { algorithmNamePattern, traceAlgorithm } from './algorithms.ts';

test('bubble sort traces exact op sequence on [3,1,2]', () => {
  const t = traceAlgorithm('bubble-sort', [3, 1, 2], null);
  assert.deepEqual(
    t.frames.map((f) => f.op),
    ['start', 'compare', 'swap', 'compare', 'swap', 'compare', 'done'],
  );
  assert.deepEqual(t.sorted, [1, 2, 3]);
  assert.equal(t.foundIndex, null);
  assert.equal(t.truncated, false);
  assert.equal(t.frames[t.frames.length - 1].comparisons, 3);
  assert.equal(t.frames[t.frames.length - 1].moves, 2);
});

test('all sorts handle already-sorted input of length 4', () => {
  const ids = [
    'bubble-sort',
    'insertion-sort',
    'selection-sort',
    'merge-sort',
    'quicksort',
  ] as const;
  for (const id of ids) {
    const t = traceAlgorithm(id, [1, 2, 3, 4], null);
    assert.deepEqual(t.sorted, [1, 2, 3, 4]);
    assert.equal(t.truncated, false);
    assert.equal(t.frames[0].op, 'start');
    assert.equal(t.frames[t.frames.length - 1].op, 'done');
  }
});

test('all sorts handle reversed input of length 4', () => {
  const ids = [
    'bubble-sort',
    'insertion-sort',
    'selection-sort',
    'merge-sort',
    'quicksort',
  ] as const;
  for (const id of ids) {
    const t = traceAlgorithm(id, [4, 3, 2, 1], null);
    assert.deepEqual(t.sorted, [1, 2, 3, 4]);
  }
});

test('all sorts handle duplicates', () => {
  const ids = [
    'bubble-sort',
    'insertion-sort',
    'selection-sort',
    'merge-sort',
    'quicksort',
  ] as const;
  for (const id of ids) {
    const t = traceAlgorithm(id, [3, 1, 3, 2], null);
    assert.deepEqual(t.sorted, [1, 2, 3, 3]);
  }
});

test('all sorts handle length 10', () => {
  const ids = [
    'bubble-sort',
    'insertion-sort',
    'selection-sort',
    'merge-sort',
    'quicksort',
  ] as const;
  const input = [9, 3, 7, 1, 8, 2, 5, 0, 6, 4];
  for (const id of ids) {
    const t = traceAlgorithm(id, input, null);
    assert.deepEqual(t.sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(t.truncated, false);
    assert.ok(t.frames.length <= 400);
  }
});

test('bubble sort classic case [5,1,4,2,8]', () => {
  const t = traceAlgorithm('bubble-sort', [5, 1, 4, 2, 8], null);
  assert.deepEqual(t.sorted, [1, 2, 4, 5, 8]);
});

test('merge sort emits split and merge frames', () => {
  const t = traceAlgorithm('merge-sort', [3, 1, 2], null);
  const ops = t.frames.map((f) => f.op);
  assert.ok(ops.includes('split'));
  assert.ok(ops.includes('merge'));
  assert.ok(ops.includes('compare'));
  assert.ok(ops.includes('write'));
  assert.deepEqual(t.sorted, [1, 2, 3]);
});

test('quicksort emits pivot frames (Lomuto)', () => {
  const t = traceAlgorithm('quicksort', [3, 1, 2], null);
  const ops = t.frames.map((f) => f.op);
  assert.ok(ops.includes('pivot'));
  assert.deepEqual(t.sorted, [1, 2, 3]);
  const firstPivot = t.frames.find((f) => f.op === 'pivot');
  assert.deepEqual(firstPivot?.indices, [2]);
});

test('linear search present, absent, first, last', () => {
  assert.equal(traceAlgorithm('linear-search', [4, 7, 1, 9], 7).foundIndex, 1);
  assert.equal(traceAlgorithm('linear-search', [4, 7, 1, 9], 5).foundIndex, null);
  assert.equal(traceAlgorithm('linear-search', [4, 7, 1, 9], 4).foundIndex, 0);
  assert.equal(traceAlgorithm('linear-search', [4, 7, 1, 9], 9).foundIndex, 3);
});

test('binary search present, absent, first, last with mid floor', () => {
  assert.equal(traceAlgorithm('binary-search', [2, 5, 9, 14, 21], 14).foundIndex, 3);
  assert.equal(traceAlgorithm('binary-search', [2, 5, 9, 14, 21], 7).foundIndex, null);
  assert.equal(traceAlgorithm('binary-search', [1, 3, 5, 7, 9], 1).foundIndex, 0);
  assert.equal(traceAlgorithm('binary-search', [1, 3, 5, 7, 9], 9).foundIndex, 4);
  const t = traceAlgorithm('binary-search', [1, 2, 3, 4], 3);
  assert.equal(t.foundIndex, 2);
  const compares = t.frames.filter((f) => f.op === 'compare');
  assert.deepEqual(
    compares.map((f) => f.indices),
    [[1], [2]],
  );
  assert.deepEqual(compares[0].range, [0, 3]);
});

test('search traces end with not-found then done when absent', () => {
  const t = traceAlgorithm('linear-search', [4, 7, 1, 9], 5);
  const ops = t.frames.map((f) => f.op);
  assert.equal(ops[ops.length - 2], 'not-found');
  assert.equal(ops[ops.length - 1], 'done');
  assert.equal(t.sorted, null);
});

test('sorts return null foundIndex and searches return null sorted', () => {
  assert.equal(traceAlgorithm('bubble-sort', [2, 1, 4, 3], null).foundIndex, null);
  assert.equal(traceAlgorithm('binary-search', [1, 2, 3, 4], 3).sorted, null);
});

test('counters are cumulative', () => {
  const t = traceAlgorithm('bubble-sort', [3, 1, 2], null);
  let c = 0;
  let m = 0;
  for (const f of t.frames) {
    assert.ok(f.comparisons >= c);
    assert.ok(f.moves >= m);
    c = f.comparisons;
    m = f.moves;
  }
});

test('truncation cuts frames at maxFrames', () => {
  const t = traceAlgorithm('bubble-sort', [5, 4, 3, 2, 1, 0, 9, 8, 7, 6], null, 5);
  assert.equal(t.truncated, true);
  assert.equal(t.frames.length, 5);
  assert.deepEqual(t.sorted, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('invalid inputs throw RangeError with stable code', () => {
  assert.throws(() => traceAlgorithm('linear-search', [1, 2, 3, 4], null), /ALGO_INPUT_INVALID/);
  assert.throws(() => traceAlgorithm('bubble-sort', [1, 2, NaN, 4], null), /ALGO_INPUT_INVALID/);
  assert.throws(() => traceAlgorithm('bubble-sort', [1, 2, 3, 4], null, 0), /ALGO_INPUT_INVALID/);
});

test('algorithmNamePattern matches usual page names', () => {
  assert.match('Binary Search', algorithmNamePattern('binary-search'));
  assert.match('binary chop', algorithmNamePattern('binary-search'));
  assert.match('Half-Interval Search', algorithmNamePattern('binary-search'));
  assert.match('sequential search', algorithmNamePattern('linear-search'));
  assert.match('LINEAR SEARCH', algorithmNamePattern('linear-search'));
  assert.match('bubble sort', algorithmNamePattern('bubble-sort'));
  assert.match('insertion sort', algorithmNamePattern('insertion-sort'));
  assert.match('selection sort', algorithmNamePattern('selection-sort'));
  assert.match('mergesort', algorithmNamePattern('merge-sort'));
  assert.match('Merge Sort', algorithmNamePattern('merge-sort'));
  assert.match('quicksort', algorithmNamePattern('quicksort'));
  assert.match('quick sort', algorithmNamePattern('quicksort'));
  assert.doesNotMatch('bubble sorting tricks', algorithmNamePattern('bubble-sort'));
});
