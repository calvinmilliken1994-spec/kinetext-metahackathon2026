/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import type { SortGroupsSpec } from '../../../../packages/contracts/kit.ts';
import { assignItem, gradeSort, groupForKey, keyForGroup, nextUnassigned, sortPile } from './sort.ts';
import { loadDemoLessons } from './stage6-fixtures.ts';

const gallery = loadDemoLessons().find((l) => l.id === 'gallery');
const spec = Object.values(gallery?.specs ?? {}).find((s) => s.componentId === 'sort-groups-v1') as SortGroupsSpec;
const truth = Object.fromEntries(spec.items.map((i) => [i.id, i.groupId]));

test('the pile is a seeded permutation of the items and not the stored order', () => {
  const pile = sortPile(spec);
  assert.deepEqual([...pile].sort(), spec.items.map((i) => i.id).sort());
  assert.deepEqual(pile, sortPile(spec));
  assert.notDeepEqual(pile, spec.items.map((i) => i.id));
});

test('keys 1..4 map to groups in order; other keys map to nothing', () => {
  assert.equal(groupForKey(spec, '1'), 'heterozygous');
  assert.equal(groupForKey(spec, '2'), 'homozygous');
  assert.equal(groupForKey(spec, '3'), null);
  assert.equal(groupForKey(spec, '0'), null);
  assert.equal(groupForKey(spec, 'a'), null);
  assert.equal(keyForGroup(spec, 'homozygous'), '2');
  assert.equal(keyForGroup(spec, 'missing'), null);
});

test('assigning returns a new record and can be cleared', () => {
  const a0 = {};
  const a1 = assignItem(a0, 'x', 'g1');
  assert.deepEqual(a0, {});
  assert.deepEqual(a1, { x: 'g1' });
  assert.deepEqual(assignItem(a1, 'x', 'g2'), { x: 'g2' });
  assert.deepEqual(assignItem(a1, 'x', null), {});
});

test('grading a perfect sort', () => {
  const g = gradeSort(spec, truth);
  assert.equal(g.perfect, true);
  assert.equal(g.allAssigned, true);
  assert.equal(g.correctCount, spec.items.length);
  assert.equal(g.unassigned, 0);
});

test('grading a partly wrong sort marks each item', () => {
  const first = spec.items[0];
  const a = { ...truth, [first?.id as string]: 'homozygous' };
  const g = gradeSort(spec, a);
  assert.equal(g.perfect, false);
  assert.equal(g.correctCount, spec.items.length - 1);
  const r = g.results.find((x) => x.itemId === first?.id);
  assert.equal(r?.correct, false);
  assert.equal(r?.correctGroupId, 'heterozygous');
});

test('unassigned items are not correct and block the commit', () => {
  const g = gradeSort(spec, {});
  assert.equal(g.allAssigned, false);
  assert.equal(g.unassigned, spec.items.length);
  assert.equal(g.correctCount, 0);
});

test('an assignment to an unknown group is ignored as unassigned', () => {
  const g = gradeSort(spec, { [spec.items[0]?.id as string]: 'nope' });
  assert.equal(g.unassigned, spec.items.length);
});

test('nextUnassigned follows the pile order and wraps', () => {
  const pile = sortPile(spec);
  assert.equal(nextUnassigned(pile, {}, null), pile[0]);
  assert.equal(nextUnassigned(pile, { [pile[0] as string]: 'a' }, pile[0] as string), pile[1]);
  const all = Object.fromEntries(pile.map((id) => [id, 'a']));
  assert.equal(nextUnassigned(pile, all, pile[2] as string), null);
  const lastOpen = Object.fromEntries(pile.slice(1).map((id) => [id, 'a']));
  assert.equal(nextUnassigned(pile, lastOpen, pile[3] as string), pile[0]);
});
