import type { Subject } from '../../../../packages/contracts/kit.ts';
import { chipList } from '../lib/subjects.ts';
import type { SubjectCount } from '../lib/subjects.ts';

interface Props {
  /** Non-empty subjects with their counts (subjectCounts). */
  counts: readonly SubjectCount[];
  /** Everything, unfiltered (the "All" chip). */
  total: number;
  active: Subject | null;
  onChange: (subject: Subject | null) => void;
  /** Accessible name of the group, e.g. "Filter pages by subject". */
  label: string;
  /** What is counted, for screen readers: 'page' or 'run'. */
  unit: 'page' | 'run';
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;

/**
 * A compact row of subject filters with counts: "All 41 · Physics 19 · Chemistry 4 …". Toggle buttons (aria-pressed),
 * so Tab reaches each one and Enter/Space switches it; pressing the active subject again shows everything. Subjects
 * with nothing in them are not drawn (except the active one, so it can be switched off). Hidden when there is only
 * one subject to show.
 */
export function SubjectChips({ counts, total, active, onChange, label, unit }: Props) {
  const chips = chipList(counts, active);
  if (chips.length < 2 && active === null) return null;
  return (
    <div className="subject-chips" role="group" aria-label={label}>
      <button type="button" className="subject-chip" aria-pressed={active === null} onClick={() => onChange(null)}>
        All <span className="subject-count" aria-hidden="true">{total}</span>
        <span className="sr-only">, {plural(total, unit)}</span>
      </button>
      {chips.map((c) => (
        <button
          key={c.subject}
          type="button"
          className="subject-chip"
          aria-pressed={active === c.subject}
          onClick={() => onChange(active === c.subject ? null : c.subject)}
        >
          {c.label} <span className="subject-count" aria-hidden="true">{c.count}</span>
          <span className="sr-only">, {plural(c.count, unit)}</span>
        </button>
      ))}
    </div>
  );
}
