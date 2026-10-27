// Pure job / pipeline helpers: live-vs-recorded badge, stage timeline from REAL StageEvents, cost totals.
// No React, no DOM. Types come from the shared contracts.

import type { Stage, StageEvent, Usage } from '../../../../packages/contracts/index.ts';

export type JobStatus = 'running' | 'succeeded' | 'unsupported' | 'failed';

/** Minimal job shape needed here (the API's JobSummary is a superset). */
export interface JobLike { jobId: string; status: JobStatus; createdAt: string }

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

export const STAGE_ORDER: readonly Stage[] = ['ingest', 'analyze', 'specify', 'validate', 'repair', 'done'];

export const STAGE_LABEL: Record<Stage, string> = {
  ingest: 'Ingest source',
  analyze: 'Analyse source',
  specify: 'Specify activity',
  validate: 'Validate',
  repair: 'Repair',
  done: 'Done',
};

export type RowStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface TimelineRow {
  stage: Stage;
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

/**
 * Build the timeline strictly from the events that exist. Stages that have no event yet appear as
 * 'pending' ONLY while the job is still running (so progress is visible); a finished job never shows
 * invented rows. 'repair' appears only when the pipeline actually emitted it.
 */
export function buildTimeline(events: readonly StageEvent[], jobStatus: JobStatus): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const stage of STAGE_ORDER) {
    const evs = events.filter((e) => e.stage === stage).sort((a, b) => a.seq - b.seq);
    if (evs.length === 0) {
      if (jobStatus === 'running' && stage !== 'repair') rows.push({ stage, status: 'pending', durationMs: null });
      continue;
    }
    const started = evs.find((e) => e.status === 'started');
    const finished = [...evs].reverse().find((e) => e.status !== 'started');
    const row: TimelineRow = {
      stage,
      status: finished ? finished.status as RowStatus : 'running',
      durationMs: null,
    };
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
    rows.push(row);
  }
  return rows;
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

/** Pick the job to show for a source: a running one, else the newest succeeded, else the newest. */
export function pickDefaultJob<T extends JobLike>(jobsForSource: readonly T[]): T | null {
  const sorted = newestFirst(jobsForSource);
  return sorted.find((j) => j.status === 'running')
    ?? sorted.find((j) => j.status === 'succeeded')
    ?? sorted[0]
    ?? null;
}
