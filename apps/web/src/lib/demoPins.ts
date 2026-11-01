// The demo's fixed opening runs (demo pair review #13). A plain visit and the first-run tour open these known-good stored
// runs instead of "the most recent run", so a new run made before filming cannot change the demo's first frame.
// Pure: no React, no DOM.

import type { OpeningJob } from './jobs.ts';

export const DEMO_PINS = {
  /** The run the tour replays: NOAA water cycle on Muse Spark 1.3 (label diagram, two SAM 3.1 calls, one natural repair). */
  tour: 'job-20261031081105-910f3776',
  /** What a plain visit opens, first listed one wins: the same water-cycle run, so the tour replays the lesson on screen. */
  opening: ['job-20261031081105-910f3776'],
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
