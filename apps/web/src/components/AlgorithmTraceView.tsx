// Stage 8a algorithm-trace-v1 view (slice W-A, docs/specs/STAGE-8a-subject-engines.md §1a, §4).
// The list is drawn as value bars; our engine's frames (lib/algorithmView.ts) say which bars are compared, swapped,
// written, settled or out of range. Before each decision the class predicts (swap or not, where an item lands, which half),
// then the next frames reveal it. The view computes nothing itself: it only reads the engine's trace.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AlgorithmTraceSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  algorithmTrace, boardAt, boardRooms, gradeChoice, movesLabel, presentationFrame, swapPair, teachingPoints, traceLede, variantNote,
} from '../lib/algorithmView.ts';
import type { BoardMarkers, BoardRooms, BoardView, PredictPoint } from '../lib/algorithmView.ts';
import { aiLabel, capitalFirst } from '../lib/displayText.ts';
import { lessonQuoteKey } from '../lib/lesson.ts';
import { linkKey } from '../lib/linking.ts';
import { CitationChip } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { IconPause, IconPlay, IconReset, Mark } from './icons.tsx';

export interface AlgorithmTraceViewProps { spec: AlgorithmTraceSpec; cite: CiteProps; presentation?: EnginePresentation }

const COMPONENT = 'algorithm-trace-v1';
/** Pace of the frames between a prediction and its answer (an item shifting into place). */
const RUN_MS = 380;
/** Pace of Play. */
const PLAY_MS = 900;

