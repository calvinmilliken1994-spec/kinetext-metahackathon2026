// Analysis repairs (TASK-024b/c), pure. When Muse's FIRST source analysis genuinely fails a deterministic check, the
// worker asks Muse to repair it. That is a NATURAL repair (found in Muse's draft by a check) and must never be confused with a
// system-made demo fault. This module turns the stored revisions, records and events into plain-language steps:
// what failed, what exactly changed (a short before/after diff), which checks pass now, and what the repair cost.

import type { FaultRecord, RepairRecord, StageEvent, ValidationReport } from '../../../../packages/contracts/index.ts';
import { engineTitle } from './engines.ts';
import { previewQuote } from './evidence.ts';
import { stageCostLabel } from './cost.ts';
import { isAnalysisRepairEvent, repairActor } from './repairs.ts';
import type { RepairActor } from './repairs.ts';

/** Summary of one analysis repair attempt, as the API returns it in `summary.analysisRepairs`. */
export interface AnalysisRepairRecord {
  attempt: number;
  /** The analysis revision the attempt produced (revision 1 is Muse's first analysis). */
  revision: number;
  targeted: string[];
  fixed: string[];
  remaining: string[];
  passed: boolean;
}

export interface AnalysisRevisionInput {
  revision: number;
  analysis?: unknown;
  report?: ValidationReport | undefined;
}

export const ANALYSIS_REPAIR_LABEL = 'Revised by Muse after a failed check';
export const ANALYSIS_REPAIR_FAILED_LABEL = 'Analysis repair failed';
const NOT_A_DEMO_FAULT = 'Nothing was injected here, and this is different from a system-made demo fault, which the system plants on purpose and labels.';

/** The bold lead and the explanation under the section heading; never claims a repair that did not happen. */
export function naturalRepairNoteParts(state: 'passed' | 'failed' | 'running' | 'none'): { lead: string; body: string } {
  switch (state) {
    case 'passed': return { lead: ANALYSIS_REPAIR_LABEL, body: `Muse’s first analysis failed a deterministic check, and Muse repaired it. ${NOT_A_DEMO_FAULT}` };
    case 'failed': return { lead: 'Muse’s revision did not pass', body: `Muse’s analysis failed a deterministic check and Muse’s repair did not fix it. ${NOT_A_DEMO_FAULT}` };
    case 'running': return { lead: ANALYSIS_REPAIR_LABEL, body: `Muse’s first analysis failed a deterministic check and Muse is repairing it. ${NOT_A_DEMO_FAULT}` };
    case 'none': return { lead: '', body: '' };
  }
}

export function naturalRepairNote(state: 'passed' | 'failed' | 'running' | 'none'): string {
  const { lead, body } = naturalRepairNoteParts(state);
  return lead === '' ? '' : `${lead}. ${body}`;
}

// ---- readable check names -------------------------------------------------------------------------------------

/** Readable name of the guard that proves a repair changed only what was named. */
export const ANALYSIS_UNCHANGED_NAME = 'The repair changed only what the check named';

/** Plain-language names of the checks that run on a source analysis (the raw id stays visible next to them). */
export const ANALYSIS_CHECK_NAMES: Readonly<Record<string, string>> = {
  'schema.analysis': 'The analysis follows the required structure',
  'analysis.invariants': 'The decision and its reasons are consistent',
  'analysis.concept-ids': 'Concept ids are short and well-formed',
  'refs.sources': 'Every cited source exists',
  'grounding.quotes': 'Every quote appears in the source text',
  'policy.no-publisher-attribution': 'No publisher attribution or endorsement wording',
  'repair.analysis-unchanged': ANALYSIS_UNCHANGED_NAME,
};

/** What each analysis check demands, in words a teacher can follow. */
export const ANALYSIS_CHECK_PLAIN: Readonly<Record<string, string>> = {
  'schema.analysis': 'The analysis must have exactly the fields and types the pipeline expects.',
  'analysis.invariants': 'A supported analysis must name an activity and give no decline reason; a declined one must give a reason and no activity.',
  'analysis.concept-ids': 'Each concept id must be unique and use only lowercase letters, digits and hyphens, at most 40 characters.',
  'refs.sources': 'Every quote must cite a source that was actually supplied.',
  'grounding.quotes': 'Every concept needs a quote that really appears in the source text, word for word.',
  'policy.no-publisher-attribution': 'Concept names and objectives must not credit or endorse the publisher.',
  'repair.analysis-unchanged': 'A repair may only change the parts a failed check names; anything else must stay as it was.',
};

