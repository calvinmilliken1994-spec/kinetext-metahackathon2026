/**
 * speed-of-sound-v1 — deterministic, closed-form speed-of-sound engine.
 *
 * Pure and browser-safe: no I/O, no dependencies, no Date, no Math.random.
 * All quantities are SI: gamma (ratio of specific heats) dimensionless,
 * gas constant R in J/(kg*K), temperature T in K, speed in m/s.
 *
 * Model (calorically perfect ideal gas):
 *   a = sqrt(gamma * R * T)
 * Closed form — identical on every run and platform. With gamma = 1.4,
 * R = 287 J/(kg*K), T = 288.15 K (15 °C) this gives a = 340.2626... m/s
 * (the often-quoted 340.29 m/s uses R = 287.05).
 *
 * Non-finite or out-of-domain inputs are rejected by throwing a RangeError
 * whose message is a stable code (same policy as forces-1d-v1); the engine
 * never returns NaN. Hard bounds from packages/contracts/engines.ts (e.g.
 * gamma > 1 exclusive, T >= 50) are enforced by the schemas — the engine
 * only enforces the mathematical domain: gamma >= 0, R > 0, T >= 0, all
 * finite, so that gamma*R*T >= 0 and the square root is real.
 */

export const ENGINE_ID = 'speed-of-sound-v1';

/** Speed-of-sound inputs. */
export interface SoundInput {
  /** Ratio of specific heats gamma; must be finite and >= 0 (the catalogue narrows to gamma > 1). */
  gamma: number;
  /** Specific gas constant R in J/(kg*K); must be finite and > 0. */
  gasConstantJPerKgK: number;
  /** Absolute temperature T in K; must be finite and >= 0. */
  temperatureK: number;
}

/**
 * Speed of sound in m/s: a = sqrt(gamma * R * T).
 *
 * @throws RangeError('GAMMA_NEGATIVE') unless gamma is finite and >= 0.
 * @throws RangeError('GAS_CONSTANT_NOT_POSITIVE') unless gasConstantJPerKgK is finite and > 0.
 * @throws RangeError('TEMPERATURE_NEGATIVE') unless temperatureK is finite and >= 0.
 */
export function speedOfSoundOf(input: SoundInput): number {
  if (!Number.isFinite(input.gamma) || input.gamma < 0) {
    throw new RangeError('GAMMA_NEGATIVE');
  }
  if (!Number.isFinite(input.gasConstantJPerKgK) || input.gasConstantJPerKgK <= 0) {
    throw new RangeError('GAS_CONSTANT_NOT_POSITIVE');
  }
  if (!Number.isFinite(input.temperatureK) || input.temperatureK < 0) {
    throw new RangeError('TEMPERATURE_NEGATIVE');
  }
  return Math.sqrt(input.gamma * input.gasConstantJPerKgK * input.temperatureK);
}

/**
 * Radius in metres of the expanding spherical wavefront after t seconds:
 * r(t) = a * t (driven by spec inputs and the engine output only — the UI
 * labels such animations schematic). Negative t clamps to 0.
 *
 * @throws RangeError('TIME_NOT_FINITE') if t is not finite.
 * @throws the speedOfSoundOf input errors for invalid gas inputs.
 */
export function wavefrontRadiusAt(input: SoundInput, t: number): number {
  const a = speedOfSoundOf(input);
  if (!Number.isFinite(t)) {
    throw new RangeError('TIME_NOT_FINITE');
  }
  return a * Math.max(t, 0);
}
