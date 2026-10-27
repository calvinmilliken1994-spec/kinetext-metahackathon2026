import { useId, useMemo } from 'react';
import type { MouseEvent } from 'react';
import type { Frame } from '../../../../packages/activities/forces-1d/engine.ts';
import { valueRange } from '../lib/track.ts';
import { fixed } from '../lib/format.ts';

const VW = 210;
const VH = 150;
const L = 40;
const R = 202;
const T = 18;
const B = 112;

export interface GraphProps {
  title: string;
  yUnit: string;
  color: string;
  frames: readonly Frame[];
  pick: (f: Frame) => number;
  now: Frame;
  durationS: number;
  onScrub: (t: number) => void;
}

export function Graph({ title, yUnit, color, frames, pick, now, durationS, onScrub }: GraphProps) {
  const id = useId();
  const values = useMemo(() => frames.map(pick), [frames, pick]);
  const { lo, hi } = useMemo(() => valueRange(values), [values]);
  const sx = (t: number): number => L + (t / durationS) * (R - L);
  const sy = (v: number): number => B - ((v - lo) / (hi - lo)) * (B - T);
  const points = useMemo(
    () => frames.map((f, i) => `${sx(f.t).toFixed(1)},${sy(values[i] ?? 0).toFixed(1)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, values, lo, hi, durationS],
  );
  const cur = pick(now);
  const first = values[0] ?? 0;
  const last = values[values.length - 1] ?? 0;

  const handleClick = (e: MouseEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const vx = ((e.clientX - rect.left) / rect.width) * VW;
    onScrub(Math.min(durationS, Math.max(0, ((vx - L) / (R - L)) * durationS)));
  };

  return (
    <figure className="graph">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${VW} ${VH}`} role="img" aria-labelledby={id} onClick={handleClick} className="graph-svg">
        <title id={id}>{`${title}: from ${fixed(first, 2)} to ${fixed(last, 2)} ${yUnit} over ${fixed(durationS, 1)} seconds. Currently ${fixed(cur, 2)} ${yUnit}. Click to move the time marker.`}</title>
        <rect x={L} y={T} width={R - L} height={B - T} className="graph-plot" />
        {lo < 0 && hi > 0 && <line x1={L} y1={sy(0)} x2={R} y2={sy(0)} className="graph-zero" />}
        <polyline points={points} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        <line x1={sx(now.t)} y1={T} x2={sx(now.t)} y2={B} className="graph-cursor" />
        <circle cx={sx(now.t)} cy={sy(cur)} r={4.5} fill={color} className="graph-dot" />
        <text x={L - 5} y={T + 4} textAnchor="end" className="graph-tick">{fixed(hi, 1)}</text>
        <text x={L - 5} y={B + 3} textAnchor="end" className="graph-tick">{fixed(lo, 1)}</text>
        <text x={L} y={B + 15} textAnchor="middle" className="graph-tick">0</text>
        <text x={R + 6} y={B + 15} textAnchor="end" className="graph-tick">{fixed(durationS, 1)} s</text>
        <text x={(L + R) / 2} y={VH - 6} textAnchor="middle" className="graph-axis">t (s)</text>
        <text x={6} y={T - 5} className="graph-axis">{yUnit}</text>
      </svg>
    </figure>
  );
}
