// Stage 9 replay: plays a stored job's recorded events through the live build view (lib/replay.ts rebuilds each moment's
// detail). The stored detail is read once through the existing GET /api/jobs/:id; nothing is posted.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JobDetail } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { normaliseJobDetail } from '../lib/lessonJob.ts';
import { replayBounds, replaySnapshot, replayStep } from '../lib/replay.ts';
import type { ReplayRequest } from '../lib/replay.ts';
import type { JobClock } from './LiveBuild.tsx';

/** Job time shown before the first event, so the replay opens on the empty lesson rather than mid-step. */
const LEAD_IN_MS = 800;

export interface ReplayState {
  detail: Loadable<JobDetail> | null;
  clock: JobClock;
  finished: boolean;
  recordedAt: string;
  restart: () => void;
}

export function useReplay(req: ReplayRequest | null): ReplayState {
  const [raw, setRaw] = useState<{ id: string; value: Loadable<unknown> } | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [finished, setFinished] = useState(false);
  const [run, setRun] = useState(0);
  const wallStart = useRef(Date.now());
  const speed = req?.speed ?? 1;
  const clock = useCallback<JobClock>(() => (Date.now() - wallStart.current) * speed - LEAD_IN_MS, [speed]);

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
  }, [jobId]);

  const data = raw !== null && raw.id === jobId && raw.value.state === 'ready' ? raw.value.data : null;
  useEffect(() => {
    if (data === null) return undefined;
    wallStart.current = Date.now();
    setFinished(false);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let shown = -1;
    const frame = (): void => {
      const t = clock();
      const snap = replaySnapshot(data, t) as { events?: unknown[] };
      const n = Array.isArray(snap.events) ? snap.events.length : 0;
      const next = replayStep(data, t);
      // A new frame only when another event has happened, so the app re-renders on events, not on every tick.
      if (n !== shown || next === null) { shown = n; setDetail(normaliseJobDetail(snap)); }
      if (next === null) { setFinished(true); return; }
      timer = setTimeout(frame, Math.max(16, (next - t) / speed + 4));
    };
    frame();
    return () => { if (timer !== undefined) clearTimeout(timer); };
  }, [data, run, clock, speed]);

  const recordedAt = useMemo(() => {
    const b = data === null ? null : replayBounds(data);
    return b === null ? '' : new Date(b.startAt).toISOString();
  }, [data]);

  const restart = useCallback(() => setRun((n) => n + 1), []);
  let out: Loadable<JobDetail> | null = null;
  if (jobId !== null) {
    if (raw === null || raw.id !== jobId) out = { state: 'loading' };
    else if (raw.value.state === 'error') out = { state: 'error', message: raw.value.message };
    else out = detail === null ? { state: 'loading' } : { state: 'ready', data: detail };
  }
  return { detail: out, clock, finished, recordedAt, restart };
}
