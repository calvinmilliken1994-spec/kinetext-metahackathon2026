// Repair timeline derivation (pure): revision 1 → 2 → 3 with targeted / fixed / remaining checks, the Muse
// model and cost of each repair, and honest badges. A fault the SYSTEM injected into revision 1 is always
// labelled as such — it is never presented as a model error, and the repair is never just "repaired".

import type { FaultRecord, RepairRecord, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import { stageCostLabel } from './cost.ts';
import { previewQuote } from './evidence.ts';
import { trimmed } from './format.ts';
import { describeAnswerSwap } from './timeline.ts';

export const BADGE_REPAIRED = 'Repaired by Muse';
export const BADGE_REPAIRED_AFTER_FAULT = 'System-made fault, repaired by Muse';
export const FAULT_BADGE = 'Demo fault injected by the system';
export const FAULT_NOT_MODEL_ERROR = 'not a model error';
export const METRICS_NOTE = 'Runs with an injected demo fault are excluded from quality metrics and recorded fixtures.';

export type BadgeTone = 'ok' | 'fault' | 'warn';
export interface Badge { text: string; tone: BadgeTone }

export interface RevisionInput { revision: number; report?: ValidationReport | undefined }

export interface RepairSummaryInput {
  publishedRevision?: number | undefined;
  bestRevision?: number | undefined;
  repairs?: readonly RepairRecord[] | undefined;
  demoFault?: FaultRecord | undefined;
}

/** 'Demo fault injected by the system (not a model error): wrong-answer at behavioralTests[0].expectedLiftN' */
export function demoFaultNotice(f: Pick<FaultRecord, 'kind' | 'path' | 'effective'>): string {
  const base = `${FAULT_BADGE} (${FAULT_NOT_MODEL_ERROR}): ${f.kind} at ${f.path}`;
  // S5-04: an injected fault that no check caught demonstrates nothing; say so plainly.
  return f.effective === false ? `${base} — not caught by the checks, so this run does not demonstrate a catch` : base;
}

/**
 * What the system changed, e.g. 'value 20.408 → 31.612', a shortened quote swap, or (timeline) a swapped ordering
 * answer described with the event labels.
 */
export function faultChangeText(f: Pick<FaultRecord, 'original' | 'injected'>, eventLabels: Readonly<Record<string, string>> = {}): string {
  if (typeof f.original === 'number' && typeof f.injected === 'number') {
    return `value ${trimmed(f.original, 6)} → ${trimmed(f.injected, 6)}`;
  }
  const swap = describeAnswerSwap(f.original, f.injected, eventLabels);
  if (swap !== null) return swap;
  return `quote “${previewQuote(String(f.original), 70)}” → “${previewQuote(String(f.injected), 70)}”`;
}

/** The sentence shown under a fault notice: complete sentences stand alone, short changes get the usual lead-in. */
export function faultChangeLine(change: string): string {
  return change.startsWith('System ') ? `${change}.` : `Changed by the system: ${change}.`;
}

/** Overall badge for a job: only when a revision after the first was published. Fault runs never say just 'repaired'. */
export function overallRepairBadge(s: RepairSummaryInput): Badge | null {
  if (typeof s.publishedRevision !== 'number' || s.publishedRevision <= 1) return null;
  const afterFault = s.demoFault !== undefined || (s.repairs ?? []).some((r) => r.afterInjectedFault);
  return afterFault ? { text: BADGE_REPAIRED_AFTER_FAULT, tone: 'fault' } : { text: BADGE_REPAIRED, tone: 'ok' };
}

/** Short run-list tags for a job summary: demo-fault marker and repair badge, only when they apply. */
export function runTags(s: RepairSummaryInput): Badge[] {
  const tags: Badge[] = [];
  if (s.demoFault !== undefined) tags.push({ text: 'Demo fault (system-made)', tone: 'fault' });
  const overall = overallRepairBadge(s);
  if (overall !== null) tags.push(overall);
  return tags;
}

export interface RepairActor {
  model: string | null;
  responseId: string | null;
  /** Cost tag text with the usual honesty rules ('$0.0123 est.', 'cost unknown', reservation wording); null if no event data. */
  cost: string | null;
  failed: boolean;
  /** The recorded event detail, e.g. 'repaired revision 1' or 'OUTPUT_INVALID'. */
  detail: string | null;
}

export interface RepairStep {
  revision: number;
  role: 'initial' | 'repair';
  /** The revision this one repaired (null for revision 1). */
  repairOf: number | null;
  /** True when Muse's repair call completed but produced no usable revision (e.g. OUTPUT_INVALID). */
  failedAttempt: boolean;
  /** Validation outcome; null when no report exists for this revision. */
  hasReport: boolean;
  passed: number | null;
  total: number | null;
  publishable: boolean | null;
  /** Check ids failing on THIS revision (repair: the 'remaining' ones). */
  failedIds: string[];
  /** Repair steps only: failing on the previous revision, of those now passing, and still failing here. */
  targeted: string[];
  fixed: string[];
  remaining: string[];
  /** New failures introduced by the repair (failing here, not targeted). */
  introduced: string[];
  fault: FaultRecord | null;
  faultNotice: string | null;
  faultChange: string | null;
  badge: Badge | null;
  actor: RepairActor | null;
  /** The revision the job published (shown on the card), or its best (fewest failures) when none passed. */
  isPublished: boolean;
  isBest: boolean;
  outcome: string;
}

function failedIdsOf(report: ValidationReport | undefined): string[] {
  return (report?.checks ?? []).filter((c) => !c.passed).map((c) => c.id);
}

/** True for a repair event of the ANALYSIS loop (TASK-024b); absent target = the spec repair loop. */
export function isAnalysisRepairEvent(e: Pick<StageEvent, 'stage' | 'target'>): boolean {
  return e.stage === 'repair' && e.target === 'analysis';
}

/** Model, response id and cost of the repair call that produced `revision` (analysis and spec revisions are numbered separately). */
export function repairActor(events: readonly StageEvent[], revision: number, target: 'spec' | 'analysis' = 'spec'): RepairActor | null {
  const done = events
    .filter((e) => e.stage === 'repair' && e.revision === revision && e.status !== 'started' && isAnalysisRepairEvent(e) === (target === 'analysis'))
    .sort((a, b) => a.seq - b.seq);
  const ev = done[done.length - 1];
  if (ev === undefined) return null;
  return {
    model: ev.model ?? null,
    responseId: ev.responseId ?? null,
    cost: stageCostLabel({ stage: 'repair', status: ev.status === 'failed' ? 'failed' : 'succeeded', estCostUSD: ev.estCostUSD, detail: ev.detail }),
    failed: ev.status === 'failed',
    detail: ev.detail ?? null,
  };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Steps in revision order. A repair attempt Muse made but that produced no revision (a failed repair event)
 * appears as a step with failedAttempt = true so a failed repair is never silently dropped.
 */
export function buildRepairSteps(input: {
  revisions: readonly RevisionInput[];
  repairs?: readonly RepairRecord[] | undefined;
  demoFault?: FaultRecord | undefined;
  events?: readonly StageEvent[] | undefined;
  publishedRevision?: number | undefined;
  bestRevision?: number | undefined;
  /** Timeline jobs: event id -> label, so a swapped-answer fault is described in words. */
  eventLabels?: Readonly<Record<string, string>> | undefined;
}): RepairStep[] {
  const events = input.events ?? [];
  const repairs = input.repairs ?? [];
  const sorted = [...input.revisions].sort((a, b) => a.revision - b.revision);
  const byRevision = new Map(sorted.map((r) => [r.revision, r] as const));
  const steps: RepairStep[] = [];

  for (const rev of sorted) {
    const n = rev.revision;
    const record = repairs.find((r) => r.revision === n);
    const prev = byRevision.get(record?.repairOf ?? n - 1);
    const failedIds = rev.report !== undefined ? failedIdsOf(rev.report) : (record?.remaining ?? []);
    const role: RepairStep['role'] = n === 1 ? 'initial' : 'repair';
    const fault = n === 1 && input.demoFault !== undefined && input.demoFault.revision === 1 ? input.demoFault : null;
    const targeted = role === 'repair' ? (record?.targeted ?? failedIdsOf(prev?.report)) : [];
    const remaining = role === 'repair' ? (record?.remaining ?? failedIds) : [];
    const fixed = role === 'repair' ? (record?.fixed ?? targeted.filter((id) => !remaining.includes(id))) : [];
    const introduced = role === 'repair' ? remaining.filter((id) => !targeted.includes(id)) : [];
    const publishable = rev.report?.publishable ?? record?.publishable ?? null;
    const afterFault = input.demoFault !== undefined || record?.afterInjectedFault === true;

    let badge: Badge | null = null;
    if (role === 'initial' && fault !== null) badge = { text: FAULT_BADGE, tone: 'fault' };
    else if (role === 'repair' && publishable === true) {
      badge = afterFault ? { text: BADGE_REPAIRED_AFTER_FAULT, tone: 'fault' } : { text: BADGE_REPAIRED, tone: 'ok' };
    }

    const total = rev.report?.checks.length ?? null;
    const passed = rev.report !== undefined ? rev.report.checks.filter((c) => c.passed).length : null;
    let outcome: string;
    if (role === 'initial') {
      outcome = publishable === true
        ? 'All machine checks passed on the first try.'
        : publishable === false
          ? `${plural(failedIds.length, 'check', 'checks')} failed on the first try.`
          : 'No validation report was recorded for this revision.';
    } else if (publishable === true) {
      outcome = `Fixed ${fixed.length} of ${plural(targeted.length, 'targeted check', 'targeted checks')}; all machine checks now pass.`;
    } else {
      outcome = `Fixed ${fixed.length} of ${plural(targeted.length, 'targeted check', 'targeted checks')}; ${remaining.length} still failing${introduced.length > 0 ? ` (${introduced.length} new)` : ''}.`;
    }

    steps.push({
      revision: n, role, repairOf: role === 'repair' ? (record?.repairOf ?? n - 1) : null, failedAttempt: false,
      hasReport: rev.report !== undefined, passed, total, publishable, failedIds,
      targeted, fixed, remaining, introduced,
      fault, faultNotice: fault !== null ? demoFaultNotice(fault) : null, faultChange: fault !== null ? faultChangeText(fault, input.eventLabels) : null,
      badge, actor: role === 'repair' ? repairActor(events, n) : null,
      isPublished: input.publishedRevision === n, isBest: input.publishedRevision === undefined && input.bestRevision === n,
      outcome,
    });
  }

  // Repair attempts that never produced a revision (failed repair event, no spec.r<n>.json).
  const failedRevisions = new Set(
    events.filter((e) => e.stage === 'repair' && !isAnalysisRepairEvent(e) && e.status === 'failed' && typeof e.revision === 'number' && !byRevision.has(e.revision)).map((e) => e.revision as number),
  );
  for (const n of failedRevisions) {
    const prev = byRevision.get(n - 1);
    steps.push({
      revision: n, role: 'repair', repairOf: n - 1, failedAttempt: true, hasReport: false, passed: null, total: null, publishable: false,
      failedIds: [], targeted: failedIdsOf(prev?.report), fixed: [], remaining: failedIdsOf(prev?.report), introduced: [],
      fault: null, faultNotice: null, faultChange: null, badge: null, actor: repairActor(events, n),
      isPublished: false, isBest: false,
      outcome: 'Muse’s repair call returned no usable revision; the earlier revision stays as it was.',
    });
  }
  return steps.sort((a, b) => a.revision - b.revision);
}

/** The revision whose checks the validation panel shows by default: published, else best, else the latest. */
export function defaultRevision(revisions: readonly RevisionInput[], s: { publishedRevision?: number | undefined; bestRevision?: number | undefined }): number | null {
  const have = new Set(revisions.map((r) => r.revision));
  if (typeof s.publishedRevision === 'number' && have.has(s.publishedRevision)) return s.publishedRevision;
  if (typeof s.bestRevision === 'number' && have.has(s.bestRevision)) return s.bestRevision;
  const nums = [...have].sort((a, b) => a - b);
  return nums[nums.length - 1] ?? null;
}

/** Heading for the validation panel when viewing a given revision. */
export function validationHeading(revision: number | null, totalRevisions: number, publishedRevision: number | undefined): string {
  if (revision === null || totalRevisions <= 1) return 'Validation';
  const tag = revision === publishedRevision ? ' (published)' : publishedRevision === undefined ? '' : ' (not published)';
  return `Validation · revision ${revision}${tag}`;
}

/** Number of repair calls Muse made: recorded repairs plus repair attempts whose call failed (no revision produced). */
export function repairAttemptCount(repairs: readonly RepairRecord[] | undefined, events: readonly StageEvent[] | undefined): number {
  const revisions = new Set((repairs ?? []).map((r) => r.revision));
  for (const e of events ?? []) {
    if (e.stage === 'repair' && !isAnalysisRepairEvent(e) && e.status === 'failed' && typeof e.revision === 'number') revisions.add(e.revision);
  }
  return revisions.size;
}

/** Revisions for the timeline: the server's list, else (older server) the single spec/report it returned. */
export function revisionInputs(d: {
  revisions?: readonly RevisionInput[] | undefined;
  report?: ValidationReport | undefined;
  summary: { publishedRevision?: number | undefined; bestRevision?: number | undefined };
}): RevisionInput[] {
  if (d.revisions !== undefined && d.revisions.length > 0) return d.revisions.map((r) => ({ revision: r.revision, report: r.report }));
  if (d.report !== undefined) return [{ revision: d.summary.publishedRevision ?? d.summary.bestRevision ?? 1, report: d.report }];
  return [];
}
