// Deep links to a saved run (Set A items 1 and 3). `?job=`, `?present=` and `?replay=` name one stored run; when the run
// is not in the server's list the app shows a calm "not found" notice and opens no other lesson in its place (a teacher
// could otherwise present the wrong lesson without noticing). A `?replay=` link to a classic single-activity run is turned
// down with a clear message and opens the stored result: replays play lesson builds only. Pure: no React, no DOM.

import { newestFirst, pickOpeningJob } from './jobs.ts';
import type { JobLike, OpeningJob } from './jobs.ts';

export type LinkKind = 'job' | 'present' | 'replay';
export interface RunLink { kind: LinkKind; jobId: string }

/**
 * The run a deep link names, in the order the app opens them (`?replay=` first, then `?job=`, then `?present=`), or null
 * for a plain visit. The id is kept as written, even when it is malformed, so the notice can say nothing was found.
 */
export function runLink(search: string): RunLink | null {
  const q = new URLSearchParams(search);
  for (const kind of ['replay', 'job', 'present'] as const) {
    const id = q.get(kind);
    if (id !== null) return { kind, jobId: id.trim() };
  }
  return null;
}

export type LinkProblem = 'not-found' | 'unreadable' | 'classic-replay';
export interface LinkNoticeState { problem: LinkProblem; kind: LinkKind; jobId: string }

export interface LinkResolution {
  /** The run to open; null means none (the notice stands in for a lesson). */
  opening: OpeningJob | null;
  notice: LinkNoticeState | null;
  /** Play the opened run as a replay (only a lesson-flow run named by `?replay=`). */
  replay: boolean;
}

type ListedJob = JobLike & { sourceId: string; flow?: 'lesson' | 'activity' | undefined };

/** What a deep link opens, given the server's runs list. */
export function resolveRunLink(link: RunLink | null, jobs: readonly ListedJob[]): LinkResolution {
  if (link === null) return { opening: pickOpeningJob(jobs, null), notice: null, replay: false };
  const job = link.jobId === '' ? undefined : jobs.find((j) => j.jobId === link.jobId);
  if (job === undefined) return { opening: null, notice: { problem: 'not-found', kind: link.kind, jobId: link.jobId }, replay: false };
  const opening = { jobId: job.jobId, sourceId: job.sourceId };
  if (link.kind === 'replay' && job.flow !== 'lesson') return { opening, notice: { problem: 'classic-replay', kind: 'replay', jobId: job.jobId }, replay: false };
  return { opening, notice: null, replay: link.kind === 'replay' };
}

/** The newest succeeded lesson, for the notice's "open the latest lesson" button (null when there is none). */
export function latestLesson(jobs: readonly ListedJob[]): OpeningJob | null {
  const j = newestFirst(jobs).find((x) => x.status === 'succeeded' && x.flow === 'lesson');
  return j === undefined ? null : { jobId: j.jobId, sourceId: j.sourceId };
}

export const MISSING_TITLE = 'That saved lesson was not found';

const LINK_WORDS: Readonly<Record<LinkKind, string>> = {
  job: 'The link names a lesson',
  present: 'The presentation link names a lesson',
  replay: 'The replay link names a run',
};

/** The notice's title and body. */
export function linkNotice(n: LinkNoticeState): { title: string; body: string } {
  switch (n.problem) {
    case 'not-found':
      return { title: MISSING_TITLE, body: `${LINK_WORDS[n.kind]} that this server does not have, so nothing was opened in its place. Choose a lesson from the library instead.` };
    case 'unreadable':
      return { title: MISSING_TITLE, body: 'The server lists it, but its saved files could not be read, so nothing was opened in its place. Choose a lesson from the library instead.' };
    case 'classic-replay':
      return { title: 'This run can’t be replayed', body: 'Replays play back how a lesson was built, and this is an older single-activity run. Its stored result is shown instead.' };
  }
}
