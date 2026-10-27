// Engine view-model helpers (pure). Every number shown for projectile / lift / speed-of-sound comes from the
// SAME deterministic engines the validator ran (packages/activities/**); nothing here re-implements physics.

import { ENGINES, isEngineId } from '../../../../packages/contracts/index.ts';
import type { ActivityCase, ActivitySpec, ActivitySpecByEngine, EngineId } from '../../../../packages/contracts/index.ts';
import { computeOutput, inputsOf } from '../../../../packages/activities/registry.ts';
import { flightTimeOf, stateAt } from '../../../../packages/activities/projectile-v1/engine.ts';
import { fixed, trimmed } from './format.ts';
import { sliderStep } from './track.ts';

/** Display name of an engine ('Lift equation'), or null for an unknown / missing id. */
export function engineTitle(engine: string | null | undefined): string | null {
  return isEngineId(engine) ? ENGINES[engine].title : null;
}

/** Type guard: narrow an ActivitySpec to one engine's spec (the union is discriminated one level down). */
export function isEngineSpec<E extends EngineId>(spec: ActivitySpec, engine: E): spec is ActivitySpecByEngine[E] {
  return (spec as { simulation?: { engine?: unknown } }).simulation?.engine === engine;
}

/** 'm/s^2' → 'm/s²', 'kg/m^3' → 'kg/m³', 'J/(kg*K)' → 'J/(kg·K)'; '1' (dimensionless) → ''. */
export function prettyUnit(unit: string): string {
  if (unit === '1') return '';
  const sup: Record<string, string> = { '2': '²', '3': '³' };
  return unit.replace(/\^(\d)/g, (_m, d: string) => sup[d] ?? `^${d}`).replace(/\*/g, '·');
}

export interface SliderModel {
  key: string;
  label: string;
  /** Display unit; '' for dimensionless inputs. */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** The spec's default value. */
  value: number;
}

interface RangeLike { min: number; max: number; default: number }

function rangeOf(spec: ActivitySpec, key: string): RangeLike | null {
  const r = (spec.simulation as unknown as Record<string, unknown>)[key];
  if (typeof r !== 'object' || r === null) return null;
  const { min, max, default: d } = r as Record<string, unknown>;
  return typeof min === 'number' && typeof max === 'number' && typeof d === 'number'
    && Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(d) && max >= min
    ? { min, max, default: d }
    : null;
}

/** One slider per engine input, with the spec's own range and default. Inputs the spec lacks are skipped. */
export function sliderModels(spec: ActivitySpec): SliderModel[] {
  const engine = spec.simulation.engine;
  if (!isEngineId(engine)) return [];
  const out: SliderModel[] = [];
  for (const input of ENGINES[engine].inputs) {
    const r = rangeOf(spec, input.key);
    if (r === null) continue;
    out.push({
      key: input.key, label: input.label, unit: prettyUnit(input.unit),
      min: r.min, max: r.max, step: sliderStep(r.min, r.max), value: r.default,
    });
  }
  return out;
}

/** The spec's default slider positions, keyed by engine input key. */
export function defaultInputs(spec: ActivitySpec): Record<string, number> {
  return Object.fromEntries(sliderModels(spec).map((m) => [m.key, m.value]));
}

/** Largest value of each input range (used to fix drawing scales so moving a slider visibly changes the picture). */
export function rangeMaxima(spec: ActivitySpec): Record<string, number> {
  return Object.fromEntries(sliderModels(spec).map((m) => [m.key, m.max]));
}

export function clampToSlider(m: Pick<SliderModel, 'min' | 'max'>, v: number): number {
  return Math.min(m.max, Math.max(m.min, v));
}

export interface ScenarioLabels { objectLabel: string; placeLabel: string; placeKind: 'surface' | 'setting' }

/** Scenario labels from spec.simulation.scenario: forces use surfaceLabel, the other engines settingLabel. */
export function scenarioLabels(spec: ActivitySpec): ScenarioLabels {
  const sc = spec.simulation.scenario as { objectLabel?: unknown; surfaceLabel?: unknown; settingLabel?: unknown };
  const objectLabel = typeof sc.objectLabel === 'string' ? sc.objectLabel : '';
  if (typeof sc.surfaceLabel === 'string') return { objectLabel, placeLabel: sc.surfaceLabel, placeKind: 'surface' };
  return { objectLabel, placeLabel: typeof sc.settingLabel === 'string' ? sc.settingLabel : '', placeKind: 'setting' };
}

export interface OutputInfo { key: string; label: string; unit: string }

