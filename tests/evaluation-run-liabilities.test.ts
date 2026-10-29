// S5B-14 (Stage 5b review, round 2): integration tests for the REAL evaluation driver
// (scripts/evaluation-run.ts) against an in-process fake transport — the same technique as the
// reviewer's round2-eval.mjs probe. Each case spawns the driver in a child node process with a
// preloaded fake `fetch` (no sockets, no network, no API server) and scratch-only
// EVAL_OUT_DIR/STORAGE_DIR, and asserts the driver accounts for EVERY outstanding liability
// before every submission:
//   spent (known settled costs, in or out of the manifest)
// + reserved (perJobAdmissionUSD per running/unresolved/unknown-cost job, null-cost results line,
//             nonempty malformed journal line, and pre-submit intent without a job line)
// + perJobAdmissionUSD  <=  --max-usd
// and that it re-checks AFTER waiting for idle, so a job that settles while waiting is re-read and
// its real cost replaces its reservation. Covers the reviewer's eight round-2 recovery cases plus
// the new intent-without-job (POST→journal crash window) cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'data', 'evaluation', 'manifest.json'), 'utf8')) as {
  pages: { sourceId: string }[];
};
const PAGE0 = MANIFEST.pages[0].sourceId;
const PAGE1 = MANIFEST.pages[1].sourceId;
/** perJobAdmissionUSD at the current config/resource-limits.json caps (see tests/evaluation-budget.test.ts). */
const ADM = 1.704;

/* ------------------------------------------------------------------ */
/* fake transport preload (written to a scratch dir at test time)        */
/* ------------------------------------------------------------------ */

const PRELOAD_SRC = `
// S5B-14 driver-test fake transport: in-process only, no sockets, no network.
// FAKE_OLD  JSON summary for the pre-existing journaled job "old-job" (absent -> 404)
// FAKE_FLIP JSON summary "old-job" switches to once /api/health is first called
//           (models a job that settles while the driver waits for idle)
// FAKE_NEW  JSON summary for the job created by POST /api/jobs (default unsupported 0.2)
const old0 = process.env.FAKE_OLD ? JSON.parse(process.env.FAKE_OLD) : null;
const flip0 = process.env.FAKE_FLIP ? JSON.parse(process.env.FAKE_FLIP) : null;
const neu = process.env.FAKE_NEW
  ? JSON.parse(process.env.FAKE_NEW)
  : { jobId: 'new-job', status: 'unsupported', totalCostUSD: 0.2 };
let old = old0;
let flipPending = flip0;
let submits = 0;
globalThis.setTimeout = (cb) => { queueMicrotask(cb); return 0; };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  console.log('FAKE_REQUEST ' + method + ' ' + u);
  if (u.endsWith('/api/health')) {
    if (flipPending) { old = flipPending; flipPending = null; }
    return Response.json({ busy: false });
  }
  if (u.includes('/api/jobs/old-job')) {
    if (!old) return Response.json({}, { status: 404 });
    return Response.json({ summary: old });
  }
  if (method === 'POST' && u.endsWith('/api/jobs')) {
    submits += 1;
    console.log('FAKE_SUBMITTED ' + submits);
    return Response.json({ jobId: 'new-job' }, { status: 202 });
  }
  if (u.includes('/api/jobs/new-job')) return Response.json({ summary: neu });
  throw new Error('Unexpected fake request: ' + method + ' ' + u);
};
`;

const HARNESS = mkdtempSync(join(tmpdir(), 's5b14-driver-'));
const PRELOAD = join(HARNESS, 'preload.mjs');
writeFileSync(PRELOAD, PRELOAD_SRC);

interface RunResult {
  exit: number;
  output: string;
  submitted: boolean;
  results: Record<string, any>[];
  journal: Record<string, any>[];
  journalRaw: string;
  dir: string;
}

function runDriver(
  name: string,
  opts: { journal?: string; results?: string; args: string[]; env?: Record<string, string>; dir?: string },
): RunResult {
  const dir = opts.dir ?? mkdtempSync(join(HARNESS, `${name}-`));
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  if (opts.journal !== undefined) writeFileSync(join(out, 'journal.jsonl'), opts.journal);
  if (opts.results !== undefined) writeFileSync(join(out, 'results.jsonl'), opts.results);
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(PRELOAD).href, 'scripts/evaluation-run.ts', ...opts.args],
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
    submitted: output.includes('FAKE_SUBMITTED'),
    results: readJsonl(join(out, 'results.jsonl')),
    journal,
    journalRaw,
    dir,
  };
}

