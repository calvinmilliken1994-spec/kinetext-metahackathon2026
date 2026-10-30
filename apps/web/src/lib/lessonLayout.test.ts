/// <reference types="node" />
// Lesson-first slice L: the compact overview and the collapsible source panel (pure parts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { overviewParts, readSourceOpen, SOURCE_OPEN_KEY, sourceMetaLine, writeSourceOpen } from './lessonLayout.ts';

class MemStore {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
}

test('overviewParts shows at most four key points up front and keeps the rest for the fold-out', () => {
  assert.deepEqual(overviewParts([1, 2, 3]), { lead: [1, 2, 3], more: [] });
  assert.deepEqual(overviewParts([1, 2, 3, 4]), { lead: [1, 2, 3, 4], more: [] });
  assert.deepEqual(overviewParts([1, 2, 3, 4, 5, 6]), { lead: [1, 2, 3, 4], more: [5, 6] });
  assert.deepEqual(overviewParts([1, 2, 3, 4, 5], 3), { lead: [1, 2, 3], more: [4, 5] });
  assert.deepEqual(overviewParts([]), { lead: [], more: [] });
});

test('the source panel is open on a first visit and its collapsed state is kept', () => {
  const store = new MemStore();
  assert.equal(readSourceOpen(store), true);
  writeSourceOpen(store, false);
  assert.equal(store.getItem(SOURCE_OPEN_KEY), 'closed');
  assert.equal(readSourceOpen(store), false);
  writeSourceOpen(store, true);
  assert.equal(readSourceOpen(store), true);
});

test('blocked or missing storage leaves the source panel open and never throws', () => {
  assert.equal(readSourceOpen(null), true);
  const blocked = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: (): void => { throw new Error('blocked'); } };
  assert.equal(readSourceOpen(blocked), true);
  assert.doesNotThrow(() => writeSourceOpen(blocked, false));
  writeSourceOpen(null, false);
});

test('sourceMetaLine is one quiet line: licence and quote count, never a guessed number', () => {
  assert.equal(sourceMetaLine({ licence: 'US-Gov-Work', found: 20, total: 20 }), 'US-Gov-Work · 20 of 20 quotes found');
  assert.equal(sourceMetaLine({ licence: 'US-Gov-Work', found: 1, total: 1 }), 'US-Gov-Work · 1 of 1 quote found');
  assert.equal(sourceMetaLine({ licence: 'CC BY 4.0', found: null, total: 0 }), 'CC BY 4.0');
  assert.equal(sourceMetaLine({ licence: 'CC BY 4.0', found: 3, total: 0 }), 'CC BY 4.0');
});
