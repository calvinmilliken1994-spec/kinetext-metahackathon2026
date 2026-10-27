// TASK-013 — hand-written VALID specs (one per new engine) plus their fixture source documents.
// These builders live outside tests/ on purpose: they are package fixtures, not tests.
// Every numeric expectation was pinned against the deterministic engines (see the comments), and
// every case tolerance satisfies tolerance <= maxTolerance(engine, computed) so the fixtures pass
// 'semantic.tolerance' as delivered. Source texts are original, authored for this repository.
import { sha256 } from '../../sources/index.ts';
import type {
  LiftActivitySpec,
  ProjectileActivitySpec,
  SoundActivitySpec,
  SourceDocument,
} from '../../contracts/index.ts';

const EXECUTION = { maxWallTimeMs: 2000, maxRepairAttempts: 2, network: false, generatedCodeAllowed: false } as const;

function provenance() {
  return {
    provider: 'meta' as const,
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId: 'fixture-not-a-real-response',
    runId: 'contract-fixture',
    promptVersion: 'fixture',
    revision: 1,
    repairOf: null,
    generatedAt: '2026-10-28T00:00:00.000Z',
  };
}

/* ------------------------------------------------------------------ */
/* projectile-v1                                                        */
/* ------------------------------------------------------------------ */

const PROJECTILE_TEXT =
  'Ballistic flight on level ground: the maximum height equals the vertical speed squared divided by twice the gravity. ' +
  'The flight time is twice the vertical speed divided by the gravity. ' +
  'Horizontal motion is uniform while the vertical motion accelerates downward at a constant rate.\n';

export function projectileSourceDoc(): SourceDocument {
  return {
    id: 'fixture-projectile-source',
    title: 'Ballistic flight fixture source',
    locator: 'packages/validation/fixtures/engine-specs.ts',
    license: 'CC0-1.0',
    attribution: 'Original test text authored for this repository; dedicated CC0-1.0.',
    sha256: sha256(PROJECTILE_TEXT),
    text: PROJECTILE_TEXT,
  };
}

