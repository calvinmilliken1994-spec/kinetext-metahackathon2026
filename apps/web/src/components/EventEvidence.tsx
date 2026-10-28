import type { TimelineEvent } from '../../../../packages/contracts/index.ts';
import { quoteKey } from '../lib/evidence.ts';
import { CitationChip } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';

/** The verbatim quote(s) behind an event's date, each with a "show in source" chip that highlights it in the source text. */
export function EventEvidence({ event, cite }: { event: TimelineEvent; cite: CiteProps }) {
  return (
    <div className="event-evidence">
      {event.evidence.map((ev, i) => {
        const key = quoteKey('event', event.id, i);
        return (
          <figure key={key} className="event-quote">
            <blockquote>“{ev.quote}”</blockquote>
            <CitationChip
              label="Show in source"
              quote={ev.quote}
              citeKey={key}
              enabled={ev.sourceId === cite.sourceId && cite.located.has(key)}
              onCite={cite.onCite}
            />
          </figure>
        );
      })}
    </div>
  );
}
