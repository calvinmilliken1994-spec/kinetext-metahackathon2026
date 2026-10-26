import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ENGINE_ID,
  MAX_FRAMES,
  accelerationOf,
  simulate,
  stateAt,
} from './engine.ts';
import type { Frame, SimulationInput } from './engine.ts';

/** Absolute-tolerance comparison. */
function closeTo(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    msg ?? `expected ${actual} to be within ${tol} of ${expected}`,
  );
}

/** Relative-tolerance comparison (absolute floor of 1 for values near zero). */
function relClose(actual: number, expected: number, relTol: number, msg?: string): void {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= relTol * scale,
    msg ?? `expected ${actual} to be within ${relTol} (rel) of ${expected}`,
  );
}

function expectRangeError(fn: () => unknown, message: string): void {
  assert.throws(
    fn,
    (err: unknown) => err instanceof RangeError && err.message === message,
    `expected RangeError('${message}')`,
  );
}

const BASE_INPUT: SimulationInput = {
  massKg: 2,
  netForceN: 4,
  durationS: 1,
  stepS: 0.25,
};

test('module constants', () => {
  assert.equal(ENGINE_ID, 'forces-1d-v1');
  assert.equal(MAX_FRAMES, 3001);
});

test('accelerationOf: positive force (m=2 kg, F=4 N -> a=2 m/s^2)', () => {
  assert.equal(accelerationOf(2, 4), 2);
});

test('accelerationOf: negative force (m=4 kg, F=-8 N -> a=-2 m/s^2)', () => {
  assert.equal(accelerationOf(4, -8), -2);
});

test('accelerationOf: tiny mass 0.01 kg with 1000 N -> a=100000, finite', () => {
  const a = accelerationOf(0.01, 1000);
  assert.equal(a, 100000);
  assert.ok(Number.isFinite(a));
});

test('zero force: body at rest stays at rest (x0 respected)', () => {
  const frames = simulate({
    massKg: 5,
    netForceN: 0,
    durationS: 2,
    stepS: 0.5,
    x0: 7,
    v0: 0,
  });
  for (const f of frames) {
    assert.equal(f.a, 0);
    assert.equal(f.v, 0);
    assert.equal(f.x, 7);
  }
});

test('zero force: uniform motion respects x0 and v0', () => {
  const frames = simulate({
    massKg: 5,
    netForceN: 0,
    durationS: 2,
    stepS: 0.5,
    x0: 3,
    v0: 4,
  });
  for (const f of frames) {
    assert.equal(f.a, 0);
    assert.equal(f.v, 4);
    closeTo(f.x, 3 + 4 * f.t, 1e-12);
  }
});

test('tiny mass simulation stays finite end to end', () => {
  const frames = simulate({
    massKg: 0.01,
    netForceN: 1000,
    durationS: 0.01,
    stepS: 0.005,
  });
  assert.equal(frames.length, 3);
  for (const f of frames) {
    assert.ok(Number.isFinite(f.t) && Number.isFinite(f.x) && Number.isFinite(f.v));
    assert.equal(f.a, 100000);
  }
});

test('frame count: 5 s / 0.02 s -> 251 frames, last t === 5', () => {
  const frames = simulate({ massKg: 1, netForceN: 1, durationS: 5, stepS: 0.02 });
  assert.equal(frames.length, 251);
  assert.equal(frames[0]!.t, 0);
  closeTo(frames[frames.length - 1]!.t, 5, 1e-12);
});

test('non-divisible duration: 1 s / 0.3 s -> t = [0, 0.3, 0.6, 0.9, 1]', () => {
  const frames = simulate({ massKg: 1, netForceN: 0, durationS: 1, stepS: 0.3 });
  const expectedT = [0, 0.3, 0.6, 0.9, 1];
  assert.equal(frames.length, expectedT.length);
  frames.forEach((f, i) => closeTo(f.t, expectedT[i]!, 1e-12));
  assert.equal(frames[frames.length - 1]!.t, 1); // appended frame is exactly durationS
});

test('MAX_FRAMES boundary: 30 s / 0.01 s -> 3001 frames is allowed', () => {
  const frames = simulate({ massKg: 1, netForceN: 1, durationS: 30, stepS: 0.01 });
  assert.equal(frames.length, MAX_FRAMES);
  assert.equal(frames.length, 3001);
  closeTo(frames[frames.length - 1]!.t, 30, 1e-12);
});

test('MAX_FRAMES boundary: 30 s / 0.009 s -> throws TOO_MANY_FRAMES', () => {
  expectRangeError(
    () => simulate({ massKg: 1, netForceN: 1, durationS: 30, stepS: 0.009 }),
    'TOO_MANY_FRAMES',
  );
});

