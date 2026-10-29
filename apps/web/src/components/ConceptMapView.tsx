import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ConceptMapSpec } from '../../../../packages/contracts/kit.ts';
import { gapOptions, gradeGap, layoutConceptMap, pickGapLink, relationSentence } from '../lib/conceptMap.ts';
import type { PlacedLink } from '../lib/conceptMap.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Mark } from './icons.tsx';

interface Props { spec: ConceptMapSpec; cite: CiteProps }

type GapState = { mode: 'off' } | { mode: 'on'; picked: string | null; checked: boolean };

/**
 * Concept map: an SVG diagram of the ideas and the page-stated connections between them, with the relation word on every
 * arrow. Read-only first (select a connection to read the page’s words); an optional gap mode hides one relation word.
 */
export function ConceptMapView({ spec, cite }: Props) {
  const uid = useId();
  const markerId = `arrow-${uid.replace(/[^a-zA-Z0-9]/g, '')}`;
  const layout = useMemo(() => layoutConceptMap(spec), [spec]);
  const nodeLabel = useMemo(() => new Map(spec.nodes.map((n) => [n.id, n.label] as const)), [spec]);
  const gapLink = useMemo(() => {
    const drawn = new Set(layout.links.map((l) => l.id));
    return pickGapLink({ ...spec, links: spec.links.filter((l) => drawn.has(l.id)) });
  }, [spec, layout]);
  const options = useMemo(() => (gapLink === null ? [] : gapOptions(spec, gapLink)), [spec, gapLink]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [gap, setGap] = useState<GapState>({ mode: 'off' });
  const hidden = (id: string): boolean => gap.mode === 'on' && !gap.checked && gapLink !== null && gapLink.id === id;

  const pick = (id: string): void => setSelected((cur) => (cur === id ? null : id));
  const onKey = (e: KeyboardEvent<SVGGElement>, id: string): void => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(id); }
  };
  const link = (l: PlacedLink): string => `${nodeLabel.get(l.fromId) ?? l.fromId} ${hidden(l.id) ? 'has a hidden link to' : l.relation} ${nodeLabel.get(l.toId) ?? l.toId}`;

  return (
    <div className="conceptmap" data-testid="concept-map">
      <figure className="map-figure">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} className="map-svg" role="group" aria-label={`Concept map: ${layout.nodes.length} ideas and ${layout.links.length} connections. The list below describes every connection.`}>
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="13" markerHeight="13" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="map-arrow" />
            </marker>
          </defs>
          {layout.links.map((l) => {
            const on = selected === l.id;
            const gapped = hidden(l.id);
            return (
              <g
                key={l.id}
                className={`map-link${on ? ' map-link-on' : ''}${gapped ? ' map-link-gap' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={on}
                aria-label={`${link(l)}. ${gapped ? 'The relation word is hidden.' : 'Show the page’s words.'}`}
                onClick={() => pick(l.id)}
                onKeyDown={(e) => onKey(e, l.id)}
              >
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="map-hit" />
                <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} className="map-line" markerEnd={`url(#${markerId})`} />
                <rect x={l.labelX - l.labelW / 2} y={l.labelY - l.labelH / 2} width={l.labelW} height={l.labelH} rx={10} className="map-label-bg" />
                <text x={l.labelX} y={l.labelY} textAnchor="middle" dominantBaseline="central" className="map-label">{gapped ? '?' : l.relation}</text>
              </g>
            );
          })}
          {layout.nodes.map((n) => (
            <g key={n.id} className="map-node">
              <rect x={n.x - n.w / 2} y={n.y - n.h / 2} width={n.w} height={n.h} rx={10} />
              <text x={n.x} y={n.y} textAnchor="middle" className="map-node-text">
                {n.lines.map((line, i) => (
                  <tspan key={i} x={n.x} y={n.y + (i - (n.lines.length - 1) / 2) * 17} dominantBaseline="central">{line}</tspan>
                ))}
              </text>
            </g>
          ))}
        </svg>
        <figcaption className="muted small">Arrows point from one idea to the idea it is linked to; the word on each arrow is the relation. Select an arrow or a connection below to read the page’s words.</figcaption>
      </figure>

      <div className="card-head map-head">
        <h3>Connections</h3>
        <div className="map-tools">
          <button type="button" className="btn btn-small" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide all quotes' : 'Show every quote'}</button>
          {gapLink !== null && gap.mode === 'off' && <button type="button" className="btn btn-small" onClick={() => { setGap({ mode: 'on', picked: null, checked: false }); setSelected(null); }}>Hide one word and fill it in</button>}
          {gap.mode === 'on' && <button type="button" className="btn btn-small" onClick={() => setGap({ mode: 'off' })}>Back to read-only</button>}
        </div>
      </div>
      <ul className="map-links">
        {layout.links.map((l) => {
          const gapped = hidden(l.id);
          const open = !gapped && (showAll || selected === l.id);
          return (
            <li key={l.id} className={selected === l.id ? 'map-li-on' : ''}>
              <button type="button" className="map-li-btn" aria-pressed={selected === l.id} disabled={gapped} onClick={() => pick(l.id)}>
                <strong>{nodeLabel.get(l.fromId) ?? l.fromId}</strong> <span className="map-rel">{gapped ? '— ? →' : `— ${l.relation} →`}</span> <strong>{nodeLabel.get(l.toId) ?? l.toId}</strong>
              </button>
              {open && <QuoteBlock componentId="concept-map-v1" part="link" id={l.id} sourceId={l.sourceId} quote={l.quote} cite={cite} caption="The page’s words" />}
            </li>
          );
        })}
      </ul>
      {selected === null && !showAll && gap.mode === 'off' && <p className="muted small">Nothing selected yet.</p>}

      {gap.mode === 'on' && gapLink !== null && (
        <section className="prediction map-gap" aria-label="Fill the hidden word">
          <fieldset className="choice-set" disabled={gap.checked}>
            <legend><strong>Which word does the page use?</strong> {nodeLabel.get(gapLink.fromId)} <span aria-hidden="true">—?→</span><span className="sr-only">(hidden relation)</span> {nodeLabel.get(gapLink.toId)}</legend>
            {options.map((o) => {
              const right = gap.checked && o === gapLink.relation;
              const mine = gap.checked && gap.picked === o;
              return (
                <label key={o} className={`choice${gap.picked === o ? ' choice-picked' : ''}${right ? ' choice-right' : ''}${mine && !right ? ' choice-wrong' : ''}`}>
                  <input type="radio" name={`${uid}-gap`} checked={gap.picked === o} onChange={() => setGap({ mode: 'on', picked: o, checked: false })} />
                  <span className="choice-text">{o}</span>
                  {gap.checked && right && <span className="choice-mark"><Mark kind="ok" />{mine ? 'Your answer — correct' : 'The page’s word'}</span>}
                  {mine && !right && <span className="choice-mark"><Mark kind="bad" />Your answer</span>}
                </label>
              );
            })}
          </fieldset>
          {!gap.checked && <button type="button" className="btn btn-primary" disabled={gap.picked === null} onClick={() => setGap({ mode: 'on', picked: gap.picked, checked: true })}>Lock in answer</button>}
          {gap.checked && (
            <>
              <div className={`grade ${gap.picked !== null && gradeGap(gapLink, gap.picked) ? 'grade-ok' : 'grade-miss'}`} role="status">
                <strong><Mark kind={gap.picked !== null && gradeGap(gapLink, gap.picked) ? 'ok' : 'bad'} />{gap.picked !== null && gradeGap(gapLink, gap.picked) ? 'Right' : 'Not quite'} — the page says “{relationSentence(spec, gapLink)}”.</strong>
              </div>
              <QuoteBlock componentId="concept-map-v1" part="link" id={gapLink.id} sourceId={gapLink.sourceId} quote={gapLink.quote} cite={cite} caption="The page’s words" />
            </>
          )}
        </section>
      )}
    </div>
  );
}
