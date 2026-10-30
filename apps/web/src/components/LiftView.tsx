import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { LiftActivitySpec } from '../../../../packages/contracts/index.ts';
import { engineOutput, formatQuantity, rangeMaxima, scenarioLabels, sliderModels } from '../lib/engines.ts';
import { trimmed } from '../lib/format.ts';
import { flowCycleS, flowLineCount, liftArrowPx, liftScaleMax, wingTiltDeg } from '../lib/geometry.ts';
import { Readout, ResetSliders, SchematicTag, Slider } from './controls.tsx';
import type { StaticViewProps } from './ProjectileView.tsx';

export const LIFT_LABEL = 'Schematic';

const W = 800;
const H = 330;
const CX = 400;
const CY = 215;
const ARROW_MAX = 150;

export function LiftView({ spec, inputs, onInput, onReset, predict, equation, concealed = false, variant = 'lesson' }: StaticViewProps<LiftActivitySpec>) {
  const titleId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const maxima = useMemo(() => rangeMaxima(spec), [spec]);
  const minima = useMemo(() => Object.fromEntries(models.map((m) => [m.key, m.min])), [models]);
  const scaleMax = useMemo(() => liftScaleMax(maxima, minima), [maxima, minima]);
  const liftN = useMemo(() => engineOutput('lift-equation-v1', inputs), [inputs]);

  if (liftN === null || scaleMax === null) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const cl = inputs['liftCoefficient'] ?? 0;
  const v = inputs['airspeedMps'] ?? 0;
  const rho = inputs['airDensityKgM3'] ?? 0;
  const area = inputs['wingAreaM2'] ?? 0;
  const arrow = liftArrowPx(liftN, scaleMax, ARROW_MAX);
  const tilt = wingTiltDeg(cl, Math.max(Math.abs(maxima['liftCoefficient'] ?? 0), Math.abs(minima['liftCoefficient'] ?? 0)));
  const cycle = flowCycleS(v, Math.max(Math.abs(maxima['airspeedMps'] ?? 0), Math.abs(minima['airspeedMps'] ?? 0)));
  const lines = flowLineCount(rho, maxima['airDensityKgM3'] ?? rho);
  const wingScale = 0.55 + 0.45 * Math.sqrt(Math.min(1, Math.max(0, area / (maxima['wingAreaM2'] ?? area))));
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const liftText = concealed ? '? N' : `${formatQuantity(liftN)} N`;
  const up = liftN >= 0;
  const tipY = CY - 14 - arrow; // negative arrow → points down
  const alt = `${label}. Lift coefficient ${trimmed(cl, 3)}, air density ${trimmed(rho, 3)} kilograms per cubic metre, airspeed ${trimmed(v, 3)} metres per second, wing area ${trimmed(area, 3)} square metres. Engine lift ${concealed ? 'hidden until case 1 is run' : liftText}${up ? ', pointing up' : ', pointing down'}.`;
  const flowStyle = { '--flow-s': `${cycle}s` } as CSSProperties;

  return (
    <div className="simulation" data-engine="lift-equation-v1">
      <SchematicTag text={LIFT_LABEL} />
      <div className="scene-wrap" style={flowStyle}>
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={56} y={26} className="object-label">{label}</text>

          <g aria-hidden="true">
            {Array.from({ length: lines }, (_, i) => {
              const y = 78 + (i * (H - 150)) / Math.max(1, lines - 1);
              return <line key={i} x1={40} y1={y} x2={W - 40} y2={y} className="flow-line" />;
            })}
          </g>
          <g aria-hidden="true">
            <line x1={52} y1={52} x2={150} y2={52} className="flow-arrow" />
            <polygon points="150,52 138,46 138,58" className="flow-head" />
            <text x={160} y={57} className="scene-label-small">airflow V = {trimmed(v, 3)} m/s</text>
          </g>

          <g transform={`translate(${CX} ${CY}) rotate(${-tilt}) scale(${wingScale})`} aria-hidden="true">
            <path d="M -170 4 C -150 -22 -70 -34 10 -30 C 80 -26 150 -8 176 4 C 150 12 70 16 0 14 C -80 12 -150 14 -170 4 Z" className="airfoil" />
            <line x1={-170} y1={4} x2={176} y2={4} className="chord" />
          </g>
          <text x={CX} y={CY + 62} textAnchor="middle" className="scene-label-small">
            Cl = {trimmed(cl, 3)} · ρ = {trimmed(rho, 3)} kg/m³ · A = {trimmed(area, 3)} m²
          </text>

          {arrow !== 0 && (
            <g className="arrow arrow-lift" aria-hidden="true">
              <line x1={CX} y1={CY - 14} x2={CX} y2={tipY + (up ? 11 * 0.6 : -11 * 0.6)} className="arrow-line" />
              <polygon points={up ? `${CX},${tipY} ${CX - 7},${tipY + 12} ${CX + 7},${tipY + 12}` : `${CX},${tipY} ${CX - 7},${tipY - 12} ${CX + 7},${tipY - 12}`} className="arrow-head" />
              <text x={CX + 16} y={up ? tipY + 14 : tipY - 8} className="scene-label">L = {liftText}</text>
            </g>
          )}
          {arrow === 0 && <text x={CX} y={CY - 34} textAnchor="middle" className="scene-label arrow-lift-zero">{concealed ? 'L = ? N' : 'L = 0 N (no lift arrow)'}</text>}
          <text x={W - 56} y={H - 12} textAnchor="end" className="scene-label-small">Lift arrow: logarithmic length, not proportional</text>
        </svg>
      </div>

      {equation}
      {predict}

      {variant !== 'scene' && (
      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider key={m.key} label={m.label} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(val) => onInput(m.key, val)} />
          ))}
          <ResetSliders onReset={onReset} />
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Lift L (engine)" value={formatQuantity(liftN)} unit="N" accent="force" concealed={concealed} />
        </dl>
      </div>
      )}
    </div>
  );
}
