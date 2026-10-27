// TASK-012 — activity engine registry tests.
// Run: node --test packages/activities/registry.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';

import { computeOutput, inputKeys, outputKey } from './registry.ts';
import { accelerationOf } from './forces-1d/engine.ts';
import { maxHeightOf } from './projectile-v1/engine.ts';
import { liftOf } from './lift-equation-v1/engine.ts';
import { speedOfSoundOf } from './speed-of-sound-v1/engine.ts';
import { ENGINES, ENGINE_IDS } from '../contracts/index.ts';
import type { ActivityCase, LiftCase, ProjectileCase, SoundCase, ForcesCase } from '../contracts/index.ts';

function closeTo(actual: number, expected: number, tol: number, msg?: string): void {
  assert.ok(Math.abs(actual - expected) <= tol, msg ?? `expected ${actual} to be within ${tol} of ${expected}`);
}

const forcesCase: ForcesCase & { name: string } = {
  name: 'positive force', massKg: 2, netForceN: 4, expectedAccelerationMps2: 2, tolerance: 1e-6,
};
const projectileCase: ProjectileCase & { name: string } = {
  name: 'earth launch', horizontalSpeedMps: 10, verticalSpeedMps: 20, gravityMps2: 9.8,
  expectedMaxHeightM: 20.408163, tolerance: 0.001,
};
const liftCase: LiftCase & { name: string } = {
  name: 'cruise lift', liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 50, wingAreaM2: 16,
  expectedLiftN: 12250, tolerance: 0.5,
};
const soundCase: SoundCase & { name: string } = {
  name: 'sea level air', gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15,
  expectedSpeedMps: 340.2626, tolerance: 0.01,
};

test('computeOutput dispatches to the forces-1d engine', () => {
  assert.equal(computeOutput('forces-1d-v1', forcesCase), accelerationOf(2, 4));
  assert.equal(computeOutput('forces-1d-v1', forcesCase), 2);
});

test('computeOutput dispatches to the projectile engine (checked output = max height)', () => {
  const h = computeOutput('projectile-v1', projectileCase);
  closeTo(h, 20.408163265306122, 1e-12);
  assert.equal(h, maxHeightOf({ verticalSpeedMps: 20, gravityMps2: 9.8 }));
});

test('computeOutput dispatches to the lift engine', () => {
  const L = computeOutput('lift-equation-v1', liftCase);
  closeTo(L, 12250, 1e-9);
  assert.equal(L, liftOf({ liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 50, wingAreaM2: 16 }));
});

test('computeOutput dispatches to the speed-of-sound engine', () => {
  const a = computeOutput('speed-of-sound-v1', soundCase);
  closeTo(a, 340.2626485525556, 1e-12);
  assert.equal(a, speedOfSoundOf({ gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15 }));
});

test('computeOutput accepts a plain inputs record (caseOrInputs) and ignores extra keys', () => {
  assert.equal(
    computeOutput('projectile-v1', { horizontalSpeedMps: 0, verticalSpeedMps: 20, gravityMps2: 9.8 }),
    maxHeightOf({ verticalSpeedMps: 20, gravityMps2: 9.8 }),
  );
  // name/tolerance/expected* on a case are not engine inputs and are ignored.
  assert.equal(computeOutput('forces-1d-v1', { massKg: 4, netForceN: -8, tolerance: 999 } as unknown as ActivityCase), -2);
});

test('computeOutput reads exactly the descriptor input keys for every engine', () => {
  const probe: Record<string, number> = {
    massKg: 5, netForceN: 10,
    horizontalSpeedMps: 7, verticalSpeedMps: 14, gravityMps2: 7,
    liftCoefficient: 1, airDensityKgM3: 1, airspeedMps: 10, wingAreaM2: 2,
    gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 250,
  };
  assert.equal(computeOutput('forces-1d-v1', probe), 10 / 5);
  closeTo(computeOutput('projectile-v1', probe), 14 * 14 / (2 * 7), 1e-12);
  closeTo(computeOutput('lift-equation-v1', probe), 1 * 1 * 100 / 2 * 2, 1e-12);
  closeTo(computeOutput('speed-of-sound-v1', probe), Math.sqrt(1.4 * 287 * 250), 1e-12);
  // Every engine's descriptor keys are present in the probe: nothing fell back to NaN.
  for (const id of ENGINE_IDS) {
    for (const key of inputKeys(id)) assert.ok(key in probe, `${id} input key ${key} covered by the probe`);
  }
});

test('computeOutput: a missing descriptor input key becomes NaN and the engine rejects it', () => {
  const partial = { verticalSpeedMps: 20 } as unknown as ActivityCase; // no gravityMps2
  assert.throws(
    () => computeOutput('projectile-v1', partial),
    (err: unknown) => err instanceof RangeError && err.message === 'GRAVITY_NOT_POSITIVE',
  );
  const noRho = { liftCoefficient: 0.5, airspeedMps: 50, wingAreaM2: 16 } as unknown as ActivityCase;
  assert.throws(
    () => computeOutput('lift-equation-v1', noRho),
    (err: unknown) => err instanceof RangeError && err.message === 'AIR_DENSITY_NOT_POSITIVE',
  );
});

test('computeOutput: non-finite case inputs are rejected with the engine error codes', () => {
  assert.throws(
    () => computeOutput('forces-1d-v1', { ...forcesCase, massKg: Number.NaN }),
    (err: unknown) => err instanceof RangeError && err.message === 'MASS_NOT_POSITIVE',
  );
  assert.throws(
    () => computeOutput('speed-of-sound-v1', { ...soundCase, temperatureK: Number.NaN }),
    (err: unknown) => err instanceof RangeError && err.message === 'TEMPERATURE_NEGATIVE',
  );
});

test('computeOutput: an unknown engine id throws RangeError UNKNOWN_ENGINE:<id>', () => {
  assert.throws(
    () => computeOutput('drag-v1' as never, forcesCase),
    (err: unknown) => err instanceof RangeError && err.message === 'UNKNOWN_ENGINE:drag-v1',
  );
});

test('inputKeys and outputKey mirror the ENGINES catalogue', () => {
  for (const id of ENGINE_IDS) {
    assert.deepEqual(inputKeys(id), ENGINES[id].inputs.map(i => i.key));
    assert.equal(outputKey(id), ENGINES[id].output.key);
  }
  assert.deepEqual(inputKeys('projectile-v1'), ['horizontalSpeedMps', 'verticalSpeedMps', 'gravityMps2']);
  assert.equal(outputKey('lift-equation-v1'), 'expectedLiftN');
  assert.equal(outputKey('speed-of-sound-v1'), 'expectedSpeedMps');
  assert.equal(outputKey('forces-1d-v1'), 'expectedAccelerationMps2');
});

test('computeOutput never returns NaN for valid inputs and is deterministic', () => {
  for (const [id, c] of [
    ['forces-1d-v1', forcesCase],
    ['projectile-v1', projectileCase],
    ['lift-equation-v1', liftCase],
    ['speed-of-sound-v1', soundCase],
  ] as const) {
    const v = computeOutput(id, c);
    assert.ok(Number.isFinite(v), `${id} output is finite`);
    assert.equal(v, computeOutput(id, c), `${id} is deterministic`);
  }
});
