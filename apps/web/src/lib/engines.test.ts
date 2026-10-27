/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../../../../packages/contracts/index.ts';
import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { makeLiftSpec, makeProjectileSpec, makeSoundSpec } from '../../../../packages/validation/fixtures/engine-specs.ts';
import { accelerationOf } from '../../../../packages/activities/forces-1d/engine.ts';
import { liftOf } from '../../../../packages/activities/lift-equation-v1/engine.ts';
import { speedOfSoundOf } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import {
  caseInputs, clampToSlider, defaultInputs, engineOutput, engineTitle, formatQuantity, isEngineSpec, outputInfo, playbackPlan,
  playbackSpeed, predictionExplanation, prettyUnit, projectileSummary, rangeMaxima, scenarioLabels, sliderModels,
  SOUND_INITIAL_T,
} from './engines.ts';

test('engineTitle: catalogue titles for the four engines, null otherwise', () => {
  assert.equal(engineTitle('lift-equation-v1'), 'Lift equation');
  assert.equal(engineTitle('projectile-v1'), 'Ballistic flight without drag');
  assert.equal(engineTitle('speed-of-sound-v1'), 'Speed of sound in a gas');
  assert.equal(engineTitle('forces-1d-v1'), ENGINES['forces-1d-v1'].title);
  assert.equal(engineTitle(null), null);
  assert.equal(engineTitle(undefined), null);
  assert.equal(engineTitle('warp-drive-v9'), null);
});

test('isEngineSpec narrows by simulation.engine', () => {
  const p: ActivitySpec = makeProjectileSpec();
  assert.equal(isEngineSpec(p, 'projectile-v1'), true);
  assert.equal(isEngineSpec(p, 'lift-equation-v1'), false);
});

test('prettyUnit: superscripts, dots, dimensionless', () => {
  assert.equal(prettyUnit('m/s^2'), 'm/s²');
  assert.equal(prettyUnit('kg/m^3'), 'kg/m³');
  assert.equal(prettyUnit('J/(kg*K)'), 'J/(kg·K)');
  assert.equal(prettyUnit('1'), '');
  assert.equal(prettyUnit('N'), 'N');
});

test('sliderModels: one slider per engine input with the spec range, default and unit', () => {
  const models = sliderModels(makeProjectileSpec());
  assert.deepEqual(models.map((m) => m.key), ['horizontalSpeedMps', 'verticalSpeedMps', 'gravityMps2']);
  const v0 = models[1];
  assert.ok(v0 !== undefined);
  assert.equal(v0.min, 5);
  assert.equal(v0.max, 40);
  assert.equal(v0.value, 20);
  assert.equal(v0.unit, 'm/s');
  assert.equal(v0.label, ENGINES['projectile-v1'].inputs[1]?.label);
  assert.equal(models[2]?.unit, 'm/s²');
  for (const m of models) assert.ok(m.step > 0 && m.step <= (m.max - m.min));

  const lift = sliderModels(makeLiftSpec());
  assert.deepEqual(lift.map((m) => m.key), ['liftCoefficient', 'airDensityKgM3', 'airspeedMps', 'wingAreaM2']);
  assert.equal(lift[0]?.unit, '');
  const sound = sliderModels(makeSoundSpec());
  assert.deepEqual(sound.map((m) => m.key), ['gamma', 'gasConstantJPerKgK', 'temperatureK']);
  assert.equal(sound[1]?.unit, 'J/(kg·K)');
});

test('sliderModels: skips inputs the spec does not carry and survives junk ranges', () => {
  const spec = makeLiftSpec() as unknown as { simulation: Record<string, unknown> };
  spec.simulation['airspeedMps'] = { unit: 'm/s', min: 'x', max: 5, default: 1 };
  delete spec.simulation['wingAreaM2'];
  const keys = sliderModels(spec as unknown as ActivitySpec).map((m) => m.key);
  assert.deepEqual(keys, ['liftCoefficient', 'airDensityKgM3']);
});

test('defaultInputs / rangeMaxima / clampToSlider', () => {
  const spec = makeSoundSpec();
  assert.deepEqual(defaultInputs(spec), { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15 });
  assert.deepEqual(rangeMaxima(spec), { gamma: 1.6, gasConstantJPerKgK: 600, temperatureK: 400 });
  assert.equal(clampToSlider({ min: 1, max: 3 }, 9), 3);
  assert.equal(clampToSlider({ min: 1, max: 3 }, -9), 1);
  assert.equal(clampToSlider({ min: 1, max: 3 }, 2), 2);
});

test('scenarioLabels: settingLabel for the new engines, surfaceLabel for forces', () => {
  assert.deepEqual(scenarioLabels(makeProjectileSpec()), { objectLabel: 'Ball', placeLabel: 'Level playing field', placeKind: 'setting' });
  assert.deepEqual(scenarioLabels(makeLiftSpec()), { objectLabel: 'Model wing', placeLabel: 'Sea-level air', placeKind: 'setting' });
  assert.deepEqual(scenarioLabels(makeSoundSpec()), { objectLabel: 'Sound pulse', placeLabel: 'Dry air', placeKind: 'setting' });
  const forces = { simulation: { engine: 'forces-1d-v1', scenario: { objectLabel: 'Crate', surfaceLabel: 'Ice' } } } as unknown as ActivitySpec;
  assert.deepEqual(scenarioLabels(forces), { objectLabel: 'Crate', placeLabel: 'Ice', placeKind: 'surface' });
});