export function analysisCheckName(id: string): string | null {
  return Object.hasOwn(ANALYSIS_CHECK_NAMES, id) ? (ANALYSIS_CHECK_NAMES[id] ?? null) : null;
}

export function analysisCheckPlain(id: string): string | null {
  return Object.hasOwn(ANALYSIS_CHECK_PLAIN, id) ? (ANALYSIS_CHECK_PLAIN[id] ?? null) : null;
}

// ---- diffing two analyses --------------------------------------------------------------------------------------

export type AnalysisChangeKind =
  | 'decision' | 'reason' | 'objective'
  | 'concept-id' | 'concept-name' | 'concept-added' | 'concept-removed' | 'quote-added' | 'quote-removed'
  /** Stage 6 (analysis v2) kinds, produced by diffAnalysisV2 in lessonJob.ts. */
  | 'usable' | 'coverage' | 'headline' | 'point-text' | 'point-quote' | 'point-added' | 'point-removed'
  | 'term-text' | 'term-quote' | 'term-added' | 'term-removed' | 'plan' | 'plan-quote';

export interface AnalysisChange {
  kind: AnalysisChangeKind;
  /** What changed, in words ('Concept id (concept “Velocity …”)'). */
  label: string;
  /** null = did not exist before (added). */
  before: string | null;
  /** null = no longer exists (removed). */
  after: string | null;
  /** e.g. '53 characters', shown next to a changed id. */
  beforeNote?: string;
  afterNote?: string;
}

interface ConceptView { id: string; name: string; quotes: string[] }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function conceptsOf(a: Record<string, unknown>): ConceptView[] {
  if (!Array.isArray(a.concepts)) return [];
  const out: ConceptView[] = [];
  for (const c of a.concepts as unknown[]) {
    if (!isRecord(c) || typeof c.id !== 'string') continue;
    const quotes = Array.isArray(c.evidence)
      ? (c.evidence as unknown[]).flatMap((e) => (isRecord(e) && typeof e.quote === 'string' ? [e.quote] : []))
      : [];
    out.push({ id: c.id, name: typeof c.name === 'string' ? c.name : '', quotes });
  }
  return out;
}

function objectivesOf(a: Record<string, unknown>): string[] {
  return Array.isArray(a.objectives) ? (a.objectives as unknown[]).filter((o): o is string => typeof o === 'string') : [];
}

function decisionText(a: Record<string, unknown>): string {
  if (a.supported !== true) return 'Declined';
  const activity = typeof a.activity === 'string' ? a.activity : '';
  return `Supported: ${engineTitle(activity) ?? 'activity not named'}`;
}

function conceptLabel(c: ConceptView): string {
  return c.name === '' ? 'a concept' : `concept “${c.name}”`;
}

const SHORT = 90;
const characters = (s: string): string => `${s.length} character${s.length === 1 ? '' : 's'}`;

/**
 * The short list of what a repair changed. Concepts are matched by id; an unmatched pair is treated as the same
 * concept under a new id when its name or quotes are unchanged, otherwise as one removed and one added concept.
 * Malformed or missing input gives no changes — the diff is a display aid and must never throw.
 */
