// The lesson flow as the web app sees it (frozen lesson-flow API contract, docs/specs/STAGE-6-design.md): defensive parsing of
// the lesson fields of a job, the streaming state (overview first, then components as they pass), the step list, repair
// cards, run-list tags and the plain-words names of the Stage 6 checks. Pure: no React, no DOM, no network.
// Every field is optional on the wire; anything missing or malformed becomes a safe default and a job without lesson
// fields (recorded before Stage 6, or flow 'activity') is left exactly as it was.

import type { DemoFault, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import { KIT_DEFAULT_EXECUTION, KIT_SCHEMA_VERSION, LESSON_COMPONENT_STATUSES, STAGE6_CHECKS, isKitGenComponentId, isPlanComponentId, isSubject } from '../../../../packages/contracts/kit.ts';
import type {
  ComponentPlanEntry, KitSpec, LessonComponentEntry, LessonComponentStatus, LessonSpec, OverviewSpec, PlanComponentId, SourceAnalysisV2,
} from '../../../../packages/contracts/kit.ts';
import type { JobDetail, JobSummary } from '../api.ts';
import { checkName } from './checks.ts';
import { ANALYSIS_REPAIR_LABEL, analysisCheckName, buildAnalysisRepairSteps } from './analysisRepairs.ts';
import type { AnalysisChange, AnalysisRepairOverall, AnalysisRepairStep, CheckRef } from './analysisRepairs.ts';
import { FAILURE_MESSAGES, PREMIUM_FAILURE_MESSAGE, SKIPPED_MESSAGE, componentLabel, declineText } from './lesson.ts';
import type { PendingSlot } from './lesson.ts';
import { previewQuote } from './evidence.ts';
import { cleanModelStrings } from './displayText.ts';
import type { ModelId } from './models.ts';

// ---- types ------------------------------------------------------------------------------------------------------

export type FlowId = 'lesson' | 'activity';

export interface LessonProgress {
  overviewReady: boolean; componentsPlanned: number; componentsPublished: number; componentsFailed: number; partialPublish: boolean;
}

export interface ComponentRepairRecord {
  componentId: string; attempt: number; revision: number; targeted: string[]; fixed: string[]; remaining: string[]; passed: boolean;
  /** S6R-11: the worker's record that this component's baseline carried an injected demo fault. Absent on older jobs. */
  afterInjectedFault?: boolean;
}

export interface LessonAnalysisRevision { revision: number; analysis?: SourceAnalysisV2; report?: ValidationReport }

/** The lesson fields of one job detail, parsed. */
export interface LessonData {
  analysis: SourceAnalysisV2 | null;
  analysisReport: ValidationReport | null;
  analysisRevisions: LessonAnalysisRevision[];
  lesson: LessonSpec | null;
  /** Passed kit specs only, by spec id. */
  kitSpecs: Record<string, KitSpec>;
  /** Latest validation report per component, by spec id. */
  componentReports: Record<string, ValidationReport>;
  componentRepairs: ComponentRepairRecord[];
}

/** Events of a lesson job carry stages beyond the Stage 5 ones (`overview`, `component`) and a `componentId`. */
interface LessonEvent extends Omit<StageEvent, 'stage' | 'target'> { stage: string; target?: string; componentId?: string }
const asLessonEvents = (events: readonly StageEvent[]): LessonEvent[] => events as unknown as LessonEvent[];

// ---- defensive parsing ------------------------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(str) : []);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function parseLessonProgress(raw: unknown): LessonProgress | null {
  if (!isRecord(raw)) return null;
  return {
    overviewReady: raw.overviewReady === true, componentsPlanned: count(raw.componentsPlanned), componentsPublished: count(raw.componentsPublished),
    componentsFailed: count(raw.componentsFailed), partialPublish: raw.partialPublish === true,
  };
}

/** Job summary from the list or the detail: `flow` and `lesson` are validated, everything else passes through. */
export function parseJobSummary(raw: unknown): JobSummary {
  if (!isRecord(raw)) return raw as JobSummary;
  const out: Record<string, unknown> = { ...raw };
  if (raw.flow !== 'lesson' && raw.flow !== 'activity') delete out.flow;
  const progress = parseLessonProgress(raw.lesson);
  if (progress === null) delete out.lesson; else out.lesson = progress;
  return out as unknown as JobSummary;
}

function parseReport(raw: unknown): ValidationReport | null {
  if (!isRecord(raw) || !Array.isArray(raw.checks)) return null;
  const checks = raw.checks.filter(isRecord).filter((c) => str(c.id) && typeof c.passed === 'boolean').map((c) => ({
    id: c.id as string, passed: c.passed as boolean, kind: (str(c.kind) ? c.kind : 'semantic') as ValidationReport['checks'][number]['kind'],
    message: str(c.message) ? c.message : '', ...(str(c.path) ? { path: c.path } : {}), ...(Array.isArray(c.affected) ? { affected: strings(c.affected) } : {}),
  }));
  return {
    artifactId: str(raw.artifactId) ? raw.artifactId : '', revision: typeof raw.revision === 'number' ? raw.revision : 0, checks,
    publishable: raw.publishable === true,
  };
}

function parseAnalysisV2(raw: unknown): SourceAnalysisV2 | null {
  if (!isRecord(raw) || raw.analysisVersion !== 2 || typeof raw.usable !== 'boolean' || !isRecord(raw.overview)) return null;
  const o = raw.overview;
  const keyPoints = (Array.isArray(o.keyPoints) ? o.keyPoints : []).filter(isRecord).filter((p) => str(p.id) && str(p.point) && str(p.sourceId) && str(p.quote));
  const keyTerms = (Array.isArray(o.keyTerms) ? o.keyTerms : []).filter(isRecord).filter((t) => str(t.id) && str(t.term) && str(t.gloss) && str(t.sourceId) && str(t.quote));
  const componentPlan = (Array.isArray(raw.componentPlan) ? raw.componentPlan : []).filter(isRecord).filter((e) => isPlanComponentId(e.componentId));
  return {
    analysisVersion: 2, subject: isSubject(raw.subject) ? raw.subject : 'other', usable: raw.usable,
    declineCode: (str(raw.declineCode) ? raw.declineCode : '') as SourceAnalysisV2['declineCode'], declineSummary: str(raw.declineSummary) ? raw.declineSummary : '',
    pageCoverage: str(raw.pageCoverage) ? raw.pageCoverage : '',
    overview: { headline: str(o.headline) ? o.headline : '', keyPoints: keyPoints as unknown as SourceAnalysisV2['overview']['keyPoints'], keyTerms: keyTerms as unknown as SourceAnalysisV2['overview']['keyTerms'] },
    componentPlan: componentPlan.map((e) => ({
      componentId: e.componentId as PlanComponentId, pedagogicalReason: str(e.pedagogicalReason) ? e.pedagogicalReason : '',
      focusQuote: str(e.focusQuote) ? e.focusQuote : '', focusSourceId: str(e.focusSourceId) ? e.focusSourceId : '',
    }) satisfies ComponentPlanEntry),
  };
}

