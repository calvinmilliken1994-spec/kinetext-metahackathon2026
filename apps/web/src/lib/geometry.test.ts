/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { speedOfSoundOf, wavefrontRadiusAt } from '../../../../packages/activities/speed-of-sound-v1/engine.ts';
import { liftOf } from '../../../../packages/activities/lift-equation-v1/engine.ts';
import { flowCycleS, flowLineCount, liftArrowPx, liftScaleMax, projectileLayout, ringPx, soundScaleMaxM, wavefronts, wingTiltDeg } from './geometry.ts';

const BOX = { left: 64, right: 764, top: 50, bottom: 250 };

test('projectileLayout: common scale, ground at the bottom, launch at the left, apex inside the box', () => {
  const L = projectileLayout(40, 20, BOX);
  assert.equal(L.scale, Math.min(700 / 40, 200 / 20)); // 10 px/m, height-limited
  assert.deepEqual(L.toPx(0, 0), { px: 64, py: 250 });
  assert.deepEqual(L.toPx(40, 20), { px: 64 + 400, py: 50 });
  assert.equal(L.xTicks[0], 0);
  assert.ok(L.xTicks.every((x, i) => i === 0 || x > (L.xTicks[i - 1] ?? 0)));
  assert.ok((L.xTicks[L.xTicks.length - 1] ?? 0) * L.scale <= 700 + 1e-6);
});

test('projectileLayout: width-limited, vertical-only and tiny extents stay finite', () => {
  const wide = projectileLayout(1000, 10, BOX);
  assert.equal(wide.scale, 0.7);
  const vertical = projectileLayout(0, 20, BOX);
  assert.ok(Number.isFinite(vertical.scale) && vertical.scale > 0);
  assert.equal(vertical.toPx(0, 20).py, 50);
  const tiny = projectileLayout(0, 0, BOX);
  assert.ok(Number.isFinite(tiny.scale) && tiny.scale > 0);
  assert.ok(tiny.xTicks.length >= 1 && tiny.xTicks.length <= 41);
});

test('liftScaleMax: |lift| at the largest slider combination, from the lift engine', () => {
  const max = { liftCoefficient: 2, airDensityKgM3: 1.5, airspeedMps: 100, wingAreaM2: 30 };
  const min = { liftCoefficient: 0, airDensityKgM3: 0.5, airspeedMps: 10, wingAreaM2: 4 };
  assert.equal(liftScaleMax(max, min), liftOf({ liftCoefficient: 2, airDensityKgM3: 1.5, airspeedMps: 100, wingAreaM2: 30 }));
  // a negative-Cl range makes the reference use |Cl|
  assert.equal(liftScaleMax({ ...max, liftCoefficient: 1 }, { ...min, liftCoefficient: -2 }), liftOf({ liftCoefficient: 2, airDensityKgM3: 1.5, airspeedMps: 100, wingAreaM2: 30 }));
  assert.equal(liftScaleMax({}, {}), null);
});

test('liftArrowPx: logarithmic, clamped, signed, zero for zero lift', () => {
  const ref = 1e6;
  assert.equal(liftArrowPx(0, ref, 150), 0);
  assert.equal(liftArrowPx(Number.NaN, ref, 150), 0);
  assert.equal(liftArrowPx(10, 0, 150), 0);
  assert.equal(liftArrowPx(ref, ref, 150), 150); // largest lift = full length
  assert.equal(liftArrowPx(10 * ref, ref, 150), 150); // never beyond maxPx
  const small = liftArrowPx(1, ref, 150);
  assert.ok(small >= 14 && small < 150);
  assert.equal(liftArrowPx(-ref, ref, 150), -150); // negative lift points down
  // log scale: 100x more lift is NOT 100x longer, and growth is monotone
  const a = liftArrowPx(1e2, ref, 150);
  const b = liftArrowPx(1e4, ref, 150);
  assert.ok(a < b && b < 150);
  assert.ok(b / a < 3);
});

