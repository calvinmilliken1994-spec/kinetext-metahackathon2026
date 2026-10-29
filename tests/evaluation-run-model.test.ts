// OW-2: the evaluation driver sends --model with every job, prices admission with the
// chosen model, and records model/provider on results lines. Same technique as
// tests/evaluation-run-liabilities.test.ts: spawn the REAL driver in a child process with
// a preloaded in-process fake fetch (no sockets, no network, no API server, no credits).
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

const PRELOAD_SRC = `
// OW-2 driver-test fake transport: in-process only, no sockets, no network.
// FAKE_NEW is the JSON job summary GET /api/jobs/new-job returns.
const neu = process.env.FAKE_NEW
  ? JSON.parse(process.env.FAKE_NEW)
  : { jobId: 'new-job', status: 'unsupported', totalCostUSD: 0.2 };
globalThis.setTimeout = (cb) => { queueMicrotask(cb); return 0; };
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  if (u.endsWith('/api/health')) return Response.json({ busy: false });
  if (method === 'POST' && u.endsWith('/api/jobs')) {
    console.log('FAKE_BODY ' + String((init && init.body) || ''));
    return Response.json({ jobId: 'new-job' }, { status: 202 });
  }
  if (u.includes('/api/jobs/new-job')) return Response.json({ summary: neu });
  throw new Error('Unexpected fake request: ' + method + ' ' + u);
};
`;

const HARNESS = mkdtempSync(join(tmpdir(), 'ow2-driver-'));
const PRELOAD = join(HARNESS, 'preload.mjs');
writeFileSync(PRELOAD, PRELOAD_SRC);

interface RunResult {
  exit: number;
  output: string;
  bodies: string[];
  results: Record<string, any>[];
}

function runDriver(name: string, args: string[], env: Record<string, string> = {}): RunResult {
  const dir = mkdtempSync(join(HARNESS, `${name}-`));
  const out = join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const r = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(PRELOAD).href, 'scripts/evaluation-run.ts', ...args],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000,
      env: {
        ...process.env,
        EVAL_OUT_DIR: relative(ROOT, out).replaceAll('\\', '/'),
        STORAGE_DIR: relative(ROOT, join(dir, 'no-storage')).replaceAll('\\', '/'),
        ...env,
      },
    },
  );
  if (r.error) throw r.error;
  const output = (r.stdout ?? '') + (r.stderr ?? '');
  const bodies = output
    .split('\n')
    .filter(l => l.startsWith('FAKE_BODY '))
    .map(l => l.slice('FAKE_BODY '.length));
  const resultsPath = join(out, 'results.jsonl');
  const results = existsSync(resultsPath)
    ? readFileSync(resultsPath, 'utf8').split('\n').filter(l => l.trim() !== '').map(l => JSON.parse(l) as Record<string, any>)
    : [];
  return { exit: r.status ?? -1, output, bodies, results };
}

test('OW-2: the default driver run sends model muse-spark-1.3 and records model/provider on the results line', () => {
  const run = runDriver('default', ['--only', PAGE0]);
  assert.equal(run.exit, 0, run.output);
  assert.equal(run.bodies.length, 1);
  const body = JSON.parse(run.bodies[0]) as Record<string, unknown>;
  assert.equal(body.sourceId, PAGE0);
  assert.equal(body.model, 'muse-spark-1.3', 'the default model travels with every submission');
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].model, 'muse-spark-1.3');
  assert.equal(run.results[0].provider, 'meta-api');
  assert.match(run.output, /model muse-spark-1\.3/, 'the run header names the model');
});

test('OW-2: --model muse-spark-open is sent with the job and recorded from the settled summary', () => {
  const fakeNew = {
    jobId: 'new-job',
    status: 'unsupported',
    totalCostUSD: 0.2,
    model: 'muse-spark-open',
    provider: 'modal',
    providerModel: 'meta-models/Muse-Spark-Open-816B-A42B',
  };
  const run = runDriver('open', ['--only', PAGE0, '--model', 'muse-spark-open'], {
    FAKE_NEW: JSON.stringify(fakeNew),
  });
  assert.equal(run.exit, 0, run.output);
  assert.equal(run.bodies.length, 1);
  const body = JSON.parse(run.bodies[0]) as Record<string, unknown>;
  assert.equal(body.model, 'muse-spark-open');
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].model, 'muse-spark-open', 'the results line records what the job actually ran');
  assert.equal(run.results[0].provider, 'modal');
  assert.match(run.output, /model muse-spark-open/);
});

test('OW-2: results fall back to the requested model when the summary predates the fields', () => {
  // FAKE_NEW default has no model/provider — the line must record the REQUESTED model, never null.
  const run = runDriver('fallback', ['--only', PAGE0, '--model', 'muse-spark-open']);
  assert.equal(run.exit, 0, run.output);
  assert.equal(run.results[0].model, 'muse-spark-open');
  assert.equal(run.results[0].provider, 'modal');
});

test('OW-2: an invalid --model exits 2 before any submission', () => {
  const run = runDriver('bad-model', ['--only', PAGE0, '--model', 'muse-spark-9']);
  assert.equal(run.exit, 2);
  assert.equal(run.bodies.length, 0, 'nothing is submitted');
  assert.match(run.output, /--model/);
  const missing = runDriver('missing-model', ['--only', PAGE0, '--model']);
  assert.equal(missing.exit, 2);
  assert.equal(missing.bodies.length, 0);
});

test('OW-2: --list names the chosen model and makes no requests', () => {
  const run = runDriver('list-open', ['--list', '--model', 'muse-spark-open']);
  assert.equal(run.exit, 0, run.output);
  assert.equal(run.bodies.length, 0);
  assert.match(run.output, /muse-spark-open/);
});
