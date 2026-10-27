// Generate-button state derived from /api/health (TASK-009 R-10). Pure.
// Busy comes ONLY from the server's `busy` flag — never from scanning historical job summaries,
// which can contain stale 'running' records after a crash.

export interface HealthLike { ok: boolean; live: boolean; busy?: boolean }

/** The server is running a job right now. A missing flag (older server) is treated as not busy. */
export function isServerBusy(health: HealthLike | null | undefined): boolean {
  return health?.busy === true;
}

export interface GenerateInput {
  health: HealthLike | null;
  /** The health poll is failing. */
  down: boolean;
  /** This browser has a POST /api/jobs in flight. */
  generating: boolean;
  hasSource: boolean;
}

export interface GenerateState {
  disabled: boolean;
  /** Show the 'Generating…' label. */
  busy: boolean;
  /** The server has live generation switched off. */
  liveOff: boolean;
  reason: string | null;
}

export const REASON_DOWN = 'The API is unreachable.';
export const REASON_LIVE_OFF = 'Live generation is switched off on this server, so no new Muse calls can be made. Recorded runs below are stored results.';
export const REASON_BUSY = 'The server is running a generation job. Only one can run at a time.';

export function generateState(i: GenerateInput): GenerateState {
  const busy = i.generating || isServerBusy(i.health);
  const liveOff = i.health !== null && !i.health.live;
  if (i.down) return { disabled: true, busy, liveOff, reason: REASON_DOWN };
  if (i.health === null) return { disabled: true, busy, liveOff, reason: null };
  if (liveOff) return { disabled: true, busy, liveOff, reason: REASON_LIVE_OFF };
  if (busy) return { disabled: true, busy, liveOff, reason: REASON_BUSY };
  return { disabled: !i.hasSource, busy, liveOff, reason: null };
}
