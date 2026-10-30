import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { stateAt } from '../../../../packages/activities/projectile-v1/engine.ts';
import type { ProjectileActivitySpec } from '../../../../packages/contracts/index.ts';
import { caseInputs, scenarioLabels, sliderModels } from '../lib/engines.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { leaderLine, PROJECTILE_FRAME, projectileScene, sceneGuess } from '../lib/geometry.ts';
import type { Grade } from '../lib/predictions.ts';
import type { Px } from '../lib/geometry.ts';
import { activePreset, comparisonValues, pagePresets } from '../lib/presets.ts';
import { concealNumbers } from '../lib/reveal.ts';
import { Readout, SchematicTag, Slider } from './controls.tsx';
import type { PlaybackCtl } from './usePlayback.ts';
import type { RunPrediction } from './PredictionCards.tsx';
import { IconPause, IconPlay, IconReplay, IconReset } from './icons.tsx';

export const PROJECTILE_LABEL = 'Schematic — drag-free model';

const { W, H, box: BOX, titleY, tickLabelDy } = PROJECTILE_FRAME;

export interface ClosedFormViewProps<S> {
  spec: S;
  inputs: Record<string, number>;
  onInput: (key: string, value: number) => void;
  pb: PlaybackCtl;
  /** Case 1's predict card: rendered right under the scene and its playback bar, above the sliders. */
  predict?: ReactNode;
  /** Sliders back to the lesson's opening case. */
  onReset: () => void;
  /** The live substituted equation (EquationLine), shown right under the scene. */
  equation?: ReactNode;
  /** Case 1's answer is not shown yet: every printed value of the engine's output reads '?'. */
  concealed?: boolean;
}

/** The views without a playback clock (lift, compound interest, Hardy-Weinberg, half-life). */
export type StaticViewProps<S> = Omit<ClosedFormViewProps<S>, 'pb'>;

const pts = (list: readonly Px[]): string => list.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ');

/** A graded prediction: the case's index in spec.predictions and its grade (guess, engine value, teaching margin). */
export interface RunOutcome { index: number; grade: Grade }

/**
 * Case 1's predict card is passed in as an element; wrap its onRun so the scene learns the class's guess too (the card
 * itself is unchanged). Any other node is returned as is.
 */
function withRunListener(node: ReactNode, listen: RunPrediction): ReactNode {
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ onRun?: RunPrediction }>;
  const inner = el.props.onRun;
  if (typeof inner !== 'function') return node;
  return cloneElement(el, { onRun: (p, i, g) => { listen(p, i, g); inner(p, i, g); } });
}

/** The live equation line (an EquationLine element) also keeps its answer as '?' until the ball reaches the top. */
function withConcealed(node: ReactNode, hide: boolean): ReactNode {
  if (!hide || !isValidElement(node)) return node;
  const el = node as ReactElement<{ concealed?: boolean }>;
  return 'concealed' in (el.props as object) ? cloneElement(el, { concealed: true }) : node;
}

/** A new number every time a different grade object arrives (one per run), so the reveal can replay. */
function useRunSeq(grade: Grade | null): number {
  const ref = useRef<{ grade: Grade | null; seq: number }>({ grade: null, seq: 0 });
  if (grade !== null && grade !== ref.current.grade) ref.current = { grade, seq: ref.current.seq + 1 };
  return ref.current.seq;
}

