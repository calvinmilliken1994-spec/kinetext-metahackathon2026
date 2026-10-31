// Data table (data-table-v1): the page's table as printed (numeric columns right-aligned, sortable by their numbers), a
// bar chart of one column linked to the rows, the questions as predict-then-reveal cards, and in brackets mode a
// progressive tax calculator. Every number comes from the engine through lib/dataTableView.ts.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { DataTableSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  bracketColumnName, bracketSchedule, chartBars, chartRowsNote, columnViews, dataTablePresentationSteps, duplicateLabelColumn, moneyText, parseIncome,
  percentText, placeEdgeLabels, presentationStep, questionViews, quoteLeaksAnswer, sortedRows, taxQuestion, taxView,
} from '../lib/dataTableView.ts';
import type { DataTableStep, QuestionView, SortState, TaxView } from '../lib/dataTableView.ts';
import { aiLabel, groupThousands } from '../lib/displayText.ts';
import { linkKey } from '../lib/linking.ts';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { Mark } from './icons.tsx';

export interface DataTableViewProps { spec: DataTableSpec; cite: CiteProps; presentation?: EnginePresentation }

/** What is hidden while the current question is open: the lookup cell (its quote and any quote stating it stay unlinked). */
interface Secret { row: number; column: number; value: string }

function secretOf(q: QuestionView | undefined, open: boolean): Secret | null {
  if (q === undefined || !open || q.answer === null || q.kind !== 'lookup') return null;
  return { row: q.answer.rowIndex, column: q.columnIndex, value: q.answer.value };
}

/** A value the reveal fills in: laid out from the start under a '?' chip, so the reveal never moves anything. */
function Hidden({ shown, children, label = 'Hidden until the reveal' }: { shown: boolean; children: ReactNode; label?: string }) {
  return (
    <span className="dt-stack">
      <span data-on={shown ? 'true' : 'false'} aria-hidden={shown ? undefined : true}>{children}</span>
      <span data-on={shown ? 'false' : 'true'} className="concealed" aria-label={shown ? undefined : label} aria-hidden={shown ? true : undefined}>?</span>
    </span>
  );
}

function SortMark({ dir }: { dir: 'asc' | 'desc' | null }) {
  return (
    <svg className="dt-sort-mark" viewBox="0 0 10 12" width="10" height="12" aria-hidden="true" data-dir={dir ?? 'none'}>
      <path d="M5 1 L8.5 5 H1.5 Z" className="dt-sort-up" />
      <path d="M5 11 L1.5 7 H8.5 Z" className="dt-sort-down" />
    </svg>
  );
}

