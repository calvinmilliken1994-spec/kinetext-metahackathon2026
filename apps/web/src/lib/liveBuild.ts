// The live build view (Stage 9): what the lesson column shows while a lesson job runs, derived only from the job's
// recorded events and served artifacts (docs/specs/STAGE-9-live-build-view.md). The strip names the calls that are open
// right now; each planned part keeps a short work log, one line per event (writing, SAM outlining, checks failed,
// reworking, checks passed), which becomes a one-line trace once the part arrives. Pure: no React, no DOM, no network.
// Times are job-relative milliseconds (0 = the job's first event).

import type { StageEvent } from '../../../../packages/contracts/index.ts';
import { isKitGenComponentId, isPlanComponentId } from '../../../../packages/contracts/kit.ts';
import type { PlanComponentId } from '../../../../packages/contracts/kit.ts';
import type { JobDetail } from '../api.ts';
import { aiText, joinSentences } from './displayText.ts';
import { formatCostUSD } from './jobs.ts';
import { componentLabel } from './lesson.ts';
import { lessonCheckName } from './lessonJob.ts';
import { resolveJobModel } from './models.ts';

interface Ev {
  seq: number; stage: string; status: string; at: string; t: number;
  componentId?: string; target?: string; revision?: number; detail?: string;
  latencyMs?: number; estCostUSD?: number; usage?: { completionTokens?: number };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Wall time (ms since the epoch) of the job's first event, or null when there is none. */
export function jobStartMs(events: readonly StageEvent[]): number | null {
  const times = events.map((e) => Date.parse(e.at)).filter(Number.isFinite);
  return times.length === 0 ? null : Math.min(...times);
}

function timed(events: readonly StageEvent[]): Ev[] {
  const start = jobStartMs(events) ?? 0;
  return (events as unknown as Array<Record<string, unknown>>)
    .filter((e) => typeof e.seq === 'number' && typeof e.stage === 'string' && typeof e.status === 'string')
    .map((e) => ({ ...(e as unknown as Ev), t: Number.isFinite(Date.parse(String(e.at))) ? Date.parse(String(e.at)) - start : 0 }))
    .sort((a, b) => a.seq - b.seq);
}

// ---- small parsers for the worker's event details -------------------------------------------------------------------

/** "11/11 checks passed", "usable; checks 18/18 passed" → counts. */
export function parseCheckCount(detail: string | undefined): { passed: number; total: number } | null {
  const m = /(\d+)\/(\d+) checks passed/.exec(detail ?? '') ?? /checks (\d+)\/(\d+) passed/.exec(detail ?? '');
  return m === null ? null : { passed: Number(m[1]), total: Number(m[2]) };
}

/** "failed checks: LD-04, Q-06" → ids. */
export function parseFailedChecks(detail: string | undefined): string[] {
  const m = /failed checks: (.+)$/.exec(detail ?? '');
  return m === null ? [] : (m[1] as string).split(/[,\s]+/).filter((s) => /^[A-Z]+-\d+$/.test(s));
}

/** "sam-3.1 point segmentation of 5 part(s)" → 5. */
export function parseSegmentAsk(detail: string | undefined): number | null {
  const m = /segmentation of (\d+) part/.exec(detail ?? '');
  return m === null ? null : Number(m[1]);
}

/** "sam-3.1 returned 5 of 5 region(s)" (notes may follow after ';') → SAM's region count. */
export function parseSegmentGot(detail: string | undefined): { got: number; of: number } | null {
  const m = /returned (\d+) of (\d+) region/.exec(detail ?? '');
  return m === null ? null : { got: Number(m[1]), of: Number(m[2]) };
}

/**
 * STAGE-8c Addendum A: Muse's grounding call before SAM, as the worker notes it in the `segment succeeded` detail:
 * "; muse-spark-1.3 located K of N part(s) for SAM" → { located: K, of: N }; "; muse-spark-1.3 grounding failed (CODE);
 * used the generation areas" → 'failed'. Null for older runs, which had no grounding call. Any order of notes.
 */
export function parseGrounding(detail: string | undefined): { located: number; of: number } | 'failed' | null {
  const d = detail ?? '';
  const m = /\blocated (\d+) of (\d+) part\(s\) for SAM\b/.exec(d);
  if (m !== null) return { located: Number(m[1]), of: Number(m[2]) };
  return /\bgrounding failed\b/.test(d) ? 'failed' : null;
}

/** "sam-3.1 sure of 4 of 5 part(s)" → { sure: 4, of: 5 }; null when the run does not record it. */
export function parseSamSure(detail: string | undefined): { sure: number; of: number } | null {
  const m = /\bsure of (\d+) of (\d+) part\(s\)/.exec(detail ?? '');
  return m === null ? null : { sure: Number(m[1]), of: Number(m[2]) };
}

/** A live counter: "12 s", "1 min 23 s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A recorded duration with one decimal: "24.5 s", "0.8 s". */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
}

