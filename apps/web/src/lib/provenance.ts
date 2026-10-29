// The one provenance line under a lesson's title (pure): which repairs happened and who caused them.
// Natural = Muse's own mistake, caught by a check and repaired. System-made = a demonstration fault the system
// planted on purpose (never a model error). Both stay visible in words; the details live in the runs drawer.

import type { AnalysisRepairState } from './analysisRepairs.ts';

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

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** 'Muse fixed 1 of its own mistakes', '1 system-made fault (planted on purpose, not a model error)', '1 repair did not pass'. */
export function repairPhrases(c: RepairCounts): CountPhrase[] {
  const out: CountPhrase[] = [];
  if (c.natural > 0) out.push({ text: `${n(c.natural, 'natural repair', 'natural repairs')} (Muse’s own mistake)`, tone: 'neutral' });
  if (c.system > 0) out.push({ text: `${n(c.system, 'system-made fault', 'system-made faults')} (planted on purpose, not a model error)`, tone: 'fault' });
  if (c.failed > 0) out.push({ text: `${n(c.failed, 'repair', 'repairs')} did not pass`, tone: 'bad' });
  return out;
}
