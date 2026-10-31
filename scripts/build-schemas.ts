// Generates the per-engine JSON schemas from packages/contracts/engines.ts (lead-owned).
// forces-1d-v1 keeps its original files (activity-spec.gen.json / activity-spec.full.json) so recorded Stage 2
// evidence keeps validating; only its full schemaVersion widens to the accepted list.
// Usage: node scripts/build-schemas.ts [--check]   (--check exits 1 if any file would change)
// Also generates the Stage 6 v2-analysis and kit gen schemas from packages/contracts/kit.ts.
import { readFileSync, writeFileSync } from 'node:fs';
import { ACCEPTED_SCHEMA_VERSIONS, ACTIVITY_IDS, ENGINES, ENGINE_IDS, SCHEMA_VERSION, SEQUENCE_ENGINES } from '../packages/contracts/index.ts';
import type { EngineDescriptor, EngineId, SequenceDescriptor } from '../packages/contracts/index.ts';
import {
  ALGORITHM_CLAIM_KINDS,
  ALGORITHM_IDS,
  BALANCE_SIDES,
  CONCEPT_MAP_RELATIONS,
  DATA_TABLE_QUESTION_KINDS,
  DECLINE_CODES,
  KIT_GEN_SCHEMA_FILES,
  KIT_LIMITS,
  PLAN_COMPONENT_IDS,
  SEQUENCE_ORDER_BASES,
  SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE,
  SUBJECTS,
  THRESHOLD_RULES
} from '../packages/contracts/kit.ts';
import type { KitGenComponentId } from '../packages/contracts/kit.ts';

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
    if: { properties: { day: { type: 'integer', minimum: 1 } } },
    then: { properties: { month: { type: 'integer', minimum: 1 } } },
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
analysis.properties.activity = { type: 'string', enum: [...ACTIVITY_IDS, 'none'], description: "The single best-fitting engine id, or 'none' when unsupported." };
emit('source-analysis.gen.json', analysis);

// Stage 6 v2-analysis and kit gen schemas from packages/contracts/kit.ts.
function str(desc: string): Record<string, unknown> {
  return { type: 'string', description: desc };
}
function num(desc: string): Record<string, unknown> {
  return { type: 'number', description: desc };
}
function int(desc: string): Record<string, unknown> {
  return { type: 'integer', description: desc };
}
function bool(desc: string): Record<string, unknown> {
  return { type: 'boolean', description: desc };
}
function obj(props: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, required: Object.keys(props), properties: props };
}
function arr(items: unknown, minItems: number | undefined, maxItems: number | undefined, desc: string): Record<string, unknown> {
  const o: Record<string, unknown> = { type: 'array', items };
  if (minItems !== undefined) o['minItems'] = minItems;
  if (maxItems !== undefined) o['maxItems'] = maxItems;
  o['description'] = desc;
  return o;
}
function enumStr(values: readonly string[], desc: string): Record<string, unknown> {
  return { type: 'string', enum: [...values], description: desc };
}

const QUOTE_DESC = 'Exact characters copied from the source, no ellipsis, 150 characters or fewer.';

