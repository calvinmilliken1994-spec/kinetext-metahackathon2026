// Activity engine catalogue v0.3 — owned by the lead. Data only: the deterministic implementations live in
// packages/activities/<engine>/engine.ts and are registered in packages/activities/registry.ts.
// Every engine is a tested closed-form model: one checked output computed from numeric inputs.
// Runtime: Node 24 type stripping (erasable TypeScript only).

export const ENGINE_IDS = [
  'forces-1d-v1', 'projectile-v1', 'lift-equation-v1', 'speed-of-sound-v1',
  'compound-interest-v1', 'hardy-weinberg-v1', 'half-life-v1',
] as const;
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
  'compound-interest-v1': {
    id: 'compound-interest-v1',
    title: 'Compound interest',
    equation: 'A=P*(1+r/(100*n))^(n*t)',
    appliesWhen:
      'The source teaches compound interest: money grows by earning interest on the principal and on previously earned interest, compounded a number of times per year over a number of years (including worked examples such as $1,000 at 5% compounded once a year). Not for simple interest only, loan amortisation schedules, inflation adjustments or investment risk without a compounding calculation.',
    inputs: [
      { key: 'principalUSD', label: 'Starting amount P', unit: 'USD', hardMin: 0, hardMax: 10000000, exclusiveMin: true },
      { key: 'annualRatePercent', label: 'Annual interest rate r', unit: '%', hardMin: 0, hardMax: 50 },
      { key: 'compoundsPerYear', label: 'Compounding periods per year n', unit: 'per year', hardMin: 1, hardMax: 365 },
      { key: 'years', label: 'Time t', unit: 'years', hardMin: 0, hardMax: 100 },
    ],
    output: { key: 'expectedAmountUSD', label: 'Amount after t years', unit: 'USD', hardMin: 0, hardMax: 1000000000000 },
    tolerance: { absMax: 0.01, relMax: 0.0001 },
    scenarioKeys: ['objectLabel', 'settingLabel'],
  },
  'hardy-weinberg-v1': {
    id: 'hardy-weinberg-v1',
    title: 'Hardy-Weinberg genotype frequencies',
    equation: '2pq, q=1-p',
    appliesWhen:
      'The source teaches the Hardy-Weinberg principle for one gene with two alleles: allele frequencies p and q with p + q = 1, and genotype frequencies p^2, 2pq and q^2 in a population in equilibrium. Not for selection, drift, linkage, more than two alleles, or pedigree/Punnett problems about a single couple.',
    inputs: [
      { key: 'alleleFrequencyP', label: 'Frequency p of the first allele', unit: '1', hardMin: 0, hardMax: 1 },
    ],
    output: { key: 'expectedHeterozygoteFrequency', label: 'Heterozygote frequency 2pq', unit: '1', hardMin: 0, hardMax: 0.5 },
    tolerance: { absMax: 0.001, relMax: 0.005 },
    scenarioKeys: ['objectLabel', 'settingLabel'],
  },
  'half-life-v1': {
    id: 'half-life-v1',
    title: 'Radioactive decay and half-life',
    equation: 'N=N0*(1/2)^(t/T)',
    appliesWhen:
      'The source teaches half-life: after each half-life, half of the remaining radioactive material is left, so the amount after time t is N0 * (1/2)^(t/T). Not for radiometric age equations solved for t from daughter/parent ratios, dose or activity unit conversions, or decay chains.',
    inputs: [
      { key: 'initialAmount', label: 'Starting amount N0 (any unit: grams, atoms or percent)', unit: '1', hardMin: 0, hardMax: 1000000000000, exclusiveMin: true },
      { key: 'halfLife', label: 'Half-life T (same time unit as t)', unit: 'time', hardMin: 0, hardMax: 1000000000000, exclusiveMin: true },
      { key: 'elapsedTime', label: 'Elapsed time t (same time unit as T)', unit: 'time', hardMin: 0, hardMax: 10000000000000 },
    ],
    output: { key: 'expectedRemaining', label: 'Amount remaining N', unit: '1', hardMin: 0, hardMax: 1000000000000 },
    tolerance: { absMax: 0.001, relMax: 0.005 },
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

// ---- Sequence engines (Stage 5b). ------------------------------------------------------------------------
// Non-numeric activities: the source text itself is the oracle. Kept OUT of ENGINE_IDS until validation,
// prompts, worker and UI all support them (then the analysis enum is widened in one step).

export const SEQUENCE_ENGINE_IDS = ['timeline-v1'] as const;
export type SequenceEngineId = typeof SEQUENCE_ENGINE_IDS[number];

export interface SequenceDescriptor {
  kind: 'sequence';
  id: SequenceEngineId;
  title: string;
  /** Shown to Muse during analysis: when this engine applies, and when it does not. */
  appliesWhen: string;
  /** Scenario label keys (each a 1-60 character string). */
  scenarioKeys: string[];
  events: { min: number; max: number };
  behavioralTests: { min: number; max: number };
  predictions: { min: number; max: number };
  /** Integer years; negative = BCE; 0 never occurs. */
  yearMin: number;
  yearMax: number;
}

export const SEQUENCE_ENGINES: Record<SequenceEngineId, SequenceDescriptor> = {
  'timeline-v1': {
    kind: 'sequence',
    id: 'timeline-v1',
    title: 'Timeline of dated events',
    appliesWhen:
      'The source narrates or explains a sequence of historical (or otherwise dated) events and states the date of at least five of them in its own text: a year, optionally with month and day (the year may come from a title or heading that contains exactly one year). Not for sources whose events are only approximately dated (decades, "circa", "early 1800s", "that summer"), undated processes, or a single event.',
    scenarioKeys: ['subjectLabel', 'settingLabel'],
    events: { min: 5, max: 10 },
    behavioralTests: { min: 3, max: 5 },
    predictions: { min: 2, max: 3 },
    yearMin: -3000,
    yearMax: 2100,
  },
};

export function isSequenceEngineId(value: unknown): value is SequenceEngineId {
  return typeof value === 'string' && (SEQUENCE_ENGINE_IDS as readonly string[]).includes(value);
}

// ---- All activity types Muse may choose during analysis. -----------------------------------------------
export const ACTIVITY_IDS = [...ENGINE_IDS, ...SEQUENCE_ENGINE_IDS] as const;
export type ActivityId = EngineId | SequenceEngineId;

export function isActivityId(value: unknown): value is ActivityId {
  return isEngineId(value) || isSequenceEngineId(value);
}
