import { useId } from 'react';
import type { ChangeEvent } from 'react';
import { trimmed } from '../lib/format.ts';
import { stopIndex } from '../lib/compound.ts';

export interface SliderProps {
  label: string;
  /** Optional math symbol shown after the label, e.g. 'F_net'. */
  symbol?: string;
  unit: string;
  min: number;
  max: number;
  /** Slider step; defaults to a 1/2/5 step chosen by the caller. */
  step: number;
  value: number;
  onChange: (v: number) => void;
}

export function Slider({ label, symbol, unit, min, max, step, value, onChange }: SliderProps) {
  const id = useId();
  const shown = trimmed(value, 3);
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}{symbol !== undefined && <> <span className="sym">({symbol})</span></>}</label>
        <output htmlFor={id} className="slider-value">{shown}{unit !== '' && <> <span className="unit">{unit}</span></>}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={`${shown} ${unit}`.trim()}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
      <div className="slider-ends" aria-hidden="true"><span>{trimmed(min, 3)} {unit}</span><span>{trimmed(max, 3)} {unit}</span></div>
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

export function Readout({ name, value, unit, accent }: { name: string; value: string; unit: string; accent?: string }) {
  return (
    <div className={`readout${accent ? ` readout-${accent}` : ''}`}>
      <dt>{name}</dt>
      <dd><span className="num">{value}</span> <span className="unit">{unit}</span></dd>
    </div>
  );
}

/** The honesty label every closed-form animation carries. */
export function SchematicTag({ text }: { text: string }) {
  return <p className="schematic-tag" role="note">{text}</p>;
}
