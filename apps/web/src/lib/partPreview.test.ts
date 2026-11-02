// Welcome v3 (docs/specs/WELCOME-V3-split.md): small, faithful previews of a lesson's parts, drawn from the stored specs.
// One preview per part kind (option 2, a wall of lesson previews, reuses them). The specs below are real stored parts of
// the published lessons, trimmed to the fields a preview reads; the diagram is the pinned water-cycle run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonPreviewParts, PREVIEW_ORDER } from './partPreview.ts';
import type { PartPreview, PreviewJob, PreviewPart } from './partPreview.ts';
import { WELCOME_FIXTURE_SPEC } from './partPreview.fixtures.ts';
import { quizCards } from './quiz.ts';
import type { LabelDiagramSpec, QuizCardsSpec } from '../../../../packages/contracts/kit.ts';

// ---- real stored parts (trimmed) ---------------------------------------------------------------------------------

// ftc-phishing-scams, job-20261031100603-3a2687b8
const SEQUENCE = {
  componentId: 'sequence-v1', title: 'Protecting accounts with layered security steps', cyclic: false, orderBasis: 'process', orderNote: '', seed: 2586385592,
  steps: [
    { id: 'secure-computer-software', label: 'Secure computer with updated software', sourceId: 'ftc-phishing-scams', quote: '1. Protect your computer by using security software.', orderHint: '' },
    { id: 'update-phone-automatically', label: 'Keep phone software automatically updated', sourceId: 'ftc-phishing-scams', quote: '2. Protect your cell phone by setting software to update automatically.', orderHint: '' },
    { id: 'enable-multi-factor-auth', label: 'Protect accounts with multi-factor authentication', sourceId: 'ftc-phishing-scams', quote: '3. Protect your accounts by using multi-factor authentication.', orderHint: '' },
    { id: 'back-up-data', label: 'Back up computer and phone data', sourceId: 'ftc-phishing-scams', quote: '4. Protect your data by backing it up.', orderHint: '' },
  ],
};

// nara-voting-rights-act, job-20261031094943-7234f176
const QUIZ = {
  componentId: 'quiz-cards-v1', title: 'Barriers to voting in the South', seed: 3648049905,
  cards: [
    { id: 'barriers-in-the-south', stem: 'Which group faced tremendous obstacles to voting?', options: ['African Americans in the South', 'European immigrants in the North', 'Northern factory workers'], sourceId: 'nara-voting-rights-act', quote: 'African Americans in the South faced tremendous obstacles to voting, including poll taxes, literacy tests, and other bureaucratic restrictions', hint: '' },
    { id: 'risks-when-registering', stem: 'What did citizens risk when trying to register or vote?', options: ['They also risked harassment', 'They gained immediate political power', 'They obtained new voting machines'], sourceId: 'nara-voting-rights-act', quote: 'They also risked harassment, intimidation, economic reprisals, and physical violence when they tried to register or vote.', hint: '' },
  ],
};

// usagov-branches-of-government, job-20261031110323-8979fdcd (one cell dropped to test a gap)
const COMPARE = {
  componentId: 'compare-table-v1', title: 'How the three branches are composed', seed: 1,
  entities: ['Legislative branch', 'Judicial branch', 'Executive branch'], attributes: ['Membership', 'Included institution'],
  cells: [
    { id: 'cell-0-0', entityIndex: 0, attributeIndex: 0, value: 'made up of Congress', sourceId: 'usagov-branches-of-government', quote: 'The legislative branch is made up of Congress:' },
    { id: 'cell-0-1', entityIndex: 0, attributeIndex: 1, value: 'Congress', sourceId: 'usagov-branches-of-government', quote: 'The legislative branch is made up of Congress:' },
    { id: 'cell-1-0', entityIndex: 1, attributeIndex: 0, value: 'includes the Supreme Court', sourceId: 'usagov-branches-of-government', quote: 'The judicial branch includes the Supreme Court and other federal courts.' },
    { id: 'cell-2-1', entityIndex: 2, attributeIndex: 1, value: "president's cabinet", sourceId: 'usagov-branches-of-government', quote: "The president, the vice president, and the president's cabinet are the members of the executive branch." },
  ],
};

