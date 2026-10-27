// TASK-012 — projectile-v1 engine tests.
// Run: node --test packages/activities/projectile-v1/engine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENGINE_ID,
  MAX_FRAMES,
  flightTimeOf,
  maxHeightOf,
  simulate,
  stateAt,
} from './engine.ts';
import type { ProjectileFrame, ProjectileInput } from './engine.ts';

/** Absolute-tolerance comparison. */
function closeTo(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    msg ?? `expected ${actual} to be within ${tol} of ${expected}`,
  );
}

function expectRangeError(fn: () => unknown, message: string): void {
  assert.throws(
    fn,
    (err: unknown) => err instanceof RangeError && err.message === message,
    `expected RangeError('${message}')`,
  );
}

const EARTH: ProjectileInput = { horizontalSpeedMps: 10, verticalSpeedMps: 20, gravityMps2: 9.8 };

test('module constants', () => {
  assert.equal(ENGINE_ID, 'projectile-v1');
  assert.equal(MAX_FRAMES, 3001);
});

test('maxHeightOf: V0=20 m/s, g=9.8 m/s^2 -> 20.408163... m', () => {
  const h = maxHeightOf({ verticalSpeedMps: 20, gravityMps2: 9.8 });
  closeTo(h, 20.408163265306122, 1e-12);
  assert.equal(h, (20 * 20) / (2 * 9.8));
});

test('maxHeightOf: quadrupling V0 multiplies the height by 16; halving g doubles it', () => {
  const base = maxHeightOf({ verticalSpeedMps: 10, gravityMps2: 9.8 });
  closeTo(maxHeightOf({ verticalSpeedMps: 40, gravityMps2: 9.8 }), 16 * base, 1e-12);
  closeTo(maxHeightOf({ verticalSpeedMps: 10, gravityMps2: 4.9 }), 2 * base, 1e-12);
});

test('maxHeightOf: moon gravity g=1.62, V0=12 -> 44.444... m', () => {
  closeTo(maxHeightOf({ verticalSpeedMps: 12, gravityMps2: 1.62 }), 44.4444444444, 1e-9);
});

test('flightTimeOf: level-landing assumption t_flight = 2*V0/g', () => {
  assert.equal(flightTimeOf(EARTH), (2 * 20) / 9.8);
  closeTo(flightTimeOf(EARTH), 4.081632653061225, 1e-12);
  // The apex is reached at exactly half the flight time.
  closeTo(flightTimeOf(EARTH) / 2, 20 / 9.8, 1e-12);
});

test('input domain: V0 must be finite and > 0, g must be finite and > 0', () => {
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: 0, gravityMps2: 9.8 }), 'VERTICAL_SPEED_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: -5, gravityMps2: 9.8 }), 'VERTICAL_SPEED_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: Number.NaN, gravityMps2: 9.8 }), 'VERTICAL_SPEED_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: Number.POSITIVE_INFINITY, gravityMps2: 9.8 }), 'VERTICAL_SPEED_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: 20, gravityMps2: 0 }), 'GRAVITY_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: 20, gravityMps2: -9.8 }), 'GRAVITY_NOT_POSITIVE');
  expectRangeError(() => maxHeightOf({ verticalSpeedMps: 20, gravityMps2: Number.NaN }), 'GRAVITY_NOT_POSITIVE');
  expectRangeError(() => flightTimeOf({ verticalSpeedMps: 0, gravityMps2: 9.8 }), 'VERTICAL_SPEED_NOT_POSITIVE');
  expectRangeError(() => flightTimeOf({ verticalSpeedMps: 20, gravityMps2: 0 }), 'GRAVITY_NOT_POSITIVE');
});

test('input domain: U0 must be finite (sign is irrelevant to the math, bounds are the schema\'s job)', () => {
  expectRangeError(() => stateAt({ ...EARTH, horizontalSpeedMps: Number.NaN }, 1), 'HORIZONTAL_SPEED_NOT_FINITE');
  expectRangeError(() => simulate({ ...EARTH, horizontalSpeedMps: Number.POSITIVE_INFINITY }, 0.5), 'HORIZONTAL_SPEED_NOT_FINITE');
  // Negative U0 is finite: the engine computes it, hardMin=0 is enforced by the schema.
  const back = stateAt({ horizontalSpeedMps: -10, verticalSpeedMps: 20, gravityMps2: 9.8 }, 1);
  closeTo(back.x, -10, 1e-12);
});

test('stateAt: apex at t = V0/g reaches maxHeightOf, x = U0*t', () => {
  const apex = stateAt(EARTH, 20 / 9.8);
  closeTo(apex.y, maxHeightOf(EARTH), 1e-12);
  closeTo(apex.x, 10 * (20 / 9.8), 1e-12);
});

