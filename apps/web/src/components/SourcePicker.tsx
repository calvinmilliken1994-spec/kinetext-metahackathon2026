import { useMemo, useState } from 'react';
import type { SourceMeta } from '../api.ts';
import { shortTitle, sourceOptionLabel, TEACHER_TAG } from '../lib/sources.ts';
import { filterPrompt, groupSources, pickerValue, showAllLabel } from '../lib/subjects.ts';
import { libraryCounts, teacherNote, toggleSubject } from '../lib/libraryCounts.ts';
import type { SubjectKey } from '../lib/subjects.ts';
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
  filter: SubjectKey | null;
  onFilter: (subject: SubjectKey | null) => void;
  disabled?: boolean;
  /**
   * The source panel's compact header (slice L): no subject chips, every page in its subject group, and the selected
   * page's short title drawn over the native select so a long title ends in an ellipsis instead of a hard cut.
   */
  compact?: boolean;
}

/**
 * The page picker grouped by subject: subject chips with page counts that narrow the list, then a native select with
 * one group per subject (licensed library pages, featured pages first, then titles A–Z) and the teacher's pasted pages
 * in their own group. Stage 7e: in the New lesson picker a subject with featured pages lists only those, with a
 * "Show all physics (13)" toggle under the select; retired pages are never listed or counted, except the page open
 * from an old run, which is offered on its own as a retired page. While the selected page is outside the filter, the
 * select shows a prompt instead of pretending it is selected.
 */
export function SourcePicker({ id, label, sources, selectedId, onSelect, filter, onFilter, disabled = false, compact = false }: Props) {
  const activeFilter = compact ? null : filter;
  const [expanded, setExpanded] = useState<ReadonlySet<SubjectKey>>(() => new Set());
  const grouped = useMemo(
    () => groupSources(sources, activeFilter, { collapse: !compact, expanded, selectedId }),
    [sources, activeFilter, compact, expanded, selectedId],
  );
  // Set B: the chips count licensed library pages only (the tour's number); teacher texts are counted on their own.
  const lib = useMemo(() => libraryCounts(sources), [sources]);
  const value = pickerValue(selectedId, grouped.visible);
  // Set B: the one "Show all" toggle follows the category in play (the chip that is on, else the selected page's subject).
  const toggleFor = compact ? null : toggleSubject(activeFilter, sources, selectedId);
  const toggles = toggleFor === null ? [] : grouped.groups.filter((g) => g.collapsible && g.subject === toggleFor);
  const toggle = (subject: SubjectKey): void => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(subject)) next.delete(subject); else next.add(subject);
    return next;
  });
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
      {grouped.retired !== null && (
        <optgroup label="Retired page (open from an older run)">
          <option value={grouped.retired.id}>{sourceOptionLabel(grouped.retired)}</option>
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
      <SubjectChips counts={lib.counts} total={lib.library} active={filter} onChange={onFilter} label="Filter pages by subject" unit="page" note={teacherNote(lib.teacher)} />
      {select}
      {toggles.length > 0 && (
        <p className="picker-more small">
          {toggles.map((g) => (
            <button key={g.subject} type="button" className="link-btn" aria-expanded={expanded.has(g.subject)} aria-controls={id} onClick={() => toggle(g.subject)}>
              {expanded.has(g.subject) ? `Show featured ${g.label.toLowerCase()} only` : showAllLabel(g)}
            </button>
          ))}
        </p>
      )}
    </div>
  );
}
