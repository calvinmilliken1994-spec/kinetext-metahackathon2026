import { useState } from 'react';
import type { TimelineActivitySpec } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { Disclosure } from './Disclosure.tsx';
import { ActivityHeader } from './ActivityHeader.tsx';
import { Explanations } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { OrderActivity } from './OrderActivity.tsx';
import { TimelinePredictionCards } from './PredictionCards.tsx';
import { TimelineView } from './TimelineView.tsx';

export interface TimelineActivityProps {
  spec: TimelineActivitySpec;
  cite: CiteProps;
  disclosure: string;
  repairBadge: Badge | null;
}

/**
 * Timeline-v1 activity: learners first put the events in order; the timeline with its dates and quotes stays hidden
 * until they check (predict, then reveal). A teacher can reveal it at any time.
 */
export function TimelineActivity({ spec, cite, disclosure, repairBadge }: TimelineActivityProps) {
  const [revealed, setRevealed] = useState(false);
  const { events, scenario } = spec.simulation;
  return (
    <article className="activity" aria-labelledby="activity-title" data-engine="timeline-v1">
      <Disclosure text={disclosure} />
      <ActivityHeader title={spec.title} learningObjectives={spec.learningObjectives} engine="timeline-v1" repairBadge={repairBadge} />
      <OrderActivity events={events} seed={spec.id} revealed={revealed} onCheck={() => setRevealed(true)} cite={cite} />
      {revealed
        ? <TimelineView events={events} scenario={scenario} cite={cite} />
        : (
          <section className="card timeline-hidden" aria-label="Timeline">
            <h3>{scenario.subjectLabel}</h3>
            <p className="muted small">The timeline is hidden so it does not give away the order. It appears when you check your order.</p>
            <button type="button" className="btn" onClick={() => setRevealed(true)}>Reveal the timeline now</button>
          </section>
        )}
      <TimelinePredictionCards events={events} predictions={spec.predictions} seed={spec.id} cite={cite} />
      <Explanations explanations={spec.explanations} cite={cite} />
    </article>
  );
}
