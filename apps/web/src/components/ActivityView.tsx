import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { ENGINES } from '../../../../packages/contracts/index.ts';
import type { ActivitySpec, AnyPrediction, EngineId, ForcesActivitySpec, Prediction } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { caseInputs, defaultInputs, formatOutputValue, isEngineSpec, outputInfo, playbackPlan } from '../lib/engines.ts';
import type { Grade } from '../lib/predictions.ts';
import { trimmed } from '../lib/format.ts';
import { Disclosure } from './Disclosure.tsx';
import { Simulation } from './Simulation.tsx';
import { PredictionCards } from './PredictionCards.tsx';
import { Explanations } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { useSimulation } from './useSimulation.ts';
import { usePlayback } from './usePlayback.ts';
import { ProjectileView } from './ProjectileView.tsx';
import { LiftView } from './LiftView.tsx';
import { SoundView } from './SoundView.tsx';
import { CompoundInterestView } from './CompoundInterestView.tsx';
import { HardyWeinbergView } from './HardyWeinbergView.tsx';
import { HalfLifeView } from './HalfLifeView.tsx';

interface LastResult { index: number; grade: Grade }

export interface ActivityPanelProps {
  spec: ActivitySpec;
  cite: CiteProps;
  /** AI-generation disclosure text for this source kind. */
  disclosure: string;
  /** 'Repaired by Muse' / 'System-made fault, repaired by Muse' when a later revision was published. */
  repairBadge: Badge | null;
}

interface ShellProps extends ActivityPanelProps {
  engine: EngineId;
  last: LastResult | null;
  simRef: RefObject<HTMLDivElement | null>;
  onRun: (p: AnyPrediction, index: number, grade: Grade) => void;
  children: ReactNode;
}