export function ProjectileView({ spec, inputs, onInput, pb, predict, equation, concealed = false, sourceText, outcome }: ClosedFormViewProps<ProjectileActivitySpec> & {
  sourceText?: string | null;
  /**
   * The last graded prediction of ANY case (the activity shell's result). When omitted, the view still catches case 1's
   * runs from its own predict card; cases 2…n then show no guess in the scene.
   */
  outcome?: RunOutcome | null;
}) {
  const titleId = useId();
  const scrubId = useId();
  const [caught, setCaught] = useState<RunOutcome | null>(null);
  const last = outcome !== undefined ? outcome : caught;
  const predictCard = useMemo(() => withRunListener(predict, (_p, index, grade) => setCaught({ index, grade })), [predict]);
  const graded = last === null ? undefined : spec.predictions[last.index];
  const models = sliderModels(spec);
  const sc = scenarioLabels(spec);
  const label = `${sc.objectLabel}${sc.placeLabel !== '' ? ` · ${sc.placeLabel}` : ''}`;
  const input = useMemo(() => ({
    horizontalSpeedMps: inputs['horizontalSpeedMps'] ?? 0,
    verticalSpeedMps: inputs['verticalSpeedMps'] ?? 0,
    gravityMps2: inputs['gravityMps2'] ?? 0,
  }), [inputs]);
  // Gravity values the lesson's cases use AND the page states: one-click chips, and faint comparison arcs for the others.
  const gPresets = useMemo(() => pagePresets(spec, 'gravityMps2', sourceText), [spec, sourceText]);
  const ghostGs = useMemo(() => comparisonValues(gPresets, input.gravityMps2), [gPresets, input.gravityMps2]);
  // The class's guess, drawn only while the sliders still show the graded case.
  const guess = useMemo(
    () => sceneGuess(graded === undefined ? null : caseInputs('projectile-v1', graded), inputs, last?.grade ?? null),
    [graded, inputs, last],
  );
  const scene = useMemo(() => projectileScene(input, ghostGs, label, guess ?? undefined), [input, ghostGs, label, guess]);

  // The reveal moment: after a run, the peak's number stays '?' until the ball reaches the top, then the peak marker, the
  // teaching-margin band and the gap to the guess settle in once. Scrubbing past the peak settles it too.
  const seq = useRunSeq(last?.grade ?? null);
  const [settledSeq, setSettledSeq] = useState(0);
  const reachedPeak = scene !== null && pb.t >= scene.apexTimeS - 1e-9;
  const hasReveal = scene !== null && scene.reveal !== null;
  useEffect(() => {
    if (hasReveal && reachedPeak && settledSeq !== seq) setSettledSeq(seq);
  }, [hasReveal, reachedPeak, settledSeq, seq]);
  const pending = hasReveal && settledSeq !== seq && !reachedPeak;

  if (scene === null) {
    return <div className="callout callout-error" role="alert">The engine rejected these inputs. Adjust the sliders.</div>;
  }

  const { layout } = scene;
  const now = stateAt(input, Math.min(pb.t, scene.flightTimeS));
  const pos = layout.toPx(now.x, now.y);
  const trail = scene.points.filter((_, i) => (scene.pointTimes[i] ?? 0) <= now.t + 1e-9);
  trail.push(pos);
  const finished = pb.t >= scene.flightTimeS - 1e-9;
  const ghostText = scene.ghosts.map((g) => `${trimmed(g.gravityMps2, 4)} metres per second squared, which peaks at ${fixed(g.maxHeightM, 2)} metres`).join('; ');
  const reveal = scene.reveal;
  const peakHidden = concealed || pending;
  const settled = reveal !== null && !pending;
  const revealText = reveal === null || !settled ? '' : ` Your guess ${trimmed(reveal.guessM, 4)} metres against the engine's ${fixed(scene.maxHeightM, 2)}: ${reveal.delta.text}.`;
  const alt = `${label}. Launched at ${trimmed(input.horizontalSpeedMps, 3)} metres per second sideways and ${trimmed(input.verticalSpeedMps, 3)} upward under ${trimmed(input.gravityMps2, 3)} metres per second squared. Maximum height ${peakHidden ? 'hidden until the ball reaches the top' : `${fixed(scene.maxHeightM, 2)} metres`}, flight time ${fixed(scene.flightTimeS, 2)} seconds. At ${fixed(now.t, 2)} seconds: x ${fixed(now.x, 2)} metres, height ${fixed(now.y, 2)} metres.${ghostText === '' ? '' : ` Faint comparison arc for the same launch at the page's other gravity value: ${ghostText}.`}${revealText}`;
  const apexLead = leaderLine(scene.labels.apex, scene.apex);
  const arcLead = scene.arcLabel !== null && scene.arcLabelAnchor !== null ? leaderLine(scene.arcLabel, scene.arcLabelAnchor) : null;
  const deltaLead = reveal === null ? null : leaderLine(reveal.delta, { px: reveal.bracket.x, py: (reveal.bracket.y1 + reveal.bracket.y2) / 2 }, 30);
  const active = activePreset(gPresets, input.gravityMps2);
  const B = BOX;

  return (
    <div className="simulation" data-engine="projectile-v1" data-compare={scene.ghosts.length > 0 ? 'on' : undefined}>
      <SchematicTag text={PROJECTILE_LABEL} />
      <div className="scene-wrap">
        <svg className="scene" viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} preserveAspectRatio="xMidYMid meet">
          <title id={titleId}>{alt}</title>
          <text x={BOX.left} y={titleY} className="object-label">{label}</text>
          <rect x={BOX.left - 14} y={BOX.bottom - 3} width={BOX.right - BOX.left + 28} height={8} rx={4} className="track-band" />
          {layout.xTicks.map((x) => {
            const p = layout.toPx(x, 0);
            return (
              <g key={x} aria-hidden="true">
                <line x1={p.px} y1={BOX.bottom + 5} x2={p.px} y2={BOX.bottom + 12} className={x === 0 ? 'tick tick-zero' : 'tick'} />
                {/* A last tick that would run into the unit label keeps its mark and drops its number. */}
                {p.px + trimmed(x, 3).length * 4.5 < BOX.right + 14 && <text x={p.px} y={BOX.bottom + tickLabelDy} textAnchor="middle" className="tick-label">{trimmed(x, 3)}</text>}
              </g>
            );
          })}
          <text x={BOX.right + 28} y={BOX.bottom + tickLabelDy} textAnchor="end" className="tick-label tick-unit">m</text>

          {scene.ghosts.map((g) => {
            const lead = leaderLine(g.label, g.apex);
            return (
              <g key={g.gravityMps2} className="compare-arc" aria-hidden="true">
                <polyline points={pts(g.points)} fill="none" className="traj-compare" />
                {lead !== null && <line {...lead} className="label-leader" />}
                <text x={g.label.x} y={g.label.y} textAnchor={g.label.anchor} className="scene-label-small compare-label">{g.label.text}</text>
              </g>
            );
          })}

          {reveal !== null && settled && (
            <rect key={`band-${seq}`} x={B.left} y={reveal.band.top} width={B.right - B.left} height={reveal.band.bottom - reveal.band.top} className="reveal-band" aria-hidden="true" />
          )}

          <polyline points={pts(scene.points)} fill="none" className="traj-ghost" />
          <polyline points={pts(trail)} fill="none" className="traj-trail" />
          {scene.arcLabel !== null && (
            <g aria-hidden="true">
              {arcLead !== null && <line {...arcLead} className="label-leader" />}
              <text x={scene.arcLabel.x} y={scene.arcLabel.y} textAnchor={scene.arcLabel.anchor} className="arc-label">{scene.arcLabel.text}</text>
            </g>
          )}

          {reveal !== null && (
            <g className={`reveal-guess${reveal.offScale !== null ? ' reveal-guess-off' : ''}`} aria-hidden="true">
              <line x1={B.left - 10} y1={reveal.guessPy} x2={B.right + 10} y2={reveal.guessPy} className="reveal-guess-line" />
              <text x={reveal.label.x} y={reveal.label.y} textAnchor={reveal.label.anchor} className="reveal-guess-label">{reveal.label.text}</text>
            </g>
          )}

          <g aria-hidden="true">
            <line x1={scene.apex.px} y1={scene.apex.py} x2={scene.apex.px} y2={BOX.bottom} className="guide" />
            <g key={settled ? `peak-${seq}` : 'peak'} className={settled ? 'peak-settle' : undefined}>
              <circle cx={scene.apex.px} cy={scene.apex.py} r={settled ? 6.5 : 5.5} className="apex-dot" />
              {apexLead !== null && <line {...apexLead} className="label-leader" />}
              <text x={scene.labels.apex.x} y={scene.labels.apex.y} textAnchor={scene.labels.apex.anchor} className="scene-label apex-label">{peakHidden ? concealNumbers(scene.labels.apex.text) : scene.labels.apex.text}</text>
            </g>
            <circle cx={scene.land.px} cy={scene.land.py} r={4} className="landing-dot" />
            <text x={scene.labels.landing.x} y={scene.labels.landing.y} textAnchor={scene.labels.landing.anchor} className="scene-label-small">{scene.labels.landing.text}</text>
          </g>

          {reveal !== null && settled && (
            <g key={`gap-${seq}`} className={`reveal-gap ${reveal.within ? 'reveal-ok' : 'reveal-miss'}`} aria-hidden="true">
              <line x1={reveal.bracket.x} y1={reveal.bracket.y1} x2={reveal.bracket.x} y2={reveal.bracket.y2} className="reveal-bracket" pathLength={1} />
              <line x1={reveal.bracket.x - 5} y1={reveal.bracket.y1} x2={reveal.bracket.x + 5} y2={reveal.bracket.y1} className="reveal-bracket-end" />
              <line x1={reveal.bracket.x - 5} y1={reveal.bracket.y2} x2={reveal.bracket.x + 5} y2={reveal.bracket.y2} className="reveal-bracket-end" />
              {deltaLead !== null && <line {...deltaLead} className="label-leader" />}
              <text x={reveal.delta.x} y={reveal.delta.y} textAnchor={reveal.delta.anchor} className="reveal-delta">{reveal.delta.text}</text>
            </g>
          )}

          <circle cx={pos.px} cy={pos.py} r={9} className="ball" />
        </svg>
      </div>
      {scene.ghosts.length > 0 && (
        <p className="muted small compare-note">
          Faint dotted arc: the same launch at {scene.ghosts.map((g) => `g = ${trimmed(g.gravityMps2, 4)} m/s²`).join(' and ')}, {scene.ghosts.length === 1 ? 'the other value the page states' : 'the other values the page states'}, drawn on the same scale.
        </p>
      )}

      <div className="transport" role="group" aria-label="Playback">
        <button type="button" className="btn btn-primary" onClick={pb.playing ? pb.pause : pb.play}>
          {pb.playing ? <><IconPause /> Pause</> : finished ? <><IconReplay /> Replay</> : <><IconPlay /> Play</>}
        </button>
        <button type="button" className="btn" onClick={pb.reset} title="Back to the lesson's opening case, paused at t = 0"><IconReset /> Reset</button>
        <div className="scrub">
          <label htmlFor={scrubId}>Time</label>
          <input
            id={scrubId}
            type="range"
            min={0}
            max={scene.flightTimeS}
            step={scene.flightTimeS / 200}
            value={Math.min(pb.t, scene.flightTimeS)}
            aria-valuetext={`${fixed(pb.t, 2)} of ${fixed(scene.flightTimeS, 2)} seconds`}
            onChange={(e) => pb.scrub(Number(e.target.value))}
          />
          <output htmlFor={scrubId} className="scrub-value">{fixed(Math.min(pb.t, scene.flightTimeS), 2)} / {fixed(scene.flightTimeS, 2)} s</output>
        </div>
      </div>

      {withConcealed(equation, pending)}
      {predictCard}

      <div className="controls-row">
        <div className="sliders">
          {models.map((m) => (
            <Slider
              key={m.key} label={m.label} unit={m.unit} min={m.min} max={m.max} step={m.step} value={inputs[m.key] ?? m.value} onChange={(v) => onInput(m.key, v)}
              presets={m.key === 'gravityMps2' ? gPresets.map((p) => ({ value: p.value, label: p.label, title: `On the page: “${p.sentence}”`, active: p === active })) : undefined}
            />
          ))}
        </div>
        <dl className="readouts" aria-label="Live readouts from the engine">
          <Readout name="Max height (engine)" value={fixed(scene.maxHeightM, 3)} unit="m" accent="a" concealed={peakHidden} />
          <Readout name="Flight time (engine)" value={fixed(scene.flightTimeS, 3)} unit="s" accent="v" />
          <Readout name="Range" value={fixed(scene.rangeM, 2)} unit="m" accent="x" />
          <Readout name="Now: x, height" value={`${fixed(now.x, 1)}, ${fixed(now.y, 1)}`} unit="m" />
        </dl>
      </div>
    </div>
  );
}
