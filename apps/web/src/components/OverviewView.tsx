import { useId } from 'react';
import type { OverviewSpec } from '../../../../packages/contracts/kit.ts';
import { Disclosure } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';

interface Props {
  overview: OverviewSpec;
  /** What the page covers (from the analysis); shown under the headline when present. */
  pageCoverage?: string;
  cite: CiteProps;
  disclosure: string;
}

/** The page overview, shown first: headline, numbered key points each with the page's own words, then key terms with glosses. */
export function OverviewView({ overview, pageCoverage, cite, disclosure }: Props) {
  const headId = useId();
  return (
    <section className="card overview" aria-labelledby={headId} data-testid="overview">
      <header className="kit-head">
        <div className="kit-title">
          <p className="eyebrow">Page overview</p>
          <h2 id={headId}>{overview.headline}</h2>
        </div>
        <div className="kit-badges"><Disclosure variant="badge" text={disclosure} /></div>
      </header>
      {pageCoverage !== undefined && pageCoverage !== '' && <p className="muted overview-coverage"><strong>What the page covers:</strong> {pageCoverage}</p>}

      <h3>Key points</h3>
      <ol className="key-points">
        {overview.keyPoints.map((p, i) => (
          <li key={p.id}>
            <span className="prediction-num" aria-hidden="true">{i + 1}</span>
            <div className="key-body">
              <p><span className="sr-only">Key point {i + 1}: </span>{p.point}</p>
              <QuoteBlock componentId="overview-v1" part="point" id={p.id} sourceId={p.sourceId} quote={p.quote} cite={cite} />
            </div>
          </li>
        ))}
      </ol>

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
