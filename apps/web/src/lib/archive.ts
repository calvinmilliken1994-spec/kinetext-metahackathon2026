// Library tidy (docs/specs/LIBRARY-TIDY.md): archiving old copies of a lesson, as the web app sees it. The API owns the
// side file (`archive.json`) and the rules; this file mirrors `archive-older` so a button can say how many runs it will
// archive before it is pressed, and holds the words of the controls. Nothing is ever deleted. Pure: no React, no DOM,
// no network.

import type { Access } from './access.ts';
import type { LessonRow, LessonScope } from './browse.ts';
import { reviewAccess } from './review.ts';

export interface ArchiveRun {
  jobId: string; sourceId: string; createdAt: string; status: string; flow?: string | undefined;
  reviewPublishedAt?: string | undefined; archivedAt?: string | undefined; pinned?: boolean | undefined;
}

const newest = (a: ArchiveRun, b: ArchiveRun): number => b.createdAt.localeCompare(a.createdAt);
const live = <R extends ArchiveRun>(runs: readonly R[]): R[] => runs.filter((r) => r.archivedAt === undefined);

/**
 * The run of ONE page that `archive-older` keeps, over its runs not archived yet: the newest finished lesson, else the
 * newest finished run of any flow, else none.
 */
export function archiveKeeper(runs: readonly ArchiveRun[]): string | null {
  const done = live(runs).filter((r) => r.status === 'succeeded').sort(newest);
  return (done.find((r) => r.flow === 'lesson') ?? done[0])?.jobId ?? null;
}

/** A run a teacher may archive on its own: not archived yet, not published, not pinned, finished. */
export function canArchiveRun(r: ArchiveRun): boolean {
  return r.archivedAt === undefined && r.reviewPublishedAt === undefined && r.pinned !== true && r.status !== 'running';
}

/** The runs `archive-older` would archive: per page, every run but the keeper that may be archived (one page, or everywhere). */
export function olderCopies(runs: readonly ArchiveRun[], sourceId?: string): string[] {
  const byPage = new Map<string, ArchiveRun[]>();
  for (const r of live(runs)) {
    if (sourceId !== undefined && r.sourceId !== sourceId) continue;
    const list = byPage.get(r.sourceId);
    if (list === undefined) byPage.set(r.sourceId, [r]); else list.push(r);
  }
  const out: string[] = [];
  for (const list of byPage.values()) {
    const keeper = archiveKeeper(list);
    for (const r of list) if (r.jobId !== keeper && canArchiveRun(r)) out.push(r.jobId);
  }
  return out;
}

/** Who sees the archive controls: the same gate as publishing (read-only visitors and an unanswered check see none). */
export function canArchive(a: Access): boolean {
  return reviewAccess(a) === 'open';
}

export type RowArchiveAction =
  | { kind: 'archive'; label: string; aria: string }
  | { kind: 'archive-older'; label: string; aria: string; count: number }
  | { kind: 'restore'; label: string; aria: string };

/**
 * The row's own control, beside it: Restore under Archived; "Archive N older" in One per page when the page has older
 * copies; Archive in Every lesson and All runs, never on a published, pinned or unfinished run.
 */
export function rowArchiveAction(row: LessonRow<ArchiveRun>, scope: LessonScope): RowArchiveAction | null {
  const of = row.title;
  if (scope === 'archived') return { kind: 'restore', label: 'Restore', aria: `Restore this run of ${of}` };
  if (scope === 'latest') {
    if (row.older === 0) return null;
    return { kind: 'archive-older', label: `Archive ${row.older} older`, aria: `Archive ${row.older} older ${row.older === 1 ? 'copy' : 'copies'} of ${of}`, count: row.older };
  }
  return canArchiveRun(row.job) ? { kind: 'archive', label: 'Archive', aria: `Archive this run of ${of}` } : null;
}

const num = (n: number): string => n.toLocaleString('en-US');
const copies = (n: number): string => `${num(n)} older ${n === 1 ? 'copy' : 'copies'}`;

/** The inline confirmation of "Archive older copies" for the whole library: how many, and what stays. */
export function archiveConfirmText(count: number, pages: number): string {
  return `Archive ${copies(count)} from ${num(pages)} ${pages === 1 ? 'page' : 'pages'}? Each page keeps its newest lesson, and published and pinned lessons stay. Nothing is deleted: Restore brings any back.`;
}

export type ArchiveChange = 'archive' | 'archive-older' | 'restore' | 'restore-all';

/** The status line after a change: what changed, counted from the API's answer. */
export function archiveStatusText(kind: ArchiveChange, n: number): string {
  switch (kind) {
    case 'archive-older': return n === 0 ? 'Nothing to archive: every page already shows one lesson.' : `Archived ${copies(n)}.`;
    case 'archive': return `Archived ${num(n)} ${n === 1 ? 'run' : 'runs'}. ${n === 1 ? 'It is' : 'They are'} listed under Archived.`;
    case 'restore': return `Restored ${num(n)} ${n === 1 ? 'run' : 'runs'}.`;
    case 'restore-all': return n === 0 ? 'Nothing to restore.' : `Restored ${num(n)} ${n === 1 ? 'run' : 'runs'}.`;
  }
}

/** POST /api/jobs/:id/archive answers `{ archivedAt: ISO | null }`; anything else is null. */
export function parseArchiveAnswer(raw: unknown): { archivedAt: string | null } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = (raw as { archivedAt?: unknown }).archivedAt;
  if (v === null) return { archivedAt: null };
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? { archivedAt: v } : null;
}

/** POST /api/archive answers `{ archived: [...], restored: [...] }`; unreadable parts read as empty lists. */
export function parseBulkAnswer(raw: unknown): { archived: string[]; restored: string[] } {
  const r = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { archived: ids(r.archived), restored: ids(r.restored) };
}

const MESSAGES: Readonly<Record<string, string>> = {
  ACCESS_REQUIRED: 'Archiving needs the judge access code. Browsing, replays and presenting work without one.',
  RUN_PINNED: 'This run stays: the app links to it.',
  RUN_PUBLISHED: 'A published lesson stays. Unpublish it on Review and publish first.',
  RUN_ACTIVE: 'This run is still being built. Archive it once it has finished.',
  NOT_FOUND: 'This run is no longer on the server.',
  BAD_ANSWER: 'The server gave an answer this page does not understand. The list below is reloaded as it is now.',
  HTTP_404: 'This server does not support archiving yet.',
  HTTP_405: 'This server does not support archiving yet.',
  BAD_REQUEST: 'The server did not understand that request. Reload the page and try again.',
  NETWORK: 'Cannot reach the API. Is it running on port 8787?',
  HOST_NOT_ALLOWED: 'The API refused this host. Open the app at http://127.0.0.1:5173.',
  ORIGIN_NOT_ALLOWED: 'The API refused this origin. Open the app at http://127.0.0.1:5173.',
};

export function archiveErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return (typeof code === 'string' ? MESSAGES[code] : undefined) ?? 'The change could not be saved. Try again.';
}
