/**
 * forces-1d-v1 — deterministic, closed-form 1D constant-net-force engine.
 *
 * Pure and browser-safe: no I/O, no dependencies, no Date, no Math.random.
 * All quantities are SI: mass in kg, force in N, acceleration in m/s^2,
 * time in s, position/velocity in m and m/s.
 *
 * Every state is evaluated with the closed-form constant-acceleration
 * solution (a = F/m, v = v0 + a*t, x = x0 + v0*t + (1/2)*a*t^2); no
 * numerical integration is performed, so results are exact within
 * double-precision rounding and identical on every run and platform.
 */

export const ENGINE_ID = 'forces-1d-v1';

/** Hard cap on the number of frames a single simulation may produce. */
export const MAX_FRAMES = 3001;

/** One kinematic state sample. */
export interface Frame {
  /** Time in seconds since the start of the simulation. */
  t: number;
  /** Position in metres. */
  x: number;
  /** Velocity in m/s. */
  v: number;
  /** Acceleration in m/s^2 (constant for a given input). */
  a: number;
}

/** Parameters for a simulation run. x0/v0 default to 0 when omitted. */
export interface SimulationInput {
  /** Mass in kg; must be finite and > 0. */
  massKg: number;
  /** Net force in N; must be finite. */
  netForceN: number;
  /** Total simulated duration in s; must be finite and > 0. */
  durationS: number;
  /** Frame spacing in s; must be finite and > 0. */
  stepS: number;
  /** Initial position in m (default 0); must be finite when given. */
  x0?: number;
  /** Initial velocity in m/s (default 0); must be finite when given. */
  v0?: number;
}

/**
 * Newton's second law: a = F / m.
 *
 * @throws RangeError('MASS_NOT_POSITIVE') unless massKg is finite and > 0.
 * @throws RangeError('FORCE_NOT_FINITE') if netForceN is not finite.
 */
export function accelerationOf(massKg: number, netForceN: number): number {
  if (!Number.isFinite(massKg) || massKg <= 0) {
    throw new RangeError('MASS_NOT_POSITIVE');
  }
  if (!Number.isFinite(netForceN)) {
    throw new RangeError('FORCE_NOT_FINITE');
  }
  return netForceN / massKg;
}

interface ValidatedInput {
  a: number;
  durationS: number;
  x0: number;
  v0: number;
}

/** Shared validation for simulate() and stateAt(). */
function validateInput(input: SimulationInput): ValidatedInput {
  if (!Number.isFinite(input.durationS) || input.durationS <= 0) {
    throw new RangeError('DURATION_NOT_POSITIVE');
  }
  if (!Number.isFinite(input.stepS) || input.stepS <= 0) {
    throw new RangeError('STEP_NOT_POSITIVE');
  }
  const x0 = input.x0 ?? 0;
  const v0 = input.v0 ?? 0;
  if (!Number.isFinite(x0) || !Number.isFinite(v0)) {
    throw new RangeError('INITIAL_STATE_NOT_FINITE');
  }
  const a = accelerationOf(input.massKg, input.netForceN);
  return { a, durationS: input.durationS, x0, v0 };
}

/** Closed-form constant-acceleration state at time t. */
function frameAt(a: number, x0: number, v0: number, t: number): Frame {
  return {
    t,
    x: x0 + v0 * t + 0.5 * a * t * t,
    v: v0 + a * t,
    a,
  };
}

/**
 * Closed-form state at an arbitrary time, clamped into [0, durationS].
 * Validates the input exactly like simulate().
 */
export function stateAt(input: SimulationInput, t: number): Frame {
  const { a, durationS, x0, v0 } = validateInput(input);
  const tc = Math.min(Math.max(t, 0), durationS);
  return frameAt(a, x0, v0, tc);
}

/**
 * Sample the closed-form solution at t = i*stepS for i = 0..N, where
 * N = floor(durationS/stepS + 1e-9). If the last sampled time falls more
 * than 1e-9 below durationS, one final frame at exactly t = durationS is
 * appended. Frame times are computed as i*stepS (never by repeated
 * addition) so they cannot drift.
 *
 * @throws RangeError('TOO_MANY_FRAMES') if the frame count would exceed
 * MAX_FRAMES (checked before any frames are allocated).
 */
export function simulate(input: SimulationInput): Frame[] {
  const { a, durationS, x0, v0 } = validateInput(input);
  const stepS = input.stepS;

  const n = Math.floor(durationS / stepS + 1e-9);
  const needsFinalFrame = durationS - n * stepS > 1e-9;
  const frameCount = n + 1 + (needsFinalFrame ? 1 : 0);
  if (frameCount > MAX_FRAMES) {
    throw new RangeError('TOO_MANY_FRAMES');
  }

  const frames: Frame[] = new Array<Frame>(frameCount);
  for (let i = 0; i <= n; i++) {
    frames[i] = frameAt(a, x0, v0, i * stepS);
  }
  if (needsFinalFrame) {
    frames[n + 1] = frameAt(a, x0, v0, durationS);
  }
  return frames;
}
