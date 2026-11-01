import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { QuoteRef } from '../../lib/evidence.ts';
import type { Badge } from '../../lib/repairs.ts';
import type { Deck, PresentAction } from '../../lib/presentation.ts';
import {
  acceptsNumber, beatConcealed, beatRevealed, canRevealNow, creditLine, deckQuotes, heroBeatIndex, initialPresent, KEY_MAP, keyAction, keyContext, planBeats, presentReducer,
  presentSearch, quoteRefForLinks, revealQuote, stepCaption, trackLabel, visibleQuotes, zoneQuote, zoneQuoteSize,
} from '../../lib/presentation.ts';
import type { QuoteLike } from '../../lib/linking.ts';
import { linkKey, linkStore } from '../../lib/linking.ts';
import { Linked } from '../Linked.tsx';
import { LessonReviewContext } from '../LessonPartsContext.ts';
import type { CiteProps } from '../Explanations.tsx';
import { BeatView } from './Beats.tsx';
import { IconBlank, IconExit, IconFullscreen, IconKeys, IconNext, IconNotes, IconPrev } from './icons.tsx';

export interface PresentationModeProps {
  deck: Deck;
  /** Every quote the lesson shows (App's quote refs): "Show in source" inside a part puts its sentence on screen. */
  quotes: readonly QuoteRef[];
  sourceId: string;
  repairBadge: Badge | null;
  /** 0-based start beat (from the ?present=…&beat= deep link); HOOK_BEAT (-1) opens on the most visual ask. */
  startBeat: number;
  onExit: () => void;
}

const IDLE_MS = 2600;

function fullscreenElement(): Element | null {
  return typeof document === 'undefined' ? null : document.fullscreenElement ?? null;
}

/**
 * Presentation mode: the lesson as a paced sequence of beats over the whole screen (the Fullscreen API when the browser
 * allows it, else the whole window), driven from the keyboard or a clicker, with a bar that hides itself.
 */
