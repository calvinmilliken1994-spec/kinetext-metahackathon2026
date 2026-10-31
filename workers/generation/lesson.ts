// S6-W — the Stage 6 LESSON flow (docs/specs/STAGE-6-design.md + the frozen lesson-flow API
// contract at its end). One lesson job: analysis v2 (same-call overview + component plan) →
// bounded analysis repair loop → decline OR overview publish → the planned components in plan
// order, at most 2 concurrently → partial publish. Premium engines run through the v1 adapter
// (adapted analysis validated with v1 validateAnalysis BEFORE any paid call; skipped with a
// plain reason when it fails; then the unchanged v1 generateSpec/repairSpec path).
//
// Money and failure discipline (identical to the v1 worker):
//   - EVERY paid call (analysis, analysis repairs, components, component repairs, premium and
//     premium repairs) is accounted through the caller's single cost accumulator BEFORE any
//     fallible event/artifact write;
//   - GeneratedOutputError(V2) receipts are accounted like successful ones (F-01);
//   - provider-level MetaErrors are fatal for the whole job (fixed public codes via the
//     caller's failFromError) EXCEPT the timeout family (TIMEOUT / DEADLINE_EXCEEDED) in a
//     component generate/repair call after the analysis succeeded: that fails ONLY the
//     component (partial publish, TIMEOUT_REASON) — the final-evaluation timeout fix;
//     a component whose OUTPUT failed its checks is a COMPONENT-level
//     failure (partial publish) — only the overview/analysis stage can fail the lesson;
//   - INTERNAL causes stay the caller's fixed vocabulary; this module never persists raw
//     exception text;
//   - S6R-07: every caught error that carries money (MetaError chargedUSD/reservedUnknownUSD,
//     a receipt) is accounted AT ITS OWN CATCH BOUNDARY via errorCharge + ctx.account,
//     before any emit/write and before its terminal-cause metadata is stored. The FIRST
//     fatal cause is kept separately from charge collection; the final failure goes
//     through the NON-accounting ctx.fail, so nothing is counted twice or lost when two
//     concurrent components fail (or one fails while the other crashes).
//
// Events (frozen contract): stages 'overview' and 'component' (componentId, revision, status)
// extend the contracts' Stage union locally (JobStageEvent in jobs.ts) because packages/contracts
// is frozen; repair events carry target 'analysis' or target 'component' + componentId.
//
// Storage per job (frozen contract): analysis-v2.rN.json, lesson.json, {componentId}.rN.json
// (+ report inside), premium keeps the v1 spec.rN.json/report.rN.json names.
import type { MetaClient } from '../../packages/meta/client.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyzeSourceV2,
  generateKitComponent,
  repairAnalysisV2,
  repairKitComponent,
} from '../../packages/meta/pipeline-v2.ts';
import type { V2ImageInput, V2RevisionComparator, V2Validator } from '../../packages/meta/pipeline-v2.ts';
import { segmentPoints } from '../../packages/meta/sam.ts';
import type { SamBox, SamPoint, SegmentPointsResult } from '../../packages/meta/sam.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import { generateSpec, repairSpec } from '../../packages/meta/pipeline.ts';
import type { TimelineSourceAnalysis } from '../../packages/meta/pipeline.ts';
import { STAGE6_PROMPT_VERSION } from '../../packages/meta/prompts-v2.ts';
import { isMetaProvider } from '../../packages/meta/pricing.ts';
import type { MetaProvider } from '../../packages/meta/pricing.ts';
import { compareAnalysisV2Revisions, validateLessonAnalysisGate } from '../../packages/validation/analysis-v2.ts';
import {
  compareKitRevisions,
  pruneConceptMapLinks,
  pruneQuizCards,
  pruneSequenceSteps,
  pruneSortItems,
  validateKitComponent,
} from '../../packages/validation/kit/index.ts';
import type { DroppedItem } from '../../packages/validation/kit/index.ts';
import { repairFindings, truncate, validateAnalysis } from '../../packages/validation/validate.ts';
import type { AnyActivitySpec } from '../../packages/validation/validate.ts';
import {
  ACTIVITY_IDS,
  assembleKitSpec,
  assembleOverviewSpec,
  attachLabelRegions,
  isActivityId,
  isKitGenComponentId,
  isSequenceEngineId,
  kitSpecId,
} from '../../packages/contracts/index.ts';
import type {
  ActivityId,
  ActivitySpec,
  DemoFault,
  FaultRecord,
  KitSpec,
  LabelDiagramSpec,
  LabelFigureRef,
  LabelRegion,
  LessonComponentEntry,
  LessonSpec,
  MetaReceipt,
  OverviewSpec,
  Provenance,
  RepairFinding,
  RepairRecord,
  SourceAnalysis,
  SourceAnalysisV2,
  SourceDocument,
  Stage,
  StageEvent,
  StageStatus,
  TimelineActivitySpec,
  TimelineGeneratedSpec,
  Usage,
  ValidationCheck,
  ValidationReport,
} from '../../packages/contracts/index.ts';
import type {
  ComponentPlanEntry,
  FormulaExplorerGen,
  KitGenByComponent,
  KitGenComponentId,
  LabelDiagramGen,
  LabelPartGen,
  PlanComponentId,
} from '../../packages/contracts/kit.ts';
import { loadFigureLabelBoxes, listFigures, loadFigure } from '../../packages/sources/figures.ts';
import type { FigureMeta } from '../../packages/sources/figures.ts';
import { sha256 } from '../../packages/sources/index.ts';
import { applyLessonDemoFault, lessonFaultTarget, lessonIntendedChecks } from './demo-faults.ts';
import { formulaNormalisedNote, normaliseFormulaExplorerGen } from './formula-normalise.ts';
import {
  checksPassed,
  errorCharge,
  failedCheckIds,
  generatedOutputReceipt,
  receiptFields,
  reservedUnknownOf,
} from './job-support.ts';
import type { JobStatus, JobSummary } from './jobs.ts';

/* ------------------------------------------------------------------ */
/* Contract types (worker-local; packages/contracts is frozen)          */
/* ------------------------------------------------------------------ */

export type JobFlow = 'lesson' | 'activity';
export function isJobFlow(v: unknown): v is JobFlow {
  return v === 'lesson' || v === 'activity';
}

/** Lesson progress on the job summary (frozen contract: list AND detail summaries). */
export interface LessonSummary {
  overviewReady: boolean;
  componentsPlanned: number;
  componentsPublished: number;
  componentsFailed: number;
  partialPublish: boolean;
}

/** One component repair attempt (frozen contract detail field `componentRepairs`). */
export interface ComponentRepairRecord {
  componentId: string;
  attempt: number;
  revision: number;
  targeted: string[];
  fixed: string[];
  remaining: string[];
  passed: boolean;
  /**
   * S6R-11: true when this component's revision 1 carried a system-injected demo fault
   * (a SUCCESSFUL inject — summary.demoFaultComponentId). Immutable per component: every
   * attempt (1, 2, …) against that injected baseline is system-made, never a natural
   * repair. false for every other component, and when a requested fault was NOT injected.
   * Absent on records written before S6R-11 (readers then use the inject event).
   */
  afterInjectedFault?: boolean;
}

/** The contracts' Stage union extended with the frozen lesson stages ('segment' is the
 *  Stage 8b SAM 3.1 segmentation step of a label-diagram-v1 revision). */
export type LessonStage = Stage | 'overview' | 'component' | 'segment';
/** Repair events target the analysis, the v1 spec loop, or one lesson component. */
export type LessonRepairTarget = 'analysis' | 'spec' | 'component';

/** Event extras this module emits (a superset of the contracts' StageEvent optional fields). */
export interface LessonEventExtra {
  model?: string;
  responseId?: string;
  usage?: Usage | null;
  latencyMs?: number;
  estCostUSD?: number;
  detail?: string;
  revision?: number;
  target?: LessonRepairTarget;
  componentId?: string;
  provider?: MetaProvider;
  providerModel?: string;
  /** Stage 8b: SAM usage kind images_processed, on 'segment' events. */
  imagesProcessed?: number;
}

/**
 * Stage 8b: what the lesson flow needs to run ONE SAM 3.1 point-segmentation request per
 * label-diagram-v1 revision (docs/specs/STAGE-8b-label-diagram.md flow step 3). The ledger is
 * the job's spending ledger — the SAM reservation/reconciliation lands there exactly like a
 * model call's — and the worker mirrors the settled amounts into the job's single cost
 * accumulator. `fetch`/`baseUrl` are test seams (a fake SAM transport, no live calls).
 */
