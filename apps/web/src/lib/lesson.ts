// Lesson view model (pure): which cards the lesson shows, in plan order, with their status and the exact plain-language
// messages. A component is only ever rendered when its entry passed AND its stored spec is present and is that component;
// anything else shows only a "could not be verified" message, never unverified content.

import type { DeclineCode, KitGenComponentId, KitSpec, LessonComponentEntry, LessonSpec, OverviewSpec, PlanComponentId } from '../../../../packages/contracts/kit.ts';
import { isKitGenComponentId } from '../../../../packages/contracts/kit.ts';
import { engineTitle } from './engines.ts';
import { quoteKey } from './evidence.ts';
import type { QuoteRef } from './evidence.ts';

/** Exact failure strings from the frozen design (§2.2–§2.7, §3). */
export const FAILURE_MESSAGES: Readonly<Record<KitGenComponentId, string>> = {
  'quiz-cards-v1': 'Quiz cards could not be verified against the page.',
  'sequence-v1': 'Steps could not be ordered from the page wording.',
  'sort-groups-v1': 'Group membership could not be verified against the page.',
  'concept-map-v1': 'Connections could not be verified against the page.',
  'compare-table-v1': 'Comparison could not be verified against the page.',
  'formula-explorer-v1': 'The formula could not be checked with our calculator.',
  'balance-equation-v1': 'The reaction equation could not be verified against the page.',
};
export const PREMIUM_FAILURE_MESSAGE = 'This activity could not be verified against the page.';
export const SKIPPED_MESSAGE = 'This component was not built for this lesson.';

const KIT_LABELS: Readonly<Record<KitGenComponentId, string>> = {
  'quiz-cards-v1': 'Quiz cards',
  'sequence-v1': 'Sequence',
  'sort-groups-v1': 'Sort into groups',
  'concept-map-v1': 'Concept map',
  'compare-table-v1': 'Compare table',
  'formula-explorer-v1': 'Formula explorer',
  'balance-equation-v1': 'Balance the equation',
};

export function componentLabel(id: PlanComponentId): string {
  return isKitGenComponentId(id) ? KIT_LABELS[id] : engineTitle(id) ?? id;
}

const DECLINE_TEXT: Readonly<Record<DeclineCode, string>> = {
  'too-short': 'The page is too short to teach from: there is not enough running text to summarise or to build an activity from.',
  'not-prose': 'The page is mostly lists, tables or code rather than running text, so there is nothing to summarise.',
  'boilerplate-only': 'The page is mostly navigation, notices or boilerplate rather than lesson content.',
  'no-teachable-content': 'The page does not contain anything that can be taught or checked from its own text.',
  unreadable: 'The text of the page could not be read reliably, so nothing was built from it.',
  'prompt-injection-only': 'The page text is mostly instructions aimed at AI tools rather than lesson content, so it was set aside.',
};

export function declineText(code: DeclineCode | ''): string {
  return (code !== '' && DECLINE_TEXT[code]) || 'The page could not be turned into a lesson.';
}

export type CardStatus = 'passed' | 'failed' | 'skipped';

export interface LessonCard {
  key: string;
  componentId: PlanComponentId;
  label: string;
  /** The spec's own title for a kit component, else the component label. */
  title: string;
  status: CardStatus;
  /** The verified kit spec; null for failed/skipped cards and for a premium activity (the premium spec is mounted separately). */
  spec: KitSpec | null;
  premium: boolean;
  /** For a passed card: the backend's note (for example items that were dropped); '' when there is none. */
  note: string;
  /** For a failed or skipped card: the plain message to show instead of content. */
  message: string;
  /** For a failed or skipped card: the backend's reason, for a "details" fold-out. */
  detail: string;
  revision: number;
}

function failedCard(entry: LessonComponentEntry, status: CardStatus, message: string): LessonCard {
  const label = componentLabel(entry.componentId);
  return {
    key: `${entry.componentId}:${entry.specId}`, componentId: entry.componentId, label, title: label, status, spec: null,
    premium: !isKitGenComponentId(entry.componentId), note: '', message, detail: entry.reason.trim(), revision: entry.revision,
  };
}