export function diffAnalyses(before: unknown, after: unknown): AnalysisChange[] {
  if (!isRecord(before) || !isRecord(after)) return [];
  const changes: AnalysisChange[] = [];

  if (before.supported !== after.supported || before.activity !== after.activity) {
    changes.push({ kind: 'decision', label: 'Decision', before: decisionText(before), after: decisionText(after) });
  }
  const reasonBefore = typeof before.unsupportedReason === 'string' ? before.unsupportedReason : '';
  const reasonAfter = typeof after.unsupportedReason === 'string' ? after.unsupportedReason : '';
  if (reasonBefore !== reasonAfter) {
    changes.push({
      kind: 'reason', label: 'Reason for declining',
      before: reasonBefore === '' ? null : previewQuote(reasonBefore, 160), after: reasonAfter === '' ? null : previewQuote(reasonAfter, 160),
    });
  }

  const cb = conceptsOf(before);
  const ca = conceptsOf(after);
  const afterIds = new Set(ca.map((c) => c.id));
  const beforeIds = new Set(cb.map((c) => c.id));
  const pairs: Array<{ b: ConceptView; a: ConceptView }> = [];
  for (const b of cb) {
    const a = ca.find((c) => c.id === b.id);
    if (a !== undefined) pairs.push({ b, a });
  }
  const lostB = cb.filter((c) => !afterIds.has(c.id));
  const newA = ca.filter((c) => !beforeIds.has(c.id));
  const removed: ConceptView[] = [];
  const renamed: Array<{ b: ConceptView; a: ConceptView }> = [];
  const taken = new Set<ConceptView>();
  lostB.forEach((b, i) => {
    const a = newA[i];
    if (a !== undefined && (a.name === b.name || JSON.stringify(a.quotes) === JSON.stringify(b.quotes))) {
      renamed.push({ b, a });
      taken.add(a);
    } else removed.push(b);
  });
  const added = newA.filter((c) => !taken.has(c));

  for (const { b, a } of [...pairs, ...renamed]) {
    if (b.id !== a.id) {
      changes.push({
        kind: 'concept-id', label: `Concept id (${conceptLabel(b)})`, before: b.id, after: a.id,
        beforeNote: characters(b.id), afterNote: characters(a.id),
      });
    }
    if (b.name !== a.name) changes.push({ kind: 'concept-name', label: 'Concept name', before: b.name, after: a.name });
    const quoteLabel = `Quote for ${conceptLabel(a)}`;
    for (const q of b.quotes) if (!a.quotes.includes(q)) changes.push({ kind: 'quote-removed', label: quoteLabel, before: previewQuote(q, SHORT), after: null });
    for (const q of a.quotes) if (!b.quotes.includes(q)) changes.push({ kind: 'quote-added', label: quoteLabel, before: null, after: previewQuote(q, SHORT) });
  }
  for (const c of removed) changes.push({ kind: 'concept-removed', label: 'Removed concept', before: c.name === '' ? c.id : c.name, after: null });
  for (const c of added) changes.push({ kind: 'concept-added', label: 'New concept', before: null, after: c.name === '' ? c.id : c.name });

  const ob = objectivesOf(before);
  const oa = objectivesOf(after);
  for (let i = 0; i < Math.max(ob.length, oa.length); i += 1) {
    const b = ob[i] ?? null;
    const a = oa[i] ?? null;
    if (b !== a) changes.push({ kind: 'objective', label: `Objective ${i + 1}`, before: b === null ? null : previewQuote(b, 160), after: a === null ? null : previewQuote(a, 160) });
  }
  return changes;
}

/** One line: 'Concept id (concept “X”): “old” (53 characters) → “new” (32 characters)'. */
export function describeChange(c: Pick<AnalysisChange, 'kind' | 'label' | 'before' | 'after'> & { beforeNote?: string | undefined; afterNote?: string | undefined }): string {
  const q = (v: string): string => (c.kind === 'decision' ? v : `“${v}”`);
  if (c.before === null && c.after !== null) return `${c.label}: added ${q(c.after)}`;
  if (c.after === null && c.before !== null) return `${c.label}: removed ${q(c.before)}`;
  if (c.before === null || c.after === null) return c.label;
  const note = (n: string | undefined): string => (n === undefined ? '' : ` (${n})`);
  return `${c.label}: ${q(c.before)}${note(c.beforeNote)} → ${q(c.after)}${note(c.afterNote)}`;
}

// ---- counts, tags and summary text -----------------------------------------------------------------------------

/** '1 analysis issue', '2 spec issues'. */
const issues = (n: number, kind: 'analysis' | 'spec'): string => `${n} ${kind} ${n === 1 ? 'issue' : 'issues'}`;

