import { useEffect, useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { moveItem } from '../lib/timeline.ts';
import { IconChevronDown, IconChevronUp, IconGrip, Mark } from './icons.tsx';
import { splitMark } from '../lib/marks.ts';
import { Linked } from './Linked.tsx';
import { afterOrderCheck, offerShowOrder, resultNoteShown, SHOW_ORDER_LABEL } from '../lib/orderReveal.ts';

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
  /** Shown under the result line once the page's order is revealed (it points at what the reveal added). */
  resultNote: string;
  /** Items show their reveal (dates, quotes) once the page's order is revealed (lib/orderReveal.ts). */
  revealed: boolean;
  renderReveal: (item: T) => ReactNode;
  grade: (order: string[]) => BoardResult;
  /**
   * Reveal the page's order: called when a check finds the order right, or when the learner presses "Show the page's
   * order" (offered from the first wrong check on). A wrong check alone reveals nothing (UX pair review 2, H1; Q4).
   */
  onReveal: () => void;
  checkLabel?: string;
  /** 'track': the list is drawn as numbered stations on one vertical line (sequence and timeline boards). */
  variant?: 'cards' | 'track';
  /**
   * Presentation layout: every card's mark and reveal, and the result line, are laid out from the start (hidden), so
   * "Check order" fills them in place and moves no card (Δy = 0).
   */
  reserve?: boolean;
  /** Link keys per item once revealed (hover shows the page's words in presentation's quote zone). */
  linksOf?: (item: T) => string[];
}

/**
 * “Put these in order”: drag cards, or use each card's move-up and move-down arrows (keyboard and screen-reader friendly), then check.
 * Shared by the timeline activity (graded against dates) and the sequence component (graded against the page's order).
 */
