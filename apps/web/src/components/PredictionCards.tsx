import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import type { AnyPrediction, EngineId, TimelineEvent } from '../../../../packages/contracts/index.ts';
import { engineOutput, formatOutputValue, outputInfo, predictionExplanation } from '../lib/engines.ts';
import { gradePrediction, parseGuess, studentTolerance } from '../lib/predictions.ts';
import type { Grade } from '../lib/predictions.ts';
import { trimmed } from '../lib/format.ts';
import { formatEventDate, gradePair, pairOptions } from '../lib/timeline.ts';
import type { PairGrade, PairPrediction } from '../lib/timeline.ts';
import { EventEvidence } from './EventEvidence.tsx';
import type { CiteProps } from './Explanations.tsx';
import { Mark } from './icons.tsx';
import { amountText, prettyExponents } from '../lib/displayText.ts';

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
    const g = gradePrediction(guess, actual, studentTolerance(actual, p.tolerance));
    setGrade(g);
    onRun(p, index, g);
  };

  return (
    <li className="prediction">
      <form onSubmit={submit} noValidate>
        <p className="prediction-head" id={`${inputId}-prompt`}><span className="case-label">Case {index + 1}</span> {prettyExponents(p.prompt)}</p>
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
          <button type="submit" className="btn btn-primary" disabled={guess === null} aria-describedby={guess === null ? `${inputId}-first` : undefined}>Run it</button>
        </div>
        <p className="muted small" id={`${inputId}-tol`}>{guess === null && <span id={`${inputId}-first`}>Make a prediction first. </span>}Counts as correct within 2% of the engine's value (or ±{trimmed(p.tolerance, 6)}{prettyExponents(unit)}, whichever is larger).</p>
        {error !== null && <p className="field-error" role="alert">{error}</p>}
        {grade !== null && (
          <div className={`grade ${grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
            <strong><Mark kind={grade.withinTolerance ? 'ok' : 'bad'} />{grade.withinTolerance ? 'Close enough' : `Not close enough — your guess was too ${grade.direction === 'high' ? 'high' : 'low'}`}</strong>
            <span>
              You guessed {trimmed(grade.guess, 4)}{unit} · engine says <b>{predictionExplanation(engine, p, grade.actual)}</b>
              {' '}· off by {amountText(Math.abs(grade.error), out.unit)} (allowed ±{amountText(grade.tolerance, out.unit)})
            </span>
          </div>
        )}
      </form>
    </li>
  );
}

export interface PredictionCardsProps {
  engine: EngineId;
  predictions: readonly AnyPrediction[];
  onRun: RunPrediction;
  /**
   * 'first' = only case 1, shown right under the scene so the class predicts before anything moves; 'rest' = cases 2…n
   * below the sliders; 'all' = every case in one list (default).
   */
  part?: 'first' | 'rest' | 'all';
  /** Case 1's answer is still hidden in the scene and readouts (shown as '?'). */
  answerHidden?: boolean;
}

export function PredictionCards({ engine, predictions, onRun, part = 'all', answerHidden = false }: PredictionCardsProps) {
  const headingId = useId();
  const from = part === 'rest' ? 1 : 0;
  const to = part === 'first' ? Math.min(1, predictions.length) : predictions.length;
  if (to <= from) return null;
  const shown = predictions.slice(from, to);
  const heading = part === 'rest' ? 'More cases' : 'Predict, then run';
  const hint = part === 'rest'
    ? '“Run it” moves the sliders to that case and plays it.'
    : `Commit to a number first; “Run it” sets the sliders, plays the model and checks your guess.${answerHidden ? ' Until then the answer shows as ?.' : ''}`;
  return (
    <section className={part === 'first' ? 'predict-first' : 'card'} aria-labelledby={headingId} data-part={part}>
      <h3 id={headingId}>{heading}</h3>
      <p className="muted small">{hint}</p>
      <ol className="predictions" start={from + 1}>
        {shown.map((p, i) => <PredictionCard key={p.id} engine={engine} prediction={p} index={from + i} onRun={onRun} />)}
      </ol>
    </section>
  );
}

// ---- timeline-v1: "which happened first?" -------------------------------------------------------------------

interface TimelineCardProps {
  prediction: PairPrediction;
  index: number;
  events: readonly TimelineEvent[];
  seed: string;
  cite: CiteProps;
}

function TimelinePredictionCard({ prediction: p, index, events, seed, cite }: TimelineCardProps) {
  const [grade, setGrade] = useState<PairGrade | null>(null);
  const options = pairOptions(events, p, seed);
  const promptId = `pred-${p.id}-prompt`;
  if (options === null) {
    return (
      <li className="prediction">
        <p className="prediction-head" id={promptId}><span className="case-label">Question {index + 1}</span> {prettyExponents(p.prompt)}</p>
        <p className="field-error" role="alert">This question names an event that is not on the timeline, so it cannot be graded.</p>
      </li>
    );
  }
  // The answer is always recomputed from the dates; the spec's stored earlier/later ids only name the two events.
  const pick = (id: string): void => { if (grade === null) setGrade(gradePair(events, p, id)); };

  return (
    <li className="prediction">
      <p className="prediction-head" id={promptId}><span className="case-label">Question {index + 1}</span> {p.prompt}</p>
      <div className="pair-options" role="group" aria-labelledby={promptId}>
        {options.map((e) => {
          const picked = grade !== null && grade.pickedId === e.id;
          return (
            <button
              key={e.id}
              type="button"
              className={`btn pair-option${picked ? ' pair-picked' : ''}`}
              aria-pressed={picked}
              disabled={grade !== null}
              onClick={() => pick(e.id)}
            >
              {e.label}
            </button>
          );
        })}
      </div>
      {grade === null && <p className="muted small">Pick the event you think happened first. The dates and quotes from the source appear once you answer.</p>}
      {grade !== null && grade.status === 'graded' && (
        <div className={`grade ${grade.correct ? 'grade-ok' : 'grade-miss'}`} role="status">
          <strong><Mark kind={grade.correct ? 'ok' : 'bad'} />{grade.correct ? 'Right' : 'Not quite'} — “{grade.earlier.label}” came first.</strong>
          <span>
            {formatEventDate(grade.earlier)}, then {formatEventDate(grade.later)}
            {!grade.correct && <> · you picked “{(grade.pickedId === grade.later.id ? grade.later : grade.earlier).label}”</>}
          </span>
        </div>
      )}
      {grade !== null && grade.status === 'ungradable' && (
        <div className="grade grade-miss" role="status">
          <strong>This pair is not graded</strong>
          <span>The source states these two dates too loosely ({formatEventDate(grade.first)} and {formatEventDate(grade.second)}) to say which came first.</span>
        </div>
      )}
      {grade !== null && (
        <ol className="pair-answer" aria-label="Both events with their dates and quotes, earliest first">
          {(grade.status === 'graded' ? [grade.earlier, grade.later] : [grade.first, grade.second]).map((e) => (
            <li key={e.id}>
              <p><strong>{formatEventDate(e)}</strong> — {e.label}</p>
              <EventEvidence event={e} cite={cite} />
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

export function TimelinePredictionCards({ events, predictions, seed, cite }: { events: readonly TimelineEvent[]; predictions: readonly PairPrediction[]; seed: string; cite: CiteProps }) {
  if (predictions.length === 0) return null;
  return (
    <section className="card" aria-labelledby="pred-heading">
      <h3 id="pred-heading">Predict, then reveal</h3>
      <p className="muted small">Choose first; the dates and the source’s own words appear after you answer.</p>
      <ol className="predictions">
        {predictions.map((p, i) => <TimelinePredictionCard key={p.id} prediction={p} index={i} events={events} seed={seed} cite={cite} />)}
      </ol>
    </section>
  );
}