/** Stagger delay for the i-th item of a list that appears together, capped so a long list never keeps anyone waiting. */
export function stagger(index: number, stepMs: number, capMs = 600): number {
  return Math.min(capMs, Math.max(0, index) * stepMs);
}

// ---- the skeleton preview of a planned part (Stage 9b) ----------------------------------------------------------------

/** The coarse shape a pending frame draws, faintly, so the lesson visibly takes shape before the part arrives. */
export type PreviewKind = 'quiz' | 'sequence' | 'grid' | 'explorer' | 'figure' | 'bins' | 'map' | 'equation' | 'bars' | 'ladder' | 'meter' | 'scene' | 'lines';

export interface PartPreview {
  kind: PreviewKind;
  /** Height of the preview body under the frame head, px. The frame's reserve is FRAME_HEAD_PX + bodyPx. */
  bodyPx: number;
  /** Rows (rungs, table rows, option rows, sliders) and columns (table columns, bins) the skeleton draws. */
  rows: number;
  cols: number;
}

/** The frame head (title, meta line) plus the gap under it, px. */
export const FRAME_HEAD_PX = 64;

/**
 * Per-kind preview shapes. Body heights come from the median rendered height of stored, published parts of each kind
 * at 1920×1080 and 1366×768 (pass 1 under-reserved quiz cards by ~700 px and explorers by ~850 px), minus the head.
 */
const PREVIEW: Readonly<Record<string, PartPreview>> = {
  'quiz-cards-v1': { kind: 'quiz', bodyPx: 1180, rows: 4, cols: 2 },
  'sequence-v1': { kind: 'sequence', bodyPx: 520, rows: 6, cols: 1 },
  'sort-groups-v1': { kind: 'bins', bodyPx: 640, rows: 3, cols: 3 },
  'concept-map-v1': { kind: 'map', bodyPx: 840, rows: 3, cols: 3 },
  'compare-table-v1': { kind: 'grid', bodyPx: 240, rows: 4, cols: 3 },
  'data-table-v1': { kind: 'grid', bodyPx: 480, rows: 7, cols: 4 },
  'formula-explorer-v1': { kind: 'explorer', bodyPx: 1300, rows: 3, cols: 2 },
  'threshold-v1': { kind: 'meter', bodyPx: 420, rows: 2, cols: 1 },
  'log-ladder-v1': { kind: 'ladder', bodyPx: 640, rows: 7, cols: 1 },
  'algorithm-trace-v1': { kind: 'bars', bodyPx: 860, rows: 1, cols: 6 },
  'balance-equation-v1': { kind: 'equation', bodyPx: 740, rows: 2, cols: 4 },
  'label-diagram-v1': { kind: 'figure', bodyPx: 650, rows: 5, cols: 1 },
};
const PREMIUM_PREVIEW: PartPreview = { kind: 'scene', bodyPx: 640, rows: 2, cols: 1 };
const GENERIC_PREVIEW: PartPreview = { kind: 'lines', bodyPx: 416, rows: 4, cols: 1 };

/**
 * The preview of a planned part. A label diagram's label column shows one chip per part SAM was asked to outline once
 * that call has been recorded (the plan names no figure, so the figure itself stays a plain frame).
 */