function parseOverview(raw: unknown): OverviewSpec | null {
  if (!isRecord(raw) || raw.componentId !== 'overview-v1' || !str(raw.headline)) return null;
  const keyPoints = (Array.isArray(raw.keyPoints) ? raw.keyPoints : []).filter(isRecord).filter((p) => str(p.id) && str(p.point) && str(p.sourceId) && str(p.quote));
  const keyTerms = (Array.isArray(raw.keyTerms) ? raw.keyTerms : []).filter(isRecord).filter((t) => str(t.id) && str(t.term) && str(t.gloss) && str(t.sourceId) && str(t.quote));
  return { ...(raw as unknown as OverviewSpec), keyPoints: keyPoints as unknown as OverviewSpec['keyPoints'], keyTerms: keyTerms as unknown as OverviewSpec['keyTerms'], sources: Array.isArray(raw.sources) ? raw.sources as OverviewSpec['sources'] : [] };
}

function parseLessonSpec(raw: unknown): LessonSpec | null {
  if (!isRecord(raw) || !Array.isArray(raw.components)) return null;
  const components = raw.components.filter(isRecord)
    .filter((c) => isPlanComponentId(c.componentId) && str(c.specId) && (LESSON_COMPONENT_STATUSES as readonly unknown[]).includes(c.status))
    .map((c): LessonComponentEntry => ({
      componentId: c.componentId as PlanComponentId, specId: c.specId as string, status: c.status as LessonComponentStatus,
      reason: str(c.reason) ? c.reason : '', revision: typeof c.revision === 'number' ? c.revision : 1,
    }));
  return { jobId: str(raw.jobId) ? raw.jobId : '', analysisRef: str(raw.analysisRef) ? raw.analysisRef : '', overview: parseOverview(raw.overview), components };
}

const LESSON_KEYS = ['analysisV2', 'analysisV2Report', 'analysisV2Revisions', 'lesson', 'kitSpecs', 'componentReports', 'componentRepairs'] as const;

/** The lesson fields of a job detail, or null when this is not a lesson job (flow 'activity', or no lesson fields at all). */
export function parseLessonData(raw: unknown): LessonData | null {
  if (!isRecord(raw)) return null;
  const flow = isRecord(raw.summary) ? raw.summary.flow : undefined;
  if (flow === 'activity') return null;
  if (flow !== 'lesson' && !LESSON_KEYS.some((k) => k in raw)) return null;

  const kitEntries = isRecord(raw.kitSpecs)
    ? Object.entries(raw.kitSpecs).filter(([, v]) => isRecord(v) && str(v.id) && isKitGenComponentId(v.componentId)) as Array<[string, KitSpec]>
    : [];
  const reportEntries = isRecord(raw.componentReports)
    ? Object.entries(raw.componentReports).flatMap(([k, v]) => { const r = parseReport(v); return r === null ? [] : [[k, r] as [string, ValidationReport]]; })
    : [];
  const revisions = (Array.isArray(raw.analysisV2Revisions) ? raw.analysisV2Revisions : []).filter(isRecord).filter((r) => typeof r.revision === 'number')
    .map((r): LessonAnalysisRevision => {
      const analysis = parseAnalysisV2(r.analysis);
      const report = parseReport(r.report);
      return { revision: r.revision as number, ...(analysis === null ? {} : { analysis }), ...(report === null ? {} : { report }) };
    });
  const repairs = (Array.isArray(raw.componentRepairs) ? raw.componentRepairs : []).filter(isRecord)
    .filter((r) => str(r.componentId) && typeof r.attempt === 'number' && typeof r.revision === 'number')
    .map((r): ComponentRepairRecord => ({
      componentId: r.componentId as string, attempt: r.attempt as number, revision: r.revision as number,
      targeted: strings(r.targeted), fixed: strings(r.fixed), remaining: strings(r.remaining), passed: r.passed === true,
      ...(typeof r.afterInjectedFault === 'boolean' ? { afterInjectedFault: r.afterInjectedFault } : {}),
    }));
  return {
    analysis: parseAnalysisV2(raw.analysisV2), analysisReport: parseReport(raw.analysisV2Report), analysisRevisions: revisions,
    lesson: parseLessonSpec(raw.lesson), kitSpecs: Object.fromEntries(kitEntries), componentReports: Object.fromEntries(reportEntries), componentRepairs: repairs,
  };
}

/**
 * The API's job detail with the lesson fields parsed into `lessonData` (absent for legacy and 'activity' jobs). Stage 7e:
 * every string except the page quotes first goes through cleanModelStrings, so no control or zero-width character from
 * model text reaches the screen.
 */
export function normaliseJobDetail(input: unknown): JobDetail {
  const raw = cleanModelStrings(input);
  if (!isRecord(raw)) return raw as JobDetail;
  const out: Record<string, unknown> = { ...raw, summary: parseJobSummary(raw.summary), events: Array.isArray(raw.events) ? raw.events.filter(isRecord) : [] };
  delete out.lessonData;
  const data = parseLessonData(raw);
  if (data !== null) out.lessonData = data;
  return out as unknown as JobDetail;
}

export function isLessonJob(detail: Pick<JobDetail, 'lessonData'>): boolean {
  return detail.lessonData !== undefined;
}

/** POST /api/jobs body. The flow is always named; the lesson flow is the default. */
export function createJobBody(sourceId: string, demoFault?: DemoFault, model?: ModelId, flow: FlowId = 'lesson'): Record<string, unknown> {
  return { sourceId, flow, ...(demoFault === undefined ? {} : { demoFault }), ...(model === undefined ? {} : { model }) };
}

// ---- the overview from the analysis (shown before the lesson file exists) -------------------------------------------

