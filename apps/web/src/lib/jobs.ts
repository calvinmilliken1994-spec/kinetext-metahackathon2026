// Pure job / pipeline helpers: live-vs-recorded badge, stage timeline from REAL StageEvents, cost totals.
// No React, no DOM. Types come from the shared contracts.

import type { Stage, StageEvent, Usage } from '../../../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

/** Minimal job shape needed here (the API's JobSummary is a superset). */
export interface JobLike { jobId: string; status: JobStatus; createdAt: string }

export const INTERRUPTED_CODE = 'INTERRUPTED';
export const INTERRUPTED_TEXT = 'Interrupted — the server stopped before this job finished.';

/** A job the server marked failed with code INTERRUPTED on restart (R-10). */
export function isInterrupted(job: { status: JobStatus; error?: { code: string } | undefined }): boolean {
  return job.status === 'failed' && job.error?.code === INTERRUPTED_CODE;
}

export interface StatusLabel { text: string; tone: 'ok' | 'warn' | 'bad' | 'running' }

/**
 * Runs-list status for a job summary. 'Checks n/n' = machine checks only (R-08).
 * `serverBusy === false` means /api/health says nothing is running, so a 'running' record is stale.
 */
export function jobStatusLabel(job: {
  status: JobStatus; checksPassed?: number | undefined; checksTotal?: number | undefined; error?: { code: string } | undefined;
}, serverBusy: boolean | null = null): StatusLabel {
  switch (job.status) {
    case 'running':
      return serverBusy === false ? { text: 'Stale (not running)', tone: 'warn' } : { text: 'Running', tone: 'running' };
    case 'succeeded':
      return job.checksPassed !== undefined && job.checksTotal !== undefined
        ? { text: `Checks ${job.checksPassed}/${job.checksTotal}`, tone: job.checksPassed === job.checksTotal ? 'ok' : 'warn' }
        : { text: 'Succeeded', tone: 'ok' };
    case 'unsupported': return { text: 'Not supported yet', tone: 'warn' };
    case 'failed': return isInterrupted(job) ? { text: 'Interrupted', tone: 'warn' } : { text: 'Failed', tone: 'bad' };
  }
}

export interface RunBadge {
  kind: 'live' | 'recorded';
  /** Visible text. */
  label: string;
}

/** Default local date-time formatter (browser locale / time zone). */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * 'Live run' ONLY for a job id this browser session started; everything else is a stored result
 * and is labelled 'Recorded run · <local date time>' so stored runs are never presented as live.
 */
export function runBadge(
  job: Pick<JobLike, 'jobId' | 'createdAt'>,
  liveJobIds: ReadonlySet<string>,
  fmt: (iso: string) => string = formatLocalDateTime,
): RunBadge {
  if (liveJobIds.has(job.jobId)) return { kind: 'live', label: 'Live run' };
  return { kind: 'recorded', label: `Recorded run · ${fmt(job.createdAt)}` };
}

export const STAGE_ORDER: readonly Stage[] = ['ingest', 'analyze', 'specify', 'inject', 'validate', 'repair', 'done'];

export const STAGE_LABEL: Record<Stage, string> = {
  ingest: 'Ingest source',
  analyze: 'Analyse source',
  specify: 'Specify activity',
  inject: 'Demo fault (system-injected)',
  validate: 'Validate',
  repair: 'Repair',
  done: 'Done',
};

/** Step heading of a source-analysis repair, between 'Analyse source' and 'Specify activity'. */
export const ANALYSIS_REPAIR_STEP = 'Repair analysis';

export type RowStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface TimelineRow {
  stage: Stage;
  /** Spec revision for inject / validate / repair rows (Stage 5); absent for other stages and older runs. */
  revision?: number;
  /** 'analysis' for a source-analysis repair (TASK-024b); absent for spec repairs and every other stage. */
  target?: 'analysis';
  status: RowStatus;
  /** Wall time between the stage's started and finished events; null while running/pending. */
  durationMs: number | null;
  model?: string;
  responseId?: string;
  usage?: Usage | null;
  latencyMs?: number;
  estCostUSD?: number;
  detail?: string;
}

function rowFromEvents(stage: Stage, evs: readonly StageEvent[], revision: number | undefined, target?: 'analysis'): TimelineRow {
  const started = evs.find((e) => e.status === 'started');
  const finished = [...evs].reverse().find((e) => e.status !== 'started');
  const row: TimelineRow = {
    stage,
    status: finished ? finished.status as RowStatus : 'running',
    durationMs: null,
  };
  if (revision !== undefined) row.revision = revision;
  if (target !== undefined) row.target = target;
  if (started && finished) {
    const d = Date.parse(finished.at) - Date.parse(started.at);
    row.durationMs = Number.isFinite(d) && d >= 0 ? d : null;
  }
  const src = finished ?? started;
  if (src) {
    if (src.model !== undefined) row.model = src.model;
    if (src.responseId !== undefined) row.responseId = src.responseId;
    if (src.usage !== undefined) row.usage = src.usage;
    if (src.latencyMs !== undefined) row.latencyMs = src.latencyMs;
    if (src.estCostUSD !== undefined) row.estCostUSD = src.estCostUSD;
    if (src.detail !== undefined) row.detail = src.detail;
  }
  return row;
}

