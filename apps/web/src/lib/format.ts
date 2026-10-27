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
