import { lessonQuoteKey } from '../lib/lesson.ts';
import { CitationChip } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';

interface Props {
  componentId: string;
  /** Which part of the component the quote belongs to ('card', 'step', 'item', 'link', 'cell', 'point', 'term', 'equation'...). */
  part: string;
  id: string;
  sourceId: string;
  quote: string;
  cite: CiteProps;
  /** Small caption above the quote, for example 'The page says'. */
  caption?: string;
}

/** A verbatim quote with a “Show in source” chip that highlights it in the source text (same pattern as timeline events). */
export function QuoteBlock({ componentId, part, id, sourceId, quote, cite, caption }: Props) {
  const key = lessonQuoteKey(componentId, part, id);
  return (
    <figure className="event-quote lesson-quote">
      {caption !== undefined && <figcaption className="quote-caption">{caption}</figcaption>}
      <blockquote>“{quote}”</blockquote>
      <CitationChip label="Show in source" quote={quote} citeKey={key} enabled={sourceId === cite.sourceId && cite.located.has(key)} onCite={cite.onCite} />
    </figure>
  );
}
