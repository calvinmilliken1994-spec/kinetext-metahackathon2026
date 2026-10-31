/// <reference types="node" />
// The tracer's board reserves a marker row (lo · mid · hi, key, min, pivot) and a swap-arc band only when the trace
// ever uses them, so merge sort and bubble sort carry no empty band; the rooms are the same on every frame, so stepping
// and revealing never move the layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlgorithmId, AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import { algorithmTrace, boardAt, boardRooms, swapPair } from './algorithmView.ts';

function mk(algorithm: AlgorithmId, input: number[], target: number | null = null): AlgorithmTraceSpec {
  return {
    schemaVersion: '0.6.0', id: `t-${algorithm}`, componentId: 'algorithm-trace-v1', title: 't', sources: [], seed: 1,
    execution: { mode: 'deterministic-component', network: 'none', timeLimitMs: 1000 },
    provenance: {} as AlgorithmTraceSpec['provenance'],
    algorithm, algorithmName: algorithm.replace('-', ' '), sourceId: 's', quote: 'q', input,
    hasTarget: target !== null, target: target ?? 0, claims: [],
  } as unknown as AlgorithmTraceSpec;
}

const rooms = (s: AlgorithmTraceSpec) => boardRooms(s, algorithmTrace(s));

test('merge sort and linear search use neither the marker row nor the swap arc', () => {
  assert.deepEqual(rooms(mk('merge-sort', [38, 27, 43, 3, 9, 82, 10])), { tags: false, swapArc: false });
  assert.deepEqual(rooms(mk('linear-search', [4, 8, 15, 16, 23], 16)), { tags: false, swapArc: false });
});

test('bubble sort swaps but has no markers', () => {
  assert.deepEqual(rooms(mk('bubble-sort', [5, 1, 4, 2])), { tags: false, swapArc: true });
  // Already sorted: no swap ever happens, so no arc band either.
  assert.deepEqual(rooms(mk('bubble-sort', [1, 2, 3, 4])), { tags: false, swapArc: false });
});

test('binary search marks lo · mid · hi; insertion sort marks its key; quicksort marks the pivot and swaps', () => {
  assert.deepEqual(rooms(mk('binary-search', [2, 5, 8, 12, 16, 23, 38], 23)), { tags: true, swapArc: false });
  assert.deepEqual(rooms(mk('insertion-sort', [4, 1, 3, 2])), { tags: true, swapArc: false });
  assert.deepEqual(rooms(mk('quicksort', [5, 3, 8, 1, 9, 2])), { tags: true, swapArc: true });
  assert.equal(rooms(mk('selection-sort', [5, 3, 8, 1])).tags, true);
});

test('the swap pair is the two outer positions that trade places, or null', () => {
  const s = mk('bubble-sort', [5, 1, 4, 2]);
  const t = algorithmTrace(s);
  assert.deepEqual(swapPair(boardAt(s, t, 2)), [0, 1]);
  assert.equal(swapPair(boardAt(s, t, 1)), null, 'a compare frame has no arc');
});

test('the rooms are a property of the whole trace: every frame of a spec gets the same answer', () => {
  const s = mk('quicksort', [5, 3, 8, 1, 9, 2]);
  const t = algorithmTrace(s);
  const once = boardRooms(s, t);
  assert.deepEqual(boardRooms(s, t), once);
  assert.ok(t.frames.some((_, f) => swapPair(boardAt(s, t, f)) !== null));
});
