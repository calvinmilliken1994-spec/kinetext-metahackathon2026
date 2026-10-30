/// <reference types="node" />
// Stage 7 item 1: every engine view opens on the lesson's FIRST case (clamped to the slider range); spec defaults only
// when there is no case. `defaultInputs` keeps its name and now returns these opening inputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { makeLiftSpec, makeProjectileSpec, makeSoundSpec } from '../../../../packages/validation/fixtures/engine-specs.ts';
import { makeCompoundInterestSpec, makeHalfLifeSpec, makeHardyWeinbergSpec } from './engine-fixtures.ts';
import { defaultInputs, engineOutput, projectileSummary, sliderModels } from './engines.ts';
import { makeMoonSpec, MOON_SOURCE_TEXT } from './moon-fixture.ts';

function makeForcesSpec(): ActivitySpec {
  const base = makeProjectileSpec();
  return {
    ...base,
    simulation: {
      engine: 'forces-1d-v1', equation: 'a=F_net/m', durationS: 5, stepS: 0.02, observables: ['position', 'velocity', 'acceleration'],
      massKg: { unit: 'kg', min: 1, max: 20, default: 2 },
      netForceN: { unit: 'N', min: -50, max: 50, default: 10 },
      scenario: { objectLabel: 'Cart', surfaceLabel: 'Frictionless track' },
    },
    behavioralTests: [{ name: 'push', massKg: 4, netForceN: 12, expectedAccelerationMps2: 3, tolerance: 0.001 }],
    predictions: [{ id: 'heavy-cart', prompt: 'A 5 kg cart is pushed with 20 N. What is its acceleration?', massKg: 5, netForceN: 20, expectedAccelerationMps2: 4, tolerance: 0.001 }],
  } as unknown as ActivitySpec;
}

test('the Moon fixture text is the stored source byte for byte (sha256 from the spec)', () => {
  const sha = createHash('sha256').update(MOON_SOURCE_TEXT, 'utf8').digest('hex');
  assert.equal(sha, 'accf5f60ebedb3b3ab1f553ec33a9f500ad353e682cdf88b8e45c99a57ca6ac1');
});

test('Moon lesson opens on its first case: g = 1.62, U0 = 20, V0 = 15 → max height 69.44 m (not the 9.8 default)', () => {
  const spec = makeMoonSpec();
  const open = defaultInputs(spec);
  assert.deepEqual(open, { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 1.62 });
  const s = projectileSummary(open);
  assert.ok(s !== null);
  assert.ok(Math.abs(s.maxHeightM - 69.4444) < 1e-3, `max height ${s.maxHeightM}`);
});

test('opening inputs come from predictions[0] for every engine', () => {
  const specs: ActivitySpec[] = [
    makeForcesSpec(), makeProjectileSpec(), makeLiftSpec(), makeSoundSpec(), makeCompoundInterestSpec(), makeHardyWeinbergSpec(), makeHalfLifeSpec(),
  ];
  for (const spec of specs) {
    const first = spec.predictions[0] as unknown as Record<string, number>;
    const open = defaultInputs(spec);
    const keys = sliderModels(spec).map((m) => m.key);
    assert.deepEqual(Object.keys(open), keys, spec.simulation.engine);
    for (const k of keys) assert.equal(open[k], first[k], `${spec.simulation.engine}.${k}`);
    // The opening value is the first case's engine value, so "Run it" on case 1 does not move the sliders.
    assert.equal(engineOutput(spec.simulation.engine as never, open), engineOutput(spec.simulation.engine as never, first));
  }
});

test('sound / half-life / Hardy-Weinberg open on their case, not the slider default', () => {
  assert.deepEqual(defaultInputs(makeSoundSpec()), { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 320 });
  assert.deepEqual(defaultInputs(makeHalfLifeSpec()), { initialAmount: 200, halfLife: 10, elapsedTime: 30 });
  assert.deepEqual(defaultInputs(makeHardyWeinbergSpec()), { alleleFrequencyP: 0.9 });
});

test('a first-case value outside the slider range is clamped to the range', () => {
  const spec = makeMoonSpec();
  spec.predictions[0] = { ...spec.predictions[0]!, gravityMps2: 1.2, verticalSpeedMps: 99 };
  assert.deepEqual(defaultInputs(spec), { horizontalSpeedMps: 20, verticalSpeedMps: 30, gravityMps2: 1.6 });
});

test('no case → the spec defaults; a case missing an input → that input keeps its default', () => {
  const none = makeMoonSpec();
  none.predictions = [];
  assert.deepEqual(defaultInputs(none), { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 9.8 });
  const partial = makeMoonSpec() as unknown as { predictions: Record<string, unknown>[] };
  delete partial.predictions[0]!['gravityMps2'];
  partial.predictions[0]!['verticalSpeedMps'] = 'fast';
  assert.deepEqual(defaultInputs(partial as unknown as ActivitySpec), { horizontalSpeedMps: 20, verticalSpeedMps: 15, gravityMps2: 9.8 });
});
