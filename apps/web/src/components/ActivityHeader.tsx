import type { ActivityId } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { engineTitle } from '../lib/engines.ts';

interface Props {
  title: string;
  learningObjectives: readonly string[];
  engine: ActivityId;
  /** 'Repaired by Muse' / 'System-made fault, repaired by Muse' when a later revision was published. */
  repairBadge: Badge | null;
}

/** Title block shared by every activity: activity type, spec title, repair badge, learning objectives. */
export function ActivityHeader({ title, learningObjectives, engine, repairBadge }: Props) {
  return (
    <header className="activity-head">
      <p className="eyebrow">
        Interactive activity · <span className="engine-title">{engineTitle(engine) ?? engine}</span> · <code>{engine}</code>
      </p>
      <h2 id="activity-title">{title}</h2>
      {repairBadge !== null && (
        <p className="head-badges">
          <span className={`badge badge-${repairBadge.tone}`} data-testid="repair-badge">{repairBadge.tone === 'ok' ? '✓ ' : '⚠ '}{repairBadge.text}</span>
        </p>
      )}
      <ul className="objectives" aria-label="Learning objectives">
        {learningObjectives.map((o) => <li key={o}>{o}</li>)}
      </ul>
    </header>
  );
}
