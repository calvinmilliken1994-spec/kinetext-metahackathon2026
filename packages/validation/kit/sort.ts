// S6-V — sort-groups-v1 validation (SORT-01..SORT-06, design §2.4 frozen) + the per-item drop
// helper ("drop items while >= 6 items and >= 2/group remain").
//
// SORT-02 (the design's exact rule): the item label occurs in the item's quote (required) AND the
// group label occurs in the quote OR in the same paragraph as the located quote span (paragraph =
// blank-line split of the raw source text, computed by our code). The design discloses the false
// accept: a long paragraph mentioning several categories can validate a weak link; the teacher
// sees every quote.

import type { SourceDocument, ValidationCheck, ValidationReport } from '../../contracts/index.ts';
import { KIT_LIMITS } from '../../contracts/kit.ts';
import type { SortGroupsGen } from '../../contracts/kit.ts';
import { guarded, normalizeWhitespace } from '../validate.ts';
import {
  buildReport,
  buildSourceIndex,
  collectQuoteFailures,
  containsNormalized,
  duplicateOccurrences,
  idProblems,
  itemIndicesWithFailures,
  KIT_FAILURE_MESSAGES,
  lengthProblems,
  numbersCheckProblems,
} from './shared.ts';
import type { SourceIndex } from './shared.ts';
import type { DroppedItem, PruneResult } from './quiz.ts';

const L = KIT_LIMITS.sort;

/** The shared label-in-quote-or-paragraph rule (SORT-02 group clause, CM-02, CT-02 entity clause). */
export function labelInQuoteOrParagraph(label: string, quote: string, sourceId: string, idx: SourceIndex): boolean {
  if (typeof label !== 'string' || label === '') return false;
  if (containsNormalized(quote ?? '', label)) return true;
  const paragraph = idx.paragraphOf(quote ?? '', sourceId);
  return paragraph !== null && containsNormalized(paragraph, label);
}

export function sortStructuralProblems(gen: SortGroupsGen): { problems: string[]; affected: string[] } {
  const problems: string[] = [];
  const affected: string[] = [];
  const push = (p: string[], ptr: string): void => { if (p.length > 0) { problems.push(...p); affected.push(ptr); } };
  if (typeof gen.title !== 'string' || gen.title === '') { problems.push('title must be a non-empty string'); affected.push('/title'); }
  const groupIds = gen.groups.map(g => g.id);
  const groupDups = duplicateOccurrences(groupIds);
  gen.groups.forEach((g, i) => {
    push(idProblems(`groups[${i}].id`, g.id), `/groups/${i}/id`);
    if (groupDups.has(g.id)) { problems.push(`group id "${g.id}" occurs more than once (expected unique ids)`); affected.push(`/groups/${i}/id`); }
    push(lengthProblems(`groups[${i}].label`, g.label, L.groupLabel.min, L.groupLabel.max), `/groups/${i}/label`);
  });
  const itemIds = gen.items.map(it => it.id);
  const itemDups = duplicateOccurrences(itemIds);
  gen.items.forEach((it, i) => {
    push(idProblems(`items[${i}].id`, it.id), `/items/${i}/id`);
    if (itemDups.has(it.id)) { problems.push(`item id "${it.id}" occurs more than once (expected unique ids)`); affected.push(`/items/${i}/id`); }
    push(lengthProblems(`items[${i}].label`, it.label, L.itemLabel.min, L.itemLabel.max), `/items/${i}/label`);
  });
  return { problems, affected };
}

