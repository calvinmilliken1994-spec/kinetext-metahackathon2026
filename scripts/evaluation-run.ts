// TASK-023b evaluation driver. Runs the data/evaluation/manifest.json pages through the LIVE API
// (http://127.0.0.1:8787, META_LIVE=1) — by default one job at a time, never two at once — with NO
// demo faults, so every repair it records is a natural model failure repaired by Muse.
//
// Usage (foreground; the local live API must already be running):
//   node scripts/evaluation-run.ts --list                # print the plan, no API calls
//   node scripts/evaluation-run.ts                       # run everything not yet in results.jsonl
//   node scripts/evaluation-run.ts --concurrency 2       # concurrency (BUG-006 wave, part B):
//       # keep up to N pages in flight at once (integer 1-8; DEFAULT 1 = the pre-registered
//       # sequential behaviour, unchanged). Admission still reserves perJob(Lesson)AdmissionUSD
//       # for EVERY in-flight job plus every outstanding journal liability before each submit,
//       # so spent + reserved + admission <= --max-usd holds under concurrency (no overshoot);
//       # when only the run's own in-flight reservations block the next page, the driver waits
//       # for them to settle and re-checks their REAL costs before deciding. Results-line order
//       # may differ from the plan order, but each page is recorded exactly once, and the same
//       # per-page lines are printed. The API must itself allow the concurrency
//       # (config maxConcurrentJobs); the driver waits for a free server slot before each POST.
//   node scripts/evaluation-run.ts --flow lesson           # S6-W: run the Stage 6 LESSON flow
//       # instead of the default v1 activity flow. The DEFAULT STAYS 'activity' so the
//       # pre-registered Stage 5b evaluation is unchanged; lesson runs record flow, component
//       # counts and overview/interactive outcomes on every results line, and admit at the
//       # lesson worst case. ALWAYS use a scratch EVAL_OUT_DIR for lesson runs — never
//       # docs/evidence/stage-5b/evaluation (pre-registered, read-only).
//   node scripts/evaluation-run.ts --model muse-spark-open  # OW-2: run the SAME manifest on the
//       # Modal-hosted open weights instead of the default muse-spark-1.3 (Meta API). The model is
//       # sent with EVERY job POST, admission arithmetic uses the chosen model's pricing, and each
//       # results line records the model/provider the job actually ran on. Use with EVAL_OUT_DIR
//       # (e.g. docs/evidence/open-weights/evaluation/) so the run stays apart from the
//       # pre-registered hosted evaluation — never re-run into the pre-registered directory.
//   node scripts/evaluation-run.ts --only <sourceId>     # run a single page
//   node scripts/evaluation-run.ts --from <n>            # resume at candidate number n (1-29)
//   node scripts/evaluation-run.ts --max-usd <x>         # admission cap (default 4). The rule
//       (S5B-14) is evaluated FRESHLY BEFORE EVERY submission, and again AFTER waiting for server
//       idle, as:   spent + reserved + per-job admission  <=  x
//         spent    every KNOWN settled cost: results.jsonl lines with a finite totalCostUSD plus
//                  journaled jobs that reconcile to a settled summary with a known cost — counted
//                  even when their source is no longer in the manifest.
//         reserved a conservative per-job-admission reservation for EVERY outstanding liability:
//                  still-running jobs, unresolvable jobs (no API record, no storage job.json),
//                  settled jobs with unknown cost, results lines with null/unknown cost, nonempty
//                  malformed journal lines, and pre-submit intents with no job line (uncertain
//                  submissions). Unknown money is never 0 by assumption. A job that settles while
//                  the driver waits for idle is re-read and its REAL cost replaces its reservation.
//       The per-job admission amount is the conservative worst-case reservation for one job,
//       derived from config/resource-limits.json (maxInputTokens, maxOutputTokens,
//       analysisMaxOutputTokens, maxRepairAttempts for BOTH the analysis and the spec repair loop,
//       maxRetries) via packages/meta/pricing.ts reservationUSD — USD 1.704 per job at the current
//       caps (S5B-07; the old fixed 0.15 did not bound even one spec attempt's 0.176 reservation).
//       It is a driver-side ADMISSION bound on reservation estimates (DEBT-003 assumptions), not a
//       provider-side billing guarantee; the spend ledger enforces its own cap separately.
//   node scripts/evaluation-run.ts --rerun               # re-run pages that already have a result line
//
// Appends one JSON line per finished job to docs/evidence/stage-5b/evaluation/results.jsonl.
//
// Journal (journal.jsonl beside the results; S5B-07 + S5B-14 crash-window closure). Per submission:
//   1. BEFORE the POST the driver appends a durable pre-submit intent line:
//        {"intentId":"<id>","sourceId":"<src>","at":"<iso>"}
//   2. AFTER a 202 response it appends the job line (appended BEFORE waiting on the job):
//        {"jobId":"<id>","sourceId":"<src>","intentId":"<id>","at":"<iso>"}
//   An intent with no matching job line on restart is an UNCERTAIN submission (crash between POST
//   and journal append, or a failed/ambiguous POST): it holds a per-job-admission reservation and
//   its page is never re-submitted until resolved manually — append the job line
//   {"jobId":"<id>","sourceId":"<src>","intentId":"<intentId>"} if a job was created, or
//   {"intentId":"<intentId>","resolution":"not-submitted"} once verified that none was.
//   On start AND before every submission, journaled jobs without a results line are reconciled —
//   via API GET /api/jobs/:id, else the storage dir (STORAGE_DIR, default storage/runs/<jobId>/job.json):
//   settled jobs get a results line marked `recovered: true` with their real cost counted into the
//   budget (even out-of-manifest sources); still-running or unresolvable jobs block their page and
//   hold a reservation. Nonempty malformed journal lines are charged liabilities, never skipped.
// Modelled on scripts/stage5-live-runs.ts (TASK-017).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admissionAllowed,
  admissionLimitsFromConfig,
  assessLiabilities,
  describeLiability,
  evalConcurrencyFromArgv,
  evalFlowFromArgv,
  evalModelFromArgv,
  normaliseComponentRepairs,
  parseJournal,
  perJobAdmissionUSD,
  perJobLessonAdmissionUSD,
  PROVIDER_FOR_MODEL,
  recoveredRecord,
} from './evaluation-budget.ts';
import type { AssessLiabilitiesResult, EvalFlow, ResultPageFields } from './evaluation-budget.ts';
import type { ModelChoice } from '../packages/meta/pricing.ts';
// BUG-006: the worker's fixed plain-sentence entry reasons, so a results line can map a
// failed component's reason back to its fixed code without duplicating the wording.
import { OUTPUT_INVALID_REASON, OUTPUT_TRUNCATED_REASON } from '../workers/generation/lesson.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8787';
// EVAL_OUT_DIR (relative to the repo root) keeps follow-up runs apart from the pre-registered evaluation.
const OUT_DIR = process.env.EVAL_OUT_DIR ? join(ROOT, process.env.EVAL_OUT_DIR) : join(ROOT, 'docs', 'evidence', 'stage-5b', 'evaluation');
const RESULTS = join(OUT_DIR, 'results.jsonl');
const JOURNAL = join(OUT_DIR, 'journal.jsonl');
const MANIFEST = join(ROOT, 'data', 'evaluation', 'manifest.json');
const STORAGE_DIR = process.env.STORAGE_DIR ?? 'storage';
// OW-2: the model every job of THIS run is submitted with (default muse-spark-1.3);
// an invalid --model exits 2 before anything is read, reserved or submitted.
let MODEL: ModelChoice;
try {
  MODEL = evalModelFromArgv(process.argv);
} catch {
  console.error('--model must be one of: muse-spark-1.3, muse-spark-open (default muse-spark-1.3)');
  process.exit(2);
}
const MODEL_PROVIDER = PROVIDER_FOR_MODEL[MODEL];
// S6-W: which pipeline every job of THIS run is submitted with. The default stays
// 'activity' (v1) so the PRE-REGISTERED Stage 5b evaluation and its admission arithmetic
// are unchanged; '--flow lesson' runs the Stage 6 lesson flow (use a scratch EVAL_OUT_DIR).
let FLOW: EvalFlow;
try {
  FLOW = evalFlowFromArgv(process.argv);
} catch {
  console.error('--flow must be one of: lesson, activity (default activity)');
  process.exit(2);
}
// Concurrency (part B): how many pages THIS run keeps in flight at once. The default stays 1
// (the pre-registered sequential behaviour); an invalid --concurrency exits 2 before anything
// is read, reserved or submitted.
let CONCURRENCY: number;
try {
  CONCURRENCY = evalConcurrencyFromArgv(process.argv);
} catch {
  console.error('--concurrency must be an integer in [1, 8] (default 1)');
  process.exit(2);
}
// S5B-07: conservative per-job admission amount, derived from the configured limits
// (never the old fixed 0.15, which bounded less than a single spec attempt).
// OW-2: priced with the CHOSEN model's rates (identical numbers today).
// S6-W: lesson runs admit at the lesson worst case (analysis + 3 kit components + premium,
// each with its repair loop, at the v2 input bound).
const ADMISSION_LIMITS = admissionLimitsFromConfig(
  JSON.parse(readFileSync(join(ROOT, 'config', 'resource-limits.json'), 'utf8')),
);
const PER_JOB_ADMISSION_USD =
  FLOW === 'lesson' ? perJobLessonAdmissionUSD(ADMISSION_LIMITS, MODEL) : perJobAdmissionUSD(ADMISSION_LIMITS, MODEL);

