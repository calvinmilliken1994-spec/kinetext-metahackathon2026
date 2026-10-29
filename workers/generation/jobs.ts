// TASK-005 — bounded generation worker: ingest → analyze → specify → validate → done.
//
// One job per call of startJob(). The stage machine persists everything under
// `${storageDir}/runs/<jobId>/`:
//   job.json        — JobSummary, written synchronously at start ('running') and rewritten at the end;
//                     carries owner {pid, startedAt} so recovery never interrupts a live owner (TASK-009 N-05)
//   events.jsonl    — one StageEvent per line, appended as stages progress (seq 0..n per job)
//   analysis.json   — {analysis, report, receipt} from analyzeSource; rewritten with the
//                     repaired analysis when the analysis repair loop (TASK-024b) fixes it
//   analysis.r<n>.json — ONLY when an analysis repair was attempted: the immutable
//                     revision-1 analysis (n=1) and every repair attempt's
//                     {analysis, report, receipt} (n = attempt + 1), mirroring spec.r<n>
//   spec.r<n>.json   — the assembled ActivitySpec for revision n (1 = generateSpec,
//                      n > 1 = repairSpec; Stage 5 bounded repair loop)
//   report.r<n>.json — the ValidationReport for spec.r<n>
//
// Failure policy: `done` never rejects. Every failure (missing source, MetaError,
// schema-invalid generated output, unpublishable analysis, failed spec validation,
// unexpected crash) becomes a terminal JobSummary with status 'failed' (or
// 'unsupported' for an honest not-supported-yet analysis) plus an error
// {code, message} whose message is a FIXED public sentence per code (TASK-009
// R-01): raw exception text, provider bodies and reflected error strings are
// never persisted. Spend is accounted from receipts and MetaError.chargedUSD —
// including the receipt carried by a GeneratedOutputError, whose provider call
// completed and was reconciled before the generated data failed its schema
// (TASK-009 F-01): totalCostUSD is everything charged, reservedUnknownUSD is
// the part charged at reservation because the outcome was uncertain (R-09).
// Even the last-resort catch persists a terminal failed/INTERNAL state, so a
// settled job is never left persisted as 'running'.

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeSource, generateSpec, repairAnalysis, repairSpec } from '../../packages/meta/pipeline.ts';
import type { TimelineSourceAnalysis } from '../../packages/meta/pipeline.ts';
import { MetaError, META_ERROR_MESSAGES } from '../../packages/meta/client.ts';
import type { MetaClient, MetaErrorCode } from '../../packages/meta/client.ts';
import { isMetaProvider, isModelChoice } from '../../packages/meta/pricing.ts';
import type { MetaProvider, ModelChoice } from '../../packages/meta/pricing.ts';
import {
  loadSource,
  loadUserSource,
  userSourcesDirOf,
  USER_SOURCE_ID_PATTERN,
} from '../../packages/sources/index.ts';
import { repairFindings, validateSpec } from '../../packages/validation/validate.ts';
import type { AnyActivitySpec } from '../../packages/validation/validate.ts';
import { computeOutput } from '../../packages/activities/registry.ts';
import {
  assembleSpec,
  assembleTimelineSpec,
  DEMO_FAULTS,
  ENGINES,
  isActivityId,
  isKitGenComponentId,
  isSequenceEngineId,
  kitSpecId,
  maxTolerance,
} from '../../packages/contracts/index.ts';
import type {
  ActivityId,
  ActivitySpec,
  AssembleOptions,
  DemoFault,
  EngineId,
  FaultRecord,
  GeneratedSpec,
  GeneratedSpecByEngine,
  KitSpec,
  MetaReceipt,
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
  ValidationReport,
} from '../../packages/contracts/index.ts';
import {
  checksPassed,
  failedCheckIds,
  generatedOutputReceipt,
  positiveOr,
  readJsonFile,
  receiptFields,
  reservedUnknownOf,
  roundCost,
  writeJsonAtomic,
} from './job-support.ts';
import { fabricatedQuoteWithNonce } from './demo-faults.ts';
import { isJobFlow, runLesson } from './lesson.ts';
import type {
  ComponentRepairRecord,
  JobFlow,
  LessonEventExtra,
  LessonRepairTarget,
  LessonStage,
  LessonSummary,
} from './lesson.ts';

export type { JobFlow, LessonSummary, ComponentRepairRecord, LessonStage, LessonRepairTarget };
export { isJobFlow } from './lesson.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

/** Fixed public messages for worker-owned error codes (TASK-009 R-01). MetaError codes use META_ERROR_MESSAGES. */
export const JOB_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  SOURCE_UNAVAILABLE: 'source unavailable',
  ANALYSIS_INVALID: 'analysis failed validation',
  VALIDATION_FAILED: 'generated spec failed validation',
  OUTPUT_INVALID: 'The model returned output that does not match the required structure.',
  INTERRUPTED: 'The server stopped before this job finished.',
  INTERNAL: 'Unexpected internal error',
};

/** The only error shape ever persisted or returned: a code plus its fixed public message. */
function publicError(code: string): { code: string; message: string } {
  const own = JOB_ERROR_MESSAGES[code];
  if (own !== undefined) {
    return { code, message: own };
  }
  const meta = META_ERROR_MESSAGES[code as MetaErrorCode];
  if (meta !== undefined) {
    return { code, message: meta };
  }
  return { code: 'INTERNAL', message: JOB_ERROR_MESSAGES['INTERNAL'] ?? 'Unexpected internal error' };
}

export interface JobOwner {
  /** PID of the process that started the job (N-05). */
  pid: number;
  /** ISO timestamp recorded when the job started. */
  startedAt: string;
}

/** Summary of one ANALYSIS repair attempt (TASK-024b), stored on the job. Mirrors RepairRecord for spec repairs. */
export interface AnalysisRepairRecord {
  /** 1-based analysis repair attempt (bounded by the same maxRepairAttempts as spec repairs). */
  attempt: number;
  /** Analysis revision the attempt produced (attempt + 1; revision 1 is the original analysis). */
  revision: number;
  /** Check ids failing on the analysis the attempt started from. */
  targeted: string[];
  /** Of `targeted`, the ids that pass on the produced revision. */
  fixed: string[];
  /** Check ids failing on the produced revision (may include repair.analysis-unchanged or new failures). */
  remaining: string[];
  /** True when the produced analysis report is publishable. */
  passed: boolean;
}

export interface JobSummary {
  jobId: string;
  sourceId: string;
  status: JobStatus;
  purpose: 'test-live' | 'demo';
  createdAt: string;
  finishedAt?: string;
  specId?: string;
  publishable?: boolean;
  checksPassed?: number;
  checksTotal?: number;
  totalCostUSD: number;
  /** Part of totalCostUSD charged at reservation because the outcome was uncertain (TASK-009 R-09). */
  reservedUnknownUSD: number;
  error?: { code: string; message: string };
  /** Activity Muse chose for this source (Stage 5/5b: a numeric engine or a sequence engine); null until a supported analysis is validated. */
  engine: ActivityId | null;
  /** Number of spec revisions produced and persisted (1 without repairs). */
  revisions: number;
  /** One record per repair attempt, in order (Stage 5). */
  repairs: RepairRecord[];
  /**
   * S6-W (frozen lesson-flow contract): which pipeline ran this job — 'lesson' (Stage 6:
   * analysis v2 + overview + component plan) or 'activity' (the unchanged v1 pipeline).
   * Optional in the type because job records written before Stage 6 carry no such field;
   * every read path fills the legacy default 'activity', and every new job records it from
   * the first job.json write on.
   */
  flow?: JobFlow;
  /**
   * S6-W: lesson progress, present on every lesson-flow job from the first job.json write
   * (frozen contract: job summary gains `lesson` for lesson jobs). Absent on activity jobs.
   */
  lesson?: LessonSummary;
  /**
   * S6-W: one record per COMPONENT repair attempt, in order (frozen contract detail field
   * `componentRepairs`; persisted on the summary so it survives a crash mid-lesson).
   */
  componentRepairs?: ComponentRepairRecord[];
  /**
   * S6-W: the plan component a demo fault was injected into (lead decision 2026-10-29: the
   * inject event and the summary both name it, so a natural repair is never labelled
   * system-made). Absent when no fault was injected.
   */
  demoFaultComponentId?: string;
  /**
   * One record per ANALYSIS repair attempt, in order (TASK-024b). Empty when the
   * revision-1 analysis was publishable or maxRepairAttempts is 0. Optional: jobs
   * recorded before analysis repair existed carry no analysisRepairs field.
   */
  analysisRepairs?: AnalysisRepairRecord[];
  /** Set when any revision was publishable: the revision that gets published. */
  publishedRevision?: number;
  /** Set on VALIDATION_FAILED: the revision with the fewest failing checks. */
  bestRevision?: number;
  /** Set when the system injected a labelled demo fault into revision 1 (never a model error). */
  demoFault?: FaultRecord;
  /** Where the source came from: the licensed library or a teacher's pasted text. */
  sourceKind: 'library' | 'user';
  /**
   * OW-2: which model ran this job — the display ModelChoice id. Optional in the
   * type because job records written before OW-2 carry no such field; every read
   * path (listJobs/readJob) fills the legacy default 'muse-spark-1.3', and every
   * new job records it from the first job.json write on.
   */
  model?: ModelChoice;
  /** OW-2: the provider that served this job ('meta-api' | 'modal'); legacy default 'meta-api'. */
  provider?: MetaProvider;
  /** OW-2: the provider's exact model string (e.g. 'meta-models/Muse-Spark-Open-816B-A42B' on Modal). */
  providerModel?: string;
  /**
   * N-05: the process that owns this job, recorded in job.json from the first
   * write so recovery never interrupts a job whose owner is still alive.
   * Optional: records written before this field existed carry no owner.
   */
  owner?: JobOwner;
}

