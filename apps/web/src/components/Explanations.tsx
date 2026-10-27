import type { ActivitySpec } from '../../../../packages/contracts/index.ts';
import { previewQuote, quoteKey } from '../lib/evidence.ts';

export interface CiteProps {
  /** Source currently shown in the Source panel. */
  sourceId: string;
  /** Keys of quotes that were located (and are therefore highlighted) in the source text. */
  located: ReadonlySet<string>;
  onCite: (key: string) => void;
}

export function CitationChip({ label, quote, citeKey, enabled, onCite }: { label?: string; quote: string; citeKey: string; enabled: boolean; onCite: (key: string) => void }) {
  return (
    <button
      type="button"
      className="chip"
      disabled={!enabled}
      onClick={() => onCite(citeKey)}
      title={enabled ? `Show in source: “${quote}”` : 'This quote is not from the source currently shown'}
    >
      <span className="chip-icon" aria-hidden="true">❝</span>
      <span className="chip-text">{label ?? previewQuote(quote, 54)}</span>
    </button>
  );
}

export function Explanations({ explanations, cite }: { explanations: ActivitySpec['explanations']; cite: CiteProps }) {
  return (
    <section className="card" aria-labelledby="expl-heading">
      <h3 id="expl-heading">Explanations, grounded in the source</h3>
      <ul className="explanations">
        {explanations.map((ex) => (
          <li key={ex.id}>
            <p>{ex.text}</p>
            <div className="chips" role="group" aria-label={`Evidence for ${ex.id}`}>
              {ex.evidence.map((ev, i) => {
                const key = quoteKey('explanation', ex.id, i);
                return (
                  <CitationChip
                    key={key}
                    quote={ev.quote}
                    citeKey={key}
                    enabled={ev.sourceId === cite.sourceId && cite.located.has(key)}
                    onCite={cite.onCite}
                  />
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