interface ManifestEntry {
  sourceId: string; candidate: number;
  subject: 'physics' | 'finance' | 'chemistry-earth' | 'biology' | 'history';
  expected: string; acceptable: string[]; difficulty: 'easy' | 'medium' | 'hard';
  note?: string;
}

function argval(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { pages: ManifestEntry[] };
const pages = manifest.pages;
const MANIFEST_SOURCE_IDS = new Set(pages.map(p => p.sourceId));

const listMode = process.argv.includes('--list');
const rerun = process.argv.includes('--rerun');
const only = argval('--only');
const fromRaw = argval('--from');
const from = fromRaw === null ? null : Number.parseInt(fromRaw, 10);
if (fromRaw !== null && !Number.isInteger(from)) { console.error(`--from needs an integer candidate number, got "${fromRaw}"`); process.exit(2); }
const maxUsdRaw = argval('--max-usd');
const maxUsd = maxUsdRaw === null ? 4 : Number.parseFloat(maxUsdRaw);
if (maxUsdRaw !== null && !Number.isFinite(maxUsd)) { console.error(`--max-usd needs a number, got "${maxUsdRaw}"`); process.exit(2); }

interface DoneLine { sourceId: string; jobId?: string | null; totalCostUSD?: number | null }
function readDoneLines(): DoneLine[] {
  if (!existsSync(RESULTS)) return [];
  return readFileSync(RESULTS, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as DoneLine);
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

/** One API-or-storage view of a job; undefined when it cannot be found in either. */
async function fetchJobView(jobId: string): Promise<{ summary: Record<string, any>; detail?: Record<string, any> } | undefined> {
  try {
    const r = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    if (r.status === 200 && r.body?.summary && typeof r.body.summary.status === 'string') {
      return { summary: r.body.summary as Record<string, any>, detail: r.body as Record<string, any> };
    }
  } catch {
    // API not running — fall back to the storage dir
  }
  const p = join(ROOT, STORAGE_DIR, 'runs', jobId, 'job.json');
  if (existsSync(p)) {
    try {
      const s = JSON.parse(readFileSync(p, 'utf8')) as Record<string, any>;
      if (typeof s.status === 'string') return { summary: s };
    } catch {
      // an unreadable job.json counts as not found
    }
  }
  return undefined;
}

/**
 * BUG-006: the lesson components that were NOT published (failed/skipped), each with its
 * failed check ids (from the latest component report — kit components key componentReports
 * by spec id; a premium entry falls back to the persisted v1 revision report) and the fixed
 * code when its plain reason is one of the worker's two fixed output-failure sentences.
 * Empty on activity-flow jobs (no lesson detail); never invents checks or codes.
 */
function componentFailuresFromDetail(detail: any): Record<string, unknown>[] {
  const components: any[] = Array.isArray(detail?.lesson?.components) ? detail.lesson.components : [];
  const reports: Record<string, any> =
    typeof detail?.componentReports === 'object' && detail?.componentReports !== null ? detail.componentReports : {};
  const revisions: any[] = Array.isArray(detail?.revisions) ? detail.revisions : [];
  const out: Record<string, unknown>[] = [];
  for (const c of components) {
    if (c?.status === 'passed') {
      continue;
    }
    let report: any = typeof c?.specId === 'string' ? reports[c.specId] : undefined;
    if (report === undefined && typeof c?.revision === 'number') {
      report = revisions.find(r => r?.revision === c.revision)?.report;
    }
    const checks: string[] = Array.isArray(report?.checks)
      ? report.checks.filter((x: any) => x?.passed === false).map((x: any) => String(x.id))
      : [];
    const reason: string | null = typeof c?.reason === 'string' ? c.reason : null;
    let code: string | null = null;
    if (reason === OUTPUT_TRUNCATED_REASON) {
      code = 'OUTPUT_TRUNCATED';
    } else if (reason === OUTPUT_INVALID_REASON) {
      code = 'OUTPUT_INVALID';
    }
    out.push({
      componentId: typeof c?.componentId === 'string' ? c.componentId : null,
      status: typeof c?.status === 'string' ? c.status : null,
      checks,
      code,
      reason,
    });
  }
  return out;
}

/** The results.jsonl record shape, built from a full API job view (normal + recovered paths). */
function recordFromDetail(page: ResultPageFields, jobId: string, detail: any, wallS: number | null, recovered: boolean): Record<string, any> {
  const s = detail?.summary ?? {};
  const failedChecks = (detail?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const rev1 = (detail?.revisions ?? []).find((r: any) => r.revision === 1);
  const firstRevisionFailedChecks = (rev1?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const lesson = s.lesson ?? null;
  const lessonCount = (key: string): number | null => {
    const v = lesson?.[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const record: Record<string, any> = {
    sourceId: page.sourceId, candidate: page.candidate, subject: page.subject, expected: page.expected,
    acceptable: page.acceptable, difficulty: page.difficulty,
    jobId,
    // OW-2: what the job ACTUALLY ran on (job summary fields); a summary from a
    // server that predates the fields falls back to this run's requested model —
    // never null, never an invented provider.
    model: typeof s.model === 'string' && s.model !== '' ? s.model : MODEL,
    provider: typeof s.provider === 'string' && s.provider !== '' ? s.provider : MODEL_PROVIDER,
    // S6-W: the flow the job ACTUALLY ran (summary field), falling back to this run's
    // requested flow for summaries from a server that predates the field — plus the
    // lesson outcome counts and whether the page got an overview / >=1 interactive
    // component (null on activity-flow jobs; never invented).
    flow: typeof s.flow === 'string' && s.flow !== '' ? s.flow : FLOW,
    componentsPlanned: lessonCount('componentsPlanned'),
    componentsPublished: lessonCount('componentsPublished'),
    componentsFailed: lessonCount('componentsFailed'),
    overviewPublished: lesson?.overviewReady === true,
    interactivePublished: (lessonCount('componentsPublished') ?? 0) >= 1,
    partialPublish: lesson?.partialPublish === true,
    declineCode: detail?.analysisV2?.usable === false && typeof detail?.analysisV2?.declineCode === 'string'
      ? detail.analysisV2.declineCode
      : null,
    status: s.status as string,
    engine: s.engine ?? null,
    publishedRevision: s.publishedRevision ?? null,
    revisions: s.revisions ?? null,
    repairs: (s.repairs ?? []).map((r: any) => ({ targeted: r.targeted ?? [], fixed: r.fixed ?? [] })),
    // TASK-024b (additive): analysis-stage repairs, so the metrics can count natural analysis repairs.
    analysisRepairs: (s.analysisRepairs ?? []).map((r: any) => ({
      attempt: r.attempt ?? null,
      revision: r.revision ?? null,
      targeted: r.targeted ?? [],
      fixed: r.fixed ?? [],
      remaining: r.remaining ?? [],
      passed: r.passed === true,
    })),
    // BUG-006 (additive): the job's COMPONENT repairs (lesson flow; empty on activity jobs —
    // previously every results line lost them) and the component-level failures list with the
    // failed check ids and, when the entry reason is one of the worker's fixed sentences,
    // the fixed code (OUTPUT_TRUNCATED / OUTPUT_INVALID).
    componentRepairs: normaliseComponentRepairs(s.componentRepairs ?? detail?.componentRepairs),
    componentFailures: componentFailuresFromDetail(detail),
    failedChecks,
    firstRevisionFailedChecks,
    error: s.error?.code ?? null,
    unsupportedReason: detail?.analysis?.analysis?.unsupportedReason ?? null,
    totalCostUSD: typeof s.totalCostUSD === 'number' ? s.totalCostUSD : null,
    wallS,
    at: new Date().toISOString(),
  };
  if (recovered) record.recovered = true;
  return record;
}

/* ------------------------------------------------------------------ */
/* S5B-14: full-liability reconciliation, re-run before every submission */
/* ------------------------------------------------------------------ */

let doneIds = new Set<string>();
let blockedSourceIds = new Set<string>();
let spentUsd = 0;
let reservedUsd = 0;

/**
 * Concurrency (part B): jobId → tracking promise for every job THIS run submitted and is
 * still polling. A job's own poller writes its results line (rescan must never record it a
 * second time), and the entry is deleted once the line is written.
 */
const inFlight = new Map<string, Promise<void>>();

/**
 * Reconcile EVERY outstanding run liability from scratch: re-read results.jsonl and journal.jsonl,
 * look up every unrecorded journaled job, assess liabilities (conservative reservations for
 * anything unknown), persist `recovered: true` results lines for settled jobs, and print one clear
 * message per liability. Called at start, freshly before each submission, and again after the idle
 * wait — a job that settles while the driver waits is re-read here and its real cost replaces its
 * reservation.
 */
async function rescan(): Promise<void> {
  const doneLines = readDoneLines();
  const journal = parseJournal(existsSync(JOURNAL) ? readFileSync(JOURNAL, 'utf8') : '');
  const recordedJobIds = new Set(
    doneLines.map(l => l.jobId).filter((j): j is string => typeof j === 'string' && j !== ''),
  );
  const candidateIds = [...new Set(journal.jobs.filter(e => !recordedJobIds.has(e.jobId)).map(e => e.jobId))];
  const views = new Map<string, { summary: Record<string, any>; detail?: Record<string, any> } | undefined>();
  for (const jobId of candidateIds) {
    views.set(jobId, await fetchJobView(jobId));
  }
  const res: AssessLiabilitiesResult = assessLiabilities({
    resultsLines: doneLines,
    journal,
    summaryOf: id => views.get(id)?.summary,
    perJobAdmissionUSD: PER_JOB_ADMISSION_USD,
    manifestSourceIds: MANIFEST_SOURCE_IDS,
  });
  // Persist settled-but-unrecorded jobs (once — the results file then covers them on later passes).
  for (const { entry, summary } of res.recoverable) {
    // Concurrency (part B): a job THIS run is still polling records its own results line when
    // its poller sees the settle — writing a recovery line here would duplicate the page. Its
    // settled cost is already counted into spentUsd by assessLiabilities, so the admission
    // arithmetic stays correct while the line is still outstanding.
    if (inFlight.has(entry.jobId)) continue;
    const page = pages.find(p => p.sourceId === entry.sourceId);
    if (page === undefined) continue; // defensive; assessLiabilities routes out-of-manifest to unrecordable
    const view = views.get(entry.jobId);
    const record =
      view?.detail !== undefined
        ? recordFromDetail(page, entry.jobId, view.detail, null, true)
        : recoveredRecord(page, summary, new Date().toISOString());
    // OW-2: a recovered record from a pre-OW-2 summary carries null model/provider;
    // this run's requested model is the honest fallback (the journal is per-run).
    record.model ??= MODEL;
    record.provider ??= MODEL_PROVIDER;
    appendFileSync(RESULTS, JSON.stringify(record) + '\n');
    const cost = record.totalCostUSD;
    console.log(
      `journal recovery: ${entry.sourceId} → job ${entry.jobId} settled '${String(record.status)}', ` +
        (typeof cost === 'number'
          ? `cost $${cost.toFixed(6)} — recorded (recovered: true), counted toward the budget`
          : `cost UNKNOWN — recorded (recovered: true) and a conservative $${PER_JOB_ADMISSION_USD.toFixed(3)} reservation is held for it (S5B-14)`),
    );
  }
  for (const { entry, summary, costUsd } of res.unrecordable) {
    console.warn(
      `journal recovery: "${entry.sourceId}" (job ${entry.jobId}) settled '${String(summary.status)}' with cost ` +
        `$${costUsd.toFixed(6)} but its source is NOT in the manifest — no results line can be written; its cost ` +
        'still COUNTS toward the budget (S5B-14). Resolve manually if it needs a record.',
    );
  }
  for (const l of res.liabilities) {
    console.warn(`OUTSTANDING LIABILITY: ${describeLiability(l)}`);
  }
  if (res.liabilities.length > 0) {
    console.log(`liabilities: ${res.liabilities.length} outstanding item(s) hold $${res.reservedUsd.toFixed(3)} in reservations.`);
  }
  spentUsd = res.spentUsd;
  reservedUsd = res.reservedUsd;
  blockedSourceIds = res.blockedSourceIds;
  doneIds = new Set([
    ...doneLines.map(l => l.sourceId),
    ...res.recoverable.map(r => r.entry.sourceId),
  ]);
}

// Start-of-run state. --list stays I/O-light: results file only, no journal/API reconciliation
// (its plan therefore ignores outstanding journal liabilities, like the pre-S5B-14 --list did).
mkdirSync(OUT_DIR, { recursive: true });
{
  const initial = readDoneLines();
  doneIds = new Set(initial.map(l => l.sourceId));
  spentUsd = initial.reduce((s, l) => s + (typeof l.totalCostUSD === 'number' ? l.totalCostUSD : 0), 0);
}
if (!listMode) await rescan();

const plan = pages.filter(p =>
  (only === null || p.sourceId === only) &&
  (from === null || p.candidate >= from) &&
  (rerun || !doneIds.has(p.sourceId)) &&
  !blockedSourceIds.has(p.sourceId));

if (only !== null && !pages.some(p => p.sourceId === only)) {
  console.error(`--only: unknown sourceId "${only}" (not in data/evaluation/manifest.json)`);
  process.exit(2);
}

if (listMode) {
  console.log(`Evaluation plan: ${plan.length} of ${pages.length} pages to run (model ${MODEL} via ${MODEL_PROVIDER}, flow ${FLOW}; already done: ${doneIds.size}; spent so far: $${spentUsd.toFixed(2)}; budget: $${maxUsd.toFixed(2)}; per-job admission: $${PER_JOB_ADMISSION_USD.toFixed(3)} worst-case reservation from config/resource-limits.json)`);
  for (const p of plan) {
    const acc = p.acceptable.length > 0 ? ` (also acceptable: ${p.acceptable.join(', ')})` : '';
    console.log(`[${String(p.candidate).padStart(2)}/${pages.length}] ${p.sourceId.padEnd(42)} ${p.subject.padEnd(16)} ${p.difficulty.padEnd(6)} expected ${p.expected}${acc}`);
  }
  process.exit(0);
}

/** Concurrency (part B): wait until THIS run's own pool has a free slot. */
async function waitForSlot(): Promise<void> {
  while (inFlight.size >= CONCURRENCY) {
    await Promise.race([...inFlight.values()]);
  }
}

/** Concurrency (part B): wait until every job this run submitted has settled and been recorded. */
async function drainInFlight(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.race([...inFlight.values()]);
  }
}

/**
 * Wait until the SERVER has a free job slot — the successor of the old waitIdle. A server
 * that reports running/maxConcurrentJobs (concurrency, part B) has capacity while
 * running < limit; an older server (or the S5B-14 test fake) that only reports `busy` keeps
 * the old capacity signal (busy === false), so the default sequential behaviour is unchanged.
 */
async function waitForCapacity(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const h = await api('/api/health');
    const body = (h.body ?? {}) as Record<string, unknown>;
    const running = typeof body['running'] === 'number' ? (body['running'] as number) : null;
    const limit =
      typeof body['maxConcurrentJobs'] === 'number' && (body['maxConcurrentJobs'] as number) > 0
        ? (body['maxConcurrentJobs'] as number)
        : null;
    const capacity = running !== null && limit !== null ? running < limit : body['busy'] === false;
    if (capacity) return;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('server stayed busy');
}

console.log(`Running ${plan.length} evaluation job(s), ${CONCURRENCY === 1 ? 'one at a time' : `up to ${CONCURRENCY} at a time`}, model ${MODEL} via ${MODEL_PROVIDER}, flow ${FLOW}. Budget $${maxUsd.toFixed(2)}, spent $${spentUsd.toFixed(2)} (known settled), reserved $${reservedUsd.toFixed(3)} (outstanding liabilities), per-job admission $${PER_JOB_ADMISSION_USD.toFixed(3)}.`);

function admissionFails(): boolean {
  return !admissionAllowed({ spentUsd, reservedUsd, perJobAdmissionUSD: PER_JOB_ADMISSION_USD, maxUsd });
}

function budgetStop(p: ManifestEntry): void {
  console.log(
    `Budget stop: spent $${spentUsd.toFixed(3)} + reserved $${reservedUsd.toFixed(3)} + per-job admission ` +
      `$${PER_JOB_ADMISSION_USD.toFixed(3)} would exceed --max-usd $${maxUsd.toFixed(2)} ` +
      `(admission rule: spent + reserved + admission <= max, re-checked before every submission). ` +
      `Not starting ${p.sourceId}. Resolve the outstanding liabilities above (or record their real costs) and re-run, or raise --max-usd.`,
  );
}

/**
 * The S5B-14 admission decision for one page, concurrency-aware: 'ok' → submit; 'skip' →
 * this page is blocked by an outstanding liability (continue with the next page); 'stop' →
 * the budget is exhausted (end the run). When the run's OWN in-flight jobs hold the
 * reservations that block the next page, wait for them to settle — their real costs replace
 * the per-job reservations — rescan and check once more before deciding. With the default
 * concurrency 1 the pool is always empty here, so this is exactly the old immediate
 * blocked-continue / budget-stop-break behaviour.
 */
async function admissionGate(p: ManifestEntry): Promise<'ok' | 'skip' | 'stop'> {
  const tag = `[${p.candidate}/${pages.length}] ${p.sourceId}`;
  for (let round = 0; round < 2; round++) {
    if (blockedSourceIds.has(p.sourceId)) {
      console.log(`${tag} → BLOCKED: an outstanding liability (see above) holds a reservation for this page — not submitting it. Resolve the liability and re-run.`);
      return 'skip';
    }
    if (!admissionFails()) {
      return 'ok';
    }
    if (inFlight.size > 0 && round === 0) {
      console.log(
        `${tag} → admission held: ${inFlight.size} in-flight job(s) hold $${(inFlight.size * PER_JOB_ADMISSION_USD).toFixed(3)} ` +
          'in per-job reservations; waiting for them to settle so their REAL costs replace the reservations before re-checking the admission rule.',
      );
      await drainInFlight();
      await rescan();
      continue;
    }
    budgetStop(p);
    return 'stop';
  }
  budgetStop(p);
  return 'stop';
}

/**
 * Poll ONE submitted job to settlement, write its results line and print the same per-page
 * line the sequential driver has always printed. Runs concurrently with the other pollers
 * when --concurrency > 1: results-line order may differ from the plan order, but each page
 * is recorded exactly once.
 */
async function pollAndRecord(p: ManifestEntry, jobId: string, started: number): Promise<void> {
  const tag = `[${p.candidate}/${pages.length}] ${p.sourceId}`;
  let detail: any = null;
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    detail = (await api(`/api/jobs/${jobId}`)).body;
    if (detail?.summary?.status && detail.summary.status !== 'running') break;
  }
  const wallS = Math.round((Date.now() - started) / 100) / 10;
  const s = detail?.summary ?? {};
  if (!s.status || s.status === 'running') {
    console.error(
      `${tag} → job ${jobId} did not settle within the poll window. It stays in journal.jsonl: the next start ` +
        `reconciles it and holds a $${PER_JOB_ADMISSION_USD.toFixed(3)} reservation for it until it does (S5B-14). ` +
        'Aborting run; nothing recorded.',
    );
    process.exit(1);
  }
  const record = recordFromDetail(p, jobId, detail, wallS, false);
  appendFileSync(RESULTS, JSON.stringify(record) + '\n');
  if (typeof record.totalCostUSD === 'number') spentUsd += record.totalCostUSD;
  else reservedUsd += PER_JOB_ADMISSION_USD; // unknown cost: reserved until known (the next rescan recomputes)

  const checks = s.checksTotal != null ? `${s.checksPassed ?? '?'}/${s.checksTotal}` : '—';
  const cost = record.totalCostUSD === null ? '—' : `$${(record.totalCostUSD as number).toFixed(2)}`;
  let outcome: string;
  if (FLOW === 'lesson' && s.status === 'succeeded') {
    outcome = `overview${record.interactivePublished ? ' +' : ' only, no'} interactive (${record.componentsPublished ?? 0}/${record.componentsPlanned ?? 0} components${record.partialPublish ? ', partial publish' : ''})`;
  } else if (s.status === 'succeeded') outcome = `published r${record.publishedRevision}`;
  else if (s.status === 'unsupported') outcome = `declined${record.declineCode ? ` (${record.declineCode})` : ''}`;
  else outcome = `failed ${record.error ?? ''}`.trim();
  console.log(`${tag} → ${outcome} · ${checks} · ${cost} · ${Math.round(wallS)}s`);
}

for (const p of plan) {
  const tag = `[${p.candidate}/${pages.length}] ${p.sourceId}`;
  // Concurrency (part B): never more than CONCURRENCY of this run's own jobs in flight.
  await waitForSlot();
  // S5B-14: reconcile ALL outstanding run liabilities FRESHLY before every submission — not
  // only at start. Under concurrency the reserved figure includes a per-job admission
  // reservation for EVERY in-flight job (each is journaled and still 'running') plus every
  // other outstanding liability, so admitting another page beside them can never overshoot
  // the cap: spent + reserved + perJobAdmissionUSD <= --max-usd is checked before each POST.
  await rescan();
  let gate = await admissionGate(p);
  if (gate === 'skip') continue;
  if (gate === 'stop') break;
  await waitForCapacity();
  // S5B-14: re-check AFTER the capacity wait — a job that settled while waiting is re-read by
  // the rescan and its real cost replaces its reservation before this submission is admitted.
  await rescan();
  gate = await admissionGate(p);
  if (gate === 'skip') continue;
  if (gate === 'stop') break;
  // S5B-14: durable pre-submit intent BEFORE the POST — closes the POST→journal crash window.
  // An intent left without a job line is an uncertain-submission liability on the next start.
  const intentId = `intent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  appendFileSync(JOURNAL, JSON.stringify({ intentId, sourceId: p.sourceId, at: new Date().toISOString() }) + '\n');
  const started = Date.now();
  // OW-2: the model travels with EVERY submission; the server builds the right
  // client per job and rejects unknown models with 400 MODEL_INVALID.
  const j = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ sourceId: p.sourceId, model: MODEL, flow: FLOW }) });
  if (j.status !== 202) {
    console.error(
      `${tag} → JOB_POST failed (HTTP ${j.status}): ${JSON.stringify(j.body).slice(0, 200)}. Aborting run; nothing recorded. ` +
        `The pre-submit intent ${intentId} in journal.jsonl stays OUTSTANDING (a non-202 does not prove no job was created): ` +
        `the next start holds a $${PER_JOB_ADMISSION_USD.toFixed(3)} reservation for it and will not re-submit "${p.sourceId}" ` +
        `until you resolve it — append {"jobId":"<id>","sourceId":"${p.sourceId}","intentId":"${intentId}"} if a job was created, ` +
        `or {"intentId":"${intentId}","resolution":"not-submitted"} once verified none was.`,
    );
    process.exit(1);
  }
  const jobId = j.body.jobId as string;
  // S5B-07: journal the submission BEFORE waiting — a crash or poll failure can no
  // longer leave paid work outside the budget bookkeeping on restart.
  appendFileSync(JOURNAL, JSON.stringify({ jobId, sourceId: p.sourceId, intentId, at: new Date().toISOString() }) + '\n');
  // Concurrency (part B): track the poller instead of awaiting it inline — it records the
  // results line, prints the per-page line and frees the pool slot when the job settles.
  const tracked = (async (): Promise<void> => {
    try {
      await pollAndRecord(p, jobId, started);
    } finally {
      inFlight.delete(jobId);
    }
  })();
  inFlight.set(jobId, tracked);
}
// Every submitted job has settled and been recorded before the final accounting.
await drainInFlight();
if (CONCURRENCY > 1) {
  // A concurrent run recomputes the final figures from the files (its results lines may have
  // been written in a different order than the plan); the sequential run keeps its running
  // totals, exactly as before.
  await rescan();
}

console.log(`Done. Model ${MODEL} via ${MODEL_PROVIDER}, flow ${FLOW}. Spent (known settled) $${spentUsd.toFixed(2)} + reserved (outstanding liabilities) $${reservedUsd.toFixed(3)} of budget $${maxUsd.toFixed(2)} (per-job admission $${PER_JOB_ADMISSION_USD.toFixed(3)}). Results: ${RESULTS}`);