/** Per-job resource budgets wired from config/resource-limits.json (TASK-009 R-11). */
export interface JobLimits {
  maxJobWallTimeMs?: number;
  analysisMaxOutputTokens?: number;
  specMaxOutputTokens?: number;
  /**
   * Stage 5: bound on Muse repair attempts after a failing validation (config
   * maxRepairAttempts). S5-06: must be an integer in [0, MAX_REPAIR_ATTEMPTS_BOUND];
   * any other value throws MAX_REPAIR_ATTEMPTS_INVALID at startJob (fail closed —
   * the absolute ≤2 repair rule is enforced at this boundary, never defaulted away).
   */
  maxRepairAttempts?: number;
}

export interface JobDeps {
  client: MetaClient;
  storageDir: string;
  purpose: 'test-live' | 'demo';
  sourcesDir?: URL;
  /** Teacher-source store; defaults to `<storageDir>/user-sources`. */
  userSourcesDir?: string;
  /** Labelled system-made fault to inject into revision 1 before validation (demo only). */
  demoFault?: DemoFault;
  /**
   * S6-W: which pipeline to run. 'lesson' = the Stage 6 lesson flow; 'activity' (default) =
   * the unchanged v1 pipeline. The API server defaults to 'lesson' per the frozen contract;
   * the worker keeps 'activity' as its own default so pre-Stage-6 callers/tests are unchanged.
   */
  flow?: JobFlow;
  now?: () => Date;
  newJobId?: () => string;
  limits?: JobLimits;
}

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JOB_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const DEFAULT_JOB_WALL_TIME_MS = 120000; // config/resource-limits.json maxJobWallTimeMs
const DEFAULT_ANALYSIS_MAX_OUTPUT_TOKENS = 6000;
const DEFAULT_SPEC_MAX_OUTPUT_TOKENS = 8000; // config/resource-limits.json maxOutputTokens
const DEFAULT_MAX_REPAIR_ATTEMPTS = 2; // config/resource-limits.json maxRepairAttempts
/** S5-06: the absolute repair bound. Startup and the worker boundary both enforce integer [0, 2]. */
export const MAX_REPAIR_ATTEMPTS_BOUND = 2;

/**
 * S6-W: event extras are the lesson-flow superset (the contracts' StageEvent optional fields
 * plus `componentId`); the v1 flow uses the same shape it always did.
 */
type EventExtra = LessonEventExtra;

/**
 * OW-2 + S6-W: the persisted event shape — the contracts' StageEvent plus the job's
 * provider and exact provider model string, and (frozen lesson-flow API contract) the two
 * lesson stages 'overview'/'component', the repair target 'component' and `componentId`.
 * packages/contracts is frozen, so the extended keys are declared here (additive JSON
 * fields; every consumer that reads StageEvent keeps working). `model` on an event is
 * ALWAYS the display ModelChoice id of the job, never the raw returnedModel.
 */
export type JobStageEvent = Omit<StageEvent, 'stage' | 'target'> & {
  stage: LessonStage;
  target?: LessonRepairTarget;
  componentId?: string;
  provider?: MetaProvider;
  providerModel?: string;
};

/** Stage 5b: anything Muse may generate — a numeric engine's generated spec or the timeline's. */
type AnyGeneratedSpec = GeneratedSpec | TimelineGeneratedSpec;

/** One generateSpec/repairSpec result, whichever activity kind produced it. */
interface PipelineResult {
  generated: AnyGeneratedSpec;
  spec: AnyActivitySpec;
  report: ValidationReport;
  receipt: MetaReceipt;
}

/**
 * BUG-002/S5B-08: a FIXED-vocabulary cause for the last-resort INTERNAL event.
 * The vocabulary is an explicit allow-list of errno codes and built-in error class
 * names (plus the two DOMException names fetch/AbortSignal use) — anything else,
 * including a regex-shaped but non-enumerated token like the reviewer's
 * 'PRIVATE_MARKER_TOKEN', maps to 'unknown'. Exported for tests.
 */
export const INTERNAL_CAUSE_VOCABULARY: readonly string[] = [
  // errno-style codes (node fs/net)
  'EPERM', 'EACCES', 'EBUSY', 'ENOENT', 'ENOSPC', 'EMFILE', 'EEXIST', 'EISDIR', 'ENOTDIR', 'ETIMEDOUT',
  // built-in error classes
  'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'Error',
  // DOMException names produced by fetch/AbortSignal
  'AbortError', 'TimeoutError',
];
const INTERNAL_CAUSE_SET: ReadonlySet<string> = new Set(INTERNAL_CAUSE_VOCABULARY);

export function sanitisedCause(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') {
      // A string code is checked against the allow-list ONLY — never reflected,
      // never used as a fallback into `name` (a marker code with a built-in name
      // stays 'unknown', per the review's regression case).
      return INTERNAL_CAUSE_SET.has(code) ? code : 'unknown';
    }
    const name = (err as { name?: unknown }).name;
    if (typeof name === 'string') {
      return INTERNAL_CAUSE_SET.has(name) ? name : 'unknown';
    }
  }
  return 'unknown';
}

/** True for the pipeline's plain ENGINE_REQUIRED/ENGINE_MISMATCH guard errors (thrown before any model call). */
function isEngineRequired(err: unknown): boolean {
  return err instanceof Error && err.message === 'ENGINE_REQUIRED';
}

/** assembleSpec/assembleTimelineSpec with a runtime activity id (the typed overloads need the id as a literal).
 * S5B-05: EXHAUSTIVE across the whole catalogue through one shared assembler path per
 * kind — assembleSpec for EVERY numeric EngineId, assembleTimelineSpec for timeline —
 * with a compile-time never check, so a new ActivityId added without a case fails
 * typecheck instead of falling through to a runtime ENGINE_REQUIRED after a paid
 * generation (the reviewer's compound-interest/hardy-weinberg/half-life demo crash). */
export function assembleForActivity(gen: AnyGeneratedSpec, activity: ActivityId, opts: AssembleOptions): AnyActivitySpec {
  switch (activity) {
    // Stage 5b: sequence engines assemble through their own function (no equation, no input ranges).
    case 'timeline-v1':
      return assembleTimelineSpec(gen as TimelineGeneratedSpec, opts);
    case 'forces-1d-v1':
    case 'projectile-v1':
    case 'lift-equation-v1':
    case 'speed-of-sound-v1':
    case 'compound-interest-v1':
    case 'hardy-weinberg-v1':
    case 'half-life-v1': {
      // ONE shared assembler for every numeric engine — the catalogue's ENGINES record
      // already keys by EngineId, so no per-engine dispatch can go stale here.
      const engine: EngineId = activity;
      return assembleSpec(gen as GeneratedSpecByEngine[typeof engine], engine, opts);
    }
    default: {
      // Compile-time exhaustiveness guard: unreachable while every ActivityId has a case.
      const missing: never = activity;
      throw new Error(`ENGINE_REQUIRED:${String(missing)}`);
    }
  }
}

/**
 * Stage 5/5b labelled demo fault: a deterministic, SYSTEM-MADE change to the generated
 * spec (never presented as a model error). Mutates the caller's clone of the
 * generated spec in place and returns the FaultRecord describing the change
 * (`effective` is set by the caller after re-validating revision 1, S5-04).
 *
 * Numeric engines (S5-04): a wrong-answer fault must DEMONSTRABLY fail behavior.tests, so the
 * alteration is bounded away from the engine result: injected = original +
 * max(1, 0.5*|original|, 10*maxTolerance(engine, computed)). The distance from
 * the engine result therefore exceeds any tolerance the schema allows for the
 * case — including negative originals (the old x*1.5+1 mapped -2 to itself) and
 * zero (mapped to 1). If adding would exceed the output's hard bound, the fault
 * subtracts the same delta instead; if BOTH directions leave the hard range (an
 * output range narrower than the delta, e.g. hardy-weinberg's 2pq ∈ [0, 0.5] —
 * S5B-05), it flips to the range bound farther from the engine value, which is
 * still beyond any allowed tolerance and stays schema-valid.
 *
 * timeline-v1 (Stage 5b): 'wrong-answer' swaps behavioralTests[0]'s
 * earlierEventId/laterEventId — the ordering answer code recomputes from the event dates, so
 * the swap demonstrably fails timeline.case-order (the record states both pair directions).
 * 'fabricated-quote' replaces the first event quote (simulation.events[0].evidence[0].quote)
 * instead of an explanation quote, tripping grounding.quotes (and the event's date grounding).
 *
 * For BOTH kinds on every activity, the fabricated quote carries a nonce whose
 * absence is checked with the validator's whitespace normalisation on BOTH
 * sides, so a source containing the sentence with an internal newline still
 * forces a re-derived nonce (Muse design review decision 18).
 */