/** Distinct checks fixed by analysis repairs — only when the final repaired analysis passed (else 0). */
export function analysisIssuesRepaired(records: readonly AnalysisRepairRecord[] | undefined): number {
  const last = records?.[records.length - 1];
  if (records === undefined || last === undefined || !last.passed) return 0;
  return new Set(records.flatMap((r) => r.fixed)).size;
}

export type AnalysisRepairState = 'none' | 'running' | 'passed' | 'failed';

export interface AnalysisRepairOverall { state: AnalysisRepairState; attempts: number }

/** Did the analysis repair loop end well? Records win; without them, a failed or unfinished repair event decides. */
export function analysisRepairOverall(input: { analysisRepairs?: readonly AnalysisRepairRecord[] | undefined; events?: readonly StageEvent[] | undefined }): AnalysisRepairOverall {
  const records = input.analysisRepairs ?? [];
  const last = records[records.length - 1];
  if (last !== undefined) return { state: last.passed ? 'passed' : 'failed', attempts: records.length };
  const evs = (input.events ?? []).filter(isAnalysisRepairEvent);
  if (evs.length === 0) return { state: 'none', attempts: 0 };
  const attempts = new Set(evs.map((e) => e.revision)).size;
  if (evs.some((e) => e.status === 'failed')) return { state: 'failed', attempts };
  return { state: 'running', attempts };
}

export type NaturalTone = 'natural' | 'bad';
export interface NaturalBadge { text: string; tone: NaturalTone }

/** Run-list tags: 'Repaired 1 analysis issue' (natural) or 'Analysis repair failed'. Nothing without analysis repairs. */
export function analysisRepairTags(s: { analysisRepairs?: readonly AnalysisRepairRecord[] | undefined }): NaturalBadge[] {
  const o = analysisRepairOverall({ analysisRepairs: s.analysisRepairs });
  if (o.state === 'passed') return [{ text: `Repaired ${issues(analysisIssuesRepaired(s.analysisRepairs), 'analysis')}`, tone: 'natural' }];
  if (o.state === 'failed') return [{ text: ANALYSIS_REPAIR_FAILED_LABEL, tone: 'bad' }];
  return [];
}

/** Badge for the analysis repair section heading. */
export function analysisRepairBadge(o: AnalysisRepairOverall): NaturalBadge | null {
  switch (o.state) {
    case 'passed': return { text: ANALYSIS_REPAIR_LABEL, tone: 'natural' };
    case 'running': return { text: 'Analysis repair in progress', tone: 'natural' };
    case 'failed': return { text: ANALYSIS_REPAIR_FAILED_LABEL, tone: 'bad' };
    case 'none': return null;
  }
}

/**
 * 'Repaired 1 analysis issue', 'Repaired 1 analysis issue and 2 spec issues (the spec fault was system-made)',
 * 'Analysis repair failed (1 attempt)', or null when nothing was repaired.
 */
export function repairSummaryText(s: {
  analysisRepairs?: readonly AnalysisRepairRecord[] | undefined;
  repairs?: readonly RepairRecord[] | undefined;
  publishedRevision?: number | undefined;
  demoFault?: FaultRecord | undefined;
}): string | null {
  const o = analysisRepairOverall({ analysisRepairs: s.analysisRepairs });
  if (o.state === 'failed') return `${ANALYSIS_REPAIR_FAILED_LABEL} (${o.attempts} ${o.attempts === 1 ? 'attempt' : 'attempts'})`;
  const analysisCount = o.state === 'passed' ? analysisIssuesRepaired(s.analysisRepairs) : 0;
  const specCount = typeof s.publishedRevision === 'number' && s.publishedRevision > 1 ? new Set((s.repairs ?? []).flatMap((r) => r.fixed)).size : 0;
  const parts: string[] = [];
  if (analysisCount > 0) parts.push(issues(analysisCount, 'analysis'));
  if (specCount > 0) parts.push(issues(specCount, 'spec'));
  if (parts.length === 0) return null;
  const systemMade = specCount > 0 && (s.demoFault !== undefined || (s.repairs ?? []).some((r) => r.afterInjectedFault));
  return `Repaired ${parts.join(' and ')}${systemMade ? ' (the spec fault was system-made)' : ''}`;
}