/** A usable analysis's overview as an overview spec, or null for a declined analysis. */
export function overviewFromAnalysis(analysis: SourceAnalysisV2, jobId: string): OverviewSpec | null {
  if (!analysis.usable) return null;
  return {
    schemaVersion: KIT_SCHEMA_VERSION, id: `${jobId}:overview-v1:r1`, componentId: 'overview-v1', title: analysis.overview.headline, sources: [],
    execution: structuredClone(KIT_DEFAULT_EXECUTION),
    provenance: { provider: 'meta', requestedModel: '', returnedModel: '', responseId: '', runId: jobId, promptVersion: '', revision: 1, repairOf: null, generatedAt: '' },
    seed: 1, headline: analysis.overview.headline, keyPoints: structuredClone(analysis.overview.keyPoints), keyTerms: structuredClone(analysis.overview.keyTerms),
  };
}

// ---- the streaming state ------------------------------------------------------------------------------------------

export type SlotState = 'queued' | 'building' | 'repairing' | 'passed' | 'failed' | 'skipped';
export type LessonPhase = 'analysing' | 'overview-ready' | 'building' | 'complete' | 'declined' | 'failed';

export interface ComponentSlot { componentId: PlanComponentId; label: string; state: SlotState; revision: number; message: string }

export interface LessonStream {
  phase: LessonPhase;
  /** The overview to show: the stored one, else one built from the analysis once the overview event has arrived. */
  overview: OverviewSpec | null;
  /** The lesson as stored (settled components only), with the overview resolved. */
  lesson: LessonSpec;
  /** Every planned component in plan order. */
  slots: ComponentSlot[];
  /** Plan order of component ids. */
  order: PlanComponentId[];
  /** Slots that still need a placeholder (queued, building or repairing). */
  pending: PendingSlot[];
}

export const MSG_BUILDING = 'Muse is building this…';
export const MSG_QUEUED = 'Waiting for its turn — Muse builds two components at a time.';
export const MSG_REPAIRING = 'A check found a problem, so Muse is repairing this…';

const bySeq = (a: { seq: number }, b: { seq: number }): number => a.seq - b.seq;
const isComponentEvent = (e: LessonEvent, id: string): boolean =>
  e.componentId === id && (e.stage === 'component' || e.stage === 'inject' || (e.stage === 'repair' && e.target === 'component'));

function slotFromEvents(id: string, events: readonly LessonEvent[], finished: boolean): { state: SlotState; revision: number } {
  const own = events.filter((e) => isComponentEvent(e, id) && e.stage !== 'inject').sort(bySeq);
  const last = own[own.length - 1];
  const revision = last?.revision ?? 1;
  if (last === undefined) return { state: finished ? 'skipped' : 'queued', revision };
  if (finished) return { state: last.status === 'failed' ? 'failed' : 'skipped', revision };
  if (last.stage === 'component') {
    if (last.status === 'failed') return { state: revision <= 2 ? 'repairing' : 'failed', revision };
    return { state: 'building', revision };
  }
  // a repair event
  if (last.status === 'started') return { state: 'repairing', revision };
  if (last.status === 'failed') return { state: 'failed', revision };
  return { state: 'building', revision };
}

export function buildLessonStream(detail: JobDetail): LessonStream {
  const data = detail.lessonData;
  const events = asLessonEvents(detail.events);
  const jobId = detail.summary.jobId;
  const status = detail.summary.status;
  const running = status === 'running';
  const analysis = data?.analysis ?? null;
  const stored = data?.lesson ?? null;
  const hasPremium = detail.spec !== undefined;

  const overviewEvent = events.some((e) => e.stage === 'overview' && e.status === 'succeeded');
  const overviewKnown = detail.summary.lesson?.overviewReady === true || overviewEvent || status === 'succeeded';
  const overview = stored?.overview ?? (analysis !== null && overviewKnown ? overviewFromAnalysis(analysis, jobId) : null);

  const order: PlanComponentId[] = [];
  // The plan is listed only once the overview is known (the plan comes with it); until then nothing is promised.
  for (const e of analysis?.usable === false || overview === null ? [] : analysis?.componentPlan ?? []) if (!order.includes(e.componentId)) order.push(e.componentId);
  for (const c of stored?.components ?? []) if (!order.includes(c.componentId)) order.push(c.componentId);

  const slots: ComponentSlot[] = order.map((componentId): ComponentSlot => {
    const label = componentLabel(componentId);
    const entry = stored?.components.find((c) => c.componentId === componentId);
    let state: SlotState;
    let revision = entry?.revision ?? 1;
    if (entry !== undefined) {
      if (entry.status === 'skipped') state = 'skipped';
      else if (entry.status === 'failed') state = 'failed';
      else {
        const spec = data?.kitSpecs[entry.specId];
        const present = isKitGenComponentId(componentId) ? spec !== undefined && spec.componentId === componentId : hasPremium;
        state = present ? 'passed' : running ? 'building' : 'failed';
      }
    } else ({ state, revision } = slotFromEvents(componentId, events, !running));
    const message = state === 'building' ? MSG_BUILDING : state === 'queued' ? MSG_QUEUED : state === 'repairing' ? MSG_REPAIRING : '';
    return { componentId, label, state, revision, message };
  });

  const pending: PendingSlot[] = slots.filter((s) => s.state === 'queued' || s.state === 'building' || s.state === 'repairing')
    .map((s) => ({ componentId: s.componentId, label: s.label, state: s.state as PendingSlot['state'], message: s.message }));

  let phase: LessonPhase;
  if (analysis !== null && !analysis.usable) phase = 'declined';
  else if (status === 'unsupported') phase = 'declined';
  else if (status === 'failed') phase = 'failed';
  else if (!running) phase = 'complete';
  else if (overview === null) phase = 'analysing';
  else if (slots.some((s) => s.state !== 'queued')) phase = 'building';
  else phase = 'overview-ready';

  return {
    phase, overview, order, slots, pending,
    lesson: { jobId: stored?.jobId ?? jobId, analysisRef: stored?.analysisRef ?? '', overview, components: stored?.components ?? [] },
  };
}

export type RenderMode = 'v1' | 'lesson' | 'working' | 'outcome';

/** Which centre-column view a job gets: the existing v1 views, the lesson, the "working" spinner, or the plain outcome card. */
export function lessonRenderMode(detail: JobDetail): RenderMode {
  if (!isLessonJob(detail)) return 'v1';
  const st = buildLessonStream(detail);
  if (st.phase === 'declined') return detail.lessonData?.analysis != null && !detail.lessonData.analysis.usable ? 'lesson' : 'outcome';
  if (st.phase === 'failed') return 'outcome';
  if (st.overview !== null || st.slots.length > 0) return 'lesson';
  return detail.summary.status === 'running' ? 'working' : 'outcome';
}