// usgs-volcano-hazards, job-20261102050029-1ebd79c6 (first items of each group)
const SORT = {
  componentId: 'sort-groups-v1', title: 'Sort eruption materials into hazard groups', seed: 1547409533,
  groups: [{ id: 'volcanic-gases', label: 'Volcanic gases' }, { id: 'lava', label: 'Lava' }, { id: 'pyroclastic-flows', label: 'Pyroclastic flows' }],
  items: [
    { id: 'carbon-dioxide', label: 'Carbon dioxide', groupId: 'volcanic-gases', sourceId: 'usgs-volcano-hazards', quote: 'Other common volcanic gases are carbon dioxide, sulfur dioxide, hydrogen sulfide, hydrogen, and fluorine.' },
    { id: 'basalt-lava', label: 'Basalt lava', groupId: 'lava', sourceId: 'usgs-volcano-hazards', quote: 'low-silica basalt lava can form fast-moving (10 to 30 miles per hour) streams' },
    { id: 'sulfur-dioxide', label: 'Sulfur dioxide', groupId: 'volcanic-gases', sourceId: 'usgs-volcano-hazards', quote: 'Sulfur dioxide gas can react with water droplets in the atmosphere to create acid rain, which causes corrosion and harms vegetation.' },
    { id: 'fluorine', label: 'Fluorine', groupId: 'volcanic-gases', sourceId: 'usgs-volcano-hazards', quote: 'Fluorine, which in high concentrations is toxic, can be adsorbed onto volcanic ash particles that later fall to the ground.' },
    { id: 'hydrogen', label: 'Hydrogen', groupId: 'volcanic-gases', sourceId: 'usgs-volcano-hazards', quote: 'Other common volcanic gases are carbon dioxide, sulfur dioxide, hydrogen sulfide, hydrogen, and fluorine.' },
    { id: 'pyroclastic-surges', label: 'Pyroclastic surges', groupId: 'pyroclastic-flows', sourceId: 'usgs-volcano-hazards', quote: 'Lower-density pyroclastic flows, called pyroclastic surges' },
  ],
};

// nasa-grc-motion-of-free-falling-object, job-20261031103341-bac931f2
const FORMULA = {
  componentId: 'formula-explorer-v1', title: 'Velocity during free fall', seed: 1, formulaText: 'V = a * t', sourceId: 'nasa-grc-motion-of-free-falling-object', quote: 'V = a * t',
  expression: 'a * t', xVariable: 't',
  variables: [
    { name: 'a', pageSymbol: 'a', meaning: 'acceleration', meaningQuoted: false, quote: 'where a is the acceleration, V is the velocity, and X is the displacement from an initial location.', unit: 'm/s^2', min: 5, max: 15, default: 9.8 },
    { name: 't', pageSymbol: 't', meaning: 'time', meaningQuoted: false, quote: 'Here is a table of calculated acceleration (meters per second squared), velocity (meters per second), and displacement (meters) at 1 second intervals.', unit: 's', min: 0.5, max: 8, default: 1 },
  ],
  cases: [{ id: 'case-1', inputs: [{ name: 'a', value: 9.8 }, { name: 't', value: 2 }] }],
  sourceExample: { quote: '', resultNumber: 0, tolerance: 0 }, hasSourceExample: false,
};

