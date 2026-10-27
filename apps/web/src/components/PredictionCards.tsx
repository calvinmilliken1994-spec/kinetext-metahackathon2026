import { useState } from 'react';
import type { FormEvent } from 'react';
import type { AnyPrediction, EngineId } from '../../../../packages/contracts/index.ts';
import { engineOutput, formatQuantity, outputInfo, predictionExplanation } from '../lib/engines.ts';
import { gradePrediction, parseGuess } from '../lib/predictions.ts';
import type { Grade } from '../lib/predictions.ts';
import { trimmed } from '../lib/format.ts';

export type RunPrediction = (prediction: AnyPrediction, index: number, grade: Grade) => void;

interface CardProps {
  engine: EngineId;
  prediction: AnyPrediction;
  index: number;
  onRun: RunPrediction;
}

function PredictionCard({ engine, prediction: p, index, onRun }: CardProps) {
  const [raw, setRaw] = useState('');
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const out = outputInfo(engine);
  const unit = out.unit === '' ? '' : ` ${out.unit}`;
  const inputId = `pred-${p.id}-input`;
  const guess = parseGuess(raw);

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    if (guess === null) {
      setError(`Type a number${out.unit === '' ? '' : ` (${out.unit})`} before running.`);
      return;
    }
    setError(null);
    // The reference value comes from the engine, never from the spec's stored expectation.
    const actual = engineOutput(engine, p);
    if (actual === null) {
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
          <label htmlFor={inputId}>Your prediction: {out.label.toLowerCase()}</label>
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
            <span className="unit">{out.unit}</span>
          </div>
          <button type="submit" className="btn btn-primary" disabled={guess === null}>Run it</button>
        </div>
        <p className="muted small" id={`${inputId}-tol`}>Counts as correct within ±{trimmed(p.tolerance, 6)}{unit}.</p>
        {error !== null && <p className="field-error" role="alert">{error}</p>}
        {grade !== null && (
          <div className={`grade ${grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong>{grade.withinTolerance ? '✓ Within tolerance' : `✗ Outside tolerance — your guess was too ${grade.direction === 'high' ? 'high' : 'low'}`}</strong>
            <span>
              You guessed {trimmed(grade.guess, 4)}{unit} · engine says <b>{predictionExplanation(engine, p, grade.actual)}</b>
              {' '}· off by {formatQuantity(Math.abs(grade.error))} (tolerance ±{trimmed(grade.tolerance, 6)})
            </span>
          </div>
        )}
      </form>
    </li>
  );
}

export function PredictionCards({ engine, predictions, onRun }: { engine: EngineId; predictions: readonly AnyPrediction[]; onRun: RunPrediction }) {
  if (predictions.length === 0) return null;
  return (
    <section className="card" aria-labelledby="pred-heading">
      <h3 id="pred-heading">Predict, then run</h3>
      <p className="muted small">Commit to a number first. “Run it” sets the sliders, plays the model, and checks your guess against the engine.</p>
      <ol className="predictions">
        {predictions.map((p, i) => <PredictionCard key={p.id} engine={engine} prediction={p} index={i} onRun={onRun} />)}
      </ol>
    </section>
  );
}
