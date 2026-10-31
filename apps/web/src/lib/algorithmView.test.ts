/// <reference types="node" />
// Stage 8a slice W-A: the algorithm tracer's view model. Every answer is read from our engine's frames
// (packages/kit-engines traceAlgorithm); these traces are worked by hand from the engine's rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AlgorithmId, AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import {
  ALGORITHM_PRESENT_MAX, algorithmPresentationSteps, algorithmTrace, boardAt, gradeChoice, mergeTray, movesLabel,
  predictPoints, presentationFrame, teachingPoints, variantNote,
} from './algorithmView.ts';

function mk(algorithm: AlgorithmId, input: number[], target: number | null = null): AlgorithmTraceSpec {
  return {
    schemaVersion: '0.6.0', id: `t-${algorithm}`, componentId: 'algorithm-trace-v1', title: 't', sources: [], seed: 1,
    execution: { mode: 'deterministic-component', network: 'none', timeLimitMs: 1000 },
    provenance: {} as AlgorithmTraceSpec['provenance'],
    algorithm, algorithmName: algorithm.replace('-', ' '), sourceId: 's', quote: 'q', input,
    hasTarget: target !== null, target: target ?? 0, claims: [],
  } as unknown as AlgorithmTraceSpec;
}

const summary = (spec: AlgorithmTraceSpec) => predictPoints(spec).map((p) => [p.kind, p.ask, p.reveal, p.answer]);

test('bubble sort: one swap question per comparison, answered by whether the next frame swaps', () => {
  const s = mk('bubble-sort', [5, 1, 4, 2]);
  assert.deepEqual(summary(s), [
    ['swap', 1, 2, 'yes'], ['swap', 3, 4, 'yes'], ['swap', 5, 6, 'yes'], ['swap', 7, 7, 'no'], ['swap', 8, 9, 'yes'], ['swap', 10, 10, 'no'],
  ]);
  const p = predictPoints(s)[0]!;
  assert.equal(p.question, 'Will 5 and 1 swap?');
  assert.deepEqual(p.options.map((o) => o.id), ['yes', 'no']);
  assert.equal(predictPoints(s)[3]!.outcome, 'No: 1 and 4 are already in order.');
});

test('bubble sort settles the end of the list pass by pass', () => {
  const s = mk('bubble-sort', [5, 1, 4, 2]);
  const t = algorithmTrace(s);
  const settled = (f: number) => boardAt(s, t, f).cells.filter((c) => c.settled).map((c) => c.index);
  assert.deepEqual(settled(6), []);
  assert.deepEqual(settled(7), [3]);
  assert.deepEqual(settled(10), [2, 3]);
  assert.deepEqual(settled(11), [0, 1, 2, 3]);
  const b = boardAt(s, t, 1);
  assert.deepEqual(b.cells.map((c) => c.mark), ['compare', 'compare', 'none', 'none']);
  assert.equal(boardAt(s, t, 2).cells[0]!.mark, 'swap');
  assert.equal(b.comparisons, 1);
  assert.equal(b.note, 'Compare 5 at position 0 with 1 at position 1.');
});

test('insertion sort: "where will it land?" once per key, read from the last write of its span', () => {
  const s = mk('insertion-sort', [4, 1, 3, 2]);
  assert.deepEqual(summary(s), [['land', 1, 3, '0'], ['land', 4, 7, '1'], ['land', 8, 13, '1']]);
  const p = predictPoints(s)[1]!;
  assert.equal(p.question, 'Where will 3 land?');
  assert.deepEqual(p.options.map((o) => o.label), ['Position 0', 'Position 1', 'Position 2']);
  // A key already in place stays: no write in its span.
  assert.deepEqual(summary(mk('insertion-sort', [1, 2, 3, 4])).map((r) => r[3]), ['1', '2', '3']);
});

test('insertion sort shows the key it holds in the gap, not the stale copy', () => {
  const s = mk('insertion-sort', [4, 1, 3, 2]);
  const t = algorithmTrace(s);
  const at = (f: number) => boardAt(s, t, f).cells.map((c) => `${c.value}${c.mark === 'held' ? '*' : ''}`).join(' ');
  assert.equal(at(1), '4 1* 3 2');
  assert.equal(at(2), '1* 4 3 2');
  assert.equal(at(3), '1 4 3 2');
  assert.equal(at(6), '1 3* 4 2');
  assert.equal(boardAt(s, t, 6).markers.key, 1);
});

