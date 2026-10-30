import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent as ReactFocusEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { Loadable } from '../hooks.ts';
import type { SourceDoc, SourceMeta } from '../api.ts';
import type { HighlightResult } from '../lib/highlight.ts';
import { isEvidenceKey } from '../lib/evidence.ts';
import type { QuoteRef } from '../lib/evidence.ts';
import { linkStore, markLinks, segmentIsTabStop } from '../lib/linking.ts';
import { revealInPanels, scrollContainersOf, scrollTopToReveal } from '../lib/scroll.ts';
import { sourceDecorations, sourcePieces } from '../lib/sourceText.ts';
import { isHttpUrl, sourceLicenseText, TEACHER_TAG } from '../lib/sources.ts';
import { sourceMetaLine } from '../lib/lessonLayout.ts';
import { CitationChip } from './Explanations.tsx';
import { IconChevronDown, IconExternal, IconSourcePanel } from './icons.tsx';
import { SourcePicker } from './SourcePicker.tsx';

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
  /** Collapse the panel to its slim tab (slice L; App keeps the choice across visits). */
  onCollapse: () => void;
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const linksOf = (el: Element | null): string[] => (el?.getAttribute('data-links') ?? '').split(' ').filter((k) => k !== '');
const markOf = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>('mark[data-links]') : null);

/**
 * Bring a lit quote into view inside the source text only — never the workspace or the page, so the lesson element under
 * the pointer does not move. Nothing scrolls when the quote is already visible.
 */
