// Threshold ("Does it pass?", threshold-v1): a vote meter per stage with the required line from the engine, a 'yes'
// slider, and the try-it scenarios as predict-then-reveal questions. Every count is the engine's (lib/thresholdView.ts).
import { useEffect, useId, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ThresholdSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  clampVotes, countText, quoteLeaksNeed, scenarioQuestion, scenarioTitle, scenarioTitleShown, stageInfo, thresholdFeedback, thresholdPresentationSteps, thresholdRevealState,
  verdictText, voteOutcome,
} from '../lib/thresholdView.ts';
import type { StageInfo, StageOutcome } from '../lib/thresholdView.ts';
import { linkKey } from '../lib/linking.ts';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { IconMinus, IconPlus, Mark } from './icons.tsx';

export interface ThresholdViewProps { spec: ThresholdSpec; cite: CiteProps; presentation?: EnginePresentation }

type Guess = 'pass' | 'fail';

/** The seats of one stage: small units when there are few (filled column by column), else a bar, with the required line. */
function Meter({ info, yes, revealed }: { info: StageInfo; yes: number; revealed: boolean }) {
  const { meter, total } = info;
  if (meter.kind === 'units') {
    const style = { '--cols': meter.cols, '--rows': meter.rows, '--k': info.needColumns } as CSSProperties;
    return (
      <div className="th-meter th-units" style={style} role="img" aria-label={`${countText(yes)} of ${countText(total)} vote yes${revealed ? `; ${info.needLine}` : ''}`}>
        <div className="th-unit-grid" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => <span key={i} className="th-unit" data-yes={i < yes ? 'true' : 'false'} data-needed={revealed && i < info.need ? 'true' : 'false'} />)}
        </div>
        <span className="th-need-line" data-on={revealed ? 'true' : 'false'} aria-hidden="true"><span className="th-need-tick num">{countText(info.need)}</span></span>
      </div>
    );
  }
  const style = { '--fill': yes / total, '--need': info.needAt } as CSSProperties;
  return (
    <div className="th-meter th-bar" style={style} role="img" aria-label={`${countText(yes)} of ${countText(total)} vote yes${revealed ? `; ${info.needLine}` : ''}`}>
      <div className="th-bar-track" aria-hidden="true"><span className="th-bar-fill" /></div>
      <span className="th-need-line" data-on={revealed ? 'true' : 'false'} aria-hidden="true"><span className="th-need-tick num">{countText(info.need)}</span></span>
    </div>
  );
}

function StageBlock({ info, yes, result, revealed, multi, canMove, onMove }: {
  info: StageInfo; yes: number; result: StageOutcome | undefined; revealed: boolean; multi: boolean; canMove: boolean; onMove: (n: number) => void;
}) {
  const inputId = useId();
  const s = info.stage;
  // Before the reveal a quote that states the required count stays unlinked, so hovering it cannot give the answer away.
  const ruleLinks = !revealed && quoteLeaksNeed(s, s.quote) ? [] : [linkKey(s.sourceId, s.quote)];
  const totalLinks = !revealed && quoteLeaksNeed(s, s.totalQuote) ? [] : [linkKey(s.sourceId, s.totalQuote)];
  const passes = result?.passes === true;
  return (
    <section className="th-stage" aria-label={info.body} data-result={revealed ? (passes ? 'pass' : 'fail') : 'open'}>
      <div className="th-stage-head">
        <Linked as="p" className="th-body" links={totalLinks}>
          {multi && <span className="th-stage-n num">{info.index + 1}</span>}
          <strong>{info.body}</strong> <span className="th-total num">{countText(info.total)} in all</span>
        </Linked>
        <Linked as="p" className="th-rule" links={ruleLinks}>
          <span>Rule: {info.rule}</span>
          <span className="th-sep" aria-hidden="true">·</span>
          <span className="th-need">
            needs{' '}
            <span className="th-stack">
              <span data-on={revealed ? 'true' : 'false'} className="num">{countText(info.need)}</span>
              <span data-on={revealed ? 'false' : 'true'} className="concealed" aria-label="Hidden until the reveal">?</span>
            </span>
            {' '}of {countText(info.total)}
          </span>
        </Linked>
        <p className="th-stage-state th-stack" aria-live="polite">
          <span data-on={revealed ? 'true' : 'false'} className={passes ? 'th-ok' : 'th-bad'}>
            <Mark kind={passes ? 'ok' : 'bad'} />{passes ? 'Passes' : `${countText(Math.max(0, -(result?.margin ?? 0)))} short`}
          </span>
          <span data-on={revealed ? 'false' : 'true'} className="th-open">Passes?</span>
        </p>
      </div>
      <Meter info={info} yes={yes} revealed={revealed} />
      <div className="th-controls">
        <label htmlFor={inputId}>Yes votes</label>
        <button type="button" className="btn th-step" onClick={() => onMove(yes - 1)} disabled={!canMove || yes <= 0} aria-label={`One fewer yes vote (${info.body})`}><IconMinus /></button>
        <input id={inputId} type="range" min={0} max={info.total} step={1} value={yes} disabled={!canMove} onChange={(e) => onMove(Number(e.target.value))} />
        <button type="button" className="btn th-step" onClick={() => onMove(yes + 1)} disabled={!canMove || yes >= info.total} aria-label={`One more yes vote (${info.body})`}><IconPlus /></button>
        <output htmlFor={inputId} className="th-count"><span className="num">{countText(yes)}</span> <span className="th-of">of {countText(info.total)}</span></output>
      </div>
    </section>
  );
}

