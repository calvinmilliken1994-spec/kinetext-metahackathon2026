import { useMemo } from 'react';
import type { Subject } from '../../../../packages/contracts/kit.ts';
import type { SourceMeta } from '../api.ts';
import { sourceOptionLabel, TEACHER_TAG } from '../lib/sources.ts';
import { filterPrompt, groupSources, pickerValue, subjectCounts, subjectOf } from '../lib/subjects.ts';
import { SubjectChips } from './SubjectChips.tsx';

interface Props {
  /** id of the <select> (the label points at it). */
  id: string;
  label: string;
  sources: readonly SourceMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The subject filter, shared by every picker and the runs list. */
  filter: Subject | null;
  onFilter: (subject: Subject | null) => void;
  disabled?: boolean;
}

/**
 * The page picker grouped by subject: subject chips with page counts that narrow the list, then a native select with
 * one group per subject (licensed library pages, titles A–Z) and the teacher's pasted pages in their own group. While
 * the selected page is outside the filter, the select shows a prompt instead of pretending it is selected.
 */
export function SourcePicker({ id, label, sources, selectedId, onSelect, filter, onFilter, disabled = false }: Props) {
  const grouped = useMemo(() => groupSources(sources, filter), [sources, filter]);
  const counts = useMemo(() => subjectCounts(sources, subjectOf), [sources]);
  const value = pickerValue(selectedId, grouped.visible);
  return (
    <div className="source-picker">
      <label htmlFor={id} className="field-label">{label}</label>
      <SubjectChips counts={counts} total={grouped.total} active={filter} onChange={onFilter} label="Filter pages by subject" unit="page" />
      <select id={id} value={value} onChange={(e) => onSelect(e.target.value)} disabled={disabled || sources.length === 0}>
        {value === '' && <option value="" disabled>{filter !== null ? filterPrompt(filter, grouped.visible.size) : 'Choose a page'}</option>}
        {grouped.groups.map((g) => (
          <optgroup key={g.subject} label={g.label}>
            {g.items.map((s) => <option key={s.id} value={s.id}>{sourceOptionLabel(s)}</option>)}
          </optgroup>
        ))}
        {grouped.teacher.length > 0 && (
          <optgroup label={`${TEACHER_TAG}s (pasted)`}>
            {grouped.teacher.map((s) => <option key={s.id} value={s.id}>{sourceOptionLabel(s)}</option>)}
          </optgroup>
        )}
      </select>
    </div>
  );
}
