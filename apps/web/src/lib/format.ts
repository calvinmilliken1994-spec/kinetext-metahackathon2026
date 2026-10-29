// Number formatting helpers (pure).

/** toFixed that never prints '-0.00'. */
export function fixed(n: number, digits = 2): string {
  const s = n.toFixed(digits);
  return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
}

/** Shortest readable decimal: up to `maxDigits` places, trailing zeros removed. */
export function trimmed(n: number, maxDigits = 4): string {
  if (!Number.isFinite(n)) return String(n);
  const s = Number(n.toFixed(maxDigits)).toString();
  return s === '-0' ? '0' : s;
}

/** Decimal places implied by a slider step (0.1 → 1, 1 → 0, 0.01 → 2). */
export function stepDigits(step: number): number {
  if (!(step > 0)) return 0;
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
}

/** Longest unit shown beside a slider end label; a longer one ('meters per square second') would wrap under the slider. */
const END_UNIT_MAX_CHARS = 6;

/**
 * A number as a person reads it: up to three decimals, but a small value keeps its first three significant figures
 * instead of rounding to zero (0.00356 stays 0.00356, never 0.004 or 0).
 */
export function readableNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (n === 0) return '0';
  if (Math.abs(n) >= 1) return trimmed(n, 3);
  const s = Number(n.toPrecision(3)).toString();
  return s.includes('e') ? n.toFixed(8).replace(/\.?0+$/, '') : s;
}

/** A slider end label: the number, plus the unit only when it is short enough not to wrap (the value above carries the full unit). */
export function sliderEndLabel(n: number, unit: string): string {
  const shown = readableNumber(n);
  return unit === '' || unit.length > END_UNIT_MAX_CHARS ? shown : `${shown} ${unit}`;
}
