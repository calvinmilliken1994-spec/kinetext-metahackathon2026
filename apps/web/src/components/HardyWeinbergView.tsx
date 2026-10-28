import { useId, useMemo } from 'react';
import type { HardyWeinbergActivitySpec } from '../../../../packages/contracts/index.ts';
import { engineOutput, scenarioLabels, shortInputLabel, sliderModels } from '../lib/engines.ts';
import { trimmed } from '../lib/format.ts';
import { linearScale, pointString } from '../lib/charts.ts';
import { alleleQ, formatFrequency, frequenciesSumToOne, genotypeBars, heterozygoteCurve } from '../lib/genetics.ts';
import { Readout, SchematicTag, Slider } from './controls.tsx';

export const HARDY_WEINBERG_LABEL = 'Schematic — an ideal population: random mating, no selection, migration or drift';

const W = 800;
const H = 320;
const BAR = { l: 70, r: 440, top: 96, h: 34, gap: 26 };
const CURVE = { l: 540, r: 760, t: 84, b: 244 };
const H_MAX = 0.5;
const CURVE_STEPS = 50;

interface Props {
  spec: HardyWeinbergActivitySpec;
  inputs: Record<string, number>;
  onInput: (key: string, value: number) => void;
}

export function HardyWeinbergView({ spec, inputs, onInput }: Props) {
  const titleId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const p = inputs['alleleFrequencyP'] ?? Number.NaN;
  const het = useMemo(() => engineOutput('hardy-weinberg-v1', inputs), [inputs]);
  const bars = useMemo(() => genotypeBars(p), [p]);
  const curve = useMemo(() => heterozygoteCurve(CURVE_STEPS), []);

  if (het === null || bars.length === 0) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const q = alleleQ(p);
  const sx = linearScale(0, 1, CURVE.l, CURVE.r);
  const sy = linearScale(0, H_MAX, CURVE.b, CURVE.t);
  const barX = linearScale(0, 1, BAR.l, BAR.r);
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const sum = bars.reduce((s, b) => s + b.frequency, 0);
  const sumOk = frequenciesSumToOne(bars);
  const alt = `${label}. Allele frequency p is ${formatFrequency(p)} and q is ${formatFrequency(q)}. Genotype frequencies: ${bars.map((b) => `${b.label} (${b.formula}) ${formatFrequency(b.frequency)}`).join(', ')}. They add up to ${formatFrequency(sum)}. A small curve shows the heterozygote frequency 2pq against p, highest at 0.5 when p is 0.5.`;

  return (
    <div className="simulation" data-engine="hardy-weinberg-v1">
      <SchematicTag text={HARDY_WEINBERG_LABEL} />
      <div className="scene-wrap chart-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={BAR.l} y={26} className="object-label">{label}</text>
          <text x={BAR.l} y={56} className="scene-label">p = {formatFrequency(p)} · q = 1 − p = {formatFrequency(q)}</text>
          <text x={BAR.l} y={76} className="scene-label-small">Genotype frequencies (A and a are generic names for the two alleles)</text>

          <g aria-hidden="true">
            <line x1={BAR.l} y1={BAR.top - 6} x2={BAR.l} y2={BAR.top + 3 * BAR.h + 2 * BAR.gap + 6} className="chart-axis" />
            {[0, 0.5, 1].map((v) => (
              <text key={v} x={barX(v)} y={BAR.top + 3 * BAR.h + 2 * BAR.gap + 22} textAnchor="middle" className="tick-label">{v}</text>
            ))}
            {bars.map((b, i) => {
              const y = BAR.top + i * (BAR.h + BAR.gap);
              const w = barX(b.frequency) - BAR.l;
              return (
                <g key={b.key}>
                  <rect x={BAR.l} y={y} width={BAR.r - BAR.l} height={BAR.h} className="bar-track" />
                  <rect x={BAR.l} y={y} width={Math.max(0, w)} height={BAR.h} className={b.checked ? 'bar-fill bar-checked' : 'bar-fill'} />
                  <text x={BAR.l - 8} y={y + BAR.h / 2 + 5} textAnchor="end" className="scene-label">{b.label}</text>
                  <text x={BAR.l + 8} y={y - 5} className="scene-label-small">{b.formula}</text>
                  <text x={Math.max(BAR.l + w + 8, BAR.l + 8)} y={y + BAR.h / 2 + 5} className="scene-label">{formatFrequency(b.frequency)}</text>
                </g>
              );
            })}

            <rect x={CURVE.l} y={CURVE.t} width={CURVE.r - CURVE.l} height={CURVE.b - CURVE.t} className="chart-box" />
            <text x={CURVE.l} y={CURVE.t - 12} className="scene-label-small">Heterozygote frequency 2pq against p</text>
            <polyline points={pointString(curve.map((c) => ({ x: sx(c.p), y: sy(c.h) })))} fill="none" className="line-compound" />
            <line x1={sx(p)} y1={sy(het)} x2={sx(p)} y2={CURVE.b} className="chart-guide" />
            <circle cx={sx(p)} cy={sy(het)} r={6.5} className="chart-dot" />
            {[0, 0.5, 1].map((v) => (
              <text key={v} x={sx(v)} y={CURVE.b + 18} textAnchor="middle" className="tick-label">{v}</text>
            ))}
            {[0, 0.25, 0.5].map((v) => (
              <text key={v} x={CURVE.l - 6} y={sy(v) + 4} textAnchor="end" className="tick-label">{v}</text>
            ))}
            <text x={(CURVE.l + CURVE.r) / 2} y={CURVE.b + 36} textAnchor="middle" className="tick-label tick-unit">p (frequency of the first allele)</text>
          </g>
        </svg>
      </div>

      <p className={`sum-note${sumOk ? '' : ' sum-note-bad'}`} role="note">
        p² + 2pq + q² = {bars.map((b) => formatFrequency(b.frequency)).join(' + ')} = <strong>{formatFrequency(sum)}</strong> — the three genotype frequencies always add up to 1, and so do p + q = {formatFrequency(p)} + {formatFrequency(q)} = {formatFrequency(p + q)}.
      </p>

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider key={m.key} label={shortInputLabel(m.label)} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(v) => onInput(m.key, v)} />
          ))}
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="q = 1 − p" value={formatFrequency(q)} unit="" accent="v" />
          <Readout name="Heterozygotes 2pq (engine)" value={formatFrequency(het)} unit="" accent="force" />
          <Readout name="Aa share of population" value={`${trimmed(het * 100, 2)}%`} unit="" />
        </dl>
      </div>
    </div>
  );
}
