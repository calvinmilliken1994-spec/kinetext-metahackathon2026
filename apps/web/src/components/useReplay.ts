// Stage 9 replay: plays a stored job's recorded events through the live build view (lib/replay.ts rebuilds each moment's
// detail). The stored detail is read once through the existing GET /api/jobs/:id; nothing is posted.
// Demo v2: the clock can be sought (the Demo's Next and Back) and held (a beat's minimum dwell); see lib/replay.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobDetail } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { normaliseJobDetail } from '../lib/lessonJob.ts';
import { clockHold, clockRead, clockSeek, clockStart, replayBounds, replaySnapshot, replayStep } from '../lib/replay.ts';
import type { ReplayClock, ReplayRequest } from '../lib/replay.ts';
import type { JobClock } from './LiveBuild.tsx';

export interface ReplayState {
  detail: Loadable<JobDetail> | null;
  clock: JobClock;
  finished: boolean;
  recordedAt: string;
  restart: () => void;
  /** Fetch the stored run again after a failed read (the tour's Retry). */
  retry: () => void;
  /** Jump to job time `t` (ms), held below `cap` when given. */
  seek: (t: number, cap?: number | null) => void;
  /** Hold the replay at job time `cap` at most (null: play on from where it stands). */
  hold: (cap: number | null) => void;
}

export function useReplay(req: ReplayRequest | null): ReplayState {
  const [raw, setRaw] = useState<{ id: string; value: Loadable<unknown> } | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [finished, setFinished] = useState(false);
  const [run, setRun] = useState(0);
  const [attempt, setAttempt] = useState(0);
  // Bumped whenever the clock is started, sought or held, so the frame loop reschedules from the new time.
  const [moved, setMoved] = useState(0);
  const speed = req?.speed ?? 1;
  const timer = useRef<ReplayClock>(clockStart(speed, Date.now()));
  const clock = useCallback<JobClock>(() => clockRead(timer.current, Date.now()), []);

  const jobId = req?.jobId ?? null;
  useEffect(() => {
    if (jobId === null) return undefined;
    const ctl = new AbortController();
    fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'No stored run has that id.' : `The stored run could not be read (HTTP ${res.status}).`);
        return res.json() as Promise<unknown>;
      })
      .then(
        (value) => setRaw({ id: jobId, value: { state: 'ready', data: value } }),
        (e: unknown) => { if (!(e instanceof DOMException && e.name === 'AbortError')) setRaw({ id: jobId, value: { state: 'error', message: e instanceof Error ? e.message : 'The stored run could not be read.' } }); },
      );
    return () => ctl.abort();
  }, [jobId, attempt]);

  const data = raw !== null && raw.id === jobId && raw.value.state === 'ready' ? raw.value.data : null;
  // A new recording, Restart ("Replay again") or another speed starts the clock again from the lead-in.
  useEffect(() => {
    if (data === null) return;
    timer.current = clockStart(speed, Date.now());
    setMoved((n) => n + 1);
  }, [data, run, speed]);

  useEffect(() => {
    if (data === null) return undefined;
    let id: ReturnType<typeof setTimeout> | undefined;
    let shown = -1;
    const frame = (): void => {
      const t = clock();
      const snap = replaySnapshot(data, t) as { events?: unknown[] };
      const n = Array.isArray(snap.events) ? snap.events.length : 0;
      const next = replayStep(data, t);
      // A new frame only when another event has happened (or a seek moved back), so the app re-renders on events.
      if (n !== shown || next === null) { shown = n; setDetail(normaliseJobDetail(snap)); }
      setFinished(next === null);
      if (next === null) return;
      // Held before the next event: nothing to do until the hold moves, which restarts this loop.
      const cap = timer.current.cap;
      if (cap !== null && next > cap) return;
      id = setTimeout(frame, Math.max(16, (next - t) / timer.current.speed + 4));
    };
    frame();
    return () => { if (id !== undefined) clearTimeout(id); };
  }, [data, moved, clock]);

  const recordedAt = useMemo(() => {
    const b = data === null ? null : replayBounds(data);
    return b === null ? '' : new Date(b.startAt).toISOString();
  }, [data]);

  const restart = useCallback(() => setRun((n) => n + 1), []);
  const retry = useCallback(() => { setRaw(null); setAttempt((n) => n + 1); }, []);
  const seek = useCallback((t: number, cap: number | null = null) => {
    timer.current = clockSeek(timer.current, t, Date.now(), cap);
    setMoved((n) => n + 1);
  }, []);
  const hold = useCallback((cap: number | null) => {
    const next = clockHold(timer.current, cap, Date.now());
    if (next === timer.current) return;
    timer.current = next;
    setMoved((n) => n + 1);
  }, []);
  let out: Loadable<JobDetail> | null = null;
  if (jobId !== null) {
    if (raw === null || raw.id !== jobId) out = { state: 'loading' };
    else if (raw.value.state === 'error') out = { state: 'error', message: raw.value.message };
    else out = detail === null ? { state: 'loading' } : { state: 'ready', data: detail };
  }
  return { detail: out, clock, finished, recordedAt, restart, retry, seek, hold };
}