export interface SamSegmentDeps {
  apiKey: string | undefined;
  ledger: Ledger;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/**
 * Everything the lesson flow needs from the job runner. The cost accumulator, the fixed-code
 * failure paths and the atomic writers stay owned by jobs.ts (ONE accumulator for every flow).
 */
export interface LessonContext {
  client: MetaClient;
  source: SourceDocument;
  jobId: string;
  runDir: string;
  purpose: 'test-live' | 'demo';
  now: () => Date;
  /** The job-wide deadline (config maxJobWallTimeMs) covering the WHOLE lesson. */
  signal: AbortSignal;
  /**
   * Timeout partial-publish fix: when the job-wide deadline fires, as ms since the epoch
   * (the same real-time clock AbortSignal.timeout runs on), so the worker can refuse to
   * START a repair when less than MIN_REPAIR_BUDGET_MS remains. Optional: absent (e.g. a
   * direct runLesson test context) means no deadline is known and the budget guard never
   * blocks — the abort signal still ends in-flight calls exactly as before.
   */
  deadlineAtMs?: number;
  /** v1 output cap for premium generateSpec/repairSpec calls (config maxOutputTokens). */
  specMaxOutputTokens: number;
  maxRepairAttempts: number;
  demoFault?: DemoFault;
  /** Stage 8b: SAM 3.1 segmentation deps; required only when the plan carries label-diagram-v1. */
  sam?: SamSegmentDeps;
  /** The mutable job summary (flow 'lesson'; lesson counts kept current for the list view). */
  summary: JobSummary;
  emit(stage: LessonStage, status: StageStatus, extra?: LessonEventExtra): void;
  accountReceipt(receipt: MetaReceipt): void;
  /**
   * BUG-006: the job's ONE cost accumulator for amounts that arrive without a full receipt
   * (a MetaError's settled chargedUSD/reservedUnknownUSD). Same discipline as accountReceipt:
   * the summary is updated BEFORE any fallible event/artifact write.
   */
  account(chargedUSD: number, unknownUSD: number): void;
  writeJson(fileName: string, data: unknown): void;
  writeJob(): void;
  fail(stage: LessonStage, code: string, extra?: LessonEventExtra): JobSummary;
  failFromError(stage: LessonStage, err: unknown, extra?: LessonEventExtra): JobSummary;
  finish(status: JobStatus): JobSummary;
}

type AnyKitGen = KitGenByComponent[KitGenComponentId];

/* ------------------------------------------------------------------ */
/* Analysis v2 gate (A-01..A-11) and the v2 repair comparator           */
/* ------------------------------------------------------------------ */

/**
 * S6R-01: the lesson-flow analysis gate is the validator-owned `validateLessonAnalysisGate`
 * (packages/validation/analysis-v2.ts, wave A3): validateAnalysisV2 (A-01..A-11) PLUS the
 * overview's own OV-01..OV-06 on a usable analysis, with every OV affected pointer prefixed
 * '/overview' so OV failures join the immutable revision-1 repair authority and go through
 * the existing bounded analysis repair loop. The overview is never published without its
 * OV checks; an honest decline gets no usable-overview checks.
 */
export function validateLessonAnalysis(
  analysis: unknown,
  sources: SourceDocument[],
  figures?: readonly FigureMeta[],
): ValidationReport {
  // Stage 8b (A-08): the figure list travels with the analysis validation, so a
  // label-diagram-v1 plan is judged against the figures the analysis call actually saw.
  // An empty/absent list means "this source has no figures" (Spark Open jobs never pass one).
  return validateLessonAnalysisGate(
    analysis,
    sources,
    figures !== undefined && figures.length > 0 ? { figures } : {},
  );
}

/**
 * The v2 analysis repair comparator: compareAnalysisV2Revisions (ONE authority = the recomputed
 * revision-1 report; ids stable; counts frozen; tolerance never increases; usable never flips
 * true→false without a failing A-04), re-exported here so the lesson flow has one import site.
 */
export function compareLessonAnalysisRevisions(
  baseline: unknown,
  next: unknown,
  context?: { sources?: SourceDocument[]; findings?: RepairFinding[]; figures?: readonly FigureMeta[] },
): ValidationCheck {
  return compareAnalysisV2Revisions(baseline, next, context);
}

/* ------------------------------------------------------------------ */
/* Premium adapter (frozen contract: v1 validateAnalysis BEFORE any paid call) */
/* ------------------------------------------------------------------ */

/**
 * Build the v1 SourceAnalysis the premium generator needs from the v2 analysis: supported=true,
 * activity = the premium id, concepts from the key terms WITH their quotes, objectives from the
 * key points. The caller validates it with the v1 validateAnalysis; if it fails, the premium
 * entry is skipped with a plain reason and NO paid call is made.
 */
export function adaptPremiumAnalysis(analysis: SourceAnalysisV2, activity: ActivityId): SourceAnalysis {
  return {
    supported: true,
    activity,
    unsupportedReason: '',
    concepts: analysis.overview.keyTerms.map(kt => ({
      id: kt.id,
      name: kt.term,
      evidence: [{ sourceId: kt.sourceId, quote: kt.quote }],
    })),
    objectives: analysis.overview.keyPoints.map(kp => kp.point),
  };
}

/* ------------------------------------------------------------------ */
/* Small deterministic helpers                                          */
/* ------------------------------------------------------------------ */

/** Deterministic non-negative safe-integer seed per job+component (KitSpecBase.seed). */
export function seedFor(jobId: string, componentId: string): number {
  return Number.parseInt(sha256(`${jobId}:${componentId}`).slice(0, 8), 16);
}

/** Stage 8b: clamp a converted pixel coordinate inside the figure (non-finite → lo). */
function clampToInt(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo;
  }
  const rounded = Math.round(value);
  if (rounded < lo) {
    return lo;
  }
  if (rounded > hi) {
    return hi;
  }
  return rounded;
}

/**
 * Stage 8b flow step 3: map SAM boxes back to the gen's parts. Object id i belongs to
 * parts[i-1] (ids 1..n in part order); a missing object is simply absent (LD-06 then fails
 * for that part), and a stray id outside 1..n is ignored. Exported for tests.
 */
export function boxesToRegions(boxes: readonly SamBox[], parts: readonly LabelPartGen[]): LabelRegion[] {
  const byId = new Map<number, SamBox>();
  for (const box of boxes) {
    byId.set(box.id, box);
  }
  const out: LabelRegion[] = [];
  parts.forEach((part, i) => {
    const box = byId.get(i + 1);
    if (box !== undefined) {
      out.push({
        partId: part.id,
        x1: box.x1,
        y1: box.y1,
        x2: box.x2,
        y2: box.y2,
        confidence: box.confidence,
      });
    }
  });
  return out;
}

/** Stage 8b flow step 5: the system-owned figure reference of the published spec. */
export function labelFigureRefOf(meta: FigureMeta): LabelFigureRef {
  return {
    id: meta.id,
    width: meta.width,
    height: meta.height,
    caption: meta.caption,
    credit: meta.credit,
    license: meta.license,
    labelsInImage: meta.labelsInImage,
    labelBoxes: loadFigureLabelBoxes(meta.id),
  };
}

function provenanceFor(receipt: MetaReceipt, jobId: string, revision: number, now: () => Date): Provenance {
  return {
    provider: 'meta',
    requestedModel: receipt.requestedModel,
    returnedModel: receipt.returnedModel,
    responseId: receipt.responseId,
    runId: jobId,
    promptVersion: STAGE6_PROMPT_VERSION,
    revision,
    repairOf: revision > 1 ? revision - 1 : null,
    generatedAt: now().toISOString(),
  };
}

function fixReport(report: ValidationReport, artifactId: string, revision: number): ValidationReport {
  return { ...report, artifactId, revision };
}

/** Plain-sentence failure reason for a lesson entry: the failing check ids plus the first message. */
export function failureReason(report: ValidationReport): string {
  const failed = report.checks.filter(c => !c.passed);
  if (failed.length === 0) {
    return '';
  }
  const first = failed[0] as ValidationCheck;
  return `${failed.map(c => c.id).join(', ')}: ${truncate(first.message, 300)}`;
}

const PRUNE_UNITS: Readonly<Record<string, { one: string; many: string }>> = {
  'quiz-cards-v1': { one: 'card was', many: 'cards were' },
  'sequence-v1': { one: 'step was', many: 'steps were' },
  'sort-groups-v1': { one: 'item was', many: 'items were' },
  'concept-map-v1': { one: 'link was', many: 'links were' },
};

/** The dropped-items note carried as the `reason` of a PASSED pruned component (plain sentence). */
export function droppedItemsNote(componentId: string, dropped: readonly DroppedItem[]): string {
  if (dropped.length === 0) {
    return '';
  }
  const unit = PRUNE_UNITS[componentId] ?? { one: 'item was', many: 'items were' };
  const wording = dropped.length === 1 ? unit.one : unit.many;
  const list = dropped.map(d => `${d.id} (${d.checks.join(', ')})`).join(', ');
  return `${dropped.length} ${wording} left out because they could not be verified against the page: ${list}.`;
}

interface PruneOutcome {
  gen: unknown | null;
  dropped: DroppedItem[];
  failureMessage: string | null;
}

/** The validator-owned drop helper for the components that have one; null for the others. */
function pruneComponent(componentId: KitGenComponentId, gen: unknown, sources: SourceDocument[]): PruneOutcome | null {
  switch (componentId) {
    case 'quiz-cards-v1':
      return pruneQuizCards(gen as KitGenByComponent['quiz-cards-v1'], sources);
    case 'sequence-v1':
      return pruneSequenceSteps(gen as KitGenByComponent['sequence-v1'], sources);
    case 'sort-groups-v1':
      return pruneSortItems(gen as KitGenByComponent['sort-groups-v1'], sources);
    case 'concept-map-v1':
      return pruneConceptMapLinks(gen as KitGenByComponent['concept-map-v1'], sources);
    default:
      return null; // compare-table, formula-explorer and balance have no per-item drop path
  }
}

/* ------------------------------------------------------------------ */
/* The lesson flow                                                      */
/* ------------------------------------------------------------------ */

interface ComponentOutcome {
  componentId: PlanComponentId;
  specId: string;
  status: 'passed' | 'failed' | 'skipped';
  reason: string;
  revision: number;
}

/** S6R-07: the FIRST terminal cause, already accounted (its charge is in the summary). */
interface FatalError {
  stage: LessonStage;
  code: string;
  extra: LessonEventExtra;
}

/** Plain-sentence entry reason for a component whose OUTPUT failed its structure gate. */
export const OUTPUT_INVALID_REASON = 'The model returned output that does not match the required structure.';
/**
 * BUG-006 plain-sentence entry reason for a component whose generation or repair call ended
 * OUTPUT_TRUNCATED (the provider ran out of output room — e.g. the 24k component cap went
 * into reasoning). Fixed system-owned wording; provider text never reaches an entry.
 */
export const OUTPUT_TRUNCATED_REASON = 'Muse ran out of room while writing this part, so it was left out.';

/**
 * Timeout partial-publish fix (final-evaluation loss, docs/evidence/final-eval/timeouts.md):
 * plain-sentence entry reason for a component that ran out of time — either its call hit a
 * timeout (the client's per-call TIMEOUT or the job budget's DEADLINE_EXCEEDED) after the
 * analysis succeeded, or the next repair could not start inside the remaining budget. Fixed
 * system-owned wording; provider text never reaches an entry. The web's teacherFailure shows
 * a reason without check ids as the plain sentence it is, so this needs no web change.
 */
export const TIMEOUT_REASON = 'Ran out of time before this part was finished.';

/** Plain teacher-facing reason when the connection to the model dropped during this part's call. */
export const NETWORK_REASON = 'The connection to the model dropped before this part was finished.';

/**
 * Minimum remaining job wall-time budget required to START any repair call (analysis, kit
 * component or premium). Below it a repair almost certainly cannot finish (final-evaluation
 * evidence: one Spark Open call takes 50–120+ s), so starting one would only spend a paid
 * reservation that settles as uncertain: the component fails with TIMEOUT_REASON instead,
 * unpaid. Conservative by design; the threshold is a constant so it is testable and never
 * config-drifts.
 */
export const MIN_REPAIR_BUDGET_MS = 60_000;

/** True when at least MIN_REPAIR_BUDGET_MS of the job budget remains for one repair call. */
export function enoughBudgetForRepair(remainingMs: number): boolean {
  return remainingMs >= MIN_REPAIR_BUDGET_MS;
}

/** Fixed event detail when a repair is not started because the budget ran out (R-01: fixed
 *  code first, system-owned words only, never provider text). */
const REPAIR_NOT_STARTED_DETAIL = 'TIMEOUT; repair not started: the job ran out of time';

/**
 * Recognise the client's timeout family by its fixed codes (duck-typed like
 * truncatedOutputFailure, so a copy from another module instance behaves identically):
 * TIMEOUT = the per-call provider timeout fired; DEADLINE_EXCEEDED = the job's wall-time
 * budget aborted the call. After the analysis succeeded both are COMPONENT-level failures
 * (partial publish); during the analysis stage they still fail the whole job.
 */
