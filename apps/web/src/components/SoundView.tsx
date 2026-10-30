import { useId, useMemo } from 'react';
import type { SoundActivitySpec } from '../../../../packages/contracts/index.ts';
import { engineOutput, formatQuantity, rangeMaxima, scenarioLabels, sliderModels, SOUND_EMIT_EVERY_S, SOUND_LIFETIME_S } from '../lib/engines.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { ringPx, soundScaleMaxM, wavefronts } from '../lib/geometry.ts';
import { Readout, SchematicTag, Slider } from './controls.tsx';
import type { ClosedFormViewProps } from './ProjectileView.tsx';
import { IconPause, IconPlay, IconReset } from './icons.tsx';

export const SOUND_LABEL = 'Schematic';

const W = 800;
const H = 360;
const CX = 400;
const CY = 195;
const R_MAX = 150;

export function SoundView({ spec, inputs, onInput, pb, predict }: ClosedFormViewProps<SoundActivitySpec>) {
  const titleId = useId();
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const maxima = useMemo(() => rangeMaxima(spec), [spec]);
  const a = useMemo(() => engineOutput('speed-of-sound-v1', inputs), [inputs]);
  const scaleMaxM = useMemo(() => soundScaleMaxM({
    gamma: maxima['gamma'] ?? Number.NaN,
    gasConstantJPerKgK: maxima['gasConstantJPerKgK'] ?? Number.NaN,
    temperatureK: maxima['temperatureK'] ?? Number.NaN,
  }, SOUND_LIFETIME_S), [maxima]);
  const input = useMemo(() => ({
    gamma: inputs['gamma'] ?? Number.NaN,
    gasConstantJPerKgK: inputs['gasConstantJPerKgK'] ?? Number.NaN,
    temperatureK: inputs['temperatureK'] ?? Number.NaN,
  }), [inputs]);
  const rings = useMemo(
    () => (a === null ? [] : wavefronts(input, pb.t, { emitEveryS: SOUND_EMIT_EVERY_S, lifetimeS: SOUND_LIFETIME_S })),
    [a, input, pb.t],
  );

  if (a === null || scaleMaxM === null) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const alt = `${label}. Sound spreads outward from a source in rings. Gas: gamma ${trimmed(input.gamma, 3)}, gas constant ${trimmed(input.gasConstantJPerKgK, 3)} joules per kilogram kelvin, temperature ${trimmed(input.temperatureK, 3)} kelvin. Engine speed of sound ${formatQuantity(a)} metres per second. ${rings.length} wavefronts shown at ${fixed(pb.t, 2)} seconds.`;

  return (
    <div className="simulation" data-engine="speed-of-sound-v1">
      <SchematicTag text={SOUND_LABEL} />
      <div className="scene-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={56} y={26} className="object-label">{label}</text>
          <text x={56} y={48} className="scene-label-small">Each ring is a wavefront; its radius is r = a · t from the engine, on a fixed scale.</text>
          <g aria-hidden="true">
            {rings.map((r) => {
              const px = ringPx(r.radiusM, scaleMaxM, R_MAX);
              // Labels cycle through three angles so neighbouring rings never print over each other.
              const angle = [-0.7, 0, 0.7][r.index % 3] ?? 0;
              const lx = CX + px * Math.cos(angle) + 6;
              const ly = CY + px * Math.sin(angle) + 4;
              return (
                <g key={r.index}>
                  <circle cx={CX} cy={CY} r={px} className="wavefront" style={{ opacity: Math.max(0.15, r.opacity) }} />
                  {px > 30 && <text x={lx} y={ly} className="scene-label-small ring-label" style={{ opacity: Math.max(0.45, r.opacity) }}>{fixed(r.radiusM, 0)} m</text>}
                </g>
              );
            })}
            <circle cx={CX} cy={CY} r={7} className="sound-source" />
            <text x={CX} y={CY + 26} textAnchor="middle" className="scene-label-small">source</text>
          </g>
          <text x={W - 56} y={H - 14} textAnchor="end" className="scene-label">a = {formatQuantity(a)} m/s</text>
        </svg>
      </div>

      <div className="transport" role="group" aria-label="Playback">
        <button type="button" className="btn btn-primary" onClick={pb.playing ? pb.pause : pb.play}>
          {pb.playing ? <><IconPause /> Pause</> : <><IconPlay /> Play</>}
        </button>
        <button type="button" className="btn" onClick={pb.reset}><IconReset /> Reset</button>
        <span className="muted small" aria-live="off">Simulated time {fixed(pb.t, 2)} s · one new wavefront every {SOUND_EMIT_EVERY_S} s</span>
      </div>

      {predict}

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider key={m.key} label={m.label} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(val) => onInput(m.key, val)} />
          ))}
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Speed of sound a (engine)" value={fixed(a, 2)} unit="m/s" accent="v" />
        </dl>
      </div>
    </div>
  );
}
