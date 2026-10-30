import { useId, useMemo } from 'react';
import type { TimelineEvent, TimelineScenario } from '../../../../packages/contracts/index.ts';
import { dateOrder, formatEventDate } from '../lib/timeline.ts';
import { SchematicTag } from './controls.tsx';
import { AiWritten } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';
import { Linked } from './Linked.tsx';
import { linkKeysOf } from '../lib/linking.ts';

export const TIMELINE_LABEL = 'Schematic — events are spaced evenly in date order, not to scale in time';

interface Props {
  events: readonly TimelineEvent[];
  scenario: TimelineScenario;
  cite: CiteProps;
}

/** The events on a wrapping timeline, in the date order computed by code, each with its stated date and verbatim quote. */
export function TimelineView({ events, scenario, cite }: Props) {
  const headingId = useId();
  const ordered = useMemo(() => dateOrder(events), [events]);
  return (
    <section className="simulation timeline-view" data-engine="timeline-v1" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId}>{scenario.subjectLabel}</h3>
        <AiWritten extra="needs teacher review" />
      </div>
      <SchematicTag text={TIMELINE_LABEL} />
      {scenario.settingLabel !== '' && <p className="muted small timeline-setting">{scenario.settingLabel}</p>}
      <ol className="timeline-track" aria-label="Events in date order, earliest first">
        {ordered.map((e) => (
          <Linked as="li" key={e.id} className="timeline-card" links={linkKeysOf(e.evidence)}>
            <p className="timeline-date">{formatEventDate(e)}</p>
            <p className="timeline-label">{e.label}</p>
            <EventEvidence event={e} cite={cite} />
          </Linked>
        ))}
      </ol>
    </section>
  );
}
