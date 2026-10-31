/// <reference types="node" />
// Stage 8a slice W-A: the tracer's view model holds for every algorithm on many seeded random inputs within the frozen
// limits (4–10 integers in 0..99), not only on the hand-worked traces in algorithmView.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALGORITHM_IDS, KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import type { AlgorithmId, AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import { algorithmPresentationSteps, algorithmTrace, boardAt, predictPoints, presentationFrame } from './algorithmView.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function randomSpec(id: AlgorithmId, r: () => number): AlgorithmTraceSpec {
  const { input: L, value: V } = KIT_LIMITS.algorithm;
  const n = L.min + Math.floor(r() * (L.max - L.min + 1));
  const search = id === 'binary-search' || id === 'linear-search';
  let input = Array.from({ length: n }, () => V.min + Math.floor(r() * (V.max - V.min + 1)));
  if (id === 'binary-search') input = [...new Set(input)].sort((a, b) => a - b).concat([]).slice(0, n);
  while (input.length < L.min) input = [...new Set([...input, Math.floor(r() * 100)])].sort((a, b) => a - b);
  const target = search ? (r() < 0.6 ? (input[Math.floor(r() * input.length)] as number) : Math.floor(r() * 100)) : 0;
  return { algorithm: id, input, hasTarget: search, target, claims: [], algorithmName: id, sourceId: 's', quote: 'q' } as unknown as AlgorithmTraceSpec;
}

test('random inputs: predict points are ordered, answerable from their options, and the board renders every frame', () => {
  const r = rng(20261031);
  for (const id of ALGORITHM_IDS) {
    for (let k = 0; k < 60; k++) {
      const spec = randomSpec(id, r);
      const trace = algorithmTrace(spec);
      const points = predictPoints(spec, trace);
      assert.ok(points.length >= 1, `${id} ${spec.input.join(',')}: no predict point`);
      let lastReveal = -1;
      for (const p of points) {
        assert.ok(p.ask > lastReveal && p.reveal >= p.ask, `${id} ${spec.input.join(',')}: overlapping points`);
        lastReveal = p.reveal;
        assert.ok(p.options.some((o) => o.id === p.answer), `${id} ${spec.input.join(',')}: answer ${p.answer} not an option`);
        assert.ok(['compare', 'pivot'].includes(trace.frames[p.ask]?.op ?? ''), `${id}: asks at a ${trace.frames[p.ask]?.op} frame`);
      }
      trace.frames.forEach((_f, i) => {
        const b = boardAt(spec, trace, i);
        assert.equal(b.cells.length, spec.input.length);
        assert.ok(b.cells.every((c) => c.scale >= 0 && c.scale <= 1));
      });
      const steps = algorithmPresentationSteps(spec);
      for (let s = 0; s < steps; s++) {
        const shown = presentationFrame(spec, s, true, trace);
        const p = points[s];
        assert.ok(p !== undefined && shown.frame === p.reveal);
      }
    }
  }
});

test('random inputs: the last frame of a sort shows every item settled; a found search marks exactly one item', () => {
  const r = rng(7);
  for (const id of ALGORITHM_IDS) {
    for (let k = 0; k < 30; k++) {
      const spec = randomSpec(id, r);
      const trace = algorithmTrace(spec);
      const end = boardAt(spec, trace, trace.frames.length - 1);
      if (spec.hasTarget) {
        assert.equal(end.cells.filter((c) => c.mark === 'found').length, trace.foundIndex === null ? 0 : 1);
      } else {
        assert.ok(end.cells.every((c) => c.settled));
        assert.deepEqual(end.cells.map((c) => c.value), [...spec.input].sort((a, b) => a - b));
      }
    }
  }
});
