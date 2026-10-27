/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrowLength, clampArrow, niceStep, objectShapeFor, sliderStep, toPx, trackWindow, valueRange } from './track.ts';
import { simulate } from '../../../../packages/activities/forces-1d/engine.ts';

const xsOf = (m: number, f: number) => simulate({ massKg: m, netForceN: f, durationS: 5, stepS: 0.02 }).map((fr) => fr.x);

test('niceStep returns 1/2/5 x 10^k', () => {
  assert.equal(niceStep(0.9), 1);
  assert.equal(niceStep(1.1), 2);
  assert.equal(niceStep(3), 5);
  assert.equal(niceStep(7), 10);
  assert.equal(niceStep(0), 1);
});

test('positive force: window contains the origin and the maximum position', () => {
  const xs = xsOf(5, 10); // a=2 -> x(5)=25
  const w = trackWindow(xs);
  assert.ok(w.min <= 0 && w.max >= 25);
  assert.ok(w.ticks.includes(0));
  assert.equal(w.ticks[0], w.min);
  assert.equal(w.ticks[w.ticks.length - 1], w.max);
});

test('negative force: window extends below zero and still contains the origin', () => {
  const xs = xsOf(5, -50); // a=-10 -> x(5)=-125
  const w = trackWindow(xs);
  assert.ok(w.min <= -125, `min ${w.min}`);
  assert.ok(w.max >= 0);
});

test('zero force: finite window with positive span that contains the origin', () => {
  const w = trackWindow(xsOf(4, 0));
  assert.ok(Number.isFinite(w.min) && Number.isFinite(w.max));
  assert.ok(w.max - w.min >= 10);
  assert.ok(w.min <= 0 && w.max >= 0);
  assert.ok(w.ticks.length >= 3 && w.ticks.length <= 20);
});

test('every sampled position maps inside the pixel track', () => {
  for (const f of [-50, -3, 0, 7, 50]) {
    const xs = xsOf(2, f);
    const w = trackWindow(xs);
    for (const x of xs) {
      const px = toPx(x, w, 60, 740);
      assert.ok(px >= 60 - 1e-6 && px <= 740 + 1e-6, `force ${f} x ${x} px ${px}`);
    }
  }
});

test('arrowLength: sign, zero, minimum and clamp', () => {
  assert.equal(arrowLength(0, 50, 200), 0);
  assert.equal(arrowLength(25, 50, 200), 100);
  assert.equal(arrowLength(-25, 50, 200), -100);
  assert.equal(arrowLength(0.001, 50, 200), 10);
  assert.equal(arrowLength(500, 50, 200), 200);
  assert.equal(arrowLength(5, 0, 200), 0);
  assert.equal(Object.is(arrowLength(0, 50, 200), 0), true);
});

test('clampArrow keeps the tip inside bounds', () => {
  assert.equal(clampArrow(100, 900, 20, 780), 680);
  assert.equal(clampArrow(100, -500, 20, 780), -80);
  assert.equal(clampArrow(100, 500, 20, 780), 500);
  assert.equal(clampArrow(100, 40, 20, 780), 40);
});

test('sliderStep gives a nice step with >= 100 positions', () => {
  assert.equal(sliderStep(-50, 50), 1);
  assert.equal(sliderStep(0.5, 20), 0.1);
  assert.equal(sliderStep(0, 1), 0.01);
  for (const [a, b] of [[-50, 50], [0.5, 20], [1, 3]] as const) {
    assert.ok((b - a) / sliderStep(a, b) >= 100);
  }
});

test('valueRange includes zero and never collapses', () => {
  assert.deepEqual(valueRange([0, 0, 0]), { lo: -1, hi: 1 });
  const r = valueRange([0, 10]);
  assert.equal(r.lo, 0);
  assert.ok(r.hi > 10);
  const n = valueRange([0, -10]);
  assert.ok(n.lo < -10 && n.hi === 0);
});

test('objectShapeFor picks an aircraft for aircraft labels and a block otherwise', () => {
  assert.equal(objectShapeFor('Model aircraft'), 'aircraft');
  assert.equal(objectShapeFor('Jet'), 'aircraft');
  assert.equal(objectShapeFor('Dynamics cart'), 'block');
  assert.equal(objectShapeFor('Spaceship'), 'block');
});
