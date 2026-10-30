import { useId, useMemo, useState } from 'react';
import type { CompareTableSpec } from '../../../../packages/contracts/kit.ts';
import { NOT_STATED, compareGrid, gradePredict, planPredict } from '../lib/compare.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Linked } from './Linked.tsx';
import { linkKey } from '../lib/linking.ts';
import { Mark } from './icons.tsx';

interface Props { spec: CompareTableSpec; cite: CiteProps }

/**
 * Compare table. When a column has three different values, one cell is hidden and the learner predicts it from three
 * options before it is revealed; otherwise it is reveal-only. Cells the page does not state read “Not stated on this page”.
 * Click a cell to read the page’s words behind it.
 */
export function CompareView({ spec, cite }: Props) {
  const uid = useId();
  const grid = useMemo(() => compareGrid(spec), [spec]);
  const plan = useMemo(() => planPredict(spec), [spec]);
  const [pick, setPick] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const cells = useMemo(() => new Map(spec.cells.map((c) => [c.id, c] as const)), [spec]);
  const openCell = open === null ? null : cells.get(open) ?? null;
  const hiddenId = plan !== null && !locked ? plan.cellId : null;
  const correct = plan !== null && pick !== null && gradePredict(plan, pick);
  // While the prediction is open, a quote that contains (or is shared with) the hidden cell would give the answer away.
  const hiddenCell = hiddenId === null ? null : cells.get(hiddenId) ?? null;
  const lower = (t: string): string => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const leaks = (quote: string): boolean => hiddenCell !== null && (quote === hiddenCell.quote || lower(quote).includes(lower(hiddenCell.value)));
  const target = plan === null ? null : { entity: spec.entities[plan.entityIndex] ?? '', attribute: spec.attributes[plan.attributeIndex] ?? '' };

  return (
    <div className="compare" data-testid="compare">
      <div className="table-wrap">
        <table className="compare-table">
          <caption className="sr-only">{spec.title}</caption>
          <thead>
            <tr>
              <td className="sr-only">Item</td>
              {grid.attributes.map((a) => <th key={a} scope="col">{a}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.entity}>
                <th scope="row">{row.entity}</th>
                {row.cells.map((cell, ai) => {
                  if (cell === null) return <td key={ai} className="cell-blank"><span>{NOT_STATED}</span></td>;
                  if (cell.id === hiddenId) return <td key={ai} className="cell-hidden"><span aria-label="Hidden until you lock in a prediction">? hidden</span></td>;
                  const isOpen = open === cell.id;
                  const reveal = plan !== null && locked && cell.id === plan.cellId;
                  const blocked = leaks(cell.quote);
                  return (
                    <Linked as="td" key={ai} className={reveal ? (correct ? 'cell-right' : 'cell-miss') : ''} links={[linkKey(cell.sourceId, cell.quote)]}>
                      <button type="button" className={`cell-btn${isOpen ? ' cell-open' : ''}`} aria-expanded={isOpen} disabled={blocked} title={blocked ? 'Opens after you lock in your prediction' : undefined} onClick={() => setOpen(isOpen ? null : cell.id)}>{cell.value}</button>
                    </Linked>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan !== null && target !== null && (
        <section className="prediction compare-predict" aria-label="Predict the hidden cell">
          <fieldset className="choice-set" disabled={locked}>
            <legend><strong>Predict first.</strong> What does the page say about <strong>{target.entity}</strong> and <strong>{target.attribute}</strong>? That cell is hidden in the table.</legend>
            {plan.options.map((o) => {
              const right = locked && o === plan.correct;
              const mine = locked && pick === o;
              return (
                <label key={o} className={`choice${pick === o ? ' choice-picked' : ''}${right ? ' choice-right' : ''}${mine && !right ? ' choice-wrong' : ''}`}>
                  <input type="radio" name={`${uid}-predict`} checked={pick === o} onChange={() => setPick(o)} />
                  <span className="choice-text">{o}</span>
                  {right && <span className="choice-mark"><Mark kind="ok" />{mine ? 'Your answer — correct' : 'The page’s answer'}</span>}
                  {mine && !right && <span className="choice-mark"><Mark kind="bad" />Your answer</span>}
                </label>
              );
            })}
          </fieldset>
          {!locked && <button type="button" className="btn btn-primary" disabled={pick === null} onClick={() => { setLocked(true); setOpen(plan.cellId); }}>Lock in and reveal</button>}
          {locked && (
            <div className={`grade ${correct ? 'grade-ok' : 'grade-miss'}`} role="status">
              <strong><Mark kind={correct ? 'ok' : 'bad'} />{correct ? 'Right' : 'Not quite'} — the page says “{plan.correct}”.</strong>
            </div>
          )}
        </section>
      )}

      {openCell === null
        ? <p className="muted small">{plan === null ? 'Select any cell to read the page’s words behind it.' : hiddenId !== null ? 'Select a cell to read the page’s words behind it. Cells whose quote would give the hidden answer away open after you lock in.' : 'Select a cell to read the page’s words behind it.'}</p>
        : (
          <QuoteBlock
            componentId="compare-table-v1"
            part="cell"
            id={openCell.id}
            sourceId={openCell.sourceId}
            quote={openCell.quote}
            cite={cite}
            caption={`${spec.entities[openCell.entityIndex] ?? ''} · ${spec.attributes[openCell.attributeIndex] ?? ''}`}
          />
        )}
    </div>
  );
}
