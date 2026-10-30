import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { SortGroupsSpec } from '../../../../packages/contracts/kit.ts';
import { assignItem, gradeSort, groupForKey, nextUnassigned, sortPile } from '../lib/sort.ts';
import type { Assignments } from '../lib/sort.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Mark } from './icons.tsx';
import { capitalFirst } from '../lib/displayText.ts';

interface Props { spec: SortGroupsSpec; cite: CiteProps }

/**
 * Sort items into groups. Click a group button, or focus an item and press 1-4 (0 clears). Nothing is graded until the
 * learner commits; then every item shows its right group and the page’s words. No drag-only interaction.
 */
export function SortView({ spec: raw, cite }: Props) {
  // Group and item labels are AI-written: shown in sentence case (symbols and units kept), ids and grading unchanged.
  const spec = useMemo((): SortGroupsSpec => ({
    ...raw,
    groups: raw.groups.map((g) => ({ ...g, label: capitalFirst(g.label) })),
    items: raw.items.map((i) => ({ ...i, label: capitalFirst(i.label) })),
  }), [raw]);
  const helpId = useId();
  const pile = useMemo(() => sortPile(spec), [spec]);
  const items = useMemo(() => new Map(spec.items.map((i) => [i.id, i] as const)), [spec]);
  const groupLabel = useMemo(() => new Map(spec.groups.map((g) => [g.id, g.label] as const)), [spec]);
  const [assign, setAssign] = useState<Assignments>({});
  const [committed, setCommitted] = useState(false);
  const [announce, setAnnounce] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const focusNext = useRef<string | null>(null);
  const grade = useMemo(() => gradeSort(spec, assign), [spec, assign]);
  const results = useMemo(() => new Map(grade.results.map((r) => [r.itemId, r] as const)), [grade]);

  useEffect(() => {
    const id = focusNext.current;
    if (id === null) return;
    focusNext.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"] button`)?.focus();
  }, [assign]);

  const place = (itemId: string, groupId: string | null, viaKey: boolean): void => {
    if (committed) return;
    const next = assignItem(assign, itemId, groupId);
    setAssign(next);
    const label = items.get(itemId)?.label ?? itemId;
    const left = spec.items.length - Object.keys(next).length;
    setAnnounce(groupId === null ? `Cleared “${label}”. ${left} left to sort.` : `Put “${label}” in “${groupLabel.get(groupId) ?? groupId}”. ${left === 0 ? 'Everything is sorted; you can check now.' : `${left} left to sort.`}`);
    if (viaKey && groupId !== null) focusNext.current = nextUnassigned(pile, next, itemId);
  };

  const onKey = (e: KeyboardEvent<HTMLLIElement>, itemId: string): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '0' || e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); place(itemId, null, false); return; }
    const g = groupForKey(spec, e.key);
    if (g !== null) { e.preventDefault(); place(itemId, g, true); }
  };

  const start = (): void => { setAssign({}); setCommitted(false); setAnnounce('Started again. Nothing is sorted.'); };

  return (
    <div className="sort" data-testid="sort">
      <p className="muted small" id={helpId}>
        Put each item in the group the page puts it in. Click a group button, or focus an item and press {spec.groups.length === 1 ? '1' : `1–${spec.groups.length}`} (0 clears it).
        Nothing is checked until you press “Check my sorting”.
      </p>
      <ul className="sort-groups" aria-label="Groups">
        {spec.groups.map((g, gi) => (
          <li key={g.id}><kbd>{gi + 1}</kbd> <strong>{g.label}</strong> <span className="muted small">({grade.results.filter((r) => r.assigned === g.id).length} sorted here)</span></li>
        ))}
      </ul>
      <ol className="sort-list" ref={listRef} aria-describedby={helpId}>
        {pile.map((id) => {
          const item = items.get(id);
          if (item === undefined) return null;
          const r = results.get(id);
          const state = !committed ? '' : r?.correct ? ' sort-ok' : ' sort-miss';
          return (
            <li key={id} data-item-id={id} className={`sort-item${state}`} onKeyDown={(e) => onKey(e, id)}>
              <div className="sort-row">
                <span className="sort-label">
                  {item.label}
                  <span className="sort-now muted small">{assign[id] === undefined ? 'Not sorted yet' : `In: ${groupLabel.get(assign[id] as string) ?? assign[id]}`}</span>
                </span>
                <div className="sort-buttons" role="group" aria-label={`Put “${item.label}” in a group`}>
                  {spec.groups.map((g, gi) => {
                    const on = assign[id] === g.id;
                    return (
                      <button key={g.id} type="button" className={`btn btn-small sort-btn${on ? ' sort-on' : ''}`} aria-pressed={on} disabled={committed} onClick={() => place(id, on ? null : g.id, false)}>
                        <span className="sort-key" aria-hidden="true">{gi + 1}</span> {g.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {committed && r !== undefined && (
                <div className="sort-reveal">
                  <p className={`order-mark ${r.correct ? 'ok' : 'bad'}`}>
                    <Mark kind={r.correct ? 'ok' : 'bad'} />{r.correct ? `Right group: ${groupLabel.get(r.correctGroupId) ?? r.correctGroupId}` : `The page puts this in “${groupLabel.get(r.correctGroupId) ?? r.correctGroupId}”${r.assigned !== null ? `, not “${groupLabel.get(r.assigned) ?? r.assigned}”` : ''}`}
                  </p>
                  <QuoteBlock componentId="sort-groups-v1" part="item" id={id} sourceId={item.sourceId} quote={item.quote} cite={cite} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="order-actions">
        {!committed && (
          <button type="button" className="btn btn-primary" disabled={!grade.allAssigned} onClick={() => { setCommitted(true); setAnnounce(''); }}>Check my sorting</button>
        )}
        {!committed && !grade.allAssigned && <span className="muted small sort-left">{grade.unassigned} {grade.unassigned === 1 ? 'item' : 'items'} still to sort</span>}
        {(committed || Object.keys(assign).length > 0) && <button type="button" className="btn" onClick={start}>Start again</button>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {committed && (
        <div className={`grade ${grade.perfect ? 'grade-ok' : 'grade-miss'}`} role="status">
          <strong>{grade.perfect && <Mark kind="ok" />}{grade.perfect ? `All ${grade.total} items are in the right group.` : `${grade.correctCount} of ${grade.total} items are in the right group.`}</strong>
          <span>The page’s words are shown under each item.</span>
        </div>
      )}
    </div>
  );
}