test('stateAt: clamps t into [0, flightTime] and keeps y >= 0', () => {
  const before = stateAt(EARTH, -5);
  assert.equal(before.t, 0);
  assert.equal(before.x, 0);
  assert.equal(before.y, 0);

  const T = flightTimeOf(EARTH);
  const after = stateAt(EARTH, T + 100);
  assert.equal(after.t, T);
  closeTo(after.x, 10 * T, 1e-12);
  assert.ok(after.y >= 0, `landing frame must clamp y to >= 0, got ${after.y}`);
  closeTo(after.y, 0, 1e-9);
});

test('stateAt: mid-flight point matches y = V0*t - g*t^2/2 exactly', () => {
  const t = 1.5;
  const f = stateAt(EARTH, t);
  closeTo(f.y, 20 * t - (9.8 * t * t) / 2, 1e-12);
  closeTo(f.x, 10 * t, 1e-12);
  assert.equal(f.t, t);
});

test('stateAt: non-finite time is rejected', () => {
  expectRangeError(() => stateAt(EARTH, Number.NaN), 'TIME_NOT_FINITE');
  expectRangeError(() => stateAt(EARTH, Number.POSITIVE_INFINITY), 'TIME_NOT_FINITE');
});

test('simulate: frames at t = i*stepS up to landing plus one exact landing frame', () => {
  // T = 4.081632...; step 1 -> samples t=0..4 (5 frames) + landing frame at T = 6 frames.
  const frames = simulate(EARTH, 1);
  assert.equal(frames.length, 6);
  for (let i = 0; i <= 4; i++) closeTo(frames[i].t, i, 1e-12);
  assert.equal(frames[5].t, flightTimeOf(EARTH));
  assert.ok(frames.every(f => f.y >= 0), 'no frame dips below ground level');
  assert.ok(frames.every(f => Number.isFinite(f.t) && Number.isFinite(f.x) && Number.isFinite(f.y)));
});

test('simulate: exact division appends no extra frame (last sample IS the landing)', () => {
  // V0=10, g=5 -> T=4; step 1 -> frames t=0,1,2,3,4.
  const frames = simulate({ horizontalSpeedMps: 3, verticalSpeedMps: 10, gravityMps2: 5 }, 1);
  assert.equal(frames.length, 5);
  assert.equal(frames[4].t, 4);
  closeTo(frames[4].y, 0, 1e-12);
});

test('simulate: step larger than the flight time still yields launch + landing frames', () => {
  const frames = simulate(EARTH, 1000);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].t, 0);
  assert.equal(frames[1].t, flightTimeOf(EARTH));
});

test('simulate: frame cap — MAX_FRAMES is a hard boundary checked before allocation', () => {
  // V0=15, g=10 -> T=3 s. step=0.001 -> n=3000, exact division -> 3001 frames == MAX_FRAMES: allowed.
  const ok = simulate({ horizontalSpeedMps: 0, verticalSpeedMps: 15, gravityMps2: 10 }, 0.001);
  assert.equal(ok.length, MAX_FRAMES);

  // One sample more (step = 3/3001 -> n=3001 -> 3002 frames) exceeds the cap.
  expectRangeError(
    () => simulate({ horizontalSpeedMps: 0, verticalSpeedMps: 15, gravityMps2: 10 }, 3 / 3001),
    'TOO_MANY_FRAMES',
  );

  // Extreme case: T=4000 s at 1 ms steps.
  expectRangeError(
    () => simulate({ horizontalSpeedMps: 0, verticalSpeedMps: 200, gravityMps2: 0.1 }, 0.001),
    'TOO_MANY_FRAMES',
  );
});

test('simulate: stepS must be finite and > 0', () => {
  expectRangeError(() => simulate(EARTH, 0), 'STEP_NOT_POSITIVE');
  expectRangeError(() => simulate(EARTH, -1), 'STEP_NOT_POSITIVE');
  expectRangeError(() => simulate(EARTH, Number.NaN), 'STEP_NOT_POSITIVE');
});

test('simulate and stateAt agree on every sampled time', () => {
  const step = 0.3;
  const frames = simulate(EARTH, step);
  for (const f of frames) {
    const s: ProjectileFrame = stateAt(EARTH, f.t);
    assert.deepEqual(f, s, `frame at t=${f.t} must equal stateAt(input, ${f.t})`);
  }
});

test('simulate: y never exceeds maxHeight and peaks at the apex sample', () => {
  const frames = simulate({ horizontalSpeedMps: 5, verticalSpeedMps: 30, gravityMps2: 9.8 }, 0.05);
  const hMax = maxHeightOf({ verticalSpeedMps: 30, gravityMps2: 9.8 });
  let peak = 0;
  for (const f of frames) {
    assert.ok(f.y >= 0);
    assert.ok(f.y <= hMax + 1e-9, `y=${f.y} must not exceed maxHeight=${hMax}`);
    if (f.y > peak) peak = f.y;
  }
  closeTo(peak, hMax, 0.05 * 30, 'a fine step comes near the analytic apex');
});

test('determinism: repeated calls return identical frames', () => {
  assert.deepEqual(simulate(EARTH, 0.25), simulate(EARTH, 0.25));
  assert.deepEqual(stateAt(EARTH, 1.25), stateAt(EARTH, 1.25));
});
