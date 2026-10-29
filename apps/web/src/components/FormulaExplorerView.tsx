import { useCallback, useId, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';
import { prettyUnit } from '../lib/engines.ts';
import {
  CALCULATOR_FAILURE, buildExplorer, caseOutputs, casePrompt, curveSamples, defaultInputs, evalAt, graphGeometry, gradeCaseGuess, inputsOfCase, outputName,
  pageFormulaStatus, sig6, sliderStep, valueTable,
} from '../lib/explorer.ts';
import type { Inputs } from '../lib/explorer.ts';
import type { Grade } from '../lib/predictions.ts';
import { parseGuess } from '../lib/predictions.ts';
import { trimmed } from '../lib/format.ts';
import { Readout, Slider } from './controls.tsx';
import type { CiteProps } from './Explanations.tsx';
import { FormulaGraph } from './FormulaGraph.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Mark } from './icons.tsx';

interface Props { spec: FormulaExplorerSpec; cite: CiteProps }

export const AI_FORMULA_NOTICE = 'Formula entered by AI from the quoted line - compare with the quote.';

interface CaseResult { raw: string; grade: Grade | null; error: string | null }

/**
 * Formula explorer: sliders for each variable (with units and ranges), the live result, a graph of the result against the x
 * variable with the current point marked, a value table, and predict-then-reveal on the page’s cases. Every number is
 * computed here by the safe evaluator from the stored expression; nothing is read from a stored answer.
 */
export function FormulaExplorerView({ spec, cite }: Props) {
  const uid = useId();
  const model = useMemo(() => buildExplorer(spec), [spec]);
  const [inputs, setInputs] = useState<Inputs>(() => defaultInputs(spec));
  const [results, setResults] = useState<Record<string, CaseResult>>({});
  const formulaStatus = useMemo(() => pageFormulaStatus(spec), [spec]);
  const yName = outputName(spec);
  const xVar = spec.variables.find((v) => v.name === spec.xVariable);

  const samples = useMemo(() => (model.ok ? curveSamples(model, spec, inputs) : []), [model, spec, inputs]);
  const output = model.ok ? evalAt(model, inputs) : Number.NaN;
  const geometry = useMemo(
    () => graphGeometry(samples, { x: inputs[spec.xVariable] ?? xVar?.default ?? 0, y: output }),
    [samples, inputs, spec.xVariable, xVar, output],
  );
  const table = useMemo(() => valueTable(samples, 6), [samples]);
  const cases = useMemo(() => (model.ok ? caseOutputs(model, spec) : []), [model, spec]);

  const onSlider = useCallback((name: string, value: number) => setInputs((prev) => ({ ...prev, [name]: value })), []);

  if (!model.ok) {
    return <div className="kit-message" role="note"><p><strong>{CALCULATOR_FAILURE}</strong></p><p className="muted small">Nothing from this component is shown, because it was not confirmed by the page.</p></div>;
  }

  const submit = (e: FormEvent, caseId: string): void => {
    e.preventDefault();
    const c = spec.cases.find((x) => x.id === caseId);
    const out = cases.find((x) => x.id === caseId);
    if (c === undefined || out === undefined) return;
    const guess = parseGuess(results[caseId]?.raw ?? '');
    if (guess === null) { setResults((r) => ({ ...r, [caseId]: { raw: r[caseId]?.raw ?? '', grade: null, error: 'Type a number before you check.' } })); return; }
    if (!Number.isFinite(out.output)) { setResults((r) => ({ ...r, [caseId]: { raw: r[caseId]?.raw ?? '', grade: null, error: 'The formula has no value for this case, so it cannot be graded.' } })); return; }
    // The reference value is always the calculator's, computed from the expression; reveal it by moving the sliders to the case.
    setResults((r) => ({ ...r, [caseId]: { raw: r[caseId]?.raw ?? '', grade: gradeCaseGuess(guess, out.output), error: null } }));
    setInputs(inputsOfCase(c));
  };

  const xName = xVar === undefined ? spec.xVariable : `${xVar.meaning}${xVar.unit === '' || xVar.unit === '1' ? '' : ` (${prettyUnit(xVar.unit)})`}`;

  return (
    <div className="explorer" data-testid="formula-explorer">
      <div className="explorer-formula">
        <p className="field-label">Formula on the page</p>
        <code>{spec.formulaText}</code>
        <QuoteBlock componentId="formula-explorer-v1" part="equation" id="equation" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption="The page’s words" />
        {formulaStatus !== 'matches' && <p className="note small" role="note" data-testid="ai-formula-notice">{AI_FORMULA_NOTICE}</p>}
      </div>

      <div className="explorer-main">
        <div className="explorer-controls">
          <h3>Move the sliders</h3>
          <div className="sliders">
            {spec.variables.map((v) => (
              <Slider
                key={v.name}
                label={v.meaning}
                symbol={v.pageSymbol}
                unit={prettyUnit(v.unit)}
                min={v.min}
                max={v.max}
                step={sliderStep(v)}
                value={inputs[v.name] ?? v.default}
                onChange={(val) => onSlider(v.name, val)}
              />
            ))}
          </div>
          <dl className="readouts explorer-readout" aria-live="polite">
            <Readout name={yName} value={sig6(output)} unit="" />
          </dl>
          {!Number.isFinite(output) && <p className="field-error" role="status">Not defined for these inputs.</p>}
          <button type="button" className="btn btn-small" onClick={() => setInputs(defaultInputs(spec))}>Reset sliders</button>
        </div>

        <div className="explorer-visual">
          <FormulaGraph geometry={geometry} yName={yName} xName={xName} />
          <table className="value-table">
            <caption>{yName} as {xVar?.meaning ?? spec.xVariable} changes (other sliders as set)</caption>
            <thead><tr><th scope="col">{xName}</th><th scope="col">{yName}</th></tr></thead>
            <tbody>
              <tr className="value-now">
                <th scope="row">Now: {sig6(inputs[spec.xVariable] ?? 0)}</th>
                <td>{sig6(output)}</td>
              </tr>
              {table.map((row, i) => (
                <tr key={i}><th scope="row">{sig6(row.x)}</th><td>{sig6(row.y)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {spec.hasSourceExample && (
        <div className="explorer-example">
          <p className="small"><strong>The page’s own example</strong> gives {sig6(spec.sourceExample.resultNumber)}.</p>
          <QuoteBlock componentId="formula-explorer-v1" part="example" id="example" sourceId={spec.sourceId} quote={spec.sourceExample.quote} cite={cite} caption="The page’s words" />
        </div>
      )}

      {spec.cases.length > 0 && (
        <section aria-labelledby={`${uid}-predict`}>
          <h3 id={`${uid}-predict`}>Predict, then reveal</h3>
          <p className="muted small">Commit to a number first; checking moves the sliders and the graph to that case.</p>
          <ol className="predictions">
            {spec.cases.map((c, i) => {
              const r = results[c.id];
              const out = cases.find((x) => x.id === c.id);
              const inputId = `${uid}-${c.id}`;
              return (
                <li key={c.id} className="prediction">
                  <form onSubmit={(e) => submit(e, c.id)} noValidate>
                    <p className="prediction-head" id={`${inputId}-prompt`}><span className="case-label">Case {i + 1}</span> {casePrompt(spec, c)}</p>
                    <div className="prediction-row">
                      <label htmlFor={inputId}>Your prediction: {yName}</label>
                      <div className="guess">
                        <input
                          id={inputId}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="e.g. 25"
                          value={r?.raw ?? ''}
                          aria-describedby={`${inputId}-prompt ${inputId}-tol`}
                          onChange={(e) => setResults((prev) => ({ ...prev, [c.id]: { raw: e.target.value, grade: null, error: null } }))}
                        />
                      </div>
                      <button type="submit" className="btn btn-primary" disabled={parseGuess(r?.raw ?? '') === null} aria-describedby={parseGuess(r?.raw ?? '') === null ? `${inputId}-first` : undefined}>Check my prediction</button>
                    </div>
                    <p className="muted small" id={`${inputId}-tol`}>{parseGuess(r?.raw ?? '') === null && <span id={`${inputId}-first`}>Make a prediction first. </span>}Counts as correct within 2% of the calculator’s value.</p>
                    {r?.error != null && <p className="field-error" role="alert">{r.error}</p>}
                    {r?.grade != null && (
                      <div className={`grade ${r.grade.withinTolerance ? 'grade-ok' : 'grade-miss'}`} role="status">
                        <strong><Mark kind={r.grade.withinTolerance ? 'ok' : 'bad'} />{r.grade.withinTolerance ? 'Close enough' : `Not close enough — your guess was too ${r.grade.direction === 'high' ? 'high' : 'low'}`}</strong>
                        <span>You guessed {trimmed(r.grade.guess, 4)} · the calculator says <b>{yName} = {sig6(out?.output ?? Number.NaN)}</b> · off by {sig6(Math.abs(r.grade.error))} (allowed ±{sig6(r.grade.tolerance)}). The sliders and the graph now show this case.</span>
                      </div>
                    )}
                  </form>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
