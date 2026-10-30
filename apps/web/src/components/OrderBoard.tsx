import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { moveItem } from '../lib/timeline.ts';
import { IconChevronDown, IconChevronUp, IconGrip, Mark } from './icons.tsx';
import { splitMark } from '../lib/marks.ts';

export interface BoardItem { id: string; label: string }

/** What a check tells the board: one mark per list position, plus the summary line. */
export interface BoardResult {
  correct: boolean;
  summary: string;
  marks: { ok: boolean; text: string }[];
}

interface Props<T extends BoardItem> {
  items: readonly T[];
  /** Item ids in the starting order (a seeded shuffle that is not the answer). */
  startOrder: readonly string[];
  heading: string;
  hint: ReactNode;
  /** Shown under the result line. */
  resultNote: string;
  /** Items show their reveal (dates, quotes) once the order was checked or the teacher revealed everything. */
  revealed: boolean;
  renderReveal: (item: T) => ReactNode;
  grade: (order: string[]) => BoardResult;
  onCheck: () => void;
  checkLabel?: string;
  /** 'track': the list is drawn as numbered stations on one vertical line (sequence and timeline boards). */
  variant?: 'cards' | 'track';
}

/**
 * “Put these in order”: drag cards, or use each card's Up and Down buttons (keyboard and screen-reader friendly), then check.
 * Shared by the timeline activity (graded against dates) and the sequence component (graded against the page's order).
 */
export function OrderBoard<T extends BoardItem>({ items, startOrder, heading, hint, resultNote, revealed, renderReveal, grade: gradeFn, onCheck, checkLabel = 'Check order', variant = 'cards' }: Props<T>) {
  const headingId = useId();
  const hintId = useId();
  const byId = new Map(items.map((e) => [e.id, e] as const));
  const [order, setOrder] = useState<string[]>([...startOrder]);
  const [result, setResult] = useState<BoardResult | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const n = order.length;

  // A move changes what the learner would submit, so an earlier result no longer describes the list.
  const place = (next: string[], movedId: string): void => {
    setOrder(next);
    setResult(null);
    const label = byId.get(movedId)?.label ?? movedId;
    setAnnounce(`Moved “${label}” to position ${next.indexOf(movedId) + 1} of ${n}.`);
  };

  const move = (id: string, delta: -1 | 1): void => {
    const from = order.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= n) return;
    focusAfter.current = { id, dir: delta < 0 ? 'up' : 'down' };
    place(moveItem(order, from, to), id);
  };

  // Keep keyboard focus on the card that was moved (React re-orders DOM nodes, which can drop focus).
  useEffect(() => {
    const want = focusAfter.current;
    if (want === null) return;
    focusAfter.current = null;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-event-id="${CSS.escape(want.id)}"]`);
    const pick = (dir: string): HTMLButtonElement | null | undefined => item?.querySelector<HTMLButtonElement>(`button[data-dir="${dir}"]`);
    const first = pick(want.dir);
    const other = pick(want.dir === 'up' ? 'down' : 'up');
    (first !== null && first !== undefined && !first.disabled ? first : other)?.focus();
  }, [order]);

  const check = (): void => {
    setResult(gradeFn(order));
    setAnnounce('');
    onCheck();
  };

  const reset = (): void => {
    setOrder([...startOrder]);
    setResult(null);
    setAnnounce('Cards put back in their starting order.');
  };

  const endDrag = (): void => { setDragId(null); setOverIndex(null); };

  const onDragStart = (e: DragEvent<HTMLLIElement>, id: string): void => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    setDragId(id);
  };
  const onDragOver = (e: DragEvent<HTMLLIElement>, index: number): void => {
    if (dragId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overIndex !== index) setOverIndex(index);
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, index: number): void => {
    e.preventDefault();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    const from = order.indexOf(id);
    endDrag();
    if (from < 0 || from === index) return;
    place(moveItem(order, from, index), id);
  };

  return (
    <section className={`card order-activity${variant === 'track' ? ' order-track' : ''}`} aria-labelledby={headingId} data-testid="order-activity">
      <h3 id={headingId}>{heading}</h3>
      <p className="muted small" id={hintId}>{hint}</p>
      <ol className="order-list" ref={listRef} aria-describedby={hintId}>
        {order.map((id, i) => {
          const e = byId.get(id);
          if (e === undefined) return null;
          const mark = result?.marks[i] ?? null;
          return (
            <li
              key={id}
              data-event-id={id}
              className={`order-item${mark === null ? '' : mark.ok ? ' order-ok' : ' order-miss'}${dragId === id ? ' order-dragging' : ''}${overIndex === i && dragId !== null && dragId !== id ? ' order-over' : ''}`}
              draggable
              onDragStart={(ev) => onDragStart(ev, id)}
              onDragOver={(ev) => onDragOver(ev, i)}
              onDrop={(ev) => onDrop(ev, i)}
              onDragEnd={endDrag}
            >
              <span className="order-pos" aria-hidden="true">{variant === 'track' ? i + 1 : `${i + 1}.`}</span>
              <div className="order-body">
                <p className="order-label">
                  <span className="order-grip" title="Drag to move"><IconGrip /></span>
                  <strong>{e.label}</strong>
                  <span className="sr-only"> (position {i + 1} of {n})</span>
                </p>
                {mark !== null && <p className={`order-mark ${mark.ok ? 'ok' : 'bad'}`}><Mark kind={mark.ok ? 'ok' : 'bad'} />{splitMark(mark.text).text}</p>}
                {revealed && <div className="order-reveal">{renderReveal(e)}</div>}
              </div>
              <div className="order-buttons">
                <button type="button" className="btn btn-small" data-dir="up" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move “${e.label}” up`}>
                  <IconChevronUp /> Up
                </button>
                <button type="button" className="btn btn-small" data-dir="down" disabled={i === n - 1} onClick={() => move(id, 1)} aria-label={`Move “${e.label}” down`}>
                  <IconChevronDown /> Down
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="order-actions">
        <button type="button" className="btn btn-primary" onClick={check}>{checkLabel}</button>
        <button type="button" className="btn" onClick={reset}>Back to the starting order</button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {result !== null && (
        <div className={`grade ${result.correct ? 'grade-ok' : 'grade-miss'}`} role="status" data-testid="order-result">
          <strong>{splitMark(result.summary).mark !== null && <Mark kind={splitMark(result.summary).mark ?? 'ok'} />}{splitMark(result.summary).text}</strong>
          <span>{resultNote}</span>
        </div>
      )}
    </section>
  );
}