/** One honest sentence for an outcome page: what failed in Muse's first analysis and whether the repair worked. */
export function analysisRepairNote(records: readonly AnalysisRepairRecord[] | undefined): string | null {
  const first = records?.[0];
  const last = records?.[records.length - 1];
  if (records === undefined || first === undefined || last === undefined) return null;
  const names = (ids: readonly string[]): string => ids.map((id) => analysisCheckName(id) ?? id).join('; ');
  if (last.passed) {
    const n = first.targeted.length;
    return `Muse’s first analysis failed ${n} ${n === 1 ? 'check' : 'checks'} (${names(first.targeted)}). Muse repaired it, and every check then passed.`;
  }
  return `Muse made ${records.length} analysis repair ${records.length === 1 ? 'attempt' : 'attempts'}, but the analysis still failed: ${names(last.remaining)}.`;
}

// ---- steps for the timeline ------------------------------------------------------------------------------------

export interface CheckRef { id: string; /** Readable name, or the id itself when the check has none. */ name: string }
export interface FailedCheck extends CheckRef {
  /** What the check demands, in plain words (null for an unknown check). */
  plain: string | null;
  /** The validator's own message for this failure (it may quote the offending value). */
  message: string | null;
}
export interface AfterCheck extends CheckRef { passed: boolean }

export type AnalysisStepState = 'passed' | 'still-failing' | 'call-failed' | 'running';

export interface AnalysisRepairStep {
  attempt: number;
  /** The analysis revision this attempt produced (or tried to). */
  revision: number;
  repairOf: number;
  state: AnalysisStepState;
  label: string;
  /** Checks that failed on the analysis Muse was asked to repair. */
  failedBefore: FailedCheck[];
  targeted: CheckRef[];
  fixed: CheckRef[];
  remaining: CheckRef[];
  /** Failures the repair introduced (failing now, not targeted). */
  introduced: CheckRef[];
  changes: AnalysisChange[];
  /** True when both analyses were available to compare (an empty `changes` then really means nothing changed). */
  hasDiff: boolean;
  /** The checks run on the repaired analysis; null when no repaired analysis exists. */
  after: { passed: number; total: number; checks: AfterCheck[] } | null;
  actor: RepairActor | null;
  /** Cost of the repair call (null = unknown; never zero by assumption). */
  costUSD: number | null;
  outcome: string;
}

const failedIdsOf = (r: ValidationReport | undefined): string[] => (r?.checks ?? []).filter((c) => !c.passed).map((c) => c.id);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * One step per analysis repair attempt, in order. Built from the job's records, stored analysis revisions and
 * repair events (target 'analysis'); a repair call that produced no analysis still appears, as 'call-failed'.
 */