export function validateSortGroups(gen: SortGroupsGen, sources: SourceDocument[], opts: { revision?: number } = {}): ValidationReport {
  const idx = buildSourceIndex(sources);
  const all = idx.allTexts();
  const structural = sortStructuralProblems(gen);
  const groupById = new Map(gen.groups.map((g, i) => [g.id, { g, i }]));

  const checks: ValidationCheck[] = [
    structural.problems.length === 0
      ? { id: 'schema.gen', kind: 'schema', passed: true, message: 'every sort text length, id pattern and id uniqueness is within the frozen limits' }
      : { id: 'schema.gen', kind: 'schema', passed: false, message: `sort gen failed the structural limits: ${structural.problems.join('; ')}`, path: structural.affected[0], affected: structural.affected },

    guarded('SORT-01', 'grounding', () => {
      const { problems, affected, grounded } = collectQuoteFailures(
        gen.items.map((it, i) => ({ quote: it.quote, sourceId: it.sourceId, quotePtr: `/items/${i}/quote`, sourceIdPtr: `/items/${i}/sourceId`, label: `items[${i}] (${it.id})` })),
        idx,
      );
      return problems.length === 0
        ? { passed: true, message: `all ${grounded} item quote(s) appear verbatim in their cited source after whitespace normalisation (quotes-verbatim)` }
        : { passed: false, message: `${problems.join('; ')} (expected verbatim quotes of 1-${KIT_LIMITS.common.quote.max} characters from the cited source)`, path: affected[0], affected };
    }),

    guarded('SORT-02', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      gen.items.forEach((it, i) => {
        const group = groupById.get(it.groupId)?.g;
        if (!containsNormalized(it.quote ?? '', it.label ?? '')) {
          problems.push(`items[${i}] (${it.id}): the item label "${it.label}" does not occur in its quote (item-and-group-in-quote requires the item label IN the quote)`);
          affected.push(`/items/${i}/label`, `/items/${i}/quote`);
        }
        if (group === undefined) return; // SORT-03 owns unknown groupIds
        if (!labelInQuoteOrParagraph(group.label ?? '', it.quote ?? '', it.sourceId ?? '', idx)) {
          problems.push(`items[${i}] (${it.id}): the group label "${group.label}" occurs neither in the quote nor in the same paragraph as the located quote span (item-and-group-in-quote)`);
          affected.push(`/items/${i}/groupId`, `/items/${i}/quote`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every item label occurs in its quote and every group label occurs in the quote or the same source paragraph (item-and-group-in-quote; the design discloses the weak-link false accept on long paragraphs — every quote is shown to the teacher)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SORT-03', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const perGroup = new Map<string, number>();
      gen.items.forEach((it, i) => {
        if (!groupById.has(it.groupId)) {
          problems.push(`items[${i}] (${it.id}) references groupId "${it.groupId}", which is not a declared group`);
          affected.push(`/items/${i}/groupId`);
          return;
        }
        perGroup.set(it.groupId, (perGroup.get(it.groupId) ?? 0) + 1);
      });
      gen.groups.forEach((g, i) => {
        const count = perGroup.get(g.id) ?? 0;
        if (count < L.minItemsPerGroup) {
          problems.push(`group "${g.label}" has ${count} item(s), expected >= ${L.minItemsPerGroup} (groups-covered)`);
          affected.push(`/groups/${i}`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: `every declared group is referenced by >= ${L.minItemsPerGroup} items and every item groupId resolves (groups-covered)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SORT-04', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      const labels = gen.items.map(it => normalizeWhitespace(it.label ?? '').toLowerCase());
      const dups = duplicateOccurrences(labels.filter(l => l !== ''));
      gen.items.forEach((it, i) => {
        const key = normalizeWhitespace(it.label ?? '').toLowerCase();
        if (key !== '' && dups.has(key)) {
          problems.push(`items[${i}]: the label "${it.label}" duplicates another item's label (distinct-items)`);
          affected.push(`/items/${i}/label`);
        }
      });
      return problems.length === 0
        ? { passed: true, message: 'every item has a distinct label after normalisation (distinct-items)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SORT-05', 'semantic', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (gen.groups.length < L.groups.min || gen.groups.length > L.groups.max) {
        problems.push(`groups has ${gen.groups.length} entries, expected ${L.groups.min}-${L.groups.max}`);
        affected.push('/groups');
      }
      if (gen.items.length < L.items.min || gen.items.length > L.items.max) {
        problems.push(`items has ${gen.items.length} entries, expected ${L.items.min}-${L.items.max}`);
        affected.push('/items');
      }
      return problems.length === 0
        ? { passed: true, message: `groups ${gen.groups.length} (${L.groups.min}-${L.groups.max}) and items ${gen.items.length} (${L.items.min}-${L.items.max}) are within the frozen counts (counts-valid)` }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),

    guarded('SORT-06', 'grounding', () => {
      const problems: string[] = [];
      const affected: string[] = [];
      if (typeof gen.title === 'string') {
        const p = numbersCheckProblems('title', gen.title, all);
        if (p.length > 0) { problems.push(...p); affected.push('/title'); }
      }
      gen.groups.forEach((g, i) => {
        const p = numbersCheckProblems(`groups[${i}].label`, g.label, all);
        if (p.length > 0) { problems.push(...p); affected.push(`/groups/${i}/label`); }
      });
      gen.items.forEach((it, i) => {
        const p = numbersCheckProblems(`items[${i}].label`, it.label, [idx.textOf(it.sourceId), ...all]);
        if (p.length > 0) { problems.push(...p); affected.push(`/items/${i}/label`); }
      });
      return problems.length === 0
        ? { passed: true, message: 'every number in group and item labels appears on the cited page or in the same quote (N-01) (numbers-checkable)' }
        : { passed: false, message: problems.join('; '), path: affected[0], affected };
    }),
  ];

  return buildReport('sort-groups-v1', checks, opts.revision ?? 1);
}

/** Design §2.4(f): drop items while >= 6 items and >= 2 items per group remain. */
export function pruneSortItems(gen: SortGroupsGen, sources: SourceDocument[]): PruneResult<SortGroupsGen> {
  const failureMessage = KIT_FAILURE_MESSAGES['sort-groups-v1'] as string;
  let current: SortGroupsGen = { ...gen, groups: [...gen.groups], items: [...gen.items] };
  const dropped: DroppedItem[] = [];
  const originalIndex = current.items.map((_, i) => i);
  for (;;) {
    const report = validateSortGroups(current, sources);
    if (report.publishable) return { gen: current, dropped, failureMessage: null };
    const byItem = itemIndicesWithFailures(report, '/items');
    // Candidates: failing items whose removal keeps the totals and every group minimum alive.
    const candidates = [...byItem.keys()]
      .filter(i => i >= 0 && i < current.items.length)
      .filter(i => {
        if (current.items.length - 1 < L.items.min) return false;
        const groupId = (current.items[i] as { groupId?: string }).groupId;
        const inGroup = current.items.filter(it => it.groupId === groupId).length;
        return inGroup - 1 >= L.minItemsPerGroup;
      });
    if (candidates.length === 0) return { gen: null, dropped, failureMessage };
    candidates.sort((a, b) => (byItem.get(b)?.length ?? 0) - (byItem.get(a)?.length ?? 0) || a - b);
    const i = candidates[0] as number;
    const item = current.items[i] as { id: string };
    const checks = byItem.get(i) ?? [];
    dropped.push({ index: originalIndex[i] as number, id: item.id, reason: `item failed ${checks.join(', ')}`, checks });
    current = { ...current, items: current.items.filter((_, j) => j !== i) };
    originalIndex.splice(i, 1);
  }
}