// ---- readable check names -------------------------------------------------------------------------------------

/** Plain-words names of the Stage 6 checks (keyed like STAGE6_CHECKS; the raw id stays visible next to them). */
export const STAGE6_CHECK_NAMES: Readonly<Record<keyof typeof STAGE6_CHECKS, string>> = {
  'A-01': 'The analysis uses the current format',
  'A-02': 'Retired check (always passes)',
  'A-03': 'The subject is one we know',
  'A-04': 'A declined page is explained, and a usable page is not',
  'A-05': 'Overview quotes appear word for word on the page',
  'A-06': 'Every quote cites a page that was supplied',
  'A-07': 'The overview and plan have a sensible number of items',
  'A-08': 'The planned components suit the page and follow the rules',
  'A-09': 'No publisher credit or endorsement wording',
  'A-10': 'Numbers in the overview can be found on the page',
  'A-11': 'The text is plain text (no markup or links)',
  'OV-01': 'Overview quotes appear word for word on the page',
  'OV-02': 'Each key term appears in its quote',
  'OV-03': 'No publisher credit or endorsement wording',
  'OV-04': 'Numbers in the overview can be found on the page',
  'OV-05': 'The overview has a sensible number of points and terms',
  'OV-06': 'Each key point matches the words of its quote',
  'Q-01': 'Each card’s quote appears word for word on the page',
  'Q-02': 'The right answer is supported by the quote',
  'Q-03': 'The answer options are all different',
  'Q-04': 'The question does not give the answer away',
  'Q-05': 'Exactly one option is correct',
  'Q-06': 'Numbers in the cards can be found on the page',
  'Q-07': 'Wrong options are not stated as true in the quote',
  'SEQ-01': 'Each step’s quote appears word for word on the page',
  'SEQ-03': 'The step order matches the page',
  'SEQ-04': 'No two steps are the same',
  'SEQ-05': 'The number of steps is in range',
  'SEQ-06': 'Numbers in the steps can be found on the page',
  'SORT-01': 'Each item’s quote appears word for word on the page',
  'SORT-02': 'Each item and its group are named in the quote',
  'SORT-03': 'Every group has at least one item',
  'SORT-04': 'No two items are the same',
  'SORT-05': 'The numbers of items and groups are in range',
  'SORT-06': 'Numbers in the items can be found on the page',
  'CM-01': 'Each link’s quote appears word for word on the page',
  'CM-02': 'Both ends of every link are named in its quote',
  'CM-03': 'The relation word is supported by the quote',
  'CM-04': 'The map is one connected whole',
  'CM-05': 'The numbers of ideas and links are in range',
  'CM-06': 'Numbers in the map can be found on the page',
  'CT-01': 'Each cell’s quote appears word for word on the page',
  'CT-02': 'Each cell’s value is stated in its quote',
  'CT-03': 'The table has a valid shape',
  'CT-04': 'Numbers in the table can be found on the page',
  'CT-05': 'The cell to predict is valid',
  'FE-01': 'The formula is quoted from the page',
  'FE-02': 'Our calculator can read the expression',
  'FE-03': 'Every variable in the expression is declared',
  'FE-04': 'Example cases are recomputed with our calculator',
  'FE-05': 'The page’s worked example matches our calculator',
  'FE-06': 'The slider ranges are sensible',
  'FE-07': 'Numbers in the explorer can be found on the page',
  'FE-08': 'The expression matches the formula printed on the page',
  'BAL-01': 'The equation is quoted from the page',
  'BAL-02': 'Every formula can be read',
  'BAL-03': 'Atoms balance exactly on both sides',
  'BAL-04': 'The coefficients are in lowest terms',
  'BAL-05': 'A balancing solution exists',
  'BAL-06': 'Retired check (always passes)',
  'BAL-07': 'Numbers in the equation can be found on the page',
  'BAL-08': 'There is only one way to balance it, up to scale',
  'BAL-09': 'Each species’ quote appears word for word on the page',
  'ALG-01': 'Each quote appears word for word on the page',
  'ALG-02': 'The page names the algorithm being traced',
  'ALG-03': 'The example list and target are valid for this algorithm',
  'ALG-04': 'Our tracer runs the algorithm to a correct finish',
  'ALG-05': 'Each stated fact is copied from its quote',
  'ALG-06': 'Numbers in the text can be found on the page',
  'ALG-07': 'The number of stated facts is in range',
  'LOG-01': 'Each quote appears word for word on the page',
  'LOG-02': 'The page states the factor for each step',
  'LOG-03': 'The page names the scale',
  'LOG-04': 'Each point on the scale is quoted from the page',
  'LOG-05': 'The points on the scale are all different',
  'LOG-06': 'Each comparison starts and ends on a quoted point',
  'LOG-07': 'Numbers in the labels match the page and the scale',
  'TH-01': 'Each quote appears word for word on the page',
  'TH-02': 'The page states how many vote',
  'TH-03': 'The page states the voting rule',
  'TH-04': 'The stated number needed matches the rule',
  'TH-05': 'The try-it vote counts are valid',
  'TH-06': 'Numbers in the text can be found on the page',
  'TH-07': 'The number of stages and scenarios is in range',
  'DT-01': 'Each quote appears word for word on the page',
  'DT-02': 'Headers and row names come from their quotes',
  'DT-03': 'Every table value is copied from its quote',
  'DT-04': 'The table has a value in every column',
  'DT-05': 'Each question has one clear answer',
  'DT-06': 'The chart uses a numeric column',
  'DT-07': 'The rate schedule is in order',
  'DT-08': 'Numbers in the text can be found on the page',
  'LD-01': 'Each quote appears word for word on the page',
  'LD-02': 'Each part name is in its quote',
  'LD-03': 'The figure belongs to this page',
  'LD-04': 'Each part point is valid and off its printed label',
  'LD-05': 'Printed-label boxes are valid',
  'LD-06': 'SAM found one region around each part point',
  'LD-07': 'The part regions do not overlap too much',
  'LD-08': 'Numbers in the text can be found on the page',
  'LD-09': 'The number of parts is in range',
};

export function stage6CheckName(id: string): string | null {
  return Object.hasOwn(STAGE6_CHECK_NAMES, id) ? (STAGE6_CHECK_NAMES[id as keyof typeof STAGE6_CHECK_NAMES] ?? null) : null;
}

/** Readable name for any check id the lesson flow can show (Stage 6 ids, analysis v1 ids, timeline ids), else null. */
export function lessonCheckName(id: string): string | null {
  return stage6CheckName(id) ?? analysisCheckName(id) ?? checkName(id);
}

