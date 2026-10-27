// TASK-012 — lift-equation-v1 engine tests.
// Run: node --test packages/activities/lift-equation-v1/engine.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINE_ID, liftOf } from './engine.ts';
import type { LiftInput } from './engine.ts';

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

const CRUISE: LiftInput = { liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 50, wingAreaM2: 16 };

test('module constant', () => {
  assert.equal(ENGINE_ID, 'lift-equation-v1');
});

test('liftOf known value: Cl=0.5, rho=1.225, V=50, A=16 -> 12250 N', () => {
  closeTo(liftOf(CRUISE), 12250, 1e-9);
});

test('liftOf: doubling V quadruples the lift (V^2 law); doubling A or Cl doubles it', () => {
  const base = liftOf(CRUISE);
  closeTo(liftOf({ ...CRUISE, airspeedMps: 100 }), 4 * base, 1e-6);
  closeTo(liftOf({ ...CRUISE, wingAreaM2: 32 }), 2 * base, 1e-9);
  closeTo(liftOf({ ...CRUISE, liftCoefficient: 1 }), 2 * base, 1e-9);
});

test('liftOf: zero airspeed and zero Cl produce zero lift', () => {
  assert.equal(liftOf({ ...CRUISE, airspeedMps: 0 }), 0);
  assert.equal(liftOf({ ...CRUISE, liftCoefficient: 0 }), 0);
});

test('liftOf: negative Cl produces negative lift (downward force)', () => {
  closeTo(liftOf({ ...CRUISE, liftCoefficient: -0.5 }), -12250, 1e-9);
});

test('liftOf: slow flight Cl=1.2, rho=1.225, V=30, A=10 -> 6615 N', () => {
  closeTo(liftOf({ liftCoefficient: 1.2, airDensityKgM3: 1.225, airspeedMps: 30, wingAreaM2: 10 }), 6615, 1e-9);
});

test('input domain: every input must satisfy its math domain (RangeError, message = code)', () => {
  const bad = (mut: Partial<LiftInput>): LiftInput => ({ ...CRUISE, ...mut });
  for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -Number.POSITIVE_INFINITY]) {
    expectRangeError(() => liftOf(bad({ liftCoefficient: v })), 'LIFT_COEFFICIENT_NOT_FINITE');
    expectRangeError(() => liftOf(bad({ airspeedMps: v })), 'AIRSPEED_NOT_FINITE');
    expectRangeError(() => liftOf(bad({ airDensityKgM3: v })), 'AIR_DENSITY_NOT_POSITIVE');
    expectRangeError(() => liftOf(bad({ wingAreaM2: v })), 'WING_AREA_NOT_POSITIVE');
  }
  // rho and A are design-narrowed to > 0 (rho=0, A=0 are degenerate: catalog exclusiveMin).
  expectRangeError(() => liftOf(bad({ airDensityKgM3: 0 })), 'AIR_DENSITY_NOT_POSITIVE');
  expectRangeError(() => liftOf(bad({ airDensityKgM3: -1.225 })), 'AIR_DENSITY_NOT_POSITIVE');
  expectRangeError(() => liftOf(bad({ wingAreaM2: 0 })), 'WING_AREA_NOT_POSITIVE');
  expectRangeError(() => liftOf(bad({ wingAreaM2: -16 })), 'WING_AREA_NOT_POSITIVE');
});

test('determinism: repeated calls return identical values', () => {
  assert.equal(liftOf(CRUISE), liftOf(CRUISE));
  assert.equal(liftOf({ ...CRUISE, airspeedMps: 77.7 }), liftOf({ ...CRUISE, airspeedMps: 77.7 }));
});
