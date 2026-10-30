import { useId, useState } from 'react';
import type { TimelineEvent } from '../../../../packages/contracts/index.ts';
import { formatEventDate, gradePair, pairOptions } from '../lib/timeline.ts';
import type { PairGrade, PairPrediction } from '../lib/timeline.ts';
import { gapText } from '../lib/timeAxis.ts';
import type { CiteProps } from './Explanations.tsx';
import { EventEvidence } from './EventEvidence.tsx';
import { Mark } from './icons.tsx';
import { TimeAxisChart } from './TimeAxisChart.tsx';

interface CardProps {
  prediction: PairPrediction;
  index: number;
  events: readonly TimelineEvent[];
  seed: string;
  cite: CiteProps;
}

/**
 * "Which came first?" for one pair. Before the answer only the two event names show. After it, the two events appear on
 * their own time axis and an arrow is drawn along it from the earlier to the later one; the answer is recomputed from
 * the stated dates (the spec's stored earlier/later ids only name the pair).
 */
function WhichCameFirstCard({ prediction: p, index, events, seed, cite }: CardProps) {
  const [grade, setGrade] = useState<PairGrade | null>(null);
  const options = pairOptions(events, p, seed);
  const promptId = useId();
  if (options === null) {
    return (
      <li className="prediction wcf">
        <p className="prediction-head" id={promptId}><span className="case-label">Question {index + 1}</span> {p.prompt}</p>
        <p className="field-error" role="alert">This question names an event that is not on the timeline, so it cannot be graded.</p>
      </li>
    );
  }
  const pick = (id: string): void => { if (grade === null) setGrade(gradePair(events, p, id)); };
  const pair = grade === null ? null : grade.status === 'graded' ? [grade.earlier, grade.later] : [grade.first, grade.second];

  return (
    <li className={`prediction wcf${grade === null ? '' : ' wcf-answered'}`}>
      <p className="prediction-head" id={promptId}><span className="case-label">Question {index + 1}</span> {p.prompt}</p>
      <div className="pair-options wcf-options" role="group" aria-labelledby={promptId}>
        {options.map((e) => {
          const picked = grade !== null && grade.pickedId === e.id;
          const first = grade !== null && grade.status === 'graded' && grade.earlier.id === e.id;
          return (
            <button
              key={e.id}
              type="button"
              className={`btn pair-option${picked ? ' pair-picked' : ''}${first ? ' wcf-first' : ''}`}
              aria-pressed={picked}
              disabled={grade !== null}
              onClick={() => pick(e.id)}
            >
              <span className="wcf-option-label">{e.label}</span>
              {grade !== null && <span className="wcf-option-date">{formatEventDate(e)}</span>}
            </button>
          );
        })}
      </div>
      {grade === null && <p className="muted small">Pick the event you think happened first. Both dates appear on a time axis once you answer.</p>}
      {grade !== null && grade.status === 'graded' && (
        <div className={`grade ${grade.correct ? 'grade-ok' : 'grade-miss'}`} role="status">
          <strong><Mark kind={grade.correct ? 'ok' : 'bad'} />{grade.correct ? 'Right' : 'Not quite'} — “{grade.earlier.label}” came first.</strong>
          <span>“{grade.later.label}” came {gapText(grade.earlier, grade.later)}.</span>
        </div>
      )}
      {grade !== null && grade.status === 'ungradable' && (
        <div className="grade grade-miss" role="status">
          <strong>This pair is not graded</strong>
          <span>The source states these two dates too loosely ({formatEventDate(grade.first)} and {formatEventDate(grade.second)}) to say which came first.</span>
        </div>
      )}
      {pair !== null && grade !== null && (
        <>
          <TimeAxisChart
            events={pair}
            label={`Question ${index + 1}`}
            emphasis={pair.map((e) => e.id)}
            arrow={grade.status === 'graded' ? { fromId: grade.earlier.id, toId: grade.later.id, text: gapText(grade.earlier, grade.later) } : null}
          />
          <ol className="pair-answer" aria-label="Both events with their dates and quotes, earliest first">
            {pair.map((e) => (
              <li key={e.id}>
                <p><strong>{formatEventDate(e)}</strong> — {e.label}</p>
                <EventEvidence event={e} cite={cite} />
              </li>
            ))}
          </ol>
        </>
      )}
    </li>
  );
}

/** The timeline's ordering predictions as "which came first?" cards with a time-axis reveal. */
export function WhichCameFirst({ events, predictions, seed, cite }: { events: readonly TimelineEvent[]; predictions: readonly PairPrediction[]; seed: string; cite: CiteProps }) {
  const headingId = useId();
  if (predictions.length === 0) return null;
  return (
    <section className="card wcf-section" aria-labelledby={headingId}>
      <h3 id={headingId}>Which came first?</h3>
      <p className="muted small">Choose first; the dates, the gap between them and the page’s own words appear after you answer.</p>
      <ol className="predictions">
        {predictions.map((p, i) => <WhichCameFirstCard key={p.id} prediction={p} index={i} events={events} seed={seed} cite={cite} />)}
      </ol>
    </section>
  );
}
