import { readFileSync } from 'node:fs';
import { ENGINE_IDS } from './engines.ts';
import type { EngineId } from './engines.ts';
import { KIT_GEN_SCHEMA_FILES, SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE } from './kit.ts';
import type { KitGenComponentId } from './kit.ts';

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'));
}

export const activitySpecFullSchema = load('activity-spec.full.json');
export const activitySpecGenSchema = load('activity-spec.gen.json');
export const sourceAnalysisGenSchema = load('source-analysis.gen.json');

const fileFor = (kind: 'gen' | 'full', engine: EngineId): string =>
  engine === 'forces-1d-v1' ? `activity-spec.${kind}.json` : `activity-spec.${kind}.${engine}.json`;

const genSchemas = Object.fromEntries(ENGINE_IDS.map(e => [e, load(fileFor('gen', e))])) as Record<EngineId, Record<string, unknown>>;
const fullSchemas = Object.fromEntries(ENGINE_IDS.map(e => [e, load(fileFor('full', e))])) as Record<EngineId, Record<string, unknown>>;

export function genSchemaFor(engine: EngineId): Record<string, unknown> {
  return genSchemas[engine];
}

export function fullSchemaFor(engine: EngineId): Record<string, unknown> {
  return fullSchemas[engine];
}

export const timelineGenSchema = load('activity-spec.gen.timeline-v1.json');
export const timelineFullSchema = load('activity-spec.full.timeline-v1.json');

export const sourceAnalysisV2GenSchema = load(SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE);

const kitGenSchemas = Object.fromEntries(
  (Object.keys(KIT_GEN_SCHEMA_FILES) as KitGenComponentId[]).map((c) => [c, load(KIT_GEN_SCHEMA_FILES[c] as string)])
) as Record<KitGenComponentId, Record<string, unknown>>;

export function kitGenSchemaFor(componentId: KitGenComponentId): Record<string, unknown> {
  return kitGenSchemas[componentId];
}
