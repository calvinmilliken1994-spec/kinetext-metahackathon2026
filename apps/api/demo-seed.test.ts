import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEMO_RUNS_DIR, seedDemoRuns } from './demo-seed.ts';

function fixture(): { seed: string; storage: string } {
  const root = mkdtempSync(join(tmpdir(), 'demo-seed-'));
  const seed = join(root, 'seed');
  mkdirSync(join(seed, 'job-20261101234914-97ba271b'), { recursive: true });
  writeFileSync(join(seed, 'job-20261101234914-97ba271b', 'job.json'), '{"status":"succeeded"}');
  writeFileSync(join(seed, 'job-20261101234914-97ba271b', 'events.jsonl'), '{}\n');
  mkdirSync(join(seed, 'not-a-job'), { recursive: true });
  mkdirSync(join(seed, '_user-sources'), { recursive: true });
  writeFileSync(join(seed, '_user-sources', 'user-accf5f60ebed.json'), '{"id":"user-accf5f60ebed"}');
  writeFileSync(join(seed, '_user-sources', 'notes.md'), 'ignored');
  return { seed, storage: join(root, 'storage') };
}

test('a fresh storage gets every shipped run and user source', () => {
  const { seed, storage } = fixture();
  const r = seedDemoRuns(storage, seed);
  assert.deepEqual(r, { copied: 1, kept: 0, userSourcesCopied: 1 });
  assert.deepEqual(readdirSync(join(storage, 'runs')), ['job-20261101234914-97ba271b']);
  assert.equal(readFileSync(join(storage, 'runs', 'job-20261101234914-97ba271b', 'job.json'), 'utf8'), '{"status":"succeeded"}');
  assert.deepEqual(readdirSync(join(storage, 'user-sources')), ['user-accf5f60ebed.json']);
});

test('an existing run is kept exactly as it is (never overwritten)', () => {
  const { seed, storage } = fixture();
  mkdirSync(join(storage, 'runs', 'job-20261101234914-97ba271b'), { recursive: true });
  writeFileSync(join(storage, 'runs', 'job-20261101234914-97ba271b', 'job.json'), 'LOCAL');
  const r = seedDemoRuns(storage, seed);
  assert.deepEqual(r, { copied: 0, kept: 1, userSourcesCopied: 1 });
  assert.equal(readFileSync(join(storage, 'runs', 'job-20261101234914-97ba271b', 'job.json'), 'utf8'), 'LOCAL');
});

test('a missing seed folder is a no-op', () => {
  const { storage } = fixture();
  assert.deepEqual(seedDemoRuns(storage, join(storage, 'nope')), { copied: 0, kept: 0, userSourcesCopied: 0 });
});

test('the shipped set contains the Demo, Welcome and opening pins and every pinned run', () => {
  const shipped = new Set(readdirSync(DEMO_RUNS_DIR));
  const pins = JSON.parse(readFileSync(new URL('../../config/pinned-runs.json', import.meta.url), 'utf8')) as { runs: { jobId: string }[] };
  for (const { jobId } of pins.runs) assert.ok(shipped.has(jobId), `pinned run ${jobId} is not shipped in data/demo-runs`);
  for (const id of ['job-20261101234914-97ba271b', 'job-20261102044953-f3a2006f']) assert.ok(shipped.has(id), id);
});
