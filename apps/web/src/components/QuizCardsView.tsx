import { useId, useMemo, useState } from 'react';
import type { QuizCardsSpec } from '../../../../packages/contracts/kit.ts';
import { gradeQuizCard, quizCards, quizSummary } from '../lib/quiz.ts';
import type { QuizGrade } from '../lib/quiz.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Linked } from './Linked.tsx';
import { linkKey } from '../lib/linking.ts';
import { Mark } from './icons.tsx';
import { capitalFirst, prettyExponents } from '../lib/displayText.ts';

interface Props { spec: QuizCardsSpec; cite: CiteProps }

/**
 * Quiz cards, predict-then-reveal: choose an answer (a keyboard radio group), lock it in, then the answer and the page's own
 * words appear. The option order is a seeded shuffle; the answer is the stored first option.
 */
export function QuizCardsView({ spec, cite }: Props) {
  const uid = useId();
  const cards = useMemo(() => quizCards(spec), [spec]);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [locked, setLocked] = useState<Record<string, QuizGrade>>({});
  const [hints, setHints] = useState<Record<string, boolean>>({});
  const summary = quizSummary(Object.values(locked), cards.length);

  const lock = (cardId: string): void => {
    const idx = picked[cardId];
    if (idx === undefined) return;
    const g = gradeQuizCard(spec, cardId, idx);
    if (g !== null) setLocked((prev) => ({ ...prev, [cardId]: g }));
  };
  const again = (): void => { setPicked({}); setLocked({}); setHints({}); };

  return (
    <div className="quiz" data-testid="quiz">
      <p className="muted small">Pick an answer and lock it in; the page’s own words appear after that.</p>
      <ol className="predictions">
        {cards.map((c, i) => {
          const grade = locked[c.id] ?? null;
          const legendId = `${uid}-${c.id}-q`;
          return (
            <Linked as="li" key={c.id} className="prediction quiz-card" links={[linkKey(c.sourceId, c.quote)]}>
              <fieldset className="choice-set" aria-labelledby={legendId}>
                <legend id={legendId} className="prediction-head">
                  <span className="case-label">Card {i + 1}</span> <span className="quiz-stem">{prettyExponents(c.stem)}</span>
                </legend>
                {c.options.map((o) => {
                  const mine = grade !== null && grade.pickedIndex === o.index;
                  const right = grade !== null && o.index === 0;
                  const mark = grade === null ? null : right ? (mine ? 'Your answer — correct' : 'The page’s answer') : mine ? 'Your answer' : null;
                  return (
                    <label key={o.index} className={`choice${picked[c.id] === o.index ? ' choice-picked' : ''}${right ? ' choice-right' : ''}${mine && !right ? ' choice-wrong' : ''}`}>
                      <input
                        type="radio"
                        name={`${uid}-${c.id}`}
                        checked={picked[c.id] === o.index}
                        disabled={grade !== null}
                        onChange={() => setPicked((prev) => ({ ...prev, [c.id]: o.index }))}
                      />
                      <span className="choice-text">{capitalFirst(prettyExponents(o.text))}</span>
                      {mark !== null && <span className="choice-mark"><Mark kind={right ? 'ok' : 'bad'} />{mark}</span>}
                    </label>
                  );
                })}
              </fieldset>
              {grade === null && (
                <div className="quiz-actions">
                  <button type="button" className="btn btn-primary" disabled={picked[c.id] === undefined} onClick={() => lock(c.id)}>Lock in answer</button>
                  {picked[c.id] === undefined && <span className="muted small">Pick an answer first</span>}
                  {c.hint !== '' && <button type="button" className="btn" aria-expanded={hints[c.id] === true} onClick={() => setHints((h) => ({ ...h, [c.id]: !h[c.id] }))}>{hints[c.id] === true ? 'Hide hint' : 'Show hint'}</button>}
                </div>
              )}
              {grade === null && hints[c.id] === true && c.hint !== '' && <p className="small quiz-hint"><strong>Hint:</strong> {c.hint}</p>}
              {grade !== null && (
                <div className={`grade ${grade.correct ? 'grade-ok' : 'grade-miss'}`} role="status">
                  <strong><Mark kind={grade.correct ? 'ok' : 'bad'} />{grade.correct ? 'Right' : 'Not quite'} — the page says “{grade.correctText}”.</strong>
                  {!grade.correct && <span>You chose “{grade.pickedText}”.</span>}
                </div>
              )}
              {grade !== null && <QuoteBlock componentId="quiz-cards-v1" part="card" id={c.id} sourceId={c.sourceId} quote={c.quote} cite={cite} caption="The page’s words" />}
            </Linked>
          );
        })}
      </ol>
      {summary.done && (
        <p className="grade grade-ok quiz-total" role="status">
          <strong>{summary.correct} of {summary.total} right.</strong>
          <button type="button" className="btn btn-small" onClick={again}>Try the cards again</button>
        </p>
      )}
    </div>
  );
}