/** Label and display unit of the engine's single checked output (what every prediction guesses). */
export function outputInfo(engine: EngineId): OutputInfo {
  const o = ENGINES[engine].output;
  return { key: o.key, label: o.label, unit: prettyUnit(o.unit) };
}

/** Engine inputs of a case/prediction, keyed by descriptor key. */
export function caseInputs(engine: EngineId, c: ActivityCase): Record<string, number> {
  return inputsOf(engine, c);
}

/** The reference value for a case: ALWAYS recomputed by the engine, never the spec's stored expectation. Null if the engine rejects it. */
export function engineOutput(engine: EngineId, inputs: ActivityCase | Record<string, number>): number | null {
  try {
    const v = computeOutput(engine, inputs);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Compact number for readouts: grouping for large values, 3 decimals for small ones, no trailing zeros. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return a >= 100 ? trimmed(n, 2) : trimmed(n, 3);
}

/** One-line explanation of how the engine got a prediction's answer (shown after "Run it"). */
export function predictionExplanation(engine: EngineId, c: ActivityCase, actual: number): string {
  const out = outputInfo(engine);
  const value = `${formatQuantity(actual)}${out.unit === '' ? '' : ` ${out.unit}`}`;
  if (engine === 'forces-1d-v1') {
    const i = caseInputs(engine, c);
    return `a = F/m = ${trimmed(i['netForceN'] ?? Number.NaN, 4)} / ${trimmed(i['massKg'] ?? Number.NaN, 4)} = ${fixed(actual, 3)} m/s²`;
  }
  const i = caseInputs(engine, c);
  const given = ENGINES[engine].inputs
    .map((inp) => `${inp.label} = ${trimmed(i[inp.key] ?? Number.NaN, 4)}${prettyUnit(inp.unit) === '' ? '' : ` ${prettyUnit(inp.unit)}`}`)
    .join(', ');
  return `${given} → ${out.label.toLowerCase()} = ${value}`;
}

// ---- projectile ----------------------------------------------------------------------------------------

export interface ProjectileSummary { maxHeightM: number; flightTimeS: number; rangeM: number; apexTimeS: number }

/** Max height, flight time and range, all from the projectile engine. Null when the engine rejects the inputs. */
export function projectileSummary(inputs: Record<string, number>): ProjectileSummary | null {
  const input = {
    horizontalSpeedMps: inputs['horizontalSpeedMps'] ?? Number.NaN,
    verticalSpeedMps: inputs['verticalSpeedMps'] ?? Number.NaN,
    gravityMps2: inputs['gravityMps2'] ?? Number.NaN,
  };
  try {
    const maxHeightM = computeOutput('projectile-v1', input);
    const flightTimeS = flightTimeOf(input);
    return { maxHeightM, flightTimeS, rangeM: stateAt(input, flightTimeS).x, apexTimeS: flightTimeS / 2 };
  } catch {
    return null;
  }
}

// ---- playback plans -------------------------------------------------------------------------------------

export interface PlaybackPlan {
  /** Simulated seconds until playback stops (Infinity = runs until paused). */
  durationS: number;
  /** Simulated seconds per wall-clock second. */
  speed: number;
  /** Simulated time shown before the user presses Play. */
  initialT: number;
}

/** Wall-clock length of a projectile flight is clamped into [minWall, maxWall] seconds so it is watchable. */
export function playbackSpeed(flightS: number, minWall = 2, maxWall = 8): number {
  if (!(flightS > 0) || !Number.isFinite(flightS)) return 1;
  return flightS / Math.min(maxWall, Math.max(minWall, flightS));
}

/** Wavefront rings are emitted this often (simulated seconds) and fade after `lifetimeS`. */
export const SOUND_EMIT_EVERY_S = 0.5;
export const SOUND_LIFETIME_S = 2.5;
/** Paused sound view starts here so several rings are already visible. */
export const SOUND_INITIAL_T = 2;

/** How each engine's view plays: projectile = one flight, sound = continuous rings, lift = static (null). */
export function playbackPlan(engine: EngineId, inputs: Record<string, number>): PlaybackPlan | null {
  if (engine === 'projectile-v1') {
    const s = projectileSummary(inputs);
    return s === null ? { durationS: 0, speed: 1, initialT: 0 } : { durationS: s.flightTimeS, speed: playbackSpeed(s.flightTimeS), initialT: 0 };
  }
  if (engine === 'speed-of-sound-v1') return { durationS: Number.POSITIVE_INFINITY, speed: 1, initialT: SOUND_INITIAL_T };
  return null;
}
