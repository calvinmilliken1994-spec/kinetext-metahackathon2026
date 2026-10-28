// TASK-023b evaluation driver. Runs the data/evaluation/manifest.json pages through the LIVE API
// (http://127.0.0.1:8787, META_LIVE=1) one job at a time — never two at once — with NO demo faults,
// so every repair it records is a natural model failure repaired by Muse.
//
// Usage (foreground; the local live API must already be running):
//   node scripts/evaluation-run.ts --list                # print the plan, no API calls
//   node scripts/evaluation-run.ts                       # run everything not yet in results.jsonl
//   node scripts/evaluation-run.ts --only <sourceId>     # run a single page
//   node scripts/evaluation-run.ts --from <n>            # resume at candidate number n (1-29)
//   node scripts/evaluation-run.ts --max-usd <x>         # admission cap (default 4): refuse to SUBMIT a job
//       when spent-so-far + the per-job admission amount would exceed x. The admission amount is the
//       conservative worst-case reservation for one job, derived from config/resource-limits.json
//       (maxInputTokens, maxOutputTokens, analysisMaxOutputTokens, maxRepairAttempts for BOTH the
//       analysis and the spec repair loop, maxRetries) via packages/meta/pricing.ts reservationUSD —
//       USD 1.704 per job at the current caps (S5B-07; the old fixed 0.15 did not bound even one spec
//       attempt's 0.176 reservation). It is a driver-side ADMISSION bound on reservation estimates
//       (DEBT-003 assumptions), not a provider-side billing guarantee; the spend ledger enforces its
//       own cap separately.
//   node scripts/evaluation-run.ts --rerun               # re-run pages that already have a result line
//
// Appends one JSON line per finished job to docs/evidence/stage-5b/evaluation/results.jsonl.
// S5B-07: every submission is journaled (journal.jsonl beside the results, appended BEFORE waiting).
// On start, journaled jobs without a results line are reconciled — via API GET /api/jobs/:id, else the
// storage dir (STORAGE_DIR, default storage/runs/<jobId>/job.json): settled jobs get a results line
// marked `recovered: true` with their real cost counted into the budget; still-running or unresolvable
// jobs block their page from being re-submitted.
// Modelled on scripts/stage5-live-runs.ts (TASK-017).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admissionLimitsFromConfig,
  parseJournalLine,
  perJobAdmissionUSD,
  reconcileJournal,
  recoveredRecord,
} from './evaluation-budget.ts';
import type { JournalEntry, ResultPageFields } from './evaluation-budget.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8787';
// EVAL_OUT_DIR (relative to the repo root) keeps follow-up runs apart from the pre-registered evaluation.
const OUT_DIR = process.env.EVAL_OUT_DIR ? join(ROOT, process.env.EVAL_OUT_DIR) : join(ROOT, 'docs', 'evidence', 'stage-5b', 'evaluation');
const RESULTS = join(OUT_DIR, 'results.jsonl');
const JOURNAL = join(OUT_DIR, 'journal.jsonl');
const MANIFEST = join(ROOT, 'data', 'evaluation', 'manifest.json');
const STORAGE_DIR = process.env.STORAGE_DIR ?? 'storage';
// S5B-07: conservative per-job admission amount, derived from the configured limits
// (never the old fixed 0.15, which bounded less than a single spec attempt).
const PER_JOB_ADMISSION_USD = perJobAdmissionUSD(
  admissionLimitsFromConfig(JSON.parse(readFileSync(join(ROOT, 'config', 'resource-limits.json'), 'utf8'))),
);

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

const listMode = process.argv.includes('--list');
const rerun = process.argv.includes('--rerun');
const only = argval('--only');
const fromRaw = argval('--from');
const from = fromRaw === null ? null : Number.parseInt(fromRaw, 10);
if (fromRaw !== null && !Number.isInteger(from)) { console.error(`--from needs an integer candidate number, got "${fromRaw}"`); process.exit(2); }
const maxUsdRaw = argval('--max-usd');
const maxUsd = maxUsdRaw === null ? 4 : Number.parseFloat(maxUsdRaw);
if (maxUsdRaw !== null && !Number.isFinite(maxUsd)) { console.error(`--max-usd needs a number, got "${maxUsdRaw}"`); process.exit(2); }

