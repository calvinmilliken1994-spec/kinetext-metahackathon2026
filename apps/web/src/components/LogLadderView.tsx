// Stage 8a log-ladder-v1 view (slice W-A, docs/specs/STAGE-8a-subject-engines.md §1b, §4).
// A vertical ladder of the page's scale: every whole step is marked with the page's factor, the page's rungs sit at their
// values, and the case's from → to span is highlighted. The class predicts "how many times more or less?"; on reveal the
// running multiplier grows step by step (10 → 100 → 1,000). Ratios are our engine's (lib/logLadderView.ts).
import { useId, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { LogLadderSpec } from '../../../../packages/contracts/kit.ts';
import type { EnginePresentation } from '../lib/enginePresentation.ts';
import {
  gapText, gradeLadder, ladderAxis, ladderCases, ladderWording, ratioText, spreadLabels, valueText,
} from '../lib/logLadderView.ts';
import type { LadderCase, LadderGrade } from '../lib/logLadderView.ts';
import { aiLabel, aiText, capitalFirst } from '../lib/displayText.ts';
import { linkKey } from '../lib/linking.ts';
import type { CiteProps } from './Explanations.tsx';
import { Linked } from './Linked.tsx';
import { QuoteBlock } from './QuoteBlock.tsx';
import { IconArrowRight, Mark } from './icons.tsx';

export interface LogLadderViewProps { spec: LogLadderSpec; cite: CiteProps; presentation?: EnginePresentation }

const COMPONENT = 'log-ladder-v1';
/** Room each rung label needs, in % of the ladder's height. */
const LABEL_GAP = 10;

const pct = (n: number): string => `${n}%`;

function FromTo({ spec, c }: { spec: LogLadderSpec; c: LadderCase }) {
  return (
    <span className="ll-fromto" aria-label={capitalFirst(c.fromTo)}>
      <span aria-hidden="true">{capitalFirst(`${aiText(spec.quantity)} ${valueText(c.from)}`)}</span>
      <IconArrowRight className="ll-fromto-arrow" size={18} />
      <span aria-hidden="true">{valueText(c.to)}</span>
    </span>
  );
}

/** "10 to the power 5" as 10⁵, written with <sup> so a fractional exponent (10^1.4) reads the same way. */
function Power({ factor, exponent }: { factor: number; exponent: number }) {
  return <span className="ll-power">{ratioText(factor)}<sup>{valueText(exponent)}</sup></span>;
}

function Ladder({ spec, c, revealed }: { spec: LogLadderSpec; c: LadderCase; revealed: boolean }) {
  const axis = useMemo(() => ladderAxis(spec), [spec]);
  const wording = ladderWording(spec);
  const factorLinks = [linkKey(spec.sourceId, spec.quote)];
  const rungYs = spec.rungs.map((r) => axis.y(r.value));
  const labelYs = spreadLabels(rungYs, LABEL_GAP, 2, 98);
  const top = Math.min(axis.y(c.from), axis.y(c.to));
  const bottom = Math.max(axis.y(c.from), axis.y(c.to));
  // Pairs of neighbouring marks (a wide scale marks every `stride` steps, so its gaps read ×100, ×1,000, …).
  const gaps = axis.ticks.slice(1).map((v, i) => ({ v, prev: axis.ticks[i] as number }));
  // The effect grows towards higher values when `increasing`, else towards lower ones (pH: lower is more acidic).
  const growsUp = spec.increasing;
  return (
    <figure className="ll-ladder" data-testid="log-ladder" aria-label={`The ${aiText(spec.quantity)} scale from ${axis.min} to ${axis.max}; each whole step is ×${ratioText(spec.factor)}.`}>
      <p className="ll-end ll-end-top" data-grows={growsUp ? 'true' : 'false'}>{growsUp ? capitalFirst(wording.dir.more) : capitalFirst(wording.dir.less)}</p>
      <div className="ll-body">
        <div className="ll-guides" aria-hidden="true">
          {axis.ticks.map((v) => <span key={v} className="ll-guide" style={{ top: pct(axis.y(v)) }} />)}
        </div>
        {/* running multiplier, grown step by step on reveal */}
        <ol className="ll-totals" aria-label="Running multiplier" data-on={revealed ? 'true' : 'false'}>
          {c.steps.map((s, k) => (
            <li key={k} className="ll-total" style={{ top: pct(axis.y(s.to)), '--k': k } as CSSProperties} data-last={k === c.steps.length - 1 ? 'true' : undefined}>
              <span>×{ratioText(s.cumulative)}</span>
            </li>
          ))}
        </ol>
        <Linked as="div" className="ll-gaps" links={factorLinks}>
          {gaps.map((g) => (
            <span key={g.v} className="ll-gap" style={{ top: pct((axis.y(g.v) + axis.y(g.prev)) / 2) }}>{gapText(spec.factor, g.prev, g.v)}</span>
          ))}
        </Linked>
        <div className="ll-axis">
          <span className="ll-case-span" style={{ top: pct(top), height: pct(bottom - top) }} aria-hidden="true" />
          {axis.ticks.map((v) => (
            <span key={v} className="ll-tick" style={{ top: pct(axis.y(v)) }} data-in={v >= Math.min(c.from, c.to) && v <= Math.max(c.from, c.to) ? 'true' : undefined}>
              <span className="ll-tick-val">{v}</span>
            </span>
          ))}
          <span className="ll-end-dot ll-from" style={{ top: pct(axis.y(c.from)) }} aria-hidden="true" />
          <span className="ll-end-dot ll-to" style={{ top: pct(axis.y(c.to)) }} aria-hidden="true" />
        </div>
        <ul className="ll-rungs" aria-label="Points the page names on the scale">
          {spec.rungs.map((r, i) => {
            const y = rungYs[i] as number;
            const ly = labelYs[i] as number;
            return (
              <Linked as="li" key={r.id} className="ll-rung" links={[linkKey(r.sourceId, r.quote)]} tabIndex={0} style={{ top: pct(y), '--dy': `${ly - y}` } as CSSProperties}>
                <span className="ll-rung-dot" aria-hidden="true" />
                <span className="ll-rung-label">{!Number.isInteger(r.value) && <span className="ll-rung-val">{valueText(r.value)}</span>}{aiLabel(r.label)}</span>
              </Linked>
            );
          })}
        </ul>
      </div>
      <p className="ll-end ll-end-bottom" data-grows={growsUp ? 'false' : 'true'}>{growsUp ? capitalFirst(wording.dir.less) : capitalFirst(wording.dir.more)}</p>
    </figure>
  );
}

/** The answer, laid out from the start so revealing it never moves anything: label words and a dashed ? until then. */
function Answer({ spec, c, revealed }: { spec: LogLadderSpec; c: LadderCase; revealed: boolean }) {
  const whole = Number.isInteger(c.exponent);
  return (
    <div className="ll-answer" data-on={revealed ? 'true' : 'false'}>
      <div className="ll-answer-hidden" aria-hidden={revealed ? 'true' : undefined}>
        <span className="ll-answer-lead">Answer</span> <span className="concealed">?</span>
      </div>
      <div className="ll-answer-shown" aria-hidden={revealed ? undefined : 'true'}>
        <p className="ll-answer-big">{capitalFirst(c.answerText)}</p>
        <p className="ll-answer-why">
          {valueText(c.exponent)} {c.exponent === 1 ? 'step' : 'steps'} of ×{ratioText(spec.factor)}: <Power factor={spec.factor} exponent={c.exponent} /> {whole ? '=' : '≈'} {ratioText(c.ratio)}.
          {' '}Computed by our code from the page’s factor.
        </p>
      </div>
    </div>
  );
}

function gradeText(g: LadderGrade, c: LadderCase, dirWords: { more: string; less: string }, factor: number): { tone: 'ok' | 'miss'; text: string } {
  switch (g.status) {
    case 'right': return { tone: 'ok', text: `Right: ${c.answerText}.` };
    case 'wrong-way': return { tone: 'miss', text: `The right number, the wrong way: this case is ${dirWords[c.direction]}.` };
    case 'off': return { tone: 'miss', text: `Not quite. Count the whole steps: each one multiplies by ${ratioText(factor)}.` };
    default: return { tone: 'miss', text: 'Type how many times, for example 1000.' };
  }
}

interface CaseState { guess: string; dir: 'more' | 'less' | null; grade: LadderGrade | null; revealed: boolean }
const FRESH: CaseState = { guess: '', dir: null, grade: null, revealed: false };

function LessonLadder({ spec, cite }: { spec: LogLadderSpec; cite: CiteProps }) {
  const uid = useId();
  const cases = useMemo(() => ladderCases(spec), [spec]);
  const wording = ladderWording(spec);
  const [active, setActive] = useState(0);
  const [states, setStates] = useState<CaseState[]>(() => cases.map(() => FRESH));
  const c = cases[active] ?? cases[0];
  if (c === undefined) return null;
  const st = states[active] ?? FRESH;
  const update = (next: Partial<CaseState>): void => setStates((all) => all.map((s, i) => (i === active ? { ...s, ...next } : s)));
  const check = (e: FormEvent): void => {
    e.preventDefault();
    const n = Number(st.guess.replace(/[,\s]/g, ''));
    if (st.dir === null) { update({ grade: { status: 'invalid', margin: 0 } }); return; }
    const g = gradeLadder(c, n, st.dir);
    update({ grade: g, revealed: st.revealed || g.status === 'right' });
  };
  const msg = st.grade === null ? null : st.dir === null && st.grade.status === 'invalid'
    ? { tone: 'miss' as const, text: `Choose ${wording.dir.more} or ${wording.dir.less} as well.` }
    : gradeText(st.grade, c, wording.dir, spec.factor);

  return (
    <div className="ll" data-mode="lesson" data-testid="log-ladder-view">
      {cases.length > 1 && (
        <div className="ll-cases" role="group" aria-label="Cases">
          {cases.map((k, i) => (
            <button key={k.id} type="button" className="ll-case-btn" aria-pressed={i === active} onClick={() => setActive(i)}>
              <span className="ll-case-n">Case {i + 1}</span> <FromTo spec={spec} c={k} />
            </button>
          ))}
        </div>
      )}
      <div className="ll-main">
        <Ladder spec={spec} c={c} revealed={st.revealed} />
        <section className="ll-ask" aria-labelledby={`${uid}-q`}>
          <p className="ll-ask-case"><FromTo spec={spec} c={c} /></p>
          <h3 id={`${uid}-q`} className="ll-q">{wording.question}</h3>
          <form className="ll-form" onSubmit={check} noValidate>
            <label className="ll-guess">
              <span className="sr-only">How many times</span>
              <input
                type="text" inputMode="decimal" autoComplete="off" value={st.guess} placeholder="How many?" disabled={st.revealed}
                onChange={(e) => update({ guess: e.target.value, grade: null })}
              />
              <span className="ll-guess-unit">times</span>
            </label>
            <div className="ll-dir" role="group" aria-label="Which way">
              {(['more', 'less'] as const).map((d) => (
                <button key={d} type="button" aria-pressed={st.dir === d} className="ll-dir-btn" disabled={st.revealed} onClick={() => update({ dir: d, grade: null })}>
                  {wording.dir[d]}
                </button>
              ))}
            </div>
            <div className="ll-actions">
              <button type="submit" className="btn btn-primary" disabled={st.revealed}>Check</button>
              <button type="button" className="btn" disabled={st.revealed} onClick={() => update({ revealed: true })}>Show the answer</button>
              {st.revealed && <button type="button" className="btn btn-quiet" onClick={() => update(FRESH)}>Try again</button>}
            </div>
          </form>
          <p className={`ll-grade${msg === null ? '' : ` ll-grade-${msg.tone}`}`} role="status" aria-live="polite">
            {msg !== null && <><Mark kind={msg.tone === 'ok' ? 'ok' : 'bad'} />{msg.text}</>}
          </p>
          <Answer spec={spec} c={c} revealed={st.revealed} />
          <p className="ll-fine">A prediction within 2% of the computed value counts as right.</p>
        </section>
      </div>
      <section className="ll-facts" aria-label="What the page says">
        <QuoteBlock componentId={COMPONENT} part="factor" id="factor" sourceId={spec.sourceId} quote={spec.quote} cite={cite} caption={`Each step, in the page’s words: “${aiText(spec.factorText)}”`} />
        <details className="ll-rung-quotes">
          <summary>Where the points on the scale come from</summary>
          <ul>
            {spec.rungs.map((r) => (
              <li key={r.id}><QuoteBlock componentId={COMPONENT} part="rung" id={r.id} sourceId={r.sourceId} quote={r.quote} cite={cite} caption={`${aiLabel(r.label)} (${valueText(r.value)})`} /></li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}

function StagedLadder({ spec, presentation }: { spec: LogLadderSpec; presentation: EnginePresentation }) {
  const cases = useMemo(() => ladderCases(spec), [spec]);
  const wording = ladderWording(spec);
  const k = Math.min(cases.length - 1, Math.max(0, Math.floor(presentation.step)));
  const c = cases[k];
  if (c === undefined) return null;
  return (
    <div className="ll" data-mode="stage" data-testid="log-ladder-view" data-revealed={presentation.revealed ? 'true' : 'false'}>
      <div className="ll-main">
        <Ladder spec={spec} c={c} revealed={presentation.revealed} />
        <section className="ll-ask">
          {cases.length > 1 && <p className="ll-ask-n">Case {k + 1} of {cases.length}</p>}
          <p className="ll-ask-case"><FromTo spec={spec} c={c} /></p>
          <h3 className="ll-q">{wording.question}</h3>
          <Linked as="p" className="ll-rule" links={[linkKey(spec.sourceId, spec.quote)]} tabIndex={0}>
            Each step on this scale is ×{ratioText(spec.factor)}.
          </Linked>
          <Answer spec={spec} c={c} revealed={presentation.revealed} />
        </section>
      </div>
    </div>
  );
}

export function LogLadderView({ spec, cite, presentation }: LogLadderViewProps) {
  if (presentation !== undefined) return <StagedLadder spec={spec} presentation={presentation} />;
  return <LessonLadder spec={spec} cite={cite} />;
}
