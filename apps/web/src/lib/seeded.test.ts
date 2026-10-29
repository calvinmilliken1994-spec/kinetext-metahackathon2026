/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { seededOrder } from './seeded.ts';

const items = ['a', 'b', 'c', 'd', 'e'];

test('seededOrder is deterministic and keeps every item exactly once', () => {
  const x = seededOrder(items, 'seed-1');
  assert.deepEqual(x, seededOrder(items, 'seed-1'));
  assert.deepEqual([...x].sort(), items);
});

test('seededOrder never mutates its input', () => {
  const copy = [...items];
  seededOrder(copy, 'seed-2');
  assert.deepEqual(copy, items);
});

test('seededOrder never returns the starting order (two or more items), for many seeds', () => {
  for (let i = 0; i < 200; i++) {
    assert.notDeepEqual(seededOrder(items, `s${i}`), items, `seed s${i}`);
    assert.notDeepEqual(seededOrder(['x', 'y'], `s${i}`), ['x', 'y'], `pair seed s${i}`);
  }
});

test('different seeds give different orders', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 30; i++) seen.add(seededOrder(items, `k${i}`).join(''));
  assert.ok(seen.size > 5);
});

test('zero or one item is returned as a copy', () => {
  assert.deepEqual(seededOrder([], 's'), []);
  assert.deepEqual(seededOrder(['only'], 's'), ['only']);
});

test('avoidFirst keeps the named item out of the first position', () => {
  for (let i = 0; i < 200; i++) {
    const out = seededOrder(['right', 'w1', 'w2'], `q${i}`, { avoidFirst: 'right' });
    assert.notEqual(out[0], 'right');
    assert.deepEqual([...out].sort(), ['right', 'w1', 'w2']);
  }
});