function jobLine(jobId: string, sourceId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ jobId, sourceId, at: '2026-10-29T00:00:00.000Z', ...extra }) + '\n';
}
function intentLine(intentId: string, sourceId: string): string {
  return JSON.stringify({ intentId, sourceId, at: '2026-10-29T00:00:00.000Z' }) + '\n';
}
const OLD_RUNNING = { jobId: 'old-job', sourceId: PAGE0, status: 'running' };
function oldSettled(totalCostUSD: number | null, sourceId: string = PAGE0) {
  return { jobId: 'old-job', sourceId, status: 'failed', totalCostUSD };
}

/** The reviewer's invariant: the driver's own accounting (spent + reserved) never exceeds --max-usd. */
function assertAccountingWithinMax(res: RunResult, maxUsd: number): void {
  const m = res.output.match(/Spent \(known settled\) \$([\d.]+) \+ reserved \(outstanding liabilities\) \$([\d.]+)/);
  assert.ok(m, `final accounting line missing:\n${res.output}`);
  const total = Number.parseFloat(m![1]!) + Number.parseFloat(m![2]!);
  assert.ok(total <= maxUsd + 1e-9, `driver reports spent+reserved ${total} > max ${maxUsd}`);
}

/* ------------------------------------------------------------------ */
/* the reviewer's eight round-2 recovery cases                           */
/* ------------------------------------------------------------------ */

