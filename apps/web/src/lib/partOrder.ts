// The "most visual part" rule (set B): which part of a lesson leads, in the lesson and in presentation mode.
//
// A teacher opens on the part a class can look at and argue about: a labelled figure, a running simulation, a formula
// with its graph, an algorithm trace, a log scale, a vote threshold, a data table. Text-first parts (quiz cards,
// sequences, sorts, concept maps) follow. The rule is a fixed rank by kind; ties keep the lesson's plan order.
//
// The lesson view and presentation mode share this one rule (the lesson helpers are at the end of this file).

import { isKitGenComponentId } from '../../../../packages/contracts/kit.ts';
import type { LessonCard, LessonItem } from './lesson.ts';
import { NEEDS_REVIEW, reviewedStatus } from './reviewState.ts';
import type { ReviewState } from './reviewState.ts';

/** A part's kind: a kit componentId, or 'simulation' / 'timeline' for a premium or classic activity. */
export type PartKind = string;

/** Most visual first. Anything not listed ranks after every listed kind. */
export const VISUAL_ORDER: readonly PartKind[] = [
  'label-diagram-v1',
  'simulation',
  'formula-explorer-v1',
  'algorithm-trace-v1',
  'log-ladder-v1',
  'threshold-v1',
  'data-table-v1',
  'timeline',
  'balance-equation-v1',
  'compare-table-v1',
];

/** Rank of a kind (0 = most visual); text-first kinds share the last rank. */
export function visualRank(kind: PartKind): number {
  const i = VISUAL_ORDER.indexOf(kind);
  return i < 0 ? VISUAL_ORDER.length : i;
}

export function isVisualKind(kind: PartKind): boolean {
  return VISUAL_ORDER.includes(kind);
}

/**
 * The parts in teaching order: the most visual part first (the hook), then the other visual parts, then the text-first
 * parts (quizzes, sequences), each group in plan order. Pure and stable; never drops or duplicates a part.
 */
export function mostVisualFirst<T>(items: readonly T[], kindOf: (item: T) => PartKind): T[] {
  if (items.length <= 1) return [...items];
  let hero = -1;
  items.forEach((it, i) => {
    const r = visualRank(kindOf(it));
    if (r < VISUAL_ORDER.length && (hero < 0 || r < visualRank(kindOf(items[hero] as T)))) hero = i;
  });
  const rest = items.filter((_, i) => i !== hero);
  const visual = rest.filter((it) => isVisualKind(kindOf(it)));
  const text = rest.filter((it) => !isVisualKind(kindOf(it)));
  return hero < 0 ? [...items] : [items[hero] as T, ...visual, ...text];
}

// ---- the lesson view's use of the same rule (Set B lesson slice) ------------------------------------------------
// The lesson opens on its most visual checked part with its first question; the overview follows as "Lesson notes".

export interface LessonLayout {
  /** The part the lesson opens on (null when no part passed). */
  lead: LessonItem | null;
  /** The other working parts, in plan order. */
  rest: LessonItem[];
  /** Parts that are not shown: held back, could not be verified, or not built (plan order). */
  leftOut: LessonCard[];
}

const SEQUENCE_KINDS: ReadonlySet<string> = new Set(['timeline-v1']);

/** A lesson part's kind for this rule: kit parts by componentId; a premium activity is a 'timeline' or a 'simulation'. */
export function lessonPartKind(componentId: string): PartKind {
  if (isKitGenComponentId(componentId)) return componentId;
  return SEQUENCE_KINDS.has(componentId) ? 'timeline' : 'simulation';
}

const itemKind = (it: LessonItem): PartKind => lessonPartKind(it.kind === 'card' ? it.card.componentId : it.slot.componentId);

/** A lesson being built: its parts and placeholders in the order the finished lesson will show them (most visual first). */
export function buildingOrder(items: readonly LessonItem[]): LessonItem[] {
  return mostVisualFirst(items, itemKind);
}

