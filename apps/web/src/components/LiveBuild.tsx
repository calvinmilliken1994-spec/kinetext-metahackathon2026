// Stage 9: the live build view's pieces (docs/specs/STAGE-9-live-build-view.md, pass 2: STAGE-9b). Every line here shows
// a recorded event or a served artifact: the strip lists the calls open right now and, once the job has finished, sums
// it up; a planned part's frame keeps its work log over a faint preview of the part's shape; a finished part keeps a
// one-line trace. Counters read a job clock (live: wall time since the job's first event; replay: the replay clock), so
// nothing here ever waits on a timer to look busy.
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import type { LogLine, PartBuild, PartPreview, PreviewPhase, StripState, TraceStep } from '../lib/liveBuild.ts';
import { arrivals, closingBeat, figureNote, followFocus, formatElapsed, previewOf, previewPhase, progressFacts, reserveHeight, stagger } from '../lib/liveBuild.ts';
import { REPLAY_LABEL } from '../lib/replay.ts';
import { scrollTopToReveal } from '../lib/scroll.ts';
import type { PendingSlot } from '../lib/lesson.ts';
import { Mark } from './icons.tsx';
import { IconPresent } from './presentation/icons.tsx';

/** Job-relative milliseconds now (0 = the job's first event). */
export type JobClock = () => number;

export interface ReplayInfo {
  speed: number;
  /** ISO time the recorded run started. */
  recordedAt: string;
  finished: boolean;
  onRestart: () => void;
}

export interface LiveContext {
  clock: JobClock;
  strip: StripState;
  builds: Readonly<Record<string, PartBuild>>;
  replay: ReplayInfo | null;
  /** Words in the page being read (from the source text the app already shows), or null before it has loaded. */
  sourceWords: number | null;
  /** Opens the finished lesson in presentation mode (the closing beat's button); null until it can be presented. */
  onPresent?: (() => void) | null;
}

/** Re-render once per `ms` while mounted (only the small counters use it). */
function useTick(ms: number, on = true): void {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const t = setInterval(() => setN((n) => (n + 1) % 1_000_000), ms);
    return () => clearInterval(t);
  }, [ms, on]);
}

function Elapsed({ clock, startMs }: { clock: JobClock; startMs: number }) {
  useTick(250);
  return <span className="lb-time" aria-hidden="true">{formatElapsed(clock() - startMs)}</span>;
}

const vars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

