import { useId } from 'react';
import type { ReactNode } from 'react';
import type { LessonCard } from '../lib/lesson.ts';
import { AiWritten } from './Disclosure.tsx';
import { Mark } from './icons.tsx';

/** Quiet per-part status in words: checked, checked with items left out, could not be verified, or not built. */
export function StatusText({ card }: { card: Pick<LessonCard, 'status' | 'note'> }) {
  if (card.status === 'passed') {
    return (
      <span className="card-status" data-testid="card-status">
        <Mark kind="ok" />{card.note === '' ? 'Checked against the page' : 'Checked, some items left out'}
      </span>
    );
  }
  if (card.status === 'failed') return <span className="card-status tone-bad" data-testid="card-status"><Mark kind="bad" />Could not be verified</span>;
  return <span className="card-status" data-testid="card-status">Not built</span>;
}

interface Props {
  card: LessonCard;
  children?: ReactNode;
}

/**
 * The frame around one lesson part: title, a meta line (kind of part · AI-written · status), the note about dropped
 * items, and (for a part that could not be verified) only its message. Content is passed as children only when it passed.
 */
export function KitCard({ card, children }: Props) {
  const headId = useId();
  const shown = card.status === 'passed';
  return (
    <article className={`card kit-card kit-${card.status}`} aria-labelledby={headId} data-component={card.componentId} data-status={card.status}>
      <header className="kit-head">
        <h2 id={headId}>{card.title}</h2>
        <p className="card-meta">
          <span>{card.label}</span>
          {shown && <AiWritten />}
          <StatusText card={card} />
        </p>
      </header>
      {shown && card.note !== '' && <p className="note small" role="note">{card.note}</p>}
      {shown && children}
      {!shown && (
        <div className="kit-message" role="note">
          <p><strong>{card.message}</strong></p>
          <p className="muted small">Nothing from this part is shown, because it was not confirmed by the page.</p>
          {card.detail !== '' && (
            <details className="small">
              <summary>Details for the teacher</summary>
              <p className="muted">{card.detail}</p>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