// same lesson: the data table (two rows)
const DATA = {
  componentId: 'data-table-v1', title: 'Free fall motion in a vacuum over time', seed: 1, labelHeader: 'Time', chartColumnIndex: 1,
  columns: [
    { header: 'Accel – m/sec^2', unit: 'm/s²', numeric: true, sourceId: 'nasa', quote: '| Accel – m/sec^2 | 9.8 | 9.8 |' },
    { header: 'Velocity – m/sec', unit: 'm/s', numeric: true, sourceId: 'nasa', quote: '| Velocity – m/sec | 0.0 | 9.8 |' },
    { header: 'Distance – meters', unit: 'm', numeric: true, sourceId: 'nasa', quote: '| Distance – meters | 0.0 | 4.9 |' },
  ],
  rows: [
    { label: '0', sourceId: 'nasa', quote: '| Time/Sec | 0 | 1 |', values: [{ value: '9.8', sourceId: 'nasa', quote: 'a' }, { value: '0.0', sourceId: 'nasa', quote: 'b' }, { value: '0.0', sourceId: 'nasa', quote: 'c' }] },
    { label: '1', sourceId: 'nasa', quote: '| Time/Sec | 0 | 1 |', values: [{ value: '9.8', sourceId: 'nasa', quote: 'a' }, { value: '9.8', sourceId: 'nasa', quote: 'b' }, { value: '4.9', sourceId: 'nasa', quote: 'c' }] },
  ],
  questions: [], brackets: { enabled: false, rateColumnIndex: 0, overColumnIndex: 0, exampleIncome: 0 },
};

// nrc-backgrounder-radioactive-waste, job-20261031154139-c6facfdb (the lesson's simulation is the job's activity spec)
const HALF_LIFE = {
  title: 'Cesium-137 and Strontium-90 Decay',
  explanations: [
    { id: 'exp-half-life-30y', text: '', evidence: [{ sourceId: 'nrc', quote: 'Strontium-90 and cesium-137 have half-lives of about 30 years (half the radioactivity will decay in 30 years).' }] },
    { id: 'exp-long-lived', text: '', evidence: [{ sourceId: 'nrc', quote: 'Plutonium-239 has a half-life of 24,000 years.' }] },
  ],
  simulation: {
    engine: 'half-life-v1', equation: 'N=N0*(1/2)^(t/T)',
    initialAmount: { unit: '1', min: 10, max: 1000, default: 100 }, halfLife: { unit: 'time', min: 10, max: 60, default: 30 },
    elapsedTime: { unit: 'time', min: 0, max: 150, default: 30 },
    scenario: { objectLabel: 'Cesium-137 sample (grams)', settingLabel: 'Storage time in years (30-yr half-life)' },
  },
  predictions: [{ id: 'pred-opening', prompt: '', initialAmount: 100, halfLife: 30, elapsedTime: 30, expectedRemaining: 50, tolerance: 0.25 }],
};

// cfpb-saving-post-secondary-education, job-20261031152958-aa411e2f
const COMPOUND = {
  title: 'Saving for College with Compound Interest',
  explanations: [{ id: 'def', text: '', evidence: [{ sourceId: 'cfpb', quote: 'Compound interest is when you earn interest on both the money you save and the interest you earn.' }] }],
  simulation: {
    engine: 'compound-interest-v1', equation: 'A=P*(1+r/(100*n))^(n*t)',
    principalUSD: { unit: 'USD', min: 100, max: 10000, default: 1000 }, annualRatePercent: { unit: '%', min: 1, max: 12, default: 5 },
    compoundsPerYear: { unit: 'per year', min: 1, max: 365, default: 12 }, years: { unit: 'years', min: 1, max: 40, default: 2 },
    scenario: { objectLabel: 'College savings account', settingLabel: 'Interest compounded monthly for college' },
  },
  predictions: [{ id: 'opening', prompt: '', principalUSD: 1000, annualRatePercent: 5, compoundsPerYear: 12, years: 2, expectedAmountUSD: 1104.94, tolerance: 0.01 }],
};

// ---- helpers -------------------------------------------------------------------------------------------------------

type Entry = { componentId: string; spec?: unknown; status?: string };

