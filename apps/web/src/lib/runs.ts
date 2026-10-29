// One-line run rows for the runs drawer (pure): "30 Oct 2026, 14:05 · Muse Spark 1.3 · Lesson ready", with the job id,
// cost and the honesty tags (system-made fault, natural repair, items left out) in the details row underneath.

import type { JobSummary } from '../api.ts';
import { analysisRepairTags } from './analysisRepairs.ts';
import { describeJobCost } from './cost.ts';
import { engineTitle } from './engines.ts';
import { INTERRUPTED_TEXT, isInterrupted, jobStatusLabel } from './jobs.ts';
import { lessonRunTags, lessonStatusLabel } from './lessonJob.ts';
import { resolveJobModel } from './models.ts';
import { runTags } from './repairs.ts';

/** The restrained semantic set every tag in the UI maps to. 'fault' is reserved for system-made demo faults. */
export type Tone = 'neutral' | 'accent' | 'ok' | 'bad' | 'fault';

export interface RunTag { text: string; tone: Tone }

export interface RunLine {
  jobId: string;
  /** Local date and time the run started. */
  when: string;
  /** 'Muse Spark 1.3' / 'Muse Spark Open'. */
  model: string;
  /** 'Meta API' / 'Open weights · Modal'. */
  modelHow: string;
  status: { text: string; tone: Tone };
  /** Started from this browser session (shown as "Live"); everything else is a stored result. */
  live: boolean;
  /** The run carried a fault the system planted on purpose (never a model error). */
  systemFault: boolean;
  /** Details row: what was built, repairs, items left out, demo fault. */
  tags: RunTag[];
  cost: string;
  /** Plain-words note for a run the server stopped. */
  note: string | null;
}

/** Map the older per-feature tones (natural, warn, lesson, engine…) onto the semantic set. */
export function toTone(tone: string): Tone {
  switch (tone) {
    case 'ok': return 'ok';
    case 'bad': return 'bad';
    case 'fault': return 'fault';
    case 'running': return 'accent';
    default: return 'neutral';
  }
}

/** Compact local date and time for a run line, e.g. 'Oct 30, 1:30 AM' (browser locale). */
export function compactDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Plain-words status for a run: lesson jobs say what the teacher gets, older jobs keep their check counts. */
export function runStatus(j: JobSummary, serverBusy: boolean | null): { text: string; tone: Tone } {
  const st = lessonStatusLabel(j) ?? jobStatusLabel(j, serverBusy);
  return { text: st.text, tone: st.tone === 'warn' ? 'neutral' : toTone(st.tone) };
}

export function runLine(
  j: JobSummary,
  opts: { liveJobIds: ReadonlySet<string>; serverBusy: boolean | null; fmt?: (iso: string) => string },
): RunLine {
  const model = resolveJobModel(j);
  const interrupted = isInterrupted(j);
  const engine = engineTitle(j.engine);
  const tags: RunTag[] = [
    ...lessonRunTags(j).map((t) => ({ text: t.text, tone: toTone(t.tone) })),
    ...(engine !== null ? [{ text: engine, tone: 'neutral' as Tone }] : []),
    ...analysisRepairTags(j).map((t) => ({ text: t.text, tone: toTone(t.tone) })),
    ...runTags(j).map((t) => ({ text: t.text, tone: toTone(t.tone) })),
  ];
  return {
    jobId: j.jobId,
    when: (opts.fmt ?? compactDateTime)(j.createdAt),
    model: model.name,
    modelHow: model.tag,
    status: runStatus(j, opts.serverBusy),
    live: opts.liveJobIds.has(j.jobId),
    systemFault: j.demoFault !== undefined,
    tags,
    cost: describeJobCost({ totalCostUSD: j.totalCostUSD, reservedUnknownUSD: j.reservedUnknownUSD, interrupted }),
    note: interrupted ? INTERRUPTED_TEXT : null,
  };
}