function revealInSource(mark: HTMLElement, panel: HTMLElement): void {
  const box = scrollContainersOf(mark)[0];
  if (box === undefined || !panel.contains(box)) return;
  const r = box.getBoundingClientRect();
  const m = mark.getBoundingClientRect();
  if (m.top >= r.top + 8 && m.bottom <= r.bottom - 8) return;
  const top = scrollTopToReveal({ top: r.top + box.clientTop, height: box.clientHeight, scrollTop: box.scrollTop, scrollHeight: box.scrollHeight }, { top: m.top, height: m.height }, 'center');
  box.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

function HighlightedText({ text, highlights, byKey, flash, sourceId }: { text: string; highlights: HighlightResult | null; byKey: Map<string, QuoteRef>; flash: Flash | null; sourceId: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (root === null || flash === null) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>('mark[data-keys]'))
      .filter((m) => (m.dataset['keys'] ?? '').split(' ').includes(flash.key));
    const first = marks[0];
    if (first === undefined) return;
    // Scroll the source text (and, when the layout is stacked, the workspace) — never the page or the window.
    revealInPanels(first, 'center');
    for (const m of marks) {
      m.classList.remove('flash');
      void m.offsetWidth; // restart the CSS animation
      m.classList.add('flash');
    }
    const timer = setTimeout(() => { for (const m of marks) m.classList.remove('flash'); }, 2000);
    return () => clearTimeout(timer);
  }, [flash]);

  // The stored text keeps its markdown (its hash is pinned); markers are hidden and form-like label lines joined by
  // character range (lib/sourceText.ts), so every quote offset still points at the exact stored characters.
  const decorations = useMemo(() => sourceDecorations(text), [text]);
  const parts = useMemo(() => {
    const pieces = sourcePieces(text, highlights === null ? null : highlights.segments, decorations);
    return pieces.map((p) => {
      const slice = text.slice(p.start, p.end);
      if (p.hidden) return <span key={p.start} className="md-hide" aria-hidden="true">{slice}</span>;
      const cls = p.classes.join(' ');
      if (p.keys.length === 0) return cls === '' ? <span key={p.start}>{slice}</span> : <span key={p.start} className={cls}>{slice}</span>;
      const isEvidence = p.keys.some(isEvidenceKey);
      const owners = [...new Set(p.keys.map((k) => byKey.get(k)?.ownerLabel ?? k))].join(', ');
      // Hover linking (Stage 7): the quote's link keys, and one tab stop where each quote begins.
      const links = markLinks(p.keys, (k) => byKey.get(k)?.quote, sourceId);
      const tabStop = links.length > 0 && highlights !== null && segmentIsTabStop(p, highlights.ranges);
      return (
        <mark
          key={p.start}
          data-keys={p.keys.join(' ')}
          data-links={links.length > 0 ? links.join(' ') : undefined}
          tabIndex={tabStop ? 0 : undefined}
          className={`${isEvidence ? 'ev-explanation' : 'ev-concept'}${cls === '' ? '' : ` ${cls}`}`}
          title={`Evidence for: ${owners}`}
        >
          {slice}
        </mark>
      );
    });
  }, [text, highlights, decorations, byKey, sourceId]);

  // Light every mark that carries an active link key; when the pointer is on a lesson element, bring its first quote into
  // view after a short dwell (so sweeping the pointer across the lesson does not make the page jump).
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = (): void => {
      const active = linkStore.get();
      const keys = new Set(active?.keys ?? []);
      let first: HTMLElement | null = null;
      for (const m of Array.from(root.querySelectorAll<HTMLElement>('mark[data-links]'))) {
        const on = keys.size > 0 && linksOf(m).some((k) => keys.has(k));
        m.classList.toggle('is-linked', on);
        if (on && first === null) first = m;
      }
      if (timer !== null) { clearTimeout(timer); timer = null; }
      const panel = root.closest<HTMLElement>('.source-panel');
      if (first !== null && active?.origin === 'lesson' && panel !== null) {
        const target = first;
        timer = setTimeout(() => revealInSource(target, panel), 160);
      }
    };
    apply();
    const off = linkStore.subscribe(apply);
    return () => { off(); if (timer !== null) clearTimeout(timer); };
  }, [parts]);

  // Hovering or focusing a quote lights every lesson element that cites it (one delegated listener for all marks).
  const over = (e: ReactMouseEvent): void => {
    const m = markOf(e.target);
    if (m !== null) linkStore.enter('source:hover', linksOf(m), 'source');
  };
  const out = (e: ReactMouseEvent): void => {
    const m = markOf(e.target);
    if (m !== null && markOf(e.relatedTarget) !== m) linkStore.leave('source:hover');
  };
  const focus = (e: ReactFocusEvent): void => {
    const m = markOf(e.target);
    if (m !== null) linkStore.enter('source:focus', linksOf(m), 'source');
  };
  const blur = (): void => linkStore.leave('source:focus');
  useEffect(() => () => { linkStore.leave('source:hover'); linkStore.leave('source:focus'); }, []);

  return (
    <div ref={ref} className="source-text" tabIndex={0} aria-label="Source text with highlighted evidence quotes" onMouseOver={over} onMouseOut={out} onFocus={focus} onBlur={blur}>
      {parts}
    </div>
  );
}

