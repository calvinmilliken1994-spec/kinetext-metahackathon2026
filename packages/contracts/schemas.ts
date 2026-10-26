// Schema loading for Node (server side). The browser never validates; it receives reports from the API.
import { readFileSync } from 'node:fs';

function load(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), 'utf8'));
}

export const activitySpecFullSchema = load('activity-spec.full.json');
export const activitySpecGenSchema = load('activity-spec.gen.json');
export const sourceAnalysisGenSchema = load('source-analysis.gen.json');
