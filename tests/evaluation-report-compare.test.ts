// OW-2: scripts/evaluation-report.ts --compare <dirA> <dirB> writes a side-by-side
// comparison markdown from two results.jsonl files. Spawns the REAL script against
// scratch dirs; pure computation is unit-tested in tests/evaluation-metrics.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function resultsLine(over: Record<string, unknown> = {}): string {
  return (
    JSON.stringify({
      sourceId: 'src-1',
      candidate: 1,
      subject: 'physics',
      expected: 'forces-1d-v1',
      acceptable: [],
      difficulty: 'easy',
      jobId: 'job-1',
      status: 'succeeded',
      engine: 'forces-1d-v1',
      publishedRevision: 1,
      revisions: 1,
      repairs: [],
      analysisRepairs: [],
      failedChecks: [],
      firstRevisionFailedChecks: [],
      error: null,
      totalCostUSD: 0.05,
      wallS: 40,
      at: '2026-10-29T00:00:00.000Z',
      ...over,
    }) + '\n'
  );
}

function runReport(args: string[]): { exit: number; output: string } {
  const r = spawnSync(process.execPath, ['scripts/evaluation-report.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  return { exit: r.status ?? -1, output: (r.stdout ?? '') + (r.stderr ?? '') };
}

test('OW-2: --compare writes comparison.md beside the second directory\'s results', () => {
  const harness = mkdtempSync(join(tmpdir(), 'ow2-report-'));
  const dirA = join(harness, 'hosted');
  const dirB = join(harness, 'open');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  writeFileSync(
    join(dirA, 'results.jsonl'),
    resultsLine({ model: 'muse-spark-1.3', provider: 'meta-api' }) +
      resultsLine({
        sourceId: 'src-2', candidate: 2, jobId: 'job-2', model: 'muse-spark-1.3', provider: 'meta-api',
        status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline', wallS: 20, totalCostUSD: 0.02,
      }),
  );
  writeFileSync(
    join(dirB, 'results.jsonl'),
    resultsLine({ model: 'muse-spark-open', provider: 'modal', wallS: 60, totalCostUSD: 0.07 }) +
      resultsLine({
        sourceId: 'src-2', candidate: 2, jobId: 'job-3', model: 'muse-spark-open', provider: 'modal',
        status: 'unsupported', engine: null, publishedRevision: null, expected: 'decline', wallS: 30, totalCostUSD: 0.03,
      }),
  );
  const run = runReport(['--compare', dirA, dirB]);
  assert.equal(run.exit, 0, run.output);
  const outPath = join(dirB, 'comparison.md');
  assert.ok(existsSync(outPath), 'comparison.md is written beside the second run');
  const md = readFileSync(outPath, 'utf8');
  assert.match(md, /muse-spark-1\.3/);
  assert.match(md, /muse-spark-open/);
  assert.match(md, /meta-api/);
  assert.match(md, /modal/);
  assert.match(md, /\| Metric \|/, 'a side-by-side metric table');
  assert.match(md, /Median wall time \| 30(?:\.0)? ?s \| 45\.0 ?s \|/, 'median wall time per side (40/20 → 30; 60/30 → 45)');
  assert.match(run.output, /comparison\.md/);
  assert.doesNotMatch(md, /NaN/);
});

test('OW-2: --compare fails with exit 1 when a side has no results.jsonl', () => {
  const harness = mkdtempSync(join(tmpdir(), 'ow2-report-missing-'));
  const dirA = join(harness, 'hosted');
  const dirB = join(harness, 'missing');
  mkdirSync(dirA, { recursive: true });
  writeFileSync(join(dirA, 'results.jsonl'), resultsLine());
  const run = runReport(['--compare', dirA, dirB]);
  assert.equal(run.exit, 1);
  assert.match(run.output, /results\.jsonl/);
  const badArgs = runReport(['--compare', dirA]);
  assert.equal(badArgs.exit, 2, 'two directories are required');
});