export function previewOf(componentId: string, build?: PartBuild): PartPreview {
  // A premium activity (a simulation or a timeline) draws a scene with its controls; an unknown id a few lines.
  const base = PREVIEW[componentId] ?? (isPlanComponentId(componentId) && !isKitGenComponentId(componentId) ? PREMIUM_PREVIEW : GENERIC_PREVIEW);
  if (base.kind !== 'figure' || build === undefined) return base;
  const asked = [...build.lines].reverse().find((l) => l.kind === 'outlining' && l.parts !== undefined)?.parts;
  return asked === undefined ? base : { ...base, rows: Math.max(1, Math.min(12, asked)) };
}

/**
 * Height reserved for a planned part's frame before its content arrives: the frame head plus its preview body, so the
 * arrival moves later frames as little as possible. Estimates, not promises.
 */
export function reserveHeight(componentId: string): number {
  return FRAME_HEAD_PX + previewOf(componentId).bodyPx;
}

/**
 * What a label diagram's figure frame says about SAM while the part is still being built (demo pair review #1a): its
 * latest SAM call, open (`working`: the frame shows the working cue) or finished. Null before the first SAM call and for
 * every other kind, so the frame never claims SAM work that has not been recorded. It never draws regions: those exist
 * only once the checked part arrives.
 */
export function figureNote(build: PartBuild | undefined): { actor: 'SAM 3.1'; text: string; working: boolean; muse?: { actor: 'Muse Spark'; text: string } } | null {
  if (build === undefined || build.componentId !== 'label-diagram-v1') return null;
  const sam = [...build.lines].reverse().find((l) => l.kind === 'outlining');
  if (sam === undefined) return null;
  // Addendum A: a grounded call reads "Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s"
  if (sam.muse !== undefined && sam.sam !== undefined) return { actor: 'SAM 3.1', text: sam.sam, working: sam.open, muse: { actor: 'Muse Spark', text: sam.muse } };
  // the log line without its actor ("SAM 3.1 is outlining 5 parts…" → "is outlining 5 parts…")
  const text = sam.text.replace(/^SAM 3\.1\s+/, '');
  return { actor: 'SAM 3.1', text, working: sam.open };
}

/**
 * Which parts have just arrived (Stage 9b follow, demo pair review #10). `known` is what the previous frame held (null
 * before the first frame, which is only a baseline: parts already there are not arrivals). A part that vanishes means
 * the replay started again ("Replay again", Restart), so it counts as arriving again when it comes back.
 */
export function arrivals(known: ReadonlySet<string> | null, arrived: readonly string[]): { known: Set<string>; newly: string[]; restarted: boolean } {
  const now = new Set(arrived);
  if (known === null) return { known: now, newly: [], restarted: false };
  const restarted = [...known].some((id) => !now.has(id));
  return { known: now, newly: arrived.filter((id) => !known.has(id)), restarted };
}

/** How far along a planned part is, for the preview's emphasis (it only changes opacity and the outline tone). */
export type PreviewPhase = 'waiting' | 'writing' | 'outlining' | 'reworking' | 'checked' | 'left-out';

export function previewPhase(build: PartBuild | undefined): PreviewPhase {
  if (build === undefined || build.lines.length === 0) return 'waiting';
  const open = build.lines.find((l) => l.open);
  if (open?.kind === 'queued') return 'waiting';
  if (open?.kind === 'outlining') return 'outlining';
  if (open?.kind === 'writing') return open.revision > 1 ? 'reworking' : 'writing';
  if (build.lines.some((l) => l.kind === 'unusable')) return 'left-out';
  if (build.lines.some((l) => l.kind === 'checks-passed')) return 'checked';
  return 'writing';
}

/**
 * Which part the lesson column should keep in view while a build plays (Stage 9b follow). Only moments worth watching
 * move it: a part that has just arrived, SAM outlining a figure, or a part being reworked after a failed check. Plain
 * writing never pulls the view away from the overview. Several parts at once: the current focus stays while it is
 * still busy, else the first in plan order.
 */
