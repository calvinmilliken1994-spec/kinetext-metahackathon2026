// Stage 10c slice D (UX review 2, M3): what a part says to students, as short read-only lines for the Review page. The
// teacher ticks "I've read the wording", so the wording has to be on the page. One rule per kind of part; every line is
// AI-written text and goes through the shared display clean-up (aiLabel). Page quotes are never shown here. Pure: no
// React, no DOM, no network.

import type { AnyActivitySpec } from './timeline.ts';
import type { KitSpec } from '../../../../packages/contracts/kit.ts';
import { aiLabel } from './displayText.ts';

export interface WordingLine {
  /** The line itself: a question, a step, a group name, a formula. */
  text: string;
  /** A quieter second line under it: the answer options, a group's items, a row's values. */
  detail?: string;
}

/** How many lines the Review page shows before "Show all". */
export const WORDING_PREVIEW = 2;

const clean = (s: string): string => aiLabel(s.trim());
const line = (text: string, detail?: string): WordingLine => {
  const t = clean(text);
  const d = detail === undefined ? '' : detail.trim();
  return d === '' ? { text: t } : { text: t, detail: d };
};
const join = (parts: readonly string[]): string => parts.map((p) => clean(p)).filter((p) => p !== '').join(' · ');
const nonEmpty = (l: WordingLine): boolean => l.text !== '';

function kitLines(spec: KitSpec): WordingLine[] {
  switch (spec.componentId) {
    case 'quiz-cards-v1': return spec.cards.map((c) => line(c.stem, join(c.options)));
    case 'sequence-v1': return spec.steps.map((s, i) => line(`${i + 1}. ${clean(s.label)}`));
    case 'sort-groups-v1':
      return spec.groups.map((g) => line(g.label, join(spec.items.filter((i) => i.groupId === g.id).map((i) => i.label))));
    case 'concept-map-v1': {
      const name = (id: string): string => spec.nodes.find((n) => n.id === id)?.label ?? id;
      return spec.links.map((l) => line(`${clean(name(l.fromId))} ${l.relation} ${clean(name(l.toId))}`));
    }
    case 'compare-table-v1':
      return spec.entities.map((e, i) => line(e, spec.cells
        .filter((c) => c.entityIndex === i)
        .sort((a, b) => a.attributeIndex - b.attributeIndex)
        .map((c) => `${clean(spec.attributes[c.attributeIndex] ?? '')}: ${clean(c.value)}`)
        .join(' · ')));
    case 'formula-explorer-v1':
      return [line(spec.formulaText), ...spec.variables.map((v) => line(`${v.pageSymbol === '' ? v.name : v.pageSymbol}: ${clean(v.meaning)}`, v.unit))];
    case 'balance-equation-v1': return [line(spec.equationText), ...(spec.hint.trim() === '' ? [] : [line(`Hint: ${clean(spec.hint)}`)])];
    case 'algorithm-trace-v1': return [line(spec.algorithmName), ...spec.claims.map((c) => line(c.text))];
    case 'log-ladder-v1':
      return [line(spec.quantity, join([spec.factorText, spec.effectPhrase])), ...spec.rungs.map((r) => line(r.label))];
    case 'threshold-v1':
      return [...spec.stages.map((s) => line(s.body, thresholdRule(s))), ...spec.scenarios.map((s) => line(s.label))];
    case 'data-table-v1': {
      const col = (i: number): string => clean(spec.columns[i]?.header ?? '');
      const row = (i: number): string => clean(spec.rows[i]?.label ?? '');
      return [
        line('Columns', join([spec.labelHeader, ...spec.columns.map((c) => (c.unit.trim() === '' ? c.header : `${c.header} (${c.unit.trim()})`))])),
        ...spec.questions.map((q) => line(q.kind === 'lookup' ? `What is ${row(q.rowIndex)}’s ${col(q.columnIndex)}?`
          : `Which row has the ${q.kind === 'largest' ? 'largest' : 'smallest'} ${col(q.columnIndex)}?`)),
      ];
    }
    case 'label-diagram-v1': return [...spec.parts.map((p) => line(p.name)), ...(spec.hint.trim() === '' ? [] : [line(`Hint: ${clean(spec.hint)}`)])];
    case 'overview-v1': return [];
    default: return [];
  }
}

function thresholdRule(s: { rule: 'majority' | 'fraction' | 'count'; numerator: number; denominator: number; statedCount: number; total: number }): string {
  if (s.rule === 'majority') return `A majority of ${s.total}`;
  if (s.rule === 'count') return `${s.statedCount} of ${s.total}`;
  return `${s.numerator}/${s.denominator} of ${s.total}`;
}

/** A premium activity (a numeric simulation or timeline) reads as its prediction questions, then its explanations. */
function activityLines(spec: AnyActivitySpec): WordingLine[] {
  return [...spec.predictions.map((p) => line(p.prompt)), ...spec.explanations.map((e) => line(e.text))];
}

/**
 * The lines a student reads in a part. `kit` is a kit part's verified spec; `premium` the lesson's premium activity spec
 * for a premium part. Both null (nothing to show) gives no lines.
 */
export function partWording(kit: KitSpec | null, premium: AnyActivitySpec | null): WordingLine[] {
  const lines = kit !== null ? kitLines(kit) : premium !== null ? activityLines(premium) : [];
  return lines.filter(nonEmpty);
}

/** The first lines, and how many wait behind "Show all" (none when everything is shown). */
export function previewLines(lines: readonly WordingLine[], all: boolean): { shown: WordingLine[]; hidden: number } {
  if (all || lines.length <= WORDING_PREVIEW) return { shown: [...lines], hidden: 0 };
  return { shown: lines.slice(0, WORDING_PREVIEW), hidden: lines.length - WORDING_PREVIEW };
}