const checkRef = (id: string): CheckRef => ({ id, name: lessonCheckName(id) ?? id });

// ---- repairs: which are natural, which system-made --------------------------------------------------------------

export const NATURAL_REPAIR_LABEL = ANALYSIS_REPAIR_LABEL;
export const SYSTEM_REPAIR_LABEL = 'System-made fault, repaired by Muse';
export const SYSTEM_REPAIR_FAILED_LABEL = 'System-made fault, repair did not pass';
/** S6R-11: the planted fault did not trip its intended check; the part still carried it, so this is never a natural repair. */
export const SYSTEM_UNCAUGHT_REPAIR_LABEL = 'System-made fault (not caught by its check), repaired by Muse';
export const SYSTEM_UNCAUGHT_FAILED_LABEL = 'System-made fault (not caught by its check), repair did not pass';
export const NATURAL_FAILURE_LABEL = 'Muse’s own mistake — repair did not pass';

/**
 * S6R-11: the component the demo fault was ACTUALLY planted in, or null. Derived only from a successful injection:
 * an inject 'succeeded' event carrying the componentId (the worker emits it on every lesson injection). A requested
 * fault that could not be injected (inject 'failed', no componentId, FaultRecord effective:false with an empty path)
 * plants nothing, so it never makes a natural repair look system-made. Only a recorded injection (non-empty path)
 * without any inject event (older details) falls back to the fault kind's fixed target.
 */
export function faultComponent(detail: JobDetail): string | null {
  const fault = detail.summary.demoFault;
  if (fault === undefined) return null;
  const injects = asLessonEvents(detail.events).filter((e) => e.stage === 'inject');
  const injected = injects.find((e) => e.status === 'succeeded' && str(e.componentId));
  if (injected?.componentId !== undefined) return injected.componentId;
  if (injects.length > 0 || typeof fault.path !== 'string' || fault.path === '') return null;
  if (fault.kind === 'fabricated-quote') return 'quiz-cards-v1';
  if (fault.kind === 'wrong-answer') return 'formula-explorer-v1';
  return null;
}

export type LessonFaultState = 'none' | 'requested-not-injected' | 'injected-not-caught' | 'injected-caught';

/** S6R-11: requested/not injected, injected/not caught (effective false or unrecorded) and injected/caught stay distinct. */
export function lessonFaultState(detail: JobDetail): LessonFaultState {
  const fault = detail.summary.demoFault;
  if (fault === undefined) return 'none';
  if (faultComponent(detail) === null) return 'requested-not-injected';
  return fault.effective === true ? 'injected-caught' : 'injected-not-caught';
}

export interface FailedRef extends CheckRef { message: string | null }

