import { useId } from 'react';
import type { ReactNode } from 'react';
import type { LessonCard } from '../lib/lesson.ts';
import { Disclosure } from './Disclosure.tsx';

/** Quiet per-component status: passed, passed with items left out, could not be verified, or not built. */
export function StatusBadge({ card }: { card: Pick<LessonCard, 'status' | 'note'> }) {
  if (card.status === 'passed') {
    return card.note === ''
      ? <span className="badge badge-ok" data-testid="card-status">✓ Checked against the page</span>
      : <span className="badge badge-warn" data-testid="card-status">✓ Checked, some items left out</span>;
  }
  if (card.status === 'failed') return <span className="badge badge-bad" data-testid="card-status">✗ Could not be verified</span>;
  return <span className="badge badge-rec" data-testid="card-status">Not built</span>;
}

interface Props {
  /** 1-based position in the lesson. */
  index: number;
  card: LessonCard;
  /** The AI-disclosure wording for the lesson's source. */
  disclosure: string;
  children?: ReactNode;
}

/**
 * The frame around one lesson component: title, AI-written badge, quiet status, the note about dropped items, and
 * (for a component that could not be verified) only its message. Content is passed as children only for a passed card.
 */
export function KitCard({ index, card, disclosure, children }: Props) {
  const headId = useId();
  const shown = card.status === 'passed';
  return (
    <article className={`card kit-card kit-${card.status}`} aria-labelledby={headId} data-component={card.componentId} data-status={card.status}>
      <header className="kit-head">
        <div className="kit-title">
          <p className="eyebrow">{index}. {card.label}</p>
          <h2 id={headId}>{card.title}</h2>
        </div>
        <div className="kit-badges">
          {shown && <Disclosure variant="badge" text={disclosure} />}
          <StatusBadge card={card} />
        </div>
      </header>
      {shown && card.note !== '' && <p className="callout callout-warn small kit-note" role="note">{card.note}</p>}
      {shown && children}
      {!shown && (
        <div className="kit-message" role="note">
          <p><strong>{card.message}</strong></p>
          <p className="muted small">Nothing from this component is shown, because it was not confirmed by the page.</p>
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
