/// <reference types="node" />
// Test / fake-API fixtures: recorded-SHAPED lesson job details (the frozen lesson-flow API contract) built from the
// hand-written Stage 6 goldens with the contracts' assemble helpers. This is fixture data, NOT model output.
// Used by the node tests and by the throwaway fake API that drives the browser check.

import { ACTIVITY_IDS } from '../../../../packages/contracts/index.ts';
import type { ActivityId, Provenance, SourceDocument, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import { assembleKitSpec, assembleOverviewSpec, checkIdsFor, kitSpecId } from '../../../../packages/contracts/kit.ts';
import type { KitGenComponentId, KitSpec, LessonComponentEntry, LessonSpec, OverviewSpec, SourceAnalysisV2 } from '../../../../packages/contracts/kit.ts';
import { loadDemoRaw } from './stage6-fixtures.ts';
import type { DemoRaw } from './demoLesson.ts';

export const FIXTURE_SOURCE_ID = 'nasa-grc-drag-equation';
export type WireObject = Record<string, unknown>;

export const LESSON_SCENARIOS = [
  'analysing', 'analysed', 'overview-ready', 'building', 'one-done', 'two-done',
  'complete', 'partial', 'repaired', 'system-fault', 'declined', 'failed',
] as const;
export type LessonScenario = typeof LESSON_SCENARIOS[number];

const PLAN: KitGenComponentId[] = ['formula-explorer-v1', 'quiz-cards-v1', 'concept-map-v1'];
const T0 = Date.parse('2026-10-29T10:00:00.000Z');

let rawCache: DemoRaw | null = null;
const raw = (): DemoRaw => (rawCache ??= loadDemoRaw());

function sourceDoc(): SourceDocument { return { ...raw().sources[FIXTURE_SOURCE_ID] as SourceDocument, text: '' }; }

/** The drag-page analysis with a three-component plan (formula explorer, quiz cards, concept map). */
export function fixtureAnalysis(): SourceAnalysisV2 {
  const a = structuredClone(raw().analysisUsable);
  const base = a.componentPlan[0];
  a.componentPlan = PLAN.map((componentId, i) => ({
    componentId, pedagogicalReason: a.componentPlan[i]?.pedagogicalReason ?? 'Shows how the factors on the page connect.',
    focusQuote: a.componentPlan[i]?.focusQuote ?? base?.focusQuote ?? '', focusSourceId: FIXTURE_SOURCE_ID,
  }));
  return a;
}

function kitSpec(jobId: string, id: KitGenComponentId, revision: number): KitSpec {
  const r = raw();
  const opts = { id: kitSpecId(jobId, id, revision), sources: [sourceDoc()], provenance: r.provenance as Provenance, seed: 7 };
  switch (id) {
    case 'formula-explorer-v1': return assembleKitSpec(r.formula, id, opts);
    case 'quiz-cards-v1': return assembleKitSpec(r.quiz, id, opts);
    case 'concept-map-v1': return assembleKitSpec(r.map, id, opts);
    case 'sequence-v1': return assembleKitSpec(r.sequence, id, opts);
    case 'sort-groups-v1': return assembleKitSpec(r.sort, id, opts);
    case 'compare-table-v1': return assembleKitSpec(r.compare, id, opts);
    case 'balance-equation-v1': return assembleKitSpec(r.balance, id, opts);
    default: throw new Error(`no fixture for ${id}`);
  }
}

function report(artifactId: string, revision: number, ids: readonly string[], failing: readonly string[] = []): ValidationReport {
  return {
    artifactId, revision, publishable: failing.length === 0,
    checks: ids.map((id) => ({
      id, kind: 'semantic', passed: !failing.includes(id),
      message: failing.includes(id) ? `Check ${id} failed (fixture).` : 'Passed.',
    })),
  };
}

function overviewOf(jobId: string, analysis: SourceAnalysisV2): OverviewSpec {
  return assembleOverviewSpec(analysis, { id: kitSpecId(jobId, 'overview-v1', 1), sources: [sourceDoc()], provenance: raw().provenance, seed: 1 });
}

// ---- events ------------------------------------------------------------------------------------------------------

type EventInput = Omit<Partial<StageEvent>, 'stage' | 'target'> & { stage: string; status: StageEvent['status']; componentId?: string; target?: string; offsetMs: number };

function eventList(jobId: string, inputs: readonly EventInput[]): WireObject[] {
  return inputs.map((e, i): WireObject => {
    const { offsetMs, ...rest } = e;
    return { jobId, seq: i + 1, at: new Date(T0 + offsetMs).toISOString(), model: 'muse-spark-1.3', ...rest };
  });
}
const usage = { promptTokens: 4200, completionTokens: 900, reasoningTokens: 600, cachedTokens: 0 };
const call = (cost: number): Partial<StageEvent> => ({ usage, latencyMs: 4000, estCostUSD: cost, responseId: `resp-${Math.round(cost * 1e5)}` });

function base(jobId: string, status: string): WireObject {
  return {
    jobId, sourceId: FIXTURE_SOURCE_ID, status, purpose: 'demo', createdAt: new Date(T0).toISOString(),
    totalCostUSD: 0, flow: 'lesson', model: 'muse-spark-1.3', provider: 'meta-api', providerModel: 'muse-spark-1.3',
    lesson: { overviewReady: false, componentsPlanned: 0, componentsPublished: 0, componentsFailed: 0, partialPublish: false },
  };
}

const analyseDone: EventInput[] = [
  { stage: 'ingest', status: 'started', offsetMs: 0 }, { stage: 'ingest', status: 'succeeded', offsetMs: 200 },
  { stage: 'analyze', status: 'started', offsetMs: 300 }, { stage: 'analyze', status: 'succeeded', offsetMs: 9300, ...call(0.0123) },
];
const overviewDone: EventInput[] = [{ stage: 'overview', status: 'succeeded', offsetMs: 9400 }];
const compEvents = (id: string, start: number, end: number, cost: number, status: StageEvent['status'] = 'succeeded', revision = 1): EventInput[] => [
  { stage: 'component', status: 'started', componentId: id, revision, offsetMs: start },
  { stage: 'component', status: status, componentId: id, revision, offsetMs: end, ...call(cost) },
];

/** Full or partial detail of one fixture lesson job. `scenario` picks the moment or outcome. */
export function lessonWire(scenario: LessonScenario): WireObject {
  const jobId = `job-lesson-${scenario}`;
  const analysis = fixtureAnalysis();
  const overview = overviewOf(jobId, analysis);
  const summary = base(jobId, 'running');
  const lessonCounts = (over: boolean, planned: number, published: number, failed: number): WireObject =>
    ({ overviewReady: over, componentsPlanned: planned, componentsPublished: published, componentsFailed: failed, partialPublish: failed > 0 && published > 0 });
  const detail = (extra: WireObject): WireObject => ({ summary, ...extra });
  const entry = (componentId: string, status: LessonComponentEntry['status'], revision = 1, reason = ''): LessonComponentEntry =>
    ({ componentId: componentId as LessonComponentEntry['componentId'], specId: kitSpecId(jobId, componentId as 'quiz-cards-v1', revision), status, reason, revision });
  const specsOf = (ids: readonly KitGenComponentId[], revision = 1): Record<string, KitSpec> =>
    Object.fromEntries(ids.map((id) => { const s = kitSpec(jobId, id, revision); return [s.id, s]; }));
  const reportsOf = (ids: readonly KitGenComponentId[], revision = 1): Record<string, ValidationReport> =>
    Object.fromEntries(ids.map((id) => [kitSpecId(jobId, id, revision), report(kitSpecId(jobId, id, revision), revision, checkIdsFor(id))]));
  const analysisReport = report(`${jobId}:analysis:r1`, 1, checkIdsFor('analysis'));
  const withAnalysis = { analysisV2: analysis, analysisV2Report: analysisReport, analysisV2Revisions: [{ revision: 1, analysis, report: analysisReport }] };
  const overviewReadyEvents = [...analyseDone, ...overviewDone];
  const lessonAt = (components: LessonComponentEntry[], over: OverviewSpec | null = overview): LessonSpec => ({ jobId, analysisRef: `${jobId}/analysis-v2.r1.json`, overview: over, components });
  const finish = (events: EventInput[], extra: WireObject, status: string, counts: WireObject, cost = 0.0612): WireObject => {
    Object.assign(summary, { status, finishedAt: new Date(T0 + 40000).toISOString(), totalCostUSD: cost, lesson: counts });
    return detail({ events: eventList(jobId, [...events, { stage: 'done', status: status === 'failed' ? 'failed' : 'succeeded', offsetMs: 40000 }]), ...extra });
  };

  switch (scenario) {
    case 'analysing':
      return detail({ events: eventList(jobId, [{ stage: 'ingest', status: 'started', offsetMs: 0 }, { stage: 'ingest', status: 'succeeded', offsetMs: 200 }, { stage: 'analyze', status: 'started', offsetMs: 300 }]), lesson: null, kitSpecs: {}, componentReports: {}, componentRepairs: [] });
    case 'analysed':
      return detail({ events: eventList(jobId, analyseDone), ...withAnalysis, lesson: null, kitSpecs: {}, componentReports: {}, componentRepairs: [] });
    case 'overview-ready':
      // The overview event has arrived but the lesson file has not been written yet: the overview comes from the analysis.
      Object.assign(summary, { lesson: lessonCounts(true, 3, 0, 0) });
      return detail({ events: eventList(jobId, overviewReadyEvents), ...withAnalysis, lesson: null, kitSpecs: {}, componentReports: {}, componentRepairs: [] });
    case 'building':
      Object.assign(summary, { lesson: lessonCounts(true, 3, 0, 0) });
      return detail({
        events: eventList(jobId, [...overviewReadyEvents, { stage: 'component', status: 'started', componentId: 'formula-explorer-v1', revision: 1, offsetMs: 9500 }, { stage: 'component', status: 'started', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 9500 }]),
        ...withAnalysis, lesson: lessonAt([]), kitSpecs: {}, componentReports: {}, componentRepairs: [],
      });
    case 'one-done':
      Object.assign(summary, { lesson: lessonCounts(true, 3, 1, 0) });
      return detail({
        events: eventList(jobId, [...overviewReadyEvents, ...compEvents('formula-explorer-v1', 9500, 18000, 0.0211), { stage: 'component', status: 'started', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 9500 }, { stage: 'component', status: 'started', componentId: 'concept-map-v1', revision: 1, offsetMs: 18100 }]),
        ...withAnalysis, lesson: lessonAt([entry('formula-explorer-v1', 'passed')]), kitSpecs: specsOf(['formula-explorer-v1']), componentReports: reportsOf(['formula-explorer-v1']), componentRepairs: [],
      });
    case 'two-done':
      Object.assign(summary, { lesson: lessonCounts(true, 3, 2, 0) });
      return detail({
        events: eventList(jobId, [...overviewReadyEvents, ...compEvents('formula-explorer-v1', 9500, 18000, 0.0211), ...compEvents('quiz-cards-v1', 9500, 21000, 0.0156), { stage: 'component', status: 'started', componentId: 'concept-map-v1', revision: 1, offsetMs: 18100 }]),
        ...withAnalysis, lesson: lessonAt([entry('formula-explorer-v1', 'passed'), entry('quiz-cards-v1', 'passed')]), kitSpecs: specsOf(['formula-explorer-v1', 'quiz-cards-v1']),
        componentReports: reportsOf(['formula-explorer-v1', 'quiz-cards-v1']), componentRepairs: [],
      });
    case 'complete':
      return finish([...overviewReadyEvents, ...compEvents('formula-explorer-v1', 9500, 18000, 0.0211), ...compEvents('quiz-cards-v1', 9500, 21000, 0.0156), ...compEvents('concept-map-v1', 18100, 27000, 0.0122)], {
        ...withAnalysis, lesson: lessonAt(PLAN.map((id) => entry(id, 'passed'))), kitSpecs: specsOf(PLAN), componentReports: reportsOf(PLAN), componentRepairs: [],
      }, 'succeeded', lessonCounts(true, 3, 3, 0), 0.0612);
    case 'partial': {
      const mapSpec = specsOf(['concept-map-v1']);
      const mapKey = kitSpecId(jobId, 'concept-map-v1', 1);
      const dropped = entry('concept-map-v1', 'passed', 1, '1 link was left out because its quote did not support the connection.');
      return finish([
        ...overviewReadyEvents,
        { stage: 'component', status: 'started', componentId: 'formula-explorer-v1', revision: 1, offsetMs: 9500 },
        { stage: 'component', status: 'failed', componentId: 'formula-explorer-v1', revision: 1, offsetMs: 15000, ...call(0.02) },
        { stage: 'repair', status: 'started', target: 'component', componentId: 'formula-explorer-v1', revision: 2, offsetMs: 15100 },
        { stage: 'repair', status: 'succeeded', target: 'component', componentId: 'formula-explorer-v1', revision: 2, offsetMs: 21000, ...call(0.0183) },
        { stage: 'component', status: 'failed', componentId: 'formula-explorer-v1', revision: 2, offsetMs: 21100 },
        ...compEvents('quiz-cards-v1', 9500, 21000, 0.0156), ...compEvents('concept-map-v1', 21200, 27000, 0.0122),
      ], {
        ...withAnalysis,
        lesson: lessonAt([entry('formula-explorer-v1', 'failed', 2, 'FE-08: the expression does not match the formula printed on the page.'), entry('quiz-cards-v1', 'passed'), dropped]),
        kitSpecs: { ...specsOf(['quiz-cards-v1']), ...mapSpec },
        componentReports: { ...reportsOf(['quiz-cards-v1']), [mapKey]: report(mapKey, 1, checkIdsFor('concept-map-v1')), [kitSpecId(jobId, 'formula-explorer-v1', 2)]: report(kitSpecId(jobId, 'formula-explorer-v1', 2), 2, checkIdsFor('formula-explorer-v1'), ['FE-08']) },
        componentRepairs: [{ componentId: 'formula-explorer-v1', attempt: 1, revision: 2, targeted: ['FE-08'], fixed: [], remaining: ['FE-08'], passed: false }],
      }, 'succeeded', lessonCounts(true, 3, 2, 1), 0.0834);
    }
    case 'repaired': {
      const a2 = structuredClone(analysis);
      const a1 = structuredClone(analysis);
      const p0 = a1.overview.keyPoints[0];
      if (p0 !== undefined) p0.quote = 'a quote that is not on the page';
      const r1 = report(`${jobId}:analysis:r1`, 1, checkIdsFor('analysis'), ['A-05']);
      const r2 = report(`${jobId}:analysis:r2`, 2, checkIdsFor('analysis'));
      const ov2 = overviewOf(jobId, a2);
      return finish([
        { stage: 'ingest', status: 'started', offsetMs: 0 }, { stage: 'ingest', status: 'succeeded', offsetMs: 200 },
        { stage: 'analyze', status: 'started', offsetMs: 300 }, { stage: 'analyze', status: 'succeeded', offsetMs: 9300, ...call(0.0123) },
        { stage: 'repair', status: 'started', target: 'analysis', revision: 2, offsetMs: 9400 }, { stage: 'repair', status: 'succeeded', target: 'analysis', revision: 2, offsetMs: 14000, ...call(0.0101) },
        { stage: 'overview', status: 'succeeded', offsetMs: 14100 },
        ...compEvents('formula-explorer-v1', 14200, 22000, 0.0211),
        { stage: 'component', status: 'started', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 14200 },
        { stage: 'component', status: 'failed', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 20000, ...call(0.0156) },
        { stage: 'repair', status: 'started', target: 'component', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 20100 },
        { stage: 'repair', status: 'succeeded', target: 'component', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 25000, ...call(0.0149) },
        { stage: 'component', status: 'succeeded', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 25100 },
        ...compEvents('concept-map-v1', 22100, 30000, 0.0122),
      ], {
        analysisV2: a2, analysisV2Report: r2, analysisV2Revisions: [{ revision: 1, analysis: a1, report: r1 }, { revision: 2, analysis: a2, report: r2 }],
        lesson: lessonAt([entry('formula-explorer-v1', 'passed'), entry('quiz-cards-v1', 'passed', 2), entry('concept-map-v1', 'passed')], ov2),
        kitSpecs: { ...specsOf(['formula-explorer-v1', 'concept-map-v1']), ...specsOf(['quiz-cards-v1'], 2) },
        componentReports: { ...reportsOf(['formula-explorer-v1', 'concept-map-v1']), ...reportsOf(['quiz-cards-v1'], 2) },
        componentRepairs: [{ componentId: 'quiz-cards-v1', attempt: 1, revision: 2, targeted: ['Q-02'], fixed: ['Q-02'], remaining: [], passed: true }],
      }, 'succeeded', lessonCounts(true, 3, 3, 0), 0.0891);
    }
    case 'system-fault':
      Object.assign(summary, { demoFault: { kind: 'fabricated-quote', path: '/cards/0/quote', original: 'Drag depends on the density of the air', injected: 'Drag always doubles every second.', revision: 1, effective: true } });
      return finish([
        ...overviewReadyEvents,
        ...compEvents('formula-explorer-v1', 9500, 18000, 0.0211),
        { stage: 'inject', status: 'succeeded', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 12000 },
        { stage: 'component', status: 'started', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 9500 },
        { stage: 'component', status: 'failed', componentId: 'quiz-cards-v1', revision: 1, offsetMs: 12100, ...call(0.0156) },
        { stage: 'repair', status: 'started', target: 'component', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 12200 },
        { stage: 'repair', status: 'succeeded', target: 'component', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 17000, ...call(0.0149) },
        { stage: 'component', status: 'succeeded', componentId: 'quiz-cards-v1', revision: 2, offsetMs: 17100 },
        ...compEvents('concept-map-v1', 18100, 27000, 0.0122),
      ], {
        ...withAnalysis, lesson: lessonAt([entry('formula-explorer-v1', 'passed'), entry('quiz-cards-v1', 'passed', 2), entry('concept-map-v1', 'passed')]),
        kitSpecs: { ...specsOf(['formula-explorer-v1', 'concept-map-v1']), ...specsOf(['quiz-cards-v1'], 2) },
        componentReports: { ...reportsOf(['formula-explorer-v1', 'concept-map-v1']), ...reportsOf(['quiz-cards-v1'], 2) },
        componentRepairs: [{ componentId: 'quiz-cards-v1', attempt: 1, revision: 2, targeted: ['Q-01'], fixed: ['Q-01'], remaining: [], passed: true }],
      }, 'succeeded', lessonCounts(true, 3, 3, 0), 0.0791);
    case 'declined': {
      const declined = structuredClone(raw().analysisDeclined);
      const rep = report(`${jobId}:analysis:r1`, 1, checkIdsFor('analysis'));
      Object.assign(summary, { sourceId: FIXTURE_SOURCE_ID });
      return finish([...analyseDone.slice(0, 3), { stage: 'analyze', status: 'succeeded', offsetMs: 6000, ...call(0.0091) }],
        { analysisV2: declined, analysisV2Report: rep, analysisV2Revisions: [{ revision: 1, analysis: declined, report: rep }], lesson: { jobId, analysisRef: `${jobId}/analysis-v2.r1.json`, overview: null, components: [] }, kitSpecs: {}, componentReports: {}, componentRepairs: [] },
        'unsupported', lessonCounts(false, 0, 0, 0), 0.0091);
    }
    case 'failed': {
      const bad = report(`${jobId}:analysis:r1`, 1, checkIdsFor('analysis'), ['A-05', 'A-06']);
      Object.assign(summary, { error: { code: 'ANALYSIS_FAILED', message: 'The page analysis did not pass its checks.' } });
      return finish([
        ...analyseDone.slice(0, 3), { stage: 'analyze', status: 'failed', offsetMs: 9300, ...call(0.0123) },
      ], { analysisV2: null, analysisV2Report: bad, analysisV2Revisions: [{ revision: 1, analysis: analysis, report: bad }], lesson: null, kitSpecs: {}, componentReports: {}, componentRepairs: [] },
      'failed', lessonCounts(false, 0, 0, 0), 0.0123);
    }
  }
}

/** The premium-engine lesson is separate because its premium spec comes from the demo lesson builder. */
export async function premiumWire(): Promise<WireObject> {
  const { buildDemoLessons } = await import('./demoLesson.ts');
  const lessons = buildDemoLessons(raw());
  const l = lessons.find((x) => x.id === 'premium');
  if (l === undefined || l.premium === null) throw new Error('no premium demo lesson');
  const jobId = l.lesson.jobId;
  const summary: WireObject = { ...base(jobId, 'succeeded'), sourceId: 'nara-declaration-of-independence', finishedAt: new Date(T0 + 30000).toISOString(), totalCostUSD: 0.07, engine: 'timeline-v1', lesson: { overviewReady: true, componentsPlanned: 1, componentsPublished: 1, componentsFailed: 0, partialPublish: false } };
  return {
    summary, events: eventList(jobId, [{ stage: 'ingest', status: 'started', offsetMs: 0 }, { stage: 'analyze', status: 'started', offsetMs: 300 }, { stage: 'analyze', status: 'succeeded', offsetMs: 9300, ...call(0.0123) }, { stage: 'overview', status: 'succeeded', offsetMs: 9400 }, ...compEvents('timeline-v1', 9500, 20000, 0.03), { stage: 'done', status: 'succeeded', offsetMs: 20100 }]),
    analysisV2: l.analysis, analysisV2Revisions: [], lesson: l.lesson, kitSpecs: {}, componentReports: {}, componentRepairs: [],
    spec: l.premium, report: report(l.premium.id, 1, ['timeline.date-grounded']), revisions: [{ revision: 1, spec: l.premium, report: report(l.premium.id, 1, ['timeline.date-grounded']) }],
  };
}

/** A recorded pre-Stage-6 job detail (no lesson fields at all). */
export function legacyWire(): WireObject {
  return {
    summary: { jobId: 'job-legacy', sourceId: FIXTURE_SOURCE_ID, status: 'unsupported', purpose: 'demo', createdAt: new Date(T0).toISOString(), totalCostUSD: 0.01 },
    events: eventList('job-legacy', [{ stage: 'ingest', status: 'started', offsetMs: 0 }]),
  };
}

export const FIXTURE_ACTIVITY_IDS: readonly ActivityId[] = ACTIVITY_IDS;
