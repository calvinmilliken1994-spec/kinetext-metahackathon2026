// TASK-023b evaluation driver. Runs the data/evaluation/manifest.json pages through the LIVE API
// (http://127.0.0.1:8787, META_LIVE=1) one job at a time — never two at once — with NO demo faults,
// so every repair it records is a natural model failure repaired by Muse.
//
// Usage (foreground; the local live API must already be running):
//   node scripts/evaluation-run.ts --list                # print the plan, no API calls
//   node scripts/evaluation-run.ts                       # run everything not yet in results.jsonl
//   node scripts/evaluation-run.ts --only <sourceId>     # run a single page
//   node scripts/evaluation-run.ts --from <n>            # resume at candidate number n (1-29)
//   node scripts/evaluation-run.ts --max-usd <x>         # stop BEFORE a job when spent + 0.15 would exceed x (default 4)
//   node scripts/evaluation-run.ts --rerun               # re-run pages that already have a result line
//
// Appends one JSON line per finished job to docs/evidence/stage-5b/evaluation/results.jsonl.
// Modelled on scripts/stage5-live-runs.ts (TASK-017).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'http://127.0.0.1:8787';
// EVAL_OUT_DIR (relative to the repo root) keeps follow-up runs apart from the pre-registered evaluation.
const OUT_DIR = process.env.EVAL_OUT_DIR ? join(ROOT, process.env.EVAL_OUT_DIR) : join(ROOT, 'docs', 'evidence', 'stage-5b', 'evaluation');
const RESULTS = join(OUT_DIR, 'results.jsonl');
const MANIFEST = join(ROOT, 'data', 'evaluation', 'manifest.json');
const PER_JOB_RESERVE_USD = 0.15;

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

// Existing results: which sources are done, and how much has already been spent (every line counts).
interface DoneLine { sourceId: string; totalCostUSD?: number | null }
let doneLines: DoneLine[] = [];
if (existsSync(RESULTS)) {
  doneLines = readFileSync(RESULTS, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as DoneLine);
}
const doneIds = new Set(doneLines.map(l => l.sourceId));
let spentUsd = doneLines.reduce((s, l) => s + (typeof l.totalCostUSD === 'number' ? l.totalCostUSD : 0), 0);

const plan = pages.filter(p =>
  (only === null || p.sourceId === only) &&
  (from === null || p.candidate >= from) &&
  (rerun || !doneIds.has(p.sourceId)));

if (only !== null && !pages.some(p => p.sourceId === only)) {
  console.error(`--only: unknown sourceId "${only}" (not in data/evaluation/manifest.json)`);
  process.exit(2);
}

if (listMode) {
  console.log(`Evaluation plan: ${plan.length} of ${pages.length} pages to run (already done: ${doneIds.size}; spent so far: $${spentUsd.toFixed(2)}; budget: $${maxUsd.toFixed(2)}; per-job reserve: $${PER_JOB_RESERVE_USD.toFixed(2)})`);
  for (const p of plan) {
    const acc = p.acceptable.length > 0 ? ` (also acceptable: ${p.acceptable.join(', ')})` : '';
    console.log(`[${String(p.candidate).padStart(2)}/${pages.length}] ${p.sourceId.padEnd(42)} ${p.subject.padEnd(16)} ${p.difficulty.padEnd(6)} expected ${p.expected}${acc}`);
  }
  process.exit(0);
}

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const r = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

async function waitIdle(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const h = await api('/api/health');
    if (h.body?.busy === false) return;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('server stayed busy');
}

console.log(`Running ${plan.length} evaluation job(s), one at a time. Budget $${maxUsd.toFixed(2)}, spent $${spentUsd.toFixed(2)}.`);
mkdirSync(OUT_DIR, { recursive: true });

for (const p of plan) {
  // Budget guard: stop BEFORE starting a job when spent + the per-job reserve would exceed the cap.
  if (spentUsd + PER_JOB_RESERVE_USD > maxUsd) {
    console.log(`Budget stop: spent $${spentUsd.toFixed(2)} + reserve $${PER_JOB_RESERVE_USD.toFixed(2)} would exceed --max-usd $${maxUsd.toFixed(2)}. Not starting ${p.sourceId}.`);
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
  let detail: any = null;
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 2000));
    detail = (await api(`/api/jobs/${jobId}`)).body;
    if (detail?.summary?.status && detail.summary.status !== 'running') break;
  }
  const wallS = Math.round((Date.now() - started) / 100) / 10;
  const s = detail?.summary ?? {};
  if (!s.status || s.status === 'running') {
    console.error(`${tag} → job ${jobId} did not settle within the poll window. Aborting run; nothing recorded.`);
    process.exit(1);
  }
  const failedChecks = (detail?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const rev1 = (detail?.revisions ?? []).find((r: any) => r.revision === 1);
  const firstRevisionFailedChecks = (rev1?.report?.checks ?? []).filter((c: any) => !c.passed).map((c: any) => c.id as string);
  const record = {
    sourceId: p.sourceId, candidate: p.candidate, subject: p.subject, expected: p.expected,
    acceptable: p.acceptable, difficulty: p.difficulty,
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
  appendFileSync(RESULTS, JSON.stringify(record) + '\n');
  if (typeof record.totalCostUSD === 'number') spentUsd += record.totalCostUSD;

  const checks = s.checksTotal != null ? `${s.checksPassed ?? '?'}/${s.checksTotal}` : '—';
  const cost = record.totalCostUSD === null ? '—' : `$${record.totalCostUSD.toFixed(2)}`;
  let outcome: string;
  if (s.status === 'succeeded') outcome = `published r${record.publishedRevision}`;
  else if (s.status === 'unsupported') outcome = 'declined';
  else outcome = `failed ${record.error ?? ''}`.trim();
  console.log(`${tag} → ${outcome} · ${checks} · ${cost} · ${Math.round(wallS)}s`);
}

console.log(`Done. Spent this session+past: $${spentUsd.toFixed(2)} of $${maxUsd.toFixed(2)}. Results: docs/evidence/stage-5b/evaluation/results.jsonl`);
