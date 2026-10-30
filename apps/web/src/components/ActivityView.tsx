import { useCallback, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { ActivitySpec, AnyPrediction, EngineId, ForcesActivitySpec, Prediction } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import { caseInputs, defaultInputs, formatOutputValue, isEngineSpec, outputInfo, playbackPlan } from '../lib/engines.ts';
import type { Grade } from '../lib/predictions.ts';
import { trimmed } from '../lib/format.ts';
import { revealInPanels } from '../lib/scroll.ts';
import { engineEquation } from '../lib/equation.ts';
import { equationQuoteLinks } from '../lib/linking.ts';
import { initialConcealed, nextConcealed } from '../lib/reveal.ts';
import type { RevealEvent } from '../lib/reveal.ts';
import { EquationLine } from './EquationLine.tsx';
import { isTimelineSpec } from '../lib/timeline.ts';
import type { AnyActivitySpec } from '../lib/timeline.ts';
import { ActivityHeader } from './ActivityHeader.tsx';
import { TimelineActivity } from './TimelineActivity.tsx';
import { Simulation } from './Simulation.tsx';
import { PredictionCards } from './PredictionCards.tsx';
import { Explanations } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { Mark } from './icons.tsx';
import { useSimulation } from './useSimulation.ts';
import { useSourceDoc } from '../hooks.ts';
import { usePlayback } from './usePlayback.ts';
import { ProjectileView } from './ProjectileView.tsx';
import { LiftView } from './LiftView.tsx';
import { SoundView } from './SoundView.tsx';
import { CompoundInterestView } from './CompoundInterestView.tsx';
import { HardyWeinbergView } from './HardyWeinbergView.tsx';
import { HalfLifeView } from './HalfLifeView.tsx';

interface LastResult { index: number; grade: Grade }

export interface ActivityPanelProps {
  /** A numeric-engine spec or a timeline spec; the panel dispatches on simulation.engine. */
  spec: AnyActivitySpec;
  cite: CiteProps;
  /** AI-generation disclosure text for this source kind. */
  disclosure: string;
  /** 'Repaired by Muse' / 'System-made fault, repaired by Muse' when a later revision was published. */
  repairBadge: Badge | null;
  /** The lesson's provenance line, when this activity is the whole lesson (classic flow). */
  provenance?: ReactNode;
}

/** Props of the numeric-engine activities (everything except a timeline). */
type NumericProps = Omit<ActivityPanelProps, 'spec'> & { spec: ActivitySpec };

interface ShellProps extends NumericProps {
  engine: EngineId;
  last: LastResult | null;
  simRef: RefObject<HTMLDivElement | null>;
  onRun: (p: AnyPrediction, index: number, grade: Grade) => void;
  children: ReactNode;
}

/**
 * Header with the provenance line, the last prediction result, the engine view (which shows case 1's predict card right under
 * its scene, above the sliders), the remaining cases, explanations.
 */
function Shell({ spec, cite, repairBadge, provenance, engine, last, simRef, onRun, children }: ShellProps) {
  const out = outputInfo(engine);
  const unit = out.unit === '' ? '' : ` ${out.unit}`;
  return (
    <article className="activity" aria-labelledby="activity-title" data-engine={engine}>
      <ActivityHeader title={spec.title} learningObjectives={spec.learningObjectives} engine={engine} repairBadge={repairBadge} provenance={provenance} />
      <div ref={simRef} className="sim-anchor">
        {last !== null && (
          <div className={`last-result ${last.grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong><Mark kind={last.grade.withinTolerance ? 'ok' : 'bad'} />Prediction {last.index + 1}: {last.grade.withinTolerance ? 'close enough' : 'not close enough'}</strong>
            <span>
              you guessed {trimmed(last.grade.guess, 4)}{unit}, the engine gives {formatOutputValue(engine, last.grade.actual)}{unit} (±{trimmed(last.grade.tolerance, 4)} allowed)
            </span>
          </div>
        )}
        {children}
      </div>
      <PredictionCards engine={engine} predictions={spec.predictions as AnyPrediction[]} onRun={onRun} part="rest" />
      <Explanations explanations={spec.explanations} cite={cite} />
    </article>
  );
}

/** Case 1's answer stays hidden until the class has predicted (lib/reveal.ts). */
function useReveal(caseCount: number): [boolean, (event: RevealEvent) => void] {
  const [concealed, setConcealed] = useState(() => initialConcealed(caseCount));
  const reveal = useCallback((event: RevealEvent) => setConcealed((c) => nextConcealed(c, event)), []);
  return [concealed, reveal];
}

function scrollToScene(el: HTMLElement | null): void {
  // Bring the scene into view (inside the lesson column only) so the student watches the motion that answers their prediction.
  revealInPanels(el, 'start');
}

function ForcesActivity(props: NumericProps & { spec: ForcesActivitySpec }) {
  const { spec } = props;
  const raw = useSimulation(spec);
  const simRef = useRef<HTMLDivElement>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [concealed, reveal] = useReveal(spec.predictions.length);
  const { runWith } = raw;
  // Any slider move, Play or scrub reveals case 1's answer (predict-then-reveal).
  const ctl = useMemo(() => ({
    ...raw,
    setMass: (v: number) => { reveal('slider'); raw.setMass(v); },
    setForce: (v: number) => { reveal('slider'); raw.setForce(v); },
    play: () => { reveal('play'); raw.play(); },
    scrub: (t: number) => { reveal('scrub'); raw.scrub(t); },
  }), [raw, reveal]);

  const onRun = useCallback((p: AnyPrediction, index: number, grade: Grade) => {
    const fp = p as Prediction;
    reveal('run-case');
    runWith(fp.massKg, fp.netForceN);
    setLast({ index, grade });
    scrollToScene(simRef.current);
  }, [runWith, reveal]);

  const caseValues = useMemo(() => ({
    massKg: spec.predictions.map((p) => p.massKg),
    netForceN: spec.predictions.map((p) => p.netForceN),
  }), [spec]);
  const predict = <PredictionCards engine="forces-1d-v1" predictions={spec.predictions as AnyPrediction[]} onRun={onRun} part="first" answerHidden={concealed} />;
  const equation = <EquationLine equation={engineEquation('forces-1d-v1', { massKg: ctl.massKg, netForceN: ctl.netForceN })} concealed={concealed} links={equationQuoteLinks(spec)} />;
  return (
    <Shell {...props} engine="forces-1d-v1" last={last} simRef={simRef} onRun={onRun}>
      <Simulation sim={spec.simulation} ctl={ctl} predict={predict} equation={equation} concealed={concealed} caseValues={caseValues} />
    </Shell>
  );
}

/** projectile / lift / speed-of-sound / compound interest / Hardy-Weinberg / half-life: slider state + (for animated engines) a playback clock, all fed to the shared engines. */
function ClosedFormActivity(props: NumericProps & { engine: Exclude<EngineId, 'forces-1d-v1'> }) {
  const { spec, engine, cite } = props;
  // The lesson opens on its first case (clamped to the sliders); Reset returns here.
  const opening = useMemo(() => defaultInputs(spec), [spec]);
  const [inputs, setInputs] = useState<Record<string, number>>(opening);
  const plan = useMemo(() => playbackPlan(engine, inputs), [engine, inputs]);
  const pb = usePlayback(plan?.durationS ?? 0, plan?.speed ?? 1, plan?.initialT ?? 0);
  const simRef = useRef<HTMLDivElement>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const [concealed, reveal] = useReveal(spec.predictions.length);
  const { rewind, restart, reset } = pb;
  // Page-stated preset values need the page text (projectile only for now; GET of the already-shown source).
  const doc = useSourceDoc(engine === 'projectile-v1' ? cite.sourceId : null);
  const sourceText = doc?.state === 'ready' ? doc.data.text : null;

  const onInput = useCallback((key: string, value: number) => {
    reveal('slider');
    setInputs((prev) => ({ ...prev, [key]: value }));
    // A new launch changes the whole trajectory, so restart it from t = 0 (the play state is kept).
    if (engine === 'projectile-v1') rewind();
  }, [engine, rewind, reveal]);

  const onReset = useCallback(() => {
    setInputs(opening);
    reset();
  }, [opening, reset]);
  const resetPb = useMemo(() => ({
    ...pb,
    reset: onReset,
    play: () => { reveal('play'); pb.play(); },
    scrub: (t: number) => { reveal('scrub'); pb.scrub(t); },
  }), [pb, onReset, reveal]);

  const onRun = useCallback((p: AnyPrediction, index: number, grade: Grade) => {
    reveal('run-case');
    setInputs(caseInputs(engine, p));
    restart();
    setLast({ index, grade });
    scrollToScene(simRef.current);
  }, [engine, restart, reveal]);

  const predict = <PredictionCards engine={engine} predictions={spec.predictions as AnyPrediction[]} onRun={onRun} part="first" answerHidden={concealed} />;
  const eqLinks = useMemo(() => equationQuoteLinks(spec), [spec]);
  const equation = <EquationLine equation={engineEquation(engine, inputs)} concealed={concealed} links={eqLinks} />;
  const view = { inputs, onInput, onReset, predict, equation, concealed };
  return (
    <Shell {...props} engine={engine} last={last} simRef={simRef} onRun={onRun}>
      {isEngineSpec(spec, 'projectile-v1') && <ProjectileView spec={spec} {...view} pb={resetPb} sourceText={sourceText} />}
      {isEngineSpec(spec, 'lift-equation-v1') && <LiftView spec={spec} {...view} />}
      {isEngineSpec(spec, 'speed-of-sound-v1') && <SoundView spec={spec} {...view} pb={resetPb} />}
      {isEngineSpec(spec, 'compound-interest-v1') && <CompoundInterestView spec={spec} {...view} />}
      {isEngineSpec(spec, 'hardy-weinberg-v1') && <HardyWeinbergView spec={spec} {...view} />}
      {isEngineSpec(spec, 'half-life-v1') && <HalfLifeView spec={spec} {...view} />}
    </Shell>
  );
}

/** The interactive activity for one validated spec; dispatches on spec.simulation.engine. Mount with key={spec.id}. */
export function ActivityPanel(props: ActivityPanelProps) {
  const { spec } = props;
  if (isTimelineSpec(spec)) return <TimelineActivity spec={spec} cite={props.cite} repairBadge={props.repairBadge} provenance={props.provenance} />;
  const numeric = { ...props, spec };
  if (isEngineSpec(spec, 'forces-1d-v1')) return <ForcesActivity {...numeric} spec={spec} />;
  if (isEngineSpec(spec, 'projectile-v1')) return <ClosedFormActivity {...numeric} engine="projectile-v1" />;
  if (isEngineSpec(spec, 'lift-equation-v1')) return <ClosedFormActivity {...numeric} engine="lift-equation-v1" />;
  if (isEngineSpec(spec, 'speed-of-sound-v1')) return <ClosedFormActivity {...numeric} engine="speed-of-sound-v1" />;
  if (isEngineSpec(spec, 'compound-interest-v1')) return <ClosedFormActivity {...numeric} engine="compound-interest-v1" />;
  if (isEngineSpec(spec, 'hardy-weinberg-v1')) return <ClosedFormActivity {...numeric} engine="hardy-weinberg-v1" />;
  if (isEngineSpec(spec, 'half-life-v1')) return <ClosedFormActivity {...numeric} engine="half-life-v1" />;
  return (
    <div className="outcome outcome-failed" role="alert">
      <h2>This app cannot show this activity</h2>
      <p className="muted">The spec names an activity type this version of the workspace does not know, so nothing is shown.</p>
    </div>
  );
}
