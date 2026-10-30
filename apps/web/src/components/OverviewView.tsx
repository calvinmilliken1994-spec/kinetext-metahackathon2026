import { useId, useState } from 'react';
import type { OverviewSpec } from '../../../../packages/contracts/kit.ts';
import { Linked } from './Linked.tsx';
import { IconChevronDown, IconChevronUp } from './icons.tsx';
import { linkKeysOf } from '../lib/linking.ts';
import { prettyExponents } from '../lib/displayText.ts';
import { overviewParts } from '../lib/lessonLayout.ts';

interface Props {
  overview: OverviewSpec;
}

const points = (n: number): string => `${n} more ${n === 1 ? 'point' : 'points'}`;

/**
 * The page overview, under the lesson title: a few short key points (the lesson's summary), then the key terms in a
 * collapsed fold-out. No quote lines and no "Show in source" buttons here: pointing at (or focusing) a point lights its
 * sentence in the source page, which is how a teacher sees where it comes from. Every quote is still checked and still
 * highlighted in the source text.
 */
export function OverviewView({ overview }: Props) {
  const headId = useId();
  const moreId = useId();
  const [open, setOpen] = useState(false);
  const { lead, more } = overviewParts(overview.keyPoints);
  const terms = overview.keyTerms;
  const hasMore = terms.length > 0 || more.length > 0;
  const foldLabel = terms.length > 0
    ? `Key terms (${terms.length})${more.length > 0 ? ` and ${points(more.length)}` : ''}`
    : points(more.length);
  return (
    <section className="overview overview-compact" aria-labelledby={headId} data-testid="overview">
      <h2 id={headId} className="sr-only">Page overview</h2>
      <ul className="key-points" aria-label="Key points">
        {lead.map((p) => (
          <Linked as="li" key={p.id} links={linkKeysOf([p])} tabIndex={0}>
            {prettyExponents(p.point)}
          </Linked>
        ))}
      </ul>
      <p className="overview-foot">
        <span className="ai-written">AI-written summary · point at a line to see it on the page</span>
        {hasMore && (
          <button type="button" className="fold-btn" aria-expanded={open} aria-controls={moreId} onClick={() => setOpen((v) => !v)}>
            {foldLabel}{open ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </button>
        )}
      </p>
      {hasMore && open && (
        <div id={moreId} className="overview-more">
          {more.length > 0 && (
            <ul className="key-points" aria-label="More key points">
              {more.map((p) => (
                <Linked as="li" key={p.id} links={linkKeysOf([p])} tabIndex={0}>
                  {prettyExponents(p.point)}
                </Linked>
              ))}
            </ul>
          )}
          {terms.length > 0 && (
            <dl className="key-terms" aria-label="Key terms">
              {terms.map((t) => (
                <Linked key={t.id} className="key-term" links={linkKeysOf([t])} tabIndex={0}>
                  <dt>{prettyExponents(t.term)}</dt>
                  <dd>{prettyExponents(t.gloss)}</dd>
                </Linked>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