function keyPointSchema(): Record<string, unknown> {
  return obj({
    id: str('Lowercase kebab id for this key point, 40 characters or fewer.'),
    point: str('AI-written point in plain text, 10 to 200 characters.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
}
function keyTermSchema(): Record<string, unknown> {
  return obj({
    id: str('Lowercase kebab id for this key term, 40 characters or fewer.'),
    term: str('Term as named on the page, 1 to 40 characters.'),
    gloss: str('AI-written gloss in plain text, 5 to 120 characters.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
}
function planEntrySchema(): Record<string, unknown> {
  return obj({
    componentId: enumStr(PLAN_COMPONENT_IDS, 'Planned component or activity id in teaching order.'),
    pedagogicalReason: str('Why this component fits now, 10 to 160 characters of plain text.'),
    focusQuote: str('Verbatim focus passage from the source, 1 to 150 characters. ' + 'Exact characters copied from the source, no ellipsis.'),
    focusSourceId: str('Id of the source the focus quote was copied from.')
  });
}

function analysisV2Schema(): Record<string, unknown> {
  const overview = obj({
    headline: str('AI-written headline in plain text, 10 to 120 characters. Empty string only when the analysis declined.'),
    keyPoints: arr(keyPointSchema(), undefined, KIT_LIMITS.analysis.keyPoints.max, 'Key points, empty only when declined.'),
    keyTerms: arr(keyTermSchema(), undefined, KIT_LIMITS.analysis.keyTerms.max, 'Key terms, empty only when declined.')
  });
  return obj({
    analysisVersion: { type: 'integer', enum: [2], description: 'Analysis schema version, always 2.' },
    subject: enumStr(SUBJECTS, 'Primary teaching subject of the page.'),
    usable: bool('True when the page can produce a lesson, false when declined.'),
    declineCode: enumStr(['', ...DECLINE_CODES], 'Empty string when usable, otherwise the decline reason code.'),
    declineSummary: str('Empty string when usable, otherwise 10 to 280 characters of plain text saying why the page cannot be used.'),
    pageCoverage: str('What the page covers, 10 to 300 characters of plain text, always present.'),
    overview,
    componentPlan: arr(planEntrySchema(), undefined, KIT_LIMITS.analysis.componentPlan.max, 'Teaching plan in order, empty only when declined.')
  });
}

function quizSchema(cid: KitGenComponentId): Record<string, unknown> {
  const card = obj({
    id: str('Lowercase kebab card id, 40 characters or fewer.'),
    stem: str('Question stem in plain text, 10 to 160 characters. Must not reveal the answer.'),
    options: arr(str('One answer option in plain text, 1 to 80 characters. The first option is the correct answer.'), KIT_LIMITS.quiz.options.min, KIT_LIMITS.quiz.options.max, 'Answer options, first is correct.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' The first option occurs in this quote.'),
    hint: str('Hint in plain text, empty string or 5 to 120 characters.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    cards: arr(card, KIT_LIMITS.quiz.cards.min, KIT_LIMITS.quiz.cards.max, 'Quiz cards.')
  });
}

function sequenceSchema(cid: KitGenComponentId): Record<string, unknown> {
  const step = obj({
    id: str('Lowercase kebab step id, 40 characters or fewer.'),
    label: str('Short event name for the step in plain text, 1 to 80 characters (about 8 words); the quote is the verbatim evidence for it.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC),
    orderHint: str('Short ordering hint in plain text.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    orderBasis: enumStr(SEQUENCE_ORDER_BASES, 'How the order was determined on the page.'),
    cyclic: bool('True only when the page states a cycle.'),
    orderNote: str('Note about the order in plain text, empty string or 5 to 120 characters.'),
    steps: arr(step, KIT_LIMITS.sequence.steps.min, KIT_LIMITS.sequence.steps.max, 'Steps in taught order.')
  });
}

function sortSchema(cid: KitGenComponentId): Record<string, unknown> {
  const group = obj({
    id: str('Lowercase kebab group id, 40 characters or fewer.'),
    label: str('Group label in plain text, 1 to 40 characters.')
  });
  const item = obj({
    id: str('Lowercase kebab item id, 40 characters or fewer.'),
    label: str('Item label in plain text, 1 to 60 characters. It occurs in the quote.'),
    groupId: str('Id of the group this item belongs to.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    groups: arr(group, KIT_LIMITS.sort.groups.min, KIT_LIMITS.sort.groups.max, 'Sort groups.'),
    items: arr(item, KIT_LIMITS.sort.items.min, KIT_LIMITS.sort.items.max, 'Sortable items.')
  });
}

function conceptMapSchema(cid: KitGenComponentId): Record<string, unknown> {
  const node = obj({
    id: str('Lowercase kebab node id, 40 characters or fewer.'),
    label: str('Node label in plain text. It occurs in a link quote.')
  });
  const link = obj({
    id: str('Lowercase kebab link id, 40 characters or fewer.'),
    fromId: str('Id of the source node.'),
    toId: str('Id of the target node.'),
    relation: enumStr(CONCEPT_MAP_RELATIONS, 'Relationship stated on the page.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    nodes: arr(node, KIT_LIMITS.conceptMap.nodes.min, KIT_LIMITS.conceptMap.nodes.max, 'Concept nodes.'),
    links: arr(link, KIT_LIMITS.conceptMap.links.min, KIT_LIMITS.conceptMap.links.max, 'Concept links.')
  });
}

function compareSchema(cid: KitGenComponentId): Record<string, unknown> {
  const value = obj({
    value: str('Cell value in plain text, 1 to 80 characters. It occurs in the quote.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
  const row = obj({
    entity: str('Row name written with the words the page uses, never an id.'),
    values: arr(value, KIT_LIMITS.compare.attributes.min, KIT_LIMITS.compare.attributes.max, 'One value per column, in the same order as attributes.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    attributes: arr(str('Attribute name in plain text.'), KIT_LIMITS.compare.attributes.min, KIT_LIMITS.compare.attributes.max, 'Shared attributes.'),
    rows: arr(row, KIT_LIMITS.compare.entities.min, KIT_LIMITS.compare.entities.max, 'Compared rows.')
  });
}

function formulaExplorerSchema(cid: KitGenComponentId): Record<string, unknown> {
  const variable = obj({
    name: str('Variable name in code form, starts with a lowercase letter, letters digits underscore, up to 12 characters. Must not be a reserved function or constant name.'),
    pageSymbol: str('Exact page token for this variable, for example Cd or rho.'),
    meaning: str('What the variable means in plain text.'),
    meaningQuoted: bool('True when the meaning is quoted from the page.'),
    quote: str(QUOTE_DESC + ' Copied from the same source as the formula quote (the explorer sourceId source).'),
    unit: str('Unit label in plain text.'),
    min: num('Slider minimum, finite number.'),
    max: num('Slider maximum, finite number.'),
    default: num('Slider default, finite number between min and max.')
  });
  const input = obj({
    name: str('Variable name, must equal one declared variable name.'),
    value: num('Input value, finite number within the variable range.')
  });
  const kase = obj({
    id: str('Lowercase kebab case id, 40 characters or fewer.'),
    inputs: arr(input, KIT_LIMITS.formulaExplorer.variables.min, KIT_LIMITS.formulaExplorer.variables.max, 'One entry per variable.')
  });
  const example = obj({
    quote: str('Quoted passage stating inputs and result, or empty string when there is no source example. Copied from the same source as the formula quote (the explorer sourceId source). Exact characters copied from the source, no ellipsis, 150 characters or fewer.'),
    resultNumber: num('Result stated in the quote, or 0 when there is no source example.'),
    tolerance: num('Allowed difference, between 1e-9 and 0.25. Use 0 when there is no source example.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    formulaText: str('Formula as printed on the page, 120 characters or fewer.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC),
    expression: str('Expression in the calculator grammar using variable names, 120 characters or fewer.'),
    variables: arr(variable, KIT_LIMITS.formulaExplorer.variables.min, KIT_LIMITS.formulaExplorer.variables.max, 'Declared variables.'),
    xVariable: str('Name of the variable used for the graph axis.'),
    cases: arr(kase, KIT_LIMITS.formulaExplorer.cases.min, KIT_LIMITS.formulaExplorer.cases.max, 'Input cases.'),
    sourceExample: example,
    hasSourceExample: bool('True when sourceExample states a quotable worked result.')
  });
}

function balanceSchema(cid: KitGenComponentId): Record<string, unknown> {
  const species = obj({
    id: str('Lowercase kebab species id, 40 characters or fewer.'),
    formula: str('Chemical formula in plain text.'),
    side: enumStr(BALANCE_SIDES, 'Side of the equation.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC)
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    equationText: str('Equation as printed on the page in plain text.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC),
    species: arr(species, KIT_LIMITS.balance.species.min, KIT_LIMITS.balance.species.max, 'Reaction species.'),
    hint: str('Hint in plain text.')
  });
}

function algorithmTraceSchema(cid: KitGenComponentId): Record<string, unknown> {
  const claim = obj({
    id: str('Lowercase kebab claim id, 40 characters or fewer.'),
    kind: enumStr(ALGORITHM_CLAIM_KINDS, 'Kind of page-stated fact.'),
    text: str('Page-stated fact in plain text, 1 to 80 characters. It occurs in the claim quote after whitespace normalisation.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains the claim text.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    algorithm: enumStr(ALGORITHM_IDS, 'Algorithm id to trace.'),
    algorithmName: str('The page own name for the algorithm, 1 to 60 characters, a whole phrase in the quote, for example binary search.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It names and/or describes the algorithm; it contains algorithmName.'),
    input: arr(int('One input integer 0 to 99.'), KIT_LIMITS.algorithm.input.min, KIT_LIMITS.algorithm.input.max, 'Input array of 4 to 10 integers 0 to 99; a search needs ascending distinct values.'),
    hasTarget: bool('True exactly for search algorithms.'),
    target: int('Search target 0 to 99; 0 is the absent sentinel when hasTarget is false.'),
    claims: arr(claim, KIT_LIMITS.algorithm.claims.min, KIT_LIMITS.algorithm.claims.max, 'Page-stated facts, 0 to 3.')
  });
}

function logLadderSchema(cid: KitGenComponentId): Record<string, unknown> {
  const rung = obj({
    id: str('Lowercase kebab rung id, 40 characters or fewer.'),
    label: str('Rung label in plain text, 1 to 60 characters.'),
    value: num('Scale value stated on the page; it is a whole numeric token in the quote.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains the rung value as a whole numeric token.')
  });
  const kase = obj({
    id: str('Lowercase kebab case id, 40 characters or fewer.'),
    fromValue: num('Starting scale value.'),
    toValue: num('Ending scale value; must differ from fromValue.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    quantity: str('The scale name as the page writes it, for example pH or magnitude. It occurs in the quote.'),
    factor: num('Per whole step, more than 1 and at most 1000, for example 10 or 32.'),
    factorText: str('The page words for the factor, for example ten times or tenfold. It occurs in the quote and states factor.'),
    effectPhrase: str('What multiplies, in the page words, for example more acidic.'),
    increasing: bool('True when a higher scale value means more of the effect; false for pH.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains factorText and quantity.'),
    rungs: arr(rung, KIT_LIMITS.logLadder.rungs.min, KIT_LIMITS.logLadder.rungs.max, 'Page-stated points on the scale, 2 to 8.'),
    cases: arr(kase, KIT_LIMITS.logLadder.cases.min, KIT_LIMITS.logLadder.cases.max, 'Predict-the-ratio cases, 1 to 3.')
  });
}

function thresholdSchema(cid: KitGenComponentId): Record<string, unknown> {
  const stage = obj({
    id: str('Lowercase kebab stage id, 40 characters or fewer.'),
    body: str('Who votes, in the page words, 1 to 60 characters, for example States.'),
    total: int('Page-stated total voters, integer 1 to 100000. It occurs in totalQuote.'),
    rule: enumStr(THRESHOLD_RULES, 'Passing rule.'),
    numerator: int('Fraction numerator; 0 is the absent sentinel when the rule is not fraction.'),
    denominator: int('Fraction denominator; 0 is the absent sentinel when the rule is not fraction.'),
    statedCount: int('Page-stated required count, or 0 when the page states none; required for rule count.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It states the rule words and/or statedCount.'),
    totalQuote: str(QUOTE_DESC + ' It contains total; it may equal quote.')
  });
  const scenario = obj({
    id: str('Lowercase kebab scenario id, 40 characters or fewer.'),
    label: str('Scenario label in plain text, 1 to 80 characters.'),
    yes: arr(int('Yes votes for one stage, integer within that stage total.'), KIT_LIMITS.threshold.stages.min, KIT_LIMITS.threshold.stages.max, 'One yes count per stage, in stage order.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    stages: arr(stage, KIT_LIMITS.threshold.stages.min, KIT_LIMITS.threshold.stages.max, 'Stages that must all pass, 1 to 3.'),
    scenarios: arr(scenario, KIT_LIMITS.threshold.scenarios.min, KIT_LIMITS.threshold.scenarios.max, 'Try-it vote counts, 1 to 3; engine inputs, not page claims.')
  });
}

function dataTableSchema(cid: KitGenComponentId): Record<string, unknown> {
  const column = obj({
    header: str('Value-column header as printed, 1 to 40 characters. It occurs in the quote.'),
    unit: str('Unit label, 0 to 20 characters; empty string means no unit.'),
    numeric: bool('True when the column holds numbers parsed by parseTableNumber.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains the header.')
  });
  const cell = obj({
    value: str('Cell value as printed, 1 to 40 characters. It is a whole token in the quote.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains the value as a whole token.')
  });
  const row = obj({
    label: str('Row label as printed, 1 to 60 characters. It occurs in the quote.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC + ' It contains the row label.'),
    values: arr(cell, KIT_LIMITS.dataTable.columns.min, KIT_LIMITS.dataTable.columns.max, 'One value per column, in column order.')
  });
  const question = obj({
    id: str('Lowercase kebab question id, 40 characters or fewer.'),
    kind: enumStr(DATA_TABLE_QUESTION_KINDS, 'Question kind.'),
    rowIndex: int('Row index for lookup, otherwise the -1 absent sentinel.'),
    columnIndex: int('Column index the question asks about.')
  });
  const brackets = obj({
    enabled: bool('True for the progressive-rate calculator, false otherwise.'),
    rateColumnIndex: int('Rate column index, or the -1 absent sentinel when disabled.'),
    overColumnIndex: int('Threshold column index, or the -1 absent sentinel when disabled.'),
    exampleIncome: num('Example income greater than 0 when enabled, else the 0 absent sentinel.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    labelHeader: str('Header for the row-label column, 1 to 40 characters, for example Planet.'),
    columns: arr(column, KIT_LIMITS.dataTable.columns.min, KIT_LIMITS.dataTable.columns.max, 'Value columns, 2 to 6.'),
    rows: arr(row, KIT_LIMITS.dataTable.rows.min, KIT_LIMITS.dataTable.rows.max, 'Data rows, 3 to 12.'),
    questions: arr(question, KIT_LIMITS.dataTable.questions.min, KIT_LIMITS.dataTable.questions.max, 'Questions answered by our code, 1 to 4.'),
    chartColumnIndex: int('Numeric column to chart, or the -1 absent sentinel for no chart.'),
    brackets
  });
}

function labelDiagramSchema(cid: KitGenComponentId): Record<string, unknown> {
  const coord = (desc: string): Record<string, unknown> => ({ type: 'integer', description: desc });
  const part = obj({
    id: str('Lowercase kebab part id, 40 characters or fewer.'),
    name: str('Part name with the words the page uses, 1 to 40 characters. It occurs in the quote.'),
    sourceId: str('Id of the source the quote was copied from.'),
    quote: str(QUOTE_DESC),
    x: coord('Horizontal point on the part itself, never on its printed label, normalised 0 to 1000.'),
    y: coord('Vertical point on the part itself, never on its printed label, normalised 0 to 1000.'),
    labelX1: coord('Left edge of the box around the printed part label, normalised 0 to 1000; all four label edges are 0 when there is no printed label.'),
    labelY1: coord('Top edge of the box around the printed part label, normalised 0 to 1000; all four label edges are 0 when there is no printed label.'),
    labelX2: coord('Right edge of the box around the printed part label, normalised 0 to 1000; all four label edges are 0 when there is no printed label.'),
    labelY2: coord('Bottom edge of the box around the printed part label, normalised 0 to 1000; all four label edges are 0 when there is no printed label.')
  });
  return obj({
    schemaVersion: { type: 'string', enum: [cid], description: 'Generator schema version, always the component id.' },
    title: str('Short title for students in plain text.'),
    figureId: str('Id of the library figure this lesson labels.'),
    parts: arr(part, KIT_LIMITS.labelDiagram.parts.min, KIT_LIMITS.labelDiagram.parts.max, 'Diagram parts, 3 to 8.'),
    hint: str('Hint in plain text.')
  });
}

emit(SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE, analysisV2Schema());
emit(KIT_GEN_SCHEMA_FILES['quiz-cards-v1'] as string, quizSchema('quiz-cards-v1'));
emit(KIT_GEN_SCHEMA_FILES['sequence-v1'] as string, sequenceSchema('sequence-v1'));
emit(KIT_GEN_SCHEMA_FILES['sort-groups-v1'] as string, sortSchema('sort-groups-v1'));
emit(KIT_GEN_SCHEMA_FILES['concept-map-v1'] as string, conceptMapSchema('concept-map-v1'));
emit(KIT_GEN_SCHEMA_FILES['compare-table-v1'] as string, compareSchema('compare-table-v1'));
emit(KIT_GEN_SCHEMA_FILES['formula-explorer-v1'] as string, formulaExplorerSchema('formula-explorer-v1'));
emit(KIT_GEN_SCHEMA_FILES['balance-equation-v1'] as string, balanceSchema('balance-equation-v1'));
emit(KIT_GEN_SCHEMA_FILES['algorithm-trace-v1'] as string, algorithmTraceSchema('algorithm-trace-v1'));
emit(KIT_GEN_SCHEMA_FILES['log-ladder-v1'] as string, logLadderSchema('log-ladder-v1'));
emit(KIT_GEN_SCHEMA_FILES['threshold-v1'] as string, thresholdSchema('threshold-v1'));
emit(KIT_GEN_SCHEMA_FILES['data-table-v1'] as string, dataTableSchema('data-table-v1'));
emit(KIT_GEN_SCHEMA_FILES['label-diagram-v1'] as string, labelDiagramSchema('label-diagram-v1'));

if (check && changed > 0) process.exit(1);
console.log(check ? 'schemas up to date' : `done (${changed} file(s) changed)`);
