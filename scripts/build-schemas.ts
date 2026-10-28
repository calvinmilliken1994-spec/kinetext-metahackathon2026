// Generates the per-engine JSON schemas from packages/contracts/engines.ts (lead-owned).
// forces-1d-v1 keeps its original files (activity-spec.gen.json / activity-spec.full.json) so recorded Stage 2
// evidence keeps validating; only its full schemaVersion widens to the accepted list.
// Usage: node scripts/build-schemas.ts [--check]   (--check exits 1 if any file would change)
import { readFileSync, writeFileSync } from 'node:fs';
import { ACCEPTED_SCHEMA_VERSIONS, ENGINES, ENGINE_IDS, SCHEMA_VERSION, SEQUENCE_ENGINES } from '../packages/contracts/index.ts';
import type { EngineDescriptor, EngineId, SequenceDescriptor } from '../packages/contracts/index.ts';

const dir = new URL('../schemas/', import.meta.url);
const read = (name: string): Record<string, any> => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const check = process.argv.includes('--check');
let changed = 0;

function emit(name: string, schema: unknown): void {
  const text = JSON.stringify(schema, null, 2) + '\n';
  let current = '';
  try { current = readFileSync(new URL(name, dir), 'utf8').replace(/\r\n/g, '\n'); } catch { /* new file */ }
  if (current === text) return;
  changed++;
  if (check) console.log(`would change: schemas/${name}`);
  else { writeFileSync(new URL(name, dir), text); console.log(`wrote schemas/${name}`); }
}

const describe = (label: string, unit: string): string => (unit === '1' ? `${label} (dimensionless)` : `${label} in ${unit}`);

function genSchema(d: EngineDescriptor): Record<string, any> {
  const forcesGen = read('activity-spec.gen.json');
  const range = (label: string, unit: string) => ({
    type: 'object', additionalProperties: false, required: ['min', 'max', 'default'],
    description: `Slider range for ${describe(label, unit)}.`,
    properties: { min: { type: 'number' }, max: { type: 'number' }, default: { type: 'number' } },
  });
  const simProps: Record<string, unknown> = {};
  for (const i of d.inputs) simProps[i.key] = range(i.label, i.unit);
  simProps.scenario = {
    type: 'object', additionalProperties: false, required: d.scenarioKeys,
    properties: Object.fromEntries(d.scenarioKeys.map(k => [k, { type: 'string' }])),
  };
  const caseProps = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const i of d.inputs) p[i.key] = { type: 'number', description: describe(i.label, i.unit) };
    p[d.output.key] = { type: 'number', description: `${describe(d.output.label, d.output.unit)}, computed with ${d.equation} from the inputs of this case.` };
    p.tolerance = { type: 'number', description: 'Allowed absolute difference from the exact value; small and positive.' };
    return p;
  };
  const caseKeys = [...d.inputs.map(i => i.key), d.output.key, 'tolerance'];
  return {
    ...forcesGen,
    properties: {
      ...forcesGen.properties,
      simulation: { type: 'object', additionalProperties: false, required: [...d.inputs.map(i => i.key), 'scenario'], properties: simProps },
      behavioralTests: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['name', ...caseKeys], properties: { name: { type: 'string' }, ...caseProps() } },
      },
      predictions: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', ...caseKeys], properties: { id: { type: 'string' }, prompt: { type: 'string' }, ...caseProps() } },
      },
    },
  };
}

function bound(min: number, max: number, exclusiveMin = false): Record<string, number | string> {
  return exclusiveMin ? { type: 'number', exclusiveMinimum: min, maximum: max } : { type: 'number', minimum: min, maximum: max };
}

