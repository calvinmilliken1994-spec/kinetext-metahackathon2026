import { useId } from 'react';
import type { CSSProperties } from 'react';
import type { PendingSlot } from '../lib/lesson.ts';
import { LESSON_SKELETON, SOURCE_SKELETON } from '../lib/skeleton.ts';
import '../styles/lesson-load.css';

const bar = (width: number): CSSProperties => ({ inlineSize: `${width}%` });

/**
 * The lesson while it loads (UX pair review 2, M7): a sketch of its shape, not an empty panel with "Loading…". The title
 * and status line, the first part (a figure beside its controls, as the most visual part leads), then the notes. The
 * bars shimmer while the lesson loads (static under reduced motion) and carry no content.
 */
export function LessonSkeleton() {
  return (
    <div className="lesson skel-lesson" role="status" aria-busy="true" data-testid="lesson-skeleton">
      <span className="sr-only">Loading the lesson…</span>
      <div className="skel-head" aria-hidden="true">
        <span className="skel-bar skel-title" />
        <span className="skel-bar skel-line" style={bar(58)} />
      </div>
      <div className="card skel-card" aria-hidden="true">
        <span className="skel-bar skel-heading" />
        <span className="skel-bar skel-line" style={bar(34)} />
        <div className="skel-part">
          <span className="skel-block skel-figure" />
          <div className="skel-controls">
            <span className="skel-bar skel-question" />
            <span className="skel-chips">{Array.from({ length: LESSON_SKELETON.controls }, (_, i) => <span key={i} className="skel-bar skel-chip" />)}</span>
            {Array.from({ length: LESSON_SKELETON.controls - 1 }, (_, i) => <span key={i} className="skel-bar skel-line" style={bar(70 - i * 12)} />)}
          </div>
        </div>
      </div>
      <div className="card skel-card skel-notes" aria-hidden="true">
        <span className="skel-bar skel-heading" />
        {LESSON_SKELETON.notes.map((w, i) => <span key={i} className="skel-bar skel-line" style={bar(w)} />)}
      </div>
    </div>
  );
}

/** The source page's text while it loads: a few paragraphs of bars where the page will be. */
export function SourceSkeleton() {
  return (
    <div className="skel-source" role="status" aria-busy="true" data-testid="source-skeleton">
      <span className="sr-only">Loading the page…</span>
      {SOURCE_SKELETON.map((lines, p) => (
        <span key={p} className="skel-para" aria-hidden="true">
          {lines.map((w, i) => <span key={i} className="skel-bar skel-text" style={bar(w)} />)}
        </span>
      ))}
    </div>
  );
}

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