export function followFocus(
  prev: string | null, builds: Readonly<Record<string, PartBuild>>, order: readonly string[], newlyArrived: readonly string[],
): string | null {
  const arrived = order.find((id) => newlyArrived.includes(id)) ?? newlyArrived[0];
  if (arrived !== undefined) return arrived;
  const watchable = (id: string): boolean => {
    const open = builds[id]?.lines.find((l) => l.open);
    return open !== undefined && (open.kind === 'outlining' || (open.kind === 'writing' && open.revision > 1));
  };
  const outlining = order.find((id) => builds[id]?.lines.some((l) => l.open && l.kind === 'outlining') === true);
  if (outlining !== undefined) return outlining;
  if (prev !== null && watchable(prev)) return prev;
  return order.find(watchable) ?? prev;
}

// ---- the strip ----------------------------------------------------------------------------------------------------

export interface LiveOp { key: string; actor: 'muse' | 'sam'; text: string; startMs: number }

export interface StripState {
  /** The calls open right now, analysis first, then parts in plan order. */
  ops: LiveOp[];
  finished: boolean;
  /** Job time of the last event once finished. */
  totalMs: number | null;
  museCalls: number;
  samCalls: number;
  /** The recorded total once finished, else the sum of the costs recorded so far. */
  costUSD: number | null;
  /** The model's display name ("Muse Spark 1.3"). */
  model: string;
  /** Parts in the plan (0 before the analysis lands), parts published so far, parts left out after failing. */
  partsPlanned: number;
  partsPassed: number;
  partsLeftOut: number;
  /** The job ended in failure (not a declined page, which finishes normally with nothing planned). */
  failed: boolean;
}

const MUSE_STAGES = new Set(['analyze', 'component', 'repair']);

function planOrder(detail: JobDetail): PlanComponentId[] {
  const order: PlanComponentId[] = [];
  for (const e of detail.lessonData?.analysis?.componentPlan ?? []) if (!order.includes(e.componentId)) order.push(e.componentId);
  return order;
}

export function liveStrip(detail: JobDetail): StripState {
  const evs = timed(detail.events);
  const running = detail.summary.status === 'running';
  const model = resolveJobModel(detail.summary).name;
  const ops: LiveOp[] = [];
  const analyze = evs.filter((e) => e.stage === 'analyze');
  const aStart = analyze.find((e) => e.status === 'started');
  if (running && aStart !== undefined && !analyze.some((e) => e.status !== 'started')) ops.push({ key: 'analyze', actor: 'muse', text: 'Reading the page and planning the lesson', startMs: aStart.t });
  for (const rev of new Set(evs.filter((e) => e.stage === 'repair' && e.target === 'analysis').map((e) => e.revision))) {
    const own = evs.filter((e) => e.stage === 'repair' && e.target === 'analysis' && e.revision === rev);
    const s = own.find((e) => e.status === 'started');
    if (running && s !== undefined && !own.some((e) => e.status !== 'started')) ops.push({ key: `analysis-repair-${rev}`, actor: 'muse', text: 'Repairing its analysis of the page', startMs: s.t });
  }
  if (running) {
    const builds = partBuilds(detail);
    for (const id of planOrder(detail)) {
      const open = builds[id]?.lines.find((l) => l.open && (l.kind === 'writing' || l.kind === 'outlining'));
      if (open === undefined || open.startMs === null) continue;
      const label = componentLabel(id);
      const text = open.kind === 'outlining'
        ? `Outlining ${open.parts ?? ''} parts of the figure`.replace('  ', ' ')
        : open.revision > 1 ? `Reworking ${label}` : `Writing ${label}`;
      ops.push({ key: `${id}:${open.key}`, actor: open.kind === 'outlining' ? 'sam' : 'muse', text, startMs: open.startMs });
    }
  }
  const museCalls = evs.filter((e) => MUSE_STAGES.has(e.stage) && e.status !== 'started' && num(e.latencyMs) !== null).length;
  const samCalls = evs.filter((e) => e.stage === 'segment' && e.status !== 'started').length;
  const sum = evs.reduce((a, e) => a + (num(e.estCostUSD) ?? 0), 0);
  const recorded = num(detail.summary.totalCostUSD);
  const last = evs[evs.length - 1];
  const components = detail.lessonData?.lesson?.components ?? [];
  return {
    ops, finished: !running, totalMs: running || last === undefined ? null : last.t, museCalls, samCalls,
    costUSD: !running && recorded !== null ? recorded : evs.some((e) => num(e.estCostUSD) !== null) ? sum : null, model,
    partsPlanned: planOrder(detail).length,
    partsPassed: components.filter((c) => c.status === 'passed').length,
    partsLeftOut: components.filter((c) => c.status === 'failed').length,
    failed: detail.summary.status === 'failed',
  };
}

