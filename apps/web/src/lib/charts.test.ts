/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { linearScale, niceAxis, pointString } from './charts.ts';

test('linearScale maps the domain ends and midpoint onto the range, in either direction', () => {
  const x = linearScale(0, 10, 40, 240);
  assert.equal(x(0), 40);
  assert.equal(x(5), 140);
  assert.equal(x(10), 240);
  const y = linearScale(0, 100, 150, 20); // SVG y grows downward
  assert.equal(y(0), 150);
  assert.equal(y(100), 20);
  assert.equal(y(50), 85);
});

test('linearScale with an empty domain stays finite and maps everything to the range start', () => {
  const s = linearScale(3, 3, 10, 90);
  assert.equal(s(3), 10);
  assert.equal(s(100), 10);
  assert.ok(Number.isFinite(linearScale(0, Number.NaN, 0, 1)(1)));
});

test('niceAxis: a 1/2/5 step, a top that covers the value, ticks from 0', () => {
  assert.deepEqual(niceAxis(1628.89, 4), { max: 2000, step: 500, ticks: [0, 500, 1000, 1500, 2000] });
  assert.deepEqual(niceAxis(0.5, 5), { max: 0.5, step: 0.1, ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5] });
  assert.deepEqual(niceAxis(100, 4), { max: 100, step: 50, ticks: [0, 50, 100] });
});

test('niceAxis: zero, negative and non-finite maxima give a unit axis instead of NaN', () => {
  for (const m of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(niceAxis(m, 4), { max: 1, step: 1, ticks: [0, 1] });
  }
});

test('pointString joins x,y pairs with one decimal and skips non-finite points', () => {
  assert.equal(pointString([{ x: 0, y: 1 }, { x: 10.04, y: 20.06 }]), '0.0,1.0 10.0,20.1');
  assert.equal(pointString([{ x: 1, y: 2 }, { x: Number.NaN, y: 3 }, { x: 4, y: 5 }]), '1.0,2.0 4.0,5.0');
  assert.equal(pointString([]), '');
});
