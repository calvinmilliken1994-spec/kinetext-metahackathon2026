import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { TimelineEvent } from '../../../../packages/contracts/index.ts';
import { formatEventDate, gradeOrder, hasUnorderedPair, moveItem, seededShuffle } from '../lib/timeline.ts';
import type { OrderGrade } from '../lib/timeline.ts';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';

interface Props {
  events: readonly TimelineEvent[];
  /** Seed for the starting shuffle (the spec id), so a lecture demo starts the same way every time. */
  seed: string;
  /** Dates and quotes are shown on the cards once the order was checked (or the teacher revealed the timeline). */
  revealed: boolean;
  onCheck: () => void;
  cite: CiteProps;
}

function summaryOf(g: OrderGrade): string {
  if (g.correct) return `✓ Correct — all ${g.total} events are in the right order.`;
  return `✗ ${g.rightCount} of ${g.total} events are in the right place. The marked cards are not where the dates put them — move them and check again.`;
}

/** "Put these events in order": drag cards, or use the Up/Down buttons (keyboard and screen-reader friendly), then check against the dates. */
export function OrderActivity({ events, seed, revealed, onCheck, cite }: Props) {
  const headingId = useId();
  const hintId = useId();
  const startOrder = useMemo(() => seededShuffle(events, seed).map((e) => e.id), [events, seed]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e] as const)), [events]);
  const [order, setOrder] = useState<string[]>(startOrder);
  const [grade, setGrade] = useState<OrderGrade | null>(null);
  const [announce, setAnnounce] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const focusAfter = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);
  const n = order.length;

  // A move changes what the learner would submit, so an earlier result no longer describes the list.
  const place = (next: string[], movedId: string): void => {
    setOrder(next);
    setGrade(null);
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
    const g = gradeOrder(events, order);
    setGrade(g);
    setAnnounce('');
    onCheck();
  };

  const reset = (): void => {
    setOrder(startOrder);
    setGrade(null);
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

  const ties = hasUnorderedPair(events);

  return (
    <section className="card order-activity" aria-labelledby={headingId} data-testid="order-activity">
      <h3 id={headingId}>Put these events in order</h3>
      <p className="muted small" id={hintId}>
        Earliest first. Drag a card, or use its Up and Down buttons. The dates stay hidden until you check.
        {ties && ' Some dates are less exact than others (for example “1776” and “July 4, 1776”), so either order is accepted between those events.'}
      </p>
      <ol className="order-list" ref={listRef} aria-describedby={hintId}>
        {order.map((id, i) => {
          const e = byId.get(id);
          if (e === undefined) return null;
          const mark = grade === null ? null : grade.positions[i] === true;
          return (
            <li
              key={id}
              data-event-id={id}
              className={`order-item${mark === true ? ' order-ok' : mark === false ? ' order-miss' : ''}${dragId === id ? ' order-dragging' : ''}${overIndex === i && dragId !== null && dragId !== id ? ' order-over' : ''}`}
              draggable
              onDragStart={(ev) => onDragStart(ev, id)}
              onDragOver={(ev) => onDragOver(ev, i)}
              onDrop={(ev) => onDrop(ev, i)}
              onDragEnd={endDrag}
            >
              <span className="order-pos" aria-hidden="true">{i + 1}</span>
              <div className="order-body">
                <p className="order-label">
                  <span className="order-grip" aria-hidden="true" title="Drag to move">⠿</span>
                  <strong>{e.label}</strong>
                  <span className="sr-only"> (position {i + 1} of {n})</span>
                </p>
                {mark !== null && (
                  <p className={`order-mark ${mark ? 'ok' : 'bad'}`}>{mark ? '✓ Right place' : '✗ Not the right place'}</p>
                )}
                {revealed && (
                  <div className="order-reveal">
                    <p className="order-date">{formatEventDate(e)}</p>
                    <EventEvidence event={e} cite={cite} />
                  </div>
                )}
              </div>
              <div className="order-buttons">
                <button type="button" className="btn btn-small" data-dir="up" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move “${e.label}” up`}>
                  <span aria-hidden="true">↑</span> Up
                </button>
                <button type="button" className="btn btn-small" data-dir="down" disabled={i === n - 1} onClick={() => move(id, 1)} aria-label={`Move “${e.label}” down`}>
                  <span aria-hidden="true">↓</span> Down
                </button>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="order-actions">
        <button type="button" className="btn btn-primary" onClick={check}>Check order</button>
        <button type="button" className="btn" onClick={reset}>Back to the starting order</button>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {grade !== null && (
        <div className={`grade ${grade.correct ? 'grade-ok' : 'grade-miss'}`} role="status" data-testid="order-result">
          <strong>{summaryOf(grade)}</strong>
          <span>The dates and quotes are now shown on each card.</span>
        </div>
      )}
    </section>
  );
}