function job(entries: Entry[], o: { status?: string; activity?: unknown } = {}): PreviewJob {
  const kitSpecs: Record<string, unknown> = {};
  const components = entries.map((e, i) => {
    const specId = `spec-${i}`;
    if (e.spec !== undefined) kitSpecs[specId] = e.spec;
    return { componentId: e.componentId, specId, status: e.status ?? 'passed' };
  });
  return {
    summary: { status: o.status ?? 'succeeded' },
    ...(o.activity === undefined ? {} : { spec: o.activity }),
    lessonData: { lesson: { components }, kitSpecs },
  } as unknown as PreviewJob;
}

const one = (parts: PreviewPart[], kind: PartPreview['kind']): PreviewPart => {
  const p = parts.find((x) => x.kind === kind);
  assert.ok(p !== undefined, `a ${kind} part`);
  return p;
};
const clone = (): LabelDiagramSpec => JSON.parse(JSON.stringify(WELCOME_FIXTURE_SPEC)) as LabelDiagramSpec;
const diagramOf = (spec: unknown) => one(lessonPreviewParts(job([{ componentId: 'label-diagram-v1', spec }])), 'label-diagram');

// ---- tests ---------------------------------------------------------------------------------------------------------

test('PREVIEW_ORDER: the figure first, then the curves and the formula, then tables, steps, sorting and quiz cards', () => {
  assert.deepEqual(PREVIEW_ORDER, ['label-diagram', 'half-life', 'compound-interest', 'formula-explorer', 'data-table', 'compare-table', 'sequence', 'sort-groups', 'quiz-cards']);
});

test('lessonPreviewParts: passed parts only, most visual first; unknown kinds, failed parts and unserved specs are skipped', () => {
  const parts = lessonPreviewParts(job([
    { componentId: 'quiz-cards-v1', spec: QUIZ },
    { componentId: 'concept-map-v1', spec: { componentId: 'concept-map-v1', nodes: [], links: [] } },
    { componentId: 'sequence-v1', spec: SEQUENCE },
    { componentId: 'compare-table-v1', spec: COMPARE, status: 'failed' },
    { componentId: 'sort-groups-v1' },
    { componentId: 'label-diagram-v1', spec: WELCOME_FIXTURE_SPEC },
  ]));
  assert.deepEqual(parts.map((p) => p.kind), ['label-diagram', 'sequence', 'quiz-cards']);
  assert.ok(parts.every((p) => p.options.length > 0));
});

test('lessonPreviewParts: nothing for a run that did not finish or is not a lesson', () => {
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'sequence-v1', spec: SEQUENCE }], { status: 'running' })), []);
  assert.deepEqual(lessonPreviewParts({ summary: { status: 'succeeded' } } as PreviewJob), []);
});

test('label diagram: the figure with the stored model boxes; one option per part in page order, the lit part in focus', () => {
  const d = diagramOf(WELCOME_FIXTURE_SPEC);
  assert.deepEqual(d.options.map((o) => o.quote.slice(0, 20)), [
    'Evaporation is the c', 'Transpiration is the', 'Condensation is the ', 'Precipitation can be', 'Runoff occurs when t',
  ]);
  const p = d.options[0]!.preview;
  assert.ok(p.kind === 'label-diagram');
  assert.equal(p.figureId, 'noaa-hydrologic-cycle-1');
  assert.equal(p.viewBox, '0 0 572 504');
  assert.equal(p.focus, 0);
  assert.equal(p.outlined, false, 'this fixture stores no outlines: the preview never claims SAM outlined it');
  assert.ok(p.parts.every((x) => x.glow !== null && x.outline === null));
  assert.equal(p.title, 'Label the water cycle processes');
  assert.equal(p.label, 'Label the diagram');
  const runoff = d.options[4]!.preview;
  assert.ok(runoff.kind === 'label-diagram' && runoff.focus === 4);
});

