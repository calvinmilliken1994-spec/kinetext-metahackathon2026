// Set B (library counts), pure. The New lesson picker counts licensed library pages the same way the tour does (active
// library pages: retired pages and teacher/test texts excluded), so "All 97" matches "97 licensed pages". Teacher
// texts are counted on their own. The "Show all <subject> (N)" toggle follows the category in play: the subject chip
// that is on, else the selected page's subject; never an unrelated subject.

import { activeSources, subjectCounts, subjectOf } from './subjects.ts';
import type { PickerSource, SubjectCount, SubjectKey } from './subjects.ts';

export interface LibraryCounts {
  /** Library pages per subject (non-empty subjects). */
  counts: SubjectCount[];
  /** Active licensed library pages (the tour's count). */
  library: number;
  /** Teacher or test texts, counted separately. */
  teacher: number;
}

export function libraryCounts<T extends PickerSource>(sources: readonly T[]): LibraryCounts {
  const active = activeSources(sources);
  const library = active.filter((s) => s.kind !== 'user');
  return { counts: subjectCounts(library, subjectOf), library: library.length, teacher: active.length - library.length };
}

/** The subject whose "Show all" toggle is offered: the active filter, else the selected page's subject, else none. */
export function toggleSubject<T extends PickerSource>(filter: SubjectKey | null, sources: readonly T[], selectedId: string | null): SubjectKey | null {
  if (filter !== null) return filter;
  const sel = selectedId === null ? undefined : sources.find((s) => s.id === selectedId);
  if (sel === undefined || sel.kind === 'user') return null;
  return subjectOf(sel);
}

/** "2 teacher texts" for the quiet note beside the chips; '' when there are none. */
export function teacherNote(n: number): string {
  return n === 0 ? '' : `+ ${n} teacher ${n === 1 ? 'text' : 'texts'}`;
}
