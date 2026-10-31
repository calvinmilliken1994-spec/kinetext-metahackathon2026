// Threshold ("Does it pass?", threshold-v1) view model (pure). Every count comes from the engine in
// packages/kit-engines/threshold.ts (requiredCount, stagePasses); this file only words and lays out what the engine says.
// A vote passes only when every stage passes. Scenarios are "try it" inputs written for the lesson, not page claims.

import type { ThresholdScenarioGen, ThresholdSpec, ThresholdStageGen } from '../../../../packages/contracts/kit.ts';
import { fractionWords, requiredCount, stagePasses } from '../../../../packages/kit-engines/threshold.ts';
import { aiLabel, groupThousands } from './displayText.ts';
import type { QuoteLike } from './linking.ts';

/** How many presenter steps (→ presses inside the part's presentation beat) this view uses: one per try-it scenario. */
export function thresholdPresentationSteps(spec: ThresholdSpec): number {
  return Math.max(1, spec.scenarios.length);
}

/** A whole count as people read it: '538', '1,000'. */
export function countText(n: number): string {
  return groupThousands(String(Math.round(n)));
}

/** How a stage's seats are drawn: one small unit per seat when there are few enough to count by eye, else a bar. */
export interface MeterLayout { kind: 'units' | 'bar'; rows: number; cols: number }

export const UNIT_LIMIT = 100;

export function meterLayout(total: number): MeterLayout {
  if (!(total >= 1) || total > UNIT_LIMIT) return { kind: 'bar', rows: 1, cols: 1 };
  const rows = total <= 25 ? 1 : total <= 60 ? 2 : 4;
  return { kind: 'units', rows, cols: Math.ceil(total / rows) };
}

/** The rule in words: 'a majority', 'three-fourths', 'the stated count'. */
export function ruleWords(stage: Pick<ThresholdStageGen, 'rule' | 'numerator' | 'denominator'>): string {
  if (stage.rule === 'majority') return 'a majority';
  if (stage.rule === 'fraction') return fractionWords(stage.numerator, stage.denominator)[0] ?? `${stage.numerator}/${stage.denominator}`;
  return 'the stated count';
}

/** 'needs 270 of 538' */
export function needText(need: number, total: number): string {
  return `needs ${countText(need)} of ${countText(total)}`;
}

export interface StageInfo {
  id: string;
  index: number;
  /** Who votes, as the slide shows it (sentence case). */
  body: string;
  total: number;
  /** The engine's required count. */
  need: number;
  rule: string;
  needLine: string;
  /** Where the required line sits along a bar (0..1): the fill reaches it exactly at `need` votes. */
  needAt: number;
  /** For a units meter (filled column by column): how many whole columns the required seats take. */
  needColumns: number;
  meter: MeterLayout;
  stage: ThresholdStageGen;
}

export function stageInfo(spec: ThresholdSpec): StageInfo[] {
  return spec.stages.map((s, index) => {
    const need = requiredCount(s);
    const meter = meterLayout(s.total);
    return {
      id: s.id, index, body: aiLabel(s.body.trim()), total: s.total, need, rule: ruleWords(s), needLine: needText(need, s.total),
      needAt: need / s.total, needColumns: Math.ceil(need / meter.rows), meter, stage: s,
    };
  });
}

export function clampVotes(total: number, n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(total, Math.round(n)));
}

export interface StageOutcome { passes: boolean; yes: number; need: number; total: number; margin: number }
export interface VoteOutcome { stages: StageOutcome[]; passes: boolean; failedAt: number | null }

/** Pass or fail for one set of 'yes' counts (one per stage); every stage must pass. */
export function voteOutcome(spec: ThresholdSpec, yes: readonly number[]): VoteOutcome {
  const stages = spec.stages.map((s, i): StageOutcome => {
    const y = clampVotes(s.total, yes[i] ?? 0);
    const need = requiredCount(s);
    return { passes: stagePasses(s, y), yes: y, need, total: s.total, margin: y - need };
  });
  const failedAt = stages.findIndex((s) => !s.passes);
  return { stages, passes: failedAt < 0, failedAt: failedAt < 0 ? null : failedAt };
}

/** The class question for a scenario: 'Will 35 of 50 States be enough?' (one stage) or 'Will this vote pass every stage?'. */
export function scenarioQuestion(spec: ThresholdSpec, scenario: Pick<ThresholdScenarioGen, 'yes'>): string {
  const only = spec.stages.length === 1 ? spec.stages[0] : undefined;
  if (only !== undefined) {
    const y = clampVotes(only.total, scenario.yes[0] ?? 0);
    return `Will ${countText(y)} of ${countText(only.total)} ${only.body.trim()} be enough?`;
  }
  return 'Will this vote pass every stage?';
}

/** The verdict after the reveal, in plain words (the engine's counts, never the model's). */
export function verdictText(spec: ThresholdSpec, outcome: VoteOutcome): { headline: string; detail: string } {
  const multi = spec.stages.length > 1;
  if (outcome.passes) {
    const s = outcome.stages[0];
    if (!multi && s !== undefined) {
      return { headline: 'It passes', detail: s.margin === 0 ? `Exactly the ${countText(s.need)} needed.` : `${countText(s.margin)} more than the ${countText(s.need)} needed.` };
    }
    return { headline: 'It passes', detail: 'Every stage reaches its required count.' };
  }
  const at = outcome.failedAt ?? 0;
  const s = outcome.stages[at];
  const stage = spec.stages[at];
  if (s === undefined || stage === undefined) return { headline: 'It fails', detail: '' };
  const short = `${countText(-s.margin)} short of the ${countText(s.need)} needed`;
  return { headline: 'It fails', detail: multi ? `${aiLabel(stage.body.trim())}: ${short}.` : `${short}.` };
}

/** Whole numbers a text states (thousands commas allowed): '38 of 50 States' → [38, 50]. */
export function wholeNumbersIn(text: string): number[] {
  return Array.from(text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?![\d,])|(?<![\d.,])\d+(?![\d,])/g), (m) => Number(m[0].replace(/,/g, '')));
}

/** True when a quote states the stage's required count, so it stays unlinked until the reveal (no answer in the zone). */
export function quoteLeaksNeed(stage: Pick<ThresholdStageGen, 'total' | 'rule' | 'numerator' | 'denominator' | 'statedCount'>, quote: string): boolean {
  return wholeNumbersIn(quote).includes(requiredCount(stage));
}

/** The page sentence a revealed step puts in the quote zone: the rule of the stage that decided it. */
export function thresholdRevealQuote(spec: ThresholdSpec, step: number): QuoteLike | null {
  const scenario = spec.scenarios[Math.max(0, Math.min(step, spec.scenarios.length - 1))];
  if (scenario === undefined) return null;
  const outcome = voteOutcome(spec, scenario.yes);
  const stage = spec.stages[outcome.failedAt ?? 0];
  return stage === undefined ? null : { sourceId: stage.sourceId, quote: stage.quote };
}
