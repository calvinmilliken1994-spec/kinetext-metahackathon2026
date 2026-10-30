// Stage 7b (docs/specs/STAGE-7b-subjects.md): the source library grouped by subject (pure).
// Library pages carry a curated subject; teacher pages may carry the subject Muse detected in their latest lesson
// analysis (subjectSource 'muse'). A missing or unknown subject files the page under Other.
// Stage 7e (docs/specs/STAGE-7e-library-and-wording.md): featured pages come first in their subject (a subject with
// featured pages can collapse to them, with a "Show all" toggle); retired pages leave the picker and the counts but keep
// their titles for old runs. The coming `computing` subject has its place and name here already; until the contracts
// list it, a page saying 'computing' reads as Other like any unknown subject.

import { isSubject } from '../../../../packages/contracts/kit.ts';
import type { Subject } from '../../../../packages/contracts/kit.ts';

/** Every subject the picker can show: the contracts' SUBJECTS plus `computing`, which lands there separately. */
export type SubjectKey = Subject | 'computing';

/** Display order: sciences first, then money, the humanities, and Other last. */
export const SUBJECT_ORDER: readonly SubjectKey[] = [
  'physics', 'maths', 'computing', 'chemistry', 'biology', 'earth-science', 'finance', 'history', 'civics', 'language-reading', 'other',
];

/** Plain names a teacher would use. */
export const SUBJECT_LABELS: Readonly<Record<SubjectKey, string>> = {
  physics: 'Physics',
  maths: 'Maths',
  computing: 'Computing & AI',
  chemistry: 'Chemistry',
  biology: 'Biology',
  'earth-science': 'Earth & space',
  finance: 'Finance',
  history: 'History',
  civics: 'Civics',
  'language-reading': 'Language & reading',
  other: 'Other',
};

export function subjectLabel(s: SubjectKey): string {
  return SUBJECT_LABELS[s] ?? SUBJECT_LABELS.other;
}

export interface Subjected { subject?: unknown }

/** The page's subject, or 'other' when it has none (or one the contracts do not list yet). */
export function subjectOf(m: Subjected): SubjectKey {
  return isSubject(m.subject) && (SUBJECT_ORDER as readonly string[]).includes(m.subject) ? m.subject : 'other';
}

export interface SubjectCount { subject: SubjectKey; label: string; count: number }

/** How many items fall under each subject, in subject order; subjects with nothing are left out. */
export function subjectCounts<T>(items: readonly T[], of: (t: T) => SubjectKey): SubjectCount[] {
  const n = new Map<SubjectKey, number>();
  for (const item of items) {
    const s = of(item);
    n.set(s, (n.get(s) ?? 0) + 1);
  }
  return SUBJECT_ORDER.filter((s) => (n.get(s) ?? 0) > 0).map((s) => ({ subject: s, label: SUBJECT_LABELS[s], count: n.get(s) ?? 0 }));
}

/** The chips to draw: the non-empty subjects, plus the active one even when it is empty, so it can be switched off. */
export function chipList(counts: readonly SubjectCount[], active: SubjectKey | null): readonly SubjectCount[] {
  if (active === null || counts.some((c) => c.subject === active)) return counts;
  const withActive = [...counts, { subject: active, label: SUBJECT_LABELS[active], count: 0 }];
  return withActive.sort((a, b) => SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject));
}

export interface PickerSource extends Subjected {
  id: string; title: string; kind?: 'library' | 'user' | undefined;
  /** Stage 7e: shown first in its subject. */
  featured?: unknown;
  /** Stage 7e: left out of the picker and the counts (still loadable by id for old runs). */
  retired?: unknown;
}

/** A retired library page (only a literal `true` counts). */
export function isRetiredPage(m: { retired?: unknown }): boolean {
  return m.retired === true;
}

const isFeaturedPage = (m: { featured?: unknown }): boolean => m.featured === true;

/** The pages a teacher can pick: everything except retired library pages. */
export function activeSources<T extends PickerSource>(sources: readonly T[]): T[] {
  return sources.filter((s) => !isRetiredPage(s));
}

export interface SourceGroup<T> {
  subject: SubjectKey; label: string;
  /** The pages shown: featured first (A–Z), then the rest (A–Z); only the featured ones (and the selected page) when collapsed. */
  items: T[];
  /** Active pages of this subject that the collapsed list leaves out (0 when nothing is hidden). */
  hidden: number;
  /** Active pages of this subject in all. */
  size: number;
  /** True when this subject has featured pages and other pages, so it can collapse to the featured ones. */
  collapsible: boolean;
}

