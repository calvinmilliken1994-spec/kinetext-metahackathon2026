// Predict-then-run grading. The reference value is ALWAYS the engine's acceleration for the
// prediction's own mass/force; the spec's expected value is never needed (or shown) client-side.

export interface Grade {
  /** Student's guess in m/s². */
  guess: number;
  /** Engine acceleration in m/s². */
  actual: number;
  /** guess - actual (signed). */
  error: number;
  tolerance: number;
  withinTolerance: boolean;
  direction: 'high' | 'low' | 'exact';
}

/** Float slack so a guess exactly `tolerance` away is not rejected by representation error. */
export const GRADE_EPSILON = 1e-9;

export function gradePrediction(guess: number, actual: number, tolerance: number): Grade {
  const error = guess - actual;
  const withinTolerance = Math.abs(error) <= tolerance + GRADE_EPSILON;
  const direction = Math.abs(error) <= GRADE_EPSILON ? 'exact' : error > 0 ? 'high' : 'low';
  return { guess, actual, error, tolerance, withinTolerance, direction };
}

/** Parse a typed guess. Accepts a decimal comma and the unicode minus; returns null when not a finite number. */
export function parseGuess(raw: string): number | null {
  const s = raw.trim().replace('\u2212', '-').replace(',', '.');
  if (s === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