function fullSchema(d: EngineDescriptor): Record<string, any> {
  const forcesFull = read('activity-spec.full.json');
  const simProps: Record<string, unknown> = { engine: { const: d.id }, equation: { const: d.equation } };
  for (const i of d.inputs) {
    const b = bound(i.hardMin, i.hardMax, i.exclusiveMin);
    simProps[i.key] = {
      type: 'object', additionalProperties: false, required: ['unit', 'min', 'max', 'default'],
      properties: { unit: { const: i.unit }, min: b, max: b, default: b },
    };
  }
  simProps.scenario = {
    type: 'object', additionalProperties: false, required: d.scenarioKeys,
    properties: Object.fromEntries(d.scenarioKeys.map(k => [k, { type: 'string', minLength: 1, maxLength: 60 }])),
  };
  const caseProps = (): Record<string, unknown> => {
    const p: Record<string, unknown> = {};
    for (const i of d.inputs) p[i.key] = bound(i.hardMin, i.hardMax, i.exclusiveMin);
    p[d.output.key] = bound(d.output.hardMin, d.output.hardMax);
    p.tolerance = { type: 'number', exclusiveMinimum: 0, maximum: Math.max(d.tolerance.absMax, d.tolerance.relMax * Math.max(Math.abs(d.output.hardMin), Math.abs(d.output.hardMax))) };
    return p;
  };
  const caseKeys = [...d.inputs.map(i => i.key), d.output.key, 'tolerance'];
  const fb = forcesFull.properties.behavioralTests;
  const fp = forcesFull.properties.predictions;
  return {
    ...forcesFull,
    $id: `https://make-knowledge-interactive.local/schemas/activity-spec.full.${d.id}.json`,
    title: `Activity spec (full) — ${d.title}`,
    properties: {
      ...forcesFull.properties,
      schemaVersion: { const: SCHEMA_VERSION },
      simulation: { type: 'object', additionalProperties: false, required: ['engine', 'equation', ...d.inputs.map(i => i.key), 'scenario'], properties: simProps },
      behavioralTests: {
        ...fb,
        items: { type: 'object', additionalProperties: false, required: ['name', ...caseKeys], properties: { name: fb.items.properties.name, ...caseProps() } },
      },
      predictions: {
        ...fp,
        items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', ...caseKeys], properties: { id: fp.items.properties.id, prompt: fp.items.properties.prompt, ...caseProps() } },
      },
    },
  };
}

// forces-1d-v1: original files; widen the accepted schema versions only.
const forcesFull = read('activity-spec.full.json');
forcesFull.properties.schemaVersion = { enum: [...ACCEPTED_SCHEMA_VERSIONS] };
emit('activity-spec.full.json', forcesFull);

for (const id of ENGINE_IDS) {
  if (id === 'forces-1d-v1') continue;
  emit(`activity-spec.gen.${id}.json`, genSchema(ENGINES[id as EngineId]));
  emit(`activity-spec.full.${id}.json`, fullSchema(ENGINES[id as EngineId]));
}

