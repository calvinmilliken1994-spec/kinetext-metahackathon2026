import type { ReactNode } from 'react';
import type { ActivityId } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { engineTitle } from '../lib/engines.ts';
import { AiWritten } from './Disclosure.tsx';
import { Mark } from './icons.tsx';
import { prettyExponents } from '../lib/displayText.ts';

interface Props {
  title: string;
  learningObjectives: readonly string[];
  engine: ActivityId;
  /** 'Repaired by Muse' / 'System-made fault, repaired by Muse' when a later revision was published. */
  repairBadge: Badge | null;
  /** The provenance line, when this activity is the whole lesson (classic flow). */
  provenance?: ReactNode;
}

/** Title block shared by every activity: title, a meta line (activity type · AI-written · repair), provenance, objectives. */
export function ActivityHeader({ title, learningObjectives, engine, repairBadge, provenance = null }: Props) {
  return (
    <header className="activity-head">
      <h2 id="activity-title" className={provenance !== null ? 'lesson-title' : undefined}>{prettyExponents(title)}</h2>
      {provenance}
      <p className="card-meta">
        <span>{engineTitle(engine) ?? 'Interactive activity'}</span>
        {provenance === null && <AiWritten />}
        {repairBadge !== null && (
          <span className={`card-status tone-${repairBadge.tone === 'ok' ? 'neutral' : repairBadge.tone}`} data-testid="repair-badge">
            {repairBadge.tone === 'ok' && <Mark kind="ok" />}{repairBadge.text}
          </span>
        )}
      </p>
      <ul className="objectives" aria-label="Learning objectives">
        {learningObjectives.map((o) => <li key={o}>{prettyExponents(o)}</li>)}
      </ul>
    </header>
  );
}
