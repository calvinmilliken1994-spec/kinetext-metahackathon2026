// TASK-005 — bounded generation worker: ingest → analyze → specify → validate → done.
//
// One job per call of startJob(). The stage machine persists everything under
// `${storageDir}/runs/<jobId>/`:
//   job.json        — JobSummary, written synchronously at start ('running') and rewritten at the end
//   events.jsonl    — one StageEvent per line, appended as stages progress (seq 0..n per job)
//   analysis.json   — {analysis, report, receipt} from analyzeSource
//   spec.r1.json    — the assembled ActivitySpec from generateSpec (revision 1)
//   report.r1.json  — the ValidationReport for spec.r1
//
// Failure policy: `done` never rejects. Every failure (missing source, MetaError,
// unpublishable analysis, failed spec validation, unexpected crash) becomes a
// terminal JobSummary with status 'failed' (or 'unsupported' for an honest
// not-supported-yet analysis) plus an error {code, message} whose message is a
// FIXED public sentence per code (TASK-009 R-01): raw exception text, provider
// bodies and reflected error strings are never persisted. Spend is accounted
// from receipts and MetaError.chargedUSD: totalCostUSD is everything charged,
// reservedUnknownUSD is the part charged at reservation because the outcome was
// uncertain (TASK-009 R-09).

import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { analyzeSource, generateSpec } from '../../packages/meta/pipeline.ts';
import { MetaError, META_ERROR_MESSAGES } from '../../packages/meta/client.ts';
import type { MetaClient, MetaErrorCode } from '../../packages/meta/client.ts';
import { loadSource } from '../../packages/sources/index.ts';
import type {
  MetaReceipt,
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
}

/** Per-job resource budgets wired from config/resource-limits.json (TASK-009 R-11). */
export interface JobLimits {
  maxJobWallTimeMs?: number;
  analysisMaxOutputTokens?: number;
  specMaxOutputTokens?: number;
}

export interface JobDeps {
  client: MetaClient;
  storageDir: string;
  purpose: 'test-live' | 'demo';
  sourcesDir?: URL;
  now?: () => Date;
  newJobId?: () => string;
  limits?: JobLimits;
}

const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const JOB_ID_PATTERN = /^[a-z0-9-]{1,80}$/;
const DEFAULT_JOB_WALL_TIME_MS = 120000; // config/resource-limits.json maxJobWallTimeMs
const DEFAULT_ANALYSIS_MAX_OUTPUT_TOKENS = 6000;
const DEFAULT_SPEC_MAX_OUTPUT_TOKENS = 8000; // config/resource-limits.json maxOutputTokens

type EventExtra = Partial<
  Pick<StageEvent, 'model' | 'responseId' | 'usage' | 'latencyMs' | 'estCostUSD' | 'detail'>
>;

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
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

export function startJob(
  sourceId: string,
  deps: JobDeps,
  onEvent?: (e: StageEvent) => void,
): { jobId: string; done: Promise<JobSummary> } {
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error('SOURCE_ID_INVALID');
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

  const summary: JobSummary = {
    jobId,
    sourceId,
    status: 'running',
    purpose: deps.purpose,
    createdAt: now().toISOString(),
    totalCostUSD: 0,
    reservedUnknownUSD: 0,
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
      // Last resort: runJob already finalises on expected failures, so reaching here
      // means persistence itself broke. Still never reject — and never persist the
      // raw exception text (R-01).
      summary.status = 'failed';
      summary.error = publicError('INTERNAL');
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

  /** R-09: a receipt charged at reservation is real money with an uncertain outcome. */
  function accountReceipt(receipt: MetaReceipt): void {
    totalCostUSD += receipt.estCostUSD;
    if (receipt.costBasis === 'reservation') {
      reservedUnknownUSD += receipt.estCostUSD;
    }
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
      if (reserved) {
        reservedUnknownUSD += charged;
      }
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
    source = loadSource(sourceId, deps.sourcesDir);
  } catch {
    // R-01: the raw fs/loader error never reaches the artifacts.
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
  const analysisDetail = `${
    analysis.supported ? 'supported' : `unsupported: ${analysis.unsupportedReason}`
  }; checks ${checksPassed(analysisReport)}/${analysisReport.checks.length} passed`;
  if (!analysisReport.publishable) {
    return fail('analyze', 'ANALYSIS_INVALID', {
      ...receiptFields(analysisReceipt),
      detail: 'ANALYSIS_INVALID',
    });
  }
  emit('analyze', 'succeeded', { ...receiptFields(analysisReceipt), detail: analysisDetail });
  if (!analysis.supported) {
    emit('done', 'succeeded', { detail: 'unsupported' });
    return finish('unsupported');
  }

  // --- specify --------------------------------------------------------------
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
    return failFromError('specify', err);
  }
  accountReceipt(specResult.receipt);
  writeJsonAtomic(join(runDir, 'spec.r1.json'), specResult.spec);
  emit('specify', 'succeeded', {
    ...receiptFields(specResult.receipt),
    detail: `spec ${specId}`,
  });

  // --- validate -------------------------------------------------------------
  emit('validate', 'started');
  const report = specResult.report;
  writeJsonAtomic(join(runDir, 'report.r1.json'), report);
  const passed = checksPassed(report);
  const total = report.checks.length;
  const validateDetail = `${passed}/${total} checks passed`;
  if (!report.publishable) {
    const ids = failedCheckIds(report);
    // R-01: the failure detail is the code plus system-owned failing check ids.
    return fail('validate', 'VALIDATION_FAILED', {
      detail: `VALIDATION_FAILED; failed checks: ${ids.join(', ')}`,
    });
  }
  emit('validate', 'succeeded', { detail: validateDetail });

  // --- done -----------------------------------------------------------------
  emit('done', 'succeeded', { detail: 'publishable' });
  summary.specId = specId;
  summary.publishable = true;
  summary.checksPassed = passed;
  summary.checksTotal = total;
  return finish('succeeded');
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

export function readJob(
  storageDir: string,
  jobId: string,
): { summary: JobSummary; events: StageEvent[]; analysis?: unknown; spec?: unknown; report?: unknown } | null {
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
  const result: { summary: JobSummary; events: StageEvent[]; analysis?: unknown; spec?: unknown; report?: unknown } = {
    summary: summary as JobSummary,
    events,
  };
  const analysis = readJsonFile(join(runDir, 'analysis.json'));
  if (analysis !== undefined) {
    result.analysis = analysis;
  }
  const spec = readJsonFile(join(runDir, 'spec.r1.json'));
  if (spec !== undefined) {
    result.spec = spec;
  }
  const report = readJsonFile(join(runDir, 'report.r1.json'));
  if (report !== undefined) {
    result.report = report;
  }
  return result;
}

/**
 * R-10 startup recovery: every job still marked 'running' was left behind by a
 * previous process (this one has not started any job yet when main.ts calls
 * this before listening). Each becomes 'failed' with the fixed INTERRUPTED
 * error, a 'done'/'failed' event is appended, and already-accounted costs and
 * unknown reservations are kept as they are — nothing is refunded here.
 * Returns the recovered job ids.
 */
export function recoverInterruptedJobs(storageDir: string, now: () => Date = () => new Date()): string[] {
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
