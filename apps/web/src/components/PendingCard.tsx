import { useId } from 'react';
import type { PendingSlot } from '../lib/lesson.ts';

/**
 * Stands in for a lesson component that is not ready yet (queued, being built, or being repaired after a check). It carries no
 * content: the real component replaces it in place as soon as it has passed its checks.
 */
export function PendingCard({ index, slot }: { index: number; slot: PendingSlot }) {
  const headId = useId();
  return (
    <article className={`card kit-card kit-pending kit-pending-${slot.state}`} aria-labelledby={headId} aria-busy="true" data-component={slot.componentId} data-status={slot.state} data-testid="pending-card">
      <header className="kit-head">
        <div className="kit-title">
          <p className="eyebrow">{index}. {slot.label}</p>
          <h2 id={headId}>{slot.label}</h2>
        </div>
        <div className="kit-badges"><span className="badge badge-rec">{slot.state === 'queued' ? 'Up next' : slot.state === 'repairing' ? 'Repairing' : 'Building'}</span></div>
      </header>
      <div className="pending-body" role="status">
        {slot.state !== 'queued' && <span className="spinner spinner-small" aria-hidden="true" />}
        <p className="pending-message">{slot.message}</p>
      </div>
      <div className="pending-skeleton" aria-hidden="true"><span /><span /><span /></div>
    </article>
  );
}
