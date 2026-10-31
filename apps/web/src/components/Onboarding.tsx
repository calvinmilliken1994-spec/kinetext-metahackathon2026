// Stage 9b: the first-run tour (docs/specs/STAGE-9b-onboarding-and-live-build-2.md). A dim backdrop with a cut-out
// around the step's target and a compact card beside it. The step machine, its wording and the card placement are pure
// (lib/onboarding.ts); this file only measures targets and draws. No confetti, no bounce, no glow: one opacity fade.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Rect, TourOutcome, TourSignals, TourStep } from '../lib/onboarding.ts';
import { activeSteps, autoAdvance, canGoNext, clipRect, placeCard, unionRect } from '../lib/onboarding.ts';
import { revealInPanels } from '../lib/scroll.ts';

export interface OnboardingProps {
  signals: TourSignals;
  /** Plays the tour's recorded run (labelled as a replay) in the lesson column. */
  onStartReplay: () => void;
  /** Opens the finished lesson in presentation mode. */
  onPresent: () => void;
  /** The tour ended: finished, or skipped (both are remembered so it does not open by itself again). */
  onClose: (how: TourOutcome) => void;
  /** Each time a step is entered, so the app can open what it points at (the source panel). */
  onStep?: (step: TourStep) => void;
}

const PAD = 8;
const sameRects = (a: readonly Rect[], b: readonly Rect[]): boolean =>
  a.length === b.length && a.every((r, i) => {
    const q = b[i];
    return q !== undefined && Math.abs(r.x - q.x) < 0.5 && Math.abs(r.y - q.y) < 0.5 && Math.abs(r.w - q.w) < 0.5 && Math.abs(r.h - q.h) < 0.5;
  });

const grow = (r: Rect, by: number): Rect => ({ x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by });
const box = (el: Element): Rect => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };

/** What of `el` can be seen: its box clipped by every ancestor that clips its overflow, up to the app window. */
function visibleBox(el: HTMLElement): Rect | null {
  let r: Rect | null = box(el);
  for (let node = el.parentElement; node !== null && r !== null; node = node.parentElement) {
    if (node === document.body) break;
    if (getComputedStyle(node).overflowY !== 'visible' || node.classList.contains('app-window')) r = clipRect(r, box(node));
    if (node.classList.contains('app-window')) break;
  }
  return r;
}

