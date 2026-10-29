// S5B-07 (Stage 5b review, Wave C) + S5B-14 (round 2) — pure evaluation-driver budget helpers,
// no I/O. Consumed by scripts/evaluation-run.ts and tested by tests/evaluation-budget.test.ts
// (unit) and tests/evaluation-run-liabilities.test.ts (driver integration).
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
// (c) S5B-14 run-liability accounting: EVERY outstanding liability of a run is either
//     spent (a known settled cost, even for a source that left the manifest) or holds
//     a conservative perJobAdmissionUSD reservation — running jobs, unresolvable jobs,
//     settled jobs with unknown cost, results lines with null/unknown cost, nonempty
//     malformed journal lines, and pre-submit intents with no job line (the
//     POST→journal crash window). The admission rule is
//        spent + reserved + perJobAdmissionUSD <= maxUsd
//     evaluated freshly BEFORE EVERY submission (admissionAllowed), and the driver
//     re-runs the assessment after waiting for idle so a job that settles while
//     waiting is re-read and its real cost REPLACES its reservation. Design choice
//     (documented per the round-2 fix spec): reservations, not a whole-run stop — the
//     simpler safe option; the run may continue on OTHER pages only while every
//     outstanding liability's worst case still fits under the cap.
import { isModelChoice, reservationUSD } from '../packages/meta/pricing.ts';
import type { MetaProvider, ModelChoice } from '../packages/meta/pricing.ts';

/** The driver's default model (OW-2: --model muse-spark-open switches to the Modal-hosted open weights). */
export const DEFAULT_EVAL_MODEL: ModelChoice = 'muse-spark-1.3';

/** OW-2: which provider serves which model choice — fixed, never inferred at runtime. */
export const PROVIDER_FOR_MODEL: Readonly<Record<ModelChoice, MetaProvider>> = {
  'muse-spark-1.3': 'meta-api',
  'muse-spark-open': 'modal',
};

/**
 * OW-2: parse `--model <id>` from an argv (default muse-spark-1.3). Anything
 * else — an unknown id, an empty value, a missing value, or another flag in the
 * value position — throws EVAL_MODEL_INVALID; the driver exits 2 with a fixed
 * message and submits nothing.
 */
export function evalModelFromArgv(argv: readonly string[]): ModelChoice {
  const i = argv.indexOf('--model');
  if (i < 0) {
    return DEFAULT_EVAL_MODEL;
  }
  const value: string | undefined = argv[i + 1];
  if (value === undefined || !isModelChoice(value)) {
    throw new Error('EVAL_MODEL_INVALID');
  }
  return value;
}

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
 *
 * OW-2: priced with the CHOSEN model's rates (both models price identically today;
 * an unknown model fails closed with pricing's UNKNOWN_MODEL, never as 1.3).
 */
export function perJobAdmissionUSD(limits: AdmissionLimits, model: ModelChoice = DEFAULT_EVAL_MODEL): number {
  validateAdmissionLimits(limits);
  const logicalCalls = 1 + limits.maxRepairAttempts;
  const transportAttempts = 1 + limits.maxRetries;
  const analysisAttempt = reservationUSD(model, limits.maxInputTokens, limits.analysisMaxOutputTokens);
  const specAttempt = reservationUSD(model, limits.maxInputTokens, limits.maxOutputTokens);
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

/* ------------------------------------------------------------------ */
/* S5B-14: journal classification — job / intent / resolution / malformed */
/* ------------------------------------------------------------------ */

/** A job journal entry; `intentId` pairs it with its durable pre-submit intent line. */
export interface JournalJobEntry extends JournalEntry {
  intentId?: string;
}

/**
 * A durable pre-submit intent line, appended BEFORE the POST /api/jobs request. An intent
 * with no matching job line after a restart means the submission outcome is UNCERTAIN
 * (crash between POST and journal append, or a failed/ambiguous POST).
 */
export interface IntentEntry {
  intentId: string;
  sourceId: string;
  at: string;
}

/** A manual resolution of an intent, appended by an operator who verified no job was created. */
export interface IntentResolutionEntry {
  intentId: string;
  resolution: 'not-submitted';
  at: string;
}

export type ClassifiedJournalLine =
  | { kind: 'job'; entry: JournalJobEntry }
  | { kind: 'intent'; entry: IntentEntry }
  | { kind: 'resolution'; entry: IntentResolutionEntry }
  | { kind: 'malformed'; line: string };

/**
 * Classify one journal line. Blank lines yield null; every OTHER unrecognized nonempty line is
 * `malformed` — a blocking liability charged at perJobAdmissionUSD, never silently skipped
 * (S5B-14; the round-1 driver dropped truncated lines and with them a possible paid submission).
 * An unrecognized `resolution` token never resolves an intent; the line degrades to a plain
 * intent (still a liability) rather than cancelling one.
 */
export function classifyJournalLine(line: string): ClassifiedJournalLine | null {
  const trimmed = line.trim();
  if (trimmed === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { kind: 'malformed', line: trimmed };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'malformed', line: trimmed };
  }
  const rec = parsed as Record<string, unknown>;
  const at = typeof rec['at'] === 'string' ? rec['at'] : '';
  if (
    typeof rec['jobId'] === 'string' && rec['jobId'] !== '' &&
    typeof rec['sourceId'] === 'string' && rec['sourceId'] !== ''
  ) {
    const entry: JournalJobEntry = { jobId: rec['jobId'], sourceId: rec['sourceId'], at };
    if (typeof rec['intentId'] === 'string' && rec['intentId'] !== '') {
      entry.intentId = rec['intentId'];
    }
    return { kind: 'job', entry };
  }
  if (typeof rec['intentId'] === 'string' && rec['intentId'] !== '') {
    if (rec['resolution'] === 'not-submitted') {
      return { kind: 'resolution', entry: { intentId: rec['intentId'], resolution: 'not-submitted', at } };
    }
    if (typeof rec['sourceId'] === 'string' && rec['sourceId'] !== '') {
      return { kind: 'intent', entry: { intentId: rec['intentId'], sourceId: rec['sourceId'], at } };
    }
  }
  return { kind: 'malformed', line: trimmed };
}