export function OrderBoard<T extends BoardItem>({ items, startOrder, heading, hint, resultNote, revealed, renderReveal, grade: gradeFn, onReveal, checkLabel = 'Check order', variant = 'cards', reserve = false, linksOf }: Props<T>) {
  const headingId = useId();
  const hintId = useId();
  const byId = new Map(items.map((e) => [e.id, e] as const));
  const [order, setOrder] = useState<string[]>([...startOrder]);
  const [result, setResult] = useState<BoardResult | null>(null);
  // A wrong check has happened: from then on the page's order can be asked for.
  const [missed, setMissed] = useState(false);
  const checkRef = useRef<HTMLButtonElement>(null);
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
    const graded = gradeFn(order);
    setResult(graded);
    setAnnounce('');
    const next = afterOrderCheck({ correct: graded.correct, revealed, missed });
    setMissed(next.missed);
    if (next.reveal) onReveal();
  };

  const offered = offerShowOrder({ missed, revealed });
  const noteOn = resultNoteShown({ revealed });
  const showOrder = (): void => {
    onReveal();
    setAnnounce(`The page’s order is shown. ${resultNote}`);
    // The button goes once the order is shown: keep keyboard focus in the board.
    checkRef.current?.focus({ preventScroll: true });
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
          const itemClass = `order-item${mark === null ? '' : mark.ok ? ' order-ok' : ' order-miss'}${dragId === id ? ' order-dragging' : ''}${overIndex === i && dragId !== null && dragId !== id ? ' order-over' : ''}`;
          const body = (
            <>
              <span className="order-pos" aria-hidden="true">{variant === 'track' ? i + 1 : `${i + 1}.`}</span>
              <div className="order-body">
                <p className="order-label">
                  <span className="order-grip" title="Drag to move"><IconGrip /></span>
                  <strong>{e.label}</strong>
                  <span className="sr-only"> (position {i + 1} of {n})</span>
                </p>
                {reserve
                  ? (
                    // Presentation: the mark and the reveal are laid out from the start (hidden), so checking moves no card.
                    <div className="order-reserve">
                      <p className={`order-mark ${mark === null || mark.ok ? 'ok' : 'bad'}`} data-on={mark === null ? 'false' : 'true'} aria-hidden={mark === null ? true : undefined}>
                        <Mark kind={mark === null || mark.ok ? 'ok' : 'bad'} />{mark === null ? 'Not the right place' : splitMark(mark.text).text}
                      </p>
                      <div className="order-reveal" data-on={revealed ? 'true' : 'false'} aria-hidden={revealed ? undefined : true}>{renderReveal(e)}</div>
                    </div>
                  )
                  : (
                    <>
                      {mark !== null && <p className={`order-mark ${mark.ok ? 'ok' : 'bad'}`}><Mark kind={mark.ok ? 'ok' : 'bad'} />{splitMark(mark.text).text}</p>}
                      {revealed && <div className="order-reveal">{renderReveal(e)}</div>}
                    </>
                  )}
              </div>
              <div className="order-buttons" role="group" aria-label={`Move “${e.label}”`}>
                <button type="button" className="order-move" data-dir="up" disabled={i === 0} onClick={() => move(id, -1)} aria-label={`Move “${e.label}” up`} title="Move up">
                  <IconChevronUp />
                </button>
                <button type="button" className="order-move" data-dir="down" disabled={i === n - 1} onClick={() => move(id, 1)} aria-label={`Move “${e.label}” down`} title="Move down">
                  <IconChevronDown />
                </button>
              </div>
            </>
          );
          const drag = {
            draggable: true,
            onDragStart: (ev: DragEvent<HTMLLIElement>) => onDragStart(ev, id),
            onDragOver: (ev: DragEvent<HTMLLIElement>) => onDragOver(ev, i),
            onDrop: (ev: DragEvent<HTMLLIElement>) => onDrop(ev, i),
            onDragEnd: endDrag,
          };
          if (linksOf !== undefined) {
            return <Linked as="li" key={id} data-event-id={id} className={itemClass} links={revealed ? linksOf(e) : []} {...(drag as object)}>{body}</Linked>;
          }
          return (
            <li key={id} data-event-id={id} className={itemClass} {...drag}>
              {body}
            </li>
          );
        })}
      </ol>
      <div className="order-actions">
        <button type="button" className="btn btn-primary" ref={checkRef} onClick={check}>{checkLabel}</button>
        <button type="button" className="btn" onClick={reset}>Back to the starting order</button>
        {reserve
          // Presentation: the button's room is kept from the start (hidden), so it appearing moves nothing.
          ? <button type="button" className="btn order-show" data-on={offered ? 'true' : 'false'} disabled={!offered} aria-hidden={offered ? undefined : true} tabIndex={offered ? undefined : -1} onClick={showOrder}>{SHOW_ORDER_LABEL}</button>
          : offered && <button type="button" className="btn order-show" onClick={showOrder}>{SHOW_ORDER_LABEL}</button>}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      {reserve ? (
        <div className={`grade order-result-reserved ${result === null || result.correct ? 'grade-ok' : 'grade-miss'}`} role="status" data-testid="order-result" data-on={result === null ? 'false' : 'true'}>
          {/* Before the check a hidden stand-in of the longest result keeps the line's room. */}
          {result === null
            ? <><strong aria-hidden="true"><Mark kind="bad" />{`${n} of ${n} steps are in the right place. Move the marked steps and check again.`}</strong><span aria-hidden="true">{resultNote}</span></>
            : <><strong>{splitMark(result.summary).mark !== null && <Mark kind={splitMark(result.summary).mark ?? 'ok'} />}{splitMark(result.summary).text}</strong><span data-on={noteOn ? 'true' : 'false'} aria-hidden={noteOn ? undefined : true}>{resultNote}</span></>}
        </div>
      ) : result !== null && (
        <div className={`grade ${result.correct ? 'grade-ok' : 'grade-miss'}`} role="status" data-testid="order-result">
          <strong>{splitMark(result.summary).mark !== null && <Mark kind={splitMark(result.summary).mark ?? 'ok'} />}{splitMark(result.summary).text}</strong>
          {noteOn && <span>{resultNote}</span>}
        </div>
      )}
    </section>
  );
}
