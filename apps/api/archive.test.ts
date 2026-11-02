// Library tidy (docs/specs/LIBRARY-TIDY.md): the archive side file, the pinned list and the bulk "older copies" rule.
// Pure helpers and temp directories only: no server, no network, nothing under storage/runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  archiveFilePath,
  deleteArchive,
  isFinished,
  loadPinnedRuns,
  MAX_ARCHIVE_BODY_BYTES,
  olderCopies,
  readArchive,
  writeArchive,
} from './archive.ts';
import type { ArchiveCandidate } from './archive.ts';

const JOB = 'job-20261102000000-aaaa1111';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'library-tidy-archive-'));
}

function makeRun(storageDir: string, jobId: string = JOB): string {
  const dir = join(storageDir, 'runs', jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---- storage ------------------------------------------------------------------------------------------------------

test('archiveFilePath: a bare job id only, inside that run’s directory', () => {
  assert.equal(archiveFilePath('S', JOB).replace(/\\/g, '/'), `S/runs/${JOB}/archive.json`);
  for (const bad of ['', '../x', 'a/b', 'a\\b', 'JOB', 'job.x', 'x'.repeat(81)]) {
    assert.throws(() => archiveFilePath('S', bad), /JOB_ID_INVALID/, bad);
  }
});

test('write then read: { archivedAt } only, atomic (no temp files), deleting restores', () => {
  const storageDir = tempDir();
  const dir = makeRun(storageDir);
  assert.equal(readArchive(storageDir, JOB), null, 'no file means not archived');
  writeArchive(storageDir, JOB, '2026-11-02T12:30:00.000Z');
  assert.deepEqual(JSON.parse(readFileSync(archiveFilePath(storageDir, JOB), 'utf8')), { archivedAt: '2026-11-02T12:30:00.000Z' });
  assert.deepEqual(readArchive(storageDir, JOB), { archivedAt: '2026-11-02T12:30:00.000Z' });
  assert.deepEqual(readdirSync(dir), ['archive.json'], 'no temp file is left beside it');
  deleteArchive(storageDir, JOB);
  assert.equal(existsSync(archiveFilePath(storageDir, JOB)), false);
  assert.equal(readArchive(storageDir, JOB), null);
  deleteArchive(storageDir, JOB); // restoring a run that is not archived is harmless
});

test('a damaged or unrecognised file reads as not archived', () => {
  const storageDir = tempDir();
  makeRun(storageDir);
  const target = archiveFilePath(storageDir, JOB);
  for (const content of [
    '', '{', 'null', '[]', '"2026-11-02T12:30:00.000Z"', '{}',
    '{"archivedAt":42}', '{"archivedAt":"not a date"}', '{"archivedAt":null}',
  ]) {
    writeFileSync(target, content, 'utf8');
    assert.equal(readArchive(storageDir, JOB), null, content);
  }
  assert.equal(readArchive(storageDir, 'job-missing-00000000'), null, 'a run with no directory');
});

test('the write failing leaves no temp file and no archive', () => {
  const storageDir = tempDir();
  // no run directory: the temp write throws
  assert.throws(() => writeArchive(storageDir, JOB, '2026-11-02T12:30:00.000Z'));
  assert.equal(existsSync(join(storageDir, 'runs', JOB)), false);
});

test('request bodies are capped at 1 KB', () => {
  assert.equal(MAX_ARCHIVE_BODY_BYTES, 1024);
});

test('isFinished: everything except running (succeeded, failed and unsupported are terminal)', () => {
  assert.equal(isFinished('running'), false);
  for (const s of ['succeeded', 'failed', 'unsupported']) assert.equal(isFinished(s), true, s);
  // an unknown status is not treated as finished: an unrecognised run is never archived
  assert.equal(isFinished('queued'), false);
  assert.equal(isFinished(undefined), false);
});

// ---- pinned list --------------------------------------------------------------------------------------------------

test('loadPinnedRuns: reads the job ids; a missing or damaged file means no pins', () => {
  const dir = tempDir();
  const ok = join(dir, 'pins.json');
  writeFileSync(ok, JSON.stringify({ note: 'n', runs: [{ jobId: 'job-20261102000000-aaaa1111', why: 'x' }, { jobId: 'job-20261102000000-bbbb2222', why: 'y' }] }), 'utf8');
  assert.deepEqual([...loadPinnedRuns(ok)].sort(), ['job-20261102000000-aaaa1111', 'job-20261102000000-bbbb2222']);
  assert.equal(loadPinnedRuns(join(dir, 'missing.json')).size, 0);
  for (const content of ['', '{', 'null', '[]', '{"runs":"x"}', '{"runs":null}']) {
    writeFileSync(ok, content, 'utf8');
    assert.equal(loadPinnedRuns(ok).size, 0, content);
  }
  // entries that are not { jobId: string } or not a bare job id are skipped; the rest still count
  writeFileSync(ok, JSON.stringify({ runs: [null, 3, {}, { jobId: 7 }, { jobId: '../x' }, { jobId: 'job-20261102000000-aaaa1111' }] }), 'utf8');
  assert.deepEqual([...loadPinnedRuns(ok)], ['job-20261102000000-aaaa1111']);
});

// ---- olderCopies --------------------------------------------------------------------------------------------------

/** A listed run. `at` is minutes after midnight so tests read as an order. */
function run(
  jobId: string,
  o: { source?: string; status?: string; flow?: 'lesson' | 'activity'; at: number },
): ArchiveCandidate {
  return {
    jobId,
    sourceId: o.source ?? 'page-a',
    status: o.status ?? 'succeeded',
    flow: o.flow ?? 'lesson',
    createdAt: new Date(Date.UTC(2026, 10, 2, 0, o.at)).toISOString(),
  };
}

const none = new Set<string>();
const ids = (xs: readonly string[]): string[] => [...xs].sort();

test('olderCopies: the newest succeeded lesson is the keeper; every other finished run of the page is selected', () => {
  const jobs = [
    run('j-old', { at: 1 }),
    run('j-new', { at: 5 }),
    run('j-mid', { at: 3 }),
    run('j-failed-newest', { at: 9, status: 'failed' }),
    run('j-activity-newer', { at: 7, flow: 'activity' }),
    run('j-unsupported', { at: 2, status: 'unsupported' }),
  ];
  assert.deepEqual(ids(olderCopies(jobs, { pinned: none, published: none, archived: none })), ids(['j-old', 'j-mid', 'j-failed-newest', 'j-activity-newer', 'j-unsupported']));
});

test('olderCopies: with no succeeded lesson the newest succeeded run of any flow keeps the page', () => {
  const jobs = [
    run('act-old', { at: 1, flow: 'activity' }),
    run('act-new', { at: 4, flow: 'activity' }),
    run('lesson-failed', { at: 6, status: 'failed' }),
  ];
  assert.deepEqual(ids(olderCopies(jobs, { pinned: none, published: none, archived: none })), ids(['act-old', 'lesson-failed']));
});

test('olderCopies: a run with no recorded flow counts as an activity run, not a lesson', () => {
  const legacy = { jobId: 'legacy', sourceId: 'page-a', status: 'succeeded', createdAt: new Date(Date.UTC(2026, 10, 2, 0, 9)).toISOString() } as ArchiveCandidate;
  const jobs = [legacy, run('lesson', { at: 1 })];
  assert.deepEqual(olderCopies(jobs, { pinned: none, published: none, archived: none }), ['legacy']);
});

test('olderCopies: nothing succeeded means no keeper, so every finished run of the page is selected (never an active one)', () => {
  const jobs = [
    run('f1', { at: 1, status: 'failed' }),
    run('f2', { at: 2, status: 'unsupported' }),
    run('r', { at: 3, status: 'running' }),
  ];
  assert.deepEqual(ids(olderCopies(jobs, { pinned: none, published: none, archived: none })), ['f1', 'f2']);
});

test('olderCopies: published, pinned, active and already-archived runs are never selected', () => {
  const jobs = [
    run('keeper', { at: 10 }),
    run('published', { at: 1 }),
    run('pinned', { at: 2 }),
    run('active', { at: 3, status: 'running' }),
    run('archived', { at: 4 }),
    run('plain', { at: 5 }),
  ];
  const out = olderCopies(jobs, { pinned: new Set(['pinned']), published: new Set(['published']), archived: new Set(['archived']) });
  assert.deepEqual(out, ['plain']);
});

test('olderCopies: the keeper is computed among the runs not archived yet', () => {
  const jobs = [
    run('newest-archived', { at: 9 }),
    run('next', { at: 5 }),
    run('older', { at: 1 }),
  ];
  // the archived newest copy does not hold the keeper place: "next" keeps the page
  assert.deepEqual(olderCopies(jobs, { pinned: none, published: none, archived: new Set(['newest-archived']) }), ['older']);
});

test('olderCopies: a published or pinned keeper candidate still keeps the page (its older copies go)', () => {
  const jobs = [run('new', { at: 5 }), run('old', { at: 1 })];
  assert.deepEqual(olderCopies(jobs, { pinned: new Set(['new']), published: none, archived: none }), ['old']);
  assert.deepEqual(olderCopies(jobs, { pinned: none, published: new Set(['new']), archived: none }), ['old']);
});

test('olderCopies: the pages are independent, and sourceId restricts the work to one page', () => {
  const jobs = [
    run('a-new', { at: 5, source: 'page-a' }),
    run('a-old', { at: 1, source: 'page-a' }),
    run('b-new', { at: 6, source: 'page-b' }),
    run('b-old', { at: 2, source: 'page-b' }),
    run('c-only', { at: 3, source: 'page-c' }),
  ];
  const state = { pinned: none, published: none, archived: none };
  assert.deepEqual(ids(olderCopies(jobs, state)), ['a-old', 'b-old']);
  assert.deepEqual(olderCopies(jobs, { ...state, sourceId: 'page-a' }), ['a-old']);
  assert.deepEqual(olderCopies(jobs, { ...state, sourceId: 'page-b' }), ['b-old']);
  assert.deepEqual(olderCopies(jobs, { ...state, sourceId: 'page-c' }), []);
  assert.deepEqual(olderCopies(jobs, { ...state, sourceId: 'no-such-page' }), [], 'an unknown page matches nothing');
});

test('olderCopies: a tie on time is broken by job id, so the answer is stable; the input is not changed', () => {
  const t = new Date(Date.UTC(2026, 10, 2)).toISOString();
  const jobs: ArchiveCandidate[] = [
    { jobId: 'job-a', sourceId: 's', status: 'succeeded', flow: 'lesson', createdAt: t },
    { jobId: 'job-b', sourceId: 's', status: 'succeeded', flow: 'lesson', createdAt: t },
  ];
  const before = JSON.stringify(jobs);
  assert.deepEqual(olderCopies(jobs, { pinned: none, published: none, archived: none }), ['job-a']);
  assert.deepEqual(olderCopies([...jobs].reverse(), { pinned: none, published: none, archived: none }), ['job-a']);
  assert.equal(JSON.stringify(jobs), before);
});

test('olderCopies: one run alone, or an empty library, selects nothing', () => {
  assert.deepEqual(olderCopies([], { pinned: none, published: none, archived: none }), []);
  assert.deepEqual(olderCopies([run('only', { at: 1 })], { pinned: none, published: none, archived: none }), []);
});