function recordedText(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return `recorded ${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}

function speedText(speed: number): string {
  return `${Number.isInteger(speed) ? speed : speed.toFixed(2).replace(/0+$/, '')}× speed`;
}

/** The replay disclosure: a recorded run is never shown as live (also above a replayed run's outcome card, W-07). */
export function ReplayLabel({ replay }: { replay: ReplayInfo }) {
  return (
    <p className="lb-replay" data-testid="replay-label">
      <strong>{REPLAY_LABEL}</strong>
      <span>{speedText(replay.speed)}</span>
      {recordedText(replay.recordedAt) !== '' && <span>{recordedText(replay.recordedAt)}</span>}
      <button type="button" className="link-btn" onClick={replay.onRestart}>{replay.finished ? 'Replay again' : 'Restart'}</button>
    </p>
  );
}

/**
 * The bar at the top of a building lesson, sticky while the column scrolls. In a replay, first the replay label (never
 * shown as live). Then, while running, the model and every call open right now with its real elapsed time, and what
 * has finished so far; once the job has finished, the closing beat: lesson ready, what it took, and a Present button.
 * Both states have the same rows, so the morph moves nothing.
 */
export function LiveBar({ live }: { live: LiveContext }) {
  const { strip, clock, replay } = live;
  const running = !strip.finished;
  useTick(500, running);
  const close = running ? null : closingBeat(strip);
  const samOnly = strip.ops.length > 0 && strip.ops.every((op) => op.actor === 'sam');
  return (
    <div className="lb-bar" data-testid="live-bar" data-tour="live-strip" data-state={running ? 'running' : close?.ready === true ? 'ready' : 'done'}>
      {replay !== null && <ReplayLabel replay={replay} />}
      {/* While calls are open a light sweeps the strip's lower edge: the clock alone did not show work going on. */}
      {running && <span className="lb-sweep" aria-hidden="true" />}
      {running ? (
        <p className="lb-main" key="running">
          {/* A replay is already labelled in the row above; a live run says so here. */}
          {replay === null && <span className="lb-mode">Live</span>}
          {!samOnly && <span className="lb-model">{strip.model}</span>}
          <span className="lb-ops" role="status" aria-live="polite">
            {strip.ops.length === 0 && <span className="lb-op lb-op-idle"><span className="lb-op-text">{strip.museCalls === 0 ? 'Starting' : 'Checking against the page'}</span></span>}
            {strip.ops.map((op) => (
              <span key={op.key} className="lb-op" data-actor={op.actor}>
                {op.actor === 'sam' && <span className="lb-actor">SAM 3.1</span>}
                <span className="lb-op-text">{op.actor === 'sam' ? op.text.charAt(0).toLowerCase() + op.text.slice(1) : op.text}</span>
                {/* One call open since the start (the analysis): the job clock on the right already says it. */}
                {!(strip.ops.length === 1 && op.startMs < 1000) && <Elapsed clock={clock} startMs={op.startMs} />}
              </span>
            ))}
          </span>
          <span className="lb-total" aria-hidden="true">{formatElapsed(clock())}</span>
        </p>
      ) : (
        <p className="lb-main lb-closing" key="done">
          {close?.ready === true ? <Mark kind="ok" /> : <span className="lb-mode">{replay !== null ? 'Replay' : 'Built'}</span>}
          <span className="lb-headline" role="status">{close?.headline}</span>
          {close?.ready === true && live.onPresent != null && (
            <button type="button" className="btn btn-primary lb-present" data-tour="present" onClick={live.onPresent}>
              <IconPresent size={18} />Present
            </button>
          )}
        </p>
      )}
      <p className="lb-facts" key={running ? 'facts-running' : 'facts-done'}>
        {(running ? progressFacts(strip) : close?.facts ?? []).map((f) => <span key={f}>{f}</span>)}
      </p>
    </div>
  );
}

/** Where the overview will appear while Muse is still reading: reserved space and one quiet sentence. */
export function OverviewSlot({ words }: { words: number | null }) {
  return (
    <div className="lb-overview-slot" data-testid="overview-slot">
      <p>{words === null ? '' : `The page has ${words.toLocaleString('en-US')} words. `}The summary appears here as soon as Muse has read it.</p>
      <div className="lb-pv lb-pv-lines lb-overview-pv" aria-hidden="true">
        {[62, 78, 70].map((x, i) => <span key={i} className="pv-bar" style={{ inlineSize: `${x}%` }} />)}
      </div>
    </div>
  );
}

/** n small ticks, one per check that passed, filling in order. */
export function CheckTicks({ passed, total }: { passed: number; total: number }) {
  return (
    <span className="lb-ticks" role="img" aria-label={`${passed} of ${total} checks passed`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="lb-tick" data-ok={i < passed ? 'true' : 'false'} style={vars({ '--d': `${stagger(i, 40, 520)}ms` })}>
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 5.2 4.2 7.4 8 2.8" /></svg>
        </span>
      ))}
    </span>
  );
}

function LogMark({ line }: { line: LogLine }) {
  if (line.open) return <span className="lb-dot is-open" aria-hidden="true" />;
  if (line.kind === 'checks-passed') return <Mark kind="ok" />;
  if (line.kind === 'checks-failed' || line.kind === 'unusable') return <Mark kind="bad" />;
  return <span className="lb-dot" aria-hidden="true" />;
}

function stateWord(build: PartBuild, slot: PendingSlot): string {
  const open = build.lines.find((l) => l.open);
  if (slot.state === 'queued' || open?.kind === 'queued') return 'Waiting';
  if (open?.kind === 'outlining') return 'Outlining';
  if (open?.kind === 'writing') return open.revision > 1 ? `Reworking · revision ${open.revision}` : 'Writing';
  if (build.lines.some((l) => l.kind === 'checks-passed')) return 'Checked';
  return 'Checking';
}

// ---- the skeleton preview -------------------------------------------------------------------------------------------

const WIDTHS = [72, 54, 86, 64, 78, 58, 82, 68, 60, 74, 50, 80];
const width = (i: number): string => `${WIDTHS[i % WIDTHS.length] ?? 70}%`;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const Bar = ({ i, className = 'pv-bar' }: { i: number; className?: string }) => <span className={className} style={{ inlineSize: width(i) }} />;

/** What SAM is doing for a label diagram still being built (lib figureNote), shown in the figure frame. */
type FigureNote = ReturnType<typeof figureNote>;

function PreviewBody({ p, note = null }: { p: PartPreview; note?: FigureNote }): ReactNode {
  switch (p.kind) {
    case 'quiz':
      return (
        <div className="pv-quiz">
          {range(p.cols * 2).map((c) => (
            <div key={c} className="pv-box pv-col">
              <Bar i={c} className="pv-bar pv-strong" />
              {range(p.rows).map((r) => <span key={r} className="pv-option"><span className="pv-radio" /><Bar i={c + r + 1} /></span>)}
            </div>
          ))}
        </div>
      );
    case 'sequence':
      return (
        <div className="pv-col pv-fill">
          <Bar i={2} />
          {range(p.rows).map((r) => <span key={r} className="pv-rung"><span className="pv-num">{r + 1}</span><Bar i={r + 3} /></span>)}
          <span className="pv-row"><span className="pv-pill" /><span className="pv-pill pv-pill-wide" /></span>
        </div>
      );
    case 'grid':
      return (
        <div className="pv-grid" style={vars({ '--cols': p.cols })}>
          {range(p.cols).map((c) => <span key={`h${c}`} className="pv-cell pv-head"><Bar i={c} className="pv-bar pv-strong" /></span>)}
          {range((p.rows - 1) * p.cols).map((k) => <span key={k} className="pv-cell"><Bar i={k + 2} /></span>)}
        </div>
      );
    case 'explorer':
      return (
        <div className="pv-col pv-fill">
          <Bar i={0} className="pv-bar pv-strong pv-eq" />
          <div className="pv-explorer">
            <div className="pv-col">
              {range(p.rows).map((r) => <span key={r} className="pv-slider"><Bar i={r + 4} /><span className="pv-track"><span className="pv-knob" style={{ insetInlineStart: width(r + 6) }} /></span></span>)}
            </div>
            <svg className="pv-graph" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
              <path className="pv-axis" d="M6 4V54H98" vectorEffect="non-scaling-stroke" />
              <path className="pv-curve" d="M6 50 C 30 46, 50 34, 96 10" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="pv-quiz pv-cases">{range(2).map((c) => <div key={c} className="pv-box pv-col"><Bar i={c + 1} className="pv-bar pv-strong" /><Bar i={c + 5} /><span className="pv-pill" /></div>)}</div>
        </div>
      );
    case 'figure':
      return (
        <div className="pv-figure">
          {/* Once SAM is called, the frame says so (working cue while the call is open); no region is drawn before the part arrives. */}
          <div className="pv-box pv-plate" data-sam={note === null ? undefined : note.working ? 'working' : 'done'}>
            {note === null
              ? <span className="pv-caption">The page’s figure</span>
              : <span className="pv-caption pv-sam">
                <span>
                  {note.muse !== undefined && <><strong>{note.muse.actor}</strong> {note.muse.text} · </>}
                  <strong>{note.actor}</strong> {note.text}
                </span>
              </span>}
          </div>
          <div className="pv-col pv-chips">
            <Bar i={0} />
            {range(p.rows).map((r) => <span key={r} className="pv-chip" />)}
          </div>
        </div>
      );
    case 'bins':
      return (
        <div className="pv-col pv-fill">
          <span className="pv-row pv-tray">{range(7).map((k) => <span key={k} className="pv-chip pv-chip-inline" />)}</span>
          <div className="pv-bins" style={vars({ '--cols': p.cols })}>{range(p.cols).map((c) => <div key={c} className="pv-box pv-col"><Bar i={c} className="pv-bar pv-strong" /></div>)}</div>
        </div>
      );
    case 'map':
      return (
        <svg className="pv-map" viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
          {[[50, 10, 20, 46], [50, 10, 80, 46], [50, 10, 50, 50], [20, 46, 50, 50]].map(([x1, y1, x2, y2], i) => <line key={i} className="pv-edge" x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />)}
          {[[50, 10], [20, 46], [80, 46], [50, 50]].map(([x, y], i) => <rect key={i} className="pv-node" x={(x ?? 0) - 9} y={(y ?? 0) - 4} width="18" height="8" rx="2" vectorEffect="non-scaling-stroke" />)}
        </svg>
      );
    case 'equation':
      return (
        <div className="pv-col pv-fill">
          <span className="pv-row pv-equation">{range(p.cols).map((c) => <span key={c} className="pv-box pv-term" />)}</span>
          {range(p.rows).map((r) => <div key={r} className="pv-col pv-balance"><Bar i={r} className="pv-bar pv-strong" /><span className="pv-meter"><span style={{ inlineSize: width(r + 3) }} /></span><span className="pv-meter"><span style={{ inlineSize: width(r + 5) }} /></span></div>)}
        </div>
      );
    case 'bars':
      return (
        <div className="pv-col pv-fill">
          <div className="pv-bars">{range(p.cols).map((c) => <span key={c} className="pv-vbar" style={{ blockSize: `${[78, 42, 24, 64, 90, 52][c % 6] ?? 50}%` }} />)}</div>
          <Bar i={3} />
          <span className="pv-row"><span className="pv-pill" /><span className="pv-pill pv-pill-wide" /><span className="pv-pill" /></span>
        </div>
      );
    case 'ladder':
      return (
        <div className="pv-ladder">
          <div className="pv-rail">{range(p.rows).map((r) => <span key={r} className="pv-rung pv-rung-tick"><span className="pv-tick" /><Bar i={r} /></span>)}</div>
          <div className="pv-box pv-col"><Bar i={1} className="pv-bar pv-strong" /><Bar i={4} /><Bar i={6} /><span className="pv-pill" /></div>
        </div>
      );
    case 'meter':
      return (
        <div className="pv-col pv-fill">
          <Bar i={2} />
          <span className="pv-meter pv-meter-tall"><span style={{ inlineSize: '58%' }} /><i className="pv-threshold" /></span>
          <span className="pv-slider"><Bar i={5} /><span className="pv-track"><span className="pv-knob" style={{ insetInlineStart: '58%' }} /></span></span>
          <Bar i={7} /><Bar i={9} />
        </div>
      );
    case 'scene':
      return (
        <div className="pv-col pv-fill">
          <div className="pv-box pv-plate" />
          <span className="pv-row"><span className="pv-pill" /><span className="pv-pill pv-pill-wide" /><span className="pv-pill" /></span>
        </div>
      );
    case 'lines':
      return <div className="pv-col pv-fill">{range(p.rows).map((r) => <Bar key={r} i={r} />)}</div>;
  }
}

/** A faint, static sketch of the part's shape (no shimmer): it fills the frame's reserved space until the part arrives. */
export function PartPreviewSketch({ preview, phase, note = null }: { preview: PartPreview; phase: PreviewPhase; note?: FigureNote }) {
  return (
    <div className={`lb-pv lb-pv-${preview.kind}`} data-phase={phase} data-testid="part-preview" aria-hidden="true">
      <PreviewBody p={preview} note={note} />
    </div>
  );
}

/**
 * A planned part that has not arrived yet: named by its kind, Muse's reason for planning it, one log line per recorded
 * event, and under them a faint preview of the part's shape filling the space the part will take.
 */
export function PartFrame({ slot, build, clock }: { slot: PendingSlot; build: PartBuild | undefined; clock: JobClock }) {
  const headId = useId();
  const lines = build?.lines ?? [];
  const phase = previewPhase(build);
  const h = reserveHeight(slot.componentId);
  return (
    <article
      className="card kit-card lb-frame" aria-labelledby={headId} aria-busy="true" data-component={slot.componentId} data-status={slot.state}
      data-phase={phase} data-testid="part-frame" style={{ minBlockSize: h, blockSize: h }}
    >
      <header className="kit-head">
        <h2 id={headId}>{slot.label}</h2>
        <p className="card-meta">
          <span>Planned by Muse</span>
          <span className="lb-state">{build === undefined ? slot.message : stateWord(build, slot)}</span>
        </p>
      </header>
      {build !== undefined && build.reason !== '' && <p className="lb-reason">{build.reason}</p>}
      {lines.length > 0 && (
        <ol className="lb-log" aria-label="What has happened so far">
          {lines.map((l) => (
            <li key={l.key} data-kind={l.kind} data-open={l.open ? 'true' : 'false'}>
              <LogMark line={l} />
              <span className="lb-log-text">{l.text}</span>
              {l.open && l.startMs !== null && <Elapsed clock={clock} startMs={l.startMs} />}
              {l.checks !== undefined && <CheckTicks passed={l.checks.passed} total={l.checks.total} />}
            </li>
          ))}
        </ol>
      )}
      <PartPreviewSketch preview={previewOf(slot.componentId, build)} phase={phase} note={figureNote(build)} />
    </article>
  );
}

/** A finished part's work in one line under its title: written, outlined, checks failed, reworked, checks passed. */
export function BuildTrace({ build }: { build: PartBuild | undefined }): ReactNode {
  if (build === undefined || build.trace.length === 0) return null;
  return (
    <p className="lb-trace" data-testid="build-trace" aria-label="How this part was built">
      {build.trace.map((s: TraceStep, i) => <span key={`${i}:${s.text}`} className={`lb-step tone-${s.tone}`}>{s.text}</span>)}
    </p>
  );
}

// ---- keep the moment worth watching in view (Stage 9b) -----------------------------------------------------------------

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' ']);

/**
 * While the view watches a build, gently scroll the lesson column to the part where something worth watching happens
 * (lib/liveBuild.ts followFocus: an arrival, SAM outlining, a rework), just under the sticky strip. The column only:
 * never the document. It stops for good the moment the user scrolls the column themselves (wheel, touch, keys,
 * scrollbar drag), so a teacher reading something is never pulled away.
 */
export function useFollowBuild(root: RefObject<HTMLElement | null>, live: LiveContext | null, arrived: readonly string[], order: readonly string[]): void {
  const focus = useRef<string | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const userMoved = useRef(false);
  const on = live !== null;

  useEffect(() => {
    if (!on) return undefined;
    const box = root.current?.closest<HTMLElement>('.activity-panel');
    if (box === null || box === undefined) return undefined;
    const stop = (): void => { userMoved.current = true; };
    const onKey = (e: KeyboardEvent): void => { if (SCROLL_KEYS.has(e.key) && !(e.target instanceof HTMLInputElement)) stop(); };
    const onDown = (e: PointerEvent): void => { if (e.target === box) stop(); };
    box.addEventListener('wheel', stop, { passive: true });
    box.addEventListener('touchstart', stop, { passive: true });
    box.addEventListener('keydown', onKey);
    box.addEventListener('pointerdown', onDown);
    return () => {
      box.removeEventListener('wheel', stop);
      box.removeEventListener('touchstart', stop);
      box.removeEventListener('keydown', onKey);
      box.removeEventListener('pointerdown', onDown);
    };
  }, [on, root]);

  useEffect(() => {
    if (live === null) return;
    // Parts already there when the view started watching (a replay opened mid-way) are not arrivals. Parts that vanish
    // mean the replay restarted ("Replay again"): follow it afresh, as a direct replay does (demo pair review #10).
    const a = arrivals(seen.current, arrived);
    seen.current = a.known;
    const newly = a.newly;
    if (a.restarted) { focus.current = null; userMoved.current = false; }
    const next = followFocus(focus.current, live.builds, order, newly);
    if (next === focus.current && newly.length === 0) return;
    focus.current = next;
    if (next === null || userMoved.current) return;
    const lesson = root.current;
    const box = lesson?.closest<HTMLElement>('.activity-panel');
    const target = lesson?.querySelector<HTMLElement>(`[data-component="${next}"]`);
    if (box == null || target == null) return;
    const strip = lesson?.querySelector<HTMLElement>('.lb-bar');
    const b = box.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    const top = scrollTopToReveal(
      { top: b.top, height: box.clientHeight, scrollTop: box.scrollTop, scrollHeight: box.scrollHeight },
      { top: t.top, height: t.height }, 'start', (strip?.offsetHeight ?? 0) + 20,
    );
    if (Math.abs(top - box.scrollTop) > 24) box.scrollTo({ top, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
}
