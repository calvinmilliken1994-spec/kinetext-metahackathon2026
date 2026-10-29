import { useId } from 'react';
import type { OverviewSpec } from '../../../../packages/contracts/kit.ts';
import { AiWritten } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';

interface Props {
  overview: OverviewSpec;
  /** What the page covers (from the analysis); shown first when present. */
  pageCoverage?: string;
  cite: CiteProps;
}

/** The page overview, shown first under the lesson title: what the page covers, key points with the page's own words, key terms. */
export function OverviewView({ overview, pageCoverage, cite }: Props) {
  const headId = useId();
  return (
    <section className="card overview" aria-labelledby={headId} data-testid="overview">
      <header className="kit-head">
        <h2 id={headId}>Page overview</h2>
        <p className="card-meta"><AiWritten /></p>
      </header>
      {pageCoverage !== undefined && pageCoverage !== '' && <p className="overview-coverage">{pageCoverage}</p>}

      <h3>Key points</h3>
      <ul className="key-points">
        {overview.keyPoints.map((p) => (
          <li key={p.id}>
            <p>{p.point}</p>
            <QuoteBlock componentId="overview-v1" part="point" id={p.id} sourceId={p.sourceId} quote={p.quote} cite={cite} />
          </li>
        ))}
      </ul>

      {overview.keyTerms.length > 0 && (
        <>
          <h3>Key terms</h3>
          <dl className="key-terms">
            {overview.keyTerms.map((t) => (
              <div key={t.id} className="key-term">
                <dt>{t.term}</dt>
                <dd>
                  <p>{t.gloss}</p>
                  <QuoteBlock componentId="overview-v1" part="term" id={t.id} sourceId={t.sourceId} quote={t.quote} cite={cite} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
