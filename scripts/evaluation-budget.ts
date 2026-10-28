// S5B-07 (Stage 5b review, Wave C) — pure evaluation-driver budget helpers, no I/O.
// Consumed by scripts/evaluation-run.ts and tested by tests/evaluation-budget.test.ts.
//
// (a) perJobAdmissionUSD: a CONSERVATIVE per-job admission amount derived from
//     config/resource-limits.json via packages/meta/pricing.ts (import only — that
//     package is never modified here). It bounds the worst case a single job can
//     reserve: every logical call (analysis + analysis repairs, spec + spec repairs,
//     each up to maxRepairAttempts) at its full input/output reservation, times every
//     transport attempt (1 + maxRetries). The reviewer's numbers at the current caps:
//     analysis attempt 0.108, spec attempt 0.176, six logical calls 0.852, twelve
//     transport attempts 1.704 — the old fixed 0.15 bounded none of them.
// (b) submitted-job journal helpers: parse journal lines and reconcile entries whose
//     job never got a results line (crash, poll failure) so their costs are counted
//     and their page is never re-submitted while the journaled job runs or finished.
import { reservationUSD } from '../packages/meta/pricing.ts';

const MODEL = 'muse-spark-1.3' as const;

/** Mirrors the worker's absolute repair bound (S5-06) — admission never assumes more. */
export const MAX_REPAIR_ATTEMPTS_BOUND = 2;

export interface AdmissionLimits {
  maxInputTokens: number;
  maxOutputTokens: number;
  analysisMaxOutputTokens: number;
  /** Per repair loop; the analysis and spec loops have SEPARATE budgets of this size. */
  maxRepairAttempts: number;
  /** Transport retries per logical call. */
  maxRetries: number;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** Fail closed: anything but a fully valid limits object throws ADMISSION_LIMITS_INVALID. */
export function validateAdmissionLimits(limits: AdmissionLimits): void {
  if (typeof limits !== 'object' || limits === null) {
    throw new Error('ADMISSION_LIMITS_INVALID');
  }
  if (
    !isPositiveFinite(limits.maxInputTokens) ||
    !isPositiveFinite(limits.maxOutputTokens) ||
    !isPositiveFinite(limits.analysisMaxOutputTokens)
  ) {
    throw new Error('ADMISSION_LIMITS_INVALID');
  }
  if (
    !isNonNegativeInteger(limits.maxRepairAttempts) ||
    limits.maxRepairAttempts > MAX_REPAIR_ATTEMPTS_BOUND ||
    !isNonNegativeInteger(limits.maxRetries)
  ) {
    throw new Error('ADMISSION_LIMITS_INVALID');
  }
}

/** Extract + validate the admission-relevant fields of config/resource-limits.json. */
export function admissionLimitsFromConfig(config: unknown): AdmissionLimits {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new Error('ADMISSION_LIMITS_INVALID');
  }
  const c = config as Record<string, unknown>;
  const limits: AdmissionLimits = {
    maxInputTokens: c['maxInputTokens'] as number,
    maxOutputTokens: c['maxOutputTokens'] as number,
    analysisMaxOutputTokens: c['analysisMaxOutputTokens'] as number,
    maxRepairAttempts: c['maxRepairAttempts'] as number,
    maxRetries: c['maxRetries'] as number,
  };
  for (const v of Object.values(limits)) {
    if (typeof v !== 'number') {
      throw new Error('ADMISSION_LIMITS_INVALID');
    }
  }
  validateAdmissionLimits(limits);
  return limits;
}

/**
 * Conservative worst-case reservation for ONE job (USD): every logical call at its
 * full-token reservation, both repair loops at maxRepairAttempts, every logical call
 * times (1 + maxRetries) transport attempts. An admission check against this amount
 * bounds what a run can commit at the configured caps (estimates under DEBT-003's
 * tokenizer/pricing assumptions — not verified provider invoices).
 */
export function perJobAdmissionUSD(limits: AdmissionLimits): number {
  validateAdmissionLimits(limits);
  const logicalCalls = 1 + limits.maxRepairAttempts;
  const transportAttempts = 1 + limits.maxRetries;
  const analysisAttempt = reservationUSD(MODEL, limits.maxInputTokens, limits.analysisMaxOutputTokens);
  const specAttempt = reservationUSD(MODEL, limits.maxInputTokens, limits.maxOutputTokens);
  return (analysisAttempt + specAttempt) * logicalCalls * transportAttempts;
}

/* ------------------------------------------------------------------ */
/* Submitted-job journal                                                */
/* ------------------------------------------------------------------ */

/** One line of the submitted-job journal, appended BEFORE the driver waits on a job. */
export interface JournalEntry {
  jobId: string;
  sourceId: string;
  at: string;
}

/** Strict parse of one journal line; malformed or incomplete lines yield null (skipped). */
export function parseJournalLine(line: string): JournalEntry | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const rec = parsed as Record<string, unknown>;
  if (typeof rec['jobId'] !== 'string' || rec['jobId'] === '') {
    return null;
  }
  if (typeof rec['sourceId'] !== 'string' || rec['sourceId'] === '') {
    return null;
  }
  return {
    jobId: rec['jobId'],
    sourceId: rec['sourceId'],
    at: typeof rec['at'] === 'string' ? rec['at'] : '',
  };
}

