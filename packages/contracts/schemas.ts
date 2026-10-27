// Schema loading for Node (server side). The browser never validates; it receives reports from the API.
// Per-engine schemas are generated from packages/contracts/engines.ts by scripts/build-schemas.ts.
import { readFileSync } from 'node:fs';
import { ENGINE_IDS } from './engines.ts';
import type { EngineId } from './engines.ts';

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'));
}

/** forces-1d-v1 schemas (Stage 2 names, unchanged files). */
export const activitySpecFullSchema = load('activity-spec.full.json');
export const activitySpecGenSchema = load('activity-spec.gen.json');
export const sourceAnalysisGenSchema = load('source-analysis.gen.json');

const fileFor = (kind: 'gen' | 'full', engine: EngineId): string =>
  engine === 'forces-1d-v1' ? `activity-spec.${kind}.json` : `activity-spec.${kind}.${engine}.json`;

const genSchemas = Object.fromEntries(ENGINE_IDS.map(e => [e, load(fileFor('gen', e))])) as Record<EngineId, Record<string, unknown>>;
const fullSchemas = Object.fromEntries(ENGINE_IDS.map(e => [e, load(fileFor('full', e))])) as Record<EngineId, Record<string, unknown>>;

/** The flat schema Muse fills for this engine (constrained decoding). */
export function genSchemaFor(engine: EngineId): Record<string, unknown> {
  return genSchemas[engine];
}

/** The full schema an assembled spec of this engine must satisfy. */
export function fullSchemaFor(engine: EngineId): Record<string, unknown> {
  return fullSchemas[engine];
}
