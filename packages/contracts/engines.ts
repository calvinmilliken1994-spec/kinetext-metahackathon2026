// Activity engine catalogue v0.3 — owned by the lead. Data only: the deterministic implementations live in
// packages/activities/<engine>/engine.ts and are registered in packages/activities/registry.ts.
// Every engine is a tested closed-form model: one checked output computed from numeric inputs.
// Runtime: Node 24 type stripping (erasable TypeScript only).

export const ENGINE_IDS = ['forces-1d-v1', 'projectile-v1', 'lift-equation-v1', 'speed-of-sound-v1'] as const;
export type EngineId = typeof ENGINE_IDS[number];

export interface EngineInput {
  /** Property name used in simulation ranges and in every behavioral test / prediction. */
  key: string;
  label: string;
  /** Display unit; also the `unit` stored in the full spec's Range. '1' means dimensionless. */
  unit: string;
  /** Bounds enforced by the full schema (inclusive unless exclusiveMin). Some exclusive minimums are deliberate
   *  design narrowings that drop degenerate cases (V0 = 0, rho = 0, A = 0), not physical impossibilities. */
  hardMin: number;
  hardMax: number;
  exclusiveMin?: boolean;
}

export interface EngineDescriptor {
  id: EngineId;
  title: string;
  /** Canonical equation string stored in spec.simulation.equation (const in the full schema). */
  equation: string;
  /** Shown to Muse during analysis: when this engine applies, and when it does not. */
  appliesWhen: string;
  inputs: EngineInput[];
  /** The single value every behavioral test and prediction must state; recomputed by the engine. */
  output: { key: string; label: string; unit: string; hardMin: number; hardMax: number };
  /** |expected - computed| <= tolerance, and tolerance <= max(absMax, relMax * |computed|). */
  tolerance: { absMax: number; relMax: number };
  /** Scenario label keys (each a 1-60 character string). */
  scenarioKeys: string[];
}

export const ENGINES: Record<EngineId, EngineDescriptor> = {
  'forces-1d-v1': {
    id: 'forces-1d-v1',
    title: 'Force, mass and acceleration (1D)',
    equation: 'a=F_net/m',
    appliesWhen:
      "The source teaches Newton's second law for a constant net force on a constant mass in one dimension (a = F/m), optionally with the resulting velocity and position over time. Not for drag that changes with speed, rotation, or two-dimensional motion.",
    inputs: [
      { key: 'massKg', label: 'Mass', unit: 'kg', hardMin: 0.01, hardMax: 1000 },
      { key: 'netForceN', label: 'Net force', unit: 'N', hardMin: -1000, hardMax: 1000 },
    ],
    output: { key: 'expectedAccelerationMps2', label: 'Acceleration', unit: 'm/s^2', hardMin: -100000, hardMax: 100000 },
    tolerance: { absMax: 0.01, relMax: 0 },
    scenarioKeys: ['objectLabel', 'surfaceLabel'],
  },
  'projectile-v1': {
    id: 'projectile-v1',
    title: 'Ballistic flight without drag',
    equation: 'y_max=V0^2/(2*g)',
    appliesWhen:
      'Assumes launch from and landing on level ground (y0 = 0). The source teaches ballistic (drag-free) flight: uniform horizontal motion x = U0*t and vertical motion y = V0*t - g*t^2/2 under constant gravity, including the maximum height V0^2/(2g). Not for flight with aerodynamic drag, terminal velocity, lift or thrust.',
    inputs: [
      { key: 'horizontalSpeedMps', label: 'Initial horizontal speed U0', unit: 'm/s', hardMin: 0, hardMax: 200 },
      { key: 'verticalSpeedMps', label: 'Initial vertical speed V0', unit: 'm/s', hardMin: 0, hardMax: 200, exclusiveMin: true },
      { key: 'gravityMps2', label: 'Gravitational acceleration g', unit: 'm/s^2', hardMin: 0.1, hardMax: 30 },
    ],
    output: { key: 'expectedMaxHeightM', label: 'Maximum height', unit: 'm', hardMin: 0, hardMax: 1000000 },
    tolerance: { absMax: 0.01, relMax: 0.005 },
    scenarioKeys: ['objectLabel', 'settingLabel'],
  },
  'lift-equation-v1': {
    id: 'lift-equation-v1',
    title: 'Lift equation',
    equation: 'L=Cl*(rho*V^2/2)*A',
    appliesWhen:
      'The source teaches the lift equation: lift equals the lift coefficient times air density times half the velocity squared times the wing area. Not for drag, thrust, weight balance or Bernoulli pressure distributions alone.',
    inputs: [
      { key: 'liftCoefficient', label: 'Lift coefficient Cl', unit: '1', hardMin: -2, hardMax: 3 },
      { key: 'airDensityKgM3', label: 'Air density rho', unit: 'kg/m^3', hardMin: 0, hardMax: 2, exclusiveMin: true },
      { key: 'airspeedMps', label: 'Velocity V', unit: 'm/s', hardMin: 0, hardMax: 400 },
      { key: 'wingAreaM2', label: 'Wing area A', unit: 'm^2', hardMin: 0, hardMax: 1000, exclusiveMin: true },
    ],
    output: { key: 'expectedLiftN', label: 'Lift', unit: 'N', hardMin: -1000000000, hardMax: 1000000000 },
    tolerance: { absMax: 0.01, relMax: 0.005 },
    scenarioKeys: ['objectLabel', 'settingLabel'],
  },
  'speed-of-sound-v1': {
    id: 'speed-of-sound-v1',
    title: 'Speed of sound in a gas',
    equation: 'a=sqrt(gamma*R*T)',
    appliesWhen:
      'The source teaches that the speed of sound in a gas equals the square root of the ratio of specific heats times the gas constant times the absolute temperature. Not for Mach-number flight regimes, shock waves or atmosphere models alone.',
    inputs: [
      { key: 'gamma', label: 'Ratio of specific heats gamma', unit: '1', hardMin: 1, hardMax: 1.7, exclusiveMin: true },
      { key: 'gasConstantJPerKgK', label: 'Gas constant R', unit: 'J/(kg*K)', hardMin: 100, hardMax: 5000 },
      { key: 'temperatureK', label: 'Absolute temperature T', unit: 'K', hardMin: 50, hardMax: 2000 },
    ],
    output: { key: 'expectedSpeedMps', label: 'Speed of sound', unit: 'm/s', hardMin: 0, hardMax: 10000 },
    tolerance: { absMax: 0.01, relMax: 0.005 },
    scenarioKeys: ['objectLabel', 'settingLabel'],
  },
};

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value);
}

/** Largest tolerance allowed for a case whose deterministic output is `computed`. */
export function maxTolerance(engine: EngineId, computed: number): number {
  const t = ENGINES[engine].tolerance;
  return Math.max(t.absMax, t.relMax * Math.abs(computed));
}
