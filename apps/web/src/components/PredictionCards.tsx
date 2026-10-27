import { useState } from 'react';
import type { FormEvent } from 'react';
import { accelerationOf } from '../../../../packages/activities/forces-1d/engine.ts';
import type { Prediction } from '../../../../packages/contracts/index.ts';
import { gradePrediction, parseGuess } from '../lib/predictions.ts';
import type { Grade } from '../lib/predictions.ts';
import { fixed, trimmed } from '../lib/format.ts';

interface CardProps {
  prediction: Prediction;
  index: number;
  onRun: (prediction: Prediction, index: number, grade: Grade) => void;
}

function PredictionCard({ prediction: p, index, onRun }: CardProps) {
  const [raw, setRaw] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = `pred-${p.id}-input`;
  const guess = parseGuess(raw);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (guess === null) {
      setError('Type a number (m/s²) before running.');
      return;
    }
    setError(null);
    // The reference value comes from the engine, never from the spec's stored expectation.
    let actual: number;
    try {
      actual = accelerationOf(p.massKg, p.netForceN);
    } catch {
      setError('The engine cannot evaluate this prediction.');
      return;
    }
    const g = gradePrediction(guess, actual, p.tolerance);
    setGrade(g);
    onRun(p, index, g);
  };

  return (
    <li className="prediction">
      <form onSubmit={submit} noValidate>
        <div className="prediction-head">
          <span className="prediction-num">{index + 1}</span>
          <p id={`${inputId}-prompt`}>{p.prompt}</p>
        </div>
        <div className="prediction-row">
          <label htmlFor={inputId}>Your prediction</label>
          <div className="guess">
            <input
              id={inputId}
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 2.5"
              value={raw}
              aria-describedby={`${inputId}-prompt ${inputId}-tol`}
              onChange={(e) => { setRaw(e.target.value); setError(null); }}
            />
            <span className="unit">m/s²</span>
          </div>
          <button type="submit" className="btn btn-primary" disabled={guess === null}>Run it</button>
        </div>
        <p className="muted small" id={`${inputId}-tol`}>Counts as correct within ±{trimmed(p.tolerance, 6)} m/s².</p>
        {error !== null && <p className="field-error" role="alert">{error}</p>}
        {grade !== null && (
          <div className={`grade ${grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong>{grade.withinTolerance ? '✓ Within tolerance' : `✗ Outside tolerance — your guess was too ${grade.direction === 'high' ? 'high' : 'low'}`}</strong>
            <span>
              You guessed {trimmed(grade.guess, 4)} m/s² · engine says <b>a = F/m = {trimmed(p.netForceN, 4)} / {trimmed(p.massKg, 4)} = {fixed(grade.actual, 3)} m/s²</b>
              {' '}· off by {trimmed(Math.abs(grade.error), 4)} (tolerance ±{trimmed(grade.tolerance, 6)})
            </span>
          </div>
        )}
      </form>
    </li>
  );
}

export function PredictionCards({ predictions, onRun }: { predictions: readonly Prediction[]; onRun: (prediction: Prediction, index: number, grade: Grade) => void }) {
  if (predictions.length === 0) return null;
  return (
    <section className="card" aria-labelledby="pred-heading">
      <h3 id="pred-heading">Predict, then run</h3>
      <p className="muted small">Commit to a number first. “Run it” sets the sliders, plays the motion, and checks your guess against the engine.</p>
      <ol className="predictions">
        {predictions.map((p, i) => <PredictionCard key={p.id} prediction={p} index={i} onRun={onRun} />)}
      </ol>
    </section>
  );
}
