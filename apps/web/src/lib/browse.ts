// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the library list on the New lesson page and the
// All lessons page. Search is plain: every typed word must appear in the title or the publisher (case and accents
// ignored). Pure: no React, no DOM.

import { sourcePublisher } from './sources.ts';
import { activeSources, SUBJECT_ORDER, subjectLabel, subjectOf, subjectOfSource } from './subjects.ts';
import type { PickerSource, SubjectKey, Subjected } from './subjects.ts';

const fold = (s: string): string => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Every word of `query` occurs in `text` (an empty query matches everything). */
export function matchesQuery(text: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return true;
  const hay = fold(text);
  return words.every((w) => hay.includes(w));
}

export interface BrowsePage extends PickerSource { attribution?: string | undefined }

export interface PageGroup<T> { subject: SubjectKey; label: string; items: T[] }

const byTitle = (a: { title: string }, b: { title: string }): number => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
const featuredFirst = (a: PickerSource, b: PickerSource): number => Number(b.featured === true) - Number(a.featured === true) || byTitle(a, b);

/** Active library pages, grouped by subject (featured first, then A–Z), narrowed by subject and search. */
export function browsePages<T extends BrowsePage>(sources: readonly T[], o: { query: string; subject: SubjectKey | null }): { groups: PageGroup<T>[]; shown: number; total: number } {
  const library = activeSources(sources).filter((s) => s.kind !== 'user');
  const keep = library.filter((s) => (o.subject === null || subjectOf(s) === o.subject)
    && matchesQuery(`${s.title} ${sourcePublisher(s.attribution) ?? ''}`, o.query));
  const groups: PageGroup<T>[] = [];
  for (const subject of SUBJECT_ORDER) {
    const items = keep.filter((s) => subjectOf(s) === subject).sort(featuredFirst);
    if (items.length > 0) groups.push({ subject, label: subjectLabel(subject), items });
  }
  return { groups, shown: keep.length, total: library.length };
}

interface JobLike { jobId: string; sourceId: string; createdAt: string; status: string }

const newest = (a: JobLike, b: JobLike): number => b.createdAt.localeCompare(a.createdAt);

/** Finished lessons per page: how many, and the newest one to open. */
export function lessonsByPage(jobs: readonly JobLike[]): Map<string, { count: number; latest: string }> {
  const out = new Map<string, { count: number; latest: string }>();
  for (const j of [...jobs].filter((x) => x.status === 'succeeded').sort(newest)) {
    const cur = out.get(j.sourceId);
    out.set(j.sourceId, cur === undefined ? { count: 1, latest: j.jobId } : { count: cur.count + 1, latest: cur.latest });
  }
  return out;
}

/** latest: the newest finished lesson of each page; lessons: every finished lesson; all: every run, failed and declined too. */
export type LessonScope = 'latest' | 'lessons' | 'all';

export interface LessonRow<J> { jobId: string; sourceId: string; title: string; subject: SubjectKey; job: J }

/** Finished lessons (or every run), newest first, narrowed by subject and a search over the page title. */
export function browseLessons<J extends JobLike>(
  jobs: readonly J[], byId: ReadonlyMap<string, Subjected & { title: string }>, o: { query: string; subject: SubjectKey | null; scope: LessonScope },
): LessonRow<J>[] {
  const seen = new Set<string>();
  return [...jobs]
    .filter((j) => o.scope === 'all' || j.status === 'succeeded')
    .sort(newest)
    .filter((j) => {
      if (o.scope !== 'latest') return true;
      if (seen.has(j.sourceId)) return false;
      seen.add(j.sourceId);
      return true;
    })
    .map((j) => ({ jobId: j.jobId, sourceId: j.sourceId, title: byId.get(j.sourceId)?.title ?? 'A page no longer listed', subject: subjectOfSource(byId, j.sourceId), job: j }))
    .filter((r) => (o.subject === null || r.subject === o.subject) && matchesQuery(r.title, o.query));
}

/**
 * The opening of a stored page for the preview: markdown markers dropped (headings, bold), runs of blank lines folded,
 * a first line that repeats `title` dropped, cut at a word boundary to about `max` characters with an ellipsis. Display only; the stored text is never changed.
 */
export function previewExcerpt(text: string, max: number, title?: string): string {
  let clean = text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // The preview sits under the page title: a first line that only repeats it is dropped.
  const first = /^[^\n]*/.exec(clean)?.[0] ?? '';
  if (title !== undefined && first.trim().toLowerCase() === title.trim().toLowerCase()) clean = clean.slice(first.length).trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const at = cut.search(/\s\S*$/);
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}
