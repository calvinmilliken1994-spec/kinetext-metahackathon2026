// Library tidy (docs/specs/LIBRARY-TIDY.md): config/pinned-runs.json must name every run the web app links to by id.
// Reads apps/web/src (and results.json) and the config file only; edits nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPinnedRuns } from './archive.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');
const PINNED_FILE = join(ROOT, 'config', 'pinned-runs.json');
const JOB_ID_LITERAL = /job-\d{14}-[0-9a-f]{8}/g;
/** Tests quote ids as evidence; they are not links. Fixtures and data files are scanned (their ids are real runs). */
const IS_TEST_FILE = /\.test\.(?:ts|tsx|mts|mjs|js)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/** Every job id literal in the non-test files under apps/web/src, with the files that name it. */
function linkedJobIds(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of walk(WEB_SRC)) {
    if (IS_TEST_FILE.test(file)) continue;
    if (!/\.(?:ts|tsx|json|js|mjs|css|html|md)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const id of new Set(text.match(JOB_ID_LITERAL) ?? [])) {
      const files = found.get(id) ?? [];
      files.push(file.slice(WEB_SRC.length + 1).replace(/\\/g, '/'));
      found.set(id, files);
    }
  }
  return found;
}

/** The ids in `linked` that `pinned` does not hold. */
function missingPins(linked: ReadonlyMap<string, string[]>, pinned: ReadonlySet<string>): string[] {
  return [...linked.keys()].filter(id => !pinned.has(id)).sort();
}

test('every job id the web app links to is in config/pinned-runs.json', () => {
  const linked = linkedJobIds();
  const missing = missingPins(linked, loadPinnedRuns(PINNED_FILE));
  assert.deepEqual(
    missing.map(id => `${id} (${(linked.get(id) ?? []).join(', ')})`),
    [],
    'add these runs to config/pinned-runs.json, each with an honest "why"',
  );
});

test('the scan sees the known sources: DEMO_PINS, results.json and the engine-demo specs', () => {
  const linked = linkedJobIds();
  const demoPins = readFileSync(join(WEB_SRC, 'lib', 'demoPins.ts'), 'utf8');
  const pinsBlock = demoPins.slice(demoPins.indexOf('export const DEMO_PINS'), demoPins.indexOf('} as const'));
  const demoIds = [...new Set(pinsBlock.match(JOB_ID_LITERAL) ?? [])];
  assert.ok(demoIds.length >= 4, 'tour, three opening runs and welcome');
  const results = JSON.parse(readFileSync(join(WEB_SRC, 'data', 'results.json'), 'utf8')) as unknown;
  const resultIds = [...new Set(JSON.stringify(results).match(JOB_ID_LITERAL) ?? [])];
  assert.ok(resultIds.length >= 12, 'results.json lists at least the 12 diagram runs it did when this was written');
  for (const id of [...demoIds, ...resultIds]) assert.ok(linked.has(id), id);
  assert.ok(linked.has('job-20261031051459-6bf49d3d'), 'labelDiagramDemoSpecs.ts is scanned');
});

test('the check bites: a list missing a linked id is reported', () => {
  const linked = linkedJobIds();
  const all = loadPinnedRuns(PINNED_FILE);
  const dropped = [...all][0] as string;
  const without = new Set(all);
  without.delete(dropped);
  assert.deepEqual(missingPins(linked, without), [dropped]);
  assert.deepEqual(missingPins(linked, new Set()), [...linked.keys()].sort(), 'no list at all misses everything');
});

test('config/pinned-runs.json is well formed: a note, unique valid ids, each with a reason', () => {
  const raw = JSON.parse(readFileSync(PINNED_FILE, 'utf8')) as { note?: unknown; runs?: unknown };
  assert.equal(typeof raw.note, 'string');
  assert.ok(Array.isArray(raw.runs));
  const ids: string[] = [];
  for (const entry of raw.runs as Array<{ jobId?: unknown; why?: unknown }>) {
    assert.match(String(entry.jobId), /^job-\d{14}-[0-9a-f]{8}$/);
    assert.ok(typeof entry.why === 'string' && entry.why.trim().length >= 10, `why for ${String(entry.jobId)}`);
    ids.push(entry.jobId as string);
  }
  assert.equal(new Set(ids).size, ids.length, 'no duplicates');
  assert.equal(loadPinnedRuns(PINNED_FILE).size, ids.length, 'the loader reads every entry');
});
