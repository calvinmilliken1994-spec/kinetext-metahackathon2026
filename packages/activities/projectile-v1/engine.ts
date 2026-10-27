/**
 * projectile-v1 — deterministic, closed-form ballistic flight engine (no drag).
 *
 * Pure and browser-safe: no I/O, no dependencies, no Date, no Math.random.
 * All quantities are SI: speeds in m/s, gravity in m/s^2, time in s,
 * positions in m.
 *
 * Model (level ground, launch from y0 = 0, landing at y = 0):
 *   x(t) = U0 * t                (uniform horizontal motion)
 *   y(t) = V0 * t - g * t^2 / 2  (constant downward acceleration)
 *   max height  y_max = V0^2 / (2*g), reached at t = V0/g
 *   flight time t_flight = 2*V0/g  (LEVEL-LANDING ASSUMPTION — the same
 *   launch height and landing height; stated in the engine catalogue's
 *   appliesWhen text)
 *
 * Every state is evaluated with the closed-form solution above; no numerical
 * integration is performed, so results are exact within double-precision
 * rounding and identical on every run and platform.
 *
 * Non-finite or out-of-domain inputs are rejected by throwing a RangeError
 * whose message is a stable code (same policy as forces-1d-v1); functions
 * never return NaN. Hard bounds from packages/contracts/engines.ts (e.g.
 * U0 in [0, 200]) are enforced by the schemas — the engine only enforces
 * the mathematical domain (finite, V0 > 0, g > 0).
 */

export const ENGINE_ID = 'projectile-v1';

/** Hard cap on the number of frames a single simulation may produce (same budget as forces-1d-v1). */
export const MAX_FRAMES = 3001;

/** Launch parameters. All speeds in m/s, gravity in m/s^2. */
export interface ProjectileInput {
  /** Initial horizontal speed U0; must be finite (sign is irrelevant to the math). */
  horizontalSpeedMps: number;
  /** Initial vertical speed V0; must be finite and > 0 (V0 = 0 is the degenerate no-flight case). */
  verticalSpeedMps: number;
  /** Gravitational acceleration g; must be finite and > 0. */
  gravityMps2: number;
}

/** One trajectory sample. */
export interface ProjectileFrame {
  /** Time in seconds since launch, clamped into [0, flightTime]. */
  t: number;
  /** Horizontal position in metres (x = U0*t). */
  x: number;
  /** Height in metres (y = V0*t - g*t^2/2), clamped so y >= 0. */
  y: number;
}

/** The vertical/gravity pair the checked output depends on. */
export interface VerticalInput {
  verticalSpeedMps: number;
  gravityMps2: number;
}

/**
 * @throws RangeError('VERTICAL_SPEED_NOT_POSITIVE') unless verticalSpeedMps is finite and > 0.
 * @throws RangeError('GRAVITY_NOT_POSITIVE') unless gravityMps2 is finite and > 0.
 */
function validateVertical(input: VerticalInput): void {
  if (!Number.isFinite(input.verticalSpeedMps) || input.verticalSpeedMps <= 0) {
    throw new RangeError('VERTICAL_SPEED_NOT_POSITIVE');
  }
  if (!Number.isFinite(input.gravityMps2) || input.gravityMps2 <= 0) {
    throw new RangeError('GRAVITY_NOT_POSITIVE');
  }
}

/**
 * Maximum height of a ballistic arc launched vertically at V0 under gravity g:
 * y_max = V0^2 / (2*g).
 */
export function maxHeightOf(input: VerticalInput): number {
  validateVertical(input);
  return (input.verticalSpeedMps * input.verticalSpeedMps) / (2 * input.gravityMps2);
}

/**
 * Total flight time under the level-landing assumption: t_flight = 2*V0/g.
 */
export function flightTimeOf(input: VerticalInput): number {
  validateVertical(input);
  return (2 * input.verticalSpeedMps) / input.gravityMps2;
}

/** Shared validation for simulate() and stateAt(). */
function validateInput(input: ProjectileInput): void {
  if (!Number.isFinite(input.horizontalSpeedMps)) {
    throw new RangeError('HORIZONTAL_SPEED_NOT_FINITE');
  }
  validateVertical(input);
}

/** Closed-form trajectory point at time t (no clamping). */
function frameAt(input: ProjectileInput, t: number): ProjectileFrame {
  const y = input.verticalSpeedMps * t - (input.gravityMps2 * t * t) / 2;
  return {
    t,
    x: input.horizontalSpeedMps * t,
    // Floating-point residue at the landing time can dip infinitesimally below
    // ground level; the ground is at y = 0, so clamp.
    y: y < 0 ? 0 : y,
  };
}

/**
 * Closed-form trajectory point at an arbitrary time, clamped into
 * [0, flightTime] and to y >= 0. Validates the input exactly like simulate().
 *
 * @throws RangeError('TIME_NOT_FINITE') if t is not finite.
 */
export function stateAt(input: ProjectileInput, t: number): ProjectileFrame {
  validateInput(input);
  if (!Number.isFinite(t)) {
    throw new RangeError('TIME_NOT_FINITE');
  }
  const flight = flightTimeOf(input);
  const tc = Math.min(Math.max(t, 0), flight);
  return frameAt(input, tc);
}

/**
 * Sample the closed-form trajectory at t = i*stepS for i = 0..N, where
 * N = floor(flightTime/stepS + 1e-9), stopping at landing. If the last
 * sampled time falls more than 1e-9 below the flight time, one final frame at
 * exactly t = flightTime is appended. Frame times are computed as i*stepS
 * (never by repeated addition) so they cannot drift.
 *
 * @throws RangeError('STEP_NOT_POSITIVE') if stepS is not finite and > 0.
 * @throws RangeError('TOO_MANY_FRAMES') if the frame count would exceed
 * MAX_FRAMES (checked before any frames are allocated).
 */
export function simulate(input: ProjectileInput, stepS: number): ProjectileFrame[] {
  validateInput(input);
  if (!Number.isFinite(stepS) || stepS <= 0) {
    throw new RangeError('STEP_NOT_POSITIVE');
  }
  const flight = flightTimeOf(input);

  const n = Math.floor(flight / stepS + 1e-9);
  const needsFinalFrame = flight - n * stepS > 1e-9;
  const frameCount = n + 1 + (needsFinalFrame ? 1 : 0);
  if (frameCount > MAX_FRAMES) {
    throw new RangeError('TOO_MANY_FRAMES');
  }

  const frames: ProjectileFrame[] = new Array<ProjectileFrame>(frameCount);
  for (let i = 0; i <= n; i++) {
    frames[i] = frameAt(input, i * stepS);
  }
  if (needsFinalFrame) {
    frames[n + 1] = frameAt(input, flight);
  }
  return frames;
}
