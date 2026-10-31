import { useMemo, useState } from 'react';
import type { SequenceSpec } from '../../../../packages/contracts/kit.ts';
import { gradeSequence, sequenceStart, sequenceSummary } from '../lib/sequence.ts';
import { stationResults } from '../lib/stepTrack.ts';
import type { CiteProps } from './Explanations.tsx';
import { OrderBoard } from './OrderBoard.tsx';
import type { BoardResult } from './OrderBoard.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { StepTrack } from './StepTrack.tsx';
import { capitalFirst, joinSentences, prettyExponents } from '../lib/displayText.ts';
import { linkKey } from '../lib/linking.ts';

interface Props { spec: SequenceSpec; cite: CiteProps; presentation?: { mode: 'stage' } }

function hintText(spec: SequenceSpec): string {
  // The order note is AI-written and often has no full stop; joinSentences keeps it a sentence of its own.
  return joinSentences(
    spec.orderBasis === 'numbered' ? 'The page numbers these steps.' : 'The page gives these steps in this order.',
    spec.cyclic ? 'This is a cycle: any step can come first, as long as the steps follow one another round the loop.' : '',
    prettyExponents(spec.orderNote),
    'Drag a step along the track, or use its up and down arrows. The page’s words stay hidden until you check.',
  );
}

/**
 * The shared order board, drawn as a track of numbered stations, for the steps a page states in order. After Check the
 * page's order appears as a horizontal step track (with how the learner placed each step), and each card shows its
 * place and the page's words.
 */
export function SequenceView({ spec, cite, presentation }: Props) {
  const startOrder = useMemo(() => sequenceStart(spec), [spec]);
  // Step labels are the page's words cut from a sentence ('quorum of seven states was obtained'): shown in sentence case.
  const steps = useMemo(() => spec.steps.map((s) => ({ ...s, label: capitalFirst(s.label) })), [spec]);
  const labels = useMemo(() => Object.fromEntries(steps.map((s) => [s.id, s.label])), [steps]);
  const place = useMemo(() => Object.fromEntries(spec.steps.map((s, i) => [s.id, i + 1])), [spec]);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Record<string, boolean> | null>(null);
  const staged = presentation !== undefined;

  const grade = (order: string[]): BoardResult => {
    const g = gradeSequence(spec, order);
    setResults(stationResults(g, order));
    return {
      correct: g.correct,
      summary: sequenceSummary(g, labels, spec),
      marks: order.map((_, i) => ({ ok: g.positions[i] === true, text: g.positions[i] === true ? 'Right place' : 'Not the right place' })),
    };
  };

  if (staged) {
    // Presentation: each card's answer (its place on the page) is laid out from the start and filled in on "Check order",
    // so no card moves; the page's words appear in the slide's quote zone when a checked card is hovered, never on it.
    return (
      <div className="sequence-view sequence-presented">
        <OrderBoard
          items={steps}
          startOrder={startOrder}
          heading="Put these steps in order"
          hint={joinSentences(spec.cyclic ? 'This is a cycle: any step can come first.' : '', 'Drag a step or use its arrows, then check the order. After the check, point at a step to see the page’s words.')}
          resultNote={spec.cyclic ? 'Each card now shows its place in the page’s cycle.' : 'Each card now shows its place on the page.'}
          revealed={checked}
          renderReveal={(s) => (
            <p className="order-place"><span>Page’s step <strong className="num">{place[s.id] ?? '?'}</strong></span>{s.orderHint !== '' && <span className="order-date">{s.orderHint}</span>}</p>
          )}
          grade={grade}
          onCheck={() => setChecked(true)}
          variant="track"
          reserve
          linksOf={(s) => [linkKey(s.sourceId, s.quote)]}
        />
      </div>
    );
  }

  return (
    <div className="sequence-view">
      <OrderBoard
        items={steps}
        startOrder={startOrder}
        heading="Put these steps in order"
        hint={hintText(spec)}
        resultNote="The page’s order is drawn on the track below; each card shows the page’s own words."
        revealed={checked}
        renderReveal={(s) => (
          <>
            {s.orderHint !== '' && <p className="order-date">{s.orderHint}</p>}
            <QuoteBlock componentId="sequence-v1" part="step" id={s.id} sourceId={s.sourceId} quote={s.quote} cite={cite} />
          </>
        )}
        grade={grade}
        onCheck={() => setChecked(true)}
        variant="track"
      />
      {checked && (
        <section className="st-section" aria-label="The page’s order">
          <h4 className="st-heading">The page’s order{spec.cyclic ? ' (a cycle)' : ''}</h4>
          <StepTrack spec={spec} results={results} />
        </section>
      )}
    </div>
  );
}