function isTimeoutCode(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const code = (err as { code?: unknown }).code;
  return code === 'TIMEOUT' || code === 'DEADLINE_EXCEEDED';
}

/**
 * After the analysis succeeded, a lost call in ONE component (timeout family, or a dropped
 * connection) fails only that component with a fixed plain reason; the parts that passed
 * keep their partial publish. Returns null for every other error (still handled as before).
 */
function componentLossReason(err: unknown): string | null {
  if (isTimeoutCode(err)) {
    return TIMEOUT_REASON;
  }
  if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'NETWORK_ERROR') {
    return NETWORK_REASON;
  }
  return null;
}

/**
 * Stage 8b plain-sentence entry reason for a label-diagram-v1 component whose SAM 3.1
 * segmentation could not complete (an HTTP/network/ledger failure of the segmentation call).
 * Fixed system-owned wording; provider text never reaches an entry. The failure is
 * COMPONENT-level (partial publish), never lesson-fatal.
 */
export const SEGMENTATION_FAILED_REASON = 'The system could not segment the figure for this part, so it was left out.';
/**
 * Stage 8b plain-sentence entry reason for a label-diagram-v1 component whose listed figure
 * could not be loaded or failed its sha256 verification (or when the job's provider has no
 * figure access at all — a Spark Open job never sees figures, so a stray plan fails here or
 * in A-08 honestly).
 */
export const FIGURE_UNAVAILABLE_REASON = 'The figure this part needs could not be loaded, so it was left out.';

/**
 * BUG-006: recognise the client's OUTPUT_TRUNCATED MetaError — a PAID, settled call whose
 * response finished early (finish_reason != 'stop'). Duck-typed on the fixed code (like
 * generatedOutputReceipt) so a copy from another module instance is handled identically.
 * The charge extraction mirrors jobs.ts failFromError exactly: chargedUSD when finite, else
 * the receipt's estCostUSD; the unknown portion is the EXPLICIT reservedUnknownUSD amount.
 */
export interface TruncatedOutputFailure {
  chargedUSD: number;
  reservedUnknownUSD: number;
  reserved: boolean;
  receipt: MetaReceipt | undefined;
  hasChargedUSD: boolean;
  /** R-01: the fixed code — plus the cost-basis note on a reservation charge. */
  detail: string;
}

export function truncatedOutputFailure(err: unknown): TruncatedOutputFailure | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const e = err as {
    code?: unknown;
    chargedUSD?: unknown;
    reservedUnknownUSD?: unknown;
    costBasis?: unknown;
    receipt?: unknown;
  };
  if (e.code !== 'OUTPUT_TRUNCATED') {
    return undefined;
  }
  const receipt: MetaReceipt | undefined =
    typeof e.receipt === 'object' && e.receipt !== null
      ? (e.receipt as MetaReceipt)
      : undefined;
  const hasChargedUSD = typeof e.chargedUSD === 'number' && Number.isFinite(e.chargedUSD);
  const chargedUSD: number = hasChargedUSD
    ? (e.chargedUSD as number)
    : receipt !== undefined && Number.isFinite(receipt.estCostUSD)
      ? receipt.estCostUSD
      : 0;
  const basis: unknown = e.costBasis ?? receipt?.costBasis;
  const reserved = basis === 'reservation';
  const reservedUnknownUSD =
    typeof e.reservedUnknownUSD === 'number'
      ? reservedUnknownOf(e.reservedUnknownUSD)
      : reservedUnknownOf(receipt?.reservedUnknownUSD);
  return {
    chargedUSD,
    reservedUnknownUSD,
    reserved,
    receipt,
    hasChargedUSD,
    detail: reserved ? 'OUTPUT_TRUNCATED; cost basis: reservation (outcome uncertain)' : 'OUTPUT_TRUNCATED',
  };
}

/* ------------------------------------------------------------------ */
/* S6-W fixes: private truncated-output storage + formula normalisation */
/* ------------------------------------------------------------------ */

/** Hard cap for the privately stored cut-off text (frozen by the task brief). */
const TRUNCATED_TEXT_MAX_CHARS = 200_000;

/**
 * The cut-off text of an OUTPUT_TRUNCATED error, when the client attached it: a string
 * property `partialOutput` (frozen name, added in packages/meta in parallel). Read
 * duck-typed — like the fixed code itself — so a copy from another module instance works
 * identically. undefined for everything else.
 */
function partialOutputOf(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  const e = err as { code?: unknown; partialOutput?: unknown };
  if (e.code !== 'OUTPUT_TRUNCATED') {
    return undefined;
  }
  return typeof e.partialOutput === 'string' && e.partialOutput !== '' ? e.partialOutput : undefined;
}

/**
 * Write the cut-off text AS-IS (UTF-8, max 200,000 chars) into the job's private file
 * (`<componentId>.r<N>.truncated.txt` / `analysis-v2.r<N>.truncated.txt`). The text NEVER
 * reaches events, job.json, API responses, logs or error messages: readJob/listJobs only
 * ever read the *.json artifacts, and this file is the only place the text is kept. A
 * failing write is swallowed — the artifact is private and optional.
 */
function saveTruncatedOutput(ctx: LessonContext, fileName: string, err: unknown): void {
  const partial = partialOutputOf(err);
  if (partial === undefined) {
    return;
  }
  try {
    writeFileSync(join(ctx.runDir, fileName), partial.slice(0, TRUNCATED_TEXT_MAX_CHARS), 'utf8');
  } catch {
    // best effort: a private debug artifact must never fail the job
  }
}

/**
 * The deterministic pre-validation formula-expression tidy (our code, never AI), applied
 * to every formula-explorer-v1 revision BEFORE validation: strips a leading `<name> =`
 * so the frozen grammar sees only the rhs. Every other component passes through as-is.
 */
function normaliseGenFor(
  cid: KitGenComponentId,
  gen: AnyKitGen,
): { gen: AnyKitGen; normalisedFrom: string | null; strippedName: string | null } {
  if (cid !== 'formula-explorer-v1') {
    return { gen, normalisedFrom: null, strippedName: null };
  }
  const n = normaliseFormulaExplorerGen(gen as FormulaExplorerGen);
  return { gen: n.gen as AnyKitGen, normalisedFrom: n.normalisedFrom, strippedName: n.strippedName };
}

/** The plain-words detail suffix for a tidied revision ('' when nothing was stripped). */
function tidyNote(strippedName: string | null): string {
  return strippedName !== null ? `; ${formulaNormalisedNote(strippedName)}` : '';
}

/**
 * BUG-006: account a component-level output failure through the ONE accumulator and build
 * the failed-event extras (receipt fields + fixed-code detail, R-01). The summary is
 * current BEFORE the caller's fallible event/artifact writes.
 */
function accountComponentOutputFailure(
  ctx: LessonContext,
  failure: { chargedUSD: number; reservedUnknownUSD: number; receipt: MetaReceipt | undefined; hasChargedUSD: boolean; detail: string },
  extra: LessonEventExtra,
): LessonEventExtra {
  if (failure.receipt !== undefined && failure.hasChargedUSD === false) {
    ctx.accountReceipt(failure.receipt);
  } else {
    ctx.account(failure.chargedUSD, failure.reservedUnknownUSD);
  }
  const out: LessonEventExtra = { ...extra, detail: failure.detail };
  if (failure.receipt !== undefined) {
    Object.assign(out, receiptFields(failure.receipt));
  }
  if (failure.hasChargedUSD || failure.receipt !== undefined) {
    out.estCostUSD = failure.chargedUSD;
  }
  return out;
}

/**
 * BUG-006/F-01: classify a component REPAIR call error whose OUTPUT completed-but-failed —
 * OUTPUT_INVALID (GeneratedOutputError) or OUTPUT_TRUNCATED (the client's settled MetaError).
 * Accounts the paid call through the ONE accumulator (summary current BEFORE any fallible
 * write) and returns the plain entry reason plus the failed-event extras; undefined for
 * everything else, which stays fatal for the whole job exactly as before.
 */
function repairOutputFailure(
  ctx: LessonContext,
  err: unknown,
  base: LessonEventExtra,
): { reason: string; extra: LessonEventExtra } | undefined {
  const outputReceipt = generatedOutputReceipt(err);
  if (outputReceipt !== undefined) {
    ctx.accountReceipt(outputReceipt);
    const extra: LessonEventExtra = {
      ...base,
      ...receiptFields(outputReceipt),
      detail:
        outputReceipt.costBasis === 'reservation'
          ? 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)'
          : 'OUTPUT_INVALID',
    };
    return { reason: OUTPUT_INVALID_REASON, extra };
  }
  const truncated = truncatedOutputFailure(err);
  if (truncated !== undefined) {
    // S6-W fix: keep the cut-off text of the truncated REPAIR call privately, named for
    // the component/revision the call was making (never in events, job.json or the API).
    if (typeof base.componentId === 'string' && typeof base.revision === 'number') {
      saveTruncatedOutput(ctx, `${base.componentId}.r${base.revision}.truncated.txt`, err);
    }
    return { reason: OUTPUT_TRUNCATED_REASON, extra: accountComponentOutputFailure(ctx, truncated, base) };
  }
  return undefined;
}

/**
 * BUG-006: the componentRepairs record for a repair call whose output died (truncated or
 * structurally invalid): the attempt ran, was paid, and did not pass — remaining = targeted,
 * fixed = []. Recorded so the job (and every results line) reflects the repair that ran.
 */
function pushDiedRepairRecord(
  summary: JobSummary,
  componentId: string,
  attempt: number,
  revision: number,
  targeted: string[],
): void {
  (summary.componentRepairs ??= []).push({
    componentId,
    attempt,
    revision,
    targeted,
    fixed: [],
    remaining: targeted,
    passed: false,
    afterInjectedFault: faultInjectedInto(summary, componentId),
  });
}

/**
 * S6R-11: fault origin is immutable per component and derived ONLY from a successful
 * injection (the inject branch sets demoFaultComponentId together with the inject
 * 'succeeded' event carrying the componentId). A requested fault that could not be
 * injected (effective:false, no component) never makes any repair system-made; an
 * injected-but-not-caught fault still does (the baseline carries the planted change).
 */
function faultInjectedInto(summary: JobSummary, componentId: string): boolean {
  return summary.demoFault !== undefined && summary.demoFaultComponentId === componentId;
}