export function PresentationMode({ deck, quotes, sourceId, repairBadge, startBeat, onExit }: PresentationModeProps) {
  const beats = useMemo(() => planBeats(deck), [deck]);
  const reducer = useMemo(() => presentReducer(beats), [beats]);
  const [state, dispatch] = useReducer(reducer, undefined, () => initialPresent(beats, startBeat));
  const beat = beats[state.beat] ?? beats[0];
  // The hook: the first part's first beat. It carries the one-line credit, so the first slide shown names the source and
  // says the lesson is AI-written and awaits review (the title sheet with the full credit stays one ← away).
  const hero = useMemo(() => heroBeatIndex(beats), [beats]);
  const credit = useMemo(() => creditLine(deck), [deck]);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const beatRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  const [fullRefused, setFullRefused] = useState(false);
  const [idle, setIdle] = useState(false);
  const [barHeld, setBarHeld] = useState(false);
  const [pinned, setPinned] = useState<QuoteLike | null>(null);
  const togglingOff = useRef(false);
  // A one-line key reminder on arrival; it goes after the first key press or a few seconds.
  const [keyHint, setKeyHint] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setKeyHint(false), 7000);
    return () => window.clearTimeout(t);
  }, []);

  // ---- full screen, the app behind made inert, focus ------------------------------------------------------------------
  useLayoutEffect(() => {
    const app = document.getElementById('root');
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (app !== null) app.inert = true;
    stageRef.current?.focus({ preventScroll: true });
    const el = rootRef.current;
    if (el !== null && typeof el.requestFullscreen === 'function' && document.fullscreenEnabled !== false) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => setIsFull(true), () => setFullRefused(true));
    } else {
      setFullRefused(true);
    }
    return () => {
      if (app !== null) app.inert = false;
      if (fullscreenElement() !== null) void document.exitFullscreen().catch(() => undefined);
      prevFocus?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onChange = (): void => {
      const full = fullscreenElement() === rootRef.current && rootRef.current !== null;
      setIsFull(full);
      // Leaving full screen with the browser's own Esc leaves presentation mode too; the F key only toggles full screen.
      if (!full && !togglingOff.current) onExit();
      togglingOff.current = false;
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [onExit]);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (el === null) return;
    if (fullscreenElement() !== null) {
      togglingOff.current = true;
      void document.exitFullscreen().catch(() => { togglingOff.current = false; });
    } else if (typeof el.requestFullscreen === 'function') {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => setFullRefused(false), () => setFullRefused(true));
    }
  }, []);

  // ---- a slide taller than its area is set smaller as a whole (once per beat, so a reveal never rescales it) -----------
  const beatId = beats[state.beat]?.id;
  useLayoutEffect(() => {
    const el = beatRef.current;
    if (el === null) return undefined;
    // The largest scale (0.6–1) at which the slide's content fits; text re-wraps as it shrinks, so search rather than divide.
    const fits = (f: number): boolean => {
      el.style.setProperty('--pz-fit', String(f));
      const body = el.firstElementChild;
      return !(body instanceof HTMLElement) || el.clientHeight <= 0 || body.scrollHeight <= el.clientHeight + 1;
    };
    const fit = (): void => {
      if (fits(1)) return;
      let lo = 0.6;
      let hi = 1;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid; else hi = mid;
      }
      fits(lo);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [beatId]);

  // ---- the address follows the beat, so a reload or a shared link lands here -----------------------------------------
  useEffect(() => {
    const next = presentSearch(window.location.search, deck.jobId, state.beat);
    if (next !== window.location.search) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next}${window.location.hash}`);
  }, [deck.jobId, state.beat]);

  // A new beat starts with no pinned quote, and focus returns to the stage so the keys keep working.
  useEffect(() => {
    setPinned(null);
    stageRef.current?.focus({ preventScroll: true });
  }, [state.beat]);
  // Every move (→, ←, R) drops the hover and focus links: a quote the pointer rested on (the zone's own, after R) never
  // outlives the answer it belonged to. The next pointer move over an element links it again.
  useEffect(() => { linkStore.clear(); }, [state.beat, state.step, state.revealed]);

  // ---- keyboard -----------------------------------------------------------------------------------------------------
  const act = useCallback((a: PresentAction) => dispatch(a), []);
  // On an open number question the digit keys type the class prediction (no field to click into first).
  const numeric = beat !== undefined && acceptsNumber(beat, state.step);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      const own = keyContext(t === null ? null : { tagName: t.tagName, type: (t as HTMLInputElement).type, isContentEditable: t.isContentEditable, role: t.getAttribute('role') });
      const ctx = own === 'none' && numeric ? 'numeric' : own;
      const a = keyAction(e, ctx);
      if (a === null) return;
      e.preventDefault();
      setIdle(true);
      setKeyHint(false);
      if (a === 'exit') {
        if (state.help) dispatch({ type: 'help' });
        else onExit();
      } else if (a === 'fullscreen') toggleFullscreen();
      else if (a === 'release') { t?.blur(); stageRef.current?.focus({ preventScroll: true }); }
      else dispatch(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit, toggleFullscreen, state.help, numeric]);

  // ---- the bar hides itself (and the pointer) when the mouse rests -----------------------------------------------------
  useEffect(() => {
    if (idle) return undefined;
    const t = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => window.clearTimeout(t);
  }, [idle]);
  const wake = useCallback(() => { setIdle(false); }, []);
  const barShown = !idle || barHeld || state.help;

  // ---- the quote zone: hovering a quoted value, "Show in source" and R all put the page's sentence in one place ---------
  const active = useSyncExternalStore(linkStore.subscribe, linkStore.get);
  const known = useMemo((): QuoteLike[] => [...quotes.map((q) => ({ sourceId, quote: q.quote })), ...deckQuotes(beats)], [quotes, sourceId, beats]);
  const hovered = useMemo(() => (active === null ? null : quoteRefForLinks(active.keys, known)), [active, known]);
  // Every quote this beat can put in the zone (its own quotes: hover, "Show in source" and R only ever show those). The
  // band is sized to the tallest of them once per beat, so neither a hover nor R changes its height.
  const reserve = useMemo((): QuoteLike[] => {
    const seen = new Set<string>();
    return (beat?.quotes ?? []).filter((q) => {
      const k = linkKey(q.sourceId, q.quote);
      if (k === '' || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [beat]);
  const cite = useMemo((): CiteProps => ({
    sourceId,
    located: new Set(quotes.map((q) => q.key)),
    onCite: (key: string) => {
      const q = quotes.find((r) => r.key === key);
      setPinned(q === undefined ? null : { sourceId, quote: q.quote });
    },
  }), [quotes, sourceId]);

  // A mouse click on a bar button or an answer option hands the keys back to the deck, so the next Space advances instead
  // of pressing that button again. Keyboard activation (detail 0) keeps focus where it is.
  const onClickCapture = (e: { detail: number; target: EventTarget }): void => {
    if (e.detail === 0 || !(e.target instanceof Element)) return;
    if (e.target.closest('.pz-bar, .pz-choice') !== null) window.setTimeout(() => stageRef.current?.focus({ preventScroll: true }), 0);
  };

  if (beat === undefined) return null;
  const n = beats.length;
  const revealable = canRevealNow(beat, state);
  const revealed = beatRevealed(beat, state);
  const next = beats[state.beat + 1];
  // One concealment policy (lib/conceal.ts): while an answer is open, no hover, pin or reveal shows a sentence that states it.
  const concealed = beatConcealed(beat, state);
  const zone = zoneQuote({ hovered, pinned, revealed: revealQuote(beat, state.step, state.revealed), visible: visibleQuotes(beat, state.step, beats), concealed });

  const view = (
    <div
      ref={rootRef}
      className="pz"
      data-idle={barShown ? 'false' : 'true'}
      data-full={isFull ? 'true' : 'false'}
      role="dialog"
      aria-modal="true"
      aria-label={`Presenting: ${deck.headline}`}
      onMouseMove={wake}
      onPointerDown={wake}
      onClickCapture={onClickCapture}
    >
      <div className="pz-live sr-only" aria-live="polite">{`Beat ${state.beat + 1} of ${n}: ${beat.title}${beat.kind === 'engine' && beat.steps > 1 ? `, question ${Math.min(state.step, beat.steps - 1) + 1} of ${beat.steps}` : ''}${revealed ? '. Revealed.' : ''}`}</div>

      <div ref={stageRef} className={`pz-stage-frame${state.notes ? ' pz-with-notes' : ''}`} tabIndex={-1} aria-label={beat.title}>
        {state.beat === hero && hero > 0 && credit !== null && <p className="pz-credit" title={credit}>{credit}</p>}
        <div key={beat.id} ref={beatRef} className="pz-beat" data-kind={beat.kind} data-revealed={revealed ? 'true' : 'false'}>
          <BeatView
            beat={beat}
            step={state.step}
            revealed={state.revealed}
            deck={deck}
            beats={beats}
            answer={state.answers[beat.id] ?? ''}
            onAnswer={(value) => dispatch({ type: 'answer', beatId: beat.id, value })}
            cite={cite}
            repairBadge={repairBadge}
            concealed={concealed}
          />
        </div>
        {/* One anchored band, centred under the slide and reserved in the layout: showing or hiding a quote never moves
            or covers the slide. Hover, "Show in source" and the reveal all put the page's sentence here. The band is as
            tall as the longest quote this beat can show (every one is laid out hidden in one stacked cell, decided once
            per beat), and a beat that cites nothing reserves no band, so the slide above gets the rest of the screen. */}
        <Linked
          as="figure" className="pz-zone" links={zone === null ? [] : [linkKey(zone.sourceId, zone.quote)]}
          data-filled={zone === null ? 'false' : 'true'} data-reserve={reserve.length === 0 ? 'none' : undefined} aria-live="polite"
        >
          <div className="pz-zone-sizer" aria-hidden="true">
            {reserve.map((q) => (
              <div key={linkKey(q.sourceId, q.quote)} className="pz-zone-quote" data-size={zoneQuoteSize(q.quote)}>
                <p className="pz-zone-cap">The page says</p>
                <blockquote>“{q.quote}”</blockquote>
              </div>
            ))}
          </div>
          {zone !== null && (
            <div className="pz-zone-quote pz-zone-live" data-size={zoneQuoteSize(zone.quote)}>
              <figcaption className="pz-zone-cap">The page says</figcaption>
              <blockquote key={zone.quote}>“{zone.quote}”</blockquote>
            </div>
          )}
        </Linked>
      </div>

      {state.notes && (
        <aside className="pz-notes" aria-label="Presenter notes">
          <h2>Notes</h2>
          <p className="pz-notes-cue">{beat.cue}</p>
          {beat.quotes.length > 0 && (
            <>
              <h3>The page’s words</h3>
              <ul>{beat.quotes.slice(0, 4).map((q) => <li key={q.quote}><blockquote>“{q.quote}”</blockquote></li>)}</ul>
              {beat.quotes.length > 4 && <p className="pz-notes-more">and {beat.quotes.length - 4} more</p>}
            </>
          )}
          <p className="pz-notes-next">{next === undefined ? 'Last beat.' : `Next: ${next.label}${next.title === next.label ? '' : ` — ${next.title}`}`}</p>
        </aside>
      )}

      {keyHint && !state.blank && (
        <p className="pz-keyhint" aria-hidden="true">
          <span><kbd>→</kbd> next</span><span><kbd>R</kbd> reveal</span><span><kbd>B</kbd> / <kbd>W</kbd> black or white screen</span>
          {!isFull && <span><kbd>F</kbd> full screen</span>}<span><kbd>?</kbd> all keys</span>
        </p>
      )}

      <div className="pz-progress" aria-hidden="true"><span style={{ inlineSize: `${((state.beat + 1) / n) * 100}%` }} /></div>

      <nav
        className="pz-bar"
        aria-label="Presentation controls"
        data-shown={barShown ? 'true' : 'false'}
        onMouseEnter={() => setBarHeld(true)}
        onMouseLeave={() => setBarHeld(false)}
        onFocus={() => setBarHeld(true)}
        onBlur={(e) => { if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setBarHeld(false); }}
      >
        <button type="button" className="pz-tool" onClick={onExit} aria-label="Leave presentation (Esc)" title="Leave presentation (Esc)"><IconExit /><span>Exit</span></button>
        {state.beat === hero && hero > 0 && (
          <button type="button" className="pz-tool pz-tool-quiet" onClick={() => act({ type: 'first' })} title="The title sheet with the full credit, then every slide in order (Home)">Start from the beginning</button>
        )}
        <span className="pz-bar-sep" aria-hidden="true" />
        <button type="button" className="pz-tool pz-tool-big" onClick={() => act({ type: 'prev' })} aria-label="Back (←)" title="Back (←)" disabled={state.beat === 0 && state.step === 0}><IconPrev /></button>
        <ol className="pz-track">
          {beats.map((b, i) => (
            <li key={b.id} data-state={i < state.beat ? 'done' : i === state.beat ? 'current' : 'todo'}>
              <button type="button" onClick={() => act({ type: 'jump', beat: i })} aria-current={i === state.beat ? 'step' : undefined} title={`${i + 1}. ${b.title}`}>
                <span className="pz-track-label">{trackLabel(b)}</span>
              </button>
            </li>
          ))}
        </ol>
        <p className="pz-now" aria-hidden="true"><span className="pz-now-step">{stepCaption(beat, state)}</span><span className="pz-count num">{state.beat + 1} / {n}</span></p>
        {revealable && (beat.steps === 2 || beat.kind === 'engine') && (
          <button type="button" className="pz-tool pz-tool-big pz-tool-strong" onClick={() => act({ type: 'reveal' })} title="Reveal (R)"><span>Reveal</span><kbd>R</kbd></button>
        )}
        <button type="button" className="pz-tool pz-tool-big pz-tool-next" onClick={() => act({ type: 'next' })} aria-label="Next (→)" title="Next (→)" disabled={state.beat === n - 1 && state.step >= beat.steps - 1}><span>Next</span><IconNext /></button>
        <span className="pz-bar-sep" aria-hidden="true" />
        <button type="button" className="pz-tool" onClick={() => act({ type: 'notes' })} aria-pressed={state.notes} aria-label="Presenter notes (P)" title="Presenter notes (P)"><IconNotes /></button>
        <button type="button" className="pz-tool" onClick={() => act({ type: 'blank' })} aria-label="Black screen (B)" title="Black screen (B)"><IconBlank /></button>
        <button type="button" className="pz-tool" onClick={toggleFullscreen} aria-pressed={isFull} aria-label="Full screen (F)" title={fullRefused && !isFull ? 'Full screen (F) — the browser needs a key press or click first' : 'Full screen (F)'}><IconFullscreen /></button>
        <button type="button" className="pz-tool" onClick={() => act({ type: 'help' })} aria-pressed={state.help} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)"><IconKeys /></button>
      </nav>

      {state.help && (
        <section className="pz-help" aria-label="Keyboard shortcuts">
          <h2>Keys</h2>
          <dl>
            {KEY_MAP.map((k) => <div key={k.keys}><dt>{k.keys.split('  ').map((key) => <kbd key={key}>{key}</kbd>)}</dt><dd>{k.does}</dd></div>)}
          </dl>
          <p className="pz-fine">A clicker’s page keys work too. Keys typed into a field stay in the field; Esc lets go of it.</p>
        </section>
      )}

      {state.blank && (
        <button
          type="button" className="pz-blank" data-tone={state.blankTone}
          onClick={() => act(state.blankTone === 'white' ? { type: 'blank', tone: 'white' } : { type: 'blank' })}
          aria-label={state.blankTone === 'white' ? 'White screen. Press W or click to return.' : 'Black screen. Press B or click to return.'}
        />
      )}
    </div>
  );
  // Stage 10b: parts shown on the slides read "teacher-reviewed" when the lesson was published.
  return createPortal(<LessonReviewContext.Provider value={deck.review ?? null}>{view}</LessonReviewContext.Provider>, document.body);
}
