// Stage 7b (docs/specs/STAGE-7b-subjects.md): the source library grouped by subject (pure).
// Library pages carry a curated subject; teacher pages may carry the subject Muse detected in their latest lesson
// analysis (subjectSource 'muse'). A missing or unknown subject files the page under Other.

import { isSubject } from '../../../../packages/contracts/kit.ts';
import type { Subject } from '../../../../packages/contracts/kit.ts';

/** Display order: sciences first, then money, the humanities, and Other last. */
export const SUBJECT_ORDER: readonly Subject[] = [
  'physics', 'maths', 'chemistry', 'biology', 'earth-science', 'finance', 'history', 'civics', 'language-reading', 'other',
];

/** Plain names a teacher would use. */
export const SUBJECT_LABELS: Readonly<Record<Subject, string>> = {
  physics: 'Physics',
  maths: 'Maths',
  chemistry: 'Chemistry',
  biology: 'Biology',
  'earth-science': 'Earth & space',
  finance: 'Finance',
  history: 'History',
  civics: 'Civics',
  'language-reading': 'Language & reading',
  other: 'Other',
};

export function subjectLabel(s: Subject): string {
  return SUBJECT_LABELS[s];
}

export interface Subjected { subject?: unknown }

/** The page's subject, or 'other' when it has none (or one we do not know). */
export function subjectOf(m: Subjected): Subject {
  return isSubject(m.subject) ? m.subject : 'other';
}

export interface SubjectCount { subject: Subject; label: string; count: number }

/** How many items fall under each subject, in subject order; subjects with nothing are left out. */
export function subjectCounts<T>(items: readonly T[], of: (t: T) => Subject): SubjectCount[] {
  const n = new Map<Subject, number>();
  for (const item of items) {
    const s = of(item);
    n.set(s, (n.get(s) ?? 0) + 1);
  }
  return SUBJECT_ORDER.filter((s) => (n.get(s) ?? 0) > 0).map((s) => ({ subject: s, label: SUBJECT_LABELS[s], count: n.get(s) ?? 0 }));
}

/** The chips to draw: the non-empty subjects, plus the active one even when it is empty, so it can be switched off. */
export function chipList(counts: readonly SubjectCount[], active: Subject | null): readonly SubjectCount[] {
  if (active === null || counts.some((c) => c.subject === active)) return counts;
  const withActive = [...counts, { subject: active, label: SUBJECT_LABELS[active], count: 0 }];
  return withActive.sort((a, b) => SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject));
}

export interface PickerSource extends Subjected { id: string; title: string; kind?: 'library' | 'user' | undefined }

export interface SourceGroup<T> { subject: Subject; label: string; items: T[] }

export interface GroupedSources<T> {
  /** Library pages by subject (subject order, titles A–Z), only the filtered subject when a filter is on. */
  groups: SourceGroup<T>[];
  /** Teacher-pasted pages (kept apart from the licensed library), filtered by their Muse-detected subject. */
  teacher: T[];
  /** Ids of every page the picker shows. */
  visible: Set<string>;
  /** All pages, before filtering. */
  total: number;
}

const byTitle = (a: { title: string }, b: { title: string }): number => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });

export function groupSources<T extends PickerSource>(sources: readonly T[], filter: Subject | null): GroupedSources<T> {
  const keep = (s: T): boolean => filter === null || subjectOf(s) === filter;
  const library = sources.filter((s) => s.kind !== 'user' && keep(s));
  const teacher = sources.filter((s) => s.kind === 'user' && keep(s));
  const groups: SourceGroup<T>[] = [];
  for (const subject of SUBJECT_ORDER) {
    const items = library.filter((s) => subjectOf(s) === subject).sort(byTitle);
    if (items.length > 0) groups.push({ subject, label: SUBJECT_LABELS[subject], items });
  }
  const visible = new Set<string>([...library, ...teacher].map((s) => s.id));
  return { groups, teacher, visible, total: sources.length };
}

/** The select's value: the selected page when the filtered list shows it, else '' (the filter prompt). */
export function pickerValue(selectedId: string | null, visible: ReadonlySet<string>): string {
  return selectedId !== null && visible.has(selectedId) ? selectedId : '';
}

/** The disabled first option shown while the selected page is outside the filter. */
export function filterPrompt(subject: Subject, count: number): string {
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
export function subjectOfSource(byId: ReadonlyMap<string, Subjected>, sourceId: string): Subject {
  const s = byId.get(sourceId);
  return s === undefined ? 'other' : subjectOf(s);
}

export function filterRuns<T extends { sourceId: string }>(jobs: readonly T[], byId: ReadonlyMap<string, Subjected>, filter: Subject | null): T[] {
  return filter === null ? [...jobs] : jobs.filter((j) => subjectOfSource(byId, j.sourceId) === filter);
}