const calls = (n: number, who: string): string => `${n} ${who} ${n === 1 ? 'call' : 'calls'}`;

/**
 * The strip's second line while a build runs: what has finished so far, from the recorded events only.
 * "2 Muse Spark 1.3 calls done · 1 SAM 3.1 call · 1 of 2 parts checked".
 */
export function progressFacts(s: StripState): string[] {
  const out: string[] = [s.museCalls === 0 ? 'No call finished yet' : `${calls(s.museCalls, s.model)} done`];
  if (s.samCalls > 0) out.push(calls(s.samCalls, 'SAM 3.1'));
  if (s.partsPlanned > 0) out.push(`${s.partsPassed} of ${s.partsPlanned} ${s.partsPlanned === 1 ? 'part' : 'parts'} checked`);
  return out;
}

/**
 * The closing beat (Stage 9b): the strip's headline and facts once the job has finished. "Every part checked" is said
 * only when every planned part passed its checks; otherwise how many did and how many were left out.
 */
export function closingBeat(s: StripState): { headline: string; facts: string[]; ready: boolean } {
  const took = formatElapsed(s.totalMs ?? 0);
  const ready = !s.failed && s.partsPlanned > 0 && s.partsPassed > 0;
  const headline = s.failed ? `The run stopped after ${took}` : s.partsPlanned === 0 ? `Finished in ${took}` : ready ? `Lesson ready · built in ${took}` : `Built in ${took}`;
  const facts: string[] = [];
  if (s.museCalls > 0) facts.push(calls(s.museCalls, s.model));
  if (s.samCalls > 0) facts.push(calls(s.samCalls, 'SAM 3.1'));
  if (s.partsPlanned > 0) {
    if (s.partsPassed === s.partsPlanned) facts.push(s.partsPlanned === 1 ? 'the part was checked' : 'every part checked');
    else facts.push(`${s.partsPassed} of ${s.partsPlanned} parts checked`, ...(s.partsLeftOut > 0 ? [`${s.partsLeftOut} left out`] : []));
  }
  if (s.costUSD !== null) facts.push(`${formatCostUSD(s.costUSD)} est.`);
  return { headline, facts, ready };
}

// ---- part work logs -------------------------------------------------------------------------------------------------

export type LogKind = 'queued' | 'writing' | 'outlining' | 'checks-failed' | 'unusable' | 'checks-passed';

export interface LogLine {
  key: string;
  kind: LogKind;
  /** The sentence the frame shows. */
  text: string;
  /** Still under way: the frame adds a live counter from `startMs`. */
  open: boolean;
  startMs: number | null;
  /** Recorded latency of the call (else the gap between its events); null while open. */
  durationMs: number | null;
  /** Tokens the model wrote (completion), when recorded. */
  tokens: number | null;
  revision: number;
  /** SAM: parts asked for. */
  parts?: number;
  /** SAM (Addendum A): what Muse's grounding call located before SAM ("located 5 parts"), when recorded. */
  muse?: string;
  /** SAM (Addendum A): the SAM half of a grounded line ("confirmed 5 of 5 in 1.9 s"). */
  sam?: string;
  checks?: { passed: number; total: number };
}

export interface TraceStep { text: string; tone: 'plain' | 'ok' | 'bad' }

