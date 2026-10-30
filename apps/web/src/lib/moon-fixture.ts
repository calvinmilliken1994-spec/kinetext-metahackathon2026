// Stage 7 regression fixture: the Moon lesson (job-20261027181336-572d603f, prompt v3/v9 era). Its simulation and cases are
// copied verbatim from storage/runs/job-20261027181336-572d603f/spec.r1.json; the slider default g = 9.8 contradicts the
// lesson's own first case (g = 1.62 on the Moon), which is the bug the opening-case rule fixes. The source text is the
// project-authored test page (own work) the lesson was made from.

import type { ProjectileActivitySpec } from '../../../../packages/contracts/index.ts';
import { makeProjectileSpec } from '../../../../packages/validation/fixtures/engine-specs.ts';

export const MOON_SOURCE_TEXT = [
  'Throwing a ball on the Moon',
  '',
  'This note was written by the project team for a classroom test. It is our own work.',
  '',
  'On the Moon there is no air, so a thrown ball feels no drag at all. Its flight is purely ballistic. The only force on the ball after it leaves the hand is its weight, which pulls it straight down.',
  '',
  'Split the launch velocity into two parts: a horizontal speed U0 and a vertical speed V0. Nothing pushes the ball sideways, so the horizontal speed stays U0 for the whole flight and the ball moves x = U0 * t across the ground.',
  '',
  'Vertically, gravity slows the ball at a steady rate g. On the Moon g is about 1.62 m/s^2, roughly one sixth of the 9.8 m/s^2 we feel on Earth. The vertical speed is V = V0 - g * t, and the height is y = V0 * t - g * t^2 / 2.',
  '',
  'The ball stops rising when V = 0, which happens at t = V0 / g. Putting that time into the height equation gives the highest point: ymax = V0^2 / (2 * g). Because g on the Moon is about six times smaller, the same throw rises about six times higher than on Earth.',
].join('\n');

export function makeMoonSpec(): ProjectileActivitySpec {
  const base = makeProjectileSpec();
  return {
    ...base,
    title: 'Throwing a ball on the Moon',
    simulation: {
      engine: 'projectile-v1',
      equation: 'y_max=V0^2/(2*g)',
      horizontalSpeedMps: { unit: 'm/s', default: 20, max: 50, min: 5 },
      verticalSpeedMps: { unit: 'm/s', default: 15, max: 30, min: 5 },
      gravityMps2: { unit: 'm/s^2', default: 9.8, max: 24.8, min: 1.6 },
      scenario: { objectLabel: 'Thrown ball', settingLabel: 'Moon surface with no air' },
    },
    behavioralTests: [
      { expectedMaxHeightM: 1.2755, gravityMps2: 9.8, horizontalSpeedMps: 20, name: 'low-arc Earth toss', tolerance: 0.01, verticalSpeedMps: 5 },
      { expectedMaxHeightM: 277.7778, gravityMps2: 1.62, horizontalSpeedMps: 10, name: 'high-arc Moon throw', tolerance: 0.5, verticalSpeedMps: 30 },
      { expectedMaxHeightM: 69.4444, gravityMps2: 1.62, horizontalSpeedMps: 15, name: 'Moon mid throw', tolerance: 0.2, verticalSpeedMps: 15 },
      { expectedMaxHeightM: 11.4796, gravityMps2: 9.8, horizontalSpeedMps: 25, name: 'Earth comparison throw', tolerance: 0.05, verticalSpeedMps: 15 },
    ],
    predictions: [
      {
        expectedMaxHeightM: 69.4444, gravityMps2: 1.62, horizontalSpeedMps: 20, id: 'moon-high-throw',
        prompt: 'Predict the peak height for a ball thrown upward on the Moon with no air.', tolerance: 0.2, verticalSpeedMps: 15,
      },
      {
        expectedMaxHeightM: 7.3469, gravityMps2: 9.8, horizontalSpeedMps: 25, id: 'earth-lower-throw',
        prompt: 'Predict the peak height for the same upward throw under stronger gravity.', tolerance: 0.03, verticalSpeedMps: 12,
      },
    ],
  } as ProjectileActivitySpec;
}