function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (): void => setReduced(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

function Chevron({ dir }: { dir: 'back' | 'next' }) {
  return (
    <svg className="icon" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={dir === 'back' ? 'M14.5 6 8.5 12l6 6' : 'M9.5 6l6 6-6 6'} />
    </svg>
  );
}

function tagsAt(m: BoardMarkers, i: number): string {
  const t: string[] = [];
  if (m.lo === i) t.push('lo');
  if (m.mid === i) t.push('mid');
  if (m.hi === i) t.push('hi');
  if (m.pivot === i) t.push('pivot');
  if (m.min === i) t.push('min');
  if (m.key === i) t.push('key');
  return t.join(' · ');
}

function rangeLabel(spec: AlgorithmTraceSpec, view: BoardView): string {
  if (spec.algorithm === 'merge-sort') return view.op === 'split' ? 'Split here' : view.op === 'merge' ? 'Merged' : 'Merging';
  if (spec.algorithm === 'quicksort') return 'Partition';
  return 'Search range';
}

/** What a screen reader hears for the board: the list, then the engine's note. */
function boardLabel(view: BoardView): string {
  const values = view.cells.map((c) => c.value).join(', ');
  return `List: ${values}. ${view.note}`;
}

function Board({ spec, view, choices, rooms }: { spec: AlgorithmTraceSpec; view: BoardView; choices: readonly number[] | null; rooms: BoardRooms }) {
  const n = view.cells.length;
  const pair = swapPair(view);
  return (
    <figure
      className="at-board" style={{ '--n': n } as CSSProperties} data-op={view.op}
      data-ranged={spec.algorithm === 'binary-search' || spec.algorithm === 'merge-sort' || spec.algorithm === 'quicksort' ? 'true' : 'false'}
      data-tags={rooms.tags ? 'true' : 'false'} data-arc={rooms.swapArc ? 'true' : 'false'}
      data-testid="algorithm-board"
    >
      <div className="at-cols" role="img" aria-label={boardLabel(view)}>
        {view.cells.map((c) => (
          <div
            key={c.index}
            className="at-col"
            data-mark={c.mark}
            data-settled={c.settled ? 'true' : undefined}
            data-out={c.out ? 'true' : undefined}
            data-choice={choices?.includes(c.index) === true ? 'true' : undefined}
          >
            <div className="at-bar-room"><div className="at-bar" style={{ '--h': c.scale } as CSSProperties} /></div>
            <span className="at-val">{c.value}</span>
            <span className="at-idx">{c.index}</span>
            <span className="at-tag">{tagsAt(view.markers, c.index)}</span>
          </div>
        ))}
      </div>
      <div className="at-overlay" aria-hidden="true">
        {view.range !== null && (
          <div className="at-range" style={{ gridColumn: `${view.range[0] + 1} / ${view.range[1] + 2}` }}><span>{rangeLabel(spec, view)}</span></div>
        )}
        {view.split !== null && view.range !== null && view.split > view.range[0] && <div className="at-split" style={{ gridColumn: `${view.split + 1}` }} />}
      </div>
      {/* The swap-arc band; its room is dropped (data-arc="false") when this trace never swaps. */}
      <div className="at-under" aria-hidden="true">
        {pair !== null && (
          <div className="at-swap" style={{ gridColumn: `${pair[0] + 1} / ${pair[1] + 2}`, '--span': pair[1] - pair[0] + 1 } as CSSProperties}>
            <svg viewBox="0 0 100 18" preserveAspectRatio="none"><path d="M1 2 C 25 18, 75 18, 99 2" vectorEffect="non-scaling-stroke" /></svg>
          </div>
        )}
      </div>
    </figure>
  );
}

/** Merge sort: the two sorted halves being merged, with the item each side offers next. Its room is kept when empty. */
function Tray({ view }: { view: BoardView }) {
  const t = view.tray;
  if (t === null) {
    return <div className="at-tray" data-empty="true"><p className="at-tray-empty">The two sorted halves appear here while they are merged.</p></div>;
  }
  const half = (label: string, values: readonly number[], used: number, live: boolean) => (
    <div className="at-tray-half">
      <span className="at-tray-label">{label}</span>
      <ol>
        {values.map((v, i) => (
          <li key={i} data-state={i < used ? 'used' : i === used && live ? 'front' : 'waiting'}>{v}</li>
        ))}
      </ol>
    </div>
  );
  const live = view.op === 'compare';
  return (
    <div className="at-tray" aria-label={`Merging the left half ${t.left.join(', ')} with the right half ${t.right.join(', ')}`} role="group">
      {half('Left half', t.left, t.li, live)}
      {half('Right half', t.right, t.rj, live)}
    </div>
  );
}

function Status({ spec, view }: { spec: AlgorithmTraceSpec; view: BoardView }) {
  const moves = movesLabel(spec.algorithm);
  return (
    <div className="at-status">
      <p className="at-note" aria-live="polite">{view.note}</p>
      <dl className="at-counters">
        <div><dt>Comparisons</dt><dd>{view.comparisons}</dd></div>
        {moves !== null && <div><dt>{moves}</dt><dd>{view.moves}</dd></div>}
      </dl>
    </div>
  );
}

type OptionState = 'idle' | 'picked' | 'right' | 'wrong' | 'answer';

function AskPanel({ point: live, ghost, index, total, shown, pick, onPick, idleText, hint }: {
  point: PredictPoint | null; ghost: PredictPoint | null; index: number; total: number; shown: boolean; pick: string | null;
  onPick: ((id: string) => void) | null; idleText: string; hint: string;
}) {
  const headId = useId();
  // Between questions the panel keeps a neighbouring question's layout, hidden, so nothing below it moves.
  const point = live ?? ghost;
  const idle = live === null;
  const positional = point !== null && (point.kind === 'land' || point.kind === 'pivot-land' || point.kind === 'min-into');
  const state = (id: string): OptionState => {
    if (point === null) return 'idle';
    if (!shown) return pick === id ? 'picked' : 'idle';
    if (id === point.answer) return pick === id ? 'right' : 'answer';
    return pick === id ? 'wrong' : 'idle';
  };
  const verdict = point === null || !shown || pick === null ? null : gradeChoice(point, pick);
  return (
    <section className="at-ask" aria-labelledby={idle ? undefined : headId} data-open={!idle && !shown ? 'true' : 'false'}>
      <div className="at-ask-stack">
        <div className="at-ask-body" data-hidden={idle ? 'true' : undefined} aria-hidden={idle ? 'true' : undefined}>
          <p className="at-ask-count">{idle ? 'Question' : `Question ${index + 1} of ${total}`}</p>
          <h3 id={headId} className="at-q">{point?.question ?? ''}</h3>
          <div className={`at-options${positional ? ' at-options-chips' : ''}`} role="group" aria-labelledby={headId}>
            {positional && point?.kind !== 'min-into' && <span className="at-options-lead" aria-hidden="true">Position</span>}
            {positional && point?.kind === 'min-into' && <span className="at-options-lead" aria-hidden="true">Value</span>}
            {(point?.options ?? []).map((o) => {
              const s = state(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  className="at-option"
                  data-state={s}
                  aria-label={positional ? o.label : undefined}
                  aria-pressed={pick === o.id}
                  disabled={idle || onPick === null || (shown && pick !== null)}
                  tabIndex={idle ? -1 : undefined}
                  onClick={() => onPick?.(o.id)}
                >
                  <span className="at-option-text">{positional && point?.kind !== 'min-into' ? o.id : o.label}</span>
                  <span className="at-option-mark" aria-hidden="true">{s === 'right' || s === 'answer' ? <Mark kind="ok" /> : s === 'wrong' ? <Mark kind="bad" /> : null}</span>
                </button>
              );
            })}
          </div>
          <div className="at-result" aria-live="polite">
            <p className="at-result-hint" data-on={!idle && !shown ? 'true' : 'false'}>{hint}</p>
            <p className="at-result-outcome" data-on={!idle && shown ? 'true' : 'false'} data-tone={verdict === null ? 'plain' : verdict ? 'ok' : 'miss'}>
              {point !== null && !idle && shown && (
                <>
                  {verdict !== null && <strong>{verdict ? 'Right. ' : 'Not this time. '}</strong>}
                  {point.outcome}
                </>
              )}
              {/* Hidden until reveal: the longest form of the answer line keeps its room. */}
              {point !== null && (idle || !shown) && <span aria-hidden="true"><strong>Not this time. </strong>{point.outcome}</span>}
            </p>
          </div>
        </div>
        <p className="at-ask-idle" data-on={idle ? 'true' : 'false'}>{idleText}</p>
      </div>
    </section>
  );
}

function Lede({ spec }: { spec: AlgorithmTraceSpec }) {
  return (
    <Linked as="p" className="at-lede" links={[linkKey(spec.sourceId, spec.quote)]}>
      <span className="at-name">{capitalFirst(spec.algorithmName)}</span>
      <span className="at-lede-text">{traceLede(spec)}</span>
      {spec.hasTarget && <span className="at-target">Target <strong>{spec.target}</strong></span>}
    </Linked>
  );
}

function Facts({ spec, cite }: { spec: AlgorithmTraceSpec; cite: CiteProps }) {
  return (
    <section className="at-facts" aria-label="What the page says">
      <QuoteBlock componentId={COMPONENT} part="algorithm" id="algorithm" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption="How the page describes it" />
      {spec.claims.length > 0 && (
        <ul className="at-claims" aria-label="Facts the page states">
          {spec.claims.map((c) => {
            const key = lessonQuoteKey(COMPONENT, 'claim', c.id);
            return (
              <Linked as="li" key={c.id} className="at-claim" links={[linkKey(c.sourceId, c.quote)]} data-kind={c.kind}>
                <span className="at-claim-kind">{c.kind === 'running-time' ? 'Running time' : 'Property'}</span>
                <span className="at-claim-text">{aiLabel(c.text)}</span>
                <CitationChip label="Show in source" quote={c.quote} citeKey={key} enabled={c.sourceId === cite.sourceId && cite.located.has(key)} onCite={cite.onCite} />
              </Linked>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The lesson view: step, play, predict and reveal at the teacher's pace. */
function LessonTrace({ spec, cite }: { spec: AlgorithmTraceSpec; cite: CiteProps }) {
  const trace = useMemo(() => algorithmTrace(spec), [spec]);
  const points = useMemo(() => teachingPoints(spec, trace), [spec, trace]);
  const rooms = useMemo(() => boardRooms(spec, trace), [spec, trace]);
  const reduced = useReducedMotion();
  const first = points[0]?.ask ?? 0;
  const last = trace.frames.length - 1;
  const [frame, setFrame] = useState(first);
  const [shown, setShown] = useState<ReadonlySet<number>>(() => new Set());
  const [picks, setPicks] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [target, setTarget] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const playFrom = useRef(-1);

  const active = points.findIndex((p) => p.ask <= frame && frame <= p.reveal);
  const point = active >= 0 ? (points[active] as PredictPoint) : null;
  const open = point !== null && !shown.has(active);

  // The frames between a prediction and its answer play by themselves (an item shifting into place).
  useEffect(() => {
    if (target === null) return undefined;
    if (frame >= target) { setTarget(null); return undefined; }
    const t = window.setTimeout(() => setFrame((f) => Math.min(target, f + 1)), RUN_MS);
    return () => window.clearTimeout(t);
  }, [target, frame]);

  const revealPoint = (i: number): void => {
    const p = points[i];
    if (p === undefined) return;
    setShown((s) => new Set(s).add(i));
    if (reduced || p.reveal - frame <= 1) setFrame(p.reveal);
    else { setFrame((f) => f + 1); setTarget(p.reveal); }
  };
  const next = (): void => {
    if (target !== null) { setFrame(target); setTarget(null); return; }
    if (open) { revealPoint(active); return; }
    if (frame < last) setFrame(frame + 1);
  };
  const back = (): void => { setPlaying(false); setTarget(null); setFrame((f) => Math.max(0, f - 1)); };
  const reset = (): void => { setPlaying(false); setTarget(null); setShown(new Set()); setPicks(new Map()); setFrame(first); };
  const choose = (id: string): void => {
    if (!open) return;
    setPicks((m) => new Map(m).set(active, id));
    revealPoint(active);
  };
  const togglePlay = (): void => {
    if (playing) { setPlaying(false); return; }
    if (frame >= last) return;
    playFrom.current = frame;
    setPlaying(true);
  };

  // Play reveals and moves on, and stops at the next question nobody has answered yet.
  useEffect(() => {
    if (!playing || target !== null) return undefined;
    if (frame >= last) { setPlaying(false); return undefined; }
    if (open && frame !== playFrom.current) { setPlaying(false); return undefined; }
    const t = window.setTimeout(next, PLAY_MS);
    return () => window.clearTimeout(t);
  });

  const view = boardAt(spec, trace, frame);
  const settledAnswer = point !== null && shown.has(active) && target === null;
  const lastPoint = points[points.length - 1];
  const ghost = point ?? points.find((p) => p.ask > frame) ?? lastPoint ?? null;
  const idleText = frame < first
    ? 'Step on to reach the first question.'
    : view.done
      ? 'That is the whole trace. Reset to run it again.'
      : lastPoint !== undefined && frame > lastPoint.reveal
        ? `All ${points.length} questions done. Play to watch the rest of the trace.`
        : 'Step on to the next question.';

  return (
    <div className="at" data-algorithm={spec.algorithm} data-mode="lesson" data-testid="algorithm-trace">
      <Lede spec={spec} />
      <Board spec={spec} view={view} choices={open ? point?.positions ?? null : null} rooms={rooms} />
      {spec.algorithm === 'merge-sort' && <Tray view={view} />}
      <Status spec={spec} view={view} />
      <div className="at-controls" role="group" aria-label="Step through the algorithm">
        <button type="button" className="btn" onClick={back} disabled={frame <= 0}><Chevron dir="back" />Back</button>
        <button type="button" className="btn btn-primary at-next" onClick={next} disabled={frame >= last && target === null && !open}>
          <span className="at-next-label" data-on={open ? 'true' : 'false'}>Show the answer</span>
          <span className="at-next-label" data-on={open ? 'false' : 'true'}>Next step</span>
          <Chevron dir="next" />
        </button>
        <button type="button" className="btn" onClick={togglePlay} aria-pressed={playing} disabled={frame >= last && !playing}>
          {playing ? <IconPause /> : <IconPlay />}{playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className="btn" onClick={reset}><IconReset />Reset</button>
        <span className="at-frame">Step {frame + 1} of {last + 1}</span>
      </div>
      <AskPanel
        point={point} ghost={ghost} index={active} total={points.length} shown={settledAnswer} pick={point === null ? null : picks.get(active) ?? null}
        onPick={open ? choose : null} idleText={idleText} hint="Pick an answer, or press Show the answer."
      />
      {variantNote(spec.algorithm) !== null && <p className="at-variant">{variantNote(spec.algorithm)}</p>}
      {trace.truncated && <p className="at-variant">The trace is shown up to {trace.frames.length} steps.</p>}
      <Facts spec={spec} cite={cite} />
    </div>
  );
}

/** Presentation: step k is predict point k; R reveals it (the frames between play out unless motion is reduced). */
function StagedTrace({ spec, presentation }: { spec: AlgorithmTraceSpec; presentation: EnginePresentation }) {
  const trace = useMemo(() => algorithmTrace(spec), [spec]);
  const points = useMemo(() => teachingPoints(spec, trace), [spec, trace]);
  const rooms = useMemo(() => boardRooms(spec, trace), [spec, trace]);
  const reduced = useReducedMotion();
  const { point: k, frame: goal } = presentationFrame(spec, presentation.step, presentation.revealed, trace);
  const p = points[k] ?? null;
  const [frame, setFrame] = useState(goal);
  const [pick, setPick] = useState<{ step: number; id: string } | null>(null);

  useEffect(() => {
    if (frame === goal) return undefined;
    const animate = presentation.revealed && !reduced && p !== null && frame >= p.ask && frame < goal;
    if (!animate) { setFrame(goal); return undefined; }
    const t = window.setTimeout(() => setFrame((f) => Math.min(goal, f + 1)), RUN_MS);
    return () => window.clearTimeout(t);
  }, [frame, goal, presentation.revealed, reduced, p]);

  const view = boardAt(spec, trace, frame);
  const shown = presentation.revealed && p !== null && frame === p.reveal;
  const classPick = pick !== null && pick.step === k ? pick.id : null;
  return (
    <div className="at" data-algorithm={spec.algorithm} data-mode="stage" data-testid="algorithm-trace" data-revealed={shown ? 'true' : 'false'}>
      <Lede spec={spec} />
      <Board spec={spec} view={view} choices={!presentation.revealed ? p?.positions ?? null : null} rooms={rooms} />
      {spec.algorithm === 'merge-sort' && <Tray view={view} />}
      <Status spec={spec} view={view} />
      <AskPanel
        point={p} ghost={null} index={k} total={points.length} shown={shown} pick={classPick}
        onPick={presentation.revealed ? null : (id) => setPick({ step: k, id })} idleText="" hint="Predict with the class, then reveal."
      />
      {spec.claims.length > 0 && (
        <ul className="at-stage-claims" aria-label="Facts the page states">
          {spec.claims.map((c) => <Linked as="li" key={c.id} links={[linkKey(c.sourceId, c.quote)]} tabIndex={0}>{aiLabel(c.text)}</Linked>)}
        </ul>
      )}
      {variantNote(spec.algorithm) !== null && <p className="at-variant">{variantNote(spec.algorithm)}</p>}
    </div>
  );
}

export function AlgorithmTraceView({ spec, cite, presentation }: AlgorithmTraceViewProps) {
  if (presentation !== undefined) return <StagedTrace spec={spec} presentation={presentation} />;
  return <LessonTrace spec={spec} cite={cite} />;
}
