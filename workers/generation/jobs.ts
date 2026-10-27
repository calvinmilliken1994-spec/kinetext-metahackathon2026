// TASK-005 — bounded generation worker: ingest → analyze → specify → validate → done.
//
// One job per call of startJob(). The stage machine persists everything under
// `${storageDir}/runs/<jobId>/`:
//   job.json        — JobSummary, written synchronously at start ('running') and rewritten at the end;
//                     carries owner {pid, startedAt} so recovery never interrupts a live owner (TASK-009 N-05)
//   events.jsonl    — one StageEvent per line, appended as stages progress (seq 0..n per job)
//   analysis.json   — {analysis, report, receipt} from analyzeSource
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

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeSource, generateSpec, repairSpec, GeneratedOutputError } from '../../packages/meta/pipeline.ts';
import { MetaError, META_ERROR_MESSAGES } from '../../packages/meta/client.ts';
import type { MetaClient, MetaErrorCode } from '../../packages/meta/client.ts';
import {
  loadSource,
  loadUserSource,
  sha256,
  userSourcesDirOf,
  USER_SOURCE_ID_PATTERN,
} from '../../packages/sources/index.ts';
import { repairFindings, validateSpec } from '../../packages/validation/validate.ts';
import { assembleSpec, DEMO_FAULTS, ENGINES, isEngineId } from '../../packages/contracts/index.ts';
import type {
  ActivitySpec,
  AssembleOptions,
  DemoFault,
  EngineId,
  FaultRecord,
  ForcesGeneratedSpec,
  GeneratedSpec,
  LiftGeneratedSpec,
  MetaReceipt,
  ProjectileGeneratedSpec,
  RepairFinding,
  RepairRecord,
  SoundGeneratedSpec,
  SourceAnalysis,
  SourceDocument,
  Stage,
  StageEvent,
  StageStatus,
  ValidationReport,
} from '../../packages/contracts/index.ts';

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
  /** Engine Muse chose for this source (Stage 5); null until a supported analysis is validated. */
  engine: EngineId | null;
  /** Number of spec revisions produced and persisted (1 without repairs). */
  revisions: number;
  /** One record per repair attempt, in order (Stage 5). */
  repairs: RepairRecord[];
  /** Set when any revision was publishable: the revision that gets published. */
  publishedRevision?: number;
  /** Set on VALIDATION_FAILED: the revision with the fewest failing checks. */
  bestRevision?: number;
  /** Set when the system injected a labelled demo fault into revision 1 (never a model error). */
  demoFault?: FaultRecord;
  /** Where the source came from: the licensed library or a teacher's pasted text. */
  sourceKind: 'library' | 'user';
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
  /** Stage 5: bound on Muse repair attempts after a failing validation (config maxRepairAttempts). */
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

type EventExtra = Partial<
  Pick<StageEvent, 'model' | 'responseId' | 'usage' | 'latencyMs' | 'estCostUSD' | 'detail' | 'revision'>
