import { useId, useMemo, useState } from 'react';
import type { BalanceEquationSpec } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import { atomTotals, formatEquation, formulaParts, gradeBalance, solveBalance } from '../lib/balance.ts';
import type { BalanceGrade } from '../lib/balance.ts';
import { FAILURE_MESSAGES } from '../lib/lesson.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';

interface Props { spec: BalanceEquationSpec; cite: CiteProps }

const { min: MIN_COEF, max: MAX_COEF } = KIT_LIMITS.balance.coefficient;

function Formula({ formula }: { formula: string }) {
  return <span className="chem">{formulaParts(formula).map((p, i) => (p.sub ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>))}</span>;
}

function gradeMessage(g: BalanceGrade): { tone: 'ok' | 'miss'; text: string } {
  switch (g.status) {
    case 'correct': return { tone: 'ok', text: '✓ Balanced: every element has the same number of atoms on both sides, in the smallest whole numbers.' };
    case 'balanced-multiple': return { tone: 'miss', text: `✓ Balanced, but not in the smallest whole numbers. Divide every coefficient by ${g.factor}.` };
    case 'unbalanced': return { tone: 'miss', text: `✗ Not balanced yet. Atoms of ${g.elements.join(' and ')} differ between the two sides.` };
    default: return { tone: 'miss', text: '✗ Each coefficient must be a whole number from 1 to 12.' };
  }
}

/**
 * Balance-the-equation: the learner sets a coefficient for each species, a live atom table counts each element on both
 * sides, Check compares with the smallest whole-number balance (derived by our solver), and Reveal shows the page’s equation
 * with its quote. Charges, states and conditions are not graded.
 */