test('invalid input: mass zero -> MASS_NOT_POSITIVE', () => {
  expectRangeError(() => accelerationOf(0, 10), 'MASS_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, massKg: 0 }), 'MASS_NOT_POSITIVE');
});

test('invalid input: mass negative -> MASS_NOT_POSITIVE', () => {
  expectRangeError(() => accelerationOf(-1, 10), 'MASS_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, massKg: -1 }), 'MASS_NOT_POSITIVE');
});

test('invalid input: mass NaN -> MASS_NOT_POSITIVE', () => {
  expectRangeError(() => accelerationOf(NaN, 10), 'MASS_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, massKg: NaN }), 'MASS_NOT_POSITIVE');
});

test('invalid input: force Infinity -> FORCE_NOT_FINITE', () => {
  expectRangeError(() => accelerationOf(2, Infinity), 'FORCE_NOT_FINITE');
  expectRangeError(() => accelerationOf(2, -Infinity), 'FORCE_NOT_FINITE');
  expectRangeError(() => accelerationOf(2, NaN), 'FORCE_NOT_FINITE');
  expectRangeError(() => simulate({ ...BASE_INPUT, netForceN: Infinity }), 'FORCE_NOT_FINITE');
});

test('invalid input: duration 0 -> DURATION_NOT_POSITIVE', () => {
  expectRangeError(() => simulate({ ...BASE_INPUT, durationS: 0 }), 'DURATION_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, durationS: -1 }), 'DURATION_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, durationS: NaN }), 'DURATION_NOT_POSITIVE');
  expectRangeError(
    () => stateAt({ ...BASE_INPUT, durationS: 0 }, 0),
    'DURATION_NOT_POSITIVE',
  );
});

test('invalid input: step 0 -> STEP_NOT_POSITIVE', () => {
  expectRangeError(() => simulate({ ...BASE_INPUT, stepS: 0 }), 'STEP_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, stepS: -0.5 }), 'STEP_NOT_POSITIVE');
  expectRangeError(() => simulate({ ...BASE_INPUT, stepS: NaN }), 'STEP_NOT_POSITIVE');
  expectRangeError(
    () => stateAt({ ...BASE_INPUT, stepS: 0 }, 0),
    'STEP_NOT_POSITIVE',
  );
});

test('invalid input: v0 NaN -> INITIAL_STATE_NOT_FINITE', () => {
  expectRangeError(() => simulate({ ...BASE_INPUT, v0: NaN }), 'INITIAL_STATE_NOT_FINITE');
  expectRangeError(() => simulate({ ...BASE_INPUT, v0: Infinity }), 'INITIAL_STATE_NOT_FINITE');
  expectRangeError(() => simulate({ ...BASE_INPUT, x0: NaN }), 'INITIAL_STATE_NOT_FINITE');
  expectRangeError(
    () => stateAt({ ...BASE_INPUT, v0: NaN }, 0),
    'INITIAL_STATE_NOT_FINITE',
  );
});

test('determinism: two runs are deep-equal', () => {
  const input: SimulationInput = {
    massKg: 3,
    netForceN: -7.5,
    durationS: 2,
    stepS: 0.1,
    x0: 1.5,
    v0: -2.25,
  };
  assert.deepStrictEqual(simulate(input), simulate(input));
});

test('invariants hold on every frame: closed-form kinematics within 1e-9 relative', () => {
  const input: SimulationInput = {
    massKg: 2,
    netForceN: 5,
    durationS: 3,
    stepS: 0.07,
    x0: -1.25,
    v0: 3.5,
  };
  const a = accelerationOf(input.massKg, input.netForceN);
  const x0 = input.x0!;
  const v0 = input.v0!;
  const frames = simulate(input);
  for (const f of frames) {
    assert.equal(f.a, a, 'acceleration is constant and equals F/m');
    relClose(f.v, v0 + a * f.t, 1e-9, `v invariant at t=${f.t}`);
    relClose(f.x, x0 + v0 * f.t + 0.5 * a * f.t * f.t, 1e-9, `x invariant at t=${f.t}`);
  }
});

test('stateAt equals the matching simulate frame', () => {
  const input: SimulationInput = {
    massKg: 4,
    netForceN: -6,
    durationS: 1,
    stepS: 0.3,
    x0: 2,
    v0: 1,
  };
  const frames: Frame[] = simulate(input);
  for (const f of frames) {
    assert.deepStrictEqual(stateAt(input, f.t), f);
  }
});

test('stateAt clamps t < 0 to 0 and t > durationS to durationS', () => {
  const input: SimulationInput = {
    massKg: 2,
    netForceN: 10,
    durationS: 4,
    stepS: 1,
    x0: 1,
    v0: -1,
  };
  const frames = simulate(input);
  const first = frames[0]!;
  const last = frames[frames.length - 1]!;
  assert.equal(first.t, 0);
  assert.equal(last.t, 4);
  assert.deepStrictEqual(stateAt(input, -100), first);
  assert.deepStrictEqual(stateAt(input, -1e-12), first);
  assert.deepStrictEqual(stateAt(input, 100), last);
  assert.deepStrictEqual(stateAt(input, 4 + 1e-12), last);
  assert.equal(stateAt(input, -5).t, 0);
  assert.equal(stateAt(input, 99).t, 4);
});