/**
 * Build the timeline strictly from the events that exist. Stages that have no event yet appear as
 * 'pending' ONLY while the job is still running (so progress is visible); a finished job never shows
 * invented rows. 'inject' and 'repair' appear only when the pipeline actually emitted them.
 * Stage 5: events are grouped per (stage, revision), so validate / repair rows exist once per revision
 * and rows come out in the order the pipeline emitted them (validate r1 → repair r2 → validate r2 → …).
 */
export function buildTimeline(events: readonly StageEvent[], jobStatus: JobStatus, analysisRepairs?: readonly { revision: number; passed: boolean }[]): TimelineRow[] {
  const groups = new Map<string, { stage: Stage; revision: number | undefined; target: 'analysis' | undefined; evs: StageEvent[] }>();
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    const revision = e.stage === 'inject' || e.stage === 'validate' || e.stage === 'repair' ? e.revision : undefined;
    // TASK-024b: analysis repairs carry target 'analysis' and share revision numbers with spec repairs, so they get their own rows.
    const target = e.stage === 'repair' && e.target === 'analysis' ? 'analysis' : undefined;
    const key = `${e.stage}:${target ?? ''}:${revision ?? ''}`;
    const g = groups.get(key) ?? { stage: e.stage, revision, target, evs: [] };
    g.evs.push(e);
    groups.set(key, g);
  }
  const rows: TimelineRow[] = [...groups.values()].map((g) => {
    const row = rowFromEvents(g.stage, g.evs, g.revision, g.target);
    if (g.target === 'analysis' && row.status === 'succeeded') {
      // The repair CALL succeeded, but the repaired analysis may still fail its checks: never show that as a green tick.
      const rec = analysisRepairs?.find((r) => r.revision === g.revision);
      if (rec !== undefined ? !rec.passed : (row.detail ?? '').includes('still failing')) row.status = 'failed';
    }
    return row;
  });
  // The Analyse step ends when the analysis is final, i.e. after its repairs; show only the analysis call's own time.
  const repairMs = rows.reduce((sum, r) => sum + (r.target === 'analysis' && r.durationMs !== null ? r.durationMs : 0), 0);
  const analyze = rows.find((r) => r.stage === 'analyze');
  if (analyze !== undefined && analyze.durationMs !== null && repairMs > 0) analyze.durationMs = Math.max(0, analyze.durationMs - repairMs);
  if (jobStatus === 'running') {
    const present = new Set(rows.map((r) => r.stage));
    for (const stage of STAGE_ORDER) {
      if (!present.has(stage) && stage !== 'repair' && stage !== 'inject') rows.push({ stage, status: 'pending', durationMs: null });
    }
  }
  return rows;
}

/** Row heading: 'Validate · revision 2'. Revision-less rows keep their plain stage label. */
export function rowLabel(row: Pick<TimelineRow, 'stage' | 'revision' | 'target'>): string {
  if (row.target === 'analysis') return row.revision !== undefined && row.revision > 1 ? `${ANALYSIS_REPAIR_STEP} · attempt ${row.revision - 1}` : ANALYSIS_REPAIR_STEP;
  return row.revision !== undefined && row.stage !== 'inject' ? `${STAGE_LABEL[row.stage]} · revision ${row.revision}` : STAGE_LABEL[row.stage];
}


/** Sum of estCostUSD reported by events; null when no event carries a cost (unknown, never zero). */
export function totalEventCost(events: readonly StageEvent[]): number | null {
  let total = 0;
  let any = false;
  for (const e of events) {
    if (typeof e.estCostUSD === 'number') { total += e.estCostUSD; any = true; }
  }
  return any ? total : null;
}

/** Last 8 characters of a response id, e.g. chatcmpl-01a1…-ef9ecdc → '…c8c7bd'. */
export function shortId(id: string): string {
  return id.length <= 10 ? id : `…${id.slice(-8)}`;
}

export function formatCostUSD(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(2)} s` : `${s.toFixed(1)} s`;
}

export function formatTokens(u: Usage | null | undefined): string | null {
  if (!u) return null;
  return `${u.promptTokens.toLocaleString('en-US')} prompt · ${u.completionTokens.toLocaleString('en-US')} completion · ${u.reasoningTokens.toLocaleString('en-US')} reasoning`;
}

/** Newest-first by createdAt (stable for equal stamps). */
export function newestFirst<T extends Pick<JobLike, 'createdAt'>>(jobs: readonly T[]): T[] {
  return [...jobs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Pick the job to show for a source: a running one (only when the SERVER is busy — a stale 'running'
 * record left by a dead process must not hijack the view), else the newest succeeded, else the newest.
 */
export function pickDefaultJob<T extends JobLike>(jobsForSource: readonly T[], serverBusy: boolean): T | null {
  const sorted = newestFirst(jobsForSource);
  return (serverBusy ? sorted.find((j) => j.status === 'running') : undefined)
    ?? sorted.find((j) => j.status === 'succeeded')
    ?? sorted[0]
    ?? null;
}
