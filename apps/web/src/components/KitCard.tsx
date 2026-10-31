import { useId } from 'react';
import type { ReactNode } from 'react';
import { technicalMessage } from '../lib/failures.ts';
import { droppedNoteForTeacher } from '../lib/lesson.ts';
import type { LessonCard } from '../lib/lesson.ts';
import { AiWritten } from './Disclosure.tsx';
import { Mark } from './icons.tsx';

/** Today's checks a withheld part fails (lib/lessonJob.ts heldBackChecks): plain name + id. */
export type HeldBack = ReadonlyArray<{ id: string; name: string }>;

/** Quiet per-part status in words: checked, checked with items left out, could not be verified, held back, or not built. */
export function StatusText({ card, heldBack = null }: { card: Pick<LessonCard, 'status' | 'note'>; heldBack?: HeldBack | null }) {
  if (card.status === 'passed') {
    return (
      <span className="card-status" data-testid="card-status">
        <Mark kind="ok" />{card.note === '' ? 'Checked against the page' : 'Checked, some items left out'}
      </span>
    );
  }
  if (card.status === 'failed') return <span className="card-status tone-bad" data-testid="card-status"><Mark kind="bad" />{heldBack === null ? 'Could not be verified' : 'Held back'}</span>;
  return <span className="card-status" data-testid="card-status">Not built</span>;
}

interface Props {
  card: LessonCard;
  children?: ReactNode;
  /** Stage 9: how the part was built (BuildTrace), shown under the meta line while the view watched the build. */
  trace?: ReactNode;
  /** Set A: the part passed when it was built but fails today's checks, so it is withheld; these are the checks. */
  heldBack?: HeldBack | null;
}

/**
 * The frame around one lesson part: title, a meta line (kind of part · AI-written · status), the note about dropped
 * items, and (for a part that could not be verified) only its message. Content is passed as children only when it passed.
 */
export function KitCard({ card, children, trace = null, heldBack = null }: Props) {
  const headId = useId();
  const shown = card.status === 'passed';
  return (
    <article className={`card kit-card kit-${card.status}`} aria-labelledby={headId} data-component={card.componentId} data-status={card.status} data-held-back={heldBack === null ? undefined : 'true'}>
      <header className="kit-head">
        <h2 id={headId}>{card.title}</h2>
        <p className="card-meta">
          {/* A part that failed is titled by its kind already: the kind is not said twice. */}
          {card.label !== card.title && <span>{card.label}</span>}
          {shown && <AiWritten />}
          <StatusText card={card} heldBack={heldBack} />
        </p>
        {trace}
      </header>
      {shown && card.note !== '' && <p className="note small" role="note">{droppedNoteForTeacher(card.note)}</p>}
      {shown && children}
      {!shown && heldBack !== null && (
        <div className="kit-message" role="note">
          <p><strong>{card.explain?.sentence ?? card.message}</strong></p>
          <p className="muted small">It passed when this lesson was built. Our checks are stricter now, so it is left out of the lesson and of presentation mode.</p>
          <details className="small kit-why">
            <summary>Details for the teacher</summary>
            {heldBack.length === 0
              ? <p>Today’s checks did not say which rule it breaks.</p>
              : (
                <>
                  <p>Checks it no longer passes:</p>
                  <ul className="kit-held-checks">{heldBack.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
                  <details className="tech-details">
                    <summary>Technical details</summary>
                    <p>Checks: {heldBack.map((c, i) => <span key={c.id}>{i > 0 && ', '}<code>{c.id}</code></span>)}</p>
                  </details>
                </>
              )}
          </details>
        </div>
      )}
      {!shown && heldBack === null && (
        <div className="kit-message" role="note">
          <p><strong>{card.message}</strong></p>
          <p className="muted small">Nothing from this part is shown, because it was not confirmed by the page.</p>
          {card.explain !== null && (
            <details className="small kit-why">
              <summary>Details for the teacher</summary>
              <p>{card.explain.sentence}</p>
              {card.explain.technical !== '' && (
                // The check ids and the validator's own words, for whoever maintains the checks; closed by default.
                <details className="tech-details">
                  <summary>Technical details</summary>
                  <p>Checks: {card.explain.ids.map((id, i) => <span key={id}>{i > 0 && ', '}<code>{id}</code></span>)}</p>
                  <p>{technicalMessage(card.explain)}</p>
                </details>
              )}
            </details>
          )}
        </div>
      )}
    </article>
  );
}
