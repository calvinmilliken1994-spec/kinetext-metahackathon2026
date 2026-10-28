// Tiny hand-written SVG chart helpers (pure). No chart library: the views draw their own axes and polylines.

/** Linear map from [d0, d1] onto [r0, r1]; either range direction works (SVG y grows downward).
 *  An empty or non-finite domain maps everything to r0 so a degenerate chart never produces NaN coordinates. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0 || !Number.isFinite(d0)) return () => r0;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

export interface NiceAxis { max: number; step: number; ticks: number[] }

/** An axis from 0 whose step is 1, 2 or 5 times a power of ten, whose top covers `maxValue`, with roughly
 *  `targetTicks` intervals. Zero, negative and non-finite maxima give the unit axis [0, 1]. */
export function niceAxis(maxValue: number, targetTicks = 4): NiceAxis {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { max: 1, step: 1, ticks: [0, 1] };
  const raw = maxValue / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const mult = [1, 2, 5, 10].find((m) => m >= raw / pow - 1e-9) ?? 10;
  const step = Number((mult * pow).toPrecision(12));
  const count = Math.max(1, Math.ceil(maxValue / step - 1e-9));
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { max: ticks[count] ?? step, step, ticks };
}

/** SVG polyline `points` attribute: "x,y x,y" with one decimal. Non-finite points are skipped. */
export function pointString(points: readonly { x: number; y: number }[]): string {
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}