function TaxCalculator({ spec, staged, revealed, onTouch }: { spec: DataTableSpec; staged: boolean; revealed: boolean; onTouch: () => void }) {
  const inputId = useId();
  const errorId = useId();
  const example = spec.brackets.exampleIncome;
  const [raw, setRaw] = useState(groupThousands(String(example)));
  // The last income that read: a bad entry shows a field error beside the input and keeps this result (W-10).
  const [good, setGood] = useState(example);
  useEffect(() => { if (staged) { setRaw(groupThousands(String(example))); setGood(example); } }, [staged, example, revealed]);
  const parsed = parseIncome(raw);
  const error = parsed.ok ? null : parsed.error;
  const income = parsed.ok ? parsed.income : good;
  const t: TaxView | null = taxView(spec, income);
  const sched = bracketSchedule(spec);
  const plotRef = useRef<HTMLDivElement>(null);
  const edges = useMemo(() => {
    if (t === null) return [];
    const list: number[] = [];
    if (t.below > 0) list.push(t.below);
    for (const p of t.parts) list.push(p.to);
    return list;
  }, [t]);
  const edgeKey = edges.join(',');
  const [axis, setAxis] = useState<{ key: string; list: { left: number; shown: boolean }[] }>({ key: '', list: [] });
  useLayoutEffect(() => {
    const plot = plotRef.current;
    if (plot === null) return undefined;
    const measure = (): void => {
      const blocks = [...plot.querySelectorAll<HTMLElement>('.dt-tax-block')];
      const labels = [...plot.querySelectorAll<HTMLElement>('.dt-tax-edge')];
      const W = plot.clientWidth;
      if (!(W > 0) || blocks.length !== labels.length) return;
      const placed = placeEdgeLabels(blocks.map((b, i) => ({ x: b.offsetLeft + b.offsetWidth, w: labels[i]?.offsetWidth ?? 0 })), W);
      const key = `${edgeKey}@${W}:${placed.map((p) => `${Math.round(p.left)}${p.shown ? '+' : '-'}`).join(';')}`;
      setAxis((prev) => (prev.key === key ? prev : { key, list: placed }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(plot);
    return () => ro.disconnect();
  }, [edgeKey]);
  if (t === null || sched === null) return null;
  const cur = t.currency;
  const maxRate = Math.max(...sched.brackets.map((b) => b.rate), 1);
  const span = Math.max(t.income, 1);
  const first = sched.brackets[0];
  const column = bracketColumnName(spec);
  // The page's schedule starts above zero (IRS: no 10% row): say so where the result is, not in a footnote (UX #3).
  const partial = first !== undefined && first.over > 0;
  return (
    <section className="dt-tax" aria-label="Tax calculator">
      <div className="dt-tax-head">
        <h4 className="dt-tax-title">{partial ? 'Partial rate schedule: tax band by band' : 'Tax on an income, band by band'}</h4>
        <label htmlFor={inputId} className="dt-tax-label">Income{cur === '' ? '' : ` (${cur})`}{column === '' ? '' : `, ${column} column`}</label>
        <input
          id={inputId} className="dt-tax-input num" inputMode="decimal" autoComplete="off" value={raw} disabled={staged && !revealed}
          aria-invalid={error !== null} aria-describedby={error !== null ? errorId : undefined}
          onChange={(e) => {
            const next = e.target.value;
            setRaw(next);
            const p = parseIncome(next);
            if (p.ok) setGood(p.income);
            onTouch();
          }}
        />
        <p id={errorId} className="dt-tax-error" role="status" data-on={error !== null ? 'true' : 'false'}>{error ?? '\u00a0'}</p>
      </div>
      {/* Each block is one band's slice of the income (width) at its rate (height): its area is the tax on that slice.
          Under the blocks, the band EDGES (the thresholds and the income), never the slice widths (P2). */}
      <div className="dt-tax-plot" ref={plotRef}>
        <div className="dt-tax-blocks" role="img" aria-label={`Income ${moneyText(t.income, cur)} split into ${t.parts.length} bands`}>
          {t.below > 0 && (
            <div className="dt-tax-block dt-tax-below" style={{ '--w': t.below / span, '--h': 0 } as CSSProperties}>
              <span className="dt-tax-rate">No rate</span>
              <span className="dt-tax-fill" />
            </div>
          )}
          {t.parts.map((p) => (
            <div key={p.from} className="dt-tax-block" style={{ '--w': (p.to - p.from) / span, '--h': p.rate / maxRate } as CSSProperties}>
              <span className="dt-tax-rate num">{p.rate}%</span>
              <span className="dt-tax-fill" />
            </div>
          ))}
        </div>
        <div className="dt-tax-axis" aria-hidden="true">
          {edges.map((x, i) => {
            const at = axis.list[i];
            return (
              <span key={`${i}:${x}`} className="dt-tax-edge num" data-shown={at?.shown === true ? 'true' : 'false'} style={at === undefined ? undefined : { left: at.left }}>
                {moneyText(x, cur)}
              </span>
            );
          })}
        </div>
      </div>
      <ol className="dt-tax-parts">
        {t.parts.map((p) => {
          const row = spec.rows[p.rowIndex];
          return (
            <Linked as="li" key={p.from} links={row === undefined ? [] : [linkKey(row.sourceId, row.quote)]}>
              <span className="num">{p.rate}%</span> on <span className="num">{moneyText(p.to - p.from, cur)}</span>
              <span className="dt-tax-eq"> = <Hidden shown={revealed}><span className="num">{moneyText(p.tax, cur)}</span></Hidden></span>
            </Linked>
          );
        })}
        {t.parts.length === 0 && <li className="dt-muted">This income is below every threshold in the table.</li>}
      </ol>
      <div className="dt-tax-total">
        <p className="dt-tax-sum">
          <span>Tax from the listed bands <strong className="num"><Hidden shown={revealed}>{moneyText(t.total, cur)}</Hidden></strong></span>
          <span>Share of the income <strong className="num"><Hidden shown={revealed}>{percentText(t.effectiveRate)}</Hidden></strong></span>
        </p>
        {partial && first !== undefined && (
          <p className="dt-tax-partial">The page lists no rate for income up to {moneyText(first.over, cur)}, so this is not the full tax.</p>
        )}
      </div>
      <p className="dt-fine">
        Uses only the page’s rate schedule: each rate applies to the part of the income above its threshold. No deductions, credits or other rules.
      </p>
    </section>
  );
}

/**
 * The page's table, sortable by its numbers, with a chart of one column and questions answered by code. Opens on the first
 * question with its answer hidden.
 */
export function DataTableView({ spec, cite: _cite, presentation }: DataTableViewProps) {
  const staged = presentation !== undefined;
  const cols = useMemo(() => columnViews(spec), [spec]);
  // A value column that repeats every row label (IRS: the Rate column) is the row header; the label column is not drawn.
  const dupCol = useMemo(() => duplicateLabelColumn(spec), [spec]);
  const questions = useMemo(() => questionViews(spec).filter((q) => q.answer !== null), [spec]);
  const hasTax = useMemo(() => bracketSchedule(spec) !== null, [spec]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [shownQ, setShownQ] = useState<Record<string, boolean>>({});
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [taxShown, setTaxShown] = useState(false);

  const steps = dataTablePresentationSteps(spec);
  const step = staged ? presentationStep(spec, Math.min(presentation.step, steps - 1)) : { kind: 'question' as const, index: qIndex };
  const taxStep = step.kind === 'tax';
  const q = step.kind === 'question' ? questions[step.index] : undefined;
  const qRevealed = q === undefined ? false : staged ? presentation.revealed : shownQ[q.id] === true;
  const taxRevealed = staged ? (taxStep ? presentation.revealed : true) : taxShown;
  const secret = secretOf(q, !qRevealed);
  const order = useMemo(() => sortedRows(spec, sort), [spec, sort]);
  const chart = useMemo(() => chartBars(spec, order), [spec, order]);
  const rowsNote = useMemo(() => chartRowsNote(spec), [spec]);
  const pick = q === undefined ? undefined : picks[q.id];
  const answerRow = q !== undefined && qRevealed ? q.answer?.rowIndex ?? null : null;

  const toggleSort = (column: number): void => {
    setSort((s) => (s === null || s.column !== column ? { column, dir: 'desc' } : s.dir === 'desc' ? { column, dir: 'asc' } : null));
  };
  const linksFor = (sourceId: string, quote: string): string[] => (secret !== null && quoteLeaksAnswer(quote, secret.value) ? [] : [linkKey(sourceId, quote)]);
  const choose = (row: number): void => {
    if (q === undefined || qRevealed) return;
    setPicks((p) => ({ ...p, [q.id]: p[q.id] === row ? -1 : row }));
  };
  const reveal = (): void => { if (q !== undefined) setShownQ((s) => ({ ...s, [q.id]: true })); };

  const before = hasTax && staged ? 1 : 0;
  const picked = pick !== undefined && pick >= 0 ? pick : null;
  const currency = bracketSchedule(spec)?.currency ?? '';

  /** One step's question block. On a slide every step's block is laid out in one stacked cell (only the current one shows), so → never changes the slide's height. */
  const askBlock = (s: DataTableStep, current: boolean): ReactNode => {
    const isTax = s.kind === 'tax';
    const sq = s.kind === 'question' ? questions[s.index] : undefined;
    if (!isTax && sq === undefined) return null;
    const open = current ? !(isTax ? taxRevealed : qRevealed) : true;
    const sPick = sq === undefined ? null : (picks[sq.id] ?? -1) >= 0 ? (picks[sq.id] as number) : null;
    const sAnswer = sq !== undefined && !open ? sq.answer?.rowIndex ?? null : null;
    const sRight = sPick !== null && sAnswer !== null && sPick === sAnswer;
    const label = sq?.answer === null || sq?.answer === undefined ? '' : spec.rows[sq.answer.rowIndex]?.label ?? '';
    const number = isTax ? 1 : before + (s.kind === 'question' ? s.index : 0) + 1;
    return (
      <div className="dt-ask" key={isTax ? 'tax' : sq?.id} data-on={current ? 'true' : 'false'} aria-hidden={current ? undefined : true} inert={current ? undefined : true}>
        <div className="dt-ask-top">
          <p className="dt-eyebrow">Question {number} of {before + questions.length}</p>
          {!staged && questions.length > 1 && (
            <div className="dt-ask-nav">
              <button type="button" className="btn btn-small" disabled={qIndex === 0} onClick={() => setQIndex((i) => Math.max(0, i - 1))}>Previous</button>
              <button type="button" className="btn btn-small" disabled={qIndex >= questions.length - 1} onClick={() => setQIndex((i) => Math.min(questions.length - 1, i + 1))}>Next question</button>
            </div>
          )}
        </div>
        <p className="dt-question">{isTax ? taxQuestion(spec, currency) : sq?.text}</p>
        {sq !== undefined && sq.choices.length > 0 && (
          <div className="dt-choices" role="group" aria-label="Choose a row">
            {sq.choices.map((r) => {
              const state = open ? (sPick === r ? 'picked' : 'open') : r === sAnswer ? 'right' : sPick === r ? 'wrong' : 'other';
              return (
                <button key={r} type="button" className="dt-choice" data-state={state} aria-pressed={sPick === r} disabled={!open} onClick={() => choose(r)}>
                  {aiLabel(spec.rows[r]?.label ?? '')}
                </button>
              );
            })}
          </div>
        )}
        <div className="dt-foot dt-stack">
          <div data-on={open ? 'true' : 'false'} aria-hidden={open ? undefined : true}>
            {staged
              ? <p className="dt-hint">{isTax ? 'Class estimate first, then' : sq?.kind === 'lookup' ? 'Find it in the page’s table, then' : 'Class vote, then'} <kbd>R</kbd>.</p>
              : <p className="dt-hint">{sq?.kind === 'lookup' ? 'Say your answer, then ' : 'Pick a row, then '}<button type="button" className="btn btn-small btn-primary" onClick={reveal}>Reveal</button></p>}
          </div>
          <div data-on={open ? 'false' : 'true'} aria-hidden={open ? true : undefined} role={current ? 'status' : undefined}>
            {isTax
              ? <p className="dt-verdict"><Mark kind="ok" />Worked out below, bracket by bracket, from the page’s rates.</p>
              : sq !== undefined && sq.answer !== null && (
                <p className={`dt-verdict${sPick !== null && !sRight ? ' dt-verdict-miss' : ''}`}>
                  <Mark kind={sPick !== null && !sRight ? 'bad' : 'ok'} />
                  {sq.kind === 'lookup'
                    ? <span>The table gives <strong className="num">{sq.answer.value}</strong> for {aiLabel(label)}.</span>
                    : <span><strong>{aiLabel(label)}</strong> has the {sq.kind} value, <span className="num">{sq.answer.value}</span>.{sPick !== null ? (sRight ? ' The class had it.' : ' Not the class’s choice.') : ''}</span>}
                </p>
              )}
          </div>
        </div>
      </div>
    );
  };
  const allSteps: DataTableStep[] = Array.from({ length: steps }, (_, i) => presentationStep(spec, i));
  const isCurrent = (s: DataTableStep): boolean => (s.kind === 'tax' ? taxStep : step.kind === 'question' && s.index === step.index);

  return (
    <div className="dt" data-mode={staged ? 'stage' : 'lesson'} data-tax={hasTax ? 'true' : 'false'} data-testid="data-table">
      {staged
        ? <div className="dt-ask-stack">{allSteps.map((s) => askBlock(s, isCurrent(s)))}</div>
        : (q !== undefined || taxStep) && askBlock(step, true)}

      <div className={`dt-body${chart !== null ? ' dt-has-chart' : ''}`}>
        <div className="dt-table-wrap">
          <table className="dt-table">
            <caption className="sr-only">{aiLabel(spec.title)}{sort !== null ? `, sorted by ${cols[sort.column]?.headerText ?? ''}` : ''}</caption>
            <thead>
              <tr>
                {dupCol === null && <th scope="col" className="dt-label-col">{aiLabel(spec.labelHeader)}</th>}
                {cols.map((c) => {
                  const col = spec.columns[c.index];
                  const dir = sort !== null && sort.column === c.index ? sort.dir : null;
                  return (
                    <th
                      key={c.index} scope="col" className={c.numeric ? 'dt-num' : undefined}
                      aria-sort={dir === null ? undefined : dir === 'asc' ? 'ascending' : 'descending'}
                      data-question={q !== undefined && !taxStep && q.columnIndex === c.index ? 'true' : undefined}
                    >
                      <Linked as="div" className="dt-th" links={col === undefined ? [] : linksFor(col.sourceId, col.quote)}>
                        {c.numeric
                          ? <button type="button" className="dt-sort" onClick={() => toggleSort(c.index)} title={`Sort by ${c.headerText}`}>{c.headerText}<SortMark dir={dir} /></button>
                          : <span>{c.headerText}</span>}
                      </Linked>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {order.map((r) => {
                const row = spec.rows[r];
                if (row === undefined) return null;
                const mark = answerRow === r ? 'answer' : picked === r ? 'picked' : undefined;
                return (
                  <tr key={r} data-hot={hot === r ? 'true' : undefined} data-mark={mark} onMouseEnter={() => setHot(r)} onMouseLeave={() => setHot((h) => (h === r ? null : h))}>
                    {dupCol === null && <Linked as="td" className="dt-label-col" role="rowheader" links={linksFor(row.sourceId, row.quote)}><span className="dt-row-label">{aiLabel(row.label)}</span></Linked>}
                    {row.values.map((cell, c) => {
                      const hidden = secret !== null && secret.row === r && secret.column === c;
                      const target = q !== undefined && !taxStep && q.kind === 'lookup' && q.answer?.rowIndex === r && q.columnIndex === c;
                      // The column that repeats the row labels is the row header (its cell names the row and cites its line).
                      const head = c === dupCol;
                      const links = hidden ? [] : head ? [...new Set([...linksFor(cell.sourceId, cell.quote), ...linksFor(row.sourceId, row.quote)])] : linksFor(cell.sourceId, cell.quote);
                      return (
                        <Linked
                          as="td" key={c} className={`${cols[c]?.numeric === true ? 'dt-num' : ''}${target ? ' dt-target' : ''}${head ? ' dt-label-col' : ''}`}
                          role={head ? 'rowheader' : undefined}
                          links={links} data-revealed={target && qRevealed ? 'true' : undefined}
                        >
                          {target
                            ? <Hidden shown={!hidden}><span className="num">{cell.value}</span></Hidden>
                            : <span className={head ? 'num dt-row-label' : 'num'}>{cell.value}</span>}
                        </Linked>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!staged && <p className="dt-fine">Values exactly as the page prints them. Sort a number column by its header.</p>}
        </div>

        {chart !== null && (
          <figure className="dt-chart" aria-label={`Bar chart of ${chart.headerText}`} data-signed={chart.signed ? 'true' : 'false'} style={{ '--zero': chart.zero } as CSSProperties}>
            <figcaption>{chart.headerText}{rowsNote !== null && <span className="dt-chart-note">{rowsNote}</span>}</figcaption>
            <ol>
              {chart.bars.map((b) => (
                <li
                  key={b.rowIndex} data-hot={hot === b.rowIndex ? 'true' : undefined} data-mark={answerRow === b.rowIndex ? 'answer' : undefined}
                  onMouseEnter={() => setHot(b.rowIndex)} onMouseLeave={() => setHot((h) => (h === b.rowIndex ? null : h))}
                >
                  <span className="dt-bar-label">{aiLabel(b.label)}</span>
                  {/* Bars grow from the zero line: left for a negative value, right for a positive one (W-09). */}
                  <span className="dt-bar-track"><span className="dt-bar" data-negative={b.negative ? 'true' : 'false'} style={{ '--f': b.fraction, '--s': b.start } as CSSProperties} /></span>
                  <span className="dt-bar-value num">
                    {secret !== null && secret.row === b.rowIndex && secret.column === chart.column ? <Hidden shown={false}>{b.text}</Hidden> : b.text}
                  </span>
                </li>
              ))}
            </ol>
          </figure>
        )}
      </div>

      {hasTax && <TaxCalculator spec={spec} staged={staged} revealed={taxRevealed} onTouch={() => setTaxShown(true)} />}
      {hasTax && !staged && !taxShown && (
        <p className="dt-tax-reveal"><button type="button" className="btn btn-small" onClick={() => setTaxShown(true)}>Show the tax</button> <span className="dt-muted">Estimate the total first. Changing the income shows it too.</span></p>
      )}
    </div>
  );
}