export interface ComponentRepairCard {
  key: string;
  componentId: string;
  label: string;
  attempt: number;
  revision: number;
  origin: 'natural' | 'system';
  badge: { text: string; tone: 'natural' | 'fault' | 'bad' };
  state: 'passed' | 'still-failing' | 'running';
  targeted: CheckRef[];
  fixed: CheckRef[];
  remaining: FailedRef[];
  introduced: CheckRef[];
  outcome: string;
  costUSD: number | null;
  model: string | null;
  responseId: string | null;
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function reportFor(data: LessonData, componentId: string, revision: number): ValidationReport | null {
  for (const [key, report] of Object.entries(data.componentReports)) {
    if (key.endsWith(`:${componentId}:r${revision}`)) return report;
  }
  return null;
}

/** One card per component repair attempt (the stored records, plus a running one for a repair call still in flight). */
export function buildLessonRepairs(detail: JobDetail): ComponentRepairCard[] {
  const data = detail.lessonData;
  if (data === undefined) return [];
  const events = asLessonEvents(detail.events);
  const faultId = faultComponent(detail);
  const caught = lessonFaultState(detail) === 'injected-caught';
  // S6R-11: origin is immutable per component — every attempt against an injected baseline is system-made.
  const systemIds = new Set<string>(faultId === null ? [] : [faultId]);
  for (const r of data.componentRepairs) if (r.afterInjectedFault === true) systemIds.add(r.componentId);
  const originOf = (componentId: string): 'natural' | 'system' => (systemIds.has(componentId) ? 'system' : 'natural');
  const systemPassed = caught ? SYSTEM_REPAIR_LABEL : SYSTEM_UNCAUGHT_REPAIR_LABEL;
  const systemFailed = caught ? SYSTEM_REPAIR_FAILED_LABEL : SYSTEM_UNCAUGHT_FAILED_LABEL;
  const finishedRepair = (id: string, revision: number): LessonEvent | undefined =>
    events.filter((e) => e.stage === 'repair' && e.target === 'component' && e.componentId === id && e.revision === revision && e.status !== 'started').sort(bySeq).pop();

  const cards: ComponentRepairCard[] = [];
  const seen = new Set<string>();
  for (const r of data.componentRepairs) {
    seen.add(`${r.componentId}:${r.revision}`);
    const origin = originOf(r.componentId);
    const report = reportFor(data, r.componentId, r.revision);
    const remaining: FailedRef[] = r.remaining.map((id) => ({ ...checkRef(id), message: report?.checks.find((c) => c.id === id)?.message ?? null }));
    const introduced = r.remaining.filter((id) => !r.targeted.includes(id)).map(checkRef);
    const ev = finishedRepair(r.componentId, r.revision);
    const badge: ComponentRepairCard['badge'] = r.passed
      ? (origin === 'system' ? { text: systemPassed, tone: 'fault' } : { text: NATURAL_REPAIR_LABEL, tone: 'natural' })
      : (origin === 'system' ? { text: systemFailed, tone: 'bad' } : { text: NATURAL_FAILURE_LABEL, tone: 'bad' });
    const nTarget = plural(r.targeted.length, 'targeted check', 'targeted checks');
    cards.push({
      key: `${r.componentId}:r${r.revision}`, componentId: r.componentId, label: isPlanComponentId(r.componentId) ? componentLabel(r.componentId) : r.componentId,
      attempt: r.attempt, revision: r.revision, origin, badge, state: r.passed ? 'passed' : 'still-failing',
      targeted: r.targeted.map(checkRef), fixed: r.fixed.map(checkRef), remaining, introduced,
      outcome: r.passed
        ? `Muse’s repair passed: fixed ${r.fixed.length} of ${nTarget} and every check now passes.`
        : `Not repaired: fixed ${r.fixed.length} of ${nTarget}; ${r.remaining.length} still failing${introduced.length > 0 ? ` (${introduced.length} new)` : ''}.`,
      costUSD: typeof ev?.estCostUSD === 'number' && Number.isFinite(ev.estCostUSD) ? ev.estCostUSD : null,
      model: ev?.model ?? null, responseId: ev?.responseId ?? null,
    });
  }
  // a repair call that has started and has no record yet
  for (const e of events) {
    if (e.stage !== 'repair' || e.target !== 'component' || e.status !== 'started' || !str(e.componentId) || typeof e.revision !== 'number') continue;
    const key = `${e.componentId}:${e.revision}`;
    if (seen.has(key) || events.some((x) => x.stage === 'repair' && x.target === 'component' && x.componentId === e.componentId && x.revision === e.revision && x.status !== 'started')) continue;
    seen.add(key);
    const origin = originOf(e.componentId);
    cards.push({
      key: `${e.componentId}:r${e.revision}`, componentId: e.componentId, label: isPlanComponentId(e.componentId) ? componentLabel(e.componentId) : e.componentId,
      attempt: e.revision - 1, revision: e.revision, origin,
      badge: origin === 'system' ? { text: systemPassed, tone: 'fault' } : { text: NATURAL_REPAIR_LABEL, tone: 'natural' },
      state: 'running', targeted: [], fixed: [], remaining: [], introduced: [], outcome: 'Muse is repairing this component…', costUSD: null, model: e.model ?? null, responseId: null,
    });
  }
  return cards;
}

// ---- diffing two v2 analyses ----------------------------------------------------------------------------------

type Keyed = { id: string } & Record<string, unknown>;
const keyedList = (v: unknown): Keyed[] => (Array.isArray(v) ? v.filter((x): x is Keyed => isRecord(x) && str(x.id)) : []);
const text = (v: unknown): string => (str(v) ? v : '');

/** What a repair changed in a v2 analysis, in words. Malformed or missing input gives no changes; it never throws. */
export function diffAnalysisV2(before: unknown, after: unknown): AnalysisChange[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const out: AnalysisChange[] = [];
  const change = (kind: AnalysisChange['kind'], label: string, b: string | null, a: string | null): void => { out.push({ kind, label, before: b, after: a }); };
  const q = (s: string): string => previewQuote(s, 90);

  if (before.usable !== after.usable) change('usable', 'Decision', before.usable === true ? 'Usable page' : 'Declined', after.usable === true ? 'Usable page' : 'Declined');
  if (text(before.pageCoverage) !== text(after.pageCoverage)) change('coverage', 'What the page covers', q(text(before.pageCoverage)), q(text(after.pageCoverage)));
  const ob = isRecord(before.overview) ? before.overview : {};
  const oa = isRecord(after.overview) ? after.overview : {};
  if (text(ob.headline) !== text(oa.headline)) change('headline', 'Headline', q(text(ob.headline)), q(text(oa.headline)));

  const pb = keyedList(ob.keyPoints);
  const pa = keyedList(oa.keyPoints);
  for (const b of pb) {
    const a = pa.find((x) => x.id === b.id);
    if (a === undefined) { change('point-removed', 'Removed key point', q(text(b.point)), null); continue; }
    if (text(b.point) !== text(a.point)) change('point-text', `Key point “${q(text(a.point))}”`, q(text(b.point)), q(text(a.point)));
    if (text(b.quote) !== text(a.quote)) change('point-quote', `Quote for key point “${previewQuote(text(a.point), 50)}”`, q(text(b.quote)), q(text(a.quote)));
    if (text(b.sourceId) !== text(a.sourceId)) change('point-quote', `Source of key point “${previewQuote(text(a.point), 50)}”`, text(b.sourceId), text(a.sourceId));
  }
  for (const a of pa) if (!pb.some((x) => x.id === a.id)) change('point-added', 'New key point', null, q(text(a.point)));

  const tb = keyedList(ob.keyTerms);
  const ta = keyedList(oa.keyTerms);
  for (const b of tb) {
    const a = ta.find((x) => x.id === b.id);
    if (a === undefined) { change('term-removed', 'Removed key term', text(b.term), null); continue; }
    if (text(b.gloss) !== text(a.gloss)) change('term-text', `Meaning of “${text(a.term)}”`, q(text(b.gloss)), q(text(a.gloss)));
    if (text(b.quote) !== text(a.quote)) change('term-quote', `Quote for key term “${text(a.term)}”`, q(text(b.quote)), q(text(a.quote)));
  }
  for (const a of ta) if (!tb.some((x) => x.id === a.id)) change('term-added', 'New key term', null, text(a.term));

  const planOf = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter(isRecord) : []);
  const lb = planOf(before.componentPlan);
  const la = planOf(after.componentPlan);
  for (let i = 0; i < Math.max(lb.length, la.length); i += 1) {
    const b = lb[i];
    const a = la[i];
    const nameOf = (e: Record<string, unknown> | undefined): string | null => (e === undefined ? null : isPlanComponentId(e.componentId) ? componentLabel(e.componentId) : text(e.componentId));
    if (nameOf(b) !== nameOf(a)) change('plan', `Planned component ${i + 1}`, nameOf(b), nameOf(a));
    else if (b !== undefined && a !== undefined && text(b.focusQuote) !== text(a.focusQuote)) change('plan-quote', `Quote for planned ${nameOf(a) ?? 'component'}`, q(text(b.focusQuote)), q(text(a.focusQuote)));
  }
  return out;
}

// ---- steps -----------------------------------------------------------------------------------------------------

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
export type StepOutcome = 'passed' | 'repaired' | 'dropped' | 'unverified' | 'skipped' | 'declined';
export interface StepTag { text: string; tone: 'natural' | 'fault' | 'warn' }

export interface LessonStep {
  key: string;
  label: string;
  status: StepStatus;
  outcome: StepOutcome | null;
  detail: string;
  durationMs: number | null;
  /** The model behind this step (null for steps that run plain code). */
  model: string | null;
  responseId: string | null;
  costUSD: number | null;
  tags: StepTag[];
}

const finiteCost = (e: LessonEvent): number | null => (typeof e.estCostUSD === 'number' && Number.isFinite(e.estCostUSD) ? e.estCostUSD : null);

