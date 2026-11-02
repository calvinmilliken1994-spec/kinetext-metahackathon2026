// Library tidy (docs/specs/LIBRARY-TIDY.md): archiving old copies of a lesson, the pinned-runs list and the bulk rule.
//
// Nothing is deleted and no stored run file changes. Archiving writes `<storageDir>/runs/<jobId>/archive.json` =
// { archivedAt: ISO } beside the run, the way publishing writes review.json; restoring deletes it. The write is atomic
// (temp file in the same directory, then rename), and a missing, damaged or unrecognised file reads as "not archived":
// a half-written file never hides a lesson.
//
// Pure helpers (no HTTP, no clock): the server wires them to POST /api/jobs/:id/archive and POST /api/archive.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ArchiveRecord {
  archivedAt: string;
}

/** An archive request is one short action (and maybe a page id); anything bigger is refused before it is parsed (413). */
export const MAX_ARCHIVE_BODY_BYTES = 1024;

const JOB_ID = /^[a-z0-9-]{1,80}$/;

/** Where a run's archive marker lives. The id must be a bare job id (a path segment never leaves runs/). */
export function archiveFilePath(storageDir: string, jobId: string): string {
  if (!JOB_ID.test(jobId)) throw new Error('JOB_ID_INVALID');
  return join(storageDir, 'runs', jobId, 'archive.json');
}

/** The stored marker, or null when there is none or the file is damaged or not a { archivedAt: ISO } object. */
export function readArchive(storageDir: string, jobId: string): ArchiveRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(archiveFilePath(storageDir, jobId), 'utf8')) as unknown;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const at = (raw as Record<string, unknown>)['archivedAt'];
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return null;
  return { archivedAt: at };
}

/** Atomic write: the temp file sits beside archive.json, so the rename stays on one volume. */
export function writeArchive(storageDir: string, jobId: string, archivedAt: string): void {
  const target = archiveFilePath(storageDir, jobId);
  const temp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify({ archivedAt }, null, 2)}\n`, 'utf8');
    renameSync(temp, target);
  } catch (err: unknown) {
    rmSync(temp, { force: true });
    throw err;
  }
}

/** Restore: delete the marker (nothing to do when there is none). */
export function deleteArchive(storageDir: string, jobId: string): void {
  const target = archiveFilePath(storageDir, jobId);
  if (existsSync(target)) rmSync(target, { force: true });
}

/**
 * A run is finished once the worker has settled it. Only an explicit terminal status counts: a status this code does
 * not know is treated as still in progress, so an unrecognised run is never archived.
 */
export function isFinished(status: unknown): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'unsupported';
}

/**
 * config/pinned-runs.json: { note, runs: [{ jobId, why }] }. The ids the app links to by name; they are never archived.
 * A missing or damaged file means no pins (the bulk rule then simply has nothing extra to protect), and entries that
 * are not a bare job id are skipped. Nothing is logged: the file holds no secrets, and silence keeps startup quiet.
 */
export function loadPinnedRuns(file: string): Set<string> {
  const out = new Set<string>();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return out;
  }
  const runs = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['runs'] : undefined;
  if (!Array.isArray(runs)) return out;
  for (const entry of runs as unknown[]) {
    const id = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>)['jobId'] : undefined;
    if (typeof id === 'string' && JOB_ID.test(id)) out.add(id);
  }
  return out;
}

/** The fields of a listed run that the bulk rule reads. */
export interface ArchiveCandidate {
  jobId: string;
  sourceId: string;
  status: string;
  /** Absent on runs recorded before the flow field: those are activity runs. */
  flow?: string | undefined;
  createdAt: string;
}

export interface OlderCopiesState {
  pinned: ReadonlySet<string>;
  published: ReadonlySet<string>;
  archived: ReadonlySet<string>;
  /** Restrict the work to one page. An unknown page matches nothing. */
  sourceId?: string | undefined;
}

/** Newest first; equal times fall back to the job id so the answer never depends on input order. */
const newestFirst = (a: ArchiveCandidate, b: ArchiveCandidate): number =>
  b.createdAt.localeCompare(a.createdAt) || b.jobId.localeCompare(a.jobId);

/**
 * The runs "Archive older copies" archives. Per page, over the runs that are not archived yet:
 *   1. the keeper is the newest succeeded lesson; failing that, the newest succeeded run of any flow; failing that, none;
 *   2. every other run of the page is selected unless it is published, pinned, or not finished.
 * The keeper is chosen before those exclusions, so a published or pinned newest copy still keeps its page and the older
 * copies behind it go. Returns the selected job ids newest first.
 */
export function olderCopies(jobs: readonly ArchiveCandidate[], state: OlderCopiesState): string[] {
  const pages = new Map<string, ArchiveCandidate[]>();
  for (const job of jobs) {
    if (state.sourceId !== undefined && job.sourceId !== state.sourceId) continue;
    if (state.archived.has(job.jobId)) continue;
    const page = pages.get(job.sourceId);
    if (page === undefined) pages.set(job.sourceId, [job]);
    else page.push(job);
  }
  const selected: ArchiveCandidate[] = [];
  for (const page of pages.values()) {
    const ordered = [...page].sort(newestFirst);
    const keeper =
      ordered.find(j => j.status === 'succeeded' && j.flow === 'lesson') ?? ordered.find(j => j.status === 'succeeded');
    for (const job of ordered) {
      if (job === keeper) continue;
      if (!isFinished(job.status) || state.published.has(job.jobId) || state.pinned.has(job.jobId)) continue;
      selected.push(job);
    }
  }
  return selected.sort(newestFirst).map(j => j.jobId);
}
