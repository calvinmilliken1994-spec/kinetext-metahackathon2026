// Slider steps that land on the lesson's case values (Stage 7 item 4). A range input can only sit on min + k·step, so
// g = 1.62 on a 1.6–24.8 slider with the generic 0.2 step showed (and snapped to) 1.6. The step is refined over decimal
// grids until the opening value — and, when possible, every other case value — is reachable.

const EPS = 1e-6;

/** True when `value` is min + k·step for a whole k (float noise allowed). */
export function onStepGrid(min: number, step: number, value: number): boolean {
  if (!(step > 0) || !Number.isFinite(value)) return false;
  const k = (value - min) / step;
  return Math.abs(k - Math.round(k)) < EPS * Math.max(1, Math.abs(k));
}

/** Decimal steps 5·10^k, 2·10^k, 1·10^k below `base`, finest last, down to `floor`. */
function decimalSteps(base: number, floor: number): number[] {
  const out: number[] = [];
  let pow = Math.pow(10, Math.ceil(Math.log10(base)));
  while (pow >= floor / 10) {
    for (const m of [5, 2, 1]) {
      const s = Number((m * pow).toPrecision(12));
      if (s < base - 1e-15 && s >= floor - 1e-15) out.push(s);
    }
    pow /= 10;
  }
  return out;
}

/**
 * The slider step to use: `base` when it reaches the case values, else the coarsest decimal step (not finer than
 * range/10000) that reaches all of them, else one that reaches the opening value `values[0]`, else `base`.
 * Values outside [min, max] are ignored (the view clamps them).
 */
export function caseFriendlyStep(min: number, max: number, base: number, values: readonly number[]): number {
  const range = max - min;
  if (!(range > 0) || !(base > 0)) return base;
  const inside = values.filter((v) => Number.isFinite(v) && v >= min - EPS && v <= max + EPS);
  const opening = values[0] !== undefined && inside.includes(values[0]) ? values[0] : undefined;
  const hitsAll = (s: number): boolean => inside.every((v) => onStepGrid(min, s, v));
  const hitsOpening = (s: number): boolean => opening === undefined || onStepGrid(min, s, opening);
  if (hitsAll(base)) return base;
  const candidates = decimalSteps(base, range / 10000);
  const all = candidates.find(hitsAll);
  if (all !== undefined) return all;
  if (hitsOpening(base)) return base;
  return candidates.find(hitsOpening) ?? base;
}
