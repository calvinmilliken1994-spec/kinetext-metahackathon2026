/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { TECH_STORAGE_KEY, readStoredTech, writeStoredTech } from './techDetails.ts';

function memoryStore(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
}

test('technical details are off on a first visit', () => {
  assert.equal(TECH_STORAGE_KEY, 'mki.techDetails');
  assert.equal(readStoredTech(memoryStore()), false);
  assert.equal(readStoredTech(null), false);
  assert.equal(readStoredTech(memoryStore({ [TECH_STORAGE_KEY]: 'banana' })), false);
});

test('the choice persists like the theme', () => {
  const s = memoryStore();
  writeStoredTech(s, true);
  assert.equal(s.data.get(TECH_STORAGE_KEY), 'on');
  assert.equal(readStoredTech(s), true);
  writeStoredTech(s, false);
  assert.equal(readStoredTech(s), false);
});

test('blocked storage falls back to off and never throws', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readStoredTech(blocked), false);
  assert.doesNotThrow(() => writeStoredTech(blocked, true));
});
