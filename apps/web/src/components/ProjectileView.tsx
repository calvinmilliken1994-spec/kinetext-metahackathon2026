import { useId, useMemo } from 'react';
import { simulate, stateAt } from '../../../../packages/activities/projectile-v1/engine.ts';
import type { ProjectileActivitySpec } from '../../../../packages/contracts/index.ts';
import { projectileSummary, scenarioLabels, sliderModels } from '../lib/engines.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { projectileLayout } from '../lib/geometry.ts';
import { Readout, SchematicTag, Slider } from './controls.tsx';
import type { PlaybackCtl } from './usePlayback.ts';

export const PROJECTILE_LABEL = 'Schematic — drag-free model';

const W = 800;
const H = 320;
const BOX = { left: 64, right: 760, top: 56, bottom: 252 };

export interface ClosedFormViewProps<S> {
  spec: S;
  inputs: Record<string, number>;
  onInput: (key: string, value: number) => void;
  pb: PlaybackCtl;
}

export function ProjectileView({ spec, inputs, onInput, pb }: ClosedFormViewProps<ProjectileActivitySpec>) {
  const titleId = useId();
  const scrubId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const summary = useMemo(() => projectileSummary(inputs), [inputs]);
  const input = useMemo(() => ({
    horizontalSpeedMps: inputs['horizontalSpeedMps'] ?? 0,
    verticalSpeedMps: inputs['verticalSpeedMps'] ?? 0,
    gravityMps2: inputs['gravityMps2'] ?? 0,
  }), [inputs]);

  const frames = useMemo(() => {
    if (summary === null) return [];
    try {
      return simulate(input, summary.flightTimeS / 160);
    } catch {
      return [];
    }
  }, [input, summary]);

  const layout = useMemo(
    () => (summary === null ? null : projectileLayout(summary.rangeM, summary.maxHeightM, BOX)),
    [summary],
  );

  if (summary === null || layout === null || frames.length === 0) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const now = stateAt(input, pb.t);
  const pos = layout.toPx(now.x, now.y);
  const path = frames.map((f) => { const p = layout.toPx(f.x, f.y); return `${p.px.toFixed(1)},${p.py.toFixed(1)}`; }).join(' ');
  const trail = frames.filter((f) => f.t <= now.t).map((f) => { const p = layout.toPx(f.x, f.y); return `${p.px.toFixed(1)},${p.py.toFixed(1)}`; });
  trail.push(`${pos.px.toFixed(1)},${pos.py.toFixed(1)}`);
  const apex = stateAt(input, summary.apexTimeS);
  const apexPx = layout.toPx(apex.x, apex.y);
  const land = layout.toPx(summary.rangeM, 0);
  const finished = pb.t >= summary.flightTimeS - 1e-9;
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const alt = `${label}. Launched at ${trimmed(input.horizontalSpeedMps, 3)} metres per second sideways and ${trimmed(input.verticalSpeedMps, 3)} upward under ${trimmed(input.gravityMps2, 3)} metres per second squared. Maximum height ${fixed(summary.maxHeightM, 2)} metres, flight time ${fixed(summary.flightTimeS, 2)} seconds. At ${fixed(now.t, 2)} seconds: x ${fixed(now.x, 2)} metres, height ${fixed(now.y, 2)} metres.`;
  const apexLabelLeft = apexPx.px > BOX.right - 150;

  return (
    <div className="simulation" data-engine="projectile-v1">
      <SchematicTag text={PROJECTILE_LABEL} />
      <div className="scene-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={BOX.left} y={26} className="object-label">{label}</text>
          <rect x={BOX.left - 14} y={BOX.bottom - 3} width={BOX.right - BOX.left + 28} height={8} rx={4} className="track-band" />
          {layout.xTicks.map((x) => {
            const p = layout.toPx(x, 0);
            return (
              <g key={x} aria-hidden="true">
                <line x1={p.px} y1={BOX.bottom + 5} x2={p.px} y2={BOX.bottom + 14} className={x === 0 ? 'tick tick-zero' : 'tick'} />
                <text x={p.px} y={BOX.bottom + 30} textAnchor="middle" className="tick-label">{trimmed(x, 3)}</text>
              </g>
            );
          })}
          <text x={BOX.right + 28} y={BOX.bottom + 30} textAnchor="end" className="tick-label tick-unit">m</text>

          <polyline points={path} fill="none" className="traj-ghost" />
          <polyline points={trail.join(' ')} fill="none" className="traj-trail" />

          <g aria-hidden="true">
            <line x1={apexPx.px} y1={apexPx.py} x2={apexPx.px} y2={BOX.bottom} className="guide" />
            <circle cx={apexPx.px} cy={apexPx.py} r={5.5} className="apex-dot" />
            <text x={apexLabelLeft ? apexPx.px - 10 : apexPx.px + 10} y={apexPx.py - 8} textAnchor={apexLabelLeft ? 'end' : 'start'} className="scene-label apex-label">
              max height {fixed(summary.maxHeightM, 2)} m
            </text>
            <circle cx={land.px} cy={land.py} r={4} className="landing-dot" />
            <text x={Math.min(land.px, BOX.right + 20)} y={BOX.bottom - 20} textAnchor="end" className="scene-label-small">lands at t = {fixed(summary.flightTimeS, 2)} s</text>
          </g>

          <circle cx={pos.px} cy={pos.py} r={9} className="ball" />
        </svg>
      </div>

      <div className="transport" role="group" aria-label="Playback">
        <button type="button" className="btn btn-primary" onClick={pb.playing ? pb.pause : pb.play}>
          {pb.playing ? '❚❚ Pause' : finished ? '↻ Replay' : '▶ Play'}
        </button>
        <button type="button" className="btn" onClick={pb.reset}>⟲ Reset</button>
        <div className="scrub">
          <label htmlFor={scrubId}>Time</label>
          <input
            id={scrubId}
            type="range"
            min={0}
            max={summary.flightTimeS}
            step={summary.flightTimeS / 200}
            value={pb.t}
            aria-valuetext={`${fixed(pb.t, 2)} of ${fixed(summary.flightTimeS, 2)} seconds`}
            onChange={(e) => pb.scrub(Number(e.target.value))}
          />
          <output htmlFor={scrubId} className="scrub-value">{fixed(pb.t, 2)} / {fixed(summary.flightTimeS, 2)} s</output>
        </div>
      </div>

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider key={m.key} label={m.label} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(v) => onInput(m.key, v)} />
          ))}
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Max height (engine)" value={fixed(summary.maxHeightM, 3)} unit="m" accent="a" />
          <Readout name="Flight time (engine)" value={fixed(summary.flightTimeS, 3)} unit="s" accent="v" />
          <Readout name="Range" value={fixed(summary.rangeM, 2)} unit="m" accent="x" />
          <Readout name="Now: x, height" value={`${fixed(now.x, 1)}, ${fixed(now.y, 1)}`} unit="m" />
        </dl>
      </div>
    </div>
  );
}