test('wingTiltDeg / flowCycleS / flowLineCount scale monotonically and clamp', () => {
  assert.equal(wingTiltDeg(0, 2), 0);
  assert.equal(wingTiltDeg(2, 2), 14);
  assert.equal(wingTiltDeg(-2, 2), -14);
  assert.equal(wingTiltDeg(9, 2), 14);
  assert.equal(wingTiltDeg(1, 0), 0);
  assert.equal(flowCycleS(0, 100), 2.6);
  assert.equal(flowCycleS(100, 100), 0.35);
  assert.ok(flowCycleS(50, 100) < flowCycleS(10, 100));
  assert.equal(flowCycleS(5, 0), 2.6);
  assert.equal(flowLineCount(0, 1.5), 3);
  assert.equal(flowLineCount(1.5, 1.5), 7);
  assert.equal(flowLineCount(Number.NaN, 1.5), 3);
});

const AIR = { gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15 };
const OPTS = { emitEveryS: 0.5, lifetimeS: 2 };

test('wavefronts: radii come from wavefrontRadiusAt, new rings every emitEveryS, expired ones dropped', () => {
  const a = speedOfSoundOf(AIR);
  assert.equal(wavefronts(AIR, -1, OPTS).length, 0);
  const t0 = wavefronts(AIR, 0, OPTS);
  assert.equal(t0.length, 1);
  assert.equal(t0[0]?.radiusM, 0);
  assert.equal(t0[0]?.opacity, 1);

  const rings = wavefronts(AIR, 1.2, OPTS);
  assert.deepEqual(rings.map((r) => r.index), [0, 1, 2]);
  for (const r of rings) {
    assert.equal(r.radiusM, wavefrontRadiusAt(AIR, r.ageS));
    assert.ok(Math.abs(r.radiusM - a * r.ageS) < 1e-9);
  }
  assert.ok(Math.abs((rings[0]?.ageS ?? 0) - 1.2) < 1e-12);

  const later = wavefronts(AIR, 5.1, OPTS);
  assert.ok(later.every((r) => r.ageS >= 0 && r.ageS <= 2));
  assert.equal(later.length, 4); // ages 1.6, 1.1, 0.6, 0.1 (the ring of age 2.1 expired)
  assert.equal(later[0]?.index, 7);
  assert.ok(later.every((r, i) => i === 0 || r.opacity > (later[i - 1]?.opacity ?? 1))); // oldest first, so opacity rises toward newer rings
});

test('wavefronts: hotter gas spreads faster; invalid gas inputs are rejected by the engine, not hidden', () => {
  const cold = wavefronts({ ...AIR, temperatureK: 200 }, 1, OPTS)[0]?.radiusM ?? 0;
  const hot = wavefronts({ ...AIR, temperatureK: 400 }, 1, OPTS)[0]?.radiusM ?? 0;
  assert.ok(hot > cold);
  assert.throws(() => wavefronts({ ...AIR, temperatureK: -5 }, 1, OPTS), RangeError);
  assert.deepEqual(wavefronts(AIR, 1, { emitEveryS: 0, lifetimeS: 2 }), []);
});

test('soundScaleMaxM / ringPx map radii onto a fixed physical scale', () => {
  const scale = soundScaleMaxM({ gamma: 1.6, gasConstantJPerKgK: 600, temperatureK: 400 }, 2);
  const aMax = speedOfSoundOf({ gamma: 1.6, gasConstantJPerKgK: 600, temperatureK: 400 });
  assert.equal(scale, aMax * 2 * 0.8);
  assert.equal(soundScaleMaxM({ gamma: 1.6, gasConstantJPerKgK: 600, temperatureK: 400 }, 2, 1), aMax * 2);
  assert.equal(soundScaleMaxM({ gamma: 1.6, gasConstantJPerKgK: -1, temperatureK: 400 }, 2), null);
  assert.equal(ringPx(0, 100, 140), 0);
  assert.equal(ringPx(50, 100, 140), 70);
  assert.equal(ringPx(500, 100, 140), 140);
  assert.equal(ringPx(5, 0, 140), 0);
  assert.equal(ringPx(Number.NaN, 100, 140), 0);
});
