// Concurrency (BUG-006 wave, part B) — integration tests for the REAL evaluation driver
// (scripts/evaluation-run.ts) with `--concurrency N` against an in-process fake transport
// (same technique as tests/evaluation-run-liabilities.test.ts: child node process, preloaded
// fake fetch, scratch-only EVAL_OUT_DIR/STORAGE_DIR — no sockets, no network, no API server).
//
// Covers:
//   * --concurrency 2 actually overlaps two jobs in flight, journals intent+job per submit,
//     and records each page EXACTLY once (order may differ);
//   * admission reserves perJobAdmissionUSD for EVERY in-flight job plus outstanding journal
//     liabilities before each submit — the driver can never have more in-flight worst-case
//     spend than --max-usd admits (no overshoot under concurrency);
//   * --concurrency parsing fails closed (exit 2) on anything but an integer >= 1;
//   * BUG-006 results-line fix: lesson runs record the job's componentRepairs and a
//     component-level failures list (componentId + failed check ids + fixed code) on both the
//     normal and the journal-recovered results lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'data', 'evaluation', 'manifest.json'), 'utf8')) as {
  pages: { sourceId: string; candidate: number }[];
};
const PAGE0 = MANIFEST.pages[0].sourceId;
const PAGE1 = MANIFEST.pages[1].sourceId;
const PAGE27 = MANIFEST.pages[26].sourceId;
const PAGE28 = MANIFEST.pages[27].sourceId;
const PAGE29 = MANIFEST.pages[28].sourceId;
/** perJobAdmissionUSD (v1 activity flow) at the current config caps. */
const ADM = 1.704;

/* ------------------------------------------------------------------ */
/* fake transport preload: a server that tracks in-flight jobs          */
/* ------------------------------------------------------------------ */

const PRELOAD_SRC = `
// FAKE_SETTLE_POLLS   polls of one job before it settles (default 2)
// FAKE_MIN_SUBMITS    no job settles before this many POSTs happened (default 1) — forces overlap
// FAKE_SETTLE_COST    settled totalCostUSD per job (default 0.2)
const SETTLE_POLLS = Number(process.env.FAKE_SETTLE_POLLS ?? '2');
const MIN_SUBMITS = Number(process.env.FAKE_MIN_SUBMITS ?? '1');
const SETTLE_COST = Number(process.env.FAKE_SETTLE_COST ?? '0.2');
let submits = 0;
let peak = 0;
const polls = {};
const settled = {};
function settledCount() { return Object.keys(settled).length; }
globalThis.setTimeout = (cb) => { queueMicrotask(cb); return 0; };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  console.log('FAKE_REQUEST ' + method + ' ' + u);
  if (u.endsWith('/api/health')) {
    return Response.json({
      ok: true, live: true,
      busy: false,
      running: submits - settledCount(),
      maxConcurrentJobs: 8,
      models: { 'muse-spark-1.3': true, 'muse-spark-open': false },
    });
  }
  // A pre-existing (previous-run) job that never settles: the driver must report it ONCE.
  if (u.endsWith('/api/jobs/old-job')) {
    return Response.json({ summary: { jobId: 'old-job', status: 'running' } });
  }
  if (method === 'POST' && u.endsWith('/api/jobs')) {
    submits += 1;
    const inflight = submits - settledCount();
    if (inflight > peak) peak = inflight;
    console.log('FAKE_SUBMITTED ' + submits);
    console.log('FAKE_PEAK ' + peak);
    return Response.json({ jobId: 'job-' + submits }, { status: 202 });
  }
  const m = /\\/api\\/jobs\\/(job-\\d+)$/.exec(u);
  if (m && method === 'GET') {
    const id = m[1];
    polls[id] = (polls[id] ?? 0) + 1;
    if (!settled[id] && polls[id] >= SETTLE_POLLS && submits >= MIN_SUBMITS) {
      settled[id] = true;
    }
    if (settled[id]) {
      return Response.json({ summary: { jobId: id, status: 'unsupported', totalCostUSD: SETTLE_COST } });
    }
    return Response.json({ summary: { jobId: id, status: 'running' } });
  }
  throw new Error('Unexpected fake request: ' + method + ' ' + u);
};
`;

