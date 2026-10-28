/**
 * half-life-v1 — deterministic radioactive-decay engine.
 *
 * Pure and browser-safe. Model: N = N0 * (1/2)^(t / T), with half-life T and
 * elapsed time t in the same time unit and N in the unit of N0. After each
 * whole half-life exactly half of the remaining amount is left.
 */

export const ENGINE_ID = 'half-life-v1';

export interface HalfLifeInput { initialAmount: number; halfLife: number; elapsedTime: number }

/** Amount remaining after elapsedTime. */
export function remainingAfter(i: HalfLifeInput): number {
  if (!Number.isFinite(i.initialAmount) || i.initialAmount <= 0) throw new RangeError('INITIAL_AMOUNT_NOT_POSITIVE');
  if (!Number.isFinite(i.halfLife) || i.halfLife <= 0) throw new RangeError('HALF_LIFE_NOT_POSITIVE');
  if (!Number.isFinite(i.elapsedTime) || i.elapsedTime < 0) throw new RangeError('ELAPSED_TIME_NEGATIVE');
  return i.initialAmount * Math.pow(0.5, i.elapsedTime / i.halfLife);
}
