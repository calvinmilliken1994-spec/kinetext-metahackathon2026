// The one provenance line under a lesson's title (pure): which repairs happened and who caused them.
// Natural = Muse's own mistake, caught by a check and repaired. System-made = a demonstration fault the system
// planted on purpose (never a model error). Both stay visible in words; the details live in the runs drawer.

import type { AnalysisRepairState } from './analysisRepairs.ts';
import { formatCostUSD } from './jobs.ts';

export interface RepairCounts {
  /** Parts (or the page analysis) Muse repaired after its own mistake. */
  natural: number;
  /** Demonstration faults planted by the system on purpose. */
  system: number;
  /** Repairs that did not pass (the part is then not shown). */
  failed: number;
}

export const NO_REPAIRS: RepairCounts = { natural: 0, system: 0, failed: 0 };

export interface RepairCardLike {
  componentId: string;
  attempt: number;
  origin: 'natural' | 'system';
  state: 'passed' | 'still-failing' | 'running';
}

/**
 * Counts for a lesson job: each component counts once, its state by its latest repair attempt; the analysis counts as one.
 * S6R-11: the ORIGIN is per component and immutable — if any attempt of a component is system-made (its baseline carried
 * an injected fault), the component is system-made, so a later attempt can never turn into a natural-repair claim.
 */
export function lessonRepairCounts(cards: readonly RepairCardLike[], analysis: AnalysisRepairState): RepairCounts {
  const latest = new Map<string, RepairCardLike>();
  const systemMade = new Set<string>();
  for (const c of cards) {
    if (c.origin === 'system') systemMade.add(c.componentId);
    const prev = latest.get(c.componentId);
    if (prev === undefined || c.attempt >= prev.attempt) latest.set(c.componentId, c);
  }
  const counts = { natural: 0, system: 0, failed: 0 };
  for (const c of latest.values()) {
    const origin = systemMade.has(c.componentId) ? 'system' : 'natural';
    if (origin === 'system') counts.system += 1;
    if (c.state === 'still-failing') counts.failed += 1;
    else if (c.state === 'passed' && origin === 'natural') counts.natural += 1;
  }
  if (analysis === 'passed') counts.natural += 1;
  if (analysis === 'failed') counts.failed += 1;
  return counts;
}

/** Counts for a classic single-activity job: an analysis repair, a published later revision, a planted demo fault. */
export function activityRepairCounts(input: { analysis: AnalysisRepairState; repaired: 'natural' | 'system' | null; demoFault: boolean }): RepairCounts {
  return {
    natural: (input.analysis === 'passed' ? 1 : 0) + (input.repaired === 'natural' ? 1 : 0),
    system: input.demoFault || input.repaired === 'system' ? 1 : 0,
    failed: input.analysis === 'failed' ? 1 : 0,
  };
}

export interface CountPhrase { text: string; tone: 'neutral' | 'fault' | 'bad' }

// ---- Stage 7 item 2: one review status, one checked sentence, and the trust receipt --------------------------------

/** The lesson's one review status, said once under its title. */
export const REVIEW_STATUS = 'Draft · needs teacher review';

/** The one plain sentence of what code checked (the status above already says the wording needs review). */
export const CHECKED_SENTENCE = 'Quotes and numbers were checked against the page by code.';

/** sources.ts ends a teacher-source disclosure with this; the status line says it instead, so it is not repeated. */
const REVIEW_NOTE = /\s*The wording needs teacher review\.\s*$/;

/** A disclosure without its trailing teacher-review sentence; every other disclosure (publisher, NASA) is unchanged. */
export function withoutReviewNote(disclosure: string): string {
  return disclosure.replace(REVIEW_NOTE, '');
}

export interface CheckTally { passed: number; total: number }
export interface QuoteTally { found: number; total: number }

/** Passed/total of a validation report; null when there is no report or it has no checks. */
export function checkTally(report: { checks: readonly { passed: boolean }[] } | null | undefined): CheckTally | null {
  if (report === null || report === undefined || report.checks.length === 0) return null;
  return { passed: report.checks.filter((c) => c.passed).length, total: report.checks.length };
}