// timeline-v1 (sequence engine): events with integer dates (month/day 0 = not stated) + ordering pairs.
function timelineSchemas(d: SequenceDescriptor): { gen: Record<string, any>; full: Record<string, any> } {
  const forcesGen = read('activity-spec.gen.json');
  const forcesFull = read('activity-spec.full.json');
  const evidenceGen = forcesGen.properties.explanations.items.properties.evidence.items;
  const evidenceFull = forcesFull.properties.explanations.items.properties.evidence.items;
  const pairGen = {
    earlierEventId: { type: 'string', description: 'Id of the event that happened first (the correct answer).' },
    laterEventId: { type: 'string', description: 'Id of the event that happened later.' },
  };
  const idPattern = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,39}$' };
  const scenario = (full: boolean) => ({
    type: 'object', additionalProperties: false, required: d.scenarioKeys,
    properties: Object.fromEntries(d.scenarioKeys.map(k => [k, full ? { type: 'string', minLength: 1, maxLength: 60 } : { type: 'string' }])),
  });
  const eventGen = {
    type: 'object', additionalProperties: false, required: ['id', 'label', 'year', 'month', 'day', 'evidence'],
    properties: {
      id: { type: 'string', description: 'Short id such as e1.' },
      label: { type: 'string', description: 'Short learner-facing name of the event, 80 characters or fewer.' },
      year: { type: 'integer', description: 'Year stated in the source; negative for BCE; never 0.' },
      month: { type: 'integer', description: 'Month 1-12 only if stated in the same sentence as the date; otherwise 0.' },
      day: { type: 'integer', description: 'Day 1-31 only if stated in the same sentence; otherwise 0.' },
      evidence: { type: 'array', description: '1-2 verbatim quotes; the first must contain the date.', items: evidenceGen },
    },
  };
  const eventFull = {
    type: 'object', additionalProperties: false, required: ['id', 'label', 'year', 'month', 'day', 'evidence'],
    properties: {
      id: idPattern,
      label: { type: 'string', minLength: 1, maxLength: 80 },
      year: { type: 'integer', minimum: d.yearMin, maximum: d.yearMax, not: { const: 0 } },
      month: { type: 'integer', minimum: 0, maximum: 12 },
      day: { type: 'integer', minimum: 0, maximum: 31 },
      evidence: { type: 'array', minItems: 1, maxItems: 2, items: evidenceFull },
    },
    if: { properties: { day: { minimum: 1 } } },
    then: { properties: { month: { minimum: 1 } } },
  };
  const fb = forcesFull.properties.behavioralTests;
  const fp = forcesFull.properties.predictions;
  const gen = {
    ...forcesGen,
    properties: {
      ...forcesGen.properties,
      simulation: { type: 'object', additionalProperties: false, required: ['events', 'scenario'], properties: { events: { type: 'array', items: eventGen }, scenario: scenario(false) } },
      behavioralTests: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'earlierEventId', 'laterEventId'], properties: { name: { type: 'string' }, ...pairGen } } },
      predictions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', 'earlierEventId', 'laterEventId'], properties: { id: { type: 'string' }, prompt: { type: 'string' }, ...pairGen } } },
    },
  };
  const full = {
    ...forcesFull,
    $id: `https://make-knowledge-interactive.local/schemas/activity-spec.full.${d.id}.json`,
    title: `Activity spec (full) — ${d.title}`,
    properties: {
      ...forcesFull.properties,
      schemaVersion: { const: SCHEMA_VERSION },
      simulation: {
        type: 'object', additionalProperties: false, required: ['engine', 'events', 'scenario'],
        properties: { engine: { const: d.id }, events: { type: 'array', minItems: d.events.min, maxItems: d.events.max, items: eventFull }, scenario: scenario(true) },
      },
      behavioralTests: {
        ...fb, minItems: d.behavioralTests.min, maxItems: d.behavioralTests.max,
        items: { type: 'object', additionalProperties: false, required: ['name', 'earlierEventId', 'laterEventId'], properties: { name: fb.items.properties.name, earlierEventId: idPattern, laterEventId: idPattern } },
      },
      predictions: {
        ...fp, minItems: d.predictions.min, maxItems: d.predictions.max,
        items: { type: 'object', additionalProperties: false, required: ['id', 'prompt', 'earlierEventId', 'laterEventId'], properties: { id: fp.items.properties.id, prompt: fp.items.properties.prompt, earlierEventId: idPattern, laterEventId: idPattern } },
      },
    },
  };
  return { gen, full };
}

{
  const tl = timelineSchemas(SEQUENCE_ENGINES['timeline-v1']);
  emit('activity-spec.gen.timeline-v1.json', tl.gen);
  emit('activity-spec.full.timeline-v1.json', tl.full);
}

const analysis = read('source-analysis.gen.json');
analysis.properties.supported = {
  type: 'boolean',
  description: 'True only if one of the listed activity engines fits what the source teaches; otherwise false.',
};
analysis.properties.activity = { type: 'string', enum: [...ENGINE_IDS, 'none'], description: "The single best-fitting engine id, or 'none' when unsupported." };
emit('source-analysis.gen.json', analysis);

if (check && changed > 0) process.exit(1);
console.log(check ? 'schemas up to date' : `done (${changed} file(s) changed)`);
