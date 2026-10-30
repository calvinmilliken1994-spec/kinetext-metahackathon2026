import { useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { BalanceEquationSpec } from '../../../../packages/contracts/kit.ts';
import { KIT_LIMITS } from '../../../../packages/contracts/kit.ts';
import { atomBars, atomTotals, equationTerms, formatEquation, formulaParts, gradeBalance, nextBarScale, solveBalance } from '../lib/balance.ts';
import type { BalanceGrade, BarRow, BarSegment, EquationTerm } from '../lib/balance.ts';
import { FAILURE_MESSAGES } from '../lib/lesson.ts';
import type { CiteProps } from './Explanations.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { IconArrowRight, IconMinus, IconPlus, Mark } from './icons.tsx';

interface Props { spec: BalanceEquationSpec; cite: CiteProps }

const { min: MIN_COEF, max: MAX_COEF } = KIT_LIMITS.balance.coefficient;
/** Past this many atoms on the scale the one-atom ticks would crowd into a texture, so they are dropped. */
const TICKS_MAX = 64;
/** A substance's formula is printed inside its share of a bar when the share is at least this part of the scale. */
const LABEL_MIN_SHARE = 0.11;

function Formula({ formula }: { formula: string }) {
  return <span className="chem">{formulaParts(formula).map((p, i) => (p.sub ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>))}</span>;
}

function gradeMessage(g: BalanceGrade): { tone: 'ok' | 'miss'; mark: 'ok' | 'bad'; text: string } {
  switch (g.status) {
    case 'correct': return { tone: 'ok', mark: 'ok', text: 'Balanced: every element has the same number of atoms on both sides, in the smallest whole numbers.' };
    case 'balanced-multiple': return { tone: 'miss', mark: 'ok', text: `Every element is level, but not in the smallest whole numbers. Divide every coefficient by ${g.factor}.` };
    case 'unbalanced': return { tone: 'miss', mark: 'bad', text: `Not balanced yet. Atoms of ${g.elements.join(' and ')} differ between the two sides.` };
    default: return { tone: 'miss', mark: 'bad', text: 'Each coefficient must be a whole number from 1 to 12.' };
  }
}

const pct = (atoms: number, scale: number): string => `${(atoms / scale) * 100}%`;

function Segment({ seg, scale }: { seg: BarSegment; scale: number }) {
  const style = { left: pct(seg.start, scale), width: pct(seg.atoms, scale), '--n': seg.atoms } as CSSProperties;
  return <span className="ab-seg" style={style} />;
}

/** The substance's formula over its share, drawn above the surplus hatching so it stays readable. */
function SegmentLabel({ seg, scale }: { seg: BarSegment; scale: number }) {
  if (seg.atoms / scale < LABEL_MIN_SHARE) return null;
  return <span className="ab-seg-label" style={{ left: pct(seg.start, scale), width: pct(seg.atoms, scale) }}><span><Formula formula={seg.formula} /></span></span>;
}

function BarLine({ row, side, scale }: { row: BarRow; side: 'left' | 'right'; scale: number }) {
  const count = side === 'left' ? row.left : row.right;
  const excess = row.excess !== null && row.excess.side === side ? row.excess : null;
  const segments = side === 'left' ? row.segments.left : row.segments.right;
  return (
    <div className={`ab-line ab-${side}`}>
      <span className="ab-side">{side === 'left' ? 'Reactants' : 'Products'}</span>
      <div className="ab-track">
        <div className="ab-scale">
          {segments.map((s) => <Segment key={s.index} seg={s} scale={scale} />)}
          {excess !== null && <span className="ab-excess" style={{ left: pct(excess.from, scale), width: pct(excess.atoms, scale) }} />}
          {segments.map((s) => <SegmentLabel key={s.index} seg={s} scale={scale} />)}
          <span className="ab-count" style={{ left: pct(count, scale) }}>{count}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Balance-the-equation: the learner sets a coefficient under each substance of a typeset equation; for each element a
 * pair of tally bars (reactants above, products below, one tick per atom, split by substance) grows and shrinks with the
 * coefficients, the surplus on the longer side is hatched, and a level line marks the shorter end. When every element
 * matches in the smallest whole numbers (gradeBalance against the solver's key), the view settles into a calm balanced
 * state. The atom table stays in the page as the bars' text alternative and can be shown. Reveal shows the page's
 * equation with its quote. Charges, states and conditions are not graded.
 */
export function BalanceView({ spec, cite }: Props) {
  const uid = useId();
  const key = useMemo(() => solveBalance(spec.species), [spec]);
  const ones = useMemo(() => spec.species.map(() => 1), [spec]);
  const [coefs, setCoefs] = useState<number[]>(ones);
  const [scale, setScale] = useState<number>(() => { const t = atomTotals(spec.species, ones); return t === null ? 4 : nextBarScale(null, t); });
  const [checked, setChecked] = useState<BalanceGrade | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const totals = useMemo(() => atomTotals(spec.species, coefs), [spec, coefs]);
  const bars = useMemo(() => atomBars(spec.species, coefs), [spec, coefs]);
  const terms = useMemo(() => equationTerms(spec.species, coefs), [spec, coefs]);
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

  if (key === null || totals === null || bars === null) {
    return <div className="kit-message" role="note"><p><strong>{FAILURE_MESSAGES['balance-equation-v1']}</strong></p><p className="muted small">Nothing from this component is shown, because it was not confirmed by the page.</p></div>;
  }

  const apply = (next: number[]): void => {
    setCoefs(next);
    const t = atomTotals(spec.species, next);
    if (t !== null) setScale((prev) => nextBarScale(prev, t));
    setChecked(null);
  };
  const set = (i: number, value: number): void => apply(coefs.map((c, k) => (k === i ? Math.min(MAX_COEF, Math.max(MIN_COEF, value)) : c)));
  const reset = (): void => {
    setCoefs(ones);
    const t = atomTotals(spec.species, ones);
    setScale(t === null ? 4 : nextBarScale(null, t));
    setChecked(null);
  };

  // The live grade drives the settled state; Check reports the same grade on request while the bars are not yet level.
  const live = gradeBalance(spec.species, coefs, key);
  const phase = live.status === 'correct' ? 'balanced' : live.status === 'balanced-multiple' ? 'multiple' : 'open';
  const verdict = phase !== 'open' ? live : checked;
  const msg = verdict === null ? null : gradeMessage(verdict);
  const ticks = scale <= TICKS_MAX;

  const term = (t: EquationTerm, k: number, which: 'left' | 'right') => {
    const c = coefs[t.index] ?? 1;
    return (
      <span key={t.id} className="chem-term-wrap">
        {k > 0 && <span className="chem-op" aria-hidden="true">+</span>}
        {k === 0 && which === 'right' && <span className="chem-op chem-yields" role="img" aria-label="yields"><IconArrowRight size={30} /></span>}
        <span className="chem-term">
          <span className="chem-term-text" aria-hidden="true">
            {t.written !== '' && <span className="chem-coef">{t.written}</span>}
            <Formula formula={t.formula} />
          </span>
          <span className="stepper chem-stepper" role="group" aria-label={`Coefficient for ${t.formula}`}>
            <button type="button" className="btn btn-small" aria-label={`Decrease the coefficient of ${t.formula}`} disabled={c <= MIN_COEF} onClick={() => set(t.index, c - 1)}><IconMinus /></button>
            <output className="stepper-value" aria-live="polite" aria-label={`${t.formula} coefficient`}>{c}</output>
            <button type="button" className="btn btn-small" aria-label={`Increase the coefficient of ${t.formula}`} disabled={c >= MAX_COEF} onClick={() => set(t.index, c + 1)}><IconPlus /></button>
          </span>
        </span>
      </span>
    );
  };

  return (
    <div className="balance chem-balance" data-testid="balance" data-phase={phase}>
      <p className="muted small">Set a whole number (1 to 12) in front of each substance until every element has the same number of atoms on both sides.</p>

      <div className="chem-eq" role="group" aria-label="Chemical equation with coefficient steppers">
        <span className="sr-only">Current equation: {formatEquation(spec.species, coefs)}</span>
        {terms.left.map((t, k) => term(t, k, 'left'))}
        {terms.right.map((t, k) => term(t, k, 'right'))}
      </div>

      <figure className={`atom-bars${ticks ? ' with-ticks' : ''}`} aria-hidden="true">
        <figcaption className="ab-legend">
          <span className="ab-key ab-key-left">Reactants (left side)</span>
          <span className="ab-key ab-key-right">Products (right side)</span>
          <span className="ab-key-note">{ticks ? 'One tick is one atom' : `Scale: 0 to ${scale} atoms`}</span>
        </figcaption>
        {bars.map((row, r) => (
          <div key={row.element} className="ab-row" data-level={row.balanced ? 'true' : 'false'} style={{ '--row': r } as CSSProperties}>
            <div className="ab-head">
              <span className="ab-el">{row.element}</span>
              <span className="ab-status">{row.balanced ? <><Mark kind="ok" />level</> : row.status}</span>
            </div>
            <div className="ab-pair">
              <BarLine row={row} side="left" scale={scale} />
              <BarLine row={row} side="right" scale={scale} />
              <div className="ab-guide-layer">
                <div className="ab-scale">
                  <span className="ab-guide" style={{ left: pct(Math.min(row.left, row.right), scale) }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </figure>

      <div className="ab-table-wrap">
        <button type="button" className="btn btn-quiet ab-table-toggle" aria-expanded={showTable} aria-controls={`${uid}-atoms`} onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide the atom count table' : 'Show the counts as a table'}
        </button>
        <table id={`${uid}-atoms`} className={`atom-table${showTable ? '' : ' sr-only'}`}>
          <caption>Atoms of each element, left side against right side</caption>
          <thead><tr><th scope="col">Element</th><th scope="col">Left</th><th scope="col">Right</th><th scope="col">Same?</th></tr></thead>
          <tbody>
            {totals.rows.map((r) => (
              <tr key={r.element} className={r.balanced ? 'atom-ok' : 'atom-off'}>
                <th scope="row">{r.element}</th>
                <td>{r.left}</td>
                <td>{r.right}</td>
                <td className="atom-same">{r.balanced ? <><Mark kind="ok" />equal</> : <><Mark kind="bad" />{r.left > r.right ? 'left has more' : 'right has more'}</>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{totals.balanced ? 'Every element is balanced.' : `Not balanced: ${totals.rows.filter((r) => !r.balanced).map((r) => r.element).join(', ')}.`}</p>

      {msg !== null && <div className={`grade grade-${msg.tone} chem-verdict`} role="status"><strong><Mark kind={msg.mark} />{msg.text}</strong></div>}

      <div className="order-actions">
        <button type="button" className="btn btn-primary" onClick={() => { setChecked(gradeBalance(spec.species, coefs, key)); }}>Check my balance</button>
        <button type="button" className="btn" onClick={() => setShowHint((v) => !v)} aria-expanded={showHint} aria-controls={`${uid}-hint`}>{showHint ? 'Hide hint' : 'Show hint'}</button>
        <button type="button" className="btn" onClick={() => setRevealed(true)} disabled={revealed}>Reveal the page’s equation</button>
        <button type="button" className="btn" onClick={reset}>Reset to 1</button>
      </div>
      <p id={`${uid}-hint`} className="small" hidden={!showHint}>{spec.hint === '' ? 'Count the atoms of each element on both sides.' : spec.hint}</p>

      {revealed && (
        <div className="bal-reveal" data-testid="balance-reveal">
          <p className="small"><strong>The balanced equation</strong> (smallest whole numbers, matching the page’s equation):</p>
          <p className="bal-answer"><span className="sr-only">{formatEquation(spec.species, key)}</span>
            <span aria-hidden="true">
              {terms.left.map((t, k) => <span key={t.id}>{k > 0 && ' + '}{key[t.index] === 1 ? '' : `${key[t.index]} `}<Formula formula={t.formula} /></span>)}
              <IconArrowRight className="inline-arrow" />
              {terms.right.map((t, k) => <span key={t.id}>{k > 0 && ' + '}{key[t.index] === 1 ? '' : `${key[t.index]} `}<Formula formula={t.formula} /></span>)}
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