export async function runLesson(ctx: LessonContext): Promise<JobSummary> {
  const { jobId, source, summary } = ctx;
  const sources: SourceDocument[] = [source];
  /** Remaining job wall-time budget in ms; +Infinity when no deadline is wired (test seam). */
  const remainingBudgetMs = (): number =>
    typeof ctx.deadlineAtMs === 'number' && Number.isFinite(ctx.deadlineAtMs)
      ? ctx.deadlineAtMs - Date.now()
      : Number.POSITIVE_INFINITY;
  summary.lesson ??= {
    overviewReady: false,
    componentsPlanned: 0,
    componentsPublished: 0,
    componentsFailed: 0,
    partialPublish: false,
  };

  // --- Stage 8b: figure access (Muse Spark 1.3 / meta-api jobs only) ----------
  // Library sources may carry licence-checked figures (data/figures sidecars); user sources
  // never do. Spark Open (Modal) jobs get NO figure list — the analysis never sees figures,
  // so it cannot plan label-diagram-v1 (a stray plan fails A-08 honestly), and the worker
  // never attaches an image for that provider. At most the first 3 figures in listed order
  // (listFigures sorts by id) travel through analysis, generation, validation and publish.
  const jobProvider: MetaProvider = isMetaProvider(summary.provider) ? summary.provider : 'meta-api';
  // Stage 8b (lead): each figure carries its stored printed-label boxes so LD-04 (and the repair guard's recompute) can reject points on printed words.
  const jobFigures: FigureMeta[] = jobProvider === 'meta-api' ? listFigures(source.id).slice(0, 3).map(f => ({ ...f, labelBoxes: loadFigureLabelBoxes(f.id) })) : [];

  // --- Call 1: analysis v2 (same-call overview + component plan) -------------
  ctx.emit('analyze', 'started');
  const analysisValidator: V2Validator<SourceAnalysisV2> = (a, s) =>
    fixReport(validateLessonAnalysis(a, s, jobFigures), `${jobId}:analysis`, 1);
  let call1: { analysis: SourceAnalysisV2; report?: ValidationReport; receipt: MetaReceipt };
  try {
    call1 = await analyzeSourceV2(ctx.client, source, ctx.purpose, {
      signal: ctx.signal,
      validate: analysisValidator,
      // Stage 8b flow step 1: the analysis message lists the figures (id — caption —
      // labelsInImage) so Muse may plan label-diagram-v1 for a page with its own diagram.
      ...(jobFigures.length > 0
        ? {
            figures: jobFigures.map(f => ({ id: f.id, caption: f.caption, labelsInImage: f.labelsInImage })),
          }
        : {}),
    });
  } catch (err: unknown) {
    // MetaError / GeneratedOutputErrorV2 at the analysis stage are lesson-level failures
    // (the overview is the minimum publishable unit).
    // S6R-07: account the call FIRST (before the private file write and the fail event).
    const charge = errorCharge(err);
    ctx.account(charge.chargedUSD, charge.unknownUSD);
    // S6-W fix: keep the cut-off text of a truncated analysis call privately, beside the
    // job's other analysis artifacts (never in events/job.json/API responses).
    saveTruncatedOutput(ctx, 'analysis-v2.r1.truncated.txt', err);
    return ctx.fail('analyze', charge.code, charge.extra);
  }
  ctx.accountReceipt(call1.receipt);
  let curAnalysis: SourceAnalysisV2 = call1.analysis;
  let curReport: ValidationReport = fixReport(
    call1.report ?? validateLessonAnalysis(call1.analysis, sources),
    `${jobId}:analysis`,
    1,
  );
  let curRevision = 1;
  let curReceipt: MetaReceipt = call1.receipt;
  ctx.writeJson('analysis-v2.r1.json', { analysis: curAnalysis, report: curReport, receipt: curReceipt });
  // The call+validation completed: report it now (the fixture/contract timeline shows
  // analyze:succeeded before any repair event); an unrepairable analysis fails below.
  ctx.emit('analyze', 'succeeded', {
    ...receiptFields(curReceipt),
    detail: `${curAnalysis.usable ? 'usable' : `declined: ${curAnalysis.declineCode}`}; checks ${checksPassed(curReport)}/${curReport.checks.length} passed`,
  });

  // --- bounded analysis repair loop (revision-1 baseline, S5-01 discipline) ---
  const baselineAnalysis: SourceAnalysisV2 = curAnalysis;
  const baselineReport: ValidationReport = curReport;
  const baselineFindings: RepairFinding[] = repairFindings(baselineReport);
  const analysisComparator: V2RevisionComparator<SourceAnalysisV2> = (b, n, s) =>
    compareLessonAnalysisRevisions(b, n, {
      sources: s,
      findings: baselineFindings,
      // Stage 8b: the revision-1 authority recomputes with the SAME figure list the
      // analysis call saw, so A-08 agrees on both sides of a repair comparison.
      ...(jobFigures.length > 0 ? { figures: jobFigures } : {}),
    });
  let analysisAttemptsDone = 0;
  while (!curReport.publishable && analysisAttemptsDone < ctx.maxRepairAttempts) {
    const attempt = analysisAttemptsDone + 1;
    const nextRevision = attempt + 1;
    const targeted = failedCheckIds(curReport);
    if (!enoughBudgetForRepair(remainingBudgetMs())) {
      // Timeout partial-publish fix: never START a repair the job budget cannot carry.
      // Nothing is usable yet (no published overview), so — exactly like a timeout during
      // the analysis call itself — the whole job fails, with the fixed TIMEOUT code and no
      // paid call.
      return ctx.fail('repair', 'TIMEOUT', {
        target: 'analysis',
        revision: nextRevision,
        detail: REPAIR_NOT_STARTED_DETAIL,
      });
    }
    ctx.emit('repair', 'started', {
      target: 'analysis',
      revision: nextRevision,
      detail: `analysis repair ${attempt}; targeted checks: ${targeted.join(', ')}`,
    });
    let repaired: { analysis: SourceAnalysisV2; report: ValidationReport; receipt: MetaReceipt };
    try {
      repaired = await repairAnalysisV2(
        ctx.client,
        source,
        attempt === 1
          ? { analysis: baselineAnalysis, report: baselineReport, attempt: 1 }
          : { analysis: curAnalysis, report: curReport, attempt: 2, baseline: { analysis: baselineAnalysis } },
        ctx.purpose,
        { signal: ctx.signal, validate: analysisValidator, compare: analysisComparator },
      );
    } catch (err: unknown) {
      // S6R-07: account the call FIRST (before the private file write and the fail event).
      const charge = errorCharge(err, { revision: nextRevision, target: 'analysis' });
      ctx.account(charge.chargedUSD, charge.unknownUSD);
      // S6-W fix: keep the cut-off text of a truncated analysis REPAIR call privately.
      saveTruncatedOutput(ctx, `analysis-v2.r${nextRevision}.truncated.txt`, err);
      return ctx.fail('repair', charge.code, charge.extra);
    }
    ctx.accountReceipt(repaired.receipt);
    analysisAttemptsDone += 1;
    const repairedReport = fixReport(repaired.report, `${jobId}:analysis`, nextRevision);
    const passingIds = new Set(repairedReport.checks.filter(c => c.passed).map(c => c.id));
    const remaining = failedCheckIds(repairedReport);
    (summary.analysisRepairs ??= []).push({
      attempt,
      revision: nextRevision,
      targeted,
      fixed: targeted.filter(id => passingIds.has(id)),
      remaining,
      passed: repairedReport.publishable,
    });
    curAnalysis = repaired.analysis;
    curReport = repairedReport;
    curRevision = nextRevision;
    curReceipt = repaired.receipt;
    ctx.writeJson(`analysis-v2.r${nextRevision}.json`, {
      analysis: curAnalysis,
      report: curReport,
      receipt: curReceipt,
    });
    // R-01: the detail carries system-owned failing check ids, never model or exception text.
    ctx.emit('repair', 'succeeded', {
      target: 'analysis',
      ...receiptFields(curReceipt),
      revision: nextRevision,
      detail: curReport.publishable
        ? `analysis repair ${attempt} passed; ${checksPassed(curReport)}/${curReport.checks.length} checks passed`
        : `analysis repair ${attempt} still failing checks: ${remaining.join(', ')}`,
    });
    ctx.writeJob();
  }
  if (!curReport.publishable) {
    // Overview failure is the ONLY lesson-level failure: the analysis (with its same-call
    // overview) could not be repaired, so the job fails with the fixed ANALYSIS_INVALID code.
    return ctx.fail('analyze', 'ANALYSIS_INVALID', {
      ...receiptFields(curReceipt),
      detail: 'ANALYSIS_INVALID',
    });
  }

  // --- decline (usable=false): honest decline card, never an empty screen ----
  if (!curAnalysis.usable) {
    // Lead decision 2026-10-29: a demo fault that cannot be injected (here: nothing is
    // built at all) is recorded as NOT effective with a plain reason — never silently
    // dropped, never mislabelled onto a natural repair.
    recordUninjectableFault(ctx.demoFault, 'the page was declined, so no component was built');
    const lesson: LessonSpec = {
      jobId,
      analysisRef: `${jobId}/analysis-v2.r${curRevision}.json`,
      overview: null,
      components: [],
    };
    ctx.writeJson('lesson.json', lesson);
    ctx.emit('done', 'succeeded', { detail: `declined: ${curAnalysis.declineCode}` });
    return ctx.finish('unsupported');
  }

  // --- overview publish (before any component call; the web shows it immediately) ---
  const overviewSpec: OverviewSpec = assembleOverviewSpec(curAnalysis, {
    id: kitSpecId(jobId, 'overview-v1', curRevision),
    sources,
    provenance: provenanceFor(curReceipt, jobId, curRevision, ctx.now),
    seed: seedFor(jobId, 'overview-v1'),
  });
  const plan: ComponentPlanEntry[] = curAnalysis.componentPlan;
  const faultState = {
    used: false,
    target: ctx.demoFault !== undefined ? lessonFaultTarget(ctx.demoFault) : null,
  };
  /**
   * Lead decision 2026-10-29: a requested demo fault that cannot be injected is recorded
   * as NOT effective with a plain reason — an inject 'failed' event WITHOUT componentId and
   * a summary FaultRecord with effective:false — so a natural repair is never labelled
   * system-made and the exclusion-from-metrics label stays honest.
   */
  function recordUninjectableFault(kind: DemoFault | undefined, reason: string): void {
    if (kind === undefined) {
      return;
    }
    summary.demoFault = { kind, path: '', original: '', injected: '', revision: 1, effective: false };
    ctx.emit('inject', 'failed', {
      detail: `demo fault requested by the system but NOT injected: ${reason}`,
    });
    ctx.writeJob();
  }
  // When the plan does not contain the fault's target component, record it up front (the
  // lesson then proceeds normally).
  if (ctx.demoFault !== undefined && !plan.some(e => e.componentId === faultState.target)) {
    recordUninjectableFault(ctx.demoFault, `the plan has no ${faultState.target} component`);
  }
  const lesson: LessonSpec = {
    jobId,
    analysisRef: `${jobId}/analysis-v2.r${curRevision}.json`,
    overview: overviewSpec,
    components: [],
  };
  ctx.writeJson('lesson.json', lesson);
  const ls = summary.lesson as LessonSummary;
  ls.overviewReady = true;
  ls.componentsPlanned = plan.length;
  ctx.writeJob();
  ctx.emit('overview', 'succeeded', {
    detail: `overview ready: ${overviewSpec.keyPoints.length} key points, ${overviewSpec.keyTerms.length} key terms`,
  });

  // --- components: plan order, at most 2 concurrently ------------------------
  const outcomes: (ComponentOutcome | undefined)[] = new Array(plan.length);
  // Holder objects: TS control-flow analysis cannot see closure assignments to a plain
  // `let` (it would narrow the post-drain read to `never`).
  const fatalRef: { current: FatalError | null } = { current: null };
  const crashRef: { crashed: boolean; err: unknown } = { crashed: false, err: undefined };

  /**
   * S6R-07: a job-fatal component/repair error. Its charge is accounted HERE, at its own
   * catch boundary, before anything else; the FIRST such error becomes the terminal
   * cause. A later one (a concurrent component that also failed) is never overwritten or
   * dropped: its money is already in the summary and its failed event records where.
   */
  function recordFatal(err: unknown, stage: LessonStage, extra: LessonEventExtra): void {
    const charge = errorCharge(err, extra);
    ctx.account(charge.chargedUSD, charge.unknownUSD);
    if (fatalRef.current === null) {
      fatalRef.current = { stage, code: charge.code, extra: charge.extra };
      return;
    }
    ctx.emit(stage, 'failed', charge.extra);
  }

  function finalize(): void {
    const components: LessonComponentEntry[] = [];
    let published = 0;
    let failed = 0;
    plan.forEach((entry, i) => {
      const o = outcomes[i];
      if (o === undefined) {
        return;
      }
      components.push({
        componentId: entry.componentId,
        specId: o.specId,
        status: o.status,
        reason: o.reason,
        revision: o.revision,
      });
      if (o.status === 'passed') {
        published += 1;
      } else {
        failed += 1; // 'failed' and 'skipped' both count as not published
      }
    });
    lesson.components = components;
    ctx.writeJson('lesson.json', lesson);
    ls.componentsPublished = published;
    ls.componentsFailed = failed;
    ls.partialPublish = published > 0 && failed > 0;
    ctx.writeJob();
  }

  function failOutcome(
    index: number,
    componentId: PlanComponentId,
    specId: string,
    revision: number,
    reason: string,
  ): void {
    outcomes[index] = { componentId, specId, status: 'failed', reason, revision };
    finalize();
  }

  /** A component-call error: OUTPUT_INVALID, OUTPUT_TRUNCATED and the timeout family
   *  (TIMEOUT / DEADLINE_EXCEEDED — their paid calls are accounted) are component-level;
   *  anything else (other MetaErrors, unexpected) is fatal for the whole job. BUG-006: a
   *  truncated generation never fails a lesson that has its overview. */
  function componentCallError(
    err: unknown,
    index: number,
    componentId: PlanComponentId,
    specId: string,
    revision: number,
    stage: LessonStage,
    extra: LessonEventExtra,
  ): void {
    const outputReceipt = generatedOutputReceipt(err);
    if (outputReceipt !== undefined) {
      ctx.accountReceipt(outputReceipt);
      ctx.emit(stage, 'failed', {
        ...extra,
        ...receiptFields(outputReceipt),
        detail:
          outputReceipt.costBasis === 'reservation'
            ? 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)'
            : 'OUTPUT_INVALID',
      });
      failOutcome(index, componentId, specId, revision, OUTPUT_INVALID_REASON);
      return;
    }
    const truncated = truncatedOutputFailure(err);
    if (truncated !== undefined) {
      // BUG-006: the provider call COMPLETED and settled (the client bills before throwing).
      // Account it, then fail ONLY this component with the plain truncated reason.
      const failExtra = accountComponentOutputFailure(ctx, truncated, extra);
      // S6-W fix: keep the cut-off text of the truncated GENERATION call privately.
      saveTruncatedOutput(ctx, `${componentId}.r${revision}.truncated.txt`, err);
      ctx.emit(stage, 'failed', failExtra);
      failOutcome(index, componentId, specId, revision, OUTPUT_TRUNCATED_REASON);
      return;
    }
    const lossReason = componentLossReason(err);
    if (lossReason !== null) {
      // Timeout partial-publish fix (final-evaluation loss): the analysis succeeded and the
      // overview is published, so a TIMEOUT (per-call provider timeout) or DEADLINE_EXCEEDED
      // (the job's wall-time budget) fails ONLY this component — the parts that passed are
      // kept. The charge (a reservation settled as 'uncertain outcome') is accounted HERE,
      // at its own catch boundary, through the ONE accumulator, exactly as the fatal path
      // did (S6R-07); the failed event keeps the fixed-code detail from errorCharge (R-01).
      const charge = errorCharge(err, extra);
      ctx.account(charge.chargedUSD, charge.unknownUSD);
      ctx.emit(stage, 'failed', charge.extra);
      failOutcome(index, componentId, specId, revision, lossReason);
      return;
    }
    if (err instanceof Error && (err.message === 'ENGINE_REQUIRED' || err.message === 'ANALYSIS_DECLINED')) {
      // Defensive: the adapted/plan entry was validated before the call; a guard firing here
      // is an invariant break, not a model outcome.
      failOutcome(index, componentId, specId, revision, 'ANALYSIS_INVALID');
      return;
    }
    recordFatal(err, stage, extra);
  }

  function persistKitRevision(
    cid: KitGenComponentId,
    revision: number,
    gen: AnyKitGen,
    report: ValidationReport,
    receipt: MetaReceipt,
    extra?: Record<string, unknown>,
    label?: { figure: LabelFigureRef; regions: LabelRegion[] },
  ): void {
    const record: Record<string, unknown> = { gen, report, receipt, ...(extra ?? {}) };
    try {
      let spec: KitSpec = assembleKitSpec(gen, cid, {
        id: kitSpecId(jobId, cid, revision),
        sources,
        provenance: provenanceFor(receipt, jobId, revision, ctx.now),
        seed: seedFor(jobId, cid),
      });
      if (label !== undefined) {
        // Stage 8b flow step 5: the published spec is the gen body plus the system fields
        // `figure` (the resolved figure reference) and `regions` (this revision's SAM boxes).
        spec = attachLabelRegions(spec as LabelDiagramSpec, label.figure, label.regions) as KitSpec;
      }
      record.spec = spec;
    } catch {
      // A gen that cannot assemble is stored without a spec; the report already gates serving.
    }
    ctx.writeJson(`${cid}.r${revision}.json`, record);
  }

  /**
   * Stage 8b flow step 3: ONE SAM 3.1 point-segmentation request per label-diagram-v1
   * revision. Each part's normalised (x,y) becomes an image pixel (round + clamp) and an
   * object id (index + 1); the returned boxes map back to parts in order.
   *
   * Money discipline (identical to a model call): the SAM reserve/reconcile goes through the
   * job's spending ledger, and the settled amount is accounted through the job's ONE cost
   * accumulator BEFORE any fallible event/artifact write — on success the reconciled usage
   * cost, on error the amounts the wrapped ledger actually reconciled (sam.ts MetaErrors
   * carry no chargedUSD, so the wrapper's trace is authoritative; an uncertain-outcome
   * reconciliation counts as charged AND unknown exactly like a client reservation charge).
   *
   * Failure discipline: ANY segmentation failure (SAM HTTP status, network, budget, ledger,
   * a missing SAM configuration or an unusable figure) fails ONLY this component (partial
   * publish), never the lesson, with a fixed allow-listed detail code and a plain-sentence
   * entry reason.
   */
  interface SegmentOk {
    ok: true;
    regions: LabelRegion[];
  }
  interface SegmentFail {
    ok: false;
    reason: string;
    detail: string;
    extra: LessonEventExtra;
  }
  async function segmentLabelRevision(
    cid: KitGenComponentId,
    revision: number,
    gen: LabelDiagramGen,
    figure: { meta: FigureMeta; bytes: Uint8Array },
  ): Promise<SegmentOk | SegmentFail> {
    const width = figure.meta.width;
    const height = figure.meta.height;
    const parts: readonly LabelPartGen[] = Array.isArray(gen.parts) ? gen.parts : [];
    ctx.emit('segment', 'started', {
      componentId: cid,
      revision,
      detail: `sam-3.1 point segmentation of ${parts.length} part(s)`,
    });
    const segmentFail = (detail: string, reason: string): SegmentFail => {
      const extra: LessonEventExtra = { componentId: cid, revision, detail };
      ctx.emit('segment', 'failed', extra);
      return { ok: false, reason, detail, extra };
    };
    if (
      !(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) ||
      parts.length === 0
    ) {
      // A figure sidecar without usable dimensions (or an empty parts list the schema gate
      // should have caught): a store/invariant break, never provider text.
      return segmentFail('FIGURE_UNAVAILABLE', FIGURE_UNAVAILABLE_REASON);
    }
    if (ctx.sam === undefined) {
      // Config invariant: a live API always wires the SAM deps; failing here is INTERNAL.
      return segmentFail('INTERNAL', SEGMENTATION_FAILED_REASON);
    }
    const points: SamPoint[] = parts.map((p, i) => ({
      id: i + 1,
      x: clampToInt(Math.round((p.x * width) / 1000), 0, width - 1),
      y: clampToInt(Math.round((p.y * height) / 1000), 0, height - 1),
    }));
    // The wrapper ledger mirrors every settled reconciliation into `trace`, so the job's
    // accumulator can account EXACTLY what the spending ledger holds — without re-deriving
    // sam.ts's billing rules from error codes. `close` is a no-op: the job's ledger outlives
    // one component's segmentation call.
    const trace = { charged: 0, unknown: 0 };
    const real: Ledger = ctx.sam.ledger;
    const wrapped: Ledger = {
      get capUSD(): number {
        return real.capUSD;
      },
      ...(real.providerCapsUSD !== undefined ? { providerCapsUSD: real.providerCapsUSD } : {}),
      reserve: req => real.reserve(req),
      reconcile: (reservationId, actual) => {
        try {
          real.reconcile(reservationId, actual);
        } catch (err) {
          // The reconciliation itself failed: the ledger outcome is unknown — never drop money.
          trace.unknown += Math.max(0, actual.costUSD);
          throw err;
        }
        const amount = Math.max(0, actual.costUSD);
        trace.charged += amount;
        if (actual.note === 'uncertain outcome') {
          trace.unknown += amount;
        }
      },
      committedUSD: provider => real.committedUSD(provider),
      close: () => {
        // never close the job's ledger from a component
      },
    };
    let result: SegmentPointsResult;
    try {
      result = await segmentPoints({
        apiKey: ctx.sam.apiKey,
        ...(ctx.sam.baseUrl !== undefined ? { baseUrl: ctx.sam.baseUrl } : {}),
        ...(ctx.sam.fetch !== undefined ? { fetch: ctx.sam.fetch } : {}),
        ledger: wrapped,
        purpose: ctx.purpose,
        image: { bytes: figure.bytes, mime: figure.meta.mime, width, height },
        points,
        signal: ctx.signal,
      });
    } catch (err: unknown) {
      const charge = errorCharge(err, { componentId: cid, revision });
      const chargedUSD = charge.chargedUSD > 0 ? charge.chargedUSD : trace.charged;
      const unknownUSD = charge.unknownUSD > 0 ? charge.unknownUSD : trace.unknown;
      // ONE accumulator FIRST, before the fallible event write below (S6R-07 discipline).
      ctx.account(chargedUSD, unknownUSD);
      const extra: LessonEventExtra = { ...charge.extra, componentId: cid, revision };
      if (chargedUSD > 0) {
        extra.estCostUSD = chargedUSD;
      }
      ctx.emit('segment', 'failed', extra);
      // R-01: the fixed code from the shared charge vocabulary (SAM_HTTP_<status>,
      // NETWORK_ERROR, BUDGET_EXCEEDED, LEDGER_ERROR, TIMEOUT, INTERNAL, ...), never
      // provider text.
      return { ok: false, reason: SEGMENTATION_FAILED_REASON, detail: charge.code, extra };
    }
    ctx.account(result.costUSD, 0);
    const regions = boxesToRegions(result.boxes, parts);
    ctx.emit('segment', 'succeeded', {
      componentId: cid,
      revision,
      latencyMs: result.latencyMs,
      imagesProcessed: result.imagesProcessed,
      estCostUSD: result.costUSD,
      detail: `sam-3.1 returned ${regions.length} of ${parts.length} region(s)`,
    });
    return { ok: true, regions };
  }

  async function runKitComponent(index: number, planEntry: ComponentPlanEntry, cid: KitGenComponentId): Promise<void> {
    const specIdFor = (rev: number): string => kitSpecId(jobId, cid, rev);
    // S6-W fix: EVERY validation of a formula-explorer gen — ours below and the one the
    // pipeline injects — runs on the deterministically tidied expression (a leading
    // `<name> =` stripped). The tidy never validates: FE-02/FE-08 still run on the result.
    // Stage 8b: label-diagram-v1 validations carry the source's figure list (LD-03); the
    // SAM regions only exist after the call returned, so the pipeline-internal validation
    // runs without them (LD-06/LD-07: 'segmentation did not run') and the worker revalidates
    // each revision WITH its regions below.
    const kitValidate = (g: AnyKitGen, s: SourceDocument[]): ValidationReport =>
      validateKitComponent(
        cid,
        normaliseGenFor(cid, g).gen,
        s,
        cid === 'label-diagram-v1' && jobFigures.length > 0 ? { figures: jobFigures } : {},
      );

    // --- Stage 8b (label-diagram-v1): resolve the figure BEFORE any paid call ---
    // The FIRST listed figure is the one sent to Muse (flow step 2) and the one SAM
    // segments; its exact stored bytes (sha256-verified by loadFigure) travel as base64.
    let labelFigure: { meta: FigureMeta; bytes: Uint8Array } | null = null;
    let labelImage: V2ImageInput | null = null;
    if (cid === 'label-diagram-v1') {
      const first = jobFigures[0];
      if (first !== undefined) {
        try {
          const loaded = loadFigure(first.id);
          labelFigure = loaded;
          labelImage = { figureId: loaded.meta.id, mime: loaded.meta.mime, base64: Buffer.from(loaded.bytes).toString('base64') };
        } catch {
          labelFigure = null; // FIGURE_NOT_FOUND / FIGURE_HASH_MISMATCH → component-level failure below
        }
      }
    }
    /** Stage 8b flow step 5: figure ref + regions for the published spec of one revision. */
    const labelSpecData = (gen: AnyKitGen, regions: LabelRegion[]): { figure: LabelFigureRef; regions: LabelRegion[] } => {
      const gd = gen as LabelDiagramGen;
      const meta = jobFigures.find(f => f.id === gd.figureId) ?? (labelFigure as { meta: FigureMeta }).meta;
      return { figure: labelFigureRefOf(meta), regions };
    };
    /**
     * The revision report the worker persists/publishes for label-diagram-v1: the full
     * revalidation WITH this revision's regions and the figure list, plus any check the
     * pipeline added that the revalidation does not own (the repair comparator's).
     */
    const mergedLabelReport = (
      pipelineReport: ValidationReport | undefined,
      gen: AnyKitGen,
      revision: number,
      regions: LabelRegion[],
    ): ValidationReport => {
      const revalidated = validateKitComponent(cid, gen, sources, {
        revision,
        labelRegions: regions,
        ...(jobFigures.length > 0 ? { figures: jobFigures } : {}),
      });
      const reIds = new Set(revalidated.checks.map(c => c.id));
      const extraChecks = (pipelineReport?.checks ?? []).filter(c => !reIds.has(c.id));
      const checks = [...revalidated.checks, ...extraChecks];
      return fixReport(
        { ...revalidated, checks, publishable: checks.every(c => c.passed) },
        specIdFor(revision),
        revision,
      );
    };
    /** Stage 8b: the REVISION-1 SAM regions — the repair comparator's authority input. */
    let baselineLabelRegions: LabelRegion[] | null = null;

    ctx.emit('component', 'started', { componentId: cid, revision: 1 });
    if (cid === 'label-diagram-v1' && (labelFigure === null || labelImage === null)) {
      // No listed figure, or its bytes could not be loaded/verified: fail ONLY this
      // component (partial publish); no paid call was made. Fixed detail code, plain reason.
      ctx.emit('component', 'failed', { componentId: cid, revision: 1, detail: 'FIGURE_UNAVAILABLE' });
      failOutcome(index, cid, specIdFor(1), 1, FIGURE_UNAVAILABLE_REASON);
      return;
    }
    let genRes: { gen: AnyKitGen; report?: ValidationReport; receipt: MetaReceipt };
    try {
      genRes = await generateKitComponent(
        ctx.client,
        source,
        curAnalysis,
        { ...planEntry, componentId: cid },
        ctx.purpose,
        {
          signal: ctx.signal,
          validate: kitValidate,
          // Stage 8b flow step 2: the vision generation call carries the page's own figure.
          ...(labelImage !== null ? { image: labelImage } : {}),
        },
      );
    } catch (err: unknown) {
      componentCallError(err, index, cid, specIdFor(1), 1, 'component', { componentId: cid, revision: 1 });
      return;
    }
    ctx.accountReceipt(genRes.receipt);
    let revision = 1;
    // S6-W fix: the gen this worker persists, publishes and compares is the TIDIED one;
    // the pipeline's report was computed on the tidied clone (kitValidate normalises), so
    // gen and report stay consistent. `normalisedFrom` records the original expression.
    const r1Norm = normaliseGenFor(cid, genRes.gen);
    let gen: AnyKitGen = r1Norm.gen;
    const r1Extra: Record<string, unknown> =
      r1Norm.normalisedFrom !== null ? { normalisedFrom: r1Norm.normalisedFrom } : {};
    const r1Note = tidyNote(r1Norm.strippedName);
    let report: ValidationReport = fixReport(
      genRes.report ?? kitValidate(gen, sources),
      specIdFor(1),
      1,
    );
    let lastReceipt: MetaReceipt = genRes.receipt;

    // --- optional labelled demo fault (system-made, revision 1, before validation) ---
    let faultInjectedHere = false;
    if (ctx.demoFault !== undefined && !faultState.used && faultState.target === cid) {
      faultState.used = true;
      const kind = ctx.demoFault;
      let fault: FaultRecord | null = null;
      try {
        const faulty = structuredClone(gen) as AnyKitGen;
        fault = applyLessonDemoFault(kind, faulty, cid, jobId, source.text);
        gen = faulty;
      } catch {
        fault = null; // the generated component does not carry the field: recorded below, gen untouched
      }
      if (fault !== null) {
        report = fixReport(kitValidate(gen, sources), specIdFor(1), 1);
        const failed = failedCheckIds(report);
        const caughtBy = lessonIntendedChecks(kind).find(id => failed.includes(id));
        // S5-04: the fault only counts as a demonstrated catch when re-validating revision 1
        // actually failed one of the intended checks.
        fault.effective = caughtBy !== undefined;
        summary.demoFault = fault;
        summary.demoFaultComponentId = cid;
        faultInjectedHere = true;
        persistKitRevision(cid, 1, gen, report, lastReceipt, { fault, ...r1Extra });
        ctx.emit('inject', 'succeeded', {
          componentId: cid,
          revision: 1,
          detail: fault.effective
            ? `demo fault injected by the system: ${fault.kind} at ${fault.path} (caught by ${caughtBy})`
            : `demo fault injected by the system but NOT caught by ${lessonIntendedChecks(kind).join('/')}: ${fault.kind} at ${fault.path}`,
        });
        ctx.writeJob();
      } else {
        summary.demoFault = { kind, path: '', original: '', injected: '', revision: 1, effective: false };
        persistKitRevision(cid, 1, gen, report, lastReceipt, r1Extra);
        ctx.emit('inject', 'failed', {
          revision: 1,
          detail: `demo fault requested by the system but NOT injected: the generated ${cid} component does not carry the field the fault alters`,
        });
        ctx.writeJob();
      }
    } else if (cid !== 'label-diagram-v1') {
      persistKitRevision(cid, 1, gen, report, lastReceipt, r1Extra);
    }

    // --- Stage 8b: segment revision 1, then revalidate WITH its regions -------
    if (cid === 'label-diagram-v1' && labelFigure !== null) {
      const seg = await segmentLabelRevision(cid, 1, gen as LabelDiagramGen, labelFigure);
      if (seg.ok) {
        baselineLabelRegions = seg.regions;
        report = mergedLabelReport(genRes.report, gen, 1, seg.regions);
        persistKitRevision(
          cid,
          1,
          gen,
          report,
          lastReceipt,
          { ...r1Extra, regions: seg.regions },
          labelSpecData(gen, seg.regions),
        );
      } else {
        // Segmentation never completed: persist the revision validated WITHOUT regions
        // (LD-06/LD-07 fail 'segmentation did not run' — no repair permission), report the
        // fixed detail beside the receipt, and fail ONLY this component. A dead SAM endpoint
        // must not burn paid Muse repair calls, so the repair loop is skipped entirely.
        report = fixReport(kitValidate(gen, sources), specIdFor(1), 1);
        persistKitRevision(cid, 1, gen, report, lastReceipt, r1Extra);
        ctx.emit('component', 'failed', {
          componentId: cid,
          revision: 1,
          ...receiptFields(genRes.receipt),
          detail: `segmentation failed: ${seg.detail}`,
        });
        failOutcome(index, cid, specIdFor(1), 1, seg.reason);
        return;
      }
    }

    // --- prune BEFORE repair (system-owned drops while the minimum remains) ---
    // A revision carrying an injected demo fault skips the prune: the fault exists to
    // demonstrate catch → repair → pass, and a drop would hide it (the label stays honest).
    let droppedNote = '';
    const baselineGen = structuredClone(gen) as AnyKitGen;
    const baselineComponentReport = report;
    if (!report.publishable && !faultInjectedHere) {
      const pruned = pruneComponent(cid, gen, sources);
      if (pruned !== null && pruned.gen !== null) {
        gen = pruned.gen as AnyKitGen;
        report = fixReport(kitValidate(gen, sources), specIdFor(1), 1);
        droppedNote = droppedItemsNote(cid, pruned.dropped);
        persistKitRevision(cid, 1, gen, report, lastReceipt, { pruned: true, dropped: pruned.dropped, ...r1Extra });
      }
    }

    ctx.emit('component', report.publishable ? 'succeeded' : 'failed', {
      componentId: cid,
      revision: 1,
      ...receiptFields(genRes.receipt),
      detail: report.publishable
        ? `${checksPassed(report)}/${report.checks.length} checks passed${droppedNote === '' ? '' : '; items left out by the system prune'}${r1Note}`
        : `failed checks: ${failedCheckIds(report).join(', ')}${r1Note}`,
    });

    // --- bounded repair loop (immutable revision-1 baseline, compareKitRevisions) ---
    const baselineFindingsK = repairFindings(baselineComponentReport);
    let repairsDone = 0;
    /** BUG-006: plain reason when a repair call's OUTPUT died (truncated/invalid). */
    let diedReason: string | null = null;
    while (!report.publishable && repairsDone < ctx.maxRepairAttempts && fatalRef.current === null) {
      const attempt = repairsDone + 1;
      const nextRevision = revision + 1;
      const targeted = failedCheckIds(report);
      if (!enoughBudgetForRepair(remainingBudgetMs())) {
        // Timeout partial-publish fix: never START a repair the job budget cannot carry —
        // it would only spend a reservation that settles as uncertain. No paid call, no
        // repair record (the attempt never ran); the component fails with the timeout
        // reason and the rest of the lesson keeps its partial publish.
        ctx.emit('repair', 'failed', {
          target: 'component',
          componentId: cid,
          revision: nextRevision,
          detail: REPAIR_NOT_STARTED_DETAIL,
        });
        diedReason = TIMEOUT_REASON;
        break;
      }
      ctx.emit('repair', 'started', {
        target: 'component',
        componentId: cid,
        revision: nextRevision,
        detail: `targeted checks: ${targeted.join(', ')}`,
      });
      let rep: { gen: AnyKitGen; report: ValidationReport; receipt: MetaReceipt };
      try {
        rep = await repairKitComponent(
          ctx.client,
          source,
          curAnalysis,
          { ...planEntry, componentId: cid },
          attempt === 1
            ? { gen, report, attempt: 1 }
            : { gen, report, attempt: 2, baseline: { gen: baselineGen } },
          ctx.purpose,
          {
            signal: ctx.signal,
            validate: kitValidate,
            // S6-W fix: the comparator sees baseline AND candidate in their tidied form
            // (normalisation is idempotent, so an already-tidied side passes through),
            // keeping the repair comparison consistent with the persisted revisions.
            compare: (b, n, s) =>
              compareKitRevisions(cid, normaliseGenFor(cid, b).gen, normaliseGenFor(cid, n).gen, {
                sources: s,
                findings: baselineFindingsK,
                // Stage 8b: the revision-1 authority recomputes with the figure list and the
                // REVISION-1 SAM regions, so LD-03/LD-06/LD-07 agree on both sides of the
                // comparison with the report the repair model actually saw.
                ...(cid === 'label-diagram-v1'
                  ? {
                      ...(jobFigures.length > 0 ? { figures: jobFigures } : {}),
                      ...(baselineLabelRegions !== null ? { labelRegions: baselineLabelRegions } : {}),
                    }
                  : {}),
              }),
            // Stage 8b flow step 4: the repair call carries the SAME figure image.
            ...(labelImage !== null ? { image: labelImage } : {}),
          },
        );
      } catch (err: unknown) {
        const died = repairOutputFailure(ctx, err, {
          target: 'component',
          componentId: cid,
          revision: nextRevision,
        });
        if (died !== undefined) {
          // F-01/BUG-006: the repair call COMPLETED and was billed (a truncated call settled
          // before the throw). Record the attempt, the failed repair event, and fail ONLY
          // this component with the plain reason — partial publish keeps the rest.
          pushDiedRepairRecord(summary, cid, attempt, nextRevision, targeted);
          ctx.emit('repair', 'failed', died.extra);
          diedReason = died.reason;
          ctx.writeJob();
          break;
        }
        const lossReason = componentLossReason(err);
        if (lossReason !== null) {
          // Timeout partial-publish fix: the repair call ran out of time (per-call TIMEOUT
          // or the job budget's DEADLINE_EXCEEDED). The attempt ran and its reservation
          // settled — account it HERE through the ONE accumulator (S6R-07), record it, and
          // fail ONLY this component; the parts that passed keep their partial publish.
          const charge = errorCharge(err, {
            target: 'component',
            componentId: cid,
            revision: nextRevision,
          });
          ctx.account(charge.chargedUSD, charge.unknownUSD);
          pushDiedRepairRecord(summary, cid, attempt, nextRevision, targeted);
          ctx.emit('repair', 'failed', charge.extra);
          diedReason = lossReason;
          ctx.writeJob();
          break;
        }
        recordFatal(err, 'repair', { target: 'component', componentId: cid, revision: nextRevision });
        return;
      }
      ctx.accountReceipt(rep.receipt);
      repairsDone += 1;
      revision = nextRevision;
      // S6-W fix: the repair revision is tidied before it is persisted/published; the
      // pipeline's report already reflects the tidied gen (kitValidate/compare normalise).
      const repNorm = normaliseGenFor(cid, rep.gen);
      // Stage 8b live run 3 (lead): a label-diagram repair that returns the SAME gen cannot change the
      // SAM result, so further attempts only spend money; stop after recording this one.
      const unchangedLabelRepair = cid === 'label-diagram-v1' && JSON.stringify(repNorm.gen) === JSON.stringify(gen);
      gen = repNorm.gen;
      lastReceipt = rep.receipt;
      const normExtra: Record<string, unknown> =
        repNorm.normalisedFrom !== null ? { normalisedFrom: repNorm.normalisedFrom } : {};
      if (cid === 'label-diagram-v1' && labelFigure !== null) {
        // Stage 8b flow step 4: segmentation RE-RUNS on the repaired revision, and the
        // revision is validated/persisted with ITS OWN regions.
        const seg = await segmentLabelRevision(cid, revision, gen as LabelDiagramGen, labelFigure);
        if (!seg.ok) {
          // The repair call itself succeeded and was billed; the segmentation step died.
          // The attempt ran, was paid and cannot pass: record it like a died repair, persist
          // the revision validated without regions, and fail ONLY this component.
          report = fixReport(kitValidate(gen, sources), specIdFor(revision), revision);
          persistKitRevision(cid, revision, gen, report, lastReceipt, normExtra);
          pushDiedRepairRecord(summary, cid, attempt, revision, targeted);
          diedReason = seg.reason;
          ctx.writeJob();
          break;
        }
        report = mergedLabelReport(rep.report, gen, revision, seg.regions);
        persistKitRevision(
          cid,
          revision,
          gen,
          report,
          lastReceipt,
          { ...normExtra, regions: seg.regions },
          labelSpecData(gen, seg.regions),
        );
      } else {
        report = fixReport(rep.report, specIdFor(revision), revision);
        persistKitRevision(
          cid,
          revision,
          gen,
          report,
          lastReceipt,
          repNorm.normalisedFrom !== null ? { normalisedFrom: repNorm.normalisedFrom } : undefined,
        );
      }
      const passingIds = new Set(report.checks.filter(c => c.passed).map(c => c.id));
      const remaining = failedCheckIds(report);
      (summary.componentRepairs ??= []).push({
        componentId: cid,
        attempt,
        revision,
        targeted,
        fixed: targeted.filter(id => passingIds.has(id)),
        remaining,
        passed: report.publishable,
        afterInjectedFault: faultInjectedInto(summary, cid),
      });
      ctx.emit('repair', 'succeeded', {
        target: 'component',
        componentId: cid,
        revision,
        ...receiptFields(lastReceipt),
        detail: `repaired revision ${revision - 1}${tidyNote(repNorm.strippedName)}`,
      });
      ctx.emit('component', report.publishable ? 'succeeded' : 'failed', {
        componentId: cid,
        revision,
        detail: report.publishable
          ? `${checksPassed(report)}/${report.checks.length} checks passed`
          : `failed checks: ${remaining.join(', ')}`,
      });
      ctx.writeJob();
      if (unchangedLabelRepair && !report.publishable) break;
    }
    if (fatalRef.current !== null) {
      return;
    }
    outcomes[index] = {
      componentId: cid,
      specId: specIdFor(revision),
      status: report.publishable ? 'passed' : 'failed',
      // BUG-006: a repair call whose output died leaves the plain reason (truncated/invalid),
      // never the check-failure text of the revision the repair started from.
      reason: report.publishable ? droppedNote : (diedReason ?? failureReason(report)),
      revision,
    };
    finalize();
  }

  async function runPremiumComponent(index: number, activity: ActivityId): Promise<void> {
    const specId = `${source.id}-${jobId}`.slice(0, 64);
    // Frozen contract: adapt → v1 validateAnalysis FIRST; a failing adaptation skips the
    // premium entry with a plain reason and makes NO paid call.
    const adapted = adaptPremiumAnalysis(curAnalysis, activity);
    const adaptedReport = validateAnalysis(adapted, sources);
    if (!adaptedReport.publishable) {
      outcomes[index] = {
        componentId: activity,
        specId: `${jobId}:${activity}:r0`,
        status: 'skipped',
        reason: `The premium activity was skipped: the adapted page analysis did not pass validation (${failedCheckIds(adaptedReport).join(', ')}).`,
        revision: 0,
      };
      finalize();
      return;
    }
    ctx.emit('component', 'started', { componentId: activity, revision: 1 });
    summary.engine = activity;
    let specResult: {
      generated: unknown;
      spec: AnyActivitySpec;
      report: ValidationReport;
      receipt: MetaReceipt;
    };
    try {
      specResult = isSequenceEngineId(activity)
        ? await generateSpec(
            ctx.client,
            source,
            adapted as TimelineSourceAnalysis,
            { jobId, specId },
            ctx.purpose,
            ctx.now,
            { signal: ctx.signal, maxOutputTokens: ctx.specMaxOutputTokens },
          )
        : await generateSpec(ctx.client, source, adapted, { jobId, specId }, ctx.purpose, ctx.now, {
            signal: ctx.signal,
            maxOutputTokens: ctx.specMaxOutputTokens,
          });
    } catch (err: unknown) {
      componentCallError(err, index, activity, specId, 1, 'component', {
        componentId: activity,
        revision: 1,
      });
      return;
    }
    ctx.accountReceipt(specResult.receipt);
    interface PremiumRevision {
      revision: number;
      generated: unknown;
      spec: AnyActivitySpec;
      report: ValidationReport;
    }
    const revisions: PremiumRevision[] = [
      { revision: 1, generated: specResult.generated, spec: specResult.spec, report: specResult.report },
    ];
    let current = revisions[0] as PremiumRevision;
    summary.revisions = 1;
    ctx.writeJson('spec.r1.json', current.spec);
    ctx.writeJson('report.r1.json', current.report);
    ctx.emit('component', current.report.publishable ? 'succeeded' : 'failed', {
      componentId: activity,
      revision: 1,
      ...receiptFields(specResult.receipt),
      detail: current.report.publishable
        ? `${checksPassed(current.report)}/${current.report.checks.length} checks passed`
        : `failed checks: ${failedCheckIds(current.report).join(', ')}`,
    });

    // --- unchanged v1 spec repair loop (baseline = revision 1, findings history) ---
    const baseline = { spec: current.spec, failedIds: failedCheckIds(current.report) };
    const findingsHistory: RepairFinding[][] = [];
    let repairsDone = 0;
    /** BUG-006: plain reason when a repair call's OUTPUT died (truncated/invalid). */
    let diedReason: string | null = null;
    while (!current.report.publishable && repairsDone < ctx.maxRepairAttempts && fatalRef.current === null) {
      const attempt = repairsDone + 1;
      const nextRevision = current.revision + 1;
      const targeted = failedCheckIds(current.report);
      if (!enoughBudgetForRepair(remainingBudgetMs())) {
        // Timeout partial-publish fix: never START a repair the job budget cannot carry
        // (same rule as the kit loop; no paid call, no repair record).
        ctx.emit('repair', 'failed', {
          target: 'component',
          componentId: activity,
          revision: nextRevision,
          detail: REPAIR_NOT_STARTED_DETAIL,
        });
        diedReason = TIMEOUT_REASON;
        break;
      }
      ctx.emit('repair', 'started', {
        target: 'component',
        componentId: activity,
        revision: nextRevision,
        detail: `targeted checks: ${targeted.join(', ')}`,
      });
      findingsHistory.push(repairFindings(current.report, current.spec));
      let repaired: {
        generated: unknown;
        spec: AnyActivitySpec;
        report: ValidationReport;
        receipt: MetaReceipt;
      };
      try {
        repaired = isSequenceEngineId(activity)
          ? await repairSpec(
              ctx.client,
              source,
              adapted as TimelineSourceAnalysis,
              {
                generated: current.generated as TimelineGeneratedSpec,
                spec: current.spec as TimelineActivitySpec,
                report: current.report,
                revision: current.revision,
                findingsHistory,
                baseline: { spec: baseline.spec as TimelineActivitySpec, failedIds: baseline.failedIds },
              },
              { jobId, specId },
              ctx.purpose,
              ctx.now,
              { signal: ctx.signal, maxOutputTokens: ctx.specMaxOutputTokens },
            )
          : await repairSpec(
              ctx.client,
              source,
              adapted,
              {
                generated: current.generated as never,
                spec: current.spec as ActivitySpec,
                report: current.report,
                revision: current.revision,
                findingsHistory,
                baseline: { spec: baseline.spec as ActivitySpec, failedIds: baseline.failedIds },
              },
              { jobId, specId },
              ctx.purpose,
              ctx.now,
              { signal: ctx.signal, maxOutputTokens: ctx.specMaxOutputTokens },
            );
      } catch (err: unknown) {
        const died = repairOutputFailure(ctx, err, {
          target: 'component',
          componentId: activity,
          revision: nextRevision,
        });
        if (died !== undefined) {
          // F-01/BUG-006: the premium repair call COMPLETED and was billed (a truncated call
          // settled before the throw). Record the attempt and fail ONLY this component.
          pushDiedRepairRecord(summary, activity, attempt, nextRevision, targeted);
          ctx.emit('repair', 'failed', died.extra);
          diedReason = died.reason;
          ctx.writeJob();
          break;
        }
        const lossReason = componentLossReason(err);
        if (lossReason !== null) {
          // Timeout partial-publish fix: the premium repair call ran out of time. Account
          // the settled reservation HERE (S6R-07), record the attempt, fail ONLY this
          // component; the parts that passed keep their partial publish.
          const charge = errorCharge(err, {
            target: 'component',
            componentId: activity,
            revision: nextRevision,
          });
          ctx.account(charge.chargedUSD, charge.unknownUSD);
          pushDiedRepairRecord(summary, activity, attempt, nextRevision, targeted);
          ctx.emit('repair', 'failed', charge.extra);
          diedReason = lossReason;
          ctx.writeJob();
          break;
        }
        recordFatal(err, 'repair', { target: 'component', componentId: activity, revision: nextRevision });
        return;
      }
      ctx.accountReceipt(repaired.receipt);
      repairsDone += 1;
      current = {
        revision: nextRevision,
        generated: repaired.generated,
        spec: repaired.spec,
        report: repaired.report,
      };
      revisions.push(current);
      summary.revisions = revisions.length;
      ctx.writeJson(`spec.r${nextRevision}.json`, current.spec);
      ctx.writeJson(`report.r${nextRevision}.json`, current.report);
      const passingIds = new Set(current.report.checks.filter(c => c.passed).map(c => c.id));
      const remaining = failedCheckIds(current.report);
      const record: RepairRecord = {
        revision: nextRevision,
        repairOf: nextRevision - 1,
        targeted,
        fixed: targeted.filter(id => passingIds.has(id)),
        remaining,
        publishable: current.report.publishable,
        // Decision 17: repairs after a system-injected fault never count in quality metrics.
        // S6R-11: only when a fault was ACTUALLY injected into this premium component — a
        // requested-but-not-injected FaultRecord (effective:false, no component) must not
        // relabel a natural premium repair.
        afterInjectedFault: faultInjectedInto(summary, activity),
      };
      summary.repairs.push(record);
      ctx.emit('repair', 'succeeded', {
        target: 'component',
        componentId: activity,
        revision: nextRevision,
        ...receiptFields(repaired.receipt),
        detail: `repaired revision ${nextRevision - 1}`,
      });
      ctx.emit('component', current.report.publishable ? 'succeeded' : 'failed', {
        componentId: activity,
        revision: nextRevision,
        detail: current.report.publishable
          ? `${checksPassed(current.report)}/${current.report.checks.length} checks passed`
          : `failed checks: ${remaining.join(', ')}`,
      });
      ctx.writeJob();
    }
    if (fatalRef.current !== null) {
      return;
    }
    if (current.report.publishable) {
      summary.specId = specId;
      summary.publishable = true;
      summary.checksPassed = checksPassed(current.report);
      summary.checksTotal = current.report.checks.length;
      summary.publishedRevision = current.revision;
      outcomes[index] = { componentId: activity, specId, status: 'passed', reason: '', revision: current.revision };
    } else {
      let best = revisions[0] as PremiumRevision;
      for (const candidate of revisions) {
        if (failedCheckIds(candidate.report).length < failedCheckIds(best.report).length) {
          best = candidate;
        }
      }
      summary.bestRevision = best.revision;
      summary.checksPassed = checksPassed(best.report);
      summary.checksTotal = best.report.checks.length;
      outcomes[index] = {
        componentId: activity,
        specId,
        status: 'failed',
        // BUG-006: a repair call whose output died leaves the plain reason.
        reason: diedReason ?? failureReason(current.report),
        revision: current.revision,
      };
    }
    finalize();
  }

  async function runComponent(index: number): Promise<void> {
    const planEntry = plan[index] as ComponentPlanEntry;
    const componentId: unknown = planEntry.componentId;
    if (isKitGenComponentId(componentId)) {
      await runKitComponent(index, planEntry, componentId);
      return;
    }
    if (isActivityId(componentId) && (ACTIVITY_IDS as readonly string[]).includes(componentId)) {
      await runPremiumComponent(index, componentId);
      return;
    }
    // Defensive: A-08 already rejected unknown plan ids before any component call.
    outcomes[index] = {
      componentId: planEntry.componentId,
      specId: `${jobId}:${String(planEntry.componentId)}:r0`,
      status: 'skipped',
      reason: 'This component was not built for this lesson.',
      revision: 0,
    };
    finalize();
  }

  // Scheduler: start components in plan order, at most 2 concurrently; repairs reuse the
  // running task's slot. After a fatal provider error no new component starts; running tasks
  // drain (their next paid call fails fast on the aborted signal or the exhausted budget).
  await new Promise<void>(resolve => {
    let next = 0;
    let active = 0;
    const pump = (): void => {
      if (crashRef.crashed || fatalRef.current !== null) {
        if (active === 0) {
          resolve();
        }
        return;
      }
      while (active < 2 && next < plan.length && fatalRef.current === null && !crashRef.crashed) {
        const index = next;
        next += 1;
        active += 1;
        void runComponent(index).then(
          () => {
            active -= 1;
            pump();
          },
          (err: unknown) => {
            // An unexpected throw (invariant or persistence break) goes to the worker's
            // last-resort INTERNAL path after the running tasks drain.
            active -= 1;
            crashRef.crashed = true;
            crashRef.err = err;
            pump();
          },
        );
      }
      if (active === 0) {
        resolve();
      }
    };
    pump();
  });
  if (crashRef.crashed) {
    // Every fatal error before or beside the crash was accounted at its own catch.
    throw crashRef.err;
  }
  if (fatalRef.current !== null) {
    // S6R-07: NON-accounting failure path — the charge was accounted in recordFatal.
    return ctx.fail(fatalRef.current.stage, fatalRef.current.code, fatalRef.current.extra);
  }

  // --- done: succeeded = overview published (plus any passed components) ------
  const published = ls.componentsPublished;
  const planned = plan.length;
  const detail =
    published === planned
      ? `lesson published: overview + ${published}/${planned} components`
      : published === 0
        ? `lesson published: overview only (${planned} component(s) not published)`
        : `lesson published: overview + ${published}/${planned} components (partial publish)`;
  ctx.emit('done', 'succeeded', { detail });
  return ctx.finish('succeeded');
}

/** Re-exported so jobs.ts callers/tests can reference the frozen event stage union. */
export type { StageEvent };
