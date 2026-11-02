import { useMemo } from 'react';
import type { TimelineEvent } from '../../../../packages/contracts/index.ts';
import { formatEventDate, gradeOrder, hasUnorderedPair, orderSummary, seededShuffle, wrongPartners } from '../lib/timeline.ts';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';
import { OrderBoard } from './OrderBoard.tsx';
import type { BoardResult } from './OrderBoard.tsx';
import { TIMELINE_ORDER_HINT } from '../lib/orderReveal.ts';

interface Props {
  events: readonly TimelineEvent[];
  /** Seed for the starting shuffle (the spec id), so a lecture demo starts the same way every time. */
  seed: string;
  /** Dates and quotes are shown on the cards once the order is revealed (or the teacher revealed the timeline). */
  revealed: boolean;
  /** Reveal the dates and the timeline: the order was checked right, or the learner asked for the page's order. */
  onCheck: () => void;
  cite: CiteProps;
}

/** "Put these events in order": the shared order board, graded against the events' dates. */
export function OrderActivity({ events, seed, revealed, onCheck, cite }: Props) {
  const startOrder = useMemo(() => seededShuffle(events, seed).map((e) => e.id), [events, seed]);
  const labels = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e.label])), [events]);
  const ties = hasUnorderedPair(events);

  const grade = (order: string[]): BoardResult => {
    const g = gradeOrder(events, order);
    return {
      correct: g.correct,
      summary: orderSummary(g, labels),
      marks: order.map((id, i) => {
        const ok = g.positions[i] === true;
        const partners = wrongPartners(g, id).map((pid) => `“${labels[pid] ?? pid}”`);
        const shown = partners.length > 2 ? `${partners.slice(0, 2).join(', ')} and ${partners.length - 2} more` : partners.join(' and ');
        return { ok, text: ok ? 'Right place' : (shown === '' ? 'Not the right place' : `Wrong way round with ${shown}`) };
      }),
    };
  };

  return (
    <OrderBoard
      items={events}
      startOrder={startOrder}
      heading="Put these events in order"
      hint={
        <>
          {TIMELINE_ORDER_HINT}
          {ties && ' Some dates are less exact than others (for example “1776” and “July 4, 1776”), so either order is accepted between those events.'}
        </>
      }
      resultNote="The dates and quotes are now shown on each card."
      revealed={revealed}
      renderReveal={(e) => (
        <>
          <p className="order-date">{formatEventDate(e)}</p>
          <EventEvidence event={e} cite={cite} />
        </>
      )}
      grade={grade}
      onReveal={onCheck}
      variant="track"
    />
  );
}
