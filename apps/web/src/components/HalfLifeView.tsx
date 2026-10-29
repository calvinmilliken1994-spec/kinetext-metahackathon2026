import { useId, useMemo } from 'react';
import type { HalfLifeActivitySpec } from '../../../../packages/contracts/index.ts';
import { engineOutput, formatWithUnit, rangeMaxima, scenarioLabels, shortInputLabel, sliderModels } from '../lib/engines.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { linearScale, niceAxis, pointString } from '../lib/charts.ts';
import { decayPoints, formatAmount, fractionLabel, halfLifeMarkers, halfLivesElapsed, markerLabelStride } from '../lib/decay.ts';
import { Readout, SchematicTag, Slider } from './controls.tsx';

export const HALF_LIFE_LABEL = 'Schematic — the smooth average curve; a real sample decays atom by atom at random';

const W = 800;
const H = 340;
const PLOT = { l: 100, r: 760, t: 68, b: 276 };
const CURVE_STEPS = 120;
const MIN_LABEL_GAP_PX = 64;

interface Props {
  spec: HalfLifeActivitySpec;
  inputs: Record<string, number>;
  onInput: (key: string, value: number) => void;
}

export function HalfLifeView({ spec, inputs, onInput }: Props) {
  const titleId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const maxima = useMemo(() => rangeMaxima(spec), [spec]);
  const n0 = inputs['initialAmount'] ?? Number.NaN;
  const halfLife = inputs['halfLife'] ?? Number.NaN;
  const t = inputs['elapsedTime'] ?? Number.NaN;
  const input = useMemo(() => ({ initialAmount: n0, halfLife, elapsedTime: t }), [n0, halfLife, t]);
  const remaining = useMemo(() => engineOutput('half-life-v1', inputs), [inputs]);
  // The time axis is fixed at the slider's maximum so moving t slides a dot along a steady curve.
  const tAxis = Math.max(maxima['elapsedTime'] ?? 0, t, Number.EPSILON);
  const curve = useMemo(() => decayPoints(input, tAxis, CURVE_STEPS), [input, tAxis]);
  const markers = useMemo(() => halfLifeMarkers(halfLife, tAxis, n0), [halfLife, tAxis, n0]);

  if (remaining === null || curve.length === 0) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const timeUnit = models.find((m) => m.key === 'halfLife')?.unit || 'time units';
  const yAxis = niceAxis(n0, 4);
  const xTicks = niceAxis(tAxis, 5).ticks.filter((v) => v <= tAxis * (1 + 1e-9));
  const sx = linearScale(0, tAxis, PLOT.l, PLOT.r);
  const sy = linearScale(0, yAxis.max, PLOT.b, PLOT.t);
  const stride = markerLabelStride(tAxis, halfLife, PLOT.r - PLOT.l, MIN_LABEL_GAP_PX);
  const lives = halfLivesElapsed(t, halfLife);
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const share = n0 > 0 ? (remaining / n0) * 100 : 0;
  const alt = `${label}. Decay curve: ${formatAmount(n0)} at the start, halving every ${formatWithUnit(halfLife, timeUnit, (n) => trimmed(n, 3))}. After ${formatWithUnit(t, timeUnit, (n) => trimmed(n, 3))}${lives === null ? '' : `, which is ${trimmed(lives, 3)} half-lives`}, ${formatAmount(remaining)} remains. ${markers.length === 0 ? 'The half-life is longer than the time axis, so no half-life markers are shown.' : `${markers.length} half-life markers: ${markers.slice(0, 4).map((m) => `${m.fractionLabel} left after ${trimmed(m.t, 3)}`).join(', ')}${markers.length > 4 ? ', and so on' : ''}.`}`;

  return (
    <div className="simulation" data-engine="half-life-v1">
      <SchematicTag text={HALF_LIFE_LABEL} />
      <div className="scene-wrap chart-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={PLOT.l} y={26} className="object-label">{label}</text>
          <g aria-hidden="true">
            {yAxis.ticks.map((v) => (
              <g key={v}>
                <line x1={PLOT.l} y1={sy(v)} x2={PLOT.r} y2={sy(v)} className={v === 0 ? 'chart-axis' : 'chart-grid'} />
                <text x={PLOT.l - 8} y={sy(v) + 4} textAnchor="end" className="tick-label">{formatAmount(v)}</text>
              </g>
            ))}
            {xTicks.map((v) => (
              <g key={v}>
                <line x1={sx(v)} y1={PLOT.b} x2={sx(v)} y2={PLOT.b + 6} className="chart-axis" />
                <text x={sx(v)} y={PLOT.b + 22} textAnchor="middle" className="tick-label">{trimmed(v, 3)}</text>
              </g>
            ))}
            <text x={(PLOT.l + PLOT.r) / 2} y={H - 12} textAnchor="middle" className="tick-label tick-unit">Time t ({timeUnit})</text>
            <text x={PLOT.l} y={PLOT.t - 18} className="tick-label tick-unit">Amount remaining N (same unit as N0)</text>

            {markers.map((m) => (
              <line key={m.k} x1={sx(m.t)} y1={sy(m.amount)} x2={sx(m.t)} y2={PLOT.b} className="chart-guide" />
            ))}
            <polyline points={pointString(curve.map((c) => ({ x: sx(c.t), y: sy(c.amount) })))} fill="none" className="line-compound" />
            {markers.map((m) => (
              <g key={`m${m.k}`}>
                <circle cx={sx(m.t)} cy={sy(m.amount)} r={4.5} className="marker-dot" />
                {(m.k - 1) % stride === 0 && Math.abs(sx(m.t) - sx(t)) > 44 && (
                  <text x={sx(m.t) + 8} y={sy(m.amount) - 8} className="scene-label-small marker-label">{m.fractionLabel}</text>
                )}
              </g>
            ))}

            <line x1={sx(t)} y1={PLOT.t} x2={sx(t)} y2={PLOT.b} className="chart-now" />
            <circle cx={sx(t)} cy={sy(remaining)} r={7} className="chart-dot" />
            <text x={sx(t) > PLOT.r - 120 ? sx(t) - 12 : sx(t) + 12} y={sy(remaining) + (sy(remaining) < PLOT.t + 24 ? 22 : -12)} textAnchor={sx(t) > PLOT.r - 120 ? 'end' : 'start'} className="scene-label">
              N = {formatAmount(remaining)}
            </text>
          </g>
        </svg>
      </div>
      <p className="muted small chart-note">
        {markers.length > 0
          ? `Dots mark each half-life (every ${formatWithUnit(halfLife, timeUnit, (n) => trimmed(n, 3))}); the label is the fraction of the starting amount still left.`
          : `One half-life (${formatWithUnit(halfLife, timeUnit, (n) => trimmed(n, 3))}) is longer than the time axis, so no half-life dots are drawn.`}
      </p>

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider key={m.key} label={shortInputLabel(m.label)} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(v) => onInput(m.key, v)} />
          ))}
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Remaining N (engine)" value={formatAmount(remaining)} unit="" accent="x" />
          <Readout name="Half-lives passed (t/T)" value={lives === null ? '—' : trimmed(lives, 3)} unit="" accent="v" />
          <Readout name="Share left" value={`${fixed(share, share >= 10 ? 1 : 2)}%`} unit="" accent="force" />
          {lives !== null && Number.isInteger(lives) && lives <= 10 && <Readout name="As a fraction" value={fractionLabel(lives)} unit="" />}
        </dl>
      </div>
    </div>
  );
}