export interface PartBuild {
  componentId: PlanComponentId;
  label: string;
  /** Muse's reason for planning this part, as one sentence ('' when none). */
  reason: string;
  lines: LogLine[];
  /** Latest revision seen. */
  revision: number;
  /** The last check count recorded for this part. */
  checks: { passed: number; total: number } | null;
  /** One short step per finished line, for the part's header once it has arrived. */
  trace: TraceStep[];
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function checkNames(ids: readonly string[]): string {
  const names = ids.map((id) => lessonCheckName(id) ?? 'a page check');
  const first = names.slice(0, 2).map((n) => n.charAt(0).toLowerCase() + n.slice(1));
  return names.length > 2 ? `${first.join('; ')}; and ${names.length - 2} more` : first.join('; ');
}

function tokensText(n: number | null): string {
  return n === null ? '' : ` · ${n.toLocaleString('en-US')} tokens`;
}

function logFor(id: PlanComponentId, evs: readonly Ev[], model: string, running: boolean): LogLine[] {
  const own = evs.filter((e) => e.componentId === id && (e.stage === 'component' || e.stage === 'segment' || (e.stage === 'repair' && e.target === 'component')));
  if (own.length === 0) {
    return running ? [{ key: 'queued', kind: 'queued', text: 'Waiting for its turn: Muse writes two parts at a time.', open: true, startMs: null, durationMs: null, tokens: null, revision: 1 }] : [];
  }
  const lines: LogLine[] = [];
  const revisions = [...new Set(own.map((e) => e.revision ?? 1))].sort((a, b) => a - b);
  for (const rev of revisions) {
    const r = own.filter((e) => (e.revision ?? 1) === rev);
    // The Muse call of this revision: 'component started' (r1) or 'repair started' (r2+); it ends at the first SAM call,
    // else at the revision's first end event. Its recorded latency sits on the event that ended the call.
    const start = r.find((e) => e.status === 'started' && (e.stage === 'component' || e.stage === 'repair'));
    const callEnd = r.find((e) => e.status !== 'started' && num(e.latencyMs) !== null && e.stage !== 'segment');
    const firstAfter = r.find((e) => start !== undefined && e.seq > start.seq && (e.stage === 'segment' || e.status !== 'started'));
    if (start !== undefined) {
      const open = running && firstAfter === undefined;
      const durationMs = open ? null : num(callEnd?.latencyMs) ?? (firstAfter === undefined ? null : firstAfter.t - start.t);
      const tokens = num(callEnd?.usage?.completionTokens);
      const unusable = r.find((e) => e.status === 'failed' && /OUTPUT_(INVALID|TRUNCATED)/.test(e.detail ?? ''));
      lines.push({
        key: `write-r${rev}`, kind: 'writing', open, startMs: start.t, durationMs, tokens, revision: rev,
        text: open
          ? (rev === 1 ? `${model} is writing it` : `${model} is reworking it as revision ${rev}`)
          : `${rev === 1 ? 'Written' : `Revision ${rev} written`} in ${formatSeconds(durationMs ?? 0)}${tokensText(tokens)}`,
      });
      if (unusable !== undefined) lines.push({ key: `unusable-r${rev}`, kind: 'unusable', open: false, startMs: unusable.t, durationMs: null, tokens: null, revision: rev, text: 'The draft could not be read, so this part was left out.' });
    }
    // SAM calls of this revision
    for (const seg of r.filter((e) => e.stage === 'segment' && e.status === 'started')) {
      const end = r.find((e) => e.stage === 'segment' && e.status !== 'started' && e.seq > seg.seq);
      const parts = parseSegmentAsk(seg.detail) ?? undefined;
      const got = parseSegmentGot(end?.detail);
      const grounding = end?.status === 'succeeded' ? parseGrounding(end.detail) : null;
      const open = running && end === undefined;
      const durationMs = end === undefined ? null : num(end.latencyMs) ?? end.t - seg.t;
      // Addendum A: a grounded call names Muse's part first, then what SAM confirmed. A failed grounding call and
      // older runs keep the SAM-only wording.
      const grounded = !open && got !== null && grounding !== null && grounding !== 'failed'
        ? {
          muse: `located ${grounding.located === grounding.of ? plural(grounding.located, 'part', 'parts') : `${grounding.located} of ${plural(grounding.of, 'part', 'parts')}`}`,
          // Runs that record how many regions SAM was sure of (>= 0.5) count those; older grounded runs count returned ones.
          sam: `confirmed ${parseSamSure(end?.detail)?.sure ?? got.got} of ${got.of} in ${formatSeconds(durationMs ?? 0)}`,
        }
        : null;
      lines.push({
        key: `sam-r${rev}-${seg.seq}`, kind: 'outlining', open, startMs: seg.t, durationMs, tokens: null, revision: rev, ...(parts === undefined ? {} : { parts }),
        ...(grounded === null ? {} : grounded),
        text: open
          ? `SAM 3.1 is outlining ${parts === undefined ? 'the' : parts} parts of the figure`
          : end?.status === 'failed' ? 'SAM 3.1 could not outline the parts'
            : grounded !== null ? `Muse Spark ${grounded.muse} · SAM 3.1 ${grounded.sam}`
              : `SAM 3.1 outlined ${got === null ? (parts ?? '') : `${got.got} of ${got.of}`} parts in ${formatSeconds(durationMs ?? 0)}`,
      });
    }
    // checks
    const failed = r.find((e) => e.stage === 'component' && e.status === 'failed' && parseFailedChecks(e.detail).length > 0);
    if (failed !== undefined) {
      const ids = parseFailedChecks(failed.detail);
      lines.push({ key: `fail-r${rev}`, kind: 'checks-failed', open: false, startMs: failed.t, durationMs: null, tokens: null, revision: rev, text: `${plural(ids.length, 'check', 'checks')} failed: ${checkNames(ids)}.` });
    }
    const passed = r.find((e) => e.stage === 'component' && e.status === 'succeeded');
    const counts = parseCheckCount(passed?.detail);
    if (passed !== undefined) {
      lines.push({
        key: `pass-r${rev}`, kind: 'checks-passed', open: false, startMs: passed.t, durationMs: null, tokens: null, revision: rev,
        text: counts === null ? 'Every check passed.' : `${counts.passed} of ${plural(counts.total, 'check', 'checks')} passed.`, ...(counts === null ? {} : { checks: counts }),
      });
    }
  }
  // reorder writing/outlining by time so the log reads in the order things happened
  return lines.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

function traceOf(lines: readonly LogLine[]): TraceStep[] {
  const out: TraceStep[] = [];
  for (const l of lines) {
    if (l.open || l.kind === 'queued') continue;
    if (l.kind === 'writing') out.push({ text: l.revision === 1 ? `Written ${formatSeconds(l.durationMs ?? 0)}` : `Revision ${l.revision} · ${formatSeconds(l.durationMs ?? 0)}`, tone: 'plain' });
    else if (l.kind === 'outlining') out.push({ text: `SAM 3.1 ${formatSeconds(l.durationMs ?? 0)}`, tone: 'plain' });
    else if (l.kind === 'checks-failed') out.push({ text: l.text.split(':')[0] as string, tone: 'bad' });
    else if (l.kind === 'unusable') out.push({ text: 'Draft unreadable', tone: 'bad' });
    else if (l.kind === 'checks-passed') out.push({ text: l.checks === undefined ? 'Checks passed' : `${l.checks.passed}/${l.checks.total} checks`, tone: 'ok' });
  }
  return out;
}

/** One work log per planned part (by component id). Empty until the plan is known: no frame is promised before it. */
export function partBuilds(detail: JobDetail): Record<string, PartBuild> {
  const plan = detail.lessonData?.analysis?.componentPlan ?? [];
  if (plan.length === 0 || detail.lessonData?.analysis?.usable === false) return {};
  const evs = timed(detail.events);
  const running = detail.summary.status === 'running';
  const model = resolveJobModel(detail.summary).name;
  const out: Record<string, PartBuild> = {};
  for (const entry of plan) {
    const id = entry.componentId;
    if (!isPlanComponentId(id) || out[id] !== undefined) continue;
    const lines = logFor(id, evs, model, running);
    const last = [...lines].reverse().find((l) => l.checks !== undefined);
    out[id] = {
      componentId: id, label: componentLabel(id), reason: entry.pedagogicalReason.trim() === '' ? '' : joinSentences(aiText(entry.pedagogicalReason)),
      lines, revision: Math.max(1, ...lines.map((l) => l.revision)), checks: last?.checks ?? null, trace: traceOf(lines),
    };
  }
  return out;
}
