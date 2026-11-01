import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { capitalFirst } from '../lib/displayText.ts';
import type { CSSProperties, FormEvent } from 'react';
import type { FormulaExplorerSpec } from '../../../../packages/contracts/kit.ts';
import {
  CALCULATOR_FAILURE, GRAPH_SIZE, STAGE_GRAPH_SIZE, STAGE_LAYOUT, buildExplorer, caseOutputs, casePrompt, curveSamples, defaultInputs, displayUnit, evalAt, graphGeometry, graphReveal, gradeCaseGuess,
  groupedSig6, inputsOfCase, outputName, niceValueRows, pageFormulaStatus, predictSpec, shortMeaning, sliderStep, valueRowsWithNow,
} from '../lib/explorer.ts';
import type { Inputs } from '../lib/explorer.ts';
import type { Grade } from '../lib/predictions.ts';
import { parseGuess } from '../lib/predictions.ts';
import { Readout, Slider } from './controls.tsx';
import type { CiteProps } from './Explanations.tsx';
import { FormulaGraph } from './FormulaGraph.tsx';
import type { GraphRevealView } from './FormulaGraph.tsx';
import { revealInPanels } from '../lib/scroll.ts';
import { QuoteBlock } from './QuoteBlock.tsx';
import { Linked } from './Linked.tsx';
import { FeedbackLine } from './PredictionCards.tsx';
import { gradeFeedback, targetRule } from '../lib/feedback.ts';
import { EquationLine } from './EquationLine.tsx';
import { explorerEquation } from '../lib/equation.ts';
import { linkKey } from '../lib/linking.ts';
import { CONCEALED, CONCEALED_HINT, initialConcealed, nextConcealed } from '../lib/reveal.ts';
import { caseFriendlyStep } from '../lib/sliderSteps.ts';
import { formulaLhs, symbolPieces, typesetFormula } from '../lib/typeset.ts';
import { SymbolMark, TypesetFormula } from './TypesetFormula.tsx';

/** How presentation mode shows the explorer (default: the full lesson view). */
export type ExplorerPresentation =
  /** Its own beat: sliders, graph and table, without the cases list (case 1 was asked on the beat before). */
  | { mode: 'stage' }
  /** A predict beat: case 1's graph and equation only, the answer hidden until `revealed`; then the class's guess is drawn and graded. */
  | { mode: 'predict'; revealed: boolean; guess: number | null };

interface Props { spec: FormulaExplorerSpec; cite: CiteProps; presentation?: ExplorerPresentation }

export const AI_FORMULA_NOTICE = 'Formula entered by AI from the quoted line - compare with the quote.';

/**
 * The predict slide's graph: wider than the lesson graph (about the shape of the slide's scene column), drawn at
 * PREDICT_SCENE_WIDTH so its labels scale up 1.5× with it. The lesson graph's 520 × 300 left a third of the slide empty.
 */
const PREDICT_GRAPH_SIZE = { width: 600, height: 260 } as const;
/** The design width the predict beat lays the scene out at (Beats.tsx PredictScene). */
export const PREDICT_SCENE_WIDTH = 900;

interface CaseResult { raw: string; grade: Grade | null; error: string | null }

/**
 * Formula explorer: sliders for each variable (with units and ranges), the live result, a graph of the result against the x
 * variable with the current point marked, a value table, and predict-then-reveal on the page’s cases. Every number is
 * computed here by the safe evaluator from the stored expression; nothing is read from a stored answer.
 */
