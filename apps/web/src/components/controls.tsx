import { useId } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { readableNumber, sliderEndLabel } from '../lib/format.ts';
import { stopIndex } from '../lib/compound.ts';
import { unitForValue } from '../lib/engines.ts';
import { IconReset } from './icons.tsx';
import { CONCEALED, CONCEALED_HINT } from '../lib/reveal.ts';

export interface SliderProps {
  label: string;
  /** Optional math symbol shown after the label, e.g. 'F_net' or a typeset symbol. */
  symbol?: ReactNode;
  /** The quantity's full description when `label` is a short form of it: the label's tooltip and the slider's description. */
  description?: string;
  unit: string;
  min: number;
  max: number;
  /** Slider step; defaults to a 1/2/5 step chosen by the caller. */
  step: number;
  value: number;
  onChange: (v: number) => void;
  /** One-click values stated on the source page (Stage 7); the slider stays free. `title` is the page sentence. */
  presets?: readonly SliderPreset[];
}

export interface SliderPreset { value: number; label: string; title: string; active: boolean }

export function Slider({ label, symbol, description, unit, min, max, step, value, onChange, presets }: SliderProps) {
  const id = useId();
  const descId = `${id}-desc`;
  const shown = readableNumber(value);
  const shownUnit = unitForValue(unit, Number(shown));
  const described = description !== undefined && description !== label;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id} title={described ? description : undefined}>{label}{symbol !== undefined && <> <span className="sym">({symbol})</span></>}</label>
        <output htmlFor={id} className="slider-value">{shown}{shownUnit !== '' && <> <span className="unit">{shownUnit}</span></>}</output>
      </div>
      {described && <span id={descId} className="sr-only">{description}</span>}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${shown} ${shownUnit}`.trim()}
        aria-describedby={described ? descId : undefined}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
      <div className="slider-ends" aria-hidden="true"><span>{sliderEndLabel(min, unit)}</span><span>{sliderEndLabel(max, unit)}</span></div>
      {presets !== undefined && presets.length > 0 && (
        <div className="slider-presets" role="group" aria-label={`${label}: values stated on the page`}>
          <span className="slider-presets-label">On the page</span>
          {presets.map((p) => (
            <button key={p.value} type="button" className="preset-chip" aria-pressed={p.active} title={p.title} onClick={() => onChange(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface StopSliderProps {
  label: string;
  /** The values the slider can sit on, ascending. */
  stops: readonly number[];
  /** Current value; the thumb sits on the exact stop, else the nearest one. */
  value: number;
  /** Text shown for a stop, e.g. '12 per year · monthly'. */
  format: (stop: number) => string;
  onChange: (stop: number) => void;
}

/** A slider that snaps to a short list of meaningful values instead of a continuous range. */
export function StopSlider({ label, stops, value, format, onChange }: StopSliderProps) {
  const id = useId();
  const index = stopIndex(stops, value);
  const shown = format(stops[index] ?? value);
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="slider-value">{shown}</output>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={Math.max(0, stops.length - 1)}
        step={1}
        value={index}
        aria-valuetext={shown}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = stops[Number(e.target.value)];
          if (next !== undefined) onChange(next);
        }}
      />
      <div className="slider-ends" aria-hidden="true"><span>{format(stops[0] ?? value)}</span><span>{format(stops[stops.length - 1] ?? value)}</span></div>
    </div>
  );
}

/** `concealed`: case 1's answer is not shown yet (predict-then-reveal); a neutral '?' stands in for the number. */
export function Readout({ name, value, unit, accent, concealed = false }: { name: string; value: string; unit: string; accent?: string; concealed?: boolean }) {
  return (
    <div className={`readout${accent ? ` readout-${accent}` : ''}`}>
      <dt>{name}</dt>
      {concealed
        ? <dd><span className="num concealed" title={CONCEALED_HINT}>{CONCEALED}</span><span className="sr-only"> ({CONCEALED_HINT})</span></dd>
        : <dd><span className="num">{value}</span> <span className="unit">{unit}</span></dd>}
    </div>
  );
}

/** The honesty label every closed-form animation carries. */
export function SchematicTag({ text }: { text: string }) {
  return <p className="schematic-tag" role="note">{text}</p>;
}

/** Sliders back to the lesson's opening case (its first prediction; the spec defaults when there is no case). */
export function ResetSliders({ onReset }: { onReset: () => void }) {
  return (
    <button type="button" className="btn btn-small reset-sliders" onClick={onReset} title="Back to the lesson's opening case">
      <IconReset /> Reset sliders
    </button>
  );
}