test('label diagram: parts SAM 3.1 outlined come first, and only stored outlines are drawn', () => {
  const s = clone();
  const precip = s.regions.find((r) => r.partId === 'precipitation')!;
  (precip as { outline?: string }).outline = 'M10 10L20 10L20 20Z';
  const d = diagramOf(s);
  const first = d.options[0]!.preview;
  assert.ok(first.kind === 'label-diagram');
  assert.equal(first.focus, 3, 'precipitation, the one part with an outline');
  assert.equal(first.outlined, true);
  assert.equal(first.parts[3]!.outline, 'M10 10L20 10L20 20Z');
  assert.equal(first.parts[0]!.outline, null);
  assert.match(d.options[0]!.quote, /^Precipitation/);
  assert.equal(d.options.length, 5);
});

test('label diagram: no preview without a figure size or any model box', () => {
  const bad = clone();
  bad.figure.width = 0;
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'label-diagram-v1', spec: bad }])), []);
  const none = clone();
  none.regions = [];
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'label-diagram-v1', spec: none }])), []);
});

test('sequence: the first three steps in the page’s order, the cited one in focus', () => {
  const s = one(lessonPreviewParts(job([{ componentId: 'sequence-v1', spec: SEQUENCE }])), 'sequence');
  assert.equal(s.options.length, 3);
  const p = s.options[1]!.preview;
  assert.ok(p.kind === 'sequence');
  assert.deepEqual(p.steps, ['Secure computer with updated software', 'Keep phone software automatically updated', 'Protect accounts with multi-factor authentication']);
  assert.equal(p.total, 4);
  assert.equal(p.focus, 1);
  assert.equal(s.options[1]!.quote, '2. Protect your cell phone by setting software to update automatically.');
});

test('quiz cards: the card as the lesson shows it (stored stem, options in display order, never the answer first)', () => {
  const q = one(lessonPreviewParts(job([{ componentId: 'quiz-cards-v1', spec: QUIZ }])), 'quiz-cards');
  const p = q.options[0]!.preview;
  assert.ok(p.kind === 'quiz-cards');
  assert.equal(p.stem, 'Which group faced tremendous obstacles to voting?');
  const shown = quizCards(QUIZ as unknown as QuizCardsSpec)[0]!.options.map((o) => o.text);
  assert.deepEqual(p.options, shown);
  assert.notEqual(p.options[0], 'African Americans in the South');
  assert.equal(q.options[1]!.quote, QUIZ.cards[1]!.quote);
});

test('compare table: a few cells (entity rows, attribute columns), a gap stays a dash, the cited cell in focus', () => {
  const c = one(lessonPreviewParts(job([{ componentId: 'compare-table-v1', spec: COMPARE }])), 'compare-table');
  const p = c.options[0]!.preview;
  assert.ok(p.kind === 'compare-table');
  assert.deepEqual(p.head, ['', 'Membership', 'Included institution']);
  assert.deepEqual(p.rows, [
    ['Legislative branch', 'Made up of Congress', 'Congress'],
    ['Judicial branch', 'Includes the Supreme Court', '—'],
    ['Executive branch', '—', "President's cabinet"],
  ]);
  assert.deepEqual(p.focus, { row: 0, col: 1 });
  const judicial = c.options.find((o) => o.quote.startsWith('The judicial'))!.preview;
  assert.ok(judicial.kind === 'compare-table');
  assert.deepEqual(judicial.focus, { row: 1, col: 1 });
});

test('data table: the label column and the first value columns of the first rows', () => {
  const d = one(lessonPreviewParts(job([{ componentId: 'data-table-v1', spec: DATA }])), 'data-table');
  const p = d.options[0]!.preview;
  assert.ok(p.kind === 'data-table');
  assert.deepEqual(p.head, ['Time', 'Accel – m/sec²', 'Velocity – m/sec']);
  assert.deepEqual(p.rows, [['0', '9.8', '0.0'], ['1', '9.8', '9.8']]);
});

