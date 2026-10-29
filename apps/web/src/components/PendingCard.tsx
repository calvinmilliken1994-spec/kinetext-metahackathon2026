import { useId } from 'react';
import type { PendingSlot } from '../lib/lesson.ts';

/**
 * Stands in for a lesson part that is not ready yet (queued, being built, or being repaired after a check). It carries no
 * content: the real part replaces it in place as soon as it has passed its checks. Calm and static: a thin bar shows
 * that work is under way, with no shimmer.
 */
export function PendingCard({ slot }: { slot: PendingSlot }) {
  const headId = useId();
  const state = slot.state === 'queued' ? 'Up next' : slot.state === 'repairing' ? 'Repairing' : 'Building';
  return (
    <article className={`card kit-card kit-pending kit-pending-${slot.state}`} aria-labelledby={headId} aria-busy="true" data-component={slot.componentId} data-status={slot.state} data-testid="pending-card">
      <header className="kit-head">
        <h2 id={headId}>{slot.label}</h2>
        <p className="card-meta"><span>{state}</span></p>
      </header>
      <p className="pending-message" role="status">{slot.message}</p>
      <div className={`pending-bar${slot.state === 'queued' ? ' is-queued' : ''}`} aria-hidden="true"><span /></div>
    </article>
  );
}
