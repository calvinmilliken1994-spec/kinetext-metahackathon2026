import { useEffect, useMemo, useRef } from 'react';
import type { Loadable } from '../hooks.ts';
import type { SourceDoc, SourceMeta } from '../api.ts';
import type { HighlightResult } from '../lib/highlight.ts';
import type { QuoteRef } from '../lib/evidence.ts';
import { CitationChip } from './Explanations.tsx';

export interface Flash { key: string; n: number }

export interface SourcePanelProps {
  sources: Loadable<SourceMeta[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReload: () => void;
  doc: Loadable<SourceDoc> | null;
  highlights: HighlightResult | null;
  quotes: readonly QuoteRef[];
  flash: Flash | null;
  onCite: (key: string) => void;
}

function HighlightedText({ text, highlights, byKey, flash }: { text: string; highlights: HighlightResult | null; byKey: Map<string, QuoteRef>; flash: Flash | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (root === null || flash === null) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>('mark[data-keys]'))
      .filter((m) => (m.dataset['keys'] ?? '').split(' ').includes(flash.key));
    const first = marks[0];
    if (first === undefined) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    first.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    for (const m of marks) {
      m.classList.remove('flash');
      void m.offsetWidth; // restart the CSS animation
      m.classList.add('flash');
    }
    const timer = setTimeout(() => { for (const m of marks) m.classList.remove('flash'); }, 2000);
    return () => clearTimeout(timer);
  }, [flash]);

  const parts = useMemo(() => {
    if (highlights === null || highlights.segments.length === 0) return [text];
    return highlights.segments.map((s) => {
      const slice = text.slice(s.start, s.end);
      if (s.keys.length === 0) return <span key={s.start}>{slice}</span>;
      const isEvidence = s.keys.some((k) => k.startsWith('explanation:'));
      const owners = [...new Set(s.keys.map((k) => byKey.get(k)?.ownerLabel ?? k))].join(', ');
      return (
        <mark key={s.start} data-keys={s.keys.join(' ')} className={isEvidence ? 'ev-explanation' : 'ev-concept'} title={`Evidence for: ${owners}`}>
          {slice}
        </mark>
      );
    });
  }, [text, highlights, byKey]);

  return <div ref={ref} className="source-text" tabIndex={0} aria-label="Source text with highlighted evidence quotes">{parts}</div>;
}

export function SourcePanel({ sources, selectedId, onSelect, onReload, doc, highlights, quotes, flash, onCite }: SourcePanelProps) {
  const byKey = useMemo(() => new Map(quotes.map((q) => [q.key, q] as const)), [quotes]);
  const concepts = quotes.filter((q) => q.kind === 'concept');
  const located = highlights ? Object.keys(highlights.ranges).length : 0;
  const meta = sources.state === 'ready' ? sources.data.find((s) => s.id === selectedId) : undefined;

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <div className="panel-head">
        <h2 id="source-heading"><span className="step-num">1</span> Source</h2>
      </div>

      {sources.state === 'loading' && <p className="muted pad">Loading sources…</p>}
      {sources.state === 'error' && (
        <div className="callout callout-error pad-m" role="alert">
          {sources.message} <button type="button" className="btn btn-small" onClick={onReload}>Retry</button>
        </div>
      )}
      {sources.state === 'ready' && sources.data.length === 0 && <p className="muted pad">No licensed sources are registered.</p>}
      {sources.state === 'ready' && sources.data.length > 0 && (
        <div className="pad">
          <label htmlFor="source-select" className="sr-only">Licensed source text</label>
          <select id="source-select" value={selectedId ?? ''} onChange={(e) => onSelect(e.target.value)}>
            {sources.data.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </div>
      )}

      {meta !== undefined && (
        <div className="license">
          <div className="license-row">
            <span className="tag">{meta.license}</span>
            <a href={meta.locator} target="_blank" rel="noopener noreferrer">Original page ↗</a>
            <span className="tag mono" title={`sha256 ${meta.sha256}`}>sha {meta.sha256.slice(0, 8)}</span>
          </div>
          <p className="attribution">{meta.attribution}</p>
        </div>
      )}

      {highlights !== null && quotes.length > 0 && (
        <div className="legend" aria-label="Highlight legend">
          <span><mark className="ev-explanation">Evidence</mark> cited by the activity</span>
          <span><mark className="ev-concept">Concept</mark> found by Muse</span>
          <span className="muted">{located}/{quotes.length} quotes located</span>
        </div>
      )}

      <div className="source-scroll">
        {doc === null && <p className="muted pad">Select a source.</p>}
        {doc?.state === 'loading' && <p className="muted pad">Loading source text…</p>}
        {doc?.state === 'error' && <div className="callout callout-error pad-m" role="alert">{doc.message}</div>}
        {doc?.state === 'ready' && <HighlightedText text={doc.data.text} highlights={highlights} byKey={byKey} flash={flash} />}
      </div>

      {concepts.length > 0 && (
        <div className="concepts">
          <h3>Concepts Muse found</h3>
          <div className="chips">
            {[...new Map(concepts.map((c) => [c.ownerId, c] as const)).values()].map((c) => (
              <CitationChip key={c.key} label={c.ownerLabel} quote={c.quote} citeKey={c.key} enabled={highlights?.ranges[c.key] !== undefined} onCite={onCite} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
