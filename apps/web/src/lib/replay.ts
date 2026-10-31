// Replay of a recorded lesson run (Stage 9). The stored job's final detail (GET /api/jobs/:id) carries every event with
// its time; from it we rebuild, for any moment t after the job started, the detail the server would have served then: the
// events up to t and each artifact from the event that wrote it. The live-build view then plays it exactly as it plays a
// live poll. Pure: no React, no DOM, no network. Anything malformed replays as the stored detail itself.

import { isKitGenComponentId } from '../../../../packages/contracts/kit.ts';

export const REPLAY_LABEL = 'Replay of a recorded run';
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 16;

export interface ReplayRequest { jobId: string; speed: number }

const JOB_ID = /^[a-z0-9-]{1,80}$/;

/** `?replay=<jobId>[&speed=N]` → the request, else null. Speed defaults to 1 and is clamped to 0.25–16. */
export function replayRequest(search: string): ReplayRequest | null {
  const q = new URLSearchParams(search);
  const jobId = q.get('replay');
  if (jobId === null || !JOB_ID.test(jobId)) return null;
  const raw = Number(q.get('speed') ?? '1');
  const speed = Number.isFinite(raw) && raw > 0 ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, raw)) : 1;
  return { jobId, speed };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';

interface TimedEvent { e: Rec; seq: number; t: number }

function timedEvents(raw: Rec): TimedEvent[] | null {
  if (!Array.isArray(raw.events)) return null;
  const evs = raw.events.filter(isRec).filter((e) => str(e.at) && Number.isFinite(Date.parse(e.at)) && typeof e.seq === 'number');
  if (evs.length === 0) return null;
  const start = Math.min(...evs.map((e) => Date.parse(e.at as string)));
  return evs.map((e) => ({ e, seq: e.seq as number, t: Date.parse(e.at as string) - start })).sort((a, b) => a.seq - b.seq);
}

/** Job time of the recorded run: from its first event (0) to its last (`durationMs`), and the wall time it started. */
export function replayBounds(raw: unknown): { startAt: number; durationMs: number } | null {
  if (!isRec(raw)) return null;
  const evs = timedEvents(raw);
  if (evs === null) return null;
  const start = Math.min(...evs.map((x) => Date.parse(x.e.at as string)));
  return { startAt: start, durationMs: Math.max(...evs.map((x) => x.t)) };
}

/** The job time of the first event after `tMs`, or null when nothing more happens (for scheduling the next frame). */
export function replayStep(raw: unknown, tMs: number): number | null {
  if (!isRec(raw)) return null;
  const evs = timedEvents(raw);
  if (evs === null) return null;
  const next = evs.filter((x) => x.t > tMs).map((x) => x.t);
  return next.length === 0 ? null : Math.min(...next);
}

const ownEvent = (e: Rec, cid: string): boolean => e.componentId === cid && (e.stage === 'component' || e.stage === 'repair' || e.stage === 'segment' || e.stage === 'inject');
const ended = (e: Rec): boolean => e.status !== 'started';

/**
 * The detail as the server would have served it `tMs` after the job's first event. From the last event on, the stored
 * detail itself (unchanged). Before that the job reads as running, with:
 *  - events at or before t;
 *  - analysis revision 1 from the analysis call's end, revision n from analysis repair n's end; the analysis of record
 *    is the latest one shown, and only when its report is publishable (as the server does);
 *  - the lesson file from the overview event (a declined page's from the end), listing only parts whose LAST recorded
 *    event has happened, and only those parts' specs and reports (a revision that failed its checks is never served);
 *  - a component repair record from its repair call's end; the cost as the sum of the costs recorded so far.
 */