export function buildAnalysisRepairSteps(input: {
  revisions: readonly AnalysisRevisionInput[];
  analysisRepairs?: readonly AnalysisRepairRecord[] | undefined;
  events?: readonly StageEvent[] | undefined;
  /** Readable check names (default: the v1 analysis names). The lesson flow passes the Stage 6 names. */
  nameOf?: ((id: string) => string | null) | undefined;
  /** What changed between two analyses (default: the v1 diff). The lesson flow passes the v2 diff. */
  diff?: ((before: unknown, after: unknown) => AnalysisChange[]) | undefined;
}): AnalysisRepairStep[] {
  const nameOf = input.nameOf ?? analysisCheckName;
  const diff = input.diff ?? diffAnalyses;
  const ref = (id: string): CheckRef => ({ id, name: nameOf(id) ?? id });
  const records = input.analysisRepairs ?? [];
  const events = (input.events ?? []).filter(isAnalysisRepairEvent);
  const byRev = new Map(input.revisions.map((r) => [r.revision, r] as const));
  const numbers = new Set<number>(records.map((r) => r.revision));
  for (const e of events) if (typeof e.revision === 'number' && e.revision >= 2) numbers.add(e.revision);

  const steps: AnalysisRepairStep[] = [];
  for (const n of [...numbers].sort((a, b) => a - b)) {
    const rec = records.find((r) => r.revision === n);
    const evs = events.filter((e) => e.revision === n);
    const cur = byRev.get(n);
    const prev = byRev.get(n - 1);
    const finished = evs.filter((e) => e.status !== 'started');
    const callFailed = rec === undefined && finished.some((e) => e.status === 'failed');

    const prevFailedIds = failedIdsOf(prev?.report);
    const targetedIds = rec?.targeted ?? prevFailedIds;
    const failedBefore: FailedCheck[] = (prev?.report !== undefined ? prevFailedIds : targetedIds).map((id) => ({
      ...ref(id), plain: analysisCheckPlain(id), message: prev?.report?.checks.find((c) => c.id === id)?.message ?? null,
    }));
    const remainingIds = rec?.remaining ?? failedIdsOf(cur?.report);
    const fixedIds = rec?.fixed ?? targetedIds.filter((id) => !remainingIds.includes(id));
    const publishable = rec?.passed ?? cur?.report?.publishable;

    let state: AnalysisStepState;
    if (callFailed) state = 'call-failed';
    else if (publishable === true) state = 'passed';
    else if (publishable === false) state = 'still-failing';
    else state = 'running';

    const report = callFailed ? undefined : cur?.report;
    const after = report === undefined ? null : {
      passed: report.checks.filter((c) => c.passed).length, total: report.checks.length,
      checks: report.checks.map((c) => ({ ...ref(c.id), passed: c.passed })),
    };
    const hasDiff = !callFailed && prev?.analysis !== undefined && cur?.analysis !== undefined;
    const introduced = state === 'call-failed' ? [] : remainingIds.filter((id) => !targetedIds.includes(id));

    const actorEvent = [...finished].sort((a, b) => a.seq - b.seq).pop();
    const costUSD = actorEvent !== undefined && typeof actorEvent.estCostUSD === 'number' && Number.isFinite(actorEvent.estCostUSD) ? actorEvent.estCostUSD : null;
    const actor = actorEvent === undefined ? null : repairActor(events, n, 'analysis');

    let outcome: string;
    const nTarget = plural(targetedIds.length, 'targeted check', 'targeted checks');
    if (state === 'passed') outcome = `Muse’s repair passed: fixed ${fixedIds.length} of ${nTarget}${after !== null ? ` and all ${after.total} checks now pass` : ''}.`;
    else if (state === 'still-failing') outcome = `Not repaired: fixed ${fixedIds.length} of ${nTarget}; ${remainingIds.length} still failing${introduced.length > 0 ? ` (${introduced.length} new)` : ''}.`;
    else if (state === 'call-failed') outcome = 'Muse’s repair call returned no usable analysis; the earlier analysis stays as it was.';
    else outcome = 'Muse is repairing the analysis…';

    steps.push({
      attempt: rec?.attempt ?? n - 1, revision: n, repairOf: n - 1, state, label: ANALYSIS_REPAIR_LABEL,
      failedBefore, targeted: targetedIds.map(ref), fixed: fixedIds.map(ref), remaining: remainingIds.map(ref), introduced: introduced.map(ref),
      changes: hasDiff ? diff(prev?.analysis, cur?.analysis) : [], hasDiff, after, actor, costUSD, outcome,
    });
  }
  return steps;
}

/** Cost label of a step's repair call with the usual honesty rules; reuse of the event-based wording. */
export function stepCostLabel(s: Pick<AnalysisRepairStep, 'costUSD' | 'state'>): string | null {
  return stageCostLabel({ stage: 'repair', status: s.state === 'call-failed' ? 'failed' : 'succeeded', estCostUSD: s.costUSD ?? undefined, detail: undefined });
}

/** Total cost of all analysis repair calls, or null when no call reported a cost. */
export function analysisRepairCostUSD(steps: readonly Pick<AnalysisRepairStep, 'costUSD'>[]): number | null {
  const known = steps.filter((s) => s.costUSD !== null);
  return known.length === 0 ? null : known.reduce((sum, s) => sum + (s.costUSD ?? 0), 0);
}
