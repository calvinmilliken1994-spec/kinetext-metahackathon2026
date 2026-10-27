// Data hooks: health, sources, source text, jobs and job detail (polled every 1.5 s while running).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from './api.ts';
import type { Health, JobDetail, JobSummary, SourceDoc, SourceMeta } from './api.ts';

export const POLL_MS = 1500;

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T };

export function useHealth(): { health: Health | null; down: boolean } {
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        const h = await api.health(ctl.signal);
        setHealth(h);
        setDown(false);
      } catch (e) {
        if (isAbort(e)) return;
        setDown(true);
      }
      timer = setTimeout(() => { void tick(); }, 8000);
    };
    void tick();
    return () => { ctl.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, []);
  return { health, down };
}

export function useSources(): { sources: Loadable<SourceMeta[]>; reload: () => void } {
  const [sources, setSources] = useState<Loadable<SourceMeta[]>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setSources({ state: 'loading' });
    api.sources(ctl.signal).then(
      (data) => setSources({ state: 'ready', data }),
      (e: unknown) => { if (!isAbort(e)) setSources({ state: 'error', message: describeError(e) }); },
    );
    return () => ctl.abort();
  }, [nonce]);
  return { sources, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useSourceDoc(id: string | null): Loadable<SourceDoc> | null {
  const [doc, setDoc] = useState<{ id: string; value: Loadable<SourceDoc> } | null>(null);
  useEffect(() => {
    if (id === null) return;
    const ctl = new AbortController();
    api.source(id, ctl.signal).then(
      (data) => setDoc({ id, value: { state: 'ready', data } }),
      (e: unknown) => { if (!isAbort(e)) setDoc({ id, value: { state: 'error', message: describeError(e) } }); },
    );
    return () => ctl.abort();
  }, [id]);
  if (id === null) return null;
  if (doc === null || doc.id !== id) return { state: 'loading' };
  return doc.value;
}

export function useJobs(): { jobs: Loadable<JobSummary[]>; refresh: () => void } {
  const [jobs, setJobs] = useState<Loadable<JobSummary[]>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  const anyRunning = jobs.state === 'ready' && jobs.data.some((j) => j.status === 'running');
  useEffect(() => {
    const ctl = new AbortController();
    api.jobs(ctl.signal).then(
      (data) => setJobs({ state: 'ready', data }),
      (e: unknown) => { if (!isAbort(e)) setJobs({ state: 'error', message: describeError(e) }); },
    );
    return () => ctl.abort();
  }, [nonce]);
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [anyRunning]);
  return { jobs, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useJobDetail(jobId: string | null): Loadable<JobDetail> | null {
  const [slot, setSlot] = useState<{ id: string; value: Loadable<JobDetail> } | null>(null);
  const running = useRef(false);
  useEffect(() => {
    if (jobId === null) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    running.current = false;
    const load = async (): Promise<void> => {
      try {
        const data = await api.job(jobId, ctl.signal);
        setSlot({ id: jobId, value: { state: 'ready', data } });
        running.current = data.summary.status === 'running';
      } catch (e) {
        if (isAbort(e)) return;
        setSlot({ id: jobId, value: { state: 'error', message: describeError(e) } });
        running.current = false;
      }
      if (running.current && !ctl.signal.aborted) timer = setTimeout(() => { void load(); }, POLL_MS);
    };
    void load();
    return () => { ctl.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, [jobId]);
  if (jobId === null) return null;
  if (slot === null || slot.id !== jobId) return { state: 'loading' };
  return slot.value;
}