test('outputInfo: label and display unit come from the catalogue', () => {
  assert.deepEqual(outputInfo('projectile-v1'), { key: 'expectedMaxHeightM', label: 'Maximum height', unit: 'm' });
  assert.deepEqual(outputInfo('lift-equation-v1'), { key: 'expectedLiftN', label: 'Lift', unit: 'N' });
  assert.deepEqual(outputInfo('speed-of-sound-v1'), { key: 'expectedSpeedMps', label: 'Speed of sound', unit: 'm/s' });
  assert.deepEqual(outputInfo('forces-1d-v1'), { key: 'expectedAccelerationMps2', label: 'Acceleration', unit: 'm/s²' });
});

test('engineOutput uses the registry engines, never the stored expectation', () => {
  const lift = makeLiftSpec();
  const p = { ...lift.predictions[0]!, expectedLiftN: 1 }; // a lying stored value must not matter
  assert.equal(engineOutput('lift-equation-v1', p), liftOf({ liftCoefficient: 0.5, airDensityKgM3: 1.5, airspeedMps: 60, wingAreaM2: 16 }));
  assert.equal(engineOutput('lift-equation-v1', p), 21600);
  const sound = makeSoundSpec().predictions[0]!;
  assert.equal(engineOutput('speed-of-sound-v1', sound), speedOfSoundOf({ gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 320 }));
  assert.equal(engineOutput('forces-1d-v1', { massKg: 4, netForceN: 12 }), accelerationOf(4, 12));
  assert.equal(engineOutput('projectile-v1', makeProjectileSpec().predictions[0]!), 45.91836734693877);
});

test('engineOutput returns null (never NaN or a throw) when the engine rejects the inputs', () => {
  assert.equal(engineOutput('lift-equation-v1', { liftCoefficient: 1, airDensityKgM3: 0, airspeedMps: 10, wingAreaM2: 1 }), null);
  assert.equal(engineOutput('projectile-v1', { horizontalSpeedMps: 1, verticalSpeedMps: 0, gravityMps2: 9.8 }), null);
  assert.equal(engineOutput('speed-of-sound-v1', {}), null);
});

test('caseInputs extracts the engine input keys from a prediction', () => {
  assert.deepEqual(caseInputs('speed-of-sound-v1', makeSoundSpec().predictions[0]!), { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 320 });
});

test('projectileSummary: max height, flight time and range from the projectile engine', () => {
  const s = projectileSummary({ horizontalSpeedMps: 10, verticalSpeedMps: 20, gravityMps2: 9.8 });
  assert.ok(s !== null);
  assert.ok(Math.abs(s.maxHeightM - 20.408163265306122) < 1e-12);
  assert.ok(Math.abs(s.flightTimeS - 4.081632653061225) < 1e-12);
  assert.ok(Math.abs(s.rangeM - 40.81632653061225) < 1e-9);
  assert.ok(Math.abs(s.apexTimeS - s.flightTimeS / 2) < 1e-12);
  assert.equal(projectileSummary({ horizontalSpeedMps: 10, verticalSpeedMps: 0, gravityMps2: 9.8 }), null);
  assert.equal(projectileSummary({}), null);
});

test('playbackSpeed keeps a flight between 2 and 8 wall-clock seconds', () => {
  assert.equal(playbackSpeed(4), 1);
  assert.equal(playbackSpeed(1), 0.5); // 1 s of flight is slowed to 2 s
  assert.equal(playbackSpeed(40), 5); // 40 s of flight is sped up to 8 s
  assert.equal(playbackSpeed(0), 1);
  assert.equal(playbackSpeed(Number.NaN), 1);
});

test('playbackPlan: projectile = one flight, sound = continuous, lift = none', () => {
  const plan = playbackPlan('projectile-v1', { horizontalSpeedMps: 10, verticalSpeedMps: 20, gravityMps2: 9.8 });
  assert.ok(plan !== null);
  assert.ok(Math.abs(plan.durationS - 4.081632653061225) < 1e-12);
  assert.equal(plan.speed, 1);
  assert.equal(plan.initialT, 0);
  const bad = playbackPlan('projectile-v1', {});
  assert.deepEqual(bad, { durationS: 0, speed: 1, initialT: 0 });
  assert.deepEqual(playbackPlan('speed-of-sound-v1', {}), { durationS: Number.POSITIVE_INFINITY, speed: 1, initialT: SOUND_INITIAL_T });
  assert.equal(playbackPlan('lift-equation-v1', {}), null);
  assert.equal(playbackPlan('forces-1d-v1', {}), null);
});

test('formatQuantity: grouping for large values, trimmed decimals for small ones', () => {
  assert.equal(formatQuantity(12250), '12,250');
  assert.equal(formatQuantity(1234567.89), '1,234,567.9');
  assert.equal(formatQuantity(20.408163), '20.408');
  assert.equal(formatQuantity(340.2626), '340.26');
  assert.equal(formatQuantity(-0.5), '-0.5');
  assert.equal(formatQuantity(Number.NaN), 'NaN');
});

test('predictionExplanation: forces keeps the F/m wording, other engines list inputs and the engine output', () => {
  assert.equal(predictionExplanation('forces-1d-v1', { massKg: 4, netForceN: 12 } as never, 3), 'a = F/m = 12 / 4 = 3.000 m/s²');
  const t = predictionExplanation('lift-equation-v1', makeLiftSpec().predictions[0]!, 21600);
  assert.ok(t.includes('Lift coefficient Cl = 0.5'));
  assert.ok(t.includes('Velocity V = 60 m/s'));
  assert.ok(t.endsWith('lift = 21,600 N'));
  const s = predictionExplanation('speed-of-sound-v1', makeSoundSpec().predictions[0]!, 358.5749572962395);
  assert.ok(s.endsWith('speed of sound = 358.57 m/s'), s);
  assert.ok(s.includes('Absolute temperature T = 320 K'), s);
});