export function applyDemoFault(
  kind: DemoFault,
  gen: AnyGeneratedSpec,
  activity: ActivityId,
  jobId: string,
  sourceText: string,
): FaultRecord {
  // Stage 5b: sequence-engine faults operate on events/ordering pairs, never on ENGINES metadata.
  if (isSequenceEngineId(activity)) {
    const timelineGen = gen as TimelineGeneratedSpec;
    if (kind === 'wrong-answer') {
      const first = Array.isArray(timelineGen.behavioralTests) ? timelineGen.behavioralTests[0] : undefined;
      if (
        first === undefined ||
        typeof first.earlierEventId !== 'string' ||
        first.earlierEventId === '' ||
        typeof first.laterEventId !== 'string' ||
        first.laterEventId === '' ||
        first.earlierEventId === first.laterEventId
      ) {
        throw new Error('DEMO_FAULT_TARGET_MISSING');
      }
      const earlier = first.earlierEventId;
      const later = first.laterEventId;
      first.earlierEventId = later;
      first.laterEventId = earlier;
      return {
        kind,
        path: 'behavioralTests[0]',
        original: `${earlier} -> ${later}`,
        injected: `${later} -> ${earlier}`,
        revision: 1,
      };
    }
    if (kind === 'fabricated-quote') {
      const evidence = Array.isArray(timelineGen.simulation?.events)
        ? timelineGen.simulation.events[0]?.evidence?.[0]
        : undefined;
      if (evidence === undefined || typeof evidence.quote !== 'string') {
        throw new Error('DEMO_FAULT_TARGET_MISSING');
      }
      const original = evidence.quote;
      const sentence = fabricatedQuoteWithNonce(jobId, sourceText);
      evidence.quote = sentence;
      return { kind, path: 'simulation.events[0].evidence[0].quote', original, injected: sentence, revision: 1 };
    }
    throw new Error('DEMO_FAULT_INVALID');
  }
  const engine: EngineId = activity;
  if (kind === 'wrong-answer') {
    const outputKey = ENGINES[engine].output.key;
    const tests = gen.behavioralTests as unknown as Record<string, unknown>[];
    const first = tests[0];
    if (first === undefined || typeof first[outputKey] !== 'number') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const original = first[outputKey] as number;
    let computed: number;
    try {
      computed = computeOutput(engine, first as Record<string, number>);
    } catch {
      computed = original; // a case the engine cannot run keeps the value-relative bound
    }
    const delta = Math.max(1, 0.5 * Math.abs(original), 10 * maxTolerance(engine, computed));
    const output = ENGINES[engine].output;
    let injected = original + delta;
    if (injected > output.hardMax || injected < output.hardMin) {
      injected = original - delta;
    }
    if (injected > output.hardMax || injected < output.hardMin) {
      // S5B-05: an output whose entire hard range is narrower than the delta (e.g.
      // hardy-weinberg's 2pq ∈ [0, 0.5]) cannot be pushed past a bound in EITHER
      // direction without failing schema.full instead of behavior.tests. Flip to the
      // bound FARTHER from the engine value: the distance is then at least half the
      // range width, which exceeds maxTolerance(engine, computed) for every catalogue
      // engine, so the fault demonstrably fails behavior.tests while staying a valid
      // number for the schema — and it can never equal the (correct) original.
      injected = computed - output.hardMin >= output.hardMax - computed ? output.hardMin : output.hardMax;
    }
    first[outputKey] = injected;
    return { kind, path: `behavioralTests[0].${outputKey}`, original, injected, revision: 1 };
  }
  if (kind === 'fabricated-quote') {
    const explanations = gen.explanations as unknown as { evidence?: { quote?: unknown }[] }[];
    const evidence = explanations[0]?.evidence?.[0];
    if (evidence === undefined || typeof evidence.quote !== 'string') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const original = evidence.quote;
    // S5-04: absence under the validator's normalisation, not raw includes().
    const sentence = fabricatedQuoteWithNonce(jobId, sourceText);
    evidence.quote = sentence;
    return { kind, path: 'explanations[0].evidence[0].quote', original, injected: sentence, revision: 1 };
  }
  throw new Error('DEMO_FAULT_INVALID');
}

/** The check a demo fault is designed to trip (S5-04 effectiveness is measured against it). */
function intendedCheckOf(kind: DemoFault, activity: ActivityId): 'behavior.tests' | 'timeline.case-order' | 'grounding.quotes' {
  if (kind === 'wrong-answer') {
    // Stage 5b: on a timeline the swapped ordering answer is caught by the recomputed case order.
    return isSequenceEngineId(activity) ? 'timeline.case-order' : 'behavior.tests';
  }
  return 'grounding.quotes';
}

