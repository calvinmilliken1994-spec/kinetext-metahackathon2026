// TASK-012 — speed-of-sound-v1 engine tests.
// Run: node --test packages/activities/speed-of-sound-v1/engine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_ID, speedOfSoundOf, wavefrontRadiusAt } from './engine.ts';
import type { SoundInput } from './engine.ts';

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

/** Dry air near sea level: gamma=1.4, R=287 J/(kg*K), T=288.15 K (15 °C). */
const AIR: SoundInput = { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15 };

test('module constant', () => {
  assert.equal(ENGINE_ID, 'speed-of-sound-v1');
});

test('speedOfSoundOf known value: gamma=1.4, R=287, T=288.15 -> 340.2626... m/s', () => {
  const a = speedOfSoundOf(AIR);
  closeTo(a, 340.2626485525556, 1e-12);
  assert.equal(a, Math.sqrt(1.4 * 287 * 288.15));
  // The often-quoted 340.29 m/s at 15 °C uses R=287.05; with R=287 the value is 340.26.
  closeTo(speedOfSoundOf({ ...AIR, gasConstantJPerKgK: 287.05 }), 340.29, 0.01);
});

test('speedOfSoundOf: cold air T=200 K -> 283.478... m/s; hotter gas is faster', () => {
  closeTo(speedOfSoundOf({ ...AIR, temperatureK: 200 }), 283.4783942384322, 1e-12);
  assert.ok(speedOfSoundOf({ ...AIR, temperatureK: 320 }) > speedOfSoundOf(AIR));
});

test('speedOfSoundOf: a ∝ sqrt(T) — quadrupling T doubles a', () => {
  const base = speedOfSoundOf(AIR);
  closeTo(speedOfSoundOf({ ...AIR, temperatureK: 4 * 288.15 }), 2 * base, 1e-9);
});

test('speedOfSoundOf: helium-like gas (gamma=1.66, R=2077, T=288.15) is much faster', () => {
  closeTo(speedOfSoundOf({ gamma: 1.66, gasConstantJPerKgK: 2077, temperatureK: 288.15 }), Math.sqrt(1.66 * 2077 * 288.15), 1e-9);
});

test('speedOfSoundOf: T=0 K gives a=0 (schema hardMin keeps specs at T >= 50)', () => {
  assert.equal(speedOfSoundOf({ ...AIR, temperatureK: 0 }), 0);
});

test('input domain: gamma >= 0 finite, R > 0 finite, T >= 0 finite (RangeError, message = code)', () => {
  expectRangeError(() => speedOfSoundOf({ ...AIR, gamma: Number.NaN }), 'GAMMA_NEGATIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, gamma: -1.4 }), 'GAMMA_NEGATIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, gasConstantJPerKgK: 0 }), 'GAS_CONSTANT_NOT_POSITIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, gasConstantJPerKgK: -287 }), 'GAS_CONSTANT_NOT_POSITIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, gasConstantJPerKgK: Number.POSITIVE_INFINITY }), 'GAS_CONSTANT_NOT_POSITIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, temperatureK: -1 }), 'TEMPERATURE_NEGATIVE');
  expectRangeError(() => speedOfSoundOf({ ...AIR, temperatureK: Number.NaN }), 'TEMPERATURE_NEGATIVE');
});

test('wavefrontRadiusAt: radius = a*t for the UI wavefront animation', () => {
  const a = speedOfSoundOf(AIR);
  closeTo(wavefrontRadiusAt(AIR, 2), 2 * a, 1e-9);
  assert.equal(wavefrontRadiusAt(AIR, 0), 0);
  // Linear in t.
  closeTo(wavefrontRadiusAt(AIR, 0.5) * 2, wavefrontRadiusAt(AIR, 1), 1e-9);
});

test('wavefrontRadiusAt: negative t clamps to 0; non-finite t is rejected', () => {
  assert.equal(wavefrontRadiusAt(AIR, -3), 0);
  expectRangeError(() => wavefrontRadiusAt(AIR, Number.NaN), 'TIME_NOT_FINITE');
  expectRangeError(() => wavefrontRadiusAt(AIR, Number.POSITIVE_INFINITY), 'TIME_NOT_FINITE');
  // Inputs are validated before the time.
  expectRangeError(() => wavefrontRadiusAt({ ...AIR, gasConstantJPerKgK: 0 }, 1), 'GAS_CONSTANT_NOT_POSITIVE');
});

test('determinism: repeated calls return identical values', () => {
  assert.equal(speedOfSoundOf(AIR), speedOfSoundOf(AIR));
  assert.equal(wavefrontRadiusAt(AIR, 1.5), wavefrontRadiusAt(AIR, 1.5));
});