/** The visible part of each target, padded, per selector (the first selector is the step's main target). */
function measure(selectors: readonly string[]): Rect[][] {
  const vp: Rect = { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  return selectors.map((sel) => {
    const out: Rect[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const v = visibleBox(el);
      const c = v === null || v.w < 1 || v.h < 1 ? null : clipRect(grow(v, PAD), vp);
      if (c !== null) out.push(c);
    }
    return out;
  });
}

function holePath(rects: readonly Rect[], w: number, h: number): string {
  const rr = (r: Rect, rad = 12): string => {
    const k = Math.min(rad, r.w / 2, r.h / 2);
    return `M${r.x + k} ${r.y}H${r.x + r.w - k}A${k} ${k} 0 0 1 ${r.x + r.w} ${r.y + k}V${r.y + r.h - k}A${k} ${k} 0 0 1 ${r.x + r.w - k} ${r.y + r.h}H${r.x + k}A${k} ${k} 0 0 1 ${r.x} ${r.y + r.h - k}V${r.y + k}A${k} ${k} 0 0 1 ${r.x + k} ${r.y}Z`;
  };
  return `M0 0H${w}V${h}H0Z${rects.map((r) => rr(r)).join('')}`;
}

export function Onboarding({ signals, onStartReplay, onPresent, onClose, onStep }: OnboardingProps) {
  const steps = activeSteps(signals);
  const [state, setState] = useState(() => ({ index: 0, enteredAt: Date.now() }));
  const index = Math.min(state.index, steps.length - 1);
  const step = steps[index] as TourStep;
  const titleId = useId();
  const bodyId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const [groups, setGroups] = useState<Rect[][]>([]);
  const rects = groups.flat();
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(null);

  // Replay steps move on by themselves once the recorded run has passed their moment (checked four times a second).
  const live = useRef({ steps, signals });
  live.current = { steps, signals };
  useEffect(() => {
    const t = setInterval(() => setState((s) => autoAdvance(s, live.current.steps, live.current.signals, Date.now())), 250);
    return () => clearInterval(t);
  }, []);

  const go = useCallback((to: number) => setState({ index: to, enteredAt: Date.now() }), []);
  const next = (): void => {
    if (step.primary === 'replay') onStartReplay();
    if (step.primary === 'present') { onPresent(); onClose('done'); return; }
    if (step.primary === 'finish' || index === steps.length - 1) { onClose('done'); return; }
    go(index + 1);
  };
  const nextReady = step.primary === 'replay' ? !signals.replayLoading : step.primary === 'present' || step.primary === 'finish' || canGoNext(steps, index, signals);

  // Entering a step: let the app open what it points at, bring the target into view, then focus the card's heading.
  const stepId = step.id;
  useEffect(() => {
    onStep?.(step);
    const first = step.targets.length === 0 ? null : document.querySelector<HTMLElement>(step.targets[0] as string);
    if (first !== null && step.id === 'try') revealInPanels(first, 'start', 140);
    document.getElementById(titleId)?.focus({ preventScroll: true });
  }, [stepId]);

  // Follow the targets while they move (the replay keeps adding content, panels scroll). Cheap: a few rects per frame,
  // and state only changes when a rect really moved.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const g = measure(step.targets);
      setGroups((prev) => (prev.length === g.length && prev.every((p, i) => sameRects(p, g[i] ?? [])) ? prev : g));
      setVp((p) => (p.w === window.innerWidth && p.h === window.innerHeight ? p : { w: window.innerWidth, h: window.innerHeight }));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step.targets.join('|')]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    const size = { w: el.offsetWidth, h: el.offsetHeight };
    setCardSize((p) => (p !== null && p.w === size.w && p.h === size.h ? p : size));
  });

  // Esc skips the tour (before the drawer's own Esc handler sees it). Tab stays inside the card, except on the step
  // where the teacher tries the part, whose controls must be reachable.
  const interactive = step.interactive;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose('skipped');
        return;
      }
      if (e.key !== 'Tab' || interactive) return;
      const card = cardRef.current;
      if (card === null) return;
      const items = [...card.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')];
      if (items.length === 0) return;
      const first = items[0] as HTMLElement;
      const last = items[items.length - 1] as HTMLElement;
      const inside = card.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === card.querySelector('.tour-title'))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, interactive]);

  // The card sits beside the main target (the first selector), clear of every cut-out.
  const target = unionRect(groups[0] ?? []) ?? unionRect(rects);
  const waitingForTarget = step.targets.length > 0 && target === null;
  const pos = cardSize === null ? null : placeCard(waitingForTarget ? null : target, vp, cardSize, rects);
  const last = index === steps.length - 1;

  return (
    <div className="tour" data-testid="tour" data-step={step.id} data-interactive={step.interactive ? 'true' : 'false'}>
      <svg className="tour-scrim" width={vp.w} height={vp.h} viewBox={`0 0 ${vp.w} ${vp.h}`} aria-hidden="true">
        <path className="tour-dim" d={holePath(rects, vp.w, vp.h)} fillRule="evenodd" />
        {/* Outside a cut-out, clicks are held back; inside one, only on the step where the teacher tries the part. */}
        {!step.interactive && rects.map((r, i) => <rect key={`b${i}`} className="tour-block" x={r.x} y={r.y} width={r.w} height={r.h} />)}
        {rects.map((r, i) => <rect key={`o${i}`} className="tour-ring" x={r.x + 0.5} y={r.y + 0.5} width={Math.max(0, r.w - 1)} height={Math.max(0, r.h - 1)} rx="12" />)}
      </svg>
      <div
        ref={cardRef} className="tour-card" role="dialog" aria-modal={step.interactive ? 'false' : 'true'} aria-labelledby={titleId} aria-describedby={bodyId}
        data-side={pos?.side ?? 'center'} style={pos === null ? { opacity: 0 } : { left: pos.x, top: pos.y }} key={step.id}
      >
        <p className="tour-count">Step {index + 1} of {steps.length}</p>
        <h2 id={titleId} className="tour-title" tabIndex={-1}>{step.title}</h2>
        <p id={bodyId} className="tour-body">{step.body}</p>
        {!nextReady && <p className="tour-wait" role="status">{step.primary === 'replay' ? 'Loading the recorded run…' : 'The next step starts when the replay gets there.'}</p>}
        <div className="tour-actions">
          <button type="button" className="link-btn tour-skip" onClick={() => onClose('skipped')}>{last ? 'Close' : 'Skip tour'}</button>
          <span className="tour-spacer" />
          {index > 0 && <button type="button" className="btn btn-quiet" onClick={() => go(index - 1)}>Back</button>}
          <button type="button" className="btn btn-primary" onClick={next} disabled={!nextReady}>{step.primaryLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** The rail's way back into the tour (drawn here so the icon set stays untouched). */
export function IconTour({ size = 20 }: { size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="m14.8 9.2-1.9 3.7-3.7 1.9 1.9-3.7z" />
    </svg>
  );
}
