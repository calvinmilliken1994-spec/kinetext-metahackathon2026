import { useId, useMemo } from 'react';
import type { Frame } from '../../../../packages/activities/forces-1d/engine.ts';
import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { arrowLength, clampArrow, objectShapeFor, toPx, trackWindow } from '../lib/track.ts';
import { fixed, trimmed } from '../lib/format.ts';

const W = 800;
const PX0 = 56;
const PX1 = 744;
const Y_FORCE = 62;
const Y_VEL = 98;
const Y_OBJ = 172;
const Y_TRACK = 220;
const ARROW_MAX = 150;

interface ArrowProps { x: number; y: number; len: number; cls: string; label: string }

function Arrow({ x, y, len, cls, label }: ArrowProps) {
  const tip = x + len;
  const dir = len >= 0 ? 1 : -1;
  const head = 11;
  if (len === 0) {
    return (
      <g className={cls}>
        <circle cx={x} cy={y} r={4} className="arrow-dot" />
        <text x={x} y={y - 10} textAnchor="middle" className="scene-label">{label}</text>
      </g>
    );
  }
  return (
    <g className={cls}>
      <line x1={x} y1={y} x2={tip - dir * head * 0.6} y2={y} className="arrow-line" />
      <polygon points={`${tip},${y} ${tip - dir * head},${y - 6.5} ${tip - dir * head},${y + 6.5}`} className="arrow-head" />
      <text x={x + len / 2} y={y - 10} textAnchor="middle" className="scene-label">{label}</text>
    </g>
  );
}

function Aircraft() {
  // Original stylised side-view silhouette (fuselage, tail fin, swept wing), nose toward +x.
  return (
    <g className="obj-shape" aria-hidden="true">
      <path d="M -48 -7 L -62 -30 L -44 -30 L -26 -9 Z" />
      <path d="M -50 0 C -50 -9 -34 -13 -12 -13 L 26 -13 C 40 -13 52 -6 54 0 C 52 6 40 10 26 10 L -12 10 C -34 10 -50 9 -50 0 Z" />
      <path d="M -8 6 L -30 28 L -14 28 L 20 6 Z" className="obj-wing" />
      <path d="M 30 -9 L 44 -9 C 47 -9 49 -6 50 -3 L 30 -3 Z" className="obj-window" />
    </g>
  );
}

function Block({ massKg }: { massKg: number }) {
  return (
    <g className="obj-shape" aria-hidden="true">
      <rect x={-34} y={-20} width={68} height={40} rx={6} />
      <text x={0} y={5} textAnchor="middle" className="obj-block-text">{trimmed(massKg, 2)} kg</text>
    </g>
  );
}

export interface SceneProps {
  scenario: ActivitySpec['simulation']['scenario'];
  massKg: number;
  netForceN: number;
  forceMaxAbs: number;
  frames: readonly Frame[];
  now: Frame;
}

export function Scene({ scenario, massKg, netForceN, forceMaxAbs, frames, now }: SceneProps) {
  const titleId = useId();
  const win = useMemo(() => trackWindow(frames.map((f) => f.x)), [frames]);
  const vMaxAbs = useMemo(() => frames.reduce((m, f) => Math.max(m, Math.abs(f.v)), 0), [frames]);
  const shape = objectShapeFor(scenario.objectLabel);

  const cx = toPx(now.x, win, PX0, PX1);
  const fLen = clampArrow(cx, arrowLength(netForceN, forceMaxAbs, ARROW_MAX), 24, W - 24);
  const vLen = clampArrow(cx, arrowLength(now.v, vMaxAbs, ARROW_MAX), 24, W - 24);

  const summary = `${scenario.objectLabel} on ${scenario.surfaceLabel}. Mass ${trimmed(massKg, 2)} kilograms, net force ${trimmed(netForceN, 2)} newtons. At ${fixed(now.t, 2)} seconds: position ${fixed(now.x, 2)} metres, velocity ${fixed(now.v, 2)} metres per second.`;

  return (
    <svg className="scene" viewBox={`0 0 ${W} 300`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
      <title id={titleId}>{summary}</title>

      <g className="scene-legend" aria-hidden="true">
        <line x1={PX0} y1={22} x2={PX0 + 28} y2={22} className="legend-force" />
        <text x={PX0 + 34} y={26} className="scene-label-small">net force</text>
        <line x1={PX0 + 110} y1={22} x2={PX0 + 138} y2={22} className="legend-vel" />
        <text x={PX0 + 144} y={26} className="scene-label-small">velocity</text>
      </g>

      <rect x={PX0 - 14} y={Y_TRACK - 3} width={PX1 - PX0 + 28} height={7} rx={3.5} className="track-band" />
      {win.ticks.map((tick) => {
        const px = toPx(tick, win, PX0, PX1);
        return (
          <g key={tick} aria-hidden="true">
            <line x1={px} y1={Y_TRACK + 4} x2={px} y2={Y_TRACK + 13} className={tick === 0 ? 'tick tick-zero' : 'tick'} />
            <text x={px} y={Y_TRACK + 29} textAnchor="middle" className="tick-label">{trimmed(tick, 2)}</text>
          </g>
        );
      })}
      <text x={PX1 + 24} y={Y_TRACK + 29} textAnchor="end" className="tick-label tick-unit">m</text>
      <text x={400} y={Y_TRACK + 62} textAnchor="middle" className="surface-label">{scenario.surfaceLabel}</text>
      <text x={PX0 - 14} y={Y_TRACK + 62} className="scene-label-small">+x →</text>

      <line x1={cx} y1={Y_OBJ + 33} x2={cx} y2={Y_TRACK - 3} className="guide" />
      <circle cx={cx} cy={Y_TRACK} r={5} className="track-dot" />

      <Arrow x={cx} y={Y_FORCE} len={fLen} cls="arrow arrow-force" label={`F_net = ${trimmed(netForceN, 2)} N`} />
      <Arrow x={cx} y={Y_VEL} len={vLen} cls="arrow arrow-vel" label={`v = ${fixed(now.v, 2)} m/s`} />

      <g transform={`translate(${cx} ${Y_OBJ})`}>
        {shape === 'aircraft' ? <Aircraft /> : <Block massKg={massKg} />}
        <text x={0} y={-42} textAnchor="middle" className="object-label">{scenario.objectLabel} · {trimmed(massKg, 2)} kg</text>
      </g>
    </svg>
  );
}