>;

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Like positiveOr but for counts that may legitimately be 0 (e.g. maxRepairAttempts). */
function nonNegativeIntOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** Money stays readable in job.json: rounded to 1e-6 USD. */
function roundCost(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * R-10: every JSON artifact is written atomically — a temp file in the same
 * directory, then rename — so a crash can never leave a half-written job.json.
 */
function writeJsonAtomic(path: string, data: unknown): void {
  const tmpPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

function receiptFields(receipt: MetaReceipt): EventExtra {
  return {
    model: receipt.returnedModel,
    responseId: receipt.responseId,
    usage: receipt.usage,
    latencyMs: receipt.latencyMs,
    estCostUSD: receipt.estCostUSD,
  };
}

function checksPassed(report: ValidationReport): number {
  return report.checks.filter(c => c.passed).length;
}

function failedCheckIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** N-04: the unknown-outcome portion is the explicit amount; a missing or invalid one counts as 0. */
function reservedUnknownOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * F-01: recognise the pipeline's GeneratedOutputError — via instanceof, or via
 * the duck-typed shape (code 'OUTPUT_INVALID' plus a receipt carrying a finite
 * estCostUSD) so a copy from another module instance is handled identically.
 * Returns the receipt whose cost must be accounted, or undefined.
 */
function generatedOutputReceipt(err: unknown): MetaReceipt | undefined {
  let receipt: unknown;
  if (err instanceof GeneratedOutputError) {
    receipt = err.receipt;
  } else if (typeof err === 'object' && err !== null) {
    const candidate = err as { code?: unknown; receipt?: unknown };
    if (candidate.code !== 'OUTPUT_INVALID') {
      return undefined;
    }
    receipt = candidate.receipt;
  } else {
    return undefined;
  }
  if (typeof receipt !== 'object' || receipt === null) {
    return undefined;
  }
  const est: unknown = (receipt as { estCostUSD?: unknown }).estCostUSD;
  return typeof est === 'number' && Number.isFinite(est) ? (receipt as MetaReceipt) : undefined;
}

/** True for the pipeline's plain ENGINE_REQUIRED/ENGINE_MISMATCH guard errors (thrown before any model call). */
function isEngineRequired(err: unknown): boolean {
  return err instanceof Error && err.message === 'ENGINE_REQUIRED';
}

/** assembleSpec with a runtime engine id (the typed overloads need the engine as a literal). */
function assembleForEngine(gen: GeneratedSpec, engine: EngineId, opts: AssembleOptions): ActivitySpec {
  switch (engine) {
    case 'forces-1d-v1':
      return assembleSpec(gen as ForcesGeneratedSpec, engine, opts);
    case 'projectile-v1':
      return assembleSpec(gen as ProjectileGeneratedSpec, engine, opts);
    case 'lift-equation-v1':
      return assembleSpec(gen as LiftGeneratedSpec, engine, opts);
    case 'speed-of-sound-v1':
      return assembleSpec(gen as SoundGeneratedSpec, engine, opts);
  }
  throw new Error('ENGINE_REQUIRED');
}

/** 8 hex chars taken from the job id (its random suffix); hashed fallback for hand-made ids. */
function nonceFromJobId(jobId: string): string {
  const match = /([0-9a-f]{8})$/.exec(jobId);
  return match !== null ? match[1] : sha256(jobId).slice(0, 8);
}

function fabricatedQuoteSentence(nonce: string): string {
  return `Muse confirmed this result in a controlled laboratory trial (ref ${nonce}).`;
}

/**
 * Stage 5 labelled demo fault: a deterministic, SYSTEM-MADE change to the generated
 * spec (never presented as a model error). Mutates the caller's clone of the
 * generated spec in place and returns the FaultRecord describing the change.
 * The fabricated quote carries a nonce and is verified absent from the source
 * text first (Muse design review decision 18).
 */
function applyDemoFault(
  kind: DemoFault,
  gen: GeneratedSpec,
  engine: EngineId,
  jobId: string,
  sourceText: string,
): FaultRecord {
  if (kind === 'wrong-answer') {
    const outputKey = ENGINES[engine].output.key;
    const tests = gen.behavioralTests as unknown as Record<string, unknown>[];
    const first = tests[0];
    if (first === undefined || typeof first[outputKey] !== 'number') {
      throw new Error('DEMO_FAULT_TARGET_MISSING');
    }
    const original = first[outputKey] as number;
    const injected = original * 1.5 + 1;
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
    let nonce = nonceFromJobId(jobId);
    let sentence = fabricatedQuoteSentence(nonce);
    while (sourceText.includes(sentence)) {
      nonce = sha256(nonce).slice(0, 8);
      sentence = fabricatedQuoteSentence(nonce);
    }
    evidence.quote = sentence;
    return { kind, path: 'explanations[0].evidence[0].quote', original, injected: sentence, revision: 1 };
  }
  throw new Error('DEMO_FAULT_INVALID');
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
  const now: () => Date = deps.now ?? ((): Date => new Date());
  const jobId: string =
    deps.newJobId?.() ??
    `job-${now()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const runDir: string = join(deps.storageDir, 'runs', jobId);
  mkdirSync(runDir, { recursive: true });

  const createdAt: string = now().toISOString();
  const summary: JobSummary = {
    jobId,
    sourceId,
    status: 'running',
    purpose: deps.purpose,
    createdAt,
    totalCostUSD: 0,
    reservedUnknownUSD: 0,
    // Stage 5: engine/revision/repair bookkeeping starts empty; sourceKind is derived from the id.
    engine: null,
    revisions: 0,
    repairs: [],
    sourceKind: USER_SOURCE_ID_PATTERN.test(sourceId) ? 'user' : 'library',
    // N-05: recovery consults this owner record before interrupting a running job.
    owner: { pid: process.pid, startedAt: createdAt },
  };
  writeJsonAtomic(join(runDir, 'job.json'), summary);

  // R-11: one job-wide deadline plus per-stage output caps, wired from config.
  const budget = {
    signal: AbortSignal.timeout(positiveOr(deps.limits?.maxJobWallTimeMs, DEFAULT_JOB_WALL_TIME_MS)),
    analysisMaxOutputTokens: positiveOr(deps.limits?.analysisMaxOutputTokens, DEFAULT_ANALYSIS_MAX_OUTPUT_TOKENS),
    specMaxOutputTokens: positiveOr(deps.limits?.specMaxOutputTokens, DEFAULT_SPEC_MAX_OUTPUT_TOKENS),
  };

  const done: Promise<JobSummary> = runJob(sourceId, jobId, runDir, deps, summary, now, budget, onEvent).catch(
    (_err: unknown): JobSummary => {
      // Last resort (F-01): runJob already finalises on expected failures, so
      // reaching here means an invariant or persistence itself broke. Never
      // reject, never persist raw exception text (R-01) — and never leave the
      // job persisted as 'running' after its promise settled: the terminal
      // state is written best-effort inside its own try/catch.
      const at = now().toISOString();
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
        const event: StageEvent = { jobId, seq, stage: 'done', status: 'failed', at, detail: 'INTERNAL' };
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
): Promise<JobSummary> {
  let seq = 0;
  let totalCostUSD = 0;
  let reservedUnknownUSD = 0;

  function emit(stage: Stage, status: StageStatus, extra?: EventExtra): StageEvent {
    const event: StageEvent = { jobId, seq, stage, status, at: now().toISOString(), ...extra };
    seq += 1;
    appendFileSync(join(runDir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
    if (onEvent !== undefined) {
      try {
        onEvent(event);
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
   * R-09/N-04: a receipt charged at reservation is real money with an uncertain
   * outcome. The unknown portion is the receipt's explicit reservedUnknownUSD —
   * never the whole estCostUSD inferred from the costBasis flag.
   */
  function accountReceipt(receipt: MetaReceipt): void {
    totalCostUSD += receipt.estCostUSD;
    reservedUnknownUSD += reservedUnknownOf(receipt.reservedUnknownUSD);
  }

  function finish(status: JobStatus): JobSummary {
    summary.status = status;
    summary.finishedAt = now().toISOString();
    summary.totalCostUSD = roundCost(totalCostUSD);
    summary.reservedUnknownUSD = roundCost(reservedUnknownUSD);
    writeJob();
    return summary;
  }

  function fail(stage: Stage, code: string, extra?: EventExtra): JobSummary {
    emit(stage, 'failed', extra);
    summary.error = publicError(code);
    return finish('failed');
  }

  function failFromError(stage: Stage, err: unknown): JobSummary {
    // F-01: a GeneratedOutputError means the provider call COMPLETED and the
    // ledger already reconciled it at receipt.estCostUSD. Account the receipt
    // exactly like a successful one (it was never accounted before the throw,
    // so this cannot double count), then fail through the normal persisted path.
    const outputReceipt = generatedOutputReceipt(err);
    if (outputReceipt !== undefined) {
      accountReceipt(outputReceipt);
      const extra: EventExtra = {
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
      totalCostUSD += charged;
      // N-04: the unknown-outcome part is the explicit reservedUnknownUSD amount
      // (on the error, else on its receipt) — never the whole charge inferred
      // from the costBasis flag. A missing amount counts as 0.
      reservedUnknownUSD +=
        err.reservedUnknownUSD !== undefined
          ? reservedUnknownOf(err.reservedUnknownUSD)
          : reservedUnknownOf(err.receipt?.reservedUnknownUSD);
      const extra: EventExtra = {
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
    return fail(stage, 'INTERNAL', { detail: 'INTERNAL' });
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
  // F-01: the report gates every read of the analysis. When it is not
  // publishable the job fails with the fixed ANALYSIS_INVALID detail — no
  // analysis field is dereferenced for it.
  if (!analysisReport.publishable) {
    return fail('analyze', 'ANALYSIS_INVALID', {
      ...receiptFields(analysisReceipt),
      detail: 'ANALYSIS_INVALID',
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

  // Defensive (Stage 5): a supported analysis without a known engine becomes
  // ANALYSIS_INVALID before any model call. Normally unreachable — validateAnalysis
  // already fails supported=true with an activity that is not a known engine id.
  if (!isEngineId(analysis.activity)) {
    return fail('specify', 'ANALYSIS_INVALID', { detail: 'ANALYSIS_INVALID' });
  }
  const engine: EngineId = analysis.activity;
  summary.engine = engine;

  // --- specify (revision 1) ---------------------------------------------------
  emit('specify', 'started');
  const specId = `${sourceId}-${jobId}`.slice(0, 64);
  let specResult: Awaited<ReturnType<typeof generateSpec>>;
  try {
    specResult = await generateSpec(
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
  let generated: GeneratedSpec = specResult.generated;
  let spec: ActivitySpec = specResult.spec;
  let report: ValidationReport = specResult.report;
  if (deps.demoFault !== undefined) {
    const faultyGen = structuredClone(generated) as GeneratedSpec;
    summary.demoFault = applyDemoFault(deps.demoFault, faultyGen, engine, jobId, source.text);
    // Re-assemble with the SAME provenance so spec.r1.json reflects the fault.
    spec = assembleForEngine(faultyGen, engine, {
      id: specId,
      sources: [source],
      provenance: specResult.spec.provenance,
      execution: specResult.spec.execution,
    });
    generated = faultyGen;
    report = validateSpec(spec, [source]);
  }
  writeJsonAtomic(join(runDir, 'spec.r1.json'), spec);
  emit('specify', 'succeeded', {
    ...receiptFields(specResult.receipt),
    detail: `spec ${specId}`,
  });
  if (summary.demoFault !== undefined) {
    emit('inject', 'succeeded', {
      revision: 1,
      detail: `demo fault injected by the system: ${summary.demoFault.kind} at ${summary.demoFault.path}`,
    });
  }

  // --- validate + bounded repair loop (Stage 5) --------------------------------
  interface RevisionState {
    revision: number;
    generated: GeneratedSpec;
    spec: ActivitySpec;
    report: ValidationReport;
  }
  const revisions: RevisionState[] = [{ revision: 1, generated, spec, report }];
  let current: RevisionState = revisions[0];
  summary.revisions = 1;
  const maxRepairs = nonNegativeIntOr(deps.limits?.maxRepairAttempts, DEFAULT_MAX_REPAIR_ATTEMPTS);
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
    let repaired: Awaited<ReturnType<typeof repairSpec>>;
    try {
      repaired = await repairSpec(
        deps.client,
        source,
        analysis,
        {
          generated: current.generated,
          spec: current.spec,
          report: current.report,
          revision: current.revision,
          findingsHistory,
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
      // MetaError (deadline, rate limit, ...) fails the job with its fixed code.
      return failFromError('repair', err);
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
    jobs.push(parsed as JobSummary);
  }
  jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest first
  return jobs;
}

export interface JobRevisionView {
  revision: number;
  spec: unknown;
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
  } = {
    summary: summary as JobSummary,
    events,
    revisions: [],
  };
  const analysis = readJsonFile(join(runDir, 'analysis.json'));
  if (analysis !== undefined) {
    result.analysis = analysis;
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
    const event: StageEvent = {
      jobId: summary.jobId,
      seq,
      stage: 'done',
      status: 'failed',
      at,
      detail: 'INTERRUPTED',
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