function spanOf(evs: readonly LessonEvent[]): { durationMs: number | null; costUSD: number | null; model: string | null; responseId: string | null } {
  const sorted = [...evs].sort(bySeq);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let durationMs: number | null = null;
  if (first !== undefined && last !== undefined && last !== first && last.status !== 'started') {
    const d = Date.parse(last.at) - Date.parse(first.at);
    durationMs = Number.isFinite(d) && d >= 0 ? d : null;
  }
  const costs = sorted.map(finiteCost).filter((c): c is number => c !== null);
  const modelEv = sorted.find((e) => str(e.model));
  const respEv = [...sorted].reverse().find((e) => str(e.responseId));
  return { durationMs, costUSD: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0), model: modelEv?.model ?? null, responseId: respEv?.responseId ?? null };
}

function failureMessage(componentId: PlanComponentId): string {
  return isKitGenComponentId(componentId) ? FAILURE_MESSAGES[componentId] : PREMIUM_FAILURE_MESSAGE;
}

/** The step list of a lesson job: Analyse page, any analysis repair, Overview ready, one step per component, Published. */
export function buildLessonSteps(detail: JobDetail): LessonStep[] {
  const events = asLessonEvents(detail.events).sort(bySeq);
  const stream = buildLessonStream(detail);
  const data = detail.lessonData;
  const status = detail.summary.status;
  const running = status === 'running';
  const failedJob = status === 'failed';
  const steps: LessonStep[] = [];

  // Analyse page
  const analyze = events.filter((e) => e.stage === 'analyze');
  const aEnd = analyze.find((e) => e.status !== 'started');
  const aStatus: StepStatus = aEnd !== undefined ? (aEnd.status === 'failed' ? 'failed' : 'succeeded') : analyze.length > 0 || running ? 'running' : failedJob ? 'failed' : 'succeeded';
  steps.push({
    key: 'analyse', label: 'Analyse page', status: aStatus, outcome: null, tags: [],
    detail: aStatus === 'failed' ? 'The page analysis did not pass its checks.' : aStatus === 'running' ? 'Muse is reading the page…' : 'Muse read the page and planned the lesson.',
    ...spanOf(analyze),
  });

  // analysis repairs
  const repairRevs = [...new Set(events.filter((e) => e.stage === 'repair' && e.target === 'analysis' && typeof e.revision === 'number').map((e) => e.revision as number))].sort((a, b) => a - b);
  for (const rev of repairRevs) {
    const evs = events.filter((e) => e.stage === 'repair' && e.target === 'analysis' && e.revision === rev);
    const end = evs.find((e) => e.status !== 'started');
    const report = data?.analysisRevisions.find((r) => r.revision === rev)?.report;
    const stillFailing = report !== undefined && !report.publishable;
    const st: StepStatus = end === undefined ? 'running' : end.status === 'failed' || stillFailing ? 'failed' : 'succeeded';
    steps.push({
      key: `analysis-repair-${rev}`, label: `Repair analysis · attempt ${rev - 1}`, status: st, outcome: null,
      detail: st === 'running' ? 'Muse is repairing its own analysis…' : st === 'failed' ? 'The repaired analysis still failed a check.' : 'Muse repaired its own analysis and every check then passed.',
      tags: [{ text: NATURAL_REPAIR_LABEL, tone: 'natural' }], ...spanOf(evs),
    });
  }

  if (stream.phase === 'declined') {
    const analysis = data?.analysis;
    steps.push({
      key: 'declined', label: 'No lesson built', status: 'skipped', outcome: 'declined', tags: [], durationMs: null, model: null, responseId: null, costUSD: null,
      detail: declineText(analysis != null && analysis.declineCode !== '' ? analysis.declineCode : ''),
    });
    return steps;
  }

  // Overview ready
  const overviewEv = events.filter((e) => e.stage === 'overview');
  const overviewStatus: StepStatus | null = stream.overview !== null && (overviewEv.some((e) => e.status === 'succeeded') || !running || detail.summary.lesson?.overviewReady === true)
    ? 'succeeded'
    : overviewEv.some((e) => e.status === 'failed') ? 'failed' : failedJob ? null : 'pending';
  if (overviewStatus !== null) {
    const ov = stream.overview;
    steps.push({
      key: 'overview', label: 'Overview ready', status: overviewStatus, outcome: null, model: null, responseId: null, costUSD: null, durationMs: null, tags: [],
      detail: overviewStatus === 'succeeded' && ov !== null ? `${plural(ov.keyPoints.length, 'key point', 'key points')} and ${plural(ov.keyTerms.length, 'key term', 'key terms')}, every quote checked against the page.` : overviewStatus === 'failed' ? 'The overview did not pass its checks.' : 'Waiting for the analysis.',
    });
  }

  // components
  const repairs = buildLessonRepairs(detail);
  const faultId = faultComponent(detail);
  for (const slot of stream.slots) {
    const evs = events.filter((e) => isComponentEvent(e, slot.componentId));
    const entry = data?.lesson?.components.find((c) => c.componentId === slot.componentId);
    const own = repairs.filter((r) => r.componentId === slot.componentId);
    const base = { key: `component-${slot.componentId}`, label: slot.label };
    const span = spanOf(evs.filter((e) => e.stage !== 'inject'));
    switch (slot.state) {
      case 'queued': steps.push({ ...base, status: 'pending', outcome: null, detail: 'Waiting for its turn.', tags: [], ...spanOf([]) }); break;
      case 'building': steps.push({ ...base, status: 'running', outcome: null, detail: slot.message, tags: [], ...spanOf([]) }); break;
      case 'repairing': steps.push({ ...base, status: 'running', outcome: null, detail: slot.message, tags: [], ...spanOf([]) }); break;
      case 'passed': {
        const repaired = own.some((r) => r.state === 'passed') || (entry?.revision ?? 1) > 1;
        // S6R-11: system-made when this component carried an ACTUAL injected fault (any repair attempt).
        const systemMade = repaired && (faultId === slot.componentId || own.some((r) => r.origin === 'system'));
        const dropped = entry?.reason.trim() ?? '';
        const lead = repaired ? (systemMade ? SYSTEM_REPAIR_LABEL : 'Repaired by Muse after a check failed') : 'Passed all checks';
        steps.push({
          ...base, status: 'succeeded', outcome: repaired ? 'repaired' : dropped !== '' ? 'dropped' : 'passed', detail: dropped === '' ? lead : `${lead}. ${dropped}`,
          tags: repaired ? [systemMade ? { text: 'System-made fault', tone: 'fault' } : { text: NATURAL_REPAIR_LABEL, tone: 'natural' }] : dropped !== '' ? [{ text: 'Some items left out', tone: 'warn' }] : [], ...span,
        });
        break;
      }
      case 'failed': steps.push({ ...base, status: 'failed', outcome: 'unverified', detail: failureMessage(slot.componentId), tags: [], ...span }); break;
      case 'skipped': steps.push({ ...base, status: 'skipped', outcome: 'skipped', detail: SKIPPED_MESSAGE, tags: [], ...span }); break;
    }
  }

  // Published
  if (!failedJob) {
    const planned = stream.slots.length;
    const published = stream.slots.filter((s) => s.state === 'passed').length;
    const out = planned - published;
    steps.push({
      key: 'published', label: 'Published', status: running ? 'pending' : 'succeeded', outcome: null, model: null, responseId: null, costUSD: null, durationMs: null, tags: [],
      detail: running ? 'Not yet.' : `${published} of ${plural(planned, 'component', 'components')}${out > 0 ? `, ${out} left out` : ''}`,
    });
  }
  return steps;
}

