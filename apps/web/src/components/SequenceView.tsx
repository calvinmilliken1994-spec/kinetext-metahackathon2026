import { useMemo, useState } from 'react';
import type { SequenceSpec } from '../../../../packages/contracts/kit.ts';
import { gradeSequence, sequenceStart, sequenceSummary } from '../lib/sequence.ts';
import { stationResults } from '../lib/stepTrack.ts';
import type { CiteProps } from './Explanations.tsx';
import { OrderBoard } from './OrderBoard.tsx';
import type { BoardResult } from './OrderBoard.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { StepTrack } from './StepTrack.tsx';

interface Props { spec: SequenceSpec; cite: CiteProps }

function hintText(spec: SequenceSpec): string {
  const basis = spec.orderBasis === 'numbered' ? 'The page numbers these steps.' : 'The page gives these steps in this order.';
  const cycle = spec.cyclic ? ' This is a cycle: any step can come first, as long as the steps follow one another round the loop.' : '';
  const note = spec.orderNote === '' ? '' : ` ${spec.orderNote}`;
  return `${basis}${cycle}${note} Drag a step along the track, or use its Up and Down buttons. The page’s words stay hidden until you check.`;
}

/**
 * The shared order board, drawn as a track of numbered stations, for the steps a page states in order. After Check the
 * page's order appears as a horizontal step track (with how the learner placed each step), and each card shows its
 * place and the page's words.
 */
export function SequenceView({ spec, cite }: Props) {
  const startOrder = useMemo(() => sequenceStart(spec), [spec]);
  const labels = useMemo(() => Object.fromEntries(spec.steps.map((s) => [s.id, s.label])), [spec]);
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<Record<string, boolean> | null>(null);

  const grade = (order: string[]): BoardResult => {
    const g = gradeSequence(spec, order);
    setResults(stationResults(g, order));
    return {
      correct: g.correct,
      summary: sequenceSummary(g, labels, spec),
      marks: order.map((_, i) => ({ ok: g.positions[i] === true, text: g.positions[i] === true ? 'Right place' : 'Not the right place' })),
    };
  };

  return (
    <div className="sequence-view">
      <OrderBoard
        items={spec.steps}
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
