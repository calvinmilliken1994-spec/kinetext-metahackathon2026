import { useState } from 'react';
import type { ReactNode } from 'react';
import type { TimelineActivitySpec } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { ActivityHeader } from './ActivityHeader.tsx';
import { Explanations } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { OrderActivity } from './OrderActivity.tsx';
import { TimelineView } from './TimelineView.tsx';
import { WhichCameFirst } from './WhichCameFirst.tsx';

export interface TimelineActivityProps {
  spec: TimelineActivitySpec;
  cite: CiteProps;
  repairBadge: Badge | null;
  /** The lesson's provenance line, when this activity is the whole lesson (classic flow). */
  provenance?: ReactNode;
  /**
   * Presentation mode: only the ordering task and the timeline it reveals (the deck shows the title, the which-came-first
   * question and the page's words on beats of their own). The revealed timeline is marked for the stage to follow.
   */
  presentation?: boolean;
}

/**
 * Timeline-v1 activity: learners first put the events in order; the timeline with its dates and quotes stays hidden
 * until they check (predict, then reveal). A teacher can reveal it at any time.
 */
export function TimelineActivity({ spec, cite, repairBadge, provenance, presentation = false }: TimelineActivityProps) {
  const [revealed, setRevealed] = useState(false);
  const { events, scenario } = spec.simulation;
  return (
    <article className="activity" aria-labelledby={presentation ? undefined : 'activity-title'} aria-label={presentation ? spec.title : undefined} data-engine="timeline-v1">
      {!presentation && <ActivityHeader title={spec.title} learningObjectives={spec.learningObjectives} engine="timeline-v1" repairBadge={repairBadge} provenance={provenance} />}
      <OrderActivity events={events} seed={spec.id} revealed={revealed} onCheck={() => setRevealed(true)} cite={cite} />
      {revealed
        ? (presentation ? <div data-pz-follow=""><TimelineView events={events} scenario={scenario} cite={cite} /></div> : <TimelineView events={events} scenario={scenario} cite={cite} />)
        : (
          <section className="card timeline-hidden" aria-label="Timeline">
            <h3>{scenario.subjectLabel}</h3>
            <p className="muted small">The timeline stays hidden until you check your order, so it does not give the answer away.</p>
            <button type="button" className="btn" onClick={() => setRevealed(true)}>Reveal the timeline now</button>
          </section>
        )}
      {!presentation && <WhichCameFirst events={events} predictions={spec.predictions} seed={spec.id} cite={cite} />}
      {!presentation && <Explanations explanations={spec.explanations} cite={cite} />}
    </article>
  );
}
