/**
 * TASK-012 — activity engine registry.
 *
 * One deterministic entry point, `computeOutput(engine, caseOrInputs)`, that
 * recomputes the single checked output of any registered engine from the
 * numeric inputs of an activity case (behavioral test / prediction) or from a
 * plain inputs record. Validation (packages/validation) and the UI renderers
 * both go through this module, so a spec's stated outputs are always
 * re-executed by exactly the code the catalogue describes.
 *
 * Descriptor-driven: the input keys read from `caseOrInputs` come from
 * ENGINES[engine].inputs (packages/contracts/engines.ts) — the registry never
 * hardcodes an engine's input list beyond the dispatch call itself.
 *
 * Error policy (same as the engines): non-finite inputs, missing descriptor
 * keys (read as NaN) and unknown engine ids throw a RangeError whose message
 * is a stable code (UNKNOWN_ENGINE:<id> or the engine's own code). No
 * function ever returns NaN.
 *
 * Pure and browser-safe: no I/O, no Date, no randomness.
 */

import { ENGINES, isEngineId } from '../contracts/index.ts';
import type { ActivityCase, EngineId } from '../contracts/index.ts';
import { accelerationOf } from './forces-1d/engine.ts';
import { maxHeightOf } from './projectile-v1/engine.ts';
import { liftOf } from './lift-equation-v1/engine.ts';
import { speedOfSoundOf } from './speed-of-sound-v1/engine.ts';
import { amountAfter } from './compound-interest-v1/engine.ts';
import { heterozygoteFrequencyOf } from './hardy-weinberg-v1/engine.ts';
import { remainingAfter } from './half-life-v1/engine.ts';

/** Anything carrying the engine's numeric input keys (an ActivityCase, a test, a prediction, a slider state). */
export type EngineInputs = ActivityCase | Record<string, number>;

/** The engine's input keys, in catalogue order. */
export function inputKeys(engine: EngineId): string[] {
  return ENGINES[engine].inputs.map(i => i.key);
}

/** The key of the single checked output every case must state (e.g. 'expectedLiftN'). */
export function outputKey(engine: EngineId): string {
  return ENGINES[engine].output.key;
}

/**
 * Extract the engine's numeric inputs from a case/inputs object, driven by
 * the descriptor's input keys. Missing or non-numeric keys become NaN so the
 * engines reject them with their stable error codes.
 */
export function inputsOf(engine: EngineId, c: EngineInputs): Record<string, number> {
  const rec = c as unknown as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const input of ENGINES[engine].inputs) {
    const v = rec[input.key];
    out[input.key] = typeof v === 'number' ? v : Number.NaN;
  }
  return out;
}

/**
 * Recompute the checked output of `engine` from the inputs carried by `c`.
 *
 * @throws RangeError('UNKNOWN_ENGINE:<id>') for an id outside the catalogue.
 * @throws the dispatched engine's RangeError codes for non-finite or
 * out-of-domain inputs (including descriptor keys missing from `c`).
 */
export function computeOutput(engine: EngineId, c: EngineInputs): number {
  if (!isEngineId(engine)) {
    throw new RangeError(`UNKNOWN_ENGINE:${String(engine)}`);
  }
  const inputs = inputsOf(engine, c);
  switch (engine) {
    case 'forces-1d-v1':
      return accelerationOf(inputs.massKg, inputs.netForceN);
    case 'projectile-v1':
      return maxHeightOf({ verticalSpeedMps: inputs.verticalSpeedMps, gravityMps2: inputs.gravityMps2 });
    case 'lift-equation-v1':
      return liftOf({
        liftCoefficient: inputs.liftCoefficient,
        airDensityKgM3: inputs.airDensityKgM3,
        airspeedMps: inputs.airspeedMps,
        wingAreaM2: inputs.wingAreaM2,
      });
    case 'speed-of-sound-v1':
      return speedOfSoundOf({
        gamma: inputs.gamma,
        gasConstantJPerKgK: inputs.gasConstantJPerKgK,
        temperatureK: inputs.temperatureK,
      });
    case 'compound-interest-v1':
      return amountAfter({
        principalUSD: inputs.principalUSD,
        annualRatePercent: inputs.annualRatePercent,
        compoundsPerYear: inputs.compoundsPerYear,
        years: inputs.years,
      });
    case 'hardy-weinberg-v1':
      return heterozygoteFrequencyOf(inputs.alleleFrequencyP);
    case 'half-life-v1':
      return remainingAfter({ initialAmount: inputs.initialAmount, halfLife: inputs.halfLife, elapsedTime: inputs.elapsedTime });
  }
}
