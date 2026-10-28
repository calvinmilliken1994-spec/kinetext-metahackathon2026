/**
 * compound-interest-v1 — deterministic compound-interest engine.
 *
 * Pure and browser-safe. Model: A = P * (1 + r / (100 * n))^(n * t), with the
 * annual rate r in percent, n compounding periods per year and t in years.
 * Example: $1,000 at 5% compounded yearly for 10 years gives $1,628.89.
 * Non-finite or out-of-domain inputs throw a RangeError with a stable code.
 */

export const ENGINE_ID = 'compound-interest-v1';

export interface CompoundInterestInput {
  principalUSD: number; annualRatePercent: number; compoundsPerYear: number; years: number;
}

function check(i: CompoundInterestInput): void {
  if (!Number.isFinite(i.principalUSD) || i.principalUSD <= 0) throw new RangeError('PRINCIPAL_NOT_POSITIVE');
  if (!Number.isFinite(i.annualRatePercent) || i.annualRatePercent < 0) throw new RangeError('RATE_NEGATIVE');
  if (!Number.isFinite(i.compoundsPerYear) || i.compoundsPerYear < 1) throw new RangeError('COMPOUNDS_BELOW_ONE');
  if (!Number.isFinite(i.years) || i.years < 0) throw new RangeError('YEARS_NEGATIVE');
}

/** Balance in USD after `years`. */
export function amountAfter(i: CompoundInterestInput): number {
  check(i);
  return i.principalUSD * Math.pow(1 + i.annualRatePercent / (100 * i.compoundsPerYear), i.compoundsPerYear * i.years);
}

/** Balance after t years on the same curve (for the growth chart); negative t clamps to 0. */
export function balanceAt(i: CompoundInterestInput, t: number): number {
  if (!Number.isFinite(t)) throw new RangeError('TIME_NOT_FINITE');
  return amountAfter({ ...i, years: Math.max(t, 0) });
}
