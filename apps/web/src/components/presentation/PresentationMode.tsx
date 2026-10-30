import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { QuoteRef } from '../../lib/evidence.ts';
import type { Badge } from '../../lib/repairs.ts';
import type { Deck, PresentAction } from '../../lib/presentation.ts';
import { acceptsNumber, canReveal, initialPresent, isRevealed, KEY_MAP, keyAction, keyContext, planBeats, presentReducer, presentSearch, quoteForLinks } from '../../lib/presentation.ts';
import { linkStore } from '../../lib/linking.ts';
import type { CiteProps } from '../Explanations.tsx';
import { BeatView } from './Beats.tsx';
import { IconBlank, IconExit, IconFullscreen, IconKeys, IconNext, IconNotes, IconPrev } from './icons.tsx';

export interface PresentationModeProps {
  deck: Deck;
  /** Every quote the lesson shows (App's quote refs): "Show in source" inside a part puts its sentence on screen. */
  quotes: readonly QuoteRef[];
  sourceId: string;
  repairBadge: Badge | null;
  /** 0-based start beat (from the ?present=…&beat= deep link). */
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
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  const [fullRefused, setFullRefused] = useState(false);
  const [idle, setIdle] = useState(false);
  const [barHeld, setBarHeld] = useState(false);
  const [pinned, setPinned] = useState<string | null>(null);
  // The quote strip sits at the edge away from the pointer, so it never covers what is being pointed at.
  const [stripAtTop, setStripAtTop] = useState(false);
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
  const wake = useCallback((e: { clientY: number }) => {
    setIdle(false);
    setStripAtTop(e.clientY > window.innerHeight * 0.55);
  }, []);
  const barShown = !idle || barHeld || state.help;

  // ---- hovering a quoted value shows its sentence -------------------------------------------------------------------
  const active = useSyncExternalStore(linkStore.subscribe, linkStore.get);
  const hovered = useMemo(() => (active === null ? null : quoteForLinks(active.keys, quotes.map((q) => ({ sourceId, quote: q.quote })))), [active, quotes, sourceId]);
  const shownQuote = hovered ?? pinned;
  const cite = useMemo((): CiteProps => ({
    sourceId,
    located: new Set(quotes.map((q) => q.key)),
    onCite: (key: string) => setPinned(quotes.find((q) => q.key === key)?.quote ?? null),
  }), [quotes, sourceId]);

  // A mouse click on a bar button or an answer option hands the keys back to the deck, so the next Space advances instead
  // of pressing that button again. Keyboard activation (detail 0) keeps focus where it is.
  const onClickCapture = (e: { detail: number; target: EventTarget }): void => {
    if (e.detail === 0 || !(e.target instanceof Element)) return;
    if (e.target.closest('.pz-bar, .pz-choice') !== null) window.setTimeout(() => stageRef.current?.focus({ preventScroll: true }), 0);
  };

  if (beat === undefined) return null;
  const n = beats.length;
  const revealable = canReveal(beat, state.step);
  const revealed = isRevealed(beat, state.step);
  const next = beats[state.beat + 1];

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
      <div className="pz-live sr-only" aria-live="polite">{`Beat ${state.beat + 1} of ${n}: ${beat.title}${revealed ? '. Revealed.' : ''}`}</div>

      <div ref={stageRef} className={`pz-stage-frame${state.notes ? ' pz-with-notes' : ''}`} tabIndex={-1} aria-label={beat.title}>
        <div key={beat.id} className="pz-beat" data-kind={beat.kind} data-revealed={revealed ? 'true' : 'false'}>
          <BeatView
            beat={beat}
            step={state.step}
            deck={deck}
            beats={beats}
            answer={state.answers[beat.id] ?? ''}
            onAnswer={(value) => dispatch({ type: 'answer', beatId: beat.id, value })}
            cite={cite}
            repairBadge={repairBadge}
          />
        </div>
      </div>

      {shownQuote !== null && !state.blank && (
        <figure className="pz-quote-strip" data-at={stripAtTop ? 'top' : 'bottom'} aria-live="polite">
          <figcaption>From the page</figcaption>
          <blockquote>“{shownQuote}”</blockquote>
        </figure>
      )}

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
        <span className="pz-bar-sep" aria-hidden="true" />
        <button type="button" className="pz-tool" onClick={() => act({ type: 'prev' })} aria-label="Back (←)" title="Back (←)" disabled={state.beat === 0 && state.step === 0}><IconPrev /></button>
        <ol className="pz-track">
          {beats.map((b, i) => (
            <li key={b.id} data-state={i < state.beat ? 'done' : i === state.beat ? 'current' : 'todo'}>
              <button type="button" onClick={() => act({ type: 'jump', beat: i })} aria-current={i === state.beat ? 'step' : undefined} title={`${i + 1}. ${b.title}`}>
                <span className="pz-track-label">{b.label}</span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="pz-tool" onClick={() => act({ type: 'next' })} aria-label="Next (→)" title="Next (→)" disabled={state.beat === n - 1 && state.step >= beat.steps - 1}><IconNext /></button>
        <span className="pz-count num" aria-hidden="true">{state.beat + 1}/{n}</span>
        <span className="pz-bar-sep" aria-hidden="true" />
        {revealable && beat.steps === 2 && (
          <button type="button" className="pz-tool pz-tool-strong" onClick={() => act({ type: 'reveal' })} title="Reveal (R)"><span>Reveal</span><kbd>R</kbd></button>
        )}
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
  return createPortal(view, document.body);
}