/** Cards in plan order. `hasPremium` says whether the lesson came with the premium activity spec the plan names. */
export function lessonCards(lesson: LessonSpec, specs: Readonly<Record<string, KitSpec>>, hasPremium: boolean): LessonCard[] {
  return lesson.components.map((entry): LessonCard => {
    const kit = isKitGenComponentId(entry.componentId);
    const failure = kit ? FAILURE_MESSAGES[entry.componentId as KitGenComponentId] : PREMIUM_FAILURE_MESSAGE;
    if (entry.status === 'skipped') return failedCard(entry, 'skipped', SKIPPED_MESSAGE);
    if (entry.status !== 'passed') return failedCard(entry, 'failed', failure);
    const label = componentLabel(entry.componentId);
    if (!kit) {
      if (!hasPremium) return failedCard(entry, 'failed', failure);
      return { key: `${entry.componentId}:${entry.specId}`, componentId: entry.componentId, label, title: label, status: 'passed', spec: null, premium: true, note: entry.reason.trim(), message: '', detail: '', revision: entry.revision };
    }
    const spec = specs[entry.specId];
    if (spec === undefined || spec.componentId !== entry.componentId) return failedCard(entry, 'failed', failure);
    return { key: `${entry.componentId}:${entry.specId}`, componentId: entry.componentId, label, title: spec.title, status: 'passed', spec, premium: false, note: entry.reason.trim(), message: '', detail: '', revision: entry.revision };
  });
}

// ---- quotes for the source panel ----------------------------------------------------------------------------------

export function lessonQuoteKey(componentId: string, part: string, id: string): string {
  return quoteKey('lesson', `${componentId}.${part}.${id}`, 0);
}

/** Every quote the lesson shows that cites `sourceId`, keyed so the source panel can highlight it (kind 'lesson'). */
export function collectLessonQuotes(sourceId: string, overview: OverviewSpec | null, specs: Readonly<Record<string, KitSpec>>): QuoteRef[] {
  const out: QuoteRef[] = [];
  const add = (componentId: string, part: string, id: string, label: string, q: { sourceId: string; quote: string }): void => {
    if (q.sourceId !== sourceId) return;
    out.push({ key: lessonQuoteKey(componentId, part, id), quote: q.quote, kind: 'lesson', ownerId: `${componentId}.${part}.${id}`, ownerLabel: label });
  };
  for (const p of overview?.keyPoints ?? []) add('overview-v1', 'point', p.id, p.point, p);
  for (const t of overview?.keyTerms ?? []) add('overview-v1', 'term', t.id, t.term, t);
  for (const spec of Object.values(specs)) {
    switch (spec.componentId) {
      case 'quiz-cards-v1': for (const c of spec.cards) add(spec.componentId, 'card', c.id, c.stem, c); break;
      case 'sequence-v1': for (const s of spec.steps) add(spec.componentId, 'step', s.id, s.label, s); break;
      case 'sort-groups-v1': for (const i of spec.items) add(spec.componentId, 'item', i.id, i.label, i); break;
      case 'concept-map-v1': for (const l of spec.links) add(spec.componentId, 'link', l.id, `${l.fromId} ${l.relation} ${l.toId}`, l); break;
      case 'compare-table-v1': for (const c of spec.cells) add(spec.componentId, 'cell', c.id, c.value, c); break;
      case 'formula-explorer-v1':
        add(spec.componentId, 'equation', 'equation', spec.formulaText, spec);
        for (const v of spec.variables) add(spec.componentId, 'var', v.name, v.meaning, { sourceId: spec.sourceId, quote: v.quote });
        if (spec.hasSourceExample) add(spec.componentId, 'example', 'example', 'Worked example on the page', { sourceId: spec.sourceId, quote: spec.sourceExample.quote });
        break;
      case 'balance-equation-v1':
        add(spec.componentId, 'equation', 'equation', spec.equationText, spec);
        for (const s of spec.species) add(spec.componentId, 'species', s.id, s.formula, s);
        break;
      default: break;
    }
  }
  return out;
}