export function replaySnapshot(raw: unknown, tMs: number): unknown {
  if (!isRec(raw) || !isRec(raw.summary)) return raw;
  const evs = timedEvents(raw);
  if (evs === null) return raw;
  const end = Math.max(...evs.map((x) => x.t));
  if (tMs >= end) return raw;
  const shown = evs.filter((x) => x.t <= tMs);
  const shownSeq = new Set(shown.map((x) => x.seq));
  const happened = (pred: (e: Rec) => boolean): boolean => shown.some((x) => pred(x.e));
  const lastSeqOf = (pred: (e: Rec) => boolean): number | null => {
    const m = evs.filter((x) => pred(x.e)).map((x) => x.seq);
    return m.length === 0 ? null : Math.max(...m);
  };

  // analysis revisions
  const v2 = (Array.isArray(raw.analysisV2Revisions) ? raw.analysisV2Revisions : []).filter(isRec).filter((r) => typeof r.revision === 'number');
  const v2Shown = v2.filter((r) => (r.revision === 1
    ? happened((e) => e.stage === 'analyze' && ended(e))
    : happened((e) => e.stage === 'repair' && e.target === 'analysis' && e.revision === r.revision && ended(e))));
  const latest = v2Shown[v2Shown.length - 1];
  const latestReport = isRec(latest?.report) ? latest.report : undefined;

  // lesson parts
  const lesson = isRec(raw.lesson) ? raw.lesson : null;
  const overviewShown = happened((e) => e.stage === 'overview' && e.status === 'succeeded');
  const settled = (cid: string): boolean => {
    const s = lastSeqOf((e) => ownEvent(e, cid));
    return s !== null && shownSeq.has(s);
  };
  const entries = (Array.isArray(lesson?.components) ? lesson.components : []).filter(isRec).filter((c) => str(c.componentId) && settled(c.componentId));
  const settledIds = new Set(entries.map((c) => c.componentId as string));
  const keep = <T>(obj: unknown, ok: (k: string, v: unknown) => boolean): Record<string, T> =>
    (isRec(obj) ? Object.fromEntries(Object.entries(obj).filter(([k, v]) => ok(k, v))) as Record<string, T> : {});
  const kitSpecs = keep(raw.kitSpecs, (_k, v) => isRec(v) && str(v.componentId) && settledIds.has(v.componentId));
  const componentReports = keep(raw.componentReports, (k) => [...settledIds].some((cid) => new RegExp(`:${cid}:r\\d+$`).test(k)));
  const repairs = (Array.isArray(raw.componentRepairs) ? raw.componentRepairs : []).filter(isRec)
    .filter((r) => happened((e) => e.stage === 'repair' && e.target === 'component' && e.componentId === r.componentId && e.revision === r.revision && ended(e)));
  const premiumIds = entries.map((c) => c.componentId as string).filter((cid) => !isKitGenComponentId(cid));

  const cost = shown.reduce((sum, x) => sum + (typeof x.e.estCostUSD === 'number' && Number.isFinite(x.e.estCostUSD) ? x.e.estCostUSD : 0), 0);
  const plan = isRec(latest?.analysis) && Array.isArray(latest.analysis.componentPlan) ? latest.analysis.componentPlan.length : 0;
  const passed = entries.filter((c) => c.status === 'passed').length;
  const summary: Rec = {
    ...raw.summary,
    status: 'running',
    totalCostUSD: cost,
    componentRepairs: repairs,
    repairs: [],
    analysisRepairs: (Array.isArray(raw.summary.analysisRepairs) ? raw.summary.analysisRepairs : []).filter(isRec)
      .filter((r) => happened((e) => e.stage === 'repair' && e.target === 'analysis' && e.revision === r.revision && ended(e))),
    lesson: { overviewReady: overviewShown, componentsPlanned: overviewShown ? plan : 0, componentsPublished: passed, componentsFailed: entries.length - passed, partialPublish: false },
  };
  delete summary.finishedAt;
  delete summary.publishedRevision;
  delete summary.bestRevision;
  delete summary.error;

  const out: Rec = {
    ...raw,
    summary,
    events: shown.map((x) => x.e),
    analysisV2Revisions: v2Shown,
    analysisV2Report: latestReport,
    analysisV2: latest !== undefined && latestReport?.publishable === true ? latest.analysis : null,
    lesson: lesson !== null && overviewShown ? { ...lesson, components: entries } : null,
    kitSpecs,
    componentReports,
    componentRepairs: repairs,
  };
  if (premiumIds.length === 0) {
    delete out.spec;
    delete out.report;
    out.revisions = [];
  }
  return out;
}