/**
 * A lesson at rest (same rule as the slides, mostVisualFirst): the most visual PASSED part leads, then the other working
 * parts in teaching order. Parts that are not shown (held back, could not be verified, not built) never lead: they go
 * to one compact notice after the working parts, in plan order.
 */
export function activityFirst(items: readonly LessonItem[]): LessonLayout {
  const leftOut: LessonCard[] = [];
  const working: LessonItem[] = [];
  for (const it of items) {
    if (it.kind === 'card' && it.card.status !== 'passed') leftOut.push(it.card);
    else working.push(it);
  }
  const ordered = mostVisualFirst(working, itemKind);
  return { lead: ordered[0] ?? null, rest: ordered.slice(1), leftOut };
}

export interface PartCounts { ready: number; heldBack: number }

export function partCounts(cards: readonly Pick<LessonCard, 'status'>[]): PartCounts {
  const ready = cards.filter((c) => c.status === 'passed').length;
  return { ready, heldBack: cards.length - ready };
}

/** '2 parts ready · 1 held back': the counts alone, for beside the Needs review notice. Empty when unknown or none. */
export function partCountsLine(counts: PartCounts | null): string {
  if (counts === null) return '';
  const out: string[] = [];
  if (counts.ready > 0) out.push(`${counts.ready} ${counts.ready === 1 ? 'part' : 'parts'} ready`);
  if (counts.heldBack > 0) out.push(`${counts.heldBack} held back`);
  return out.join(' · ');
}

/**
 * 'Needs review · 2 parts ready · 1 held back'. Counts are left out when unknown (a build still running).
 * A published lesson (Stage 10b) reads 'Reviewed by a teacher · published 2 Nov 2026 · 2 parts ready' instead; `utc` pins
 * the date's time zone for tests.
 */
export function lessonStatusLine(counts: PartCounts | null, review: ReviewState | null = null, utc = false): string {
  const head = review === null ? NEEDS_REVIEW : reviewedStatus(review, utc);
  const tail = partCountsLine(counts);
  return tail === '' ? head : `${head} · ${tail}`;
}

/**
 * Library tidy: what the line under a lesson's title holds for its review cue (lessonReviewCue). `notice`: show the amber
 * Needs review notice, with the part counts as `text` beside it. A published lesson always keeps its reviewed line; a
 * classic activity ('none') shows only its counts.
 */
export function reviewStatusView(cue: 'notice' | 'line' | 'none', counts: PartCounts | null, review: ReviewState | null, utc = false): { notice: boolean; text: string } {
  if (cue === 'notice' && review === null) return { notice: true, text: partCountsLine(counts) };
  if (cue === 'none') return { notice: false, text: partCountsLine(counts) };
  return { notice: false, text: lessonStatusLine(counts, review, utc) };
}

/**
 * The disclosure as ONE sentence for the line under the title: "AI-generated with M. Includes material from P, which has
 * not reviewed or endorsed this lesson." → "AI-generated with M from P, which has not reviewed or endorsed this lesson."
 * The teacher-review sentence of a pasted-text disclosure is dropped (the status line says it). Any other wording
 * (NASA conditions, project-team texts) is kept exactly as written.
 */
export function provenanceSentence(disclosure: string): string {
  const d = disclosure.replace(/\s*The wording needs teacher review\.\s*$/, '').trim();
  const m = /^(AI-generated with .+?)\. Includes material from (.+), which has not reviewed or endorsed this lesson\.$/.exec(d);
  if (m !== null) return `${m[1]} from ${m[2]}, which has not reviewed or endorsed this lesson.`;
  const g = /^(AI-generated with .+?)\. The source's publisher has not reviewed or endorsed this lesson\.$/.exec(d);
  if (g !== null) return `${g[1]}; the source’s publisher has not reviewed or endorsed this lesson.`;
  return d;
}
