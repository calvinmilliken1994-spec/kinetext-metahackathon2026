import { useId, useMemo } from 'react';
import type { CompoundInterestActivitySpec } from '../../../../packages/contracts/index.ts';
import { engineOutput, scenarioLabels, shortInputLabel, sliderModels } from '../lib/engines.ts';
import { trimmed } from '../lib/format.ts';
import { linearScale, niceAxis, pointString } from '../lib/charts.ts';
import {
  compoundingName, compoundingStops, formatUSD, growthPoints, interestEarned
} from '../lib/compound.ts';
import type { StaticViewProps } from './ProjectileView.tsx';
import { Readout, ResetSliders, SchematicTag, Slider, StopSlider } from './controls.tsx';

export const COMPOUND_LABEL = 'Schematic — idealised account: fixed rate, no fees, no taxes, no withdrawals';

const W = 800;
const H = 335;
const PLOT = { l: 100, r: 760, t: 68, b: 272 };
const CURVE_STEPS = 80;

export function CompoundInterestView({ spec, inputs, onInput, onReset, predict, equation, concealed = false }: StaticViewProps<CompoundInterestActivitySpec>) {
  const titleId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const input = useMemo(() => ({
    principalUSD: inputs['principalUSD'] ?? Number.NaN,
    annualRatePercent: inputs['annualRatePercent'] ?? Number.NaN,
    compoundsPerYear: inputs['compoundsPerYear'] ?? Number.NaN,
    years: inputs['years'] ?? Number.NaN,
  }), [inputs]);
  const amount = useMemo(() => engineOutput('compound-interest-v1', inputs), [inputs]);
  const growth = useMemo(() => growthPoints(input, input.years, CURVE_STEPS), [input]);

  if (amount === null || growth.length === 0) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const years = input.years;
  const xMax = years > 0 ? years : 1;
  const yAxis = niceAxis(Math.max(amount, input.principalUSD), 4);
  const xTicks = niceAxis(xMax, 5).ticks.filter((t) => t <= xMax * (1 + 1e-9));
  const sx = linearScale(0, xMax, PLOT.l, PLOT.r);
  const sy = linearScale(0, yAxis.max, PLOT.b, PLOT.t);
  const toPx = (p: { t: number; balance: number }) => ({ x: sx(p.t), y: sy(p.balance) });
  const compoundLine = pointString(growth.map(toPx));
  const end = toPx(growth[growth.length - 1] ?? { t: 0, balance: input.principalUSD });
  const interest = interestEarned(input.principalUSD, amount);
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const rateText = `${trimmed(input.annualRatePercent, 3)} percent`;
  const alt = `${label}. Balance over time for ${formatUSD(input.principalUSD)} at ${rateText} a year, compounded ${compoundingName(input.compoundsPerYear)}. After ${trimmed(years, 3)} years the engine balance is ${concealed ? 'hidden until case 1 is run' : `${formatUSD(amount)}, which is ${formatUSD(interest)} of interest`}.`;

  return (
    <div className="simulation" data-engine="compound-interest-v1">
      <SchematicTag text={COMPOUND_LABEL} />
      <div className="scene-wrap chart-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={PLOT.l} y={26} className="object-label">{label}</text>
          <g aria-hidden="true">
            {yAxis.ticks.map((v) => (
              <g key={v}>
                <line x1={PLOT.l} y1={sy(v)} x2={PLOT.r} y2={sy(v)} className={v === 0 ? 'chart-axis' : 'chart-grid'} />
                <text x={PLOT.l - 8} y={sy(v) + 4} textAnchor="end" className="tick-label">{`$${v.toLocaleString('en-US')}`}</text>
              </g>
            ))}
            {xTicks.map((v) => (
              <g key={v}>
                <line x1={sx(v)} y1={PLOT.b} x2={sx(v)} y2={PLOT.b + 6} className="chart-axis" />
                <text x={sx(v)} y={PLOT.b + 22} textAnchor="middle" className="tick-label">{trimmed(v, 3)}</text>
              </g>
            ))}
            <text x={(PLOT.l + PLOT.r) / 2} y={H - 10} textAnchor="middle" className="tick-label tick-unit">Time (years)</text>
            <text x={PLOT.l} y={PLOT.t - 18} className="tick-label tick-unit">Balance (USD)</text>

            <polyline points={compoundLine} fill="none" className="line-compound" />
            <circle cx={sx(0)} cy={sy(input.principalUSD)} r={5} className="chart-dot chart-dot-start" />
            <circle cx={end.x} cy={end.y} r={7} className="chart-dot" />
            <text x={Math.min(end.x, PLOT.r)} y={end.y - 14} textAnchor="end" className="scene-label">{concealed ? '?' : formatUSD(amount)}</text>

          </g>
        </svg>
      </div>

      {predict}

      <div className="formula" role="group" aria-label="Formula with the current numbers">
        {equation}
        <p className="muted small">A = balance, P = starting amount, r = yearly rate in percent, n = times the interest is added per year, t = years. The curve draws the formula at every moment; a real account adds interest only on its compounding dates.</p>
      </div>

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => {
            const value = inputs[m.key] ?? m.value;
            if (m.key === 'compoundsPerYear') {
              return (
                <StopSlider
                  key={m.key}
                  label={shortInputLabel(m.label)}
                  stops={compoundingStops(m.min, m.max, value)}
                  value={value}
                  format={(n) => (n === 1 ? 'once a year' : `${compoundingName(n)} · n = ${trimmed(n, 4)}`)}
                  onChange={(n) => onInput(m.key, n)}
                />
              );
            }
            // Whole-and-half years are easier to land on than the generic 1/2/5 step.
            const step = m.key === 'years' && m.max - m.min >= 10 ? 0.5 : m.step;
            return <Slider key={m.key} label={shortInputLabel(m.label)} unit={m.unit} min={m.min} max={m.max} step={step} value={value} onChange={(v) => onInput(m.key, v)} />;
          })}
          <ResetSliders onReset={onReset} />
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Balance A (engine)" value={formatUSD(amount)} unit="" accent="x" concealed={concealed} />
          <Readout name="Interest earned" value={formatUSD(interest)} unit="" accent="force" concealed={concealed} />
        </dl>
      </div>
    </div>
  );
}