export interface GroupedSources<T> {
  /** Library pages by subject (subject order, featured first), only the filtered subject when a filter is on. */
  groups: SourceGroup<T>[];
  /** Teacher-pasted pages (kept apart from the licensed library), filtered by their Muse-detected subject. */
  teacher: T[];
  /** The selected page when it is a retired library page (opened from an old run); never counted. */
  retired: T | null;
  /** Ids of every page the picker shows. */
  visible: Set<string>;
  /** All active pages, before filtering. */
  total: number;
}

export interface GroupOptions {
  /** Collapse each subject that has featured pages to those pages (the New lesson picker). */
  collapse?: boolean;
  /** Subjects the teacher opened with "Show all". */
  expanded?: ReadonlySet<SubjectKey>;
  /** The selected page always stays in the list. */
  selectedId?: string | null;
}

const byTitle = (a: { title: string }, b: { title: string }): number => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
const featuredFirst = (a: PickerSource, b: PickerSource): number => Number(isFeaturedPage(b)) - Number(isFeaturedPage(a)) || byTitle(a, b);

export function groupSources<T extends PickerSource>(sources: readonly T[], filter: SubjectKey | null, opts: GroupOptions = {}): GroupedSources<T> {
  const selectedId = opts.selectedId ?? null;
  const active = activeSources(sources);
  const keep = (s: T): boolean => filter === null || subjectOf(s) === filter;
  const library = active.filter((s) => s.kind !== 'user' && keep(s));
  const teacher = active.filter((s) => s.kind === 'user' && keep(s));
  const groups: SourceGroup<T>[] = [];
  for (const subject of SUBJECT_ORDER) {
    const all = library.filter((s) => subjectOf(s) === subject).sort(featuredFirst);
    if (all.length === 0) continue;
    const featured = all.filter(isFeaturedPage);
    const collapsible = featured.length > 0 && featured.length < all.length;
    const collapsed = opts.collapse === true && collapsible && opts.expanded?.has(subject) !== true;
    const items = collapsed ? all.filter((s) => isFeaturedPage(s) || s.id === selectedId) : all;
    groups.push({ subject, label: subjectLabel(subject), items, hidden: all.length - items.length, size: all.length, collapsible });
  }
  const shown = [...groups.flatMap((g) => g.items), ...teacher];
  const retired = selectedId === null ? null : sources.find((s) => s.id === selectedId && isRetiredPage(s)) ?? null;
  const visible = new Set<string>([...shown, ...(retired === null ? [] : [retired])].map((s) => s.id));
  return { groups, teacher, retired, visible, total: active.length };
}

/** The toggle under a collapsed subject: 'Show all physics (13)'. */
export function showAllLabel(g: Pick<SourceGroup<unknown>, 'label' | 'size'>): string {
  return `Show all ${g.label.toLowerCase()} (${g.size})`;
}

/** The quiet tag on a run of a retired page (the page is no longer in the picker). */
export function retiredRunNote(byId: ReadonlyMap<string, PickerSource>, sourceId: string): string | null {
  const s = byId.get(sourceId);
  return s !== undefined && isRetiredPage(s) ? 'Retired page' : null;
}

/** The select's value: the selected page when the filtered list shows it, else '' (the filter prompt). */
export function pickerValue(selectedId: string | null, visible: ReadonlySet<string>): string {
  return selectedId !== null && visible.has(selectedId) ? selectedId : '';
}

/** The disabled first option shown while the selected page is outside the filter. */
export function filterPrompt(subject: SubjectKey, count: number): string {
  const label = SUBJECT_LABELS[subject];
  if (count === 0) return `No ${label} pages`;
  if (count === 1) return `Choose the ${label} page`;
  return `Choose one of ${count} ${label} pages`;
}

export interface SubjectNoteSource extends Subjected { kind?: 'library' | 'user' | undefined; subjectSource?: 'curated' | 'muse' | undefined }

/**
 * The quiet subject label on the lesson header. Library pages show their curated subject; teacher pages show the
 * subject Muse detected, said so. Nothing when the subject is unknown (no "Other" label on a lesson).
 */
export function subjectNote(m: SubjectNoteSource | null | undefined): { text: string; detected: boolean } | null {
  if (m === null || m === undefined || !isSubject(m.subject)) return null;
  const label = SUBJECT_LABELS[m.subject];
  if (m.kind === 'user') return { text: `${label} · detected by Muse`, detected: true };
  return { text: label, detected: false };
}

/** A run's subject is its page's subject; runs of pages no longer listed read as other. */
export function subjectOfSource(byId: ReadonlyMap<string, Subjected>, sourceId: string): SubjectKey {
  const s = byId.get(sourceId);
  return s === undefined ? 'other' : subjectOf(s);
}

export function filterRuns<T extends { sourceId: string }>(jobs: readonly T[], byId: ReadonlyMap<string, Subjected>, filter: SubjectKey | null): T[] {
  return filter === null ? [...jobs] : jobs.filter((j) => subjectOfSource(byId, j.sourceId) === filter);
}