/* ------------------------------------------------------------------ */
/* fake transport preload: a lesson detail for the results-line test    */
/* ------------------------------------------------------------------ */

const TRUNCATED_REASON = 'Muse ran out of room while writing this part, so it was left out.';
const CM_REPAIR = {
  componentId: 'concept-map-v1',
  attempt: 1,
  revision: 2,
  targeted: ['CM-03'],
  fixed: [],
  remaining: ['CM-03'],
  passed: false,
};
const LESSON_DETAIL = {
  summary: {
    jobId: 'new-job',
    status: 'succeeded',
    flow: 'lesson',
    totalCostUSD: 0.5,
    lesson: {
      overviewReady: true,
      componentsPlanned: 2,
      componentsPublished: 1,
      componentsFailed: 1,
      partialPublish: true,
    },
    componentRepairs: [CM_REPAIR],
  },
  componentRepairs: [CM_REPAIR],
  lesson: {
    jobId: 'new-job',
    overview: { componentId: 'overview-v1' },
    components: [
      { componentId: 'concept-map-v1', specId: 'jx:concept-map-v1:r1', status: 'failed', reason: TRUNCATED_REASON, revision: 1 },
      { componentId: 'quiz-cards-v1', specId: 'jx:quiz-cards-v1:r1', status: 'passed', reason: '', revision: 1 },
    ],
  },
  componentReports: {
    'jx:concept-map-v1:r1': {
      artifactId: 'jx:concept-map-v1:r1',
      revision: 1,
      publishable: false,
      checks: [
        { id: 'CM-02', kind: 'quote', message: 'ok', passed: true },
        { id: 'CM-03', kind: 'quote', message: 'link quote not on page', passed: false },
      ],
    },
  },
};
/** A settled OLD lesson job as the storage/API summary-only view (journal recovery path). */
const OLD_LESSON_SUMMARY = {
  jobId: 'old-job',
  status: 'succeeded',
  flow: 'lesson',
  totalCostUSD: 0.4,
  lesson: { overviewReady: true, componentsPlanned: 1, componentsPublished: 1, componentsFailed: 0, partialPublish: false },
  componentRepairs: [CM_REPAIR],
};

const LESSON_PRELOAD_SRC = `
const DETAIL = ${JSON.stringify(LESSON_DETAIL)};
const OLD = ${JSON.stringify(OLD_LESSON_SUMMARY)};
globalThis.setTimeout = (cb) => { queueMicrotask(cb); return 0; };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  if (u.endsWith('/api/health')) return Response.json({ busy: false, running: 0, maxConcurrentJobs: 3 });
  if (u.includes('/api/jobs/old-job')) return Response.json({ summary: OLD });
  if (method === 'POST' && u.endsWith('/api/jobs')) {
    console.log('FAKE_SUBMITTED 1');
    return Response.json({ jobId: 'new-job' }, { status: 202 });
  }
  if (u.includes('/api/jobs/new-job')) return Response.json(DETAIL);
  throw new Error('Unexpected fake request: ' + method + ' ' + u);
};
`;

const HARNESS = mkdtempSync(join(tmpdir(), 's6-concurrency-driver-'));
const PRELOAD = join(HARNESS, 'preload.mjs');
writeFileSync(PRELOAD, PRELOAD_SRC);
const LESSON_PRELOAD = join(HARNESS, 'preload-lesson.mjs');
writeFileSync(LESSON_PRELOAD, LESSON_PRELOAD_SRC);

interface RunResult {
  exit: number;
  output: string;
  submittedCount: number;
  results: Record<string, any>[];
  journal: Record<string, any>[];
  journalRaw: string;
  dir: string;
}

