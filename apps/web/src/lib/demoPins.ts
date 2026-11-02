// The demo's fixed opening runs (demo pair review #13). A plain visit and the first-run tour open these known-good stored
// runs instead of "the most recent run", so a new run made before filming cannot change the demo's first frame.
// Pure: no React, no DOM.

import type { OpeningJob } from './jobs.ts';

export const DEMO_PINS = {
  /**
   * The run the Demo replays (Stage 10c): NOAA water cycle on Muse Spark 1.3, 2 Nov. Muse located every part, SAM 3.1
   * outlined them, and the first draft failed LD-06 naturally (SAM's cloud spilled past where Muse located it); Muse
   * revised and revision 2 passed 13/13.
   */
  tour: 'job-20261101234914-97ba271b',
  /**
   * What a plain visit opens, first listed one wins: the same run the Demo replays, so the guide, the Demo and the
   * finished lesson are one lesson (Calvin, 2 Nov). Then the earlier Stage 8c water-cycle run, then the 31 Oct run.
   */
  opening: ['job-20261101234914-97ba271b', 'job-20261101200607-c65a20bb', 'job-20261031081105-910f3776'],
} as const;

type Listed = { jobId: string; sourceId: string; status: string; flow?: 'lesson' | 'activity' | undefined };

/** The first pinned opening run that the server lists as a finished lesson, or null (the app then opens its newest lesson). */
export function pinnedOpening(jobs: readonly Listed[]): OpeningJob | null {
  for (const id of DEMO_PINS.opening) {
    const j = jobs.find((x) => x.jobId === id);
    if (j !== undefined && j.status === 'succeeded' && j.flow === 'lesson') return { jobId: j.jobId, sourceId: j.sourceId };
  }
  return null;
}

/** The key under which the app remembers the lesson this browser showed last. */
export const LAST_SHOWN_KEY = 'mki.lastJob';

/**
 * What a plain visit opens: the lesson this browser showed last, when the server still lists it as a finished lesson
 * (a teacher comes back to their own work), else the pinned demo run (a fresh browser, e.g. a judge or a recording).
 */
export function openingFor(jobs: readonly Listed[], lastShown: string | null): OpeningJob | null {
  if (lastShown !== null) {
    const j = jobs.find((x) => x.jobId === lastShown);
    if (j !== undefined && j.status === 'succeeded' && j.flow === 'lesson') return { jobId: j.jobId, sourceId: j.sourceId };
  }
  return pinnedOpening(jobs);
}