test('sort groups: two groups of chips (at most three each), the cited chip in focus', () => {
  const s = one(lessonPreviewParts(job([{ componentId: 'sort-groups-v1', spec: SORT }])), 'sort-groups');
  const p = s.options[0]!.preview;
  assert.ok(p.kind === 'sort-groups');
  assert.deepEqual(p.groups, [
    { label: 'Volcanic gases', chips: ['Carbon dioxide', 'Sulfur dioxide', 'Fluorine'] },
    { label: 'Lava', chips: ['Basalt lava'] },
  ]);
  assert.deepEqual(p.focus, { group: 0, chip: 0 });
  const lava = s.options.find((o) => o.quote.startsWith('low-silica'))!.preview;
  assert.ok(lava.kind === 'sort-groups');
  assert.deepEqual(lava.focus, { group: 1, chip: 0 });
  assert.ok(!s.options.some((o) => o.quote.startsWith('Lower-density')), 'an item not in the two groups shown is not offered');
});

test('formula explorer: the formula and one slider for its x variable at the opening case', () => {
  const f = one(lessonPreviewParts(job([{ componentId: 'formula-explorer-v1', spec: FORMULA }])), 'formula-explorer');
  assert.equal(f.options[0]!.quote, 'V = a * t');
  const p = f.options[0]!.preview;
  assert.ok(p.kind === 'formula-explorer');
  assert.equal(p.formula, 'V = a · t');
  assert.ok(p.slider !== null);
  assert.equal(p.slider.symbol, 't');
  assert.equal(p.slider.meaning, 'Time');
  assert.equal(p.slider.unit, 's');
  assert.equal(p.slider.value, 2, 'the opening case, as the lesson opens');
  assert.ok(Math.abs(p.slider.at - (2 - 0.5) / 7.5) < 1e-9);
});

test('half-life: the engine’s curve over the slider’s time axis, with the half-life marks', () => {
  const h = one(lessonPreviewParts(job([{ componentId: 'half-life-v1' }], { activity: HALF_LIFE })), 'half-life');
  assert.deepEqual(h.options.map((o) => o.quote), [HALF_LIFE.explanations[0]!.evidence[0]!.quote, HALF_LIFE.explanations[1]!.evidence[0]!.quote]);
  const p = h.options[0]!.preview;
  assert.ok(p.kind === 'half-life');
  assert.deepEqual(p.points[0], { x: 0, y: 1 });
  assert.ok(p.points.every((pt, i) => i === 0 || pt.y < p.points[i - 1]!.y), 'always falling');
  assert.deepEqual(p.marks.map((m) => m.text), ['1/2', '1/4', '1/8', '1/16', '1/32']);
  assert.ok(Math.abs(p.marks[0]!.x - 30 / 150) < 1e-9 && Math.abs(p.marks[0]!.y - 0.5) < 1e-9);
  assert.equal(p.title, 'Cesium-137 and Strontium-90 Decay');
  assert.equal(p.yLabel, 'Cesium-137 sample (grams)');
});

test('compound interest: the engine’s growth curve over the slider’s years, start and end balances', () => {
  const c = one(lessonPreviewParts(job([{ componentId: 'compound-interest-v1' }], { activity: COMPOUND })), 'compound-interest');
  const p = c.options[0]!.preview;
  assert.ok(p.kind === 'compound-interest');
  assert.ok(p.points.every((pt, i) => i === 0 || pt.y > p.points[i - 1]!.y), 'always growing');
  assert.equal(p.points[p.points.length - 1]!.y, 1);
  assert.deepEqual(p.marks.map((m) => m.text), ['$1,000.00', '$7,358.42']);
});

test('an engine part without its activity spec (or another engine) gives no preview', () => {
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'half-life-v1' }])), []);
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'half-life-v1' }], { activity: COMPOUND })), []);
  assert.deepEqual(lessonPreviewParts(job([{ componentId: 'projectile-v1' }], { activity: { simulation: { engine: 'projectile-v1' } } })), []);
});
