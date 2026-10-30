/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES } from '../../../../packages/contracts/index.ts';
import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { makeLiftSpec, makeProjectileSpec, makeSoundSpec } from '../../../../packages/validation/fixtures/engine-specs.ts';
import { makeCompoundInterestSpec, makeHalfLifeSpec, makeHardyWeinbergSpec } from './engine-fixtures.ts';
import { accelerationOf } from '../../../../packages/activities/forces-1d/engine.ts';
import { liftOf } from '../../../../packages/activities/lift-equation-v1/engine.ts';
import { speedOfSoundOf } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import { amountAfter } from '../../../../packages/activities/compound-interest-v1/engine.ts';
import { heterozygoteFrequencyOf } from '../../../../packages/activities/hardy-weinberg-v1/engine.ts';
import { remainingAfter } from '../../../../packages/activities/half-life-v1/engine.ts';
import {
  activityTitles, caseInputs, clampToSlider, defaultInputs, engineOutput, engineTitle, formatOutputValue, formatQuantity, isEngineSpec, outputInfo,
  playbackPlan, playbackSpeed, predictionExplanation, prettyUnit, projectileSummary, rangeMaxima, scenarioLabels, shortInputLabel,
  sliderModels, SOUND_INITIAL_T,
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
  assert.equal(v0.value, 30); // fixture default = its first prediction (semantic.opening-case)
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

test('defaultInputs (opening case) / rangeMaxima / clampToSlider', () => {
  const spec = makeSoundSpec();
  // Stage 7: the view opens on the first prediction (hot day, 320 K), not the slider default 288.15 K.
  assert.deepEqual(defaultInputs(spec), { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 320 });
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

// ---- TASK-022: compound interest, Hardy-Weinberg, half-life ------------------------------------------------

test('engineTitle: catalogue titles for the three non-physics engines', () => {
  assert.equal(engineTitle('compound-interest-v1'), 'Compound interest');
  assert.equal(engineTitle('hardy-weinberg-v1'), 'Hardy-Weinberg genotype frequencies');
  assert.equal(engineTitle('half-life-v1'), 'Radioactive decay and half-life');
});

test('isEngineSpec dispatches the three new engines and nothing else', () => {
  const c: ActivitySpec = makeCompoundInterestSpec();
  const h: ActivitySpec = makeHardyWeinbergSpec();
  const l: ActivitySpec = makeHalfLifeSpec();
  assert.equal(isEngineSpec(c, 'compound-interest-v1'), true);
  assert.equal(isEngineSpec(h, 'hardy-weinberg-v1'), true);
  assert.equal(isEngineSpec(l, 'half-life-v1'), true);
  assert.equal(isEngineSpec(c, 'half-life-v1'), false);
  assert.equal(isEngineSpec(h, 'compound-interest-v1'), false);
  assert.equal(isEngineSpec(l, 'hardy-weinberg-v1'), false);
});

test('prettyUnit: the generic time unit reads "time units"; per-year and USD pass through', () => {
  assert.equal(prettyUnit('time'), 'time units');
  assert.equal(prettyUnit('per year'), 'per year');
  assert.equal(prettyUnit('USD'), 'USD');
  assert.equal(prettyUnit('%'), '%');
});

test('shortInputLabel drops the trailing explanatory parenthesis only', () => {
  assert.equal(shortInputLabel('Starting amount N0 (any unit: grams, atoms or percent)'), 'Starting amount N0');
  assert.equal(shortInputLabel('Half-life T (same time unit as t)'), 'Half-life T');
  assert.equal(shortInputLabel('Mass'), 'Mass');
  assert.equal(shortInputLabel('(only)'), '(only)');
});

test('sliderModels: compound interest has four sliders with the spec ranges and the catalogue units', () => {
  const models = sliderModels(makeCompoundInterestSpec());
  assert.deepEqual(models.map((m) => m.key), ['principalUSD', 'annualRatePercent', 'compoundsPerYear', 'years']);
  assert.deepEqual(models.map((m) => m.unit), ['USD', '%', 'per year', 'years']);
  assert.deepEqual(models.map((m) => m.value), [1000, 5, 1, 10]);
  assert.deepEqual(models.map((m) => [m.min, m.max]), [[100, 10000], [0, 15], [1, 365], [1, 40]]);
});

test('sliderModels: Hardy-Weinberg has one dimensionless slider, half-life three with generic time units', () => {
  const hw = sliderModels(makeHardyWeinbergSpec());
  assert.deepEqual(hw.map((m) => [m.key, m.unit, m.min, m.max, m.value]), [['alleleFrequencyP', '', 0, 1, 0.9]]);
  assert.ok((hw[0]?.step ?? 0) > 0 && (hw[0]?.step ?? 1) <= 0.05);
  const hl = sliderModels(makeHalfLifeSpec());
  assert.deepEqual(hl.map((m) => m.key), ['initialAmount', 'halfLife', 'elapsedTime']);
  assert.deepEqual(hl.map((m) => m.unit), ['', 'time units', 'time units']);
  assert.deepEqual(hl.map((m) => m.value), [200, 10, 30], 'slider defaults equal the first case (semantic.opening-case)');
  assert.deepEqual(defaultInputs(makeHalfLifeSpec()), { initialAmount: 200, halfLife: 10, elapsedTime: 30 });
  assert.deepEqual(rangeMaxima(makeHalfLifeSpec()), { initialAmount: 200, halfLife: 20, elapsedTime: 80 });
});

test('scenarioLabels for the three new engines come from settingLabel', () => {
  assert.deepEqual(scenarioLabels(makeCompoundInterestSpec()), { objectLabel: 'Savings account', placeLabel: 'Fixed annual rate', placeKind: 'setting' });
  assert.deepEqual(scenarioLabels(makeHardyWeinbergSpec()), { objectLabel: 'Flower colour gene', placeLabel: 'Large random-mating population', placeKind: 'setting' });
  assert.deepEqual(scenarioLabels(makeHalfLifeSpec()), { objectLabel: 'Radioactive sample', placeLabel: 'Sealed laboratory container', placeKind: 'setting' });
});

test('outputInfo for the three new engines: label from the catalogue; USD only for money, no invented units elsewhere', () => {
  assert.deepEqual(outputInfo('compound-interest-v1'), { key: 'expectedAmountUSD', label: 'Amount after t years', unit: 'USD' });
  assert.deepEqual(outputInfo('hardy-weinberg-v1'), { key: 'expectedHeterozygoteFrequency', label: 'Heterozygote frequency 2pq', unit: '' });
  assert.deepEqual(outputInfo('half-life-v1'), { key: 'expectedRemaining', label: 'Amount remaining N', unit: '' });
});

test('engineOutput recomputes the three new engines and ignores a lying stored expectation', () => {
  const c = { ...makeCompoundInterestSpec().predictions[0]!, expectedAmountUSD: 1 };
  assert.equal(engineOutput('compound-interest-v1', c), amountAfter({ principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 1, years: 10 }));
  assert.equal(engineOutput('compound-interest-v1', c), 1628.894626777442);
  const h = { ...makeHardyWeinbergSpec().predictions[0]!, expectedHeterozygoteFrequency: 0.5 };
  assert.equal(engineOutput('hardy-weinberg-v1', h), heterozygoteFrequencyOf(0.9));
  const l = { ...makeHalfLifeSpec().predictions[0]!, expectedRemaining: 999 };
  assert.equal(engineOutput('half-life-v1', l), remainingAfter({ initialAmount: 200, halfLife: 10, elapsedTime: 30 }));
  assert.equal(engineOutput('half-life-v1', l), 25);
});

test('engineOutput returns null when a new engine rejects the inputs', () => {
  assert.equal(engineOutput('compound-interest-v1', { principalUSD: 0, annualRatePercent: 5, compoundsPerYear: 1, years: 10 }), null);
  assert.equal(engineOutput('compound-interest-v1', { principalUSD: 100, annualRatePercent: 5, compoundsPerYear: 0, years: 10 }), null);
  assert.equal(engineOutput('hardy-weinberg-v1', { alleleFrequencyP: 1.5 }), null);
  assert.equal(engineOutput('half-life-v1', { initialAmount: 10, halfLife: 0, elapsedTime: 5 }), null);
  assert.equal(engineOutput('half-life-v1', {}), null);
});

test('playbackPlan: the three new views are static charts, not time animations', () => {
  assert.equal(playbackPlan('compound-interest-v1', {}), null);
  assert.equal(playbackPlan('hardy-weinberg-v1', {}), null);
  assert.equal(playbackPlan('half-life-v1', {}), null);
});

test('caseInputs extracts the engine input keys of the new engines', () => {
  assert.deepEqual(caseInputs('half-life-v1', makeHalfLifeSpec().predictions[1]!), { initialAmount: 80, halfLife: 8, elapsedTime: 12 });
  assert.deepEqual(caseInputs('hardy-weinberg-v1', makeHardyWeinbergSpec().predictions[0]!), { alleleFrequencyP: 0.9 });
});

test('formatOutputValue: cents for money, four decimals for frequencies, readable amounts for decay, unchanged elsewhere', () => {
  assert.equal(formatOutputValue('compound-interest-v1', 1628.894626777442), '1,628.89');
  assert.equal(formatOutputValue('compound-interest-v1', 12345678.9), '12,345,678.90');
  assert.equal(formatOutputValue('hardy-weinberg-v1', 0.17999999999999997), '0.18');
  assert.equal(formatOutputValue('hardy-weinberg-v1', 0.0475), '0.0475');
  assert.equal(formatOutputValue('half-life-v1', 28.284271247461902), '28.28');
  assert.equal(formatOutputValue('half-life-v1', 0.0625), '0.0625');
  for (const e of ['forces-1d-v1', 'projectile-v1', 'lift-equation-v1', 'speed-of-sound-v1'] as const) {
    assert.equal(formatOutputValue(e, 12250), formatQuantity(12250));
    assert.equal(formatOutputValue(e, 20.408163), formatQuantity(20.408163));
  }
});

test('predictionExplanation for the new engines: short input labels, engine output, no invented units', () => {
  const c = predictionExplanation('compound-interest-v1', makeCompoundInterestSpec().predictions[0]!, 1628.894626777442);
  assert.ok(c.includes('Starting amount P = 1000 USD'), c);
  assert.ok(c.includes('Compounding periods per year n = 1 per year'), c);
  assert.ok(c.endsWith('amount after t years = 1,628.89 USD'), c);
  const h = predictionExplanation('hardy-weinberg-v1', makeHardyWeinbergSpec().predictions[0]!, 0.17999999999999997);
  assert.equal(h, 'Frequency p of the first allele = 0.9 → heterozygote frequency 2pq = 0.18');
  const l = predictionExplanation('half-life-v1', makeHalfLifeSpec().predictions[0]!, 25);
  assert.equal(l, 'Starting amount N0 = 200, Half-life T = 10 time units, Elapsed time t = 30 time units → amount remaining n = 25');
});

// ---- TASK-022b: timeline-v1 metadata -----------------------------------------------------------------------

test('engineTitle: the sequence engine timeline-v1 is titled from SEQUENCE_ENGINES', () => {
  assert.equal(engineTitle('timeline-v1'), 'Timeline of dated events');
  assert.equal(engineTitle('timeline-v2'), null);
});

test('timeline-v1 has no playback plan and activityTitles lists every activity type Muse can choose', () => {
  assert.equal(playbackPlan('timeline-v1', {}), null);
  const titles = activityTitles();
  assert.ok(titles.includes('Timeline of dated events'));
  assert.ok(titles.includes('Compound interest'));
  assert.equal(new Set(titles).size, titles.length);
});
