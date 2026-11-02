// Stage 10c M1 (docs/reviews/ux-pair-review-2-2026-11-02.md): the New lesson library search. A teacher types what the
// page is about ("water"), so the search reads the subject name and the page's curated summary as well as the title
// and publisher; every typed word must match somewhere (case and accents ignored). The grouping and order are
// browsePages' (lib/browse.ts). Pure: no React, no DOM.

import { browsePages, matchesQuery } from './browse.ts';
import type { BrowsePage, PageGroup } from './browse.ts';
import { sourcePublisher } from './sources.ts';
import { subjectLabel, subjectOf } from './subjects.ts';
import type { SubjectKey } from './subjects.ts';

export interface SearchablePage extends BrowsePage { purpose?: string | undefined }

/** What the search reads for one page: title, publisher, subject name and the curated summary (without its "library:" tag). */
export function searchText(s: SearchablePage): string {
  const summary = (s.purpose ?? '').replace(/^\s*library:\s*/i, '');
  return `${s.title} ${sourcePublisher(s.attribution) ?? ''} ${subjectLabel(subjectOf(s))} ${summary}`;
}

export interface LibraryResult<T> { groups: PageGroup<T>[]; shown: number; total: number; ids: ReadonlySet<string> }

/** Active library pages matching the search and subject, grouped by subject; `total` is the whole active library. */
export function librarySearch<T extends SearchablePage>(list: readonly T[], o: { query: string; subject: SubjectKey | null }): LibraryResult<T> {
  const total = browsePages(list, { query: '', subject: null }).total;
  const r = browsePages(list.filter((s) => matchesQuery(searchText(s), o.query)), { query: '', subject: o.subject });
  return { groups: r.groups, shown: r.shown, total, ids: new Set(r.groups.flatMap((g) => g.items.map((s) => s.id))) };
}

/** The chosen page is not among the results (the preview then says so instead of showing a page the list hides). */
export function selectionOutside(selectedId: string | null, r: { ids: ReadonlySet<string> }): boolean {
  return selectedId !== null && !r.ids.has(selectedId);
}