export function BalanceView({ spec, cite }: Props) {
  const uid = useId();
  const key = useMemo(() => solveBalance(spec.species), [spec]);
  const [coefs, setCoefs] = useState<number[]>(() => spec.species.map(() => 1));
  const [checked, setChecked] = useState<BalanceGrade | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const totals = useMemo(() => atomTotals(spec.species, coefs), [spec, coefs]);
  // Species often share one quote ("methane CH4 burns in oxygen O2"); show each distinct quote once.
  const speciesQuotes = useMemo(() => {
    const groups = new Map<string, { first: BalanceEquationSpec['species'][number]; formulas: string[] }>();
    for (const sp of spec.species) {
      const k = `${sp.sourceId}|${sp.quote}`;
      const g = groups.get(k);
      if (g === undefined) groups.set(k, { first: sp, formulas: [sp.formula] });
      else g.formulas.push(sp.formula);
    }
    return [...groups.values()];
  }, [spec]);

  if (key === null || totals === null) {
    return <div className="kit-message" role="note"><p><strong>{FAILURE_MESSAGES['balance-equation-v1']}</strong></p><p className="muted small">Nothing from this component is shown, because it was not confirmed by the page.</p></div>;
  }

  const set = (i: number, value: number): void => {
    setCoefs((prev) => prev.map((c, k) => (k === i ? Math.min(MAX_COEF, Math.max(MIN_COEF, value)) : c)));
    setChecked(null);
  };
  const msg = checked === null ? null : gradeMessage(checked);
  const side = (which: 'left' | 'right') => spec.species.map((s, i) => ({ s, i })).filter((x) => x.s.side === which);
  const sideRow = (which: 'left' | 'right') => side(which).map(({ s, i }, k) => (
    <span key={s.id} className="bal-term">
      {k > 0 && <span className="bal-plus" aria-hidden="true">+</span>}
      <span className="bal-species">
        <span className="stepper" role="group" aria-label={`Coefficient for ${s.formula}`}>
          <button type="button" className="btn btn-small" aria-label={`Decrease the coefficient of ${s.formula}`} disabled={(coefs[i] ?? 1) <= MIN_COEF} onClick={() => set(i, (coefs[i] ?? 1) - 1)}>−</button>
          <output className="stepper-value" aria-live="polite" aria-label={`${s.formula} coefficient`}>{coefs[i] ?? 1}</output>
          <button type="button" className="btn btn-small" aria-label={`Increase the coefficient of ${s.formula}`} disabled={(coefs[i] ?? 1) >= MAX_COEF} onClick={() => set(i, (coefs[i] ?? 1) + 1)}>+</button>
        </span>
        <span className="bal-formula"><Formula formula={s.formula} /></span>
      </span>
    </span>
  ));

  return (
    <div className="balance" data-testid="balance">
      <p className="muted small">Set a whole-number coefficient (1 to 12) in front of each substance so every element has the same number of atoms on both sides. The table counts the atoms as you go.</p>
      <div className="bal-equation" role="group" aria-label="Chemical equation with coefficient steppers">
        <div className="bal-side">{sideRow('left')}</div>
        <span className="bal-arrow" aria-label="yields">→</span>
        <div className="bal-side">{sideRow('right')}</div>
      </div>

      <table className="atom-table">
        <caption>Atoms of each element, left side against right side</caption>
        <thead><tr><th scope="col">Element</th><th scope="col">Left</th><th scope="col">Right</th><th scope="col">Same?</th></tr></thead>
        <tbody>
          {totals.rows.map((r) => (
            <tr key={r.element} className={r.balanced ? 'atom-ok' : 'atom-off'}>
              <th scope="row">{r.element}</th>
              <td>{r.left}</td>
              <td>{r.right}</td>
              <td>{r.balanced ? '✓ equal' : `✗ ${r.left > r.right ? 'left has more' : 'right has more'}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="sr-only" role="status" aria-live="polite">{totals.balanced ? 'Every element is balanced.' : `Not balanced: ${totals.rows.filter((r) => !r.balanced).map((r) => r.element).join(', ')}.`}</p>

      <div className="order-actions">
        <button type="button" className="btn btn-primary" onClick={() => { setChecked(gradeBalance(spec.species, coefs, key)); }}>Check my balance</button>
        <button type="button" className="btn" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint} aria-controls={`${uid}-hint`}>{showHint ? 'Hide hint' : 'Show hint'}</button>
        <button type="button" className="btn" onClick={() => setRevealed(true)} disabled={revealed}>Reveal the page’s equation</button>
        <button type="button" className="btn" onClick={() => { setCoefs(spec.species.map(() => 1)); setChecked(null); }}>Reset to 1</button>
      </div>
      <p id={`${uid}-hint`} className="small" hidden={!showHint}>{spec.hint === '' ? 'Count the atoms of each element on both sides.' : spec.hint}</p>
      {msg !== null && <div className={`grade grade-${msg.tone}`} role="status"><strong>{msg.text}</strong></div>}

      {revealed && (
        <div className="bal-reveal" data-testid="balance-reveal">
          <p className="small"><strong>The balanced equation</strong> (smallest whole numbers, matching the page’s equation):</p>
          <p className="bal-answer"><span className="sr-only">{formatEquation(spec.species, key)}</span>
            <span aria-hidden="true">
              {side('left').map(({ s, i }, k) => <span key={s.id}>{k > 0 && ' + '}{key[i] === 1 ? '' : `${key[i]} `}<Formula formula={s.formula} /></span>)}
              {' → '}
              {side('right').map(({ s, i }, k) => <span key={s.id}>{k > 0 && ' + '}{key[i] === 1 ? '' : `${key[i]} `}<Formula formula={s.formula} /></span>)}
            </span>
          </p>
          <QuoteBlock componentId="balance-equation-v1" part="equation" id="equation" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption="The page’s equation" />
          <ul className="bal-species-quotes">
            {speciesQuotes.map((q) => (
              <li key={q.first.id}><QuoteBlock componentId="balance-equation-v1" part="species" id={q.first.id} sourceId={q.first.sourceId} quote={q.first.quote} cite={cite} caption={q.formulas.join(', ')} /></li>
            ))}
          </ul>
          <p className="muted small">Only the atom counts are checked. States, conditions and whether the reaction happens come from the page and are not graded.</p>
        </div>
      )}
    </div>
  );
}
