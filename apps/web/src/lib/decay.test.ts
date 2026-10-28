/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingAfter } from '../../../../packages/activities/half-life-v1/engine.ts';
import { decayPoints, formatAmount, fractionLabel, halfLifeMarkers, halfLivesElapsed, markerLabelStride, MAX_HALF_LIFE_MARKERS } from './decay.ts';

const BASE = { initialAmount: 80, halfLife: 8, elapsedTime: 24 };

test('fractionLabel: 1/2, 1/4, 1/8 … for whole half-lives', () => {
  assert.equal(fractionLabel(0), '1');
  assert.equal(fractionLabel(1), '1/2');
  assert.equal(fractionLabel(2), '1/4');
  assert.equal(fractionLabel(3), '1/8');
  assert.equal(fractionLabel(10), '1/1024');
});

test('halfLifeMarkers: one per whole half-life up to the end of the time axis, with the engine amount', () => {
  const m = halfLifeMarkers(8, 40, 80);
  assert.deepEqual(m.map((x) => x.k), [1, 2, 3, 4, 5]);
  assert.deepEqual(m.map((x) => x.t), [8, 16, 24, 32, 40]);
  assert.deepEqual(m.map((x) => x.fraction), [0.5, 0.25, 0.125, 0.0625, 0.03125]);
  assert.deepEqual(m.map((x) => x.fractionLabel), ['1/2', '1/4', '1/8', '1/16', '1/32']);
  assert.deepEqual(m.map((x) => x.amount), [40, 20, 10, 5, 2.5]);
  for (const x of m) assert.equal(x.amount, remainingAfter({ ...BASE, elapsedTime: x.t }));
});

test('halfLifeMarkers: a half-life longer than the axis has no markers; the axis end counts when it is a whole half-life', () => {
  assert.deepEqual(halfLifeMarkers(50, 40, 80), []);
  assert.equal(halfLifeMarkers(0.1, 0.3, 1)[2]?.k, 3); // 3 x 0.1 is 0.30000000000000004: float slack keeps it
});

test('halfLifeMarkers: capped so a tiny half-life cannot flood the chart', () => {
  assert.equal(MAX_HALF_LIFE_MARKERS, 10);
  assert.equal(halfLifeMarkers(1, 1000, 100).length, 10);
});

test('halfLifeMarkers: invalid inputs give no markers', () => {
  assert.deepEqual(halfLifeMarkers(0, 40, 80), []);
  assert.deepEqual(halfLifeMarkers(-1, 40, 80), []);
  assert.deepEqual(halfLifeMarkers(8, 0, 80), []);
  assert.deepEqual(halfLifeMarkers(8, 40, 0), []);
  assert.deepEqual(halfLifeMarkers(Number.NaN, 40, 80), []);
});

test('decayPoints: N(t) over 0..tMax from the engine, starting at N0 and strictly falling', () => {
  const pts = decayPoints(BASE, 24, 3);
  assert.deepEqual(pts.map((p) => p.t), [0, 8, 16, 24]);
  assert.deepEqual(pts.map((p) => p.amount), [80, 40, 20, 10]);
  const fine = decayPoints(BASE, 40, 80);
  assert.equal(fine.length, 81);
  for (let i = 1; i < fine.length; i++) assert.ok((fine[i]?.amount ?? 0) < (fine[i - 1]?.amount ?? 0));
  assert.equal(fine[80]?.amount, remainingAfter({ ...BASE, elapsedTime: 40 }));
});

test('decayPoints: rejected inputs or an empty time axis give no curve', () => {
  assert.deepEqual(decayPoints({ ...BASE, halfLife: 0 }, 24, 10), []);
  assert.deepEqual(decayPoints({ ...BASE, initialAmount: -1 }, 24, 10), []);
  assert.deepEqual(decayPoints(BASE, 0, 10), []);
  assert.deepEqual(decayPoints(BASE, Number.NaN, 10), []);
});

test('halfLivesElapsed = t / T, or null for a bad half-life', () => {
  assert.equal(halfLivesElapsed(24, 8), 3);
  assert.equal(halfLivesElapsed(12, 8), 1.5);
  assert.equal(halfLivesElapsed(0, 8), 0);
  assert.equal(halfLivesElapsed(5, 0), null);
  assert.equal(halfLivesElapsed(Number.NaN, 8), null);
});

test('markerLabelStride: label every marker when there is room, thin them out when they would collide', () => {
  assert.equal(markerLabelStride(40, 8, 640, 40), 1); // 128 px apart
  assert.equal(markerLabelStride(40, 1, 640, 40), 3); // 16 px apart -> every third
  assert.equal(markerLabelStride(1000, 1, 640, 40), 63);
  assert.equal(markerLabelStride(0, 8, 640, 40), 1);
  assert.equal(markerLabelStride(40, 0, 640, 40), 1);
});

test('formatAmount: readable at any scale, units never invented', () => {
  assert.equal(formatAmount(10), '10');
  assert.equal(formatAmount(2.5), '2.5');
  assert.equal(formatAmount(0.0625), '0.0625');
  assert.equal(formatAmount(3.14159), '3.142');
  assert.equal(formatAmount(78.51062746234183), '78.51');
  assert.equal(formatAmount(250.456), '250.46');
  assert.equal(formatAmount(1234567), '1,234,567');
  assert.equal(formatAmount(0), '0');
  assert.equal(formatAmount(0.00001234), '1.23e-5');
  assert.equal(formatAmount(Number.NaN), 'NaN');
});
