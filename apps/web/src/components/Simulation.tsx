import { useId } from 'react';
import type { ChangeEvent } from 'react';
import type { Frame } from '../../../../packages/activities/forces-1d/engine.ts';
import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { sliderStep } from '../lib/track.ts';
import { Scene } from './Scene.tsx';
import { Graph } from './Graph.tsx';
import type { SimControls } from './useSimulation.ts';

const pickV = (f: Frame): number => f.v;
const pickX = (f: Frame): number => f.x;
const pickA = (f: Frame): number => f.a;

interface SliderProps {
  label: string;
  symbol: string;
  unit: string;
  unitWord: string;
  min: number;
  max: number;
  value: number;
  onChange: (v: number) => void;
}

function Slider({ label, symbol, unit, unitWord, min, max, value, onChange }: SliderProps) {
  const id = useId();
  const step = sliderStep(min, max);
  const shown = trimmed(value, 2);
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label} <span className="sym">({symbol})</span></label>
        <output htmlFor={id} className="slider-value">{shown} <span className="unit">{unit}</span></output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${shown} ${unitWord}`}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
      <div className="slider-ends" aria-hidden="true"><span>{min} {unit}</span><span>{max} {unit}</span></div>
    </div>
  );
}

function Readout({ name, value, unit, accent }: { name: string; value: string; unit: string; accent?: string }) {
  return (
    <div className={`readout${accent ? ` readout-${accent}` : ''}`}>
      <dt>{name}</dt>
      <dd><span className="num">{value}</span> <span className="unit">{unit}</span></dd>
    </div>
  );
}

export function Simulation({ sim, ctl }: { sim: ActivitySpec['simulation']; ctl: SimControls }) {
  const scrubId = useId();
  const obs = new Set(sim.observables);
  const forceMaxAbs = Math.max(Math.abs(sim.netForceN.min), Math.abs(sim.netForceN.max));
  const finished = ctl.t >= ctl.durationS - 1e-9;

  if (ctl.engineError !== null) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs ({ctl.engineError}). Adjust the sliders.</div>;
  }

  return (
    <div className="simulation">
      <div className="scene-wrap">
        <Scene
          scenario={sim.scenario}
          massKg={ctl.massKg}
          netForceN={ctl.netForceN}
          forceMaxAbs={forceMaxAbs}
          frames={ctl.frames}
          now={ctl.now}
        />
      </div>

      <div className="transport" role="group" aria-label="Playback">
        <button type="button" className="btn btn-primary" onClick={ctl.playing ? ctl.pause : ctl.play}>
          {ctl.playing ? '❚❚ Pause' : finished ? '↻ Replay' : '▶ Play'}
        </button>
        <button type="button" className="btn" onClick={ctl.reset}>⟲ Reset</button>
        <div className="scrub">
          <label htmlFor={scrubId}>Time</label>
          <input
            id={scrubId}
            type="range"
            min={0}
            max={ctl.durationS}
            step={sim.stepS}
            value={ctl.t}
            aria-valuetext={`${fixed(ctl.t, 2)} of ${fixed(ctl.durationS, 1)} seconds`}
            onChange={(e) => ctl.scrub(Number(e.target.value))}
          />
          <output htmlFor={scrubId} className="scrub-value">{fixed(ctl.t, 2)} / {fixed(ctl.durationS, 1)} s</output>
        </div>
      </div>

      <div className="controls-row">
        <div className="sliders">
          <Slider
            label="Mass" symbol="m" unit="kg" unitWord="kilograms"
            min={sim.massKg.min} max={sim.massKg.max} value={ctl.massKg} onChange={ctl.setMass}
          />
          <Slider
            label="Net force" symbol="F_net" unit="N" unitWord="newtons"
            min={sim.netForceN.min} max={sim.netForceN.max} value={ctl.netForceN} onChange={ctl.setForce}
          />
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          {obs.has('acceleration') && <Readout name="a = F/m" value={fixed(ctl.acceleration, 3)} unit="m/s²" accent="a" />}
          {obs.has('velocity') && <Readout name="v" value={fixed(ctl.now.v, 2)} unit="m/s" accent="v" />}
          {obs.has('position') && <Readout name="x" value={fixed(ctl.now.x, 2)} unit="m" accent="x" />}
          <Readout name="t" value={fixed(ctl.now.t, 2)} unit="s" />
        </dl>
      </div>

      <div className="graphs">
        {obs.has('velocity') && (
          <Graph title="v–t · velocity" yUnit="m/s" color="var(--c-vel)" frames={ctl.frames} pick={pickV} now={ctl.now} durationS={ctl.durationS} onScrub={ctl.scrub} />
        )}
        {obs.has('position') && (
          <Graph title="x–t · position" yUnit="m" color="var(--c-pos)" frames={ctl.frames} pick={pickX} now={ctl.now} durationS={ctl.durationS} onScrub={ctl.scrub} />
        )}
        {obs.has('acceleration') && (
          <Graph title="a–t · acceleration" yUnit="m/s²" color="var(--c-acc)" frames={ctl.frames} pick={pickA} now={ctl.now} durationS={ctl.durationS} onScrub={ctl.scrub} />
        )}
      </div>
    </div>
  );
}