test('S5B-14 driver: settled old job — cost recovered, next submission refused (reviewer case "settled")', () => {
  const res = runDriver('settled', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: { FAKE_OLD: JSON.stringify(oldSettled(1.7)) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false, 'aggregate 1.70 + 1.704 > 1.80 → no new submission');
  assert.match(res.output, /journal recovery/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].jobId, 'old-job');
  assert.equal(res.results[0].totalCostUSD, 1.7);
  assert.equal(res.results[0].recovered, true);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: duplicate journal lines count the settled cost once (reviewer case "duplicate")', () => {
  const line = jobLine('old-job', PAGE0);
  const res = runDriver('duplicate', {
    journal: line + line,
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: { FAKE_OLD: JSON.stringify(oldSettled(1.7)) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false);
  assert.equal(res.results.length, 1, 'recovered exactly once');
  assert.equal(res.results[0].totalCostUSD, 1.7);
  assert.match(res.output, /Budget stop/);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: running old job holds a reservation — refused even before the idle wait (reviewer case "running")', () => {
  const res = runDriver('running', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: {
      FAKE_OLD: JSON.stringify(OLD_RUNNING),
      FAKE_FLIP: JSON.stringify(oldSettled(1.7)),
    },
  });
  assert.equal(res.exit, 0, res.output);
  // reserved 1.704 + admission 1.704 > 1.8 → the run stops before submitting anything.
  assert.equal(res.submitted, false);
  assert.match(res.output, /RUNNING/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 0);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: unresolvable old job holds a reservation and blocks (reviewer case "unresolved")', () => {
  const res = runDriver('unresolved', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '1.8', '--only', PAGE1],
    // no FAKE_OLD → the fake API 404s and the scratch storage dir has no job.json
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false);
  assert.match(res.output, /could not be resolved/);
  assert.match(res.output, /Budget stop/);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: settled job with null cost is recorded AND reserved, not counted as 0 (reviewer case "unknown-cost")', () => {
  const res = runDriver('unknown-cost', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: { FAKE_OLD: JSON.stringify(oldSettled(null)) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false);
  assert.match(res.output, /UNKNOWN/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 1, 'the settled outcome is still recorded');
  assert.equal(res.results[0].totalCostUSD, null);
  assert.equal(res.results[0].recovered, true);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: existing results row with null cost is a charged blocking liability (reviewer case "known-result-unknown-cost")', () => {
  const res = runDriver('result-null-cost', {
    journal: jobLine('old-job', PAGE0),
    results: JSON.stringify({ sourceId: PAGE0, jobId: 'old-job', at: '2026-10-29T00:00:00Z', totalCostUSD: null }) + '\n',
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: { FAKE_OLD: JSON.stringify(oldSettled(1.7)) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false, 'the null-cost row reserves 1.704 → 0 + 1.704 + 1.704 > 1.8');
  assert.match(res.output, /no known cost/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 1, 'the recorded job is not recovered twice');
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: truncated nonempty journal line is a charged liability, never skipped (reviewer case "malformed")', () => {
  const res = runDriver('malformed', {
    journal: jobLine('old-job', PAGE0).slice(0, -10),
    args: ['--max-usd', '1.8', '--only', PAGE1],
    env: { FAKE_OLD: JSON.stringify(oldSettled(1.7)) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false);
  assert.match(res.output, /malformed/i);
  assert.match(res.output, /Budget stop/);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: known settled cost counts even when its source left the manifest (reviewer case "out-of-manifest")', () => {
  const res = runDriver('out-of-manifest', {
    journal: jobLine('old-job', 'source-that-is-not-in-the-manifest'),
    args: ['--max-usd', '1.8', '--only', PAGE0],
    env: { FAKE_OLD: JSON.stringify(oldSettled(1.7, 'source-that-is-not-in-the-manifest')) },
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false, 'spent 1.70 + admission 1.704 > 1.80');
  assert.match(res.output, /NOT in the manifest/);
  assert.match(res.output, /COUNTS toward the budget/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 0, 'no manifest page → no results line can be written');
  assert.match(res.output, /spent \$1\.70/, 'the out-of-manifest cost is in the spent figure');
  assertAccountingWithinMax(res, 1.8);
});

/* ------------------------------------------------------------------ */
/* re-check after the idle wait: real cost replaces the reservation      */
/* ------------------------------------------------------------------ */

test('S5B-14 driver: a job that settles during the idle wait is re-read — real cost replaces the reservation and admits', () => {
  const res = runDriver('settles-during-idle-admits', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '3.5', '--only', PAGE1],
    env: {
      FAKE_OLD: JSON.stringify(OLD_RUNNING),
      FAKE_FLIP: JSON.stringify(oldSettled(1.7)),
    },
  });
  assert.equal(res.exit, 0, res.output);
  // First check: 0 + 1.704 (reservation) + 1.704 <= 3.5 → proceed to the idle wait.
  // After idle: old-job settled at 1.70 → reservation replaced by the real cost:
  // 1.70 + 0 + 1.704 = 3.404 <= 3.5 → the submission is admitted.
  assert.equal(res.submitted, true);
  assert.match(res.output, /RUNNING/, 'the reservation was announced first');
  assert.match(res.output, /journal recovery/, 'then the settled job was re-read and recovered');
  assert.equal(res.results.length, 2);
  assert.equal(res.results[0].jobId, 'old-job');
  assert.equal(res.results[0].totalCostUSD, 1.7);
  assert.equal(res.results[1].jobId, 'new-job');
  assert.equal(res.results[1].totalCostUSD, 0.2);
  assert.match(res.output, /\$1\.90/, 'final spent = 1.70 + 0.20 <= 3.50');
  assertAccountingWithinMax(res, 3.5);
});

test('S5B-14 driver: a job that settles EXPENSIVE during the idle wait stops the run before submitting', () => {
  const res = runDriver('settles-during-idle-refuses', {
    journal: jobLine('old-job', PAGE0),
    args: ['--max-usd', '3.5', '--only', PAGE1],
    env: {
      FAKE_OLD: JSON.stringify(OLD_RUNNING),
      FAKE_FLIP: JSON.stringify(oldSettled(3.45)),
    },
  });
  assert.equal(res.exit, 0, res.output);
  // The reviewer's exact race: first check passes on the reservation (3.408 <= 3.5), but the
  // post-idle re-check sees the real 3.45 → 3.45 + 0 + 1.704 > 3.5 → NO submission.
  assert.equal(res.submitted, false);
  assert.match(res.output, /journal recovery/);
  assert.match(res.output, /Budget stop/);
  assert.equal(res.results.length, 1, 'the settled job is still recovered and recorded');
  assert.equal(res.results[0].totalCostUSD, 3.45);
  assertAccountingWithinMax(res, 3.5);
});

/* ------------------------------------------------------------------ */
/* pre-submit intent: the POST→journal crash window                      */
/* ------------------------------------------------------------------ */

test('S5B-14 driver: an intent without a job line is an uncertain-submission liability that blocks admission', () => {
  const res = runDriver('intent-without-job', {
    journal: intentLine('i-1', PAGE0),
    args: ['--max-usd', '1.8', '--only', PAGE1],
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false, 'reserved 1.704 + admission 1.704 > 1.8');
  assert.match(res.output, /intent i-1/);
  assert.match(res.output, /UNCERTAIN/);
  assert.match(res.output, /"resolution":"not-submitted"/, 'the message says how to resolve manually');
  assert.match(res.output, /Budget stop/);
  assertAccountingWithinMax(res, 1.8);
});

test('S5B-14 driver: a page with an outstanding intent is never re-submitted even with room in the budget', () => {
  const res = runDriver('intent-blocks-own-page', {
    journal: intentLine('i-1', PAGE0),
    args: ['--max-usd', '4', '--only', PAGE0],
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false);
  assert.match(res.output, /Running 0 evaluation job/, 'the blocked page never reaches the plan');
  assert.match(res.output, /UNCERTAIN/);
  assertAccountingWithinMax(res, 4);
});

test('S5B-14 driver: with budget room, another page submits behind an outstanding intent reservation and journals intent-then-job', () => {
  const res = runDriver('intent-other-page-admits', {
    journal: intentLine('i-1', PAGE0),
    args: ['--max-usd', '4', '--only', PAGE1],
  });
  assert.equal(res.exit, 0, res.output);
  // 0 spent + 1.704 reserved (the uncertain intent) + 1.704 admission = 3.408 <= 4 → admitted.
  assert.equal(res.submitted, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].jobId, 'new-job');
  // The old intent stays outstanding; the new submission journals intent BEFORE job, paired by intentId.
  assert.ok(res.journal.some((l: any) => l.intentId === 'i-1' && l.jobId === undefined));
  const newIntent = res.journal.find((l: any) => typeof l.intentId === 'string' && l.intentId !== 'i-1' && l.jobId === undefined);
  assert.ok(newIntent, 'a pre-submit intent line was written');
  assert.equal(newIntent.sourceId, PAGE1);
  const jobRec = res.journal.find((l: any) => l.jobId === 'new-job');
  assert.ok(jobRec, 'the job line was written after the 202');
  assert.equal(jobRec.intentId, newIntent.intentId);
  assert.equal(jobRec.sourceId, PAGE1);
  assert.ok(
    res.journalRaw.indexOf(newIntent.intentId as string) < res.journalRaw.indexOf('new-job'),
    'the intent line is durable BEFORE the POST response is journaled',
  );
  assertAccountingWithinMax(res, 4);
});

test('S5B-14 driver: a resolution line releases an intent reservation', () => {
  const res = runDriver('intent-resolved', {
    journal: intentLine('i-1', PAGE0) + JSON.stringify({ intentId: 'i-1', resolution: 'not-submitted', at: '2026-10-29T01:00:00.000Z' }) + '\n',
    args: ['--max-usd', '1.8', '--only', PAGE1],
  });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, true, 'with the intent resolved, 0 + 0 + 1.704 <= 1.8 admits the submission');
  assert.doesNotMatch(res.output, /UNCERTAIN/);
  assertAccountingWithinMax(res, 1.8);
});

/* ------------------------------------------------------------------ */
/* ordinary paths                                                        */
/* ------------------------------------------------------------------ */

test('S5B-14 driver: happy path submits, journals intent+job, records the result, and a re-run finds nothing to do', () => {
  const first = runDriver('happy', { args: ['--max-usd', '4', '--only', PAGE1] });
  assert.equal(first.exit, 0, first.output);
  assert.equal(first.submitted, true);
  assert.equal(first.results.length, 1);
  assert.equal(first.results[0].totalCostUSD, 0.2);
  const intent = first.journal.find((l: any) => l.jobId === undefined && typeof l.intentId === 'string');
  const job = first.journal.find((l: any) => l.jobId === 'new-job');
  assert.ok(intent && job, 'journal holds the intent line and the paired job line');
  assert.equal(job.intentId, intent.intentId);
  assert.match(first.output, /Spent \(known settled\) \$0\.20 \+ reserved \(outstanding liabilities\) \$0\.000/);
  assertAccountingWithinMax(first, 4);

  const second = runDriver('happy-again', { args: ['--max-usd', '4', '--only', PAGE1], dir: first.dir });
  assert.equal(second.exit, 0, second.output);
  assert.equal(second.submitted, false);
  assert.match(second.output, /Running 0 evaluation job/);
  assert.equal(second.results.length, 1, 'no duplicate results line');
});

test('S5B-14 driver: without liabilities the admission bound alone still applies', () => {
  const res = runDriver('admission-only', { args: ['--max-usd', '1.0', '--only', PAGE1] });
  assert.equal(res.exit, 0, res.output);
  assert.equal(res.submitted, false, `0 + 0 + ${ADM} > 1.0`);
  assert.match(res.output, /Budget stop/);
  assertAccountingWithinMax(res, 1.0);
});
