/**
 * Colour theme of the workspace window. Dark is the default (it matches the desktop-app look); a teacher can switch to
 * light, and the choice is kept in localStorage. `prefers-color-scheme` is deliberately not consulted, so a screen
 * recording always opens in the same theme unless someone picked light on that browser.
 *
 * index.html applies the stored theme before the first paint with the same key and rule (keep the two in step).
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'mki.theme';
export const DEFAULT_THEME: Theme = 'dark';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light';
}

/** The stored theme, or the default when nothing (or something unknown) is stored or storage is blocked. */
export function readStoredTheme(store: StorageLike | null): Theme {
  if (store === null) return DEFAULT_THEME;
  try {
    const v = store.getItem(THEME_STORAGE_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeStoredTheme(store: StorageLike | null, theme: Theme): void {
  if (store === null) return;
  try { store.setItem(THEME_STORAGE_KEY, theme); } catch { /* blocked storage: the choice lasts for this page only */ }
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Accessible name of the theme switch: says what pressing it does. */
export function themeSwitchLabel(theme: Theme): string {
  return theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
}
