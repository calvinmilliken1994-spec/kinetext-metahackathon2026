import { useId, useMemo } from 'react';
import type { TimelineEvent, TimelineScenario } from '../../../../packages/contracts/index.ts';
import { dateOrder, formatEventDate } from '../lib/timeline.ts';
import { SchematicTag } from './controls.tsx';
import { AiTag } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';

export const TIMELINE_LABEL = 'Schematic — events are spaced evenly in date order, not to scale in time';

interface Props {
  events: readonly TimelineEvent[];
  scenario: TimelineScenario;
  cite: CiteProps;
}

/** The events on a wrapping horizontal timeline, in the date order computed by code, each with its stated date and verbatim quote. */
export function TimelineView({ events, scenario, cite }: Props) {
  const headingId = useId();
  const ordered = useMemo(() => dateOrder(events), [events]);
  return (
    <section className="simulation timeline-view" data-engine="timeline-v1" aria-labelledby={headingId}>
      <SchematicTag text={TIMELINE_LABEL} />
      <div className="card-head">
        <h3 id={headingId}>{scenario.subjectLabel}</h3>
        <AiTag />
      </div>
      {scenario.settingLabel !== '' && <p className="muted small timeline-setting">{scenario.settingLabel}</p>}
      <ol className="timeline-track" aria-label="Events in date order, earliest first">
        {ordered.map((e, i) => (
          <li key={e.id} className="timeline-card">
            <span className="timeline-dot" aria-hidden="true">{i + 1}</span>
            <p className="timeline-date">{formatEventDate(e)}</p>
            <p className="timeline-label">{e.label}</p>
            <EventEvidence event={e} cite={cite} />
          </li>
        ))}
      </ol>
    </section>
  );
}