/**
 * A try-it scenario's title: its counts until revealed, then the written title. Both are laid out from the start in one
 * stacked cell, so the reveal never widens a chip or re-wraps the list.
 */
function ScenarioTitle({ spec, index, shown }: { spec: ThresholdSpec; index: number; shown: boolean }) {
  return (
    <span className="th-stack">
      <span data-on={shown ? 'false' : 'true'} aria-hidden={shown ? true : undefined}>{scenarioTitle(spec, index, false)}</span>
      <span data-on={shown ? 'true' : 'false'} aria-hidden={shown ? undefined : true}>{scenarioTitle(spec, index, true)}</span>
    </span>
  );
}

/**
 * "Does it pass?" A vote meter for each stage (all must pass), the try-it scenarios as questions the class answers before
 * the reveal, and a slider to try any count. Opens on the first scenario with the required count and the verdict hidden.
 */
export function ThresholdView({ spec, cite: _cite, presentation }: ThresholdViewProps) {
  const stages = useMemo(() => stageInfo(spec), [spec]);
  const staged = presentation !== undefined;
  const steps = thresholdPresentationSteps(spec);
  const [pick, setPick] = useState(0);
  const [shown, setShown] = useState(false);
  const [guess, setGuess] = useState<Guess | null>(null);
  const [ownRaw, setOwn] = useState<number[] | null>(null);
  const stepIndex = staged ? Math.max(0, Math.min(steps - 1, presentation.step)) : pick;
  // A new presenter step, and ← that hides the answer again, start from the scenario's own counts.
  useEffect(() => { if (staged) setOwn(null); }, [staged, stepIndex, presentation?.revealed]);
  // On a slide the presenter decides what is revealed: a tried count never outlives ← (lib thresholdRevealState).
  const { revealed, own } = thresholdRevealState({ staged, presenterRevealed: staged && presentation.revealed, shown, own: ownRaw });

  const scenario = spec.scenarios[stepIndex];
  const base = scenario?.yes ?? stages.map(() => 0);
  const yes = stages.map((st, i) => clampVotes(st.total, (own ?? base)[i] ?? 0));
  const outcome = voteOutcome(spec, yes);
  const verdict = verdictText(spec, outcome);
  const multi = stages.length > 1;
  // Before the reveal on a slide the counts are the question; after it (or in the lesson) the class may try any count.
  const canMove = !staged || presentation.revealed;

  const choose = (i: number): void => { setPick(i); setOwn(null); setShown(false); setGuess(null); };
  const move = (stage: number, n: number): void => {
    const next = [...yes];
    next[stage] = clampVotes(stages[stage]?.total ?? 0, n);
    setOwn(next);
  };
  const answer = (g: Guess): void => { setGuess(g); setShown(true); };
  // A learner's own prediction is answered in the shared feedback voice; a plain reveal (or a tried count) shows the verdict.
  const feedback = !staged && guess !== null && own === null ? thresholdFeedback(spec, outcome, guess) : null;

  return (
    <div className="th" data-mode={staged ? 'stage' : 'lesson'} data-testid="threshold">
      <div className="th-ask">
        <p className="th-eyebrow">{own !== null ? 'Your own count' : scenario !== undefined && spec.scenarios.length > 1 ? `Try it · ${stepIndex + 1} of ${spec.scenarios.length}` : <>Try it · <ScenarioTitle spec={spec} index={stepIndex} shown={revealed} /></>}</p>
        <p className="th-question">{scenarioQuestion(spec, { yes })}</p>
      </div>

      {spec.scenarios.length > 1 && (staged
        ? (
          <ol className="th-scenarios" aria-label="Questions on this slide">
            {/* Titles state outcomes ("falls just short"), so each is its counts until that step is revealed (UX #2). */}
            {spec.scenarios.map((s, i) => <li key={s.id} data-current={i === stepIndex ? 'true' : 'false'}><span className="num">{i + 1}</span><ScenarioTitle spec={spec} index={i} shown={scenarioTitleShown(i, stepIndex, revealed)} /></li>)}
          </ol>
        ) : (
          <div className="th-scenarios" role="group" aria-label="Try-it questions">
            {spec.scenarios.map((s, i) => (
              <button key={s.id} type="button" className="th-chip" aria-pressed={own === null && i === pick} onClick={() => choose(i)}>
                <span className="num">{i + 1}</span><ScenarioTitle spec={spec} index={i} shown={own === null && scenarioTitleShown(i, pick, shown)} />
              </button>
            ))}
          </div>
        ))}

      <div className="th-stages">
        {stages.map((st, i) => (
          <StageBlock key={st.id} info={st} yes={yes[i] ?? 0} result={outcome.stages[i]} revealed={revealed} multi={multi} canMove={canMove} onMove={(n) => move(i, n)} />
        ))}
      </div>

      {/* The question's foot: the vote before the reveal, the verdict after it, in one reserved cell (nothing moves). */}
      <div className="th-foot th-stack">
        <div data-on={revealed ? 'false' : 'true'} aria-hidden={revealed ? true : undefined}>
          {staged ? (
            <p className="th-hint">Class vote: does it pass? Then <kbd>R</kbd>.</p>
          ) : (
            <div className="th-guess" role="group" aria-label="Your prediction">
              <span className="th-hint">Your prediction:</span>
              <button type="button" className="btn" onClick={() => answer('pass')} disabled={revealed}>It passes</button>
              <button type="button" className="btn" onClick={() => answer('fail')} disabled={revealed}>It fails</button>
              <button type="button" className="btn btn-quiet" onClick={() => setShown(true)} disabled={revealed}>Show the answer</button>
            </div>
          )}
        </div>
        <div data-on={revealed ? 'true' : 'false'} aria-hidden={revealed ? undefined : true} role="status">
          {feedback !== null ? (
            <p className={`th-verdict ${feedback.ok ? 'th-ok' : 'th-bad'}`} data-level={feedback.level}>
              <Mark kind={feedback.ok ? 'ok' : 'bad'} /><strong>{feedback.label}</strong>
              <span className="th-verdict-detail">{feedback.line}</span>
            </p>
          ) : (
            <p className={`th-verdict ${outcome.passes ? 'th-ok' : 'th-bad'}`}>
              <Mark kind={outcome.passes ? 'ok' : 'bad'} /><strong>{verdict.headline}</strong>
              <span className="th-verdict-detail">{verdict.detail}</span>
            </p>
          )}
        </div>
      </div>
      {!staged && (
        <div className="th-fine">
          <p>{multi ? 'Every stage must pass. ' : ''}The try-it counts are examples, not page facts.</p>
          <details className="fb-more">
            <summary>How the count is found</summary>
            <p>The required count is worked out by code from the page’s rule, not written by the AI.</p>
          </details>
        </div>
      )}
    </div>
  );
}
