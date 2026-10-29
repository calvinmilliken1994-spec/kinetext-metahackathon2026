// Sort-into-groups (sort-groups-v1) view model (pure). The key is each item's stored groupId; groups are numbered
// 1..4 in stored order so a key press (or a click on a group button) assigns the focused item.

import type { SortGroupsSpec } from '../../../../packages/contracts/kit.ts';
import { seededOrder } from './seeded.ts';

/** itemId -> groupId; an item that is not in the record is not sorted yet. */
export type Assignments = Readonly<Record<string, string>>;

/** Item ids in a seeded pile order (never the stored order). */
export function sortPile(spec: SortGroupsSpec): string[] {
  return seededOrder(spec.items.map((i) => i.id), `${spec.seed}:${spec.id}`);
}

/** The group a number key picks ('1' is the first group), or null for any other key. */
export function groupForKey(spec: SortGroupsSpec, key: string): string | null {
  if (!/^[1-9]$/.test(key)) return null;
  return spec.groups[Number(key) - 1]?.id ?? null;
}

/** The key that picks a group ('1'..'4'), or null for an unknown group. */
export function keyForGroup(spec: SortGroupsSpec, groupId: string): string | null {
  const i = spec.groups.findIndex((g) => g.id === groupId);
  return i < 0 ? null : String(i + 1);
}

export function assignItem(assignments: Assignments, itemId: string, groupId: string | null): Record<string, string> {
  const next: Record<string, string> = { ...assignments };
  if (groupId === null) delete next[itemId];
  else next[itemId] = groupId;
  return next;
}

export interface SortItemResult { itemId: string; assigned: string | null; correctGroupId: string; correct: boolean }
export interface SortGrade {
  results: SortItemResult[];
  correctCount: number;
  total: number;
  unassigned: number;
  allAssigned: boolean;
  perfect: boolean;
}

export function gradeSort(spec: SortGroupsSpec, assignments: Assignments): SortGrade {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const results = spec.items.map((item): SortItemResult => {
    const raw = assignments[item.id];
    const assigned = raw !== undefined && groupIds.has(raw) ? raw : null;
    return { itemId: item.id, assigned, correctGroupId: item.groupId, correct: assigned === item.groupId };
  });
  const correctCount = results.filter((r) => r.correct).length;
  const unassigned = results.filter((r) => r.assigned === null).length;
  return { results, correctCount, total: results.length, unassigned, allAssigned: unassigned === 0, perfect: correctCount === results.length };
}

/** The next item (in pile order, after `afterId`, wrapping) that is not sorted yet; null when all are sorted. */
export function nextUnassigned(pile: readonly string[], assignments: Assignments, afterId: string | null): string | null {
  const start = afterId === null ? 0 : pile.indexOf(afterId) + 1;
  for (let k = 0; k < pile.length; k++) {
    const id = pile[(start + k) % pile.length] as string;
    if (assignments[id] === undefined) return id;
  }
  return null;
}
