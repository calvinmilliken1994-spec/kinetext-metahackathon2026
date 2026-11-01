// Data hooks: health, sources, source text, jobs and job detail (polled every 1.5 s while running).

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, describeError } from './api.ts';
import type { Health, JobDetail, JobSummary, SourceDoc, SourceMeta } from './api.ts';
import type { ModelOption } from './lib/models.ts';
import type { Access } from './lib/access.ts';
import { subscribeReviewChanged } from './lib/review.ts';

export const POLL_MS = 1500;
/** /api/health poll: the authoritative busy flag for the Generate button (R-10). */
export const HEALTH_POLL_MS = 3000;

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

export type Loadable<T> =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; data: T };

/** Polls /api/health every 3 s while mounted; `refresh()` re-polls immediately (e.g. right after POSTing a job). */
export function useHealth(): { health: Health | null; down: boolean; refresh: () => Promise<void> } {
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
      timer = setTimeout(() => { void tick(); }, HEALTH_POLL_MS);
    };
    void tick();
    return () => { ctl.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const h = await api.health();
      setHealth(h);
      setDown(false);
    } catch {
      setDown(true);
    }
  }, []);
  return { health, down, refresh };
}

/**
 * The model picker list from GET /api/models. Re-read whenever /api/health reports different model availability.
 * A server without /api/models (older build) or a failed read gives an empty list, which hides the picker.
 */
export function useModels(health: Health | null): ModelOption[] {
  const [models, setModels] = useState<ModelOption[]>([]);
  const signature = health === null ? 'none' : `${health.live ? 1 : 0}:${health.models?.['muse-spark-1.3'] === true ? 1 : 0}:${health.models?.['muse-spark-open'] === true ? 1 : 0}`;
  useEffect(() => {
    const ctl = new AbortController();
    api.models(ctl.signal).then(
      (data) => setModels(data),
      (e: unknown) => { if (!isAbort(e)) setModels([]); },
    );
    return () => ctl.abort();
  }, [signature]);
  return models;
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

/** Job list; polls every 1.5 s while the SERVER reports busy (not while stale 'running' records exist). */
export function useJobs(serverBusy: boolean): { jobs: Loadable<JobSummary[]>; refresh: () => void } {
  const [jobs, setJobs] = useState<Loadable<JobSummary[]>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  // Stage 10b: a review published or removed changes the "Published" mark in All lessons.
  useEffect(() => subscribeReviewChanged(() => setNonce((n) => n + 1)), []);
  // Re-fetch when busy flips (a finished job must appear without a manual reload).
  useEffect(() => {
    const ctl = new AbortController();
    api.jobs(ctl.signal).then(
      (data) => setJobs({ state: 'ready', data }),
      (e: unknown) => { if (!isAbort(e)) setJobs({ state: 'error', message: describeError(e) }); },
    );
    return () => ctl.abort();
  }, [nonce, serverBusy]);
  useEffect(() => {
    if (!serverBusy) return;
    const t = setInterval(() => setNonce((n) => n + 1), POLL_MS);
    return () => clearInterval(t);
  }, [serverBusy]);
  return { jobs, refresh: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useJobDetail(jobId: string | null): Loadable<JobDetail> | null {
  const [slot, setSlot] = useState<{ id: string; value: Loadable<JobDetail> } | null>(null);
  const running = useRef(false);
  // Stage 10b: publishing or unpublishing this lesson (Review page) reads it again, so the lesson, slides and status line follow.
  const [reviewNonce, setReviewNonce] = useState(0);
  useEffect(() => subscribeReviewChanged((changed) => { if (changed === jobId) setReviewNonce((n) => n + 1); }), [jobId]);
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
  }, [jobId, reviewNonce]);
  if (jobId === null) return null;
  if (slot === null || slot.id !== jobId) return { state: 'loading' };
  return slot.value;
}

/** Stage 10: how often the judge access state (budget left, paused) is re-read while the page is open. */
export const ACCESS_POLL_MS = 20000;

/**
 * GET /api/access, re-read every 20 s and on demand. `set` takes the answer of a sign-in or sign-out straight away.
 * An API without the route (404) is "gate off", so the app behaves exactly as before.
 */
export function useAccess(): { access: Access; refresh: () => Promise<void>; set: (a: Access) => void } {
  const [access, setAccess] = useState<Access>({ state: 'loading' });
  useEffect(() => {
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      try {
        setAccess(await api.getAccess(ctl.signal));
      } catch (e) {
        if (isAbort(e)) return;
      }
      timer = setTimeout(() => { void tick(); }, ACCESS_POLL_MS);
    };
    void tick();
    return () => { ctl.abort(); if (timer !== undefined) clearTimeout(timer); };
  }, []);
  const refresh = useCallback(async (): Promise<void> => {
    try { setAccess(await api.getAccess()); } catch { /* aborted */ }
  }, []);
  return { access, refresh, set: setAccess };
}
