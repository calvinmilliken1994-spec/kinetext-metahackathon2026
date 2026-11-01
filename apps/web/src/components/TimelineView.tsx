import { useContext, useId, useMemo, useState } from 'react';
import type { TimelineEvent, TimelineScenario } from '../../../../packages/contracts/index.ts';
import { dateOrder, formatEventDate } from '../lib/timeline.ts';
import { partReviewTag } from '../lib/reviewState.ts';
import { LessonReviewContext } from './LessonPartsContext.ts';
import { SchematicTag } from './controls.tsx';
import { AiWritten } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';
import { TimeAxisChart } from './TimeAxisChart.tsx';

export const TIMELINE_LABEL = 'Placed by the dates the page states, to scale in time; a month or year covers its whole span';

interface Props {
  events: readonly TimelineEvent[];
  scenario: TimelineScenario;
  cite: CiteProps;
}

/**
 * The events on a real time axis, in the date order computed by code. Hovering or focusing an event shows its stated
 * date and verbatim quote below the axis and lights that sentence in the source panel.
 */
export function TimelineView({ events, scenario, cite }: Props) {
  const headingId = useId();
  const review = useContext(LessonReviewContext);
  const ordered = useMemo(() => dateOrder(events), [events]);
  const [selected, setSelected] = useState<string | null>(ordered[0]?.id ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const activeId = hover ?? selected;
  const active: TimelineEvent | undefined = ordered.find((e) => e.id === activeId);

  return (
    <section className="simulation timeline-view" data-engine="timeline-v1" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId}>{scenario.subjectLabel}</h3>
        <AiWritten extra={partReviewTag(review)} />
      </div>
      <SchematicTag text={TIMELINE_LABEL} />
      {scenario.settingLabel !== '' && <p className="muted small timeline-setting">{scenario.settingLabel}</p>}
      <TimeAxisChart
        events={events}
        label={scenario.subjectLabel}
        activeId={activeId}
        onActivate={(id, how) => { if (how === 'hover') setHover(id); else setSelected(id); }}
        onDeactivate={() => setHover(null)}
        legend
      />
      {active !== undefined && (
        <div className="ta-detail" data-testid="timeline-detail">
          <p className="ta-detail-head">
            <span className="ta-detail-date">{formatEventDate(active)}</span>
            <span className="ta-detail-label">{active.label}</span>
          </p>
          <EventEvidence event={active} cite={cite} />
        </div>
      )}
    </section>
  );
}
