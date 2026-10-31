// Stage 9: the live build view's pieces (docs/specs/STAGE-9-live-build-view.md). Every line here shows a recorded
// event or a served artifact: the strip lists the calls open right now, a planned part's frame keeps its work log, a
// finished part keeps a one-line trace. Counters read a job clock (live: wall time since the job's first event; replay:
// the replay clock), so nothing here ever waits on a timer to look busy.
import { useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { LogLine, PartBuild, StripState, TraceStep } from '../lib/liveBuild.ts';
import { formatElapsed, reserveHeight, stagger } from '../lib/liveBuild.ts';
import { formatCostUSD } from '../lib/jobs.ts';
import { REPLAY_LABEL } from '../lib/replay.ts';
import type { PendingSlot } from '../lib/lesson.ts';
import { Mark } from './icons.tsx';

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

/**
 * The slim bar at the top of a building lesson: in a replay, first the replay label (never shown as live), then one line
 * naming the model and every call open right now with its real elapsed time; once the job has finished, what it took.
 */
export function LiveBar({ live }: { live: LiveContext }) {
  const { strip, clock, replay } = live;
  const running = !strip.finished;
  useTick(500, running);
  const calls = [
    strip.museCalls > 0 ? `${strip.museCalls} ${strip.model} ${strip.museCalls === 1 ? 'call' : 'calls'}` : '',
    strip.samCalls > 0 ? `${strip.samCalls} SAM 3.1 ${strip.samCalls === 1 ? 'call' : 'calls'}` : '',
  ].filter((s) => s !== '');
  return (
    <div className="lb-bar" data-testid="live-bar" data-state={running ? 'running' : 'done'}>
      {replay !== null && (
        <p className="lb-replay" data-testid="replay-label">
          <strong>{REPLAY_LABEL}</strong>
          <span>{speedText(replay.speed)}</span>
          {recordedText(replay.recordedAt) !== '' && <span>{recordedText(replay.recordedAt)}</span>}
          <button type="button" className="link-btn" onClick={replay.onRestart}>{replay.finished ? 'Replay again' : 'Restart'}</button>
        </p>
      )}
      <p className="lb-strip">
        <span className="lb-mode">{replay !== null ? 'Replay' : running ? 'Live' : 'Built'}</span>
        {running && (
          <span className="lb-ops" role="status" aria-live="polite">
            {strip.ops.length === 0 && <span className="lb-op lb-op-idle">{strip.museCalls === 0 ? 'Starting' : 'Checking against the page'}</span>}
            {strip.ops.map((op) => (
              <span key={op.key} className="lb-op" data-actor={op.actor}>
                <span className="lb-actor">{op.actor === 'sam' ? 'SAM 3.1' : strip.model}</span>
                <span className="lb-op-text">{op.text}</span>
                <Elapsed clock={clock} startMs={op.startMs} />
              </span>
            ))}
          </span>
        )}
        {!running && (
          <span className="lb-ops lb-summary">
            <span>Built in {formatElapsed(strip.totalMs ?? 0)}</span>
            {calls.map((c) => <span key={c}>{c}</span>)}
            {strip.costUSD !== null && <span>{formatCostUSD(strip.costUSD)} est.</span>}
          </span>
        )}
        {running && <span className="lb-total" aria-hidden="true">{formatElapsed(clock())}</span>}
      </p>
    </div>
  );
}

/** Where the overview will appear while Muse is still reading: reserved space and one quiet sentence. */
export function OverviewSlot({ words }: { words: number | null }) {
  return (
    <div className="lb-overview-slot" data-testid="overview-slot">
      <p>{words === null ? '' : `The page has ${words.toLocaleString('en-US')} words. `}The summary appears here as soon as Muse has read it.</p>
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

/**
 * A planned part that has not arrived yet: named by its kind, Muse's reason for planning it, and one log line per
 * recorded event. It reserves about the height of the part it stands for.
 */
export function PartFrame({ slot, build, clock }: { slot: PendingSlot; build: PartBuild | undefined; clock: JobClock }) {
  const headId = useId();
  const lines = build?.lines ?? [];
  return (
    <article
      className="card kit-card lb-frame" aria-labelledby={headId} aria-busy="true" data-component={slot.componentId} data-status={slot.state}
      data-testid="part-frame" style={{ minBlockSize: reserveHeight(slot.componentId) }}
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
