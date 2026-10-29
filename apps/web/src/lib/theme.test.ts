/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, THEME_STORAGE_KEY, isTheme, otherTheme, readStoredTheme, themeSwitchLabel, writeStoredTheme } from './theme.ts';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

test('the default theme is dark', () => {
  assert.equal(DEFAULT_THEME, 'dark');
  assert.equal(readStoredTheme(null), 'dark');
  assert.equal(readStoredTheme(memoryStore()), 'dark');
});

test('a stored light or dark choice is read back; anything else falls back to the default', () => {
  assert.equal(readStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'light' })), 'light');
  assert.equal(readStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'dark' })), 'dark');
  assert.equal(readStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'sepia' })), 'dark');
  assert.equal(readStoredTheme(memoryStore({ [THEME_STORAGE_KEY]: 'LIGHT' })), 'dark');
});

test('blocked storage never throws', () => {
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readStoredTheme(blocked), 'dark');
  assert.doesNotThrow(() => writeStoredTheme(blocked, 'light'));
  assert.doesNotThrow(() => writeStoredTheme(null, 'light'));
});

test('writeStoredTheme stores under the shared key (index.html reads the same key before first paint)', () => {
  const store = memoryStore();
  writeStoredTheme(store, 'light');
  assert.equal(store.data.get('mki.theme'), 'light');
  assert.equal(readStoredTheme(store), 'light');
});

test('otherTheme flips and the switch label says what pressing it does', () => {
  assert.equal(otherTheme('dark'), 'light');
  assert.equal(otherTheme('light'), 'dark');
  assert.equal(themeSwitchLabel('dark'), 'Switch to light theme');
  assert.equal(themeSwitchLabel('light'), 'Switch to dark theme');
  assert.equal(isTheme('light'), true);
  assert.equal(isTheme(undefined), false);
});