/** Passed/total over a lesson's check sections (page analysis + each checked part); null when there are none. */
export function sectionTally(sections: readonly { passed: number; total: number }[]): CheckTally | null {
  const total = sections.reduce((n, s) => n + s.total, 0);
  return total === 0 ? null : { passed: sections.reduce((n, s) => n + s.passed, 0), total };
}

/**
 * How many of the lesson's quotes were found in the page text shown beside it (the highlighter's located keys).
 * Null while the page text is not loaded (`located` null) or when the lesson cites nothing: never a guessed number.
 */
export function quoteTally(quotes: readonly { key: string }[], located: ReadonlySet<string> | null): QuoteTally | null {
  if (located === null || quotes.length === 0) return null;
  return { found: quotes.filter((q) => located.has(q.key)).length, total: quotes.length };
}

export interface ReceiptInput {
  checks: CheckTally | null;
  quotes: QuoteTally | null;
  /** The job's recorded total; null/undefined/non-finite means unknown and is left out. */
  costUSD: number | null | undefined;
  reservedUSD?: number | null | undefined;
}

export interface ReceiptSegment { key: 'checks' | 'quotes' | 'cost'; text: string; tone: 'ok' | 'bad' | 'warn' | 'neutral' }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** '14/14 checks · 8/8 quotes found · $0.0471' as segments. A missing count or an unknown cost is omitted, never zeroed. */
export function receiptSegments(r: ReceiptInput): ReceiptSegment[] {
  const out: ReceiptSegment[] = [];
  if (r.checks !== null) out.push({ key: 'checks', text: `${r.checks.passed}/${r.checks.total} checks`, tone: r.checks.passed === r.checks.total ? 'ok' : 'bad' });
  if (r.quotes !== null) out.push({ key: 'quotes', text: `${r.quotes.found}/${r.quotes.total} quotes found`, tone: r.quotes.found === r.quotes.total ? 'ok' : 'warn' });
  if (finite(r.costUSD)) {
    const reserved = finite(r.reservedUSD) && r.reservedUSD > 0;
    out.push({ key: 'cost', text: `${formatCostUSD(r.costUSD)}${reserved ? ' incl. reserved' : ''}`, tone: 'neutral' });
  }
  return out;
}

/** The receipt in words, for the button's accessible name. */
export function receiptLabel(r: ReceiptInput): string {
  const parts: string[] = [];
  if (r.checks !== null) parts.push(`${r.checks.passed} of ${r.checks.total} ${r.checks.total === 1 ? 'check' : 'checks'} passed`);
  if (r.quotes !== null) parts.push(`${r.quotes.found} of ${r.quotes.total} ${r.quotes.total === 1 ? 'quote' : 'quotes'} found on the page`);
  if (finite(r.costUSD)) {
    const reserved = finite(r.reservedUSD) && r.reservedUSD > 0;
    parts.push(`estimated model cost ${formatCostUSD(r.costUSD)}${reserved ? ', including an amount reserved for an uncertain outcome' : ''}`);
  }
  return `Trust receipt: ${parts.join(', ')}`;
}

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** '1 revision by Muse after a failed check', '1 system-made fault (planted on purpose, not a model error)', '1 repair did not pass'. */
export function repairPhrases(c: RepairCounts): CountPhrase[] {
  const out: CountPhrase[] = [];
  if (c.natural > 0) out.push({ text: c.natural === 1 ? '1 revision by Muse after a failed check' : `${c.natural} revisions by Muse after failed checks`, tone: 'neutral' });
  if (c.system > 0) out.push({ text: `${n(c.system, 'system-made fault', 'system-made faults')} (planted on purpose, not a model error)`, tone: 'fault' });
  if (c.failed > 0) out.push({ text: `${n(c.failed, 'repair', 'repairs')} did not pass`, tone: 'bad' });
  return out;
}
