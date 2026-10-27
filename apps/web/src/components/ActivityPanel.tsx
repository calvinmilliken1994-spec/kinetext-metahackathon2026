import { useCallback, useRef, useState } from 'react';
import type { ForcesActivitySpec as ActivitySpec, Prediction } from '../../../../packages/contracts/index.ts';
import type { Grade } from '../lib/predictions.ts';
import { fixed, trimmed } from '../lib/format.ts';
import { Disclosure } from './Disclosure.tsx';
import { Simulation } from './Simulation.tsx';
import { PredictionCards } from './PredictionCards.tsx';
import { Explanations } from './Explanations.tsx';
import type { CiteProps } from './Explanations.tsx';
import { useSimulation } from './useSimulation.ts';

interface LastResult { index: number; grade: Grade }

/** The interactive activity for one validated spec. Mount with key={spec.id} so state resets per spec. */
export function ActivityPanel({ spec, cite }: { spec: ActivitySpec; cite: CiteProps }) {
  const ctl = useSimulation(spec.simulation);
  const simRef = useRef<HTMLDivElement>(null);
  const [last, setLast] = useState<LastResult | null>(null);
  const { runWith } = ctl;

  const onRun = useCallback((p: Prediction, index: number, grade: Grade) => {
    runWith(p.massKg, p.netForceN);
    setLast({ index, grade });
    // Bring the scene into view so the student watches the motion that answers their prediction.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    simRef.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, [runWith]);

  return (
    <article className="activity" aria-labelledby="activity-title">
      <Disclosure />
      <header className="activity-head">
        <p className="eyebrow">Interactive activity · {spec.simulation.engine}</p>
        <h2 id="activity-title">{spec.title}</h2>
        <ul className="objectives" aria-label="Learning objectives">
          {spec.learningObjectives.map((o) => <li key={o}>{o}</li>)}
        </ul>
      </header>
      <div ref={simRef} className="sim-anchor">
        {last !== null && (
          <div className={`last-result ${last.grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong>Prediction {last.index + 1}: {last.grade.withinTolerance ? '✓ within tolerance' : '✗ outside tolerance'}</strong>
            <span>
              you guessed {trimmed(last.grade.guess, 4)} m/s², the engine gives {fixed(last.grade.actual, 3)} m/s² (±{trimmed(last.grade.tolerance, 6)} allowed)
            </span>
          </div>
        )}
        <Simulation sim={spec.simulation} ctl={ctl} />
      </div>
      <PredictionCards predictions={spec.predictions} onRun={onRun} />
      <Explanations explanations={spec.explanations} cite={cite} />
    </article>
  );
}