// ---- run list ----------------------------------------------------------------------------------------------------

export interface LessonTag { text: string; tone: 'lesson' | 'warn' }

/** Run-list tags for a lesson job: 'Lesson · N components' and 'Some parts left out'. Empty for any other job. */
export function lessonRunTags(s: Pick<JobSummary, 'flow' | 'status' | 'lesson'>): LessonTag[] {
  if (s.flow !== 'lesson') return [];
  const p = s.lesson;
  if (p === undefined) return [{ text: 'Lesson', tone: 'lesson' }];
  const n = s.status === 'running' && p.componentsPlanned > 0 ? p.componentsPlanned : p.componentsPublished;
  const tags: LessonTag[] = [];
  if (n > 0) tags.push({ text: `Lesson · ${plural(n, 'component', 'components')}`, tone: 'lesson' });
  else if (p.overviewReady && s.status === 'succeeded') tags.push({ text: 'Lesson · overview only', tone: 'lesson' });
  else tags.push({ text: 'Lesson', tone: 'lesson' });
  if (p.partialPublish) tags.push({ text: 'Some parts left out', tone: 'warn' });
  return tags;
}

export interface LessonStatus { text: string; tone: 'ok' | 'warn' }

/** Run-list status for a finished lesson job; null when the usual status label applies. */
export function lessonStatusLabel(s: Pick<JobSummary, 'flow' | 'status' | 'lesson'>): LessonStatus | null {
  if (s.flow !== 'lesson') return null;
  if (s.status === 'succeeded') return s.lesson?.partialPublish === true ? { text: 'Some parts left out', tone: 'warn' } : { text: 'Lesson ready', tone: 'ok' };
  if (s.status === 'unsupported') return { text: 'Page declined', tone: 'warn' };
  return null;
}

// ---- analysis repair (v2), the repair summary and the quiet checks list --------------------------------------------

/** The analysis repair attempts of a lesson job, with readable Stage 6 check names and a v2 before/after diff. */
export function lessonAnalysisSteps(detail: JobDetail): AnalysisRepairStep[] {
  const data = detail.lessonData;
  if (data === undefined) return [];
  return buildAnalysisRepairSteps({ revisions: data.analysisRevisions, events: detail.events, nameOf: lessonCheckName, diff: diffAnalysisV2 });
}

export function lessonAnalysisOverall(steps: readonly AnalysisRepairStep[]): AnalysisRepairOverall {
  const last = steps[steps.length - 1];
  if (last === undefined) return { state: 'none', attempts: 0 };
  const state = last.state === 'passed' ? 'passed' : last.state === 'running' ? 'running' : 'failed';
  return { state, attempts: steps.length };
}

/** One line for the banner above the lesson: what Muse repaired, who caused it, or that a repair did not pass. Null when nothing was repaired. */
export function lessonRepairSummary(detail: JobDetail): { text: string; tone: 'natural' | 'fault' | 'bad' } | null {
  const steps = lessonAnalysisSteps(detail);
  const overall = lessonAnalysisOverall(steps);
  const cards = buildLessonRepairs(detail);
  const failedCards = cards.filter((c) => c.state === 'still-failing');
  const bad: string[] = [];
  if (overall.state === 'failed') bad.push(`Analysis repair failed (${plural(overall.attempts, 'attempt', 'attempts')})`);
  if (failedCards.length > 0) bad.push(`Component repair did not pass (${plural(failedCards.length, 'attempt', 'attempts')})`);
  if (bad.length > 0) return { text: bad.join('; '), tone: 'bad' };
  const issues = (n: number, kind: string): string => `${n} ${kind} ${n === 1 ? 'issue' : 'issues'}`;
  const parts: string[] = [];
  const analysisFixed = overall.state === 'passed' ? new Set(steps.flatMap((x) => x.fixed.map((f) => f.id))).size : 0;
  if (analysisFixed > 0) parts.push(issues(analysisFixed, 'analysis'));
  const done = cards.filter((c) => c.state === 'passed');
  const componentFixed = new Set(done.flatMap((c) => c.fixed.map((f) => `${c.componentId}:${f.id}`))).size;
  if (componentFixed > 0) parts.push(issues(componentFixed, 'component'));
  if (parts.length === 0) return null;
  const system = done.some((c) => c.origin === 'system');
  return { text: `Repaired ${parts.join(' and ')}${system ? ' (the fault was system-made)' : ''}`, tone: system ? 'fault' : 'natural' };
}

export interface CheckSection {
  key: string;
  label: string;
  passed: number;
  total: number;
  checks: Array<{ id: string; name: string; passed: boolean; message: string }>;
}

const sectionOf = (key: string, label: string, report: ValidationReport): CheckSection => ({
  key, label, passed: report.checks.filter((c) => c.passed).length, total: report.checks.length,
  checks: report.checks.map((c) => ({ id: c.id, name: lessonCheckName(c.id) ?? c.id, passed: c.passed, message: c.message })),
});

/** The checks behind a lesson, one section per checked part (page analysis first, then components in plan order). For the quiet "checks" list. */
export function lessonCheckSections(detail: JobDetail): CheckSection[] {
  const data = detail.lessonData;
  if (data === undefined) return [];
  const out: CheckSection[] = [];
  if (data.analysisReport !== null) out.push(sectionOf('analysis', 'Page analysis', data.analysisReport));
  const stream = buildLessonStream(detail);
  for (const id of stream.order) {
    const entry = data.lesson?.components.find((c) => c.componentId === id);
    const report = entry === undefined ? undefined : data.componentReports[entry.specId];
    if (report !== undefined) out.push(sectionOf(`component-${id}`, componentLabel(id), report));
  }
  return out;
}