export function SourcePanel({ sources, selectedId, onSelect, onReload, doc, highlights, quotes, flash, onCite, onCollapse }: SourcePanelProps) {
  const byKey = useMemo(() => new Map(quotes.map((q) => [q.key, q] as const)), [quotes]);
  const concepts = quotes.filter((q) => q.kind === 'concept');
  const located = highlights ? Object.keys(highlights.ranges).length : 0;
  const meta = sources.state === 'ready' ? sources.data.find((s) => s.id === selectedId) : undefined;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  const foundCount = highlights === null || quotes.length === 0 ? null : quotes.filter((q) => highlights.ranges[q.key] !== undefined).length;

  return (
    <section className="panel source-panel" aria-labelledby="source-heading">
      <div className="source-head">
        <h2 id="source-heading" className="sr-only">Source page</h2>
        <div className="source-head-row">
          {sources.state === 'loading' && <p className="muted">Loading pages…</p>}
          {sources.state === 'error' && (
            <div className="callout callout-error" role="alert">
              {sources.message} <button type="button" className="btn btn-small" onClick={onReload}>Retry</button>
            </div>
          )}
          {sources.state === 'ready' && sources.data.length === 0 && <p className="muted">No licensed pages are registered.</p>}
          {sources.state === 'ready' && sources.data.length > 0 && (
            <SourcePicker
              id="source-select"
              label="Source page"
              sources={sources.data}
              selectedId={selectedId}
              onSelect={(id) => { onSelect(id); setDetailsOpen(false); }}
              filter={null}
              onFilter={() => undefined}
              compact
            />
          )}
          <button type="button" className="icon-btn source-collapse" onClick={onCollapse} aria-label="Collapse the source page" title="Collapse the source page">
            <IconChevronDown size={18} className="icon-left" />
          </button>
        </div>

        {meta !== undefined && (
          <p className="source-meta">
            <span className="source-meta-main">
              {meta.kind === 'user' ? `${TEACHER_TAG} · ` : ''}
              {sourceMetaLine({ licence: sourceLicenseText(meta), found: foundCount, total: quotes.length })}
            </span>
            {isHttpUrl(meta.locator) && (
              <>
                <span className="source-meta-sep" aria-hidden="true">·</span>
                <a href={meta.locator} target="_blank" rel="noopener noreferrer">Original <IconExternal size={14} /><span className="sr-only"> page (opens in a new tab)</span></a>
              </>
            )}
            <span className="source-meta-sep" aria-hidden="true">·</span>
            <button type="button" className="link-btn" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen((v) => !v)}>
              {detailsOpen ? 'Hide details' : 'Credit & key'}
            </button>
          </p>
        )}

        {meta !== undefined && detailsOpen && (
          <div id={detailsId} className="source-details">
            <p className="attribution">{meta.attribution}</p>
            {!isHttpUrl(meta.locator) && <p className="attribution">{meta.locator}</p>}
            <p className="attribution">Text fingerprint (SHA-256): <code>{meta.sha256}</code></p>
            {highlights !== null && quotes.length > 0 && (
              <p className="legend" aria-label="Highlight key">
                <span><mark className="ev-explanation">Quoted</mark> by the lesson</span>
                <span><mark className="ev-concept">Concept</mark> Muse found</span>
                <span className="muted">{located} of {quotes.length} quotes found on the page · point at one to see where the lesson uses it</span>
              </p>
            )}
            {concepts.length > 0 && (
              <div className="concepts">
                <h3 className="section-title">Concepts Muse found</h3>
                <div className="chips">
                  {[...new Map(concepts.map((c) => [c.ownerId, c] as const)).values()].map((c) => (
                    <CitationChip key={c.key} label={c.ownerLabel} quote={c.quote} citeKey={c.key} enabled={highlights?.ranges[c.key] !== undefined} onCite={onCite} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="source-scroll">
        {doc === null && <p className="muted pad">Select a page.</p>}
        {doc?.state === 'loading' && <p className="muted pad">Loading the page…</p>}
        {doc?.state === 'error' && <div className="callout callout-error" role="alert">{doc.message}</div>}
        {doc?.state === 'ready' && <HighlightedText text={doc.data.text} highlights={highlights} byKey={byKey} flash={flash} sourceId={selectedId ?? ''} />}
      </div>
    </section>
  );
}

/**
 * The collapsed source page: a slim tab at the window's left edge. Pressing it brings the page back (the choice is kept
 * across visits by App). It names what it opens and how many of the lesson's quotes the page shows.
 */
export function SourceTab({ onExpand, found, total }: { onExpand: () => void; found: number | null; total: number }) {
  const count = found === null || total === 0 ? null : `${found}/${total}`;
  return (
    <div className="source-tab-wrap">
      <button
        type="button"
        className="source-tab"
        onClick={onExpand}
        aria-label={`Show the source page${count === null ? '' : `, ${found} of ${total} quotes found`}`}
        title="Show the source page"
        data-testid="source-tab"
      >
        <IconSourcePanel size={18} />
        <span className="source-tab-label" aria-hidden="true">Source page</span>
        {count !== null && <span className="source-tab-count" aria-hidden="true">{count}</span>}
      </button>
    </div>
  );
}
