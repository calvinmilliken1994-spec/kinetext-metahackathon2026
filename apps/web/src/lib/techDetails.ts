/**
 * "Show technical details" in the runs drawer (ids, tokens, model strings). Off on a first visit, so a teacher sees
 * plain wording; the choice is kept in localStorage like the colour theme (lib/theme.ts), and blocked storage simply
 * means it lasts for the page.
 */
export const TECH_STORAGE_KEY = 'mki.techDetails';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readStoredTech(store: StorageLike | null): boolean {
  if (store === null) return false;
  try { return store.getItem(TECH_STORAGE_KEY) === 'on'; } catch { return false; }
}

export function writeStoredTech(store: StorageLike | null, on: boolean): void {
  if (store === null) return;
  try { store.setItem(TECH_STORAGE_KEY, on ? 'on' : 'off'); } catch { /* blocked storage: the choice lasts for this page only */ }
}