// Existing results: which sources are done, which job ids are recorded, and how much
// has already been spent (every line counts).
interface DoneLine { sourceId: string; jobId?: string | null; totalCostUSD?: number | null }
let doneLines: DoneLine[] = [];
if (existsSync(RESULTS)) {
  doneLines = readFileSync(RESULTS, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as DoneLine);
}
const doneIds = new Set(doneLines.map(l => l.sourceId));
let spentUsd = doneLines.reduce((s, l) => s + (typeof l.totalCostUSD === 'number' ? l.totalCostUSD : 0), 0);

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

/** The results.jsonl record shape, built from a full API job view (normal + recovered paths). */
function recordFromDetail(page: ResultPageFields, jobId: string, detail: any, wallS: number | null, recovered: boolean): Record<string, any> {
  const s = detail?.summary ?? {};
  const failedChecks = (detail?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const rev1 = (detail?.revisions ?? []).find((r: any) => r.revision === 1);
  const firstRevisionFailedChecks = (rev1?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const record: Record<string, any> = {
    sourceId: page.sourceId, candidate: page.candidate, subject: page.subject, expected: page.expected,
    acceptable: page.acceptable, difficulty: page.difficulty,
    jobId,
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

// S5B-07 journal reconciliation: settle the accounts of submitted-but-unrecorded jobs
// BEFORE planning, so their costs count and their pages are never re-submitted while
// the journaled job is running, finished-but-unrecorded, or unresolvable.
const blockedSourceIds = new Set<string>();
mkdirSync(OUT_DIR, { recursive: true });
if (!listMode && existsSync(JOURNAL)) {
  const journal: JournalEntry[] = [];
  for (const line of readFileSync(JOURNAL, 'utf8').split('\n')) {
    const e = parseJournalLine(line);
    if (e !== null) journal.push(e);
  }
  const recordedJobIds = new Set(
    doneLines.map(l => l.jobId).filter((j): j is string => typeof j === 'string' && j !== ''),
  );
  const candidateIds = [...new Set(journal.filter(e => !recordedJobIds.has(e.jobId)).map(e => e.jobId))];
  if (candidateIds.length > 0) {
    const views = new Map<string, { summary: Record<string, any>; detail?: Record<string, any> } | undefined>();
    for (const jobId of candidateIds) {
      views.set(jobId, await fetchJobView(jobId));
    }
    const recon = reconcileJournal({ journal, recordedJobIds, summaryOf: id => views.get(id)?.summary });
    for (const { entry, summary } of recon.recovered) {
      const page = pages.find(p => p.sourceId === entry.sourceId);
      if (page === undefined) {
        console.warn(`journal recovery: "${entry.sourceId}" (job ${entry.jobId}) is not in the manifest — left unrecorded; resolve manually.`);
        blockedSourceIds.add(entry.sourceId);
        continue;
      }
      const view = views.get(entry.jobId);
      const record =
        view?.detail !== undefined
          ? recordFromDetail(page, entry.jobId, view.detail, null, true)
          : recoveredRecord(page, summary, new Date().toISOString());
      appendFileSync(RESULTS, JSON.stringify(record) + '\n');
      const cost = record.totalCostUSD;
      if (typeof cost === 'number') spentUsd += cost;
      doneIds.add(entry.sourceId);
      console.log(
        `journal recovery: ${entry.sourceId} → job ${entry.jobId} settled '${String(record.status)}', ` +
          `cost ${typeof cost === 'number' ? `$${cost.toFixed(6)}` : 'UNKNOWN (not counted)'} — recorded (recovered: true)`,
      );
    }
    for (const e of recon.running) {
      blockedSourceIds.add(e.sourceId);
      console.log(`journal: job ${e.jobId} (${e.sourceId}) is still RUNNING — not re-submitting that page.`);
    }
    for (const e of recon.unresolved) {
      blockedSourceIds.add(e.sourceId);
      console.warn(
        `journal: job ${e.jobId} (${e.sourceId}) could not be resolved (no API record, no ${STORAGE_DIR}/runs job.json) — ` +
          'not re-submitting; resolve it manually or add a results line for it.',
      );
    }
  }
}

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
  console.log(`Evaluation plan: ${plan.length} of ${pages.length} pages to run (already done: ${doneIds.size}; spent so far: $${spentUsd.toFixed(2)}; budget: $${maxUsd.toFixed(2)}; per-job admission: $${PER_JOB_ADMISSION_USD.toFixed(3)} worst-case reservation from config/resource-limits.json)`);
  for (const p of plan) {
    const acc = p.acceptable.length > 0 ? ` (also acceptable: ${p.acceptable.join(', ')})` : '';
    console.log(`[${String(p.candidate).padStart(2)}/${pages.length}] ${p.sourceId.padEnd(42)} ${p.subject.padEnd(16)} ${p.difficulty.padEnd(6)} expected ${p.expected}${acc}`);
  }
  process.exit(0);
}

async function waitIdle(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const h = await api('/api/health');
    if (h.body?.busy === false) return;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('server stayed busy');
}

console.log(`Running ${plan.length} evaluation job(s), one at a time. Budget $${maxUsd.toFixed(2)}, spent $${spentUsd.toFixed(2)}, per-job admission $${PER_JOB_ADMISSION_USD.toFixed(3)}.`);

for (const p of plan) {
  // S5B-07 budget guard: stop BEFORE submitting when spent + the conservative per-job
  // admission amount (worst-case reservation for one job at the configured limits)
  // would exceed the cap.
  if (spentUsd + PER_JOB_ADMISSION_USD > maxUsd) {
    console.log(`Budget stop: spent $${spentUsd.toFixed(2)} + admission $${PER_JOB_ADMISSION_USD.toFixed(3)} would exceed --max-usd $${maxUsd.toFixed(2)}. Not starting ${p.sourceId}.`);
    break;
  }
  const tag = `[${p.candidate}/${pages.length}] ${p.sourceId}`;
  await waitIdle();
  const started = Date.now();
  const j = await api('/api/jobs', { method: 'POST', body: JSON.stringify({ sourceId: p.sourceId }) });
  if (j.status !== 202) {
    console.error(`${tag} → JOB_POST failed (HTTP ${j.status}): ${JSON.stringify(j.body).slice(0, 200)}. Aborting run; nothing recorded.`);
    process.exit(1);
  }
  const jobId = j.body.jobId as string;
  // S5B-07: journal the submission BEFORE waiting — a crash or poll failure can no
  // longer leave paid work outside the budget bookkeeping on restart.
  appendFileSync(JOURNAL, JSON.stringify({ jobId, sourceId: p.sourceId, at: new Date().toISOString() }) + '\n');
  let detail: any = null;
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    detail = (await api(`/api/jobs/${jobId}`)).body;
    if (detail?.summary?.status && detail.summary.status !== 'running') break;
  }
  const wallS = Math.round((Date.now() - started) / 100) / 10;
  const s = detail?.summary ?? {};
  if (!s.status || s.status === 'running') {
    console.error(`${tag} → job ${jobId} did not settle within the poll window. It stays in journal.jsonl and will be reconciled on the next start. Aborting run; nothing recorded.`);
    process.exit(1);
  }
  const record = recordFromDetail(p, jobId, detail, wallS, false);
  appendFileSync(RESULTS, JSON.stringify(record) + '\n');
  if (typeof record.totalCostUSD === 'number') spentUsd += record.totalCostUSD;

  const checks = s.checksTotal != null ? `${s.checksPassed ?? '?'}/${s.checksTotal}` : '—';
  const cost = record.totalCostUSD === null ? '—' : `$${(record.totalCostUSD as number).toFixed(2)}`;
  let outcome: string;
  if (s.status === 'succeeded') outcome = `published r${record.publishedRevision}`;
  else if (s.status === 'unsupported') outcome = 'declined';
  else outcome = `failed ${record.error ?? ''}`.trim();
  console.log(`${tag} → ${outcome} · ${checks} · ${cost} · ${Math.round(wallS)}s`);
}

console.log(`Done. Spent this session+past: $${spentUsd.toFixed(2)} of $${maxUsd.toFixed(2)} (per-job admission $${PER_JOB_ADMISSION_USD.toFixed(3)}). Results: ${RESULTS}`);
