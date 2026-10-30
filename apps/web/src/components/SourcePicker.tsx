import { useMemo } from 'react';
import type { Subject } from '../../../../packages/contracts/kit.ts';
import type { SourceMeta } from '../api.ts';
import { shortTitle, sourceOptionLabel, TEACHER_TAG } from '../lib/sources.ts';
import { filterPrompt, groupSources, pickerValue, subjectCounts, subjectOf } from '../lib/subjects.ts';
import { IconChevronDown } from './icons.tsx';
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
  /**
   * The source panel's compact header (slice L): no subject chips, every page in its subject group, and the selected
   * page's short title drawn over the native select so a long title ends in an ellipsis instead of a hard cut.
   */
  compact?: boolean;
}

/**
 * The page picker grouped by subject: subject chips with page counts that narrow the list, then a native select with
 * one group per subject (licensed library pages, titles A–Z) and the teacher's pasted pages in their own group. While
 * the selected page is outside the filter, the select shows a prompt instead of pretending it is selected.
 */
export function SourcePicker({ id, label, sources, selectedId, onSelect, filter, onFilter, disabled = false, compact = false }: Props) {
  const activeFilter = compact ? null : filter;
  const grouped = useMemo(() => groupSources(sources, activeFilter), [sources, activeFilter]);
  const counts = useMemo(() => subjectCounts(sources, subjectOf), [sources]);
  const value = pickerValue(selectedId, grouped.visible);
  const selected = sources.find((s) => s.id === value);
  const select = (
    <select
      id={id}
      className={compact ? 'picker-native' : undefined}
      value={value}
      onChange={(e) => onSelect(e.target.value)}
      disabled={disabled || sources.length === 0}
      title={compact && selected !== undefined ? selected.title : undefined}
    >
      {value === '' && <option value="" disabled>{activeFilter !== null ? filterPrompt(activeFilter, grouped.visible.size) : 'Choose a page'}</option>}
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
  );
  if (compact) {
    return (
      <div className="source-picker source-picker-compact">
        <label htmlFor={id} className="sr-only">{label}</label>
        <div className="picker-face">
          <span className="picker-title" aria-hidden="true">{selected === undefined ? 'Choose a page' : shortTitle(selected.title)}</span>
          <IconChevronDown size={16} />
          {select}
        </div>
      </div>
    );
  }
  return (
    <div className="source-picker">
      <label htmlFor={id} className="field-label">{label}</label>
      <SubjectChips counts={counts} total={grouped.total} active={filter} onChange={onFilter} label="Filter pages by subject" unit="page" />
      {select}
    </div>
  );
}
