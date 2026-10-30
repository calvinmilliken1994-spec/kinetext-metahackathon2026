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
}

/**
 * Timeline-v1 activity: learners first put the events in order; the timeline with its dates and quotes stays hidden
 * until they check (predict, then reveal). A teacher can reveal it at any time.
 */
export function TimelineActivity({ spec, cite, repairBadge, provenance }: TimelineActivityProps) {
  const [revealed, setRevealed] = useState(false);
  const { events, scenario } = spec.simulation;
  return (
    <article className="activity" aria-labelledby="activity-title" data-engine="timeline-v1">
      <ActivityHeader title={spec.title} learningObjectives={spec.learningObjectives} engine="timeline-v1" repairBadge={repairBadge} provenance={provenance} />
      <OrderActivity events={events} seed={spec.id} revealed={revealed} onCheck={() => setRevealed(true)} cite={cite} />
      {revealed
        ? <TimelineView events={events} scenario={scenario} cite={cite} />
        : (
          <section className="card timeline-hidden" aria-label="Timeline">
            <h3>{scenario.subjectLabel}</h3>
            <p className="muted small">The timeline stays hidden until you check your order, so it does not give the answer away.</p>
            <button type="button" className="btn" onClick={() => setRevealed(true)}>Reveal the timeline now</button>
          </section>
        )}
      <WhichCameFirst events={events} predictions={spec.predictions} seed={spec.id} cite={cite} />
      <Explanations explanations={spec.explanations} cite={cite} />
    </article>
  );
}