export function startJob(
  sourceId: string,
  deps: JobDeps,
  onEvent?: (e: StageEvent) => void,
): { jobId: string; done: Promise<JobSummary> } {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error('SOURCE_ID_INVALID');
  }
  if (deps.demoFault !== undefined && !(DEMO_FAULTS as readonly string[]).includes(deps.demoFault)) {
    throw new Error('DEMO_FAULT_INVALID');
  }
  // S5-06: the absolute ≤2 repair bound fails closed at this boundary — an
  // invalid limit is never silently replaced with the default.
  const requestedRepairs: number | undefined = deps.limits?.maxRepairAttempts;
  if (
    requestedRepairs !== undefined &&
    !(Number.isInteger(requestedRepairs) && requestedRepairs >= 0 && requestedRepairs <= MAX_REPAIR_ATTEMPTS_BOUND)
  ) {
    throw new Error('MAX_REPAIR_ATTEMPTS_INVALID');
  }
  const now: () => Date = deps.now ?? ((): Date => new Date());
  const jobId: string =
    deps.newJobId?.() ??
    `job-${now()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const runDir: string = join(deps.storageDir, 'runs', jobId);
  mkdirSync(runDir, { recursive: true });

  // OW-2: the job's model identity comes from the client it will run on — the
  // server builds one client per job (meta-api or modal), so the summary, every
  // event and every receipt of this job carry the same explicit choice. A
  // client that predates OW-1 (e.g. older test fakes) declares none of the
  // fields; those jobs read as muse-spark-1.3/meta-api, exactly like stored
  // records from before this wave. There is no silent provider fallback: the
  // choice is whatever the injected client is.
  const clientModel: ModelChoice = isModelChoice(deps.client.model) ? deps.client.model : 'muse-spark-1.3';
  const clientProvider: MetaProvider = isMetaProvider(deps.client.provider) ? deps.client.provider : 'meta-api';
  const clientProviderModel: string =
    typeof deps.client.providerModel === 'string' && deps.client.providerModel !== ''
      ? deps.client.providerModel
      : clientModel;

  const createdAt: string = now().toISOString();
  // S6-W: the flow is recorded from the FIRST job.json write (frozen contract: the summary
  // carries `flow`; lesson jobs also carry `lesson` progress from the start). The worker's
  // own default stays 'activity' so pre-Stage-6 callers keep the unchanged v1 pipeline.
  const flow: JobFlow = isJobFlow(deps.flow) ? deps.flow : 'activity';
  const summary: JobSummary = {
    jobId,
    sourceId,
    status: 'running',
    purpose: deps.purpose,
    createdAt,
    flow,
    // OW-2: recorded from the FIRST job.json write, so even a crashed job says
    // which model/provider it was running on.
    model: clientModel,
    provider: clientProvider,
    providerModel: clientProviderModel,
    totalCostUSD: 0,
    reservedUnknownUSD: 0,
    // Stage 5: engine/revision/repair bookkeeping starts empty; sourceKind is derived from the id.
    engine: null,
    revisions: 0,
    repairs: [],
    // TASK-024b: analysis repair bookkeeping starts empty alongside spec repairs.
    analysisRepairs: [],
    sourceKind: USER_SOURCE_ID_PATTERN.test(sourceId) ? 'user' : 'library',
    // N-05: recovery consults this owner record before interrupting a running job.
    owner: { pid: process.pid, startedAt: createdAt },
  };
  if (flow === 'lesson') {
    summary.lesson = {
      overviewReady: false,
      componentsPlanned: 0,
      componentsPublished: 0,
      componentsFailed: 0,
      partialPublish: false,
    };
    // Frozen contract: the lesson detail always serves componentRepairs (empty is a value).
    summary.componentRepairs = [];
  }
  writeJsonAtomic(join(runDir, 'job.json'), summary);

  // R-11: one job-wide deadline plus per-stage output caps, wired from config.
  const budget = {
    signal: AbortSignal.timeout(positiveOr(deps.limits?.maxJobWallTimeMs, DEFAULT_JOB_WALL_TIME_MS)),
    analysisMaxOutputTokens: positiveOr(deps.limits?.analysisMaxOutputTokens, DEFAULT_ANALYSIS_MAX_OUTPUT_TOKENS),
    specMaxOutputTokens: positiveOr(deps.limits?.specMaxOutputTokens, DEFAULT_SPEC_MAX_OUTPUT_TOKENS),
  };

  // BUG-002: the stage in progress, so the last-resort catch can say where it broke.
  const progress: { stage: LessonStage } = { stage: 'ingest' };
  const done: Promise<JobSummary> = runJob(sourceId, jobId, runDir, deps, summary, now, budget, onEvent, progress).catch(
    (err: unknown): JobSummary => {
      // Last resort (F-01): runJob already finalises on expected failures, so
      // reaching here means an invariant or persistence itself broke. Never
      // reject, never persist raw exception text (R-01) — and never leave the
      // job persisted as 'running' after its promise settled: the terminal
      // state is written best-effort inside its own try/catch.
      const at = now().toISOString();
      const cause = sanitisedCause(err);
      // S5B-08/S5B-16 (R-01): stderr carries ONLY the job id, the stage and the same
      // fixed-vocabulary cause code — never the exception object, its message or its
      // stack, in any mode. Exception text can carry source or provider payloads, so
      // there is deliberately no opt-in raw debug branch; reproduce failures with tests.
      console.error(`[${jobId}] INTERNAL during ${progress.stage}: cause ${cause}`);
      // BUG-002/S5B-06: summary.totalCostUSD / reservedUnknownUSD are kept current by
      // runJob's single cost accumulator on EVERY charge path (receipts,
      // GeneratedOutputError receipts and MetaError chargedUSD alike), so billed calls
      // survive this path even when the failing write was the event append itself.
      summary.status = 'failed';
      summary.error = publicError('INTERNAL');
      summary.finishedAt = at;
      try {
        writeJsonAtomic(join(runDir, 'job.json'), summary);
      } catch {
        // job.json may be unwritable; still attempt the terminal event below
      }
      try {
        let seq = 0;
        try {
          for (const line of readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n')) {
            if (line.trim() !== '') {
              seq += 1;
            }
          }
        } catch {
          seq = 0; // no events file yet; the terminal event starts the sequence
        }
        const event: JobStageEvent = {
          jobId,
          seq,
          stage: 'done',
          status: 'failed',
          at,
          detail: `INTERNAL; during ${progress.stage}; cause ${cause}`,
          // OW-2: even the last-resort event records the job's model identity.
          model: summary.model,
          provider: summary.provider,
          providerModel: summary.providerModel,
        };
        appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
      } catch {
        // best effort: the persisted job.json above is the authoritative state
      }
      return summary;
    },
  );
  return { jobId, done };
}

async function runJob(
  sourceId: string,
  jobId: string,
  runDir: string,
  deps: JobDeps,
  summary: JobSummary,
  now: () => Date,
  budget: { signal: AbortSignal; analysisMaxOutputTokens: number; specMaxOutputTokens: number },
  onEvent?: (e: StageEvent) => void,
  progress: { stage: LessonStage } = { stage: 'ingest' },
): Promise<JobSummary> {
  let seq = 0;
  let totalCostUSD = 0;
  let reservedUnknownUSD = 0;

  function emit(stage: LessonStage, status: StageStatus, extra?: EventExtra): JobStageEvent {
    const event: JobStageEvent = { jobId, seq, stage, status, at: now().toISOString(), ...extra };
    // OW-2: EVERY event records the job's model (display id), provider and the
    // provider's exact model string — normalising over any receipt-derived
    // `model` in extra, which on Modal carries the raw provider string.
    event.model = summary.model;
    event.provider = summary.provider;
    event.providerModel = summary.providerModel;
    if (status === 'started') {
      progress.stage = stage;
    }
    seq += 1;
    appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    if (onEvent !== undefined) {
      try {
        // The public callback keeps the contracts' StageEvent type (v1 consumers unchanged);
        // the persisted/carried object is the additive JobStageEvent superset.
        onEvent(event as unknown as StageEvent);
      } catch {
        // A broken subscriber must not fail the job; the event is already persisted.
      }
    }
    return event;
  }

  function writeJob(): void {
    writeJsonAtomic(join(runDir, 'job.json'), summary);
  }

  /**
   * S5B-06: the ONE cost accumulator. Every charge or unknown-outcome amount —
   * success receipts, GeneratedOutputError receipts, MetaError chargedUSD/
   * reservedUnknownUSD, analysis-repair and spec-repair calls alike — passes through
   * here, and the in-memory summary is updated BEFORE any fallible event/artifact
   * write that follows, so even the last-resort INTERNAL path (e.g. a failing
   * events.jsonl append) persists job.json totals equal to the ledger's committed
   * spend whenever job.json itself is writable.
   *
   * R-09/N-04: a receipt charged at reservation is real money with an uncertain
   * outcome. The unknown portion is always the EXPLICIT reservedUnknownUSD amount —
   * never the whole charge inferred from the costBasis flag.
   */
  function account(chargedUSD: number, unknownUSD: number): void {
    totalCostUSD += chargedUSD;
    reservedUnknownUSD += unknownUSD;
    summary.totalCostUSD = roundCost(totalCostUSD);
    summary.reservedUnknownUSD = roundCost(reservedUnknownUSD);
  }

  function accountReceipt(receipt: MetaReceipt): void {
    account(receipt.estCostUSD, reservedUnknownOf(receipt.reservedUnknownUSD));
  }

  function finish(status: JobStatus): JobSummary {
    summary.status = status;
    summary.finishedAt = now().toISOString();
    summary.totalCostUSD = roundCost(totalCostUSD);
    summary.reservedUnknownUSD = roundCost(reservedUnknownUSD);
    writeJob();
    return summary;
  }

  function fail(stage: LessonStage, code: string, extra?: EventExtra): JobSummary {
    emit(stage, 'failed', extra);
    summary.error = publicError(code);
    return finish('failed');
  }

  function failFromError(stage: LessonStage, err: unknown, failExtra?: EventExtra): JobSummary {
    // F-01: a GeneratedOutputError means the provider call COMPLETED and the
    // ledger already reconciled it at receipt.estCostUSD. Account the receipt
    // exactly like a successful one (it was never accounted before the throw,
    // so this cannot double count), then fail through the normal persisted path.
    const outputReceipt = generatedOutputReceipt(err);
    if (outputReceipt !== undefined) {
      accountReceipt(outputReceipt);
      const extra: EventExtra = {
        ...failExtra,
        ...receiptFields(outputReceipt),
        // R-01: the failure detail is the fixed code — plus the cost-basis note.
        detail:
          outputReceipt.costBasis === 'reservation'
            ? 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)'
            : 'OUTPUT_INVALID',
      };
      return fail(stage, 'OUTPUT_INVALID', extra);
    }
    if (err instanceof MetaError) {
      // R-09: a MetaError thrown after a reservation carries chargedUSD/costBasis.
      const hasChargedUSD = typeof err.chargedUSD === 'number' && Number.isFinite(err.chargedUSD);
      const charged: number = hasChargedUSD
        ? (err.chargedUSD as number)
        : err.receipt !== undefined
          ? err.receipt.estCostUSD
          : 0;
      const basis: 'usage' | 'reservation' | undefined = err.costBasis ?? err.receipt?.costBasis;
      const reserved = basis === 'reservation';
      // N-04: the unknown-outcome part is the explicit reservedUnknownUSD amount
      // (on the error, else on its receipt) — never the whole charge inferred
      // from the costBasis flag. A missing amount counts as 0.
      const unknownPart =
        err.reservedUnknownUSD !== undefined
          ? reservedUnknownOf(err.reservedUnknownUSD)
          : reservedUnknownOf(err.receipt?.reservedUnknownUSD);
      // S5B-06: through the ONE accumulator — the summary is current BEFORE the
      // fail()/emit() below, so a failing event write can no longer leave the
      // last-resort path persisting stale zero totals over billed spend.
      account(charged, unknownPart);
      // S5-05: failExtra carries the attempted revision so EVERY repair failure
      // event (BAD_REQUEST, TIMEOUT, DEADLINE_EXCEEDED, BUDGET_EXCEEDED,
      // LEDGER_ERROR, INPUT_TOO_LARGE, ...) keeps its place in the timeline.
      const extra: EventExtra = {
        ...failExtra,
        // R-01: the failure detail is the fixed code — never err.message or provider text.
        detail: reserved ? `${err.code}; cost basis: reservation (outcome uncertain)` : `${err.code}`,
      };
      if (err.receipt !== undefined) {
        // A MetaError can carry a receipt for a call that was billed before it failed.
        Object.assign(extra, receiptFields(err.receipt));
      }
      if (hasChargedUSD || err.receipt !== undefined) {
        extra.estCostUSD = charged;
      }
      return fail(stage, err.code, extra);
    }
    return fail(stage, 'INTERNAL', { ...failExtra, detail: 'INTERNAL' });
  }

  // --- ingest -------------------------------------------------------------
  emit('ingest', 'started');
  let source: SourceDocument;
  try {
    source =
      summary.sourceKind === 'user'
        ? loadUserSource(sourceId, deps.userSourcesDir ?? userSourcesDirOf(deps.storageDir))
        : loadSource(sourceId, deps.sourcesDir);
  } catch {
    // R-01: the raw fs/loader error never reaches the artifacts. Hash mismatches
    // (tampered library or teacher text) land here too.
    return fail('ingest', 'SOURCE_UNAVAILABLE', { detail: 'SOURCE_UNAVAILABLE' });
  }
  emit('ingest', 'succeeded', { detail: `sha256 ${source.sha256.slice(0, 12)}` });

  // --- S6-W: lesson flow branch (frozen lesson-flow API contract) --------------
  // The whole lesson (analysis v2 + overview + plan, components at concurrency 2,
  // premium via the v1 adapter, partial publish) runs in workers/generation/lesson.ts
  // against THIS job's single cost accumulator, event writer and fixed-code failure
  // paths, so money and failure semantics stay identical to the v1 flow.
  if (summary.flow === 'lesson') {
    return runLesson({
      client: deps.client,
      source,
      jobId,
      runDir,
      purpose: deps.purpose,
      now,
      signal: budget.signal,
      specMaxOutputTokens: budget.specMaxOutputTokens,
      maxRepairAttempts: deps.limits?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS,
      demoFault: deps.demoFault,
      summary,
      emit,
      accountReceipt,
      // BUG-006: the lesson flow accounts MetaError-settled charges (OUTPUT_TRUNCATED)
      // through the SAME single accumulator as every receipt.
      account,
      writeJson: (fileName: string, data: unknown): void => {
        writeJsonAtomic(join(runDir, fileName), data);
      },
      writeJob,
      fail,
      failFromError,
      finish,
    });
  }

  // --- analyze --------------------------------------------------------------
  emit('analyze', 'started');
  let analysis: SourceAnalysis;
  let analysisReport: ValidationReport;
  let analysisReceipt: MetaReceipt;
  try {
    const result = await analyzeSource(deps.client, source, deps.purpose, {
      signal: budget.signal,
      maxOutputTokens: budget.analysisMaxOutputTokens,
    });
    analysis = result.analysis;
    analysisReport = result.report;
    analysisReceipt = result.receipt;
  } catch (err: unknown) {
    return failFromError('analyze', err);
  }
  accountReceipt(analysisReceipt);
  writeJsonAtomic(
    join(runDir, 'analysis.json'),
    { analysis, report: analysisReport, receipt: analysisReceipt },
  );
  // --- bounded analysis check-then-repair loop (TASK-024b) ---------------------
  // F-01 still holds: the report gates every read of the analysis, and no analysis
  // field is dereferenced on the failure paths below. The analysis repair budget is
  // separate from the spec repair budget (each up to maxRepairAttempts).
  // S5-06: startJob already refused any maxRepairAttempts outside integer [0, MAX_REPAIR_ATTEMPTS_BOUND].
  const maxAnalysisRepairs = deps.limits?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  // S5-01 for analyses: the IMMUTABLE revision-1 analysis — attempt 2 is compared
  // with it, never with the rejected attempt 1.
  const analysisR1: { analysis: SourceAnalysis; report: ValidationReport } = { analysis, report: analysisReport };
  let curAnalysis: SourceAnalysis = analysis;
  let curAnalysisReport: ValidationReport = analysisReport;
  let curAnalysisReceipt: MetaReceipt = analysisReceipt;
  let analysisAttemptsDone = 0;
  while (!curAnalysisReport.publishable && analysisAttemptsDone < maxAnalysisRepairs) {
    const attempt = analysisAttemptsDone + 1;
    const nextRevision = attempt + 1; // repairAnalysis numbers its report attempt + 1
    const targeted = failedCheckIds(curAnalysisReport);
    emit('repair', 'started', {
      target: 'analysis',
      revision: nextRevision,
      detail: `analysis repair ${attempt}; targeted checks: ${targeted.join(', ')}`,
    });
    if (attempt === 1) {
      // The first attempt also persists the immutable revision-1 baseline with its report.
      writeJsonAtomic(join(runDir, 'analysis.r1.json'), {
        analysis: analysisR1.analysis,
        report: analysisR1.report,
        receipt: analysisReceipt,
      });
    }
    let repairedAnalysis: { analysis: SourceAnalysis; report: ValidationReport; receipt: MetaReceipt };
    try {
      repairedAnalysis = await repairAnalysis(
        deps.client,
        source,
        attempt === 1
          ? { analysis: analysisR1.analysis, report: analysisR1.report, attempt: 1 }
          : {
              analysis: curAnalysis,
              report: curAnalysisReport,
              attempt: 2,
              // S5-01: compare with revision 1, never with the rejected previous attempt.
              baseline: { analysis: analysisR1.analysis, report: analysisR1.report },
            },
        deps.purpose,
        // R-11: the job-wide deadline and the analysis output cap cover analysis repairs too.
        { signal: budget.signal, maxOutputTokens: budget.analysisMaxOutputTokens },
      );
    } catch (err: unknown) {
      // F-01/S5-05: a GeneratedOutputError (billed call, schema-invalid output) or any
      // MetaError fails the job through the normal persisted path with its fixed code,
      // the accounted receipt and the attempted revision on the event.
      return failFromError('repair', err, { revision: nextRevision, target: 'analysis' });
    }
    accountReceipt(repairedAnalysis.receipt);
    analysisAttemptsDone += 1;
    const passingIds = new Set(repairedAnalysis.report.checks.filter(c => c.passed).map(c => c.id));
    const remaining = failedCheckIds(repairedAnalysis.report);
    const analysisRecord: AnalysisRepairRecord = {
      attempt,
      revision: nextRevision,
      targeted,
      fixed: targeted.filter(id => passingIds.has(id)),
      remaining,
      passed: repairedAnalysis.report.publishable,
    };
    (summary.analysisRepairs ??= []).push(analysisRecord);
    curAnalysis = repairedAnalysis.analysis;
    curAnalysisReport = repairedAnalysis.report;
    curAnalysisReceipt = repairedAnalysis.receipt;
    writeJsonAtomic(join(runDir, `analysis.r${nextRevision}.json`), {
      analysis: curAnalysis,
      report: curAnalysisReport,
      receipt: curAnalysisReceipt,
    });
    // R-01: the detail carries system-owned failing check ids, never model or exception text.
    emit('repair', 'succeeded', {
      target: 'analysis',
      ...receiptFields(curAnalysisReceipt),
      revision: nextRevision,
      detail: curAnalysisReport.publishable
        ? `analysis repair ${attempt} passed; ${checksPassed(curAnalysisReport)}/${curAnalysisReport.checks.length} checks passed`
        : `analysis repair ${attempt} still failing checks: ${remaining.join(', ')}`,
    });
  }
  if (!curAnalysisReport.publishable) {
    // F-01: the job fails with the fixed ANALYSIS_INVALID detail — no analysis field is
    // dereferenced for it. The event carries the last analysis call's receipt.
    return fail('analyze', 'ANALYSIS_INVALID', {
      ...receiptFields(curAnalysisReceipt),
      detail: 'ANALYSIS_INVALID',
    });
  }
  if (analysisAttemptsDone > 0) {
    // The repaired analysis becomes the analysis of record; revision 1 stays in analysis.r1.json.
    analysis = curAnalysis;
    analysisReport = curAnalysisReport;
    writeJsonAtomic(join(runDir, 'analysis.json'), {
      analysis: curAnalysis,
      report: curAnalysisReport,
      receipt: curAnalysisReceipt,
    });
  }
  const analysisDetail = `${
    analysis.supported ? 'supported' : `unsupported: ${analysis.unsupportedReason}`
  }; checks ${checksPassed(analysisReport)}/${analysisReport.checks.length} passed`;
  emit('analyze', 'succeeded', { ...receiptFields(analysisReceipt), detail: analysisDetail });
  if (!analysis.supported) {
    emit('done', 'succeeded', { detail: 'unsupported' });
    return finish('unsupported');
  }

  // Defensive (Stage 5/5b): a supported analysis without a known activity becomes
  // ANALYSIS_INVALID before any model call. Normally unreachable — validateAnalysis
  // already fails supported=true with an activity that is not a known activity id.
  if (!isActivityId(analysis.activity)) {
    return fail('specify', 'ANALYSIS_INVALID', { detail: 'ANALYSIS_INVALID' });
  }
  const activity: ActivityId = analysis.activity;
  summary.engine = activity;

  // --- specify (revision 1) ---------------------------------------------------
  emit('specify', 'started');
  const specId = `${sourceId}-${jobId}`.slice(0, 64);
  let specResult: PipelineResult;
  try {
    // Stage 5b: a timeline analysis selects the pipeline's timeline overload; numeric
    // analyses keep the legacy overload. packages/meta is Muse-authored, so the worker
    // narrows the analysis type at the call site instead of the pipeline changing.
    specResult = isSequenceEngineId(activity)
      ? await generateSpec(
          deps.client,
          source,
          analysis as TimelineSourceAnalysis,
          { jobId, specId },
          deps.purpose,
          now,
          { signal: budget.signal, maxOutputTokens: budget.specMaxOutputTokens },
        )
      : await generateSpec(
          deps.client,
          source,
          analysis,
          { jobId, specId },
          deps.purpose,
          now,
          { signal: budget.signal, maxOutputTokens: budget.specMaxOutputTokens },
        );
  } catch (err: unknown) {
    if (isEngineRequired(err)) {
      // Defensive: the pipeline guard fired before any model call — the same fixed
      // code as an invalid analysis, never INTERNAL.
      return fail('specify', 'ANALYSIS_INVALID', { detail: 'ANALYSIS_INVALID' });
    }
    return failFromError('specify', err);
  }
  accountReceipt(specResult.receipt);

  // --- inject (optional labelled demo fault, Stage 5) --------------------------
  // A SYSTEM-made change to the generated spec BEFORE validation, so judges can
  // watch catch → repair → pass on demand. Always labelled, never a model error;
  // the fault is applied to a clone so stored fixtures/evidence are never touched.
  let generated: AnyGeneratedSpec = specResult.generated;
  let spec: AnyActivitySpec = specResult.spec;
  let report: ValidationReport = specResult.report;
  if (deps.demoFault !== undefined) {
    const faultyGen = structuredClone(generated) as AnyGeneratedSpec;
    const fault = applyDemoFault(deps.demoFault, faultyGen, activity, jobId, source.text);
    // Re-assemble with the SAME provenance so spec.r1.json reflects the fault.
    spec = assembleForActivity(faultyGen, activity, {
      id: specId,
      sources: [source],
      provenance: specResult.spec.provenance,
      execution: specResult.spec.execution,
    });
    generated = faultyGen;
    report = validateSpec(spec, [source]);
    // S5-04: the fault only counts as a demonstrated catch when re-validating
    // revision 1 actually failed the intended check.
    fault.effective = failedCheckIds(report).includes(intendedCheckOf(deps.demoFault, activity));
    summary.demoFault = fault;
  }
  writeJsonAtomic(join(runDir, 'spec.r1.json'), spec);
  emit('specify', 'succeeded', {
    ...receiptFields(specResult.receipt),
    detail: `spec ${specId}`,
  });
  if (summary.demoFault !== undefined) {
    const fault = summary.demoFault;
    emit('inject', 'succeeded', {
      revision: 1,
      // S5-04: an ineffective injection is reported honestly — never as a catch.
      detail:
        fault.effective === false
          ? `demo fault injected by the system but NOT caught by ${intendedCheckOf(fault.kind, activity)}: ${fault.kind} at ${fault.path}`
          : `demo fault injected by the system: ${fault.kind} at ${fault.path}`,
    });
  }

  // --- validate + bounded repair loop (Stage 5) --------------------------------
  interface RevisionState {
    revision: number;
    generated: AnyGeneratedSpec;
    spec: AnyActivitySpec;
    report: ValidationReport;
  }
  const revisions: RevisionState[] = [{ revision: 1, generated, spec, report }];
  let current: RevisionState = revisions[0];
  summary.revisions = 1;
  // S5-06: startJob already refused anything but an integer in [0, MAX_REPAIR_ATTEMPTS_BOUND].
  const maxRepairs = deps.limits?.maxRepairAttempts ?? DEFAULT_MAX_REPAIR_ATTEMPTS;
  // S5-01: the IMMUTABLE baseline — every repair is compared with revision 1
  // (including an injected demo fault), never with the previous revision, so a
  // rejected weakening can never become the next baseline and be laundered by
  // repeating it.
  const baseline: { spec: AnyActivitySpec; failedIds: string[] } = {
    spec: revisions[0].spec,
    failedIds: failedCheckIds(revisions[0].report),
  };
  const findingsHistory: RepairFinding[][] = [];

  function emitValidateOutcome(state: RevisionState): void {
    const passed = checksPassed(state.report);
    const total = state.report.checks.length;
    if (state.report.publishable) {
      emit('validate', 'succeeded', { revision: state.revision, detail: `${passed}/${total} checks passed` });
    } else {
      // R-01: the failure detail is the code plus system-owned failing check ids.
      emit('validate', 'failed', {
        revision: state.revision,
        detail: `VALIDATION_FAILED; failed checks: ${failedCheckIds(state.report).join(', ')}`,
      });
    }
  }

  emit('validate', 'started', { revision: 1 });
  writeJsonAtomic(join(runDir, 'report.r1.json'), report);
  emitValidateOutcome(current);

  let repairsDone = 0;
  while (!current.report.publishable && repairsDone < maxRepairs) {
    const nextRevision = current.revision + 1;
    const targeted = failedCheckIds(current.report);
    emit('repair', 'started', {
      revision: nextRevision,
      detail: `targeted checks: ${targeted.join(', ')}`,
    });
    // Decision 14: every prior revision's findings re-enter the repair prompt.
    findingsHistory.push(repairFindings(current.report, current.spec));
    let repaired: PipelineResult;
    try {
      // Stage 5b: the same overload narrowing as the specify call — a timeline analysis
      // repairs through the timeline overload (packages/meta stays untouched).
      repaired = isSequenceEngineId(activity)
        ? await repairSpec(
            deps.client,
            source,
            analysis as TimelineSourceAnalysis,
            {
              generated: current.generated as TimelineGeneratedSpec,
              spec: current.spec as TimelineActivitySpec,
              report: current.report,
              revision: current.revision,
              findingsHistory,
              // S5-01: compare against revision 1's obligations, not the last revision.
              baseline: { spec: baseline.spec as TimelineActivitySpec, failedIds: baseline.failedIds },
            },
            { jobId, specId },
            deps.purpose,
            now,
            // R-11: the job-wide deadline and the spec output cap cover repairs too.
            { signal: budget.signal, maxOutputTokens: budget.specMaxOutputTokens },
          )
        : await repairSpec(
            deps.client,
            source,
            analysis,
            {
              generated: current.generated as GeneratedSpec,
              spec: current.spec as ActivitySpec,
              report: current.report,
              revision: current.revision,
              findingsHistory,
              // S5-01: compare against revision 1's obligations, not the last revision.
              baseline: { spec: baseline.spec as ActivitySpec, failedIds: baseline.failedIds },
            },
            { jobId, specId },
            deps.purpose,
            now,
            // R-11: the job-wide deadline and the spec output cap cover repairs too.
            { signal: budget.signal, maxOutputTokens: budget.specMaxOutputTokens },
          );
    } catch (err: unknown) {
      const outputReceipt = generatedOutputReceipt(err);
      if (outputReceipt !== undefined) {
        // F-01: the repair call COMPLETED and was billed. Account the receipt,
        // record the failed repair and STOP repairing; the job then fails
        // VALIDATION_FAILED below (no earlier revision can be publishable here —
        // the loop only runs while the current one is not).
        accountReceipt(outputReceipt);
        emit('repair', 'failed', {
          ...receiptFields(outputReceipt),
          revision: nextRevision,
          detail:
            outputReceipt.costBasis === 'reservation'
              ? 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)'
              : 'OUTPUT_INVALID',
        });
        break;
      }
      if (isEngineRequired(err)) {
        return fail('repair', 'ANALYSIS_INVALID', { detail: 'ANALYSIS_INVALID', revision: nextRevision });
      }
      // MetaError (bad request, deadline, budget refusal, ...) fails the job with
      // its fixed code — and S5-05: the event carries the attempted revision.
      return failFromError('repair', err, { revision: nextRevision });
    }
    accountReceipt(repaired.receipt);
    repairsDone += 1;
    current = {
      revision: nextRevision,
      generated: repaired.generated,
      spec: repaired.spec,
      // The pipeline's repair report already carries the 'repair.no-weakening' check.
      report: repaired.report,
    };
    revisions.push(current);
    summary.revisions = revisions.length;
    writeJsonAtomic(join(runDir, `spec.r${nextRevision}.json`), current.spec);
    emit('repair', 'succeeded', {
      ...receiptFields(repaired.receipt),
      revision: nextRevision,
      detail: `repaired revision ${nextRevision - 1}`,
    });
    const remaining = failedCheckIds(current.report);
    const passingIds = new Set(current.report.checks.filter(c => c.passed).map(c => c.id));
    const record: RepairRecord = {
      revision: nextRevision,
      repairOf: nextRevision - 1,
      targeted,
      fixed: targeted.filter(id => passingIds.has(id)),
      remaining,
      publishable: current.report.publishable,
      // Decision 17: repairs after a system-injected fault never count in quality metrics.
      afterInjectedFault: summary.demoFault !== undefined,
    };
    summary.repairs.push(record);
    writeJsonAtomic(join(runDir, `report.r${nextRevision}.json`), current.report);
    emit('validate', 'started', { revision: nextRevision });
    emitValidateOutcome(current);
  }

  // --- done -----------------------------------------------------------------
  if (current.report.publishable) {
    emit('done', 'succeeded', {
      detail:
        current.revision === 1
          ? 'publishable'
          : `publishable after repair (revision ${current.revision})`,
    });
    summary.specId = specId;
    summary.publishable = true;
    summary.checksPassed = checksPassed(current.report);
    summary.checksTotal = current.report.checks.length;
    summary.publishedRevision = current.revision;
    return finish('succeeded');
  }
  // No publishable revision (decision 14): the job reports the revision with the
  // fewest failing checks; ties resolve to the earliest revision. The terminal
  // marker is the last per-revision 'validate' failed event — a failed job never
  // emits 'done'.
  let best: RevisionState = revisions[0];
  for (const candidate of revisions) {
    if (failedCheckIds(candidate.report).length < failedCheckIds(best.report).length) {
      best = candidate;
    }
  }
  summary.bestRevision = best.revision;
  summary.checksPassed = checksPassed(best.report);
  summary.checksTotal = best.report.checks.length;
  summary.error = publicError('VALIDATION_FAILED');
  return finish('failed');
}

/**
 * OW-2 read-path normalisation: a stored job summary from before this wave (or
 * one with corrupt/unknown values) reads as muse-spark-1.3/meta-api, with the
 * provider model string defaulting to the display id — the only model that ever
 * ran before OW-2. Never invents a modal identity for an old record.
 * S6-W: the same rule fills the legacy `flow` default — a record from before
 * Stage 6 (or with a corrupt flow value) reads as 'activity', the only pipeline
 * that ever ran before the lesson flow.
 */
export function withModelDefaults(summary: JobSummary): JobSummary {
  const model: ModelChoice = isModelChoice(summary.model) ? summary.model : 'muse-spark-1.3';
  const provider: MetaProvider = isMetaProvider(summary.provider) ? summary.provider : 'meta-api';
  const providerModel: string =
    typeof summary.providerModel === 'string' && summary.providerModel !== '' ? summary.providerModel : model;
  const flow: JobFlow = isJobFlow(summary.flow) ? summary.flow : 'activity';
  return { ...summary, model, provider, providerModel, flow };
}

export function listJobs(storageDir: string): JobSummary[] {
  let entries;
  try {
    entries = readdirSync(join(storageDir, 'runs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs: JobSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const parsed = readJsonFile(join(storageDir, 'runs', entry.name, 'job.json'));
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
      continue; // skip unreadable or incomplete run dirs
    }
    const candidate = parsed as { jobId?: unknown };
    if (typeof candidate.jobId !== 'string') {
      continue;
    }
    // OW-2: legacy records without model/provider read with the defaults.
    jobs.push(withModelDefaults(parsed as JobSummary));
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  return jobs;
}

export interface JobRevisionView {
  revision: number;
  spec: unknown;
  report?: unknown;
}

/** One persisted analysis revision (TASK-024b): present only when an analysis repair was attempted. */
export interface JobAnalysisRevisionView {
  /** 1 = the immutable original analysis; n > 1 = the result of analysis repair attempt n-1. */
  revision: number;
  analysis: unknown;
  report?: unknown;
  receipt?: unknown;
}

/** One persisted analysis-v2 revision (S6-W lesson flow): {revision, analysis, report}. */
export interface JobAnalysisV2RevisionView {
  revision: number;
  analysis: unknown;
  report?: unknown;
}

export function readJob(
  storageDir: string,
  jobId: string,
): {
  summary: JobSummary;
  events: StageEvent[];
  analysis?: unknown;
  spec?: unknown;
  report?: unknown;
  /** Stage 5: every persisted revision in order, so the UI can show 1 → 2 → 3. */
  revisions: JobRevisionView[];
  /** TASK-024b: every persisted analysis revision in order; empty without analysis repairs. */
  analysisRevisions: JobAnalysisRevisionView[];
  /**
   * S6-W (frozen lesson-flow API contract) — lesson jobs only; every field absent for
   * 'activity'/legacy jobs so their detail response is byte-identical to before:
   *   analysisV2         the analysis of record, or null when it never became publishable
   *   analysisV2Report   the latest analysis-v2 report
   *   analysisV2Revisions every persisted analysis-v2 revision in order
   *   lesson             the stored LessonSpec (overview + settled components), or null
   *   kitSpecs           PASSED kit specs only, keyed by spec id (never unverified content)
   *   componentReports   the latest validation report per component, keyed by spec id
   *   componentRepairs   one record per component repair attempt, in order
   */
  analysisV2?: SourceAnalysisV2 | null;
  analysisV2Report?: unknown;
  analysisV2Revisions?: JobAnalysisV2RevisionView[];
  lesson?: unknown;
  kitSpecs?: Record<string, KitSpec>;
  componentReports?: Record<string, ValidationReport>;
  componentRepairs?: ComponentRepairRecord[];
} | null {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error('JOB_ID_INVALID');
  }
  const runDir = join(storageDir, 'runs', jobId);
  const summary = readJsonFile(join(runDir, 'job.json'));
  if (summary === undefined || typeof summary !== 'object' || summary === null) {
    return null;
  }
  const events: StageEvent[] = [];
  try {
    const text = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') {
        continue;
      }
      try {
        events.push(JSON.parse(line) as StageEvent);
      } catch {
        // skip a malformed line; the rest of the stream stays readable
      }
    }
  } catch {
    // no events file (yet)
  }
  const result: {
    summary: JobSummary;
    events: StageEvent[];
    analysis?: unknown;
    spec?: unknown;
    report?: unknown;
    revisions: JobRevisionView[];
    analysisRevisions: JobAnalysisRevisionView[];
    analysisV2?: SourceAnalysisV2 | null;
    analysisV2Report?: unknown;
    analysisV2Revisions?: JobAnalysisV2RevisionView[];
    lesson?: unknown;
    kitSpecs?: Record<string, KitSpec>;
    componentReports?: Record<string, ValidationReport>;
    componentRepairs?: ComponentRepairRecord[];
  } = {
    // OW-2: legacy records without model/provider read with the defaults.
    summary: withModelDefaults(summary as JobSummary),
    events,
    revisions: [],
    analysisRevisions: [],
  };
  const analysis = readJsonFile(join(runDir, 'analysis.json'));
  if (analysis !== undefined) {
    result.analysis = analysis;
  }
  // TASK-024b: every persisted analysis revision (analysis.r<n>.json exists only
  // when the analysis repair loop ran; r1 is the immutable original).
  let analysisNumbers: number[] = [];
  try {
    analysisNumbers = readdirSync(runDir)
      .map(f => /^analysis\.r(\d+)\.json$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);
  } catch {
    analysisNumbers = [];
  }
  for (const n of analysisNumbers) {
    const file = readJsonFile(join(runDir, `analysis.r${n}.json`));
    if (file === undefined || typeof file !== 'object' || file === null) {
      continue;
    }
    const rec = file as { analysis?: unknown; report?: unknown; receipt?: unknown };
    const entry: JobAnalysisRevisionView = { revision: n, analysis: rec.analysis };
    if (rec.report !== undefined) {
      entry.report = rec.report;
    }
    if (rec.receipt !== undefined) {
      entry.receipt = rec.receipt;
    }
    result.analysisRevisions.push(entry);
  }
  // S6-W (frozen lesson-flow contract): the lesson detail fields, for lesson jobs only.
  if (result.summary.flow === 'lesson') {
    // analysis-v2.r<n>.json → analysisV2Revisions; the LATEST revision is the analysis of
    // record, served as analysisV2 only when it is publishable (null on an unrepairable
    // analysis, so the detail never serves an unchecked analysis as the record).
    let analysisV2Numbers: number[] = [];
    try {
      analysisV2Numbers = readdirSync(runDir)
        .map(f => /^analysis-v2\.r(\d+)\.json$/.exec(f))
        .filter((m): m is RegExpExecArray => m !== null)
        .map(m => Number(m[1]))
        .sort((a, b) => a - b);
    } catch {
      analysisV2Numbers = [];
    }
    const v2Revisions: JobAnalysisV2RevisionView[] = [];
    let latestV2: { analysis: unknown; report: unknown } | undefined;
    for (const n of analysisV2Numbers) {
      const file = readJsonFile(join(runDir, `analysis-v2.r${n}.json`));
      if (file === undefined || typeof file !== 'object' || file === null) {
        continue;
      }
      const rec = file as { analysis?: unknown; report?: unknown };
      v2Revisions.push({ revision: n, analysis: rec.analysis, report: rec.report });
      latestV2 = { analysis: rec.analysis, report: rec.report };
    }
    result.analysisV2Revisions = v2Revisions;
    const latestReport = latestV2?.report as ValidationReport | undefined;
    result.analysisV2Report = latestV2?.report;
    result.analysisV2 =
      latestV2 !== undefined && latestReport !== undefined && latestReport.publishable === true
        ? (latestV2.analysis as SourceAnalysisV2)
        : null;
    // lesson.json — the stored LessonSpec (overview + settled components), or null.
    result.lesson = readJsonFile(join(runDir, 'lesson.json')) ?? null;
    // kitSpecs (PASSED specs only) + componentReports (latest revision per component).
    const kitSpecs: Record<string, KitSpec> = {};
    const componentReports: Record<string, ValidationReport> = {};
    const lessonSpec = result.lesson as { components?: { componentId?: unknown; specId?: unknown; status?: unknown; revision?: unknown }[] } | null;
    const entries = Array.isArray(lessonSpec?.components) ? (lessonSpec?.components ?? []) : [];
    for (const entry of entries) {
      const cid: unknown = entry?.componentId;
      if (!isKitGenComponentId(cid)) {
        continue;
      }
      // Latest persisted revision of this component → componentReports.
      let numbers: number[] = [];
      try {
        numbers = readdirSync(runDir)
          .map(f => new RegExp(`^${cid}\\.r(\\d+)\\.json$`).exec(f))
          .filter((m): m is RegExpExecArray => m !== null)
          .map(m => Number(m[1]))
          .sort((a, b) => a - b);
      } catch {
        numbers = [];
      }
      const latestN = numbers[numbers.length - 1];
      if (latestN !== undefined) {
        const rec = readJsonFile(join(runDir, `${cid}.r${latestN}.json`)) as
          | { gen?: unknown; spec?: unknown; report?: unknown; receipt?: unknown }
          | undefined;
        const specId = kitSpecId(jobId, cid, latestN);
        if (rec !== undefined && rec.report !== undefined) {
          componentReports[specId] = rec.report as ValidationReport;
        }
      }
      // Passed kit components → kitSpecs under their entry spec id (never unverified content).
      if (entry?.status === 'passed' && typeof entry?.specId === 'string' && typeof entry?.revision === 'number') {
        const rec = readJsonFile(join(runDir, `${cid}.r${entry.revision}.json`)) as { spec?: unknown } | undefined;
        const spec = rec?.spec as KitSpec | undefined;
        if (spec !== undefined && spec.componentId === cid && spec.id === entry.specId) {
          kitSpecs[entry.specId] = spec;
        }
      }
    }
    result.kitSpecs = kitSpecs;
    result.componentReports = componentReports;
    result.componentRepairs = result.summary.componentRepairs ?? [];
  }
  // Every persisted revision: spec.r<n>.json (+ report.r<n>.json when present).
  let specNumbers: number[] = [];
  try {
    specNumbers = readdirSync(runDir)
      .map(f => /^spec\.r(\d+)\.json$/.exec(f))
      .filter((m): m is RegExpExecArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);
  } catch {
    specNumbers = [];
  }
  for (const n of specNumbers) {
    const specN = readJsonFile(join(runDir, `spec.r${n}.json`));
    if (specN === undefined) {
      continue;
    }
    const entry: JobRevisionView = { revision: n, spec: specN };
    const reportN = readJsonFile(join(runDir, `report.r${n}.json`));
    if (reportN !== undefined) {
      entry.report = reportN;
    }
    result.revisions.push(entry);
  }
  // Compatibility fields: spec/report of the published (else best, else latest) revision.
  const s = summary as JobSummary;
  const chosen: number =
    (typeof s.publishedRevision === 'number' ? s.publishedRevision : undefined) ??
    (typeof s.bestRevision === 'number' ? s.bestRevision : undefined) ??
    (result.revisions.length > 0 ? result.revisions[result.revisions.length - 1].revision : 1);
  const chosenEntry =
    result.revisions.find(r => r.revision === chosen) ?? result.revisions[0];
  if (chosenEntry !== undefined) {
    result.spec = chosenEntry.spec;
    if (chosenEntry.report !== undefined) {
      result.report = chosenEntry.report;
    }
  }
  return result;
}

/** N-05 recovery knobs; both optional with conservative defaults. */
export interface RecoveryOptions {
  /**
   * An ownerless 'running' job is interrupted only when its recorded start is
   * older than this. Default 120000 (config/resource-limits.json maxJobWallTimeMs).
   */
  maxJobWallTimeMs?: number;
  /**
   * PID liveness probe. Default: `process.kill(pid, 0)` — success or EPERM (or
   * any non-ESRCH error) counts as alive; only ESRCH counts as dead.
   */
  isAlive?: (pid: number) => boolean;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process — dead. EPERM and anything else: fail conservative — alive.
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** The owner pid when the record carries a usable one; undefined for legacy/corrupt owners. */
function ownerPidOf(summary: JobSummary): number | undefined {
  const owner: unknown = summary.owner;
  if (typeof owner !== 'object' || owner === null) {
    return undefined;
  }
  const pid: unknown = (owner as { pid?: unknown }).pid;
  return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** owner.startedAt when parseable, else createdAt; NaN when neither parses. */
function startedMsOf(summary: JobSummary): number {
  const owner: unknown = summary.owner;
  const candidates: unknown[] = [];
  if (typeof owner === 'object' && owner !== null) {
    candidates.push((owner as { startedAt?: unknown }).startedAt);
  }
  candidates.push(summary.createdAt);
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const ms = Date.parse(candidate);
      if (Number.isFinite(ms)) {
        return ms;
      }
    }
  }
  return Number.NaN;
}

/**
 * N-05: a 'running' job is abandoned only when its recorded owner process is
 * provably gone (never when the owner is this process), or — for legacy records
 * with no usable owner — when it has been running longer than maxJobWallTimeMs.
 * An unparseable start time is treated as young: leave the job alone.
 */
function isAbandoned(
  summary: JobSummary,
  nowMs: number,
  maxJobWallTimeMs: number,
  isAlive: (pid: number) => boolean,
): boolean {
  const pid = ownerPidOf(summary);
  if (pid !== undefined) {
    if (pid === process.pid) {
      return false; // never interrupt this process's own active job
    }
    return !isAlive(pid);
  }
  const startedMs = startedMsOf(summary);
  if (!Number.isFinite(startedMs)) {
    return false;
  }
  return nowMs - startedMs > maxJobWallTimeMs;
}

/**
 * R-10/N-05 startup recovery: a job still marked 'running' becomes 'failed'
 * with the fixed INTERRUPTED error ONLY when its owner process is dead (or, for
 * legacy records without an owner, when the job is older than maxJobWallTimeMs).
 * Jobs of live owners — including this process — are never touched, so an
 * offline/second startup sharing the storage directory cannot corrupt active
 * work. A 'done'/'failed' event is appended, and already-accounted costs and
 * unknown reservations are kept as they are — nothing is refunded here.
 * Returns the recovered job ids.
 */
export function recoverInterruptedJobs(
  storageDir: string,
  now: () => Date = () => new Date(),
  opts: RecoveryOptions = {},
): string[] {
  const maxJobWallTimeMs = positiveOr(opts.maxJobWallTimeMs, DEFAULT_JOB_WALL_TIME_MS);
  const isAlive = opts.isAlive ?? defaultIsAlive;
  let entries;
  try {
    entries = readdirSync(join(storageDir, 'runs'), { withFileTypes: true });
  } catch {
    return [];
  }
  const recovered: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runDir = join(storageDir, 'runs', entry.name);
    const parsed = readJsonFile(join(runDir, 'job.json'));
    if (parsed === undefined || typeof parsed !== 'object' || parsed === null) {
      continue;
    }
    const summary = parsed as JobSummary;
    if (typeof summary.jobId !== 'string' || summary.status !== 'running') {
      continue;
    }
    const at = now().toISOString();
    // N-05: recover only provably abandoned jobs.
    if (!isAbandoned(summary, Date.parse(at), maxJobWallTimeMs, isAlive)) {
      continue;
    }
    let seq = 0;
    try {
      for (const line of readFileSync(join(runDir, 'events.jsonl'), 'utf8').split('\n')) {
        if (line.trim() !== '') {
          seq += 1;
        }
      }
    } catch {
      seq = 0; // no events file yet; the recovery event starts the sequence
    }
    // OW-2: the recovery event states the model identity too; a legacy record
    // reads with the muse-spark-1.3/meta-api defaults (the file is not rewritten).
    const modelView = withModelDefaults(summary);
    const event: JobStageEvent = {
      jobId: summary.jobId,
      seq,
      stage: 'done',
      status: 'failed',
      at,
      detail: 'INTERRUPTED',
      model: modelView.model,
      provider: modelView.provider,
      providerModel: modelView.providerModel,
    };
    appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    summary.status = 'failed';
    summary.error = publicError('INTERRUPTED');
    summary.finishedAt = at;
    writeJsonAtomic(join(runDir, 'job.json'), summary);
    recovered.push(summary.jobId);
  }
  return recovered.sort();
}