/** V0=20,g=9.8 -> 20.408163265306122; V0=12,g=1.62 -> 44.44444444444444; V0=30,g=9.8 -> 45.91836734693877. */
export function makeProjectileSpec(): ProjectileActivitySpec {
  const src = projectileSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'projectile-contract-fixture',
    title: 'Launch a ball: how high does it fly?',
    learningObjectives: ['Predict the maximum height of a ballistic arc from the launch speed and gravity.'],
    sources: [{
      id: src.id, title: src.title, locator: src.locator,
      license: src.license, attribution: src.attribution, sha256: src.sha256,
    }],
    explanations: [
      {
        id: 'max-height',
        text: 'The maximum height grows with the square of the vertical launch speed.',
        evidence: [{
          sourceId: src.id,
          quote: 'the maximum height equals the vertical speed squared divided by twice the gravity',
        }],
      },
      {
        id: 'independent-motions',
        text: 'Sideways motion continues unchanged while gravity bends the path downward.',
        evidence: [{
          sourceId: src.id,
          quote: 'Horizontal motion is uniform while the vertical motion accelerates downward',
        }],
      },
    ],
    simulation: {
      engine: 'projectile-v1',
      equation: 'y_max=V0^2/(2*g)',
      horizontalSpeedMps: { unit: 'm/s', min: 0, max: 50, default: 10 },
      verticalSpeedMps: { unit: 'm/s', min: 5, max: 40, default: 20 },
      gravityMps2: { unit: 'm/s^2', min: 1, max: 20, default: 9.8 },
      scenario: { objectLabel: 'Ball', settingLabel: 'Level playing field' },
    },
    behavioralTests: [
      { name: 'earth launch', horizontalSpeedMps: 10, verticalSpeedMps: 20, gravityMps2: 9.8, expectedMaxHeightM: 20.408163, tolerance: 0.001 },
      { name: 'moon launch', horizontalSpeedMps: 15, verticalSpeedMps: 12, gravityMps2: 1.62, expectedMaxHeightM: 44.4444, tolerance: 0.01 },
    ],
    predictions: [
      {
        id: 'fast-throw',
        prompt: 'A ball is thrown upward at 30 m/s and sideways at 10 m/s on Earth. How high does it rise?',
        horizontalSpeedMps: 10, verticalSpeedMps: 30, gravityMps2: 9.8, expectedMaxHeightM: 45.918367, tolerance: 0.001,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies ProjectileActivitySpec);
}

/* ------------------------------------------------------------------ */
/* lift-equation-v1                                                     */
/* ------------------------------------------------------------------ */

const LIFT_TEXT =
  'The lift equation: lift equals the lift coefficient times the air density times half the velocity squared times the wing area. ' +
  'Doubling the airspeed quadruples the lift of the same wing. ' +
  'Lift acts perpendicular to the oncoming flow.\n';

export function liftSourceDoc(): SourceDocument {
  return {
    id: 'fixture-lift-source',
    title: 'Lift equation fixture source',
    locator: 'packages/validation/fixtures/engine-specs.ts',
    license: 'CC0-1.0',
    attribution: 'Original test text authored for this repository; dedicated CC0-1.0.',
    sha256: sha256(LIFT_TEXT),
    text: LIFT_TEXT,
  };
}

/** Cl=0.5,rho=1.225,V=50,A=16 -> 12250.000000000002; Cl=1.2,rho=1.225,V=30,A=10 -> 6615; Cl=0.5,rho=1.5,V=60,A=16 -> 21600. */
export function makeLiftSpec(): LiftActivitySpec {
  const src = liftSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'lift-contract-fixture',
    title: 'Wing lift: coefficient, density, speed and area',
    learningObjectives: ['Predict lift from the lift equation when airspeed, density, area or coefficient changes.'],
    sources: [{
      id: src.id, title: src.title, locator: src.locator,
      license: src.license, attribution: src.attribution, sha256: src.sha256,
    }],
    explanations: [
      {
        id: 'lift-equation',
        text: 'Lift grows with the square of the airspeed and linearly with density and wing area.',
        evidence: [{
          sourceId: src.id,
          quote: 'lift equals the lift coefficient times the air density times half the velocity squared times the wing area',
        }],
      },
      {
        id: 'speed-squared',
        text: 'A small speed increase produces a much larger lift increase.',
        evidence: [{
          sourceId: src.id,
          quote: 'Doubling the airspeed quadruples the lift of the same wing',
        }],
      },
    ],
    simulation: {
      engine: 'lift-equation-v1',
      equation: 'L=Cl*(rho*V^2/2)*A',
      liftCoefficient: { unit: '1', min: 0, max: 2, default: 0.5 },
      airDensityKgM3: { unit: 'kg/m^3', min: 0.5, max: 1.5, default: 1.225 },
      airspeedMps: { unit: 'm/s', min: 10, max: 100, default: 50 },
      wingAreaM2: { unit: 'm^2', min: 4, max: 30, default: 16 },
      scenario: { objectLabel: 'Model wing', settingLabel: 'Sea-level air' },
    },
    behavioralTests: [
      { name: 'cruise lift', liftCoefficient: 0.5, airDensityKgM3: 1.225, airspeedMps: 50, wingAreaM2: 16, expectedLiftN: 12250, tolerance: 0.5 },
      { name: 'slow flight', liftCoefficient: 1.2, airDensityKgM3: 1.225, airspeedMps: 30, wingAreaM2: 10, expectedLiftN: 6615, tolerance: 0.1 },
    ],
    predictions: [
      {
        id: 'dense-air',
        prompt: 'A wing flies at 60 m/s in unusually dense air at 1.5 kg per cubic metre. What lift is produced?',
        liftCoefficient: 0.5, airDensityKgM3: 1.5, airspeedMps: 60, wingAreaM2: 16, expectedLiftN: 21600, tolerance: 1,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies LiftActivitySpec);
}

/* ------------------------------------------------------------------ */
/* speed-of-sound-v1                                                    */
/* ------------------------------------------------------------------ */

const SOUND_TEXT =
  'The speed of sound in a gas equals the square root of the ratio of specific heats times the gas constant times the absolute temperature. ' +
  'Sound travels faster in warmer air and slower in colder air. ' +
  'The wavefront expands as a sphere at the speed of sound.\n';

export function soundSourceDoc(): SourceDocument {
  return {
    id: 'fixture-sound-source',
    title: 'Speed of sound fixture source',
    locator: 'packages/validation/fixtures/engine-specs.ts',
    license: 'CC0-1.0',
    attribution: 'Original test text authored for this repository; dedicated CC0-1.0.',
    sha256: sha256(SOUND_TEXT),
    text: SOUND_TEXT,
  };
}

/** gamma=1.4,R=287,T=288.15 -> 340.2626485525556; T=200 -> 283.4783942384322; T=320 -> 358.5749572962395. */
export function makeSoundSpec(): SoundActivitySpec {
  const src = soundSourceDoc();
  return structuredClone({
    schemaVersion: '0.3.0',
    id: 'sound-contract-fixture',
    title: 'Speed of sound in a gas',
    learningObjectives: ['Predict how the speed of sound changes with temperature and gas properties.'],
    sources: [{
      id: src.id, title: src.title, locator: src.locator,
      license: src.license, attribution: src.attribution, sha256: src.sha256,
    }],
    explanations: [
      {
        id: 'sqrt-law',
        text: 'The speed of sound rises with the square root of the absolute temperature.',
        evidence: [{
          sourceId: src.id,
          quote: 'The speed of sound in a gas equals the square root of the ratio of specific heats times the gas constant times the absolute temperature',
        }],
      },
      {
        id: 'warm-faster',
        text: 'Warm air carries sound faster than cold air.',
        evidence: [{
          sourceId: src.id,
          quote: 'Sound travels faster in warmer air and slower in colder air',
        }],
      },
    ],
    simulation: {
      engine: 'speed-of-sound-v1',
      equation: 'a=sqrt(gamma*R*T)',
      gamma: { unit: '1', min: 1.05, max: 1.6, default: 1.4 },
      gasConstantJPerKgK: { unit: 'J/(kg*K)', min: 150, max: 600, default: 287 },
      temperatureK: { unit: 'K', min: 150, max: 400, default: 288.15 },
      scenario: { objectLabel: 'Sound pulse', settingLabel: 'Dry air' },
    },
    behavioralTests: [
      { name: 'sea level air', gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 288.15, expectedSpeedMps: 340.26, tolerance: 0.01 },
      { name: 'cold air', gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 200, expectedSpeedMps: 283.48, tolerance: 0.01 },
    ],
    predictions: [
      {
        id: 'hot-day',
        prompt: 'The air warms to 320 K. What is the speed of sound now?',
        gamma: 1.4, gasConstantJPerKgK: 287, temperatureK: 320, expectedSpeedMps: 358.575, tolerance: 0.01,
      },
    ],
    execution: EXECUTION,
    provenance: provenance(),
  } satisfies SoundActivitySpec);
}