/** The fields of a job.json summary the reconciliation and records rely on. */
export interface JobSummaryLike {
  status?: unknown;
  jobId?: unknown;
  engine?: unknown;
  publishedRevision?: unknown;
  revisions?: unknown;
  repairs?: unknown;
  analysisRepairs?: unknown;
  error?: unknown;
  totalCostUSD?: unknown;
}

export interface ReconcileArgs {
  journal: JournalEntry[];
  /** Job ids that already have a results.jsonl line — never recovered twice. */
  recordedJobIds: ReadonlySet<string>;
  /** Job summary lookup (API or storage); undefined when the job cannot be found. */
  summaryOf: (jobId: string) => JobSummaryLike | undefined;
}

export interface ReconcileResult {
  /** Settled jobs without a results line: record their outcome and cost. */
  recovered: { entry: JournalEntry; summary: JobSummaryLike }[];
  /** Journaled jobs still running: their page must NOT be re-submitted. */
  running: JournalEntry[];
  /** Jobs that cannot be found or have an unknown status: fail closed, do not re-submit. */
  unresolved: JournalEntry[];
}

const SETTLED_STATUSES: ReadonlySet<string> = new Set(['succeeded', 'unsupported', 'failed']);

export function reconcileJournal(args: ReconcileArgs): ReconcileResult {
  const result: ReconcileResult = { recovered: [], running: [], unresolved: [] };
  const seen = new Set<string>();
  for (const entry of args.journal) {
    if (seen.has(entry.jobId)) {
      continue; // duplicate submission lines for the same job count once
    }
    seen.add(entry.jobId);
    if (args.recordedJobIds.has(entry.jobId)) {
      continue; // already in results.jsonl
    }
    const summary = args.summaryOf(entry.jobId);
    const status: unknown = typeof summary === 'object' && summary !== null ? summary.status : undefined;
    if (typeof status !== 'string') {
      result.unresolved.push(entry);
      continue;
    }
    if (status === 'running') {
      result.running.push(entry);
      continue;
    }
    if (SETTLED_STATUSES.has(status)) {
      result.recovered.push({ entry, summary: summary as JobSummaryLike });
      continue;
    }
    result.unresolved.push(entry); // unknown status: fail closed
  }
  return result;
}

/** The manifest page fields a results.jsonl record carries. */
export interface ResultPageFields {
  sourceId: string;
  candidate: number;
  subject: string;
  expected: string;
  acceptable: string[];
  difficulty: string;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Build a results.jsonl record for a RECOVERED journaled job, marked `recovered: true`
 * (S5B-07). Costs stay unknown (null) when the summary carries no finite amount —
 * never 0 by assumption.
 */
export function recoveredRecord(
  page: ResultPageFields,
  summary: JobSummaryLike,
  at: string,
  extra?: {
    failedChecks?: string[] | null;
    firstRevisionFailedChecks?: string[] | null;
    unsupportedReason?: string | null;
    wallS?: number | null;
  },
): Record<string, unknown> {
  const repairs = Array.isArray(summary.repairs)
    ? (summary.repairs as Record<string, unknown>[]).map(r => ({
        targeted: Array.isArray(r?.['targeted']) ? r['targeted'] : [],
        fixed: Array.isArray(r?.['fixed']) ? r['fixed'] : [],
      }))
    : [];
  const analysisRepairs = Array.isArray(summary.analysisRepairs)
    ? (summary.analysisRepairs as Record<string, unknown>[]).map(r => ({
        attempt: r?.['attempt'] ?? null,
        revision: r?.['revision'] ?? null,
        targeted: Array.isArray(r?.['targeted']) ? r['targeted'] : [],
        fixed: Array.isArray(r?.['fixed']) ? r['fixed'] : [],
        remaining: Array.isArray(r?.['remaining']) ? r['remaining'] : [],
        passed: r?.['passed'] === true,
      }))
    : [];
  const error = summary.error;
  const errorCode =
    typeof error === 'object' && error !== null && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : null;
  return {
    sourceId: page.sourceId,
    candidate: page.candidate,
    subject: page.subject,
    expected: page.expected,
    acceptable: page.acceptable,
    difficulty: page.difficulty,
    jobId: typeof summary.jobId === 'string' ? summary.jobId : null,
    status: typeof summary.status === 'string' ? summary.status : null,
    engine: typeof summary.engine === 'string' ? summary.engine : null,
    publishedRevision: finiteOrNull(summary.publishedRevision),
    revisions: finiteOrNull(summary.revisions),
    repairs,
    analysisRepairs,
    failedChecks: extra?.failedChecks ?? null,
    firstRevisionFailedChecks: extra?.firstRevisionFailedChecks ?? null,
    error: errorCode,
    unsupportedReason: extra?.unsupportedReason ?? null,
    totalCostUSD: finiteOrNull(summary.totalCostUSD),
    wallS: extra?.wallS ?? null,
    recovered: true,
    at,
  };
}