export interface ParsedJournal {
  jobs: JournalJobEntry[];
  intents: IntentEntry[];
  resolutions: IntentResolutionEntry[];
  /** Nonempty lines that could not be classified — each is a blocking liability (S5B-14). */
  malformed: string[];
}

/** Partition a whole journal file; blank lines are ignored, nonempty unknown lines are kept. */
export function parseJournal(text: string): ParsedJournal {
  const out: ParsedJournal = { jobs: [], intents: [], resolutions: [], malformed: [] };
  for (const line of text.split('\n')) {
    const c = classifyJournalLine(line);
    if (c === null) continue;
    if (c.kind === 'job') out.jobs.push(c.entry);
    else if (c.kind === 'intent') out.intents.push(c.entry);
    else if (c.kind === 'resolution') out.resolutions.push(c.entry);
    else out.malformed.push(c.line);
  }
  return out;
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
  /** OW-2: recorded on jobs run since the model-choice wave; absent on older summaries. */
  model?: unknown;
  provider?: unknown;
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

/** A spend amount the admission rule may count: finite and non-negative. A negative
 * (hand-edited) amount could offset real spend, so it is treated as unknown — charged
 * a full reservation — never subtracted (round-3 review hardening). */
function knownCostOrNull(v: unknown): number | null {
  const n = finiteOrNull(v);
  return n !== null && n >= 0 ? n : null;
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
    // OW-2: record what the job actually ran; null for summaries from before the
    // fields existed (the driver falls back to the REQUESTED model — never an
    // invented one here).
    model: typeof summary.model === 'string' ? summary.model : null,
    provider: typeof summary.provider === 'string' ? summary.provider : null,
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

/* ------------------------------------------------------------------ */
/* S5B-14: run-liability assessment and the admission rule              */
/* ------------------------------------------------------------------ */

/** The fields of a results.jsonl line the liability assessment relies on (all untrusted). */
export interface ResultLineLike {
  sourceId?: unknown;
  jobId?: unknown;
  totalCostUSD?: unknown;
}

/**
 * One outstanding financial liability of a run. Every kind is charged a conservative
 * `chargeUsd` (= perJobAdmissionUSD) reservation in the admission rule; unknown money is
 * never 0 by assumption.
 */
export type Liability =
  /** A results.jsonl line whose totalCostUSD is null/absent/non-finite. */
  | { kind: 'result-unknown-cost'; sourceId: string; jobId: string | null; chargeUsd: number }
  /** A nonempty journal line that could not be classified (e.g. truncated mid-append). */
  | { kind: 'malformed-journal-line'; line: string; chargeUsd: number }
  /** A journaled job whose summary still says `running`. */
  | { kind: 'job-running'; entry: JournalJobEntry; chargeUsd: number }
  /** A journaled job with no API record, no storage job.json, or an unknown status. */
  | { kind: 'job-unresolved'; entry: JournalJobEntry; chargeUsd: number }
  /** A journaled job that settled but carries no finite cost. */
  | { kind: 'job-settled-unknown-cost'; entry: JournalJobEntry; summary: JobSummaryLike; chargeUsd: number }
  /** A pre-submit intent with no job line and no resolution: the POST outcome is uncertain. */
  | { kind: 'intent-without-job'; intent: IntentEntry; chargeUsd: number };

export interface AssessLiabilitiesArgs {
  /** Every line of results.jsonl (untrusted shapes). */
  resultsLines: readonly ResultLineLike[];
  /** The parsed journal (parseJournal). */
  journal: ParsedJournal;
  /** Job summary lookup (API or storage); undefined when the job cannot be found. */
  summaryOf: (jobId: string) => JobSummaryLike | undefined;
  /** The conservative per-job reservation/ admission amount (perJobAdmissionUSD). */
  perJobAdmissionUSD: number;
  /** Source ids currently in the manifest; settled known costs OUTSIDE it still count as spent. */
  manifestSourceIds: ReadonlySet<string>;
}

export interface AssessLiabilitiesResult {
  /** Sum of every KNOWN settled cost: results lines plus unrecorded settled journal jobs
   *  (including sources no longer in the manifest — S5B-14). */
  spentUsd: number;
  /** Sum of every liability's conservative reservation. */
  reservedUsd: number;
  /** Every outstanding liability, in a deterministic order. */
  liabilities: Liability[];
  /** Unrecorded settled in-manifest jobs: the driver writes a `recovered: true` results line. */
  recoverable: { entry: JournalJobEntry; summary: JobSummaryLike }[];
  /** Unrecorded settled jobs whose source left the manifest: cost counts, no line can be written. */
  unrecordable: { entry: JournalJobEntry; summary: JobSummaryLike; costUsd: number }[];
  /** Pages that must NOT be (re-)submitted while their liability is outstanding. */
  blockedSourceIds: Set<string>;
}

/**
 * Assess EVERY outstanding run liability (S5B-14). Called freshly before each submission and
 * again after the idle wait, so a job that settles while the driver waits is re-read and its
 * real cost replaces its reservation. Nothing unknown is ever counted as 0.
 */
export function assessLiabilities(args: AssessLiabilitiesArgs): AssessLiabilitiesResult {
  const admission = args.perJobAdmissionUSD;
  if (typeof admission !== 'number' || !Number.isFinite(admission) || admission <= 0) {
    throw new Error('ADMISSION_AMOUNT_INVALID');
  }
  const liabilities: Liability[] = [];
  const blockedSourceIds = new Set<string>();
  let spentUsd = 0;

  // 1) Results lines: known finite costs count; null/absent costs are charged, blocking liabilities.
  const recordedJobIds = new Set<string>();
  for (const line of args.resultsLines) {
    const sourceId = typeof line.sourceId === 'string' ? line.sourceId : '';
    const jobId = typeof line.jobId === 'string' && line.jobId !== '' ? line.jobId : null;
    if (jobId !== null) recordedJobIds.add(jobId);
    const cost = knownCostOrNull(line.totalCostUSD);
    if (cost !== null) {
      spentUsd += cost;
      continue;
    }
    liabilities.push({ kind: 'result-unknown-cost', sourceId, jobId, chargeUsd: admission });
    if (sourceId !== '') blockedSourceIds.add(sourceId);
  }

  // 2) Journaled jobs without a results line (deduplicated by jobId inside reconcileJournal).
  const recon = reconcileJournal({ journal: args.journal.jobs, recordedJobIds, summaryOf: args.summaryOf });
  const recoverable: AssessLiabilitiesResult['recoverable'] = [];
  const unrecordable: AssessLiabilitiesResult['unrecordable'] = [];
  for (const { entry, summary } of recon.recovered) {
    const cost = knownCostOrNull(summary.totalCostUSD);
    const inManifest = args.manifestSourceIds.has(entry.sourceId);
    if (cost === null) {
      // Settled but the money is unknown: record the outcome, hold the reservation, block the page.
      liabilities.push({ kind: 'job-settled-unknown-cost', entry, summary, chargeUsd: admission });
      blockedSourceIds.add(entry.sourceId);
      if (inManifest) recoverable.push({ entry, summary });
    } else {
      spentUsd += cost; // counts even when the source is no longer in the manifest (S5B-14)
      if (inManifest) recoverable.push({ entry, summary });
      else unrecordable.push({ entry, summary, costUsd: cost });
    }
  }
  for (const entry of recon.running) {
    liabilities.push({ kind: 'job-running', entry, chargeUsd: admission });
    blockedSourceIds.add(entry.sourceId);
  }
  for (const entry of recon.unresolved) {
    liabilities.push({ kind: 'job-unresolved', entry, chargeUsd: admission });
    blockedSourceIds.add(entry.sourceId);
  }

  // 3) Nonempty malformed journal lines: charged, never skipped (a truncation may hide a paid POST).
  for (const line of args.journal.malformed) {
    liabilities.push({ kind: 'malformed-journal-line', line, chargeUsd: admission });
  }

  // 4) Pre-submit intents with no job line and no manual resolution: uncertain submissions.
  const paired = new Set<string>();
  for (const j of args.journal.jobs) {
    if (typeof j.intentId === 'string' && j.intentId !== '') paired.add(j.intentId);
  }
  for (const r of args.journal.resolutions) paired.add(r.intentId);
  const seenIntents = new Set<string>();
  for (const intent of args.journal.intents) {
    if (paired.has(intent.intentId) || seenIntents.has(intent.intentId)) continue;
    seenIntents.add(intent.intentId);
    liabilities.push({ kind: 'intent-without-job', intent, chargeUsd: admission });
    blockedSourceIds.add(intent.sourceId);
  }

  const reservedUsd = liabilities.reduce((s, l) => s + l.chargeUsd, 0);
  return { spentUsd, reservedUsd, liabilities, recoverable, unrecordable, blockedSourceIds };
}

export interface AdmissionCheckArgs {
  spentUsd: number;
  reservedUsd: number;
  perJobAdmissionUSD: number;
  maxUsd: number;
}

/**
 * The S5B-14 admission rule, evaluated freshly before EVERY submission:
 *   spent + reserved + perJobAdmissionUSD <= maxUsd   (boundary inclusive).
 * Fails closed on any non-finite or negative input.
 */
export function admissionAllowed(args: AdmissionCheckArgs): boolean {
  for (const [name, v] of Object.entries(args)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`ADMISSION_CHECK_INVALID:${name}`);
  }
  if (args.spentUsd < 0 || args.reservedUsd < 0 || args.perJobAdmissionUSD <= 0 || args.maxUsd < 0) {
    throw new Error('ADMISSION_CHECK_INVALID');
  }
  return args.spentUsd + args.reservedUsd + args.perJobAdmissionUSD <= args.maxUsd;
}

function usd(n: number): string {
  return `$${n.toFixed(3)}`;
}

function quoteLine(line: string): string {
  return line.length > 160 ? `${line.slice(0, 160)}…` : line;
}

/** One clear operator-facing message per liability kind, including the manual fix where there is one. */
export function describeLiability(l: Liability): string {
  switch (l.kind) {
    case 'result-unknown-cost':
      return (
        `results line for "${l.sourceId}" (job ${l.jobId ?? 'unknown'}) has no known cost — charged a conservative ` +
        `${usd(l.chargeUsd)} reservation instead of 0 (S5B-14). Fix: fill in its real totalCostUSD in results.jsonl.`
      );
    case 'malformed-journal-line':
      return (
        `nonempty malformed journal line — charged a conservative ${usd(l.chargeUsd)} reservation, NOT skipped (S5B-14): ` +
        `"${quoteLine(l.line)}". Fix: once its submission outcome is known, repair the line into a valid job/intent record ` +
        'or remove it from journal.jsonl.'
      );
    case 'job-running':
      return (
        `job ${l.entry.jobId} (${l.entry.sourceId}) is still RUNNING — holding a ${usd(l.chargeUsd)} reservation and not ` +
        're-submitting its page. It is re-read after the idle wait; its real cost then replaces the reservation.'
      );
    case 'job-unresolved':
      return (
        `job ${l.entry.jobId} (${l.entry.sourceId}) could not be resolved (no API record, no storage job.json) — holding a ` +
        `${usd(l.chargeUsd)} reservation and not re-submitting its page. Fix: resolve the job, or add a results line with its real cost.`
      );
    case 'job-settled-unknown-cost':
      return (
        `job ${l.entry.jobId} (${l.entry.sourceId}) settled '${String(l.summary.status)}' with UNKNOWN cost — holding a ` +
        `${usd(l.chargeUsd)} reservation until its real cost is known (never 0 by assumption). Fix: fill in totalCostUSD ` +
        'in the job record or its results line.'
      );
    case 'intent-without-job':
      return (
        `pre-submit intent ${l.intent.intentId} (${l.intent.sourceId}) has NO job line — the submission outcome is UNCERTAIN ` +
        `(crash between POST and journal append, or a failed POST). Holding a ${usd(l.chargeUsd)} reservation and NOT ` +
        `re-submitting "${l.intent.sourceId}" until resolved manually. Fix: if a job WAS created, append ` +
        `{"jobId":"<id>","sourceId":"${l.intent.sourceId}","intentId":"${l.intent.intentId}"} to journal.jsonl; if you verified ` +
        `none was, append {"intentId":"${l.intent.intentId}","resolution":"not-submitted"}.`
      );
    default: {
      const never: never = l;
      throw new Error(`UNKNOWN_LIABILITY ${JSON.stringify(never)}`);
    }
  }
}