function runDriver(
  name: string,
  opts: { journal?: string; results?: string; args: string[]; env?: Record<string, string>; preload?: string },
): RunResult {
  const dir = mkdtempSync(join(HARNESS, `${name}-`));
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  if (opts.journal !== undefined) writeFileSync(join(out, 'journal.jsonl'), opts.journal);
  if (opts.results !== undefined) writeFileSync(join(out, 'results.jsonl'), opts.results);
  const preload = opts.preload ?? PRELOAD;
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(preload).href, 'scripts/evaluation-run.ts', ...opts.args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        EVAL_OUT_DIR: relative(ROOT, out).replaceAll('\\', '/'),
        STORAGE_DIR: relative(ROOT, join(dir, 'no-storage')).replaceAll('\\', '/'),
        ...(opts.env ?? {}),
      },
    },
  );
  if (r.error) throw r.error;
  const output = (r.stdout ?? '') + (r.stderr ?? '');
  const readJsonl = (p: string): Record<string, any>[] =>
    existsSync(p)
      ? readFileSync(p, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as Record<string, any>)
      : [];
  const journalRaw = existsSync(join(out, 'journal.jsonl')) ? readFileSync(join(out, 'journal.jsonl'), 'utf8') : '';
  const journal: Record<string, any>[] = [];
  for (const line of journalRaw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      journal.push(JSON.parse(line) as Record<string, any>);
    } catch {
      journal.push({ malformed: line });
    }
  }
  return {
    exit: r.status ?? -1,
    output,
    submittedCount: (output.match(/FAKE_SUBMITTED \d+/g) ?? []).length,
    results: readJsonl(join(out, 'results.jsonl')),
    journal,
    journalRaw,
    dir,
  };
}

/** The reviewer's invariant: the driver's own accounting (spent + reserved) never exceeds --max-usd. */
function assertAccountingWithinMax(res: RunResult, maxUsd: number): void {
  const m = res.output.match(/Spent \(known settled\) \$([\d.]+) \+ reserved \(outstanding liabilities\) \$([\d.]+)/);
  assert.ok(m, `final accounting line missing:\n${res.output}`);
  const total = Number.parseFloat(m![1]!) + Number.parseFloat(m![2]!);
  assert.ok(total <= maxUsd + 1e-9, `driver reports spent+reserved ${total} > max ${maxUsd}`);
}

function jobLine(jobId: string, sourceId: string): string {
  return JSON.stringify({ jobId, sourceId, at: '2026-10-30T00:00:00.000Z' }) + '\n';
}

/* ------------------------------------------------------------------ */
/* --concurrency parsing                                                */
/* ------------------------------------------------------------------ */

test('driver concurrency: --concurrency accepts integers >= 1 and fails closed (exit 2) on anything else', () => {
  for (const bad of [['--concurrency'], ['--concurrency', '0'], ['--concurrency', '-1'], ['--concurrency', '1.5'], ['--concurrency', 'abc'], ['--concurrency', ''], ['--concurrency', '--max-usd']]) {
    const res = runDriver('bad-concurrency', { args: ['--list', ...bad] });
    assert.equal(res.exit, 2, `--concurrency ${JSON.stringify(bad)} must exit 2:\n${res.output}`);
    assert.match(res.output, /--concurrency/);
  }
  const ok = runDriver('good-concurrency', { args: ['--list', '--concurrency', '2'] });
  assert.equal(ok.exit, 0, ok.output);
});

/* ------------------------------------------------------------------ */
/* real overlap: two jobs in flight, each page recorded exactly once     */
/* ------------------------------------------------------------------ */