test('selection sort: "which value ends up at position i?" once per pass', () => {
  const s = mk('selection-sort', [4, 2, 3, 1]);
  assert.deepEqual(summary(s), [['min-into', 1, 4, '1'], ['min-into', 5, 6, '2'], ['min-into', 7, 7, '3']]);
  const p = predictPoints(s)[0]!;
  assert.equal(p.question, 'Which value ends up at position 0?');
  assert.deepEqual(p.options.map((o) => o.label), ['4', '2', '3', '1']);
  const t = algorithmTrace(s);
  assert.equal(boardAt(s, t, 2).markers.min, 1);
  assert.deepEqual(boardAt(s, t, 4).cells.filter((c) => c.settled).map((c) => c.index), [0]);
  assert.deepEqual(boardAt(s, t, 7).cells.filter((c) => c.settled).map((c) => c.index), [0, 1]);
});

test('merge sort: the merge tray holds both sorted halves, even after the array is overwritten', () => {
  const s = mk('merge-sort', [4, 1, 3, 2]);
  assert.deepEqual(summary(s), [['merge-next', 3, 4, 'right'], ['merge-next', 8, 9, 'right'], ['merge-next', 12, 13, 'left'], ['merge-next', 14, 15, 'right'], ['merge-next', 16, 17, 'right']]);
  const t = algorithmTrace(s);
  const tray = mergeTray(t.frames, 16);
  assert.deepEqual(tray, { lo: 0, mid: 2, hi: 3, left: [1, 4], right: [2, 3], li: 1, rj: 1 });
  assert.equal(predictPoints(s)[4]!.question, 'Which goes down next: 4 from the left or 3 from the right?');
  const b = boardAt(s, t, 16);
  assert.deepEqual(b.range, [0, 3]);
  assert.equal(b.split, 2);
  // The list positions still to be filled hold stale copies: the next slot and the pending ones are marked as such.
  assert.deepEqual(b.cells.map((c) => c.mark), ['none', 'none', 'slot', 'pending']);
  assert.deepEqual(boardAt(s, t, 15).cells.map((c) => c.mark), ['none', 'write', 'pending', 'pending']);
  assert.equal(mergeTray(t.frames, 1), null);
  // After the last write, every item of both halves is used.
  assert.deepEqual(mergeTray(t.frames, 18), { lo: 0, mid: 2, hi: 3, left: [1, 4], right: [2, 3], li: 2, rj: 2 });
});

test('merge sort ties: the left item goes first', () => {
  const s = mk('merge-sort', [3, 3, 1, 2]);
  const first = predictPoints(s)[0]!;
  assert.equal(first.answer, 'left');
  assert.equal(first.outcome, '3 from the left: on a tie the left item goes first.');
});

test('quicksort: "where will the pivot settle?" once per partition', () => {
  const s = mk('quicksort', [3, 1, 4, 2]);
  assert.deepEqual(summary(s), [['pivot-land', 1, 6, '1'], ['pivot-land', 7, 9, '2']]);
  const p = predictPoints(s)[1]!;
  assert.deepEqual(p.options.map((o) => o.id), ['2', '3']);
  const t = algorithmTrace(s);
  assert.equal(boardAt(s, t, 2).markers.pivot, 3);
  assert.deepEqual(boardAt(s, t, 6).cells.filter((c) => c.settled).map((c) => c.index), [1]);
  assert.deepEqual(boardAt(s, t, 9).cells.filter((c) => c.settled).map((c) => c.index), [1, 2]);
});

test('binary search: left half, right half or found, with lo/mid/hi and the eliminated part dimmed', () => {
  const s = mk('binary-search', [2, 11, 23, 31, 44, 58, 79], 23);
  assert.deepEqual(summary(s), [['half', 1, 2, 'left'], ['half', 3, 4, 'right'], ['half', 5, 6, 'found']]);
  assert.deepEqual(predictPoints(s)[0]!.options.map((o) => o.id), ['left', 'found', 'right']);
  const t = algorithmTrace(s);
  const b1 = boardAt(s, t, 1);
  assert.deepEqual(b1.markers, { lo: 0, mid: 3, hi: 6, key: null, min: null, pivot: null });
  assert.deepEqual(b1.cells.filter((c) => c.out).map((c) => c.index), []);
  const b2 = boardAt(s, t, 2);
  assert.deepEqual(b2.cells.filter((c) => c.out).map((c) => c.index), [3, 4, 5, 6]);
  assert.equal(b2.markers.mid, null);
  assert.equal(boardAt(s, t, 6).cells[2]!.mark, 'found');
  assert.equal(boardAt(s, t, 7).cells[2]!.mark, 'found');
  // An emptied range (not found): the last step's side is still known.
  assert.deepEqual(summary(mk('binary-search', [2, 11, 23, 31, 44, 58, 79], 5)).map((r) => r[3]), ['left', 'left', 'right']);
});