/** Disclosure, header with the chosen activity type, last prediction result, engine view, predictions, explanations. */
function Shell({ spec, cite, disclosure, repairBadge, engine, last, simRef, onRun, children }: ShellProps) {
  const out = outputInfo(engine);
  const unit = out.unit === '' ? '' : ` ${out.unit}`;
  return (
    <article className="activity" aria-labelledby="activity-title" data-engine={engine}>
      <Disclosure text={disclosure} />
      <header className="activity-head">
        <p className="eyebrow">
          Interactive activity · <span className="engine-title">{ENGINES[engine].title}</span> · <code>{engine}</code>
        </p>
        <h2 id="activity-title">{spec.title}</h2>
        {repairBadge !== null && (
          <p className="head-badges">
            <span className={`badge badge-${repairBadge.tone}`} data-testid="repair-badge">{repairBadge.tone === 'ok' ? '✓ ' : '⚠ '}{repairBadge.text}</span>
          </p>
        )}
        <ul className="objectives" aria-label="Learning objectives">
          {spec.learningObjectives.map((o) => <li key={o}>{o}</li>)}
        </ul>
      </header>
      <div ref={simRef} className="sim-anchor">
        {last !== null && (
          <div className={`last-result ${last.grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong>Prediction {last.index + 1}: {last.grade.withinTolerance ? '✓ close enough' : '✗ not close enough'}</strong>
            <span>
              you guessed {trimmed(last.grade.guess, 4)}{unit}, the engine gives {formatOutputValue(engine, last.grade.actual)}{unit} (±{trimmed(last.grade.tolerance, 6)} allowed)
            </span>
          </div>
        )}
        {children}
      </div>
      <PredictionCards engine={engine} predictions={spec.predictions as AnyPrediction[]} onRun={onRun} />
      <Explanations explanations={spec.explanations} cite={cite} />
    </article>
  );
}

function scrollToScene(el: HTMLElement | null): void {
  // Bring the scene into view so the student watches the motion that answers their prediction.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
}

function ForcesActivity(props: ActivityPanelProps & { spec: ForcesActivitySpec }) {
  const { spec } = props;
  const ctl = useSimulation(spec.simulation);
  const simRef = useRef<HTMLDivElement>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const { runWith } = ctl;

  const onRun = useCallback((p: AnyPrediction, index: number, grade: Grade) => {
    const fp = p as Prediction;
    runWith(fp.massKg, fp.netForceN);
    setLast({ index, grade });
    scrollToScene(simRef.current);
  }, [runWith]);

  return (
    <Shell {...props} engine="forces-1d-v1" last={last} simRef={simRef} onRun={onRun}>
      <Simulation sim={spec.simulation} ctl={ctl} />
    </Shell>
  );
}

/** projectile / lift / speed-of-sound / compound interest / Hardy-Weinberg / half-life: slider state + (for animated engines) a playback clock, all fed to the shared engines. */
function ClosedFormActivity(props: ActivityPanelProps & { engine: Exclude<EngineId, 'forces-1d-v1'> }) {
  const { spec, engine } = props;
  const [inputs, setInputs] = useState<Record<string, number>>(() => defaultInputs(spec));
  const plan = useMemo(() => playbackPlan(engine, inputs), [engine, inputs]);
  const pb = usePlayback(plan?.durationS ?? 0, plan?.speed ?? 1, plan?.initialT ?? 0);
  const simRef = useRef<HTMLDivElement>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const { rewind, restart } = pb;

  const onInput = useCallback((key: string, value: number) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    // A new launch changes the whole trajectory, so restart it from t = 0 (the play state is kept).
    if (engine === 'projectile-v1') rewind();
  }, [engine, rewind]);

  const onRun = useCallback((p: AnyPrediction, index: number, grade: Grade) => {
    setInputs(caseInputs(engine, p));
    restart();
    setLast({ index, grade });
    scrollToScene(simRef.current);
  }, [engine, restart]);

  return (
    <Shell {...props} engine={engine} last={last} simRef={simRef} onRun={onRun}>
      {isEngineSpec(spec, 'projectile-v1') && <ProjectileView spec={spec} inputs={inputs} onInput={onInput} pb={pb} />}
      {isEngineSpec(spec, 'lift-equation-v1') && <LiftView spec={spec} inputs={inputs} onInput={onInput} />}
      {isEngineSpec(spec, 'speed-of-sound-v1') && <SoundView spec={spec} inputs={inputs} onInput={onInput} pb={pb} />}
      {isEngineSpec(spec, 'compound-interest-v1') && <CompoundInterestView spec={spec} inputs={inputs} onInput={onInput} />}
      {isEngineSpec(spec, 'hardy-weinberg-v1') && <HardyWeinbergView spec={spec} inputs={inputs} onInput={onInput} />}
      {isEngineSpec(spec, 'half-life-v1') && <HalfLifeView spec={spec} inputs={inputs} onInput={onInput} />}
    </Shell>
  );
}

/** The interactive activity for one validated spec; dispatches on spec.simulation.engine. Mount with key={spec.id}. */
export function ActivityPanel(props: ActivityPanelProps) {
  const { spec } = props;
  if (isEngineSpec(spec, 'forces-1d-v1')) return <ForcesActivity {...props} spec={spec} />;
  if (isEngineSpec(spec, 'projectile-v1')) return <ClosedFormActivity {...props} engine="projectile-v1" />;
  if (isEngineSpec(spec, 'lift-equation-v1')) return <ClosedFormActivity {...props} engine="lift-equation-v1" />;
  if (isEngineSpec(spec, 'speed-of-sound-v1')) return <ClosedFormActivity {...props} engine="speed-of-sound-v1" />;
  if (isEngineSpec(spec, 'compound-interest-v1')) return <ClosedFormActivity {...props} engine="compound-interest-v1" />;
  if (isEngineSpec(spec, 'hardy-weinberg-v1')) return <ClosedFormActivity {...props} engine="hardy-weinberg-v1" />;
  if (isEngineSpec(spec, 'half-life-v1')) return <ClosedFormActivity {...props} engine="half-life-v1" />;
  return (
    <div className="outcome outcome-failed" role="alert">
      <p className="eyebrow">Unknown activity type</p>
      <h2>This app cannot show this activity</h2>
      <p className="muted">The spec names an activity engine this version of the workspace does not know, so nothing is rendered.</p>
    </div>
  );
}
