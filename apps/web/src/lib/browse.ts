// Stage 10 (docs/specs/STAGE-10-navigation-and-access.md, section B): the library list on the New lesson page and the
// All lessons page. Search is plain: every typed word must appear in the title, the publisher or the subject (case and accents
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
    && matchesQuery(`${s.title} ${sourcePublisher(s.attribution) ?? ''} ${subjectLabel(subjectOf(s))}`, o.query));
  const groups: PageGroup<T>[] = [];
  for (const subject of SUBJECT_ORDER) {
    const items = keep.filter((s) => subjectOf(s) === subject).sort(featuredFirst);
    if (items.length > 0) groups.push({ subject, label: subjectLabel(subject), items });
  }
  return { groups, shown: keep.length, total: library.length };
}

interface JobLike { jobId: string; sourceId: string; createdAt: string; status: string; reviewPublishedAt?: string | undefined }

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

export interface LessonRow<J> {
  jobId: string; sourceId: string; title: string; subject: SubjectKey; job: J;
  /** Stage 10b: when a teacher published this lesson (the "Published" mark), else null. */
  published: string | null;
}

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
    .map((j) => ({ jobId: j.jobId, sourceId: j.sourceId, title: byId.get(j.sourceId)?.title ?? 'A page no longer listed', subject: subjectOfSource(byId, j.sourceId), job: j, published: j.reviewPublishedAt ?? null }))
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

// ---- All lessons: counts, units and what the pages are (Stage 10c slice D, UX review 2 M5) --------------------------------

const num = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Where the pages behind the finished lessons come from: the active library, a teacher's own text, or a page since retired. */
export interface PageBreakdown { pages: number; library: number; own: number; retired: number }

/**
 * The distinct pages with a finished run, split by what the page is now. The library list the New lesson page shows leaves
 * out retired pages, and the sources route does not list them at all, so a page missing from `byId` counts as retired.
 */
export function pageBreakdown(jobs: readonly { sourceId: string; status: string }[], byId: ReadonlyMap<string, { kind?: string | undefined; retired?: boolean | undefined }>): PageBreakdown {
  const ids = new Set(jobs.filter((j) => j.status === 'succeeded').map((j) => j.sourceId));
  const out: PageBreakdown = { pages: ids.size, library: 0, own: 0, retired: 0 };
  for (const id of ids) {
    const s = byId.get(id);
    if (s === undefined || s.retired === true) out.retired += 1;
    else if (s.kind === 'user') out.own += 1;
    else out.library += 1;
  }
  return out;
}

/** The All lessons lede: the totals, and why the page count is higher than the library's. */
export function lessonsLede(finished: number, b: PageBreakdown): string {
  const head = finished === 1 ? '1 finished lesson or activity' : `${num(finished)} finished lessons and activities`;
  const from = `${num(b.pages)} ${plural(b.pages, 'page', 'pages')}`;
  const where = [`${num(b.library)} in the library`, ...(b.own > 0 ? [`${num(b.own)} pasted by a teacher`] : []), ...(b.retired > 0 ? [`${num(b.retired)} since retired from it`] : [])];
  const tail = b.own === 0 && b.retired === 0 ? (b.pages === 1 ? ', in the library' : ', all in the library')
    : `: ${where.length === 1 ? where[0] : `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}`}`;
  return `${head} from ${from}${tail}. Open ${finished === 1 ? 'it' : 'one'} to try its parts, present it, or see how it was built and checked.`;
}

/** What a row of each list is: a page (newest per page), a lesson (every lesson), a run (all runs). */
export function chipUnit(scope: LessonScope): 'page' | 'lesson' | 'run' {
  return scope === 'latest' ? 'page' : scope === 'lessons' ? 'lesson' : 'run';
}

/** The count line above the table: "104 pages · the newest lesson of each", "670 lessons", "746 runs". */
export function rowsCountText(o: { scope: LessonScope; count: number; subjectLabel: string | null; query: string }): string {
  const unit = chipUnit(o.scope);
  const q = o.query.trim();
  const noun = o.count === 0 ? `No ${unit}s` : `${num(o.count)} ${unit}${o.count === 1 ? '' : 's'}`;
  const where = `${o.subjectLabel !== null ? ` in ${o.subjectLabel}` : ''}${q !== '' ? ` matching “${q}”` : ''}`;
  return `${noun}${where}${o.scope === 'latest' && o.count > 0 ? ' · the newest lesson of each' : ''}`;
}

/** What the parts column says: "2 of 3 parts" for a lesson ("1 of 1 part" for one), the activity for a classic run. */
export function partsText(j: { flow?: string | undefined; lesson?: { componentsPublished: number; componentsPlanned: number } | undefined }): string {
  const l = j.lesson;
  if (l !== undefined && l.componentsPlanned > 0) return `${l.componentsPublished} of ${l.componentsPlanned} ${plural(l.componentsPlanned, 'part', 'parts')}`;
  return j.flow === 'activity' ? 'One activity' : '';
}
