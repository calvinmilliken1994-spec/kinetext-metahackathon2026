import { useId } from 'react';
import type { ChangeEvent } from 'react';
import { trimmed } from '../lib/format.ts';

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
  return <p className="schematic-tag" role="note"><span aria-hidden="true">◇</span> {text}</p>;
}
