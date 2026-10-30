// Lesson-first layout (slice L, pure): the compact page overview and the collapsible source panel.

/**
 * The overview shows a few short key points up front (the lesson's summary); any further points wait in the fold-out
 * with the key terms, so the first interactive part stays on the first screen.
 */
export function overviewParts<T>(points: readonly T[], max = 4): { lead: T[]; more: T[] } {
  return { lead: points.slice(0, max), more: points.slice(max) };
}

/** localStorage key of the source panel's open/collapsed state (kept across visits, like the theme). */
export const SOURCE_OPEN_KEY = 'mki.sourcePanel';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Open on a first visit; collapsed only when the teacher collapsed it. Blocked storage means it stays open. */
export function readSourceOpen(store: StorageLike | null): boolean {
  if (store === null) return true;
  try { return store.getItem(SOURCE_OPEN_KEY) !== 'closed'; } catch { return true; }
}

export function writeSourceOpen(store: StorageLike | null, open: boolean): void {
  if (store === null) return;
  try { store.setItem(SOURCE_OPEN_KEY, open ? 'open' : 'closed'); } catch { /* blocked storage: the choice lasts for this page */ }
}

/**
 * The source header's one quiet line: the licence, then how many of the lesson's quotes were found in the page text
 * shown. The count is left out while the text is not loaded or when the lesson cites nothing — never a guessed number.
 */
export function sourceMetaLine(input: { licence: string; found: number | null; total: number }): string {
  if (input.found === null || input.total === 0) return input.licence;
  return `${input.licence} · ${input.found} of ${input.total} ${input.total === 1 ? 'quote' : 'quotes'} found`;
}