export function FormulaExplorerView({ spec, cite, presentation }: Props) {
  const uid = useId();
  const model = useMemo(() => buildExplorer(spec), [spec]);
  const [inputs, setInputs] = useState<Inputs>(() => defaultInputs(spec));
  const [results, setResults] = useState<Record<string, CaseResult>>({});
  const formulaStatus = useMemo(() => pageFormulaStatus(spec), [spec]);
  const yName = outputName(spec);
  const xVar = spec.variables.find((v) => v.name === spec.xVariable);

  // A predict beat draws case 1 near the middle of the graph (lib/explorer.ts predictSpec); everything else uses the slider range.
  const drawn = useMemo(() => (presentation?.mode === 'predict' ? predictSpec(spec) : spec), [presentation?.mode, spec]);
  const samples = useMemo(() => (model.ok ? curveSamples(model, drawn, inputs) : []), [model, drawn, inputs]);
  const output = model.ok ? evalAt(model, inputs) : Number.NaN;
  const geometry = useMemo(
    () => graphGeometry(samples, { x: inputs[spec.xVariable] ?? xVar?.default ?? 0, y: output }, presentation?.mode === 'stage' ? STAGE_GRAPH_SIZE : presentation?.mode === 'predict' ? PREDICT_GRAPH_SIZE : GRAPH_SIZE),
    [samples, inputs, spec.xVariable, xVar, output, presentation?.mode],
  );
  const table = useMemo(() => (model.ok ? niceValueRows(model, spec, inputs) : []), [model, spec, inputs]);
  const cases = useMemo(() => (model.ok ? caseOutputs(model, spec) : []), [model, spec]);
  // The last checked case: its guess is drawn on the graph while the sliders still show that case.
  const [lastCheck, setLastCheck] = useState<{ caseId: string; grade: Grade; seq: number } | null>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const reveal = useMemo((): GraphRevealView | null => {
    if (lastCheck === null) return null;
    const c = spec.cases.find((x) => x.id === lastCheck.caseId);
    if (c === undefined) return null;
    const at = inputsOfCase(c);
    const same = spec.variables.every((v) => {
      const a = at[v.name];
      const b = inputs[v.name];
      return a !== undefined && b !== undefined && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
    });
    if (!same) return null;
    const g = lastCheck.grade;
    return { ...graphReveal(geometry, g, presentation === undefined ? 'your' : 'class'), guess: g.guess, actual: g.actual, tolerance: g.tolerance, seq: lastCheck.seq };
  }, [lastCheck, spec, inputs, geometry, presentation]);

  // Predict-then-reveal: case 1's answer (the output, the value table, the graph's current value) is '?' until a case is
  // checked or a slider moves.
  const [ownConcealed, setConcealed] = useState(() => initialConcealed(spec.cases.length));
  // A predict beat drives the reveal from outside: R puts case 1 on the graph with the class's guess; going back hides it.
  const predictBeat = presentation?.mode === 'predict';
  const presentedRevealed = presentation?.mode === 'predict' && presentation.revealed;
  const presentedGuess = presentation?.mode === 'predict' ? presentation.guess : null;
  const concealed = predictBeat ? !presentedRevealed : ownConcealed;
  useEffect(() => {
    if (!predictBeat) return;
    const first = spec.cases[0];
    if (!presentedRevealed || first === undefined) {
      setLastCheck(null);
      setInputs(defaultInputs(spec));
      return;
    }
    setInputs(inputsOfCase(first));
    const out = model.ok ? evalAt(model, inputsOfCase(first)) : Number.NaN;
    setLastCheck((prev) => (presentedGuess === null || !Number.isFinite(out) ? null : { caseId: first.id, grade: gradeCaseGuess(presentedGuess, out), seq: (prev?.seq ?? 0) + 1 }));
  }, [predictBeat, presentedRevealed, presentedGuess, spec, model]);
  const onSlider = useCallback((name: string, value: number) => {
    setConcealed((c) => nextConcealed(c, 'slider'));
    setInputs((prev) => ({ ...prev, [name]: value }));
  }, []);
  // The page's symbols, typeset (Cd → C with subscript d, rho → ρ), for the formula, the live equation and the sliders.
  const symbols = useMemo(() => symbolPieces(spec.variables), [spec.variables]);
  const typeset = useMemo(() => typesetFormula(spec), [spec]);
  const lhs = useMemo(() => formulaLhs(spec.formulaText) ?? yName, [spec.formulaText, yName]);
  const equation = useMemo(
    () => (model.ok ? explorerEquation(spec.expression, model.names, lhs, inputs, output, symbols) : null),
    [model, spec.expression, lhs, inputs, output, symbols],
  );
  const formulaLinks = useMemo(() => [linkKey(spec.sourceId, spec.quote)], [spec.sourceId, spec.quote]);
  // Slider steps that land on the case values (case 1 first).
  const steps = useMemo(() => Object.fromEntries(spec.variables.map((v) => [
    v.name,
    caseFriendlyStep(v.min, v.max, sliderStep(v), spec.cases.flatMap((c) => c.inputs.filter((i) => i.name === v.name).map((i) => i.value))),
  ])), [spec]);

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
    const grade = gradeCaseGuess(guess, out.output);
    setResults((r) => ({ ...r, [caseId]: { raw: r[caseId]?.raw ?? '', grade, error: null } }));
    setConcealed((c) => nextConcealed(c, 'run-case'));
    setInputs(inputsOfCase(c));
    setLastCheck((prev) => ({ caseId, grade, seq: (prev?.seq ?? 0) + 1 }));
    // Bring the graph into view (inside the lesson column only): the point settles from the guess to the value there.
    revealInPanels(visualRef.current, 'nearest');
  };

  const xUnit = xVar === undefined ? '' : displayUnit(xVar.unit);
  const xShort = xVar === undefined ? spec.xVariable : shortMeaning(xVar.meaning);
  const xName = `${xShort}${xUnit === '' ? '' : ` (${xUnit})`}`;

  if (predictBeat) {
    return (
      <div className="explorer explorer-presented" data-testid="formula-explorer" data-presentation="predict">
        <div className="explorer-visual" ref={visualRef}>
          <FormulaGraph geometry={geometry} yName={yName} xName={xName} concealed={concealed} reveal={reveal} />
        </div>
        {/* The worked line at heading size under the graph: on a slide the formula is read from the back of the room. */}
        <EquationLine equation={equation} concealed={concealed} links={formulaLinks} />
      </div>
    );
  }
  const rows = valueRowsWithNow(table, inputs[spec.xVariable] ?? 0, output);

  const sliders = (
    <div className="sliders">
      {spec.variables.map((v) => (
        <Slider
          key={v.name}
          label={capitalFirst(shortMeaning(v.meaning))}
          description={v.meaning}
          symbol={symbols[v.name] === undefined ? v.pageSymbol : <SymbolMark piece={symbols[v.name]!} />}
          unit={displayUnit(v.unit)}
          min={v.min}
          max={v.max}
          step={steps[v.name] ?? sliderStep(v)}
          value={inputs[v.name] ?? v.default}
          onChange={(val) => onSlider(v.name, val)}
        />
      ))}
    </div>
  );
  const formula = typeset !== null
    ? <Linked as="p" className="explorer-typeset" links={formulaLinks}><TypesetFormula formula={typeset} /></Linked>
    : <Linked as="p" className="explorer-formula-text" links={formulaLinks}><code>{spec.formulaText}</code></Linked>;

  // The slide (presentation stage beat): the formula and sliders in a column beside a graph that fills the rest of the
  // slide, the live equation and the result in one row under it. Laid out at STAGE_LAYOUT's design width; StageFit zooms it.
  if (presentation?.mode === 'stage') {
    const shell = { '--xs-side': `${STAGE_LAYOUT.sideWidth}px`, '--xs-gap': `${STAGE_LAYOUT.gap}px` } as CSSProperties;
    return (
      <div className="explorer explorer-stage" data-testid="formula-explorer" data-presentation="stage" style={shell}>
        <div className="explorer-stage-side">
          <div className="explorer-formula">
            {formula}
            <QuoteBlock componentId="formula-explorer-v1" part="equation" id="equation" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption="As the page writes it" />
            {formulaStatus !== 'matches' && <p className="note small" role="note" data-testid="ai-formula-notice">{AI_FORMULA_NOTICE}</p>}
          </div>
          {sliders}
          {spec.hasSourceExample && (
            // The example's words go to the quote zone under the slide on hover (one place for page quotes).
            <Linked as="p" className="explorer-stage-example" links={[linkKey(spec.sourceId, spec.sourceExample.quote)]} tabIndex={0}>
              The page’s own example gives <b>{groupedSig6(spec.sourceExample.resultNumber)}</b>.
            </Linked>
          )}
        </div>
        <div className="explorer-visual explorer-stage-main" ref={visualRef}>
          <FormulaGraph geometry={geometry} yName={yName} xName={xName} concealed={concealed} reveal={reveal} />
          <div className="explorer-stage-result">
            <EquationLine equation={equation} concealed={concealed} links={formulaLinks} />
            <dl className="readouts explorer-readout" aria-live="polite">
              <Readout name={yName} value={Number.isFinite(output) || concealed ? groupedSig6(output) : 'Not defined here'} unit="" concealed={concealed} />
            </dl>
            <button type="button" className="btn btn-small" onClick={() => setInputs(defaultInputs(spec))}>Reset sliders</button>
          </div>
        </div>
      </div>
    );
  }

  // The predictions sit right under the graph (case 1 first), so a teacher at 1920 × 1080 reaches the first question
  // without scrolling past the value table; the formula heads the slider column beside the graph.
  return (
    <div className="explorer" data-testid="formula-explorer">
      <div className="explorer-main">
        <div className="explorer-controls">
          <div className="explorer-formula">
            <p className="field-label">The formula</p>
            {formula}
            <QuoteBlock componentId="formula-explorer-v1" part="equation" id="equation" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption="As the page writes it" />
            {formulaStatus !== 'matches' && <p className="note small" role="note" data-testid="ai-formula-notice">{AI_FORMULA_NOTICE}</p>}
          </div>
          <h3>Move the sliders</h3>
          {sliders}
          <EquationLine equation={equation} concealed={concealed} links={formulaLinks} />
          <dl className="readouts explorer-readout" aria-live="polite">
            <Readout name={yName} value={groupedSig6(output)} unit="" concealed={concealed} />
          </dl>
          {!Number.isFinite(output) && !concealed && <p className="field-error" role="status">Not defined for these inputs.</p>}
          <button type="button" className="btn btn-small" onClick={() => setInputs(defaultInputs(spec))}>Reset sliders</button>
        </div>

        <div className="explorer-visual" ref={visualRef}>
          {/* The graph itself marks the guess and the gap; the words are said once, on the case's card (set B). */}
          <FormulaGraph geometry={geometry} yName={yName} xName={xName} concealed={concealed} reveal={reveal} />
          {spec.cases.length > 0 && presentation === undefined && (
            <section aria-labelledby={`${uid}-predict`}>
              <h3 id={`${uid}-predict`}>Predict, then reveal</h3>
              <p className="muted small">Commit to a number first; checking moves the sliders and the graph to that case.{concealed ? ' Until then the result shows as ?.' : ''}</p>
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
                        <p className="muted small" id={`${inputId}-tol`}>{parseGuess(r?.raw ?? '') === null && <span id={`${inputId}-first`}>Make a prediction first. </span>}{targetRule()}</p>
                        {r?.error != null && <p className="field-error" role="alert">{r.error}</p>}
                        {r?.grade != null && (
                          <FeedbackLine
                            feedback={gradeFeedback(r.grade, { format: groupedSig6, more: i < spec.cases.length - 1 })}
                            working={`${yName} = ${groupedSig6(out?.output ?? Number.NaN)} from the page’s formula`}
                          />
                        )}
                      </form>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          {presentation === undefined && (
            <table className="value-table">
              <caption>{yName} as the {xShort} changes (other sliders as set)</caption>
              <thead><tr><th scope="col">{xName}</th><th scope="col">{yName}</th></tr></thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={row.now ? 'value-now' : undefined}>
                    <th scope="row">{row.now && <span className="value-now-tag">Now</span>}{groupedSig6(row.x)}</th>
                    <td>{concealed ? <span className="concealed" title={CONCEALED_HINT}>{CONCEALED}</span> : groupedSig6(row.y)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {spec.hasSourceExample && (
        <div className="explorer-example">
          <p className="small"><strong>The page’s own example</strong> gives {groupedSig6(spec.sourceExample.resultNumber)}.</p>
          <QuoteBlock componentId="formula-explorer-v1" part="example" id="example" sourceId={spec.sourceId} quote={spec.sourceExample.quote} cite={cite} caption="The page’s words" />
        </div>
      )}
    </div>
  );
}