test('driver concurrency: --concurrency 2 keeps two jobs in flight, journals both, and records each page exactly once', () => {
  const res = runDriver('overlap', {
    args: ['--from', '28', '--concurrency', '2', '--max-usd', '4'],
    // job-1 cannot settle before the second POST happened → overlap is forced.
    env: { FAKE_MIN_SUBMITS: '2', FAKE_SETTLE_POLLS: '2' },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submittedCount, 2);
  assert.match(res.output, /FAKE_PEAK 2/, 'two jobs were in flight at the same time');
  assert.doesNotMatch(res.output, /FAKE_PEAK 3/);
  // Each page appears exactly once (order may differ from the plan order).
  assert.equal(res.results.length, 2);
  const ids = res.results.map(r => r.sourceId).sort();
  assert.deepEqual(ids, [PAGE28, PAGE29].sort());
  assert.equal(new Set(res.results.map(r => r.jobId)).size, 2, 'distinct jobs');
  for (const r of res.results) {
    assert.equal(r.status, 'unsupported');
    assert.equal(r.totalCostUSD, 0.2);
  }
  // Journal: one intent + one job line per submission, paired by intentId.
  const intents = res.journal.filter((l: any) => l.jobId === undefined && typeof l.intentId === 'string');
  const jobs = res.journal.filter((l: any) => typeof l.jobId === 'string');
  assert.equal(intents.length, 2);
  assert.equal(jobs.length, 2);
  assert.deepEqual(new Set(jobs.map((j: any) => j.intentId)), new Set(intents.map((i: any) => i.intentId)));
  assert.deepEqual(jobs.map((j: any) => j.sourceId).sort(), [PAGE28, PAGE29].sort());
  // The same per-page lines as the sequential driver.
  assert.equal((res.output.match(/→ declined/g) ?? []).length, 2);
  assertAccountingWithinMax(res, 4);
});

/* ------------------------------------------------------------------ */
/* admission reserves for ALL in-flight jobs: no overshoot               */
/* ------------------------------------------------------------------ */

test('driver concurrency: a third page is never admitted while two in-flight reservations would overshoot --max-usd', () => {
  // max = 2 reservations + 0.5: a third concurrent submit (3 × 1.704 = 5.112) can never be
  // admitted while two jobs are outstanding; the driver must wait for them to settle (their
  // real 0.20 costs replace the reservations) and only then submit the third.
  const maxUsd = 2 * ADM + 0.5;
  const res = runDriver('admission', {
    args: ['--from', '27', '--concurrency', '3', '--max-usd', String(maxUsd)],
    env: { FAKE_MIN_SUBMITS: '1', FAKE_SETTLE_POLLS: '2', FAKE_SETTLE_COST: '0.2' },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submittedCount, 3, 'all three pages eventually ran');
  assert.doesNotMatch(res.output, /FAKE_PEAK 3/, 'never three in-flight worst-case reservations at once');
  assert.doesNotMatch(res.output, /Budget stop/, 'waiting for in-flight jobs is not a budget stop');
  assert.equal(res.results.length, 3);
  assert.deepEqual(
    res.results.map(r => r.sourceId).sort(),
    [PAGE27, PAGE28, PAGE29].sort(),
  );
  assert.equal(new Set(res.results.map(r => r.sourceId)).size, 3, 'each page exactly once');
  assert.match(res.output, /Spent \(known settled\) \$0\.60/, 'final spent = 3 × 0.20');
  assertAccountingWithinMax(res, maxUsd);
});

test('driver concurrency: default --concurrency 1 keeps the sequential behaviour (one job at a time)', () => {
  const res = runDriver('sequential', {
    args: ['--from', '28', '--max-usd', '4'],
    env: { FAKE_MIN_SUBMITS: '1', FAKE_SETTLE_POLLS: '2' },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submittedCount, 2);
  assert.doesNotMatch(res.output, /FAKE_PEAK 2/, 'with the default the driver never overlaps two jobs');
  assert.match(res.output, /one at a time/);
  assert.equal(res.results.length, 2);
  assertAccountingWithinMax(res, 4);
});

/* ------------------------------------------------------------------ */
/* BUG-006: results lines record componentRepairs + component failures   */
/* ------------------------------------------------------------------ */

test('BUG-006 results lines: lesson runs record the job componentRepairs and a component-level failures list (normal AND journal-recovered lines)', () => {
  const res = runDriver('lesson-lines', {
    journal: jobLine('old-job', PAGE1),
    args: ['--flow', 'lesson', '--only', PAGE0, '--max-usd', '40'],
    preload: LESSON_PRELOAD,
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submittedCount, 1);
  assert.equal(res.results.length, 2, 'the recovered old-job line + the new-job line');

  const recovered = res.results.find(r => r.jobId === 'old-job');
  assert.ok(recovered, 'the journaled settled job was recovered');
  assert.equal(recovered.recovered, true);
  assert.deepEqual(recovered.componentRepairs, [CM_REPAIR], 'recovered lines carry the summary componentRepairs');

  const fresh = res.results.find(r => r.jobId === 'new-job');
  assert.ok(fresh, 'the submitted job was recorded');
  assert.deepEqual(fresh.componentRepairs, [CM_REPAIR], 'the results line records the job componentRepairs');
  assert.deepEqual(fresh.componentFailures, [
    {
      componentId: 'concept-map-v1',
      status: 'failed',
      checks: ['CM-03'],
      code: 'OUTPUT_TRUNCATED',
      reason: TRUNCATED_REASON,
    },
  ]);
  assert.equal(fresh.partialPublish, true);
});

/* ------------------------------------------------------------------ */
/* log noise: a run's OWN in-flight jobs are not outstanding liabilities */
/* ------------------------------------------------------------------ */

test('driver concurrency: own in-flight jobs are never printed as OUTSTANDING LIABILITY; a foreign one is printed exactly once', () => {
  // Three pages in flight at once (MIN_SUBMITS 3 keeps them all running until the third POST)
  // plus a pre-existing journaled job ('old-job', still running) from an earlier run. Every
  // rescan used to print one "OUTSTANDING LIABILITY: job … is still RUNNING" line for each of
  // the driver's own polls; the run's own jobs must stay silent while the foreign one is
  // reported once, and the reservations/budget arithmetic must not change.
  const res = runDriver('no-own-liability-noise', {
    journal: jobLine('old-job', PAGE0),
    args: ['--from', '27', '--concurrency', '3', '--max-usd', '20'],
    env: { FAKE_MIN_SUBMITS: '3', FAKE_SETTLE_POLLS: '2', FAKE_SETTLE_COST: '0.2' },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submittedCount, 3, 'all three pages ran');
  assert.match(res.output, /FAKE_PEAK 3/, 'all three jobs really were in flight together');

  const lines = res.output.split('\n').filter(l => l.includes('OUTSTANDING LIABILITY'));
  const own = lines.filter(l => /job-\d+\b/.test(l));
  assert.equal(own.length, 0, `this run's own in-flight jobs were printed as liabilities:\n${own.join('\n')}`);
  const foreign = lines.filter(l => l.includes('old-job'));
  assert.equal(foreign.length, 1, `the foreign liability must be printed exactly once, not on every rescan:\n${foreign.join('\n')}`);
  assert.match(foreign[0]!, /RUNNING/);
  assert.equal(lines.length, 1, `no other liability lines expected:\n${lines.join('\n')}`);

  // Budget behaviour is unchanged: every page recorded once, spent = 3 × 0.20, and the foreign
  // job still holds its per-job-admission reservation at the end.
  assert.equal(res.results.length, 3);
  assert.deepEqual(res.results.map(r => r.sourceId).sort(), [PAGE27, PAGE28, PAGE29].sort());
  assert.match(res.output, /Spent \(known settled\) \$0\.60/, 'final spent = 3 × 0.20');
  assert.match(res.output, /reserved \(outstanding liabilities\) \$1\.704/, 'the foreign job still holds $1.704');
  assertAccountingWithinMax(res, 20);
});