test('linear search: "is this the target?" at every comparison', () => {
  const s = mk('linear-search', [4, 8, 1, 9], 1);
  assert.deepEqual(summary(s), [['match', 1, 1, 'no'], ['match', 2, 2, 'no'], ['match', 3, 4, 'yes']]);
  const t = algorithmTrace(s);
  assert.deepEqual(boardAt(s, t, 3).cells.filter((c) => c.out).map((c) => c.index), [0, 1]);
});

test('teaching points and presentation steps are capped; each step maps to its ask and reveal frame', () => {
  const big = mk('bubble-sort', [9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(predictPoints(big).length, 28);
  assert.equal(teachingPoints(big).length, ALGORITHM_PRESENT_MAX);
  assert.equal(algorithmPresentationSteps(big), ALGORITHM_PRESENT_MAX);
  const s = mk('binary-search', [2, 11, 23, 31, 44, 58, 79], 31);
  assert.equal(algorithmPresentationSteps(s), 1);
  assert.deepEqual(presentationFrame(s, 0, false), { point: 0, frame: 1 });
  assert.deepEqual(presentationFrame(s, 0, true), { point: 0, frame: 2 });
  assert.deepEqual(presentationFrame(s, 5, true), { point: 0, frame: 2 });
  const q = mk('quicksort', [3, 1, 4, 2]);
  assert.deepEqual(presentationFrame(q, 1, false), { point: 1, frame: 7 });
  assert.deepEqual(presentationFrame(q, 1, true), { point: 1, frame: 9 });
});

test('an ask frame never prints its own answer (board, note or question)', () => {
  for (const spec of [mk('bubble-sort', [5, 1, 4, 2]), mk('quicksort', [3, 1, 4, 2]), mk('insertion-sort', [4, 1, 3, 2]), mk('binary-search', [2, 11, 23, 31, 44, 58, 79], 23)]) {
    const t = algorithmTrace(spec);
    for (const p of teachingPoints(spec)) {
      const b = boardAt(spec, t, p.ask);
      assert.ok(b.op === 'compare' || b.op === 'pivot', `${spec.algorithm} asks at a ${b.op} frame`);
      assert.ok(!/\b(swap|found|half|write|move)/i.test(b.note), `${spec.algorithm} note at ${p.ask}: ${b.note}`);
      assert.ok(!p.question.includes(p.outcome));
    }
  }
});

test('grading a choice, counters and variant notes', () => {
  const p = predictPoints(mk('bubble-sort', [5, 1, 4, 2]))[0]!;
  assert.equal(gradeChoice(p, 'yes'), true);
  assert.equal(gradeChoice(p, 'no'), false);
  assert.equal(movesLabel('bubble-sort'), 'Swaps');
  assert.equal(movesLabel('quicksort'), 'Swaps');
  assert.equal(movesLabel('merge-sort'), 'Writes');
  assert.equal(movesLabel('insertion-sort'), 'Moves');
  assert.equal(movesLabel('binary-search'), null);
  assert.match(variantNote('quicksort') ?? '', /^Our tracer shows one standard version/);
  assert.match(variantNote('merge-sort') ?? '', /^Our tracer shows one standard version/);
  assert.match(variantNote('bubble-sort') ?? '', /every pass/);
  assert.equal(variantNote('binary-search'), null);
});

test('the done frame marks a sorted list settled and a search result found', () => {
  const s = mk('selection-sort', [4, 2, 3, 1]);
  const t = algorithmTrace(s);
  const done = boardAt(s, t, t.frames.length - 1);
  assert.equal(done.done, true);
  assert.ok(done.cells.every((c) => c.settled));
  const ns = mk('linear-search', [4, 8, 1, 9], 7);
  const nt = algorithmTrace(ns);
  assert.ok(boardAt(ns, nt, nt.frames.length - 1).cells.every((c) => c.out));
});
