import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { settleZoom } from '../../lib/stageFit.ts';
import type { FormEvent, ReactNode } from 'react';
import type { KitSpec } from '../../../../../packages/contracts/kit.ts';
import type { Badge } from '../../lib/repairs.ts';
import type { Beat, Deck, DeckPart, EngineSpec, NumericAnswer } from '../../lib/presentation.ts';
import type { EnginePresentation } from '../../lib/enginePresentation.ts';
import { checksLine, CLOSING_QUOTES, deckQuotes, diagramStageWidth, engineStage, isRevealed, leftOutLine, numericAnswer, predictVerdict, predictVisual, revealDelayMs, shownPoints, shownTerms, SUMMARY_HEADING, SUMMARY_NOTE, titleCard, visibleCount } from '../../lib/presentation.ts';
import { targetRule } from '../../lib/feedback.ts';
import { aiLabel, prettyExponents } from '../../lib/displayText.ts';
import { REVIEW_STATUS, withoutReviewNote } from '../../lib/provenance.ts';
import { reviewedStatus } from '../../lib/reviewState.ts';
import { quizCards } from '../../lib/quiz.ts';
import { compareGrid, NOT_STATED } from '../../lib/compare.ts';
import { parseGuess } from '../../lib/predictions.ts';
import { STAGE_LAYOUT } from '../../lib/explorer.ts';
import { compareEvents, formatEventDate, gradePair } from '../../lib/timeline.ts';
import { linkKey, linkKeysOf } from '../../lib/linking.ts';
import { linksUnlessConcealed } from '../../lib/conceal.ts';
import { ActivityPanel } from '../ActivityPanel.tsx';
import { AlgorithmTraceView } from '../AlgorithmTraceView.tsx';
import { DataTableView } from '../DataTableView.tsx';
import { LabelDiagramView } from '../LabelDiagramView.tsx';
import { LogLadderView } from '../LogLadderView.tsx';
import { ThresholdView } from '../ThresholdView.tsx';
import { BalanceView } from '../BalanceView.tsx';
import { ConceptMapView } from '../ConceptMapView.tsx';
import { FormulaExplorerView, PREDICT_SCENE_WIDTH } from '../FormulaExplorerView.tsx';
import { SequenceView } from '../SequenceView.tsx';
import { SortView } from '../SortView.tsx';
import { CompareView } from '../CompareView.tsx';
import { QuizCardsView } from '../QuizCardsView.tsx';
import { Linked } from '../Linked.tsx';
import { Mark } from '../icons.tsx';
import type { CiteProps } from '../Explanations.tsx';

export interface BeatProps {
  beat: Beat;
  step: number;
  /** An engine beat's current step was revealed with R (lib/presentation.ts PresentState.revealed). */
  revealed: boolean;
  deck: Deck;
  beats: readonly Beat[];
  /** The class's choice or estimate on this beat ('' when none). */
  answer: string;
  onAnswer: (value: string) => void;
  cite: CiteProps;
  repairBadge: Badge | null;
  /** Link keys kept dark while an answer is open (lib/presentation.ts beatConcealed, the policy shared with the lesson). */
  concealed: ReadonlySet<string>;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

type KindOf<K extends Beat['kind']> = Extract<Beat, { kind: K }>;
interface AskProps<K extends Beat['kind']> { beat: KindOf<K>; step: number; answer: string; onAnswer: (value: string) => void }

/**
 * The page's own words printed in a beat's body (only the which-came-first pair, one quote under each event). Every other
 * page quote — hovered, pinned or revealed — appears in the one quote zone under the slide (PresentationMode).
 */
function PageWords({ sourceId, quote, caption = 'The page says' }: { sourceId: string; quote: string; caption?: string }) {
  return (
    <Linked as="figure" className="pz-words" links={[linkKey(sourceId, quote)]}>
      <figcaption>{caption}</figcaption>
      <blockquote>“{quote}”</blockquote>
    </Linked>
  );
}

// ---- title ----------------------------------------------------------------------------------------------------------

function TitleBeat({ deck }: Pick<BeatProps, 'deck'>) {
  const card = titleCard(deck.source);
  return (
    <div className="pz-title">
      <h1 className="pz-display">{aiLabel(deck.headline)}</h1>
      {card !== null && (
        <dl className="pz-facts">
          <div><dt>Page</dt><dd>{card.name}</dd></div>
          {card.from !== null && <div><dt>From</dt><dd>{card.from}</dd></div>}
          <div><dt>Licence</dt><dd>{card.licence}</dd></div>
        </dl>
      )}
      <p className="pz-honest"><strong>{deck.review === undefined ? REVIEW_STATUS : reviewedStatus(deck.review)}</strong> · {withoutReviewNote(deck.disclosure)}</p>
    </div>
  );
}

// ---- overview, terms, objectives --------------------------------------------------------------------------------------

function OverviewBeat({ beat, step, deck }: Pick<BeatProps, 'beat' | 'step' | 'deck'>) {
  const points = useMemo(() => shownPoints(deck), [deck]);
  const shown = visibleCount(beat, step);
  return (
    <div className="pz-split">
      <header className="pz-split-head">
        {/* An AI summary is never titled as if it were the page's words (P11): those appear only in the quote zone. */}
        <h2 className="pz-heading">{SUMMARY_HEADING}</h2>
        {/* The lesson's own headline leads the key points (never Muse's internal page-coverage note). */}
        <p className="pz-lead">{aiLabel(deck.headline)}</p>
        <p className="pz-note">{SUMMARY_NOTE}</p>
      </header>
      <ul className={`pz-points${points.length > 4 ? ' pz-dense' : ''}`}>
        {points.map((p, i) => (
          <Linked as="li" key={p.id} links={linkKeysOf([p])} data-shown={i < shown ? 'true' : 'false'} aria-hidden={i < shown ? undefined : true}>
            {p.point}
          </Linked>
        ))}
      </ul>
    </div>
  );
}

function TermsBeat({ beat, step, deck, concealed }: Pick<BeatProps, 'beat' | 'step' | 'deck' | 'concealed'>) {
  const terms = useMemo(() => shownTerms(deck), [deck]);
  const shown = visibleCount(beat, step);
  return (
    <div className="pz-list-beat">
      <h2 className="pz-heading">Key terms</h2>
      <dl className={`pz-terms${terms.length > 4 ? ' pz-dense' : ''}`}>
        {terms.map((t, i) => (
          // A meaning not shown yet keeps its sentence dark: hovering the term must not answer it (W2-02).
          <Linked key={t.id} className="pz-term" links={linksUnlessConcealed(t, concealed)}>
            <dt>{t.term}</dt>
            {/* The meaning is laid out from the start (hidden), so showing it never moves the terms below. */}
            <dd data-shown={i < shown ? 'true' : 'false'}>
              <span className="pz-gloss" aria-hidden={i < shown ? undefined : true}>{t.gloss}</span>
              {i >= shown && <span className="pz-pending" aria-label="Meaning not shown yet">What does it mean?</span>}
            </dd>
          </Linked>
        ))}
      </dl>
    </div>
  );
}

function ObjectivesBeat({ beat, step, deck }: Pick<BeatProps, 'beat' | 'step' | 'deck'>) {
  const shown = visibleCount(beat, step);
  return (
    <div className="pz-split">
      <header className="pz-split-head">
        <h2 className="pz-heading">What we will find out</h2>
      </header>
      <ul className={`pz-points${deck.objectives.length > 4 ? ' pz-dense' : ''}`}>
        {deck.objectives.map((o, i) => (
          <li key={o} data-shown={i < shown ? 'true' : 'false'} aria-hidden={i < shown ? undefined : true}>{aiLabel(o)}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- choices (quiz, compare, which-came-first) --------------------------------------------------------------------------

interface ChoiceItem { value: string; text: ReactNode; right: boolean; detail?: ReactNode }

type MarkOn = 'none' | 'picked' | 'right' | 'wrong';

/**
 * Large answer options. Before the reveal a click marks the class's choice (a toggle); after it the page's answer is
 * marked, and the class's choice when it differs. Every mark is laid out from the start in one stacked cell (only the
 * current one visible) and every detail is laid out hidden, so R never moves or re-wraps an option.
 */
function Choices({ items, answer, onAnswer, revealed, label, pair = false }: { items: readonly ChoiceItem[]; answer: string; onAnswer: (v: string) => void; revealed: boolean; label: string; pair?: boolean }) {
  return (
    <ol className={`pz-choices${pair ? ' pz-pair' : ''}`} aria-label={label}>
      {items.map((it, i) => {
        const mine = answer === it.value;
        const state = !revealed ? (mine ? 'picked' : 'open') : it.right ? 'right' : mine ? 'wrong' : 'other';
        const on: MarkOn = revealed ? (it.right ? 'right' : mine ? 'wrong' : 'none') : mine ? 'picked' : 'none';
        return (
          <li key={it.value} data-state={state}>
            <button type="button" className="pz-choice" aria-pressed={mine} disabled={revealed} onClick={() => onAnswer(mine ? '' : it.value)}>
              <span className="pz-letter" aria-hidden="true">{LETTERS[i] ?? ''}</span>
              <span className="pz-choice-text">{it.text}</span>
              <span className="pz-choice-mark" data-on={on}>
                <span data-mark="right" aria-hidden={on === 'right' ? undefined : true}><Mark kind="ok" />{pair ? 'First' : 'The page’s answer'}</span>
                <span data-mark="wrong" aria-hidden={on === 'wrong' ? undefined : true}><Mark kind="bad" />Class choice</span>
                <span data-mark="picked" aria-hidden={on === 'picked' ? undefined : true}>Class choice</span>
              </span>
            </button>
            {it.detail !== undefined && <div className="pz-choice-detail" data-shown={revealed ? 'true' : 'false'} aria-hidden={revealed ? undefined : true}>{it.detail}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The line under an ask beat's options: the vote hint before R, the grade after it. Both are laid out in one stacked cell
 * from the start, so the reveal swaps the words without moving anything above.
 */
function AskFoot({ revealed, before, after = null }: { revealed: boolean; before: ReactNode; after?: ReactNode }) {
  return (
    <div className="pz-foot">
      <div data-on={revealed ? 'false' : 'true'} aria-hidden={revealed ? true : undefined}>{before}</div>
      <div data-on={revealed ? 'true' : 'false'} aria-hidden={revealed ? undefined : true}>{after}</div>
    </div>
  );
}

function QuizBeat({ beat, step, answer, onAnswer }: AskProps<'quiz'>) {
  const card = useMemo(() => quizCards(beat.spec).find((c) => c.id === beat.cardId), [beat]);
  if (card === undefined) return null;
  const revealed = isRevealed(beat, step);
  const items = card.options.map((o): ChoiceItem => ({ value: String(o.index), text: aiLabel(o.text), right: o.index === 0 }));
  // The page's sentence appears in the quote zone under the slide on R (PresentationMode), never inserted here.
  return (
    <div className="pz-ask">
      <h2 className="pz-question">{aiLabel(card.stem)}</h2>
      <Choices items={items} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Answer options" />
      <AskFoot revealed={revealed} before={<p className="pz-hint">Vote: {items.map((_, i) => LETTERS[i]).join(', ').replace(/, ([^,]*)$/, ' or $1')}?</p>} />
    </div>
  );
}

function CompareBeat({ beat, step, answer, onAnswer, concealed }: AskProps<'compare'> & { concealed: ReadonlySet<string> }) {
  const grid = useMemo(() => compareGrid(beat.spec), [beat]);
  const plan = beat.plan;
  const revealed = plan === null || isRevealed(beat, step);
  const right = plan !== null && answer !== '' && answer.trim().toLowerCase() === plan.correct.trim().toLowerCase();
  return (
    <div className="pz-ask pz-compare">
      <h2 className="pz-heading">{beat.title}</h2>
      <div className="pz-table-wrap">
        <table className="pz-table">
          <caption className="sr-only">{beat.spec.title}</caption>
          <thead>
            <tr><td /> {grid.attributes.map((a) => <th key={a} scope="col">{aiLabel(a)}</th>)}</tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.entity}>
                <th scope="row">{aiLabel(row.entity)}</th>
                {row.cells.map((cell, ai) => {
                  if (cell === null) return <td key={ai} className="pz-cell-blank">{NOT_STATED}</td>;
                  // The hidden cell keeps its value's size (laid out invisibly under the '?'), so R never moves a column.
                  if (plan !== null && cell.id === plan.cellId && !revealed) {
                    return <td key={ai} className="pz-cell-hidden"><span className="pz-cell-reserve" aria-hidden="true">{aiLabel(cell.value)}</span><span className="pz-cell-q" aria-label="Hidden until the reveal">?</span></td>;
                  }
                  const isTarget = plan !== null && cell.id === plan.cellId;
                  return (
                    // A cell whose sentence states the hidden value stays unlinked until R (W-04).
                    <Linked as="td" key={ai} className={isTarget ? (answer === '' ? 'pz-cell-revealed' : right ? 'pz-cell-right' : 'pz-cell-miss') : undefined} links={linksUnlessConcealed(cell, concealed)}>
                      {aiLabel(cell.value)}
                    </Linked>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {plan !== null && (
        <>
          <p className="pz-prompt">What does the page say for <strong>{aiLabel(beat.spec.entities[plan.entityIndex] ?? '')}</strong> · <strong>{aiLabel(beat.spec.attributes[plan.attributeIndex] ?? '')}</strong>?</p>
          <Choices items={plan.options.map((o) => ({ value: o, text: aiLabel(o), right: o === plan.correct }))} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Options for the hidden cell" />
          <AskFoot revealed={revealed} before={<p className="pz-hint">Which value is hidden?</p>} />
        </>
      )}
    </div>
  );
}

// ---- predict (engine, formula, which-came-first) --------------------------------------------------------------------

/**
 * The scene a numeric predict beat stands on, at projector scale: the lesson's own view in its presentation variant.
 * Before R it shows nothing that depends on the answer; R reveals it in the scene itself.
 */
function PredictScene({ beat, revealed, guess, cite, deck }: { beat: KindOf<'predict'>; revealed: boolean; guess: number | null; cite: CiteProps; deck: Deck }) {
  const t = beat.target;
  if (t.kind === 'timeline') return null;
  const visual = predictVisual(t);
  return (
    <StageFit width={visual === 'graph' ? PREDICT_SCENE_WIDTH : 940} contain>
      {t.kind === 'formula'
        ? <FormulaExplorerView spec={t.spec} cite={cite} presentation={{ mode: 'predict', revealed, guess }} />
        : <ActivityPanel spec={t.spec} cite={cite} disclosure={deck.disclosure} repairBadge={null} presentation={{ mode: 'predict', revealed, guess }} />}
    </StageFit>
  );
}

/** True once `on` has held for `ms` (false again as soon as it turns off). */
function useAfter(on: boolean, ms: number): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!on) { setDone(false); return undefined; }
    if (ms <= 0) { setDone(true); return undefined; }
    const id = window.setTimeout(() => setDone(true), ms);
    return () => window.clearTimeout(id);
  }, [on, ms]);
  return on && done;
}

function PredictBeat({ beat, step, answer, onAnswer, cite, deck }: AskProps<'predict'> & { cite: CiteProps; deck: Deck }) {
  const inputId = useId();
  const t = beat.target;
  const revealed = isRevealed(beat, step);
  // The scene answers first (the ball reaches the top, the point settles); then the numbers land beside it.
  const delay = useMemo(() => revealDelayMs(t), [t]);
  const landed = useAfter(revealed, delay);

  if (t.kind === 'timeline') {
    const [a, b] = t.options;
    const order = compareEvents(a, b);
    const earlierId = order === 0 ? null : order < 0 ? a.id : b.id;
    const grade = answer === '' ? null : gradePair(t.spec.simulation.events, { id: t.predictionId, prompt: t.prompt, earlierEventId: a.id, laterEventId: b.id }, answer);
    const items = t.options.map((e): ChoiceItem => {
      const q = e.evidence[0];
      return {
        value: e.id, text: aiLabel(e.label), right: e.id === earlierId,
        detail: <><p className="pz-date">{formatEventDate(e)}</p>{q !== undefined && <PageWords sourceId={q.sourceId} quote={q.quote} />}</>,
      };
    });
    return (
      <div className="pz-ask">
        <h2 className="pz-question">{aiLabel(t.prompt)}</h2>
        <Choices items={items} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Which came first" pair />
        <AskFoot
          revealed={revealed}
          before={<p className="pz-hint">Vote: A or B?</p>}
          after={earlierId === null
            ? <p className="pz-grade">The page gives the same date for both, so neither came first.</p>
            : grade !== null && grade.status === 'graded'
              ? <p className={`pz-grade ${grade.correct ? 'pz-grade-ok' : ''}`}><Mark kind={grade.correct ? 'ok' : 'bad'} />{grade.correct ? 'The class had it right.' : 'Not this time — the dates decide.'}</p>
              : null}
        />
      </div>
    );
  }

  const value = numericAnswer(t);
  const tolerance = t.kind === 'engine' ? (t.prediction as { tolerance?: number }).tolerance ?? 0 : null;
  const prompt = aiLabel(t.kind === 'engine' ? t.prediction.prompt : t.prompt);
  const unit = value?.unit ?? '';
  const verdict = landed && value !== null ? predictVerdict(value, answer, tolerance) : null;
  const release = (e: FormEvent<HTMLFormElement>): void => {
    // Enter hands the keys back to the deck, so the next R reveals.
    e.preventDefault();
    e.currentTarget.querySelector('input')?.blur();
    e.currentTarget.closest<HTMLElement>('.pz-stage-frame')?.focus({ preventScroll: true });
  };
  return (
    <div className="pz-ask pz-predict" data-visual={predictVisual(t)}>
      <h2 className="pz-question pz-question-predict">{prompt}</h2>
      <div className="pz-predict-body">
        <div className="pz-predict-scene">
          <PredictScene beat={beat} revealed={revealed} guess={parseGuess(answer)} cite={cite} deck={deck} />
        </div>
        <div className="pz-predict-side">
          <form className="pz-slot" onSubmit={release}>
            <label htmlFor={inputId} className="pz-slot-label">Class prediction</label>
            <span className="pz-slot-value">
              <input id={inputId} inputMode="decimal" autoComplete="off" placeholder="?" size={Math.max(2, answer.length)} value={answer} disabled={revealed} onChange={(e) => onAnswer(e.target.value)} />
              {unit !== '' && <span className="pz-unit">{prettyExponents(unit)}</span>}
            </span>
          </form>
          <div className="pz-slot pz-slot-answer" data-revealed={landed && value !== null ? 'true' : 'false'} role="status">
            <p className="pz-slot-label">{value === null ? 'Answer' : t.kind === 'engine' ? `Calculated · ${value.label.toLowerCase()}` : `Calculated · ${value.label}`}</p>
            {landed && value !== null
              ? <p className="pz-slot-value pz-answer-value"><span className="num">{value.display}</span>{unit !== '' && <span className="pz-unit">{prettyExponents(unit)}</span>}</p>
              : <p className="pz-slot-value pz-slot-hidden" aria-label="Hidden until the reveal">?</p>}
          </div>
          {/* The lesson's feedback voice (lib/feedback.ts): one headline and one line, three levels. */}
          {verdict !== null && (
            <p className={`pz-grade pz-verdict${verdict.within ? ' pz-grade-ok' : ''}`} data-level={verdict.level} aria-label={verdict.text}>
              {verdict.level === 'close' ? <span className="mark pz-mark-none" aria-hidden="true" /> : <Mark kind={verdict.within ? 'ok' : 'bad'} />}
              <strong>{verdict.headline}</strong>
              <span className="pz-verdict-detail">{verdict.detail}</span>
            </p>
          )}
          {landed && value !== null && verdict === null && <p className="pz-grade pz-verdict">No class prediction was entered.</p>}
          {landed && value !== null
            ? <p className="pz-fine">{targetRule()}</p>
            : !revealed && <p className="pz-hint">Write your estimate down first. Type the class number, then <kbd>R</kbd>.</p>}
        </div>
      </div>
    </div>
  );
}

// ---- interactive parts at projector scale --------------------------------------------------------------------------------

/**
 * Renders the lesson's own interactive view at a fixed design width and scales it with CSS zoom to fill the stage, so
 * sliders, scenes and drag targets stay the real, tested components (hit testing follows zoom). `hero` names the part
 * that must fit on screen (e.g. a simulation's scene down to its equation); anything below it scrolls.
 */
/** The smallest scale a stage part is set at before it scrolls instead. */
const MIN_STAGE_ZOOM = 0.85;
/**
 * The largest scale a stage part is set at. High enough that a QHD projector (2560×1440, a stage about 2.3× the design
 * width) is filled by the part rather than leaving its lower third empty; a part still never grows past the stage.
 */
const MAX_STAGE_ZOOM = 2.6;
/** The sequence board with its reserved answers fits a 1366×768 slide at ~0.8 rather than scrolling its last card. */
const MIN_SEQUENCE_ZOOM = 0.75;

function StageFit({ children, width = 980, hero, follow, contain = false, frozen = false, minZoom = MIN_STAGE_ZOOM }: {
  children: ReactNode; width?: number; hero?: string; follow?: string; contain?: boolean;
  /** Fit once per stage size: the part's own changes (a step, a reveal) never rescale it. */
  frozen?: boolean;
  /** The smallest scale before the part scrolls instead (not used with `contain`). */
  minZoom?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const followed = useRef(false);
  // Once the class has used the part (a click or key inside it), its own growth — a sequence's answers after "Check
  // order" — no longer rescales it: the part keeps its size and the new content extends below (the stage scrolls). Only a
  // new stage size, or a part that names an answer to follow, refits.
  const touched = useRef(false);
  const lastOuter = useRef('');
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return undefined;
    const fit = (): void => {
      // offset size: a scrollbar appearing when the part grows is not a new stage size.
      const size = `${o.offsetWidth}x${o.offsetHeight}`;
      if ((touched.current || frozen) && follow === undefined && size === lastOuter.current) return;
      lastOuter.current = size;
      const natural = i.offsetHeight;
      if (natural <= 0) return;
      const box = i.getBoundingClientRect();
      const current = box.height / natural;
      // Once the part reveals its answer further down (a timeline after "Check order"), that answer becomes what must fit.
      const target = follow === undefined ? null : i.querySelector<HTMLElement>(follow);
      const marker = target ?? (hero === undefined ? null : i.querySelector(hero));
      const heroNeeded = marker === null ? natural : (marker.getBoundingClientRect().bottom - box.top) / current;
      // A hero that is (nearly) the whole part: fit the whole part, so its bottom padding never adds a scrollbar.
      const needed = target !== null ? target.offsetHeight + 16 : natural - heroNeeded <= 16 ? natural : heroNeeded;
      const byWidth = o.clientWidth / width;
      // A few pixels of slack: the zoomed part rounds up, and a 5 px overflow would still show a scrollbar.
      const byHeight = Math.max(1, o.clientHeight - 6) / Math.max(1, needed);
      // Fill the stage; a part taller than the stage shrinks to fit, but not below 85% of its own size (past that it
      // scrolls: the quote zone under every slide takes some height, and a little smaller beats a cut-off graph).
      // `contain` (a predict beat's scene): always the whole part on screen, shrinking below its own size if it must.
      const next = contain ? Math.min(byWidth, byHeight, MAX_STAGE_ZOOM) : Math.max(Math.min(byWidth, minZoom), Math.min(byWidth, byHeight, MAX_STAGE_ZOOM));
      // Measuring the zoomed part rounds to device pixels, so each rescale can measure a hair differently and flip the
      // scale back and forth every frame (a visible vibration at some window sizes). Ignore changes under 0.5%.
      // A frozen part is fitted once per stage size (the early return above), so it cannot feed back into itself: it takes
      // the exact fit. The dead band there could keep a scale up to 0.5% too large after a resize and clip the part's edge
      // (6 px of the diagram slide at 2560×1440 after a resize from 1920).
      setZoom((prev) => (frozen && follow === undefined ? next : settleZoom(prev, next)));
      if (target !== null && !followed.current) {
        followed.current = true;
        // Bring the revealed answer up on the stage once the new zoom has applied. The stage scrolls by itself only,
        // never the page (no scrollIntoView).
        window.setTimeout(() => {
          const top = target.getBoundingClientRect().top - o.getBoundingClientRect().top + o.scrollTop;
          const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          o.scrollTo({ top: Math.max(0, top - 8), behavior: still ? 'auto' : 'smooth' });
        }, 80);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(o);
    ro.observe(i);
    return () => ro.disconnect();
  }, [width, hero, follow, contain, frozen, minZoom]);
  const touch = (): void => { touched.current = true; };
  return (
    <div ref={outer} className="pz-fit" onPointerDownCapture={touch} onKeyDownCapture={touch}>
      <div className="pz-fit-zoom" style={{ zoom }}>
        <div ref={inner} className="pz-fit-inner" style={{ width }}>{children}</div>
      </div>
    </div>
  );
}

function KitPart({ spec, cite }: { spec: KitSpec; cite: CiteProps }) {
  switch (spec.componentId) {
    case 'sequence-v1': return <SequenceView spec={spec} cite={cite} presentation={{ mode: 'stage' }} />;
    case 'sort-groups-v1': return <SortView spec={spec} cite={cite} />;
    case 'concept-map-v1': return <ConceptMapView spec={spec} cite={cite} />;
    case 'formula-explorer-v1': return <FormulaExplorerView spec={spec} cite={cite} presentation={{ mode: 'stage' }} />;
    case 'balance-equation-v1': return <BalanceView spec={spec} cite={cite} />;
    case 'compare-table-v1': return <CompareView spec={spec} cite={cite} />;
    case 'quiz-cards-v1': return <QuizCardsView spec={spec} cite={cite} />;
    // The four Stage 8a engines are engine beats (EngineBeat below), never plain stage beats.
    default: return null;
  }
}

/** A Stage 8a engine view at projector scale, told which presenter step it is on and whether R revealed it. */
function EnginePart({ spec, cite, presentation }: { spec: EngineSpec; cite: CiteProps; presentation: EnginePresentation }) {
  switch (spec.componentId) {
    case 'algorithm-trace-v1': return <AlgorithmTraceView spec={spec} cite={cite} presentation={presentation} />;
    case 'log-ladder-v1': return <LogLadderView spec={spec} cite={cite} presentation={presentation} />;
    case 'threshold-v1': return <ThresholdView spec={spec} cite={cite} presentation={presentation} />;
    case 'data-table-v1': return <DataTableView spec={spec} cite={cite} presentation={presentation} />;
    case 'label-diagram-v1': return <LabelDiagramView spec={spec} cite={cite} presentation={presentation} />;
  }
}

/**
 * One engine part as one beat: → walks its steps (each a question), R reveals the current one. The whole part is kept on
 * screen (`contain`) and fitted once, so neither a step nor a reveal rescales or moves it.
 */
function EngineBeat({ beat, step, revealed, cite }: { beat: KindOf<'engine'>; step: number; revealed: boolean; cite: CiteProps }) {
  const spec = beat.part.spec;
  const presentation = useMemo(() => engineStage(beat, { step, revealed }), [beat, step, revealed]);
  if (spec.componentId === 'label-diagram-v1') {
    // The diagram slide (UX pair review 2, H5): the heading sits over the side column inside the fitted part, so the
    // figure runs the full stage height; the design width matches the stage's shape (lib/presentation.ts), so the part
    // is scaled by the height. Fitted once (frozen), as every engine beat: → and R never rescale it.
    return (
      <div className="pz-stage pz-engine pz-diagram" data-part={spec.componentId}>
        <StageFit key={spec.id} width={diagramStageWidth(spec.figure)} contain frozen>
          <div className="pz-diagram-layout">
            <h2 className="pz-diagram-heading">{beat.title}</h2>
            <LabelDiagramView spec={spec} cite={cite} presentation={presentation} />
          </div>
        </StageFit>
      </div>
    );
  }
  return (
    <div className="pz-stage pz-engine" data-part={spec.componentId}>
      <h2 className="pz-heading">{beat.title}</h2>
      <StageFit key={spec.id} width={ENGINE_WIDTH[spec.componentId]} contain frozen>
        <EnginePart spec={spec} cite={cite} presentation={presentation} />
      </StageFit>
    </div>
  );
}

/**
 * Design width each engine is laid out at before it is scaled to the stage. Each is chosen so the part's own shape is
 * close to the stage's (about 2.4 : 1 on a 16:9 screen once the heading and the quote band are taken), so it fills the
 * slide in both directions instead of leaving the right or the bottom third empty.
 */
const ENGINE_WIDTH: Readonly<Record<EngineSpec['componentId'], number>> = {
  'algorithm-trace-v1': 1040, 'log-ladder-v1': 1140, 'threshold-v1': 920, 'data-table-v1': 1180,
  // Not used: the diagram slide's width comes from its figure (diagramStageWidth).
  'label-diagram-v1': 1040,
};

function StageBeat({ beat, cite, deck, repairBadge }: { beat: KindOf<'stage'>; cite: CiteProps; deck: Deck; repairBadge: Badge | null }) {
  const part: DeckPart = beat.part;
  return (
    <div className="pz-stage" data-part={part.kind === 'kit' ? part.spec.componentId : 'activity'}>
      <h2 className="pz-heading">{beat.title}</h2>
      <StageFit
        // The explorer has its own slide layout (formula and sliders beside a large graph, lib/explorer STAGE_LAYOUT), fitted whole.
        hero={part.kind === 'activity' ? '.eq-line' : undefined}
        width={part.kind === 'kit' && part.spec.componentId === 'formula-explorer-v1' ? STAGE_LAYOUT.width : undefined}
        follow={part.kind === 'activity' ? '[data-pz-follow]' : undefined}
        minZoom={part.kind === 'kit' && part.spec.componentId === 'sequence-v1' ? MIN_SEQUENCE_ZOOM : undefined}
        // The sequence board reserves its answers' room (OrderBoard reserve), so it is fitted once: "Check order" never rescales it.
        frozen={part.kind === 'kit' && part.spec.componentId === 'sequence-v1'}
      >
        {part.kind === 'activity'
          ? <ActivityPanel key={part.spec.id} spec={part.spec} cite={cite} disclosure={deck.disclosure} repairBadge={repairBadge} presentation={{ mode: 'stage' }} />
          : <KitPart key={part.spec.id} spec={part.spec} cite={cite} />}
      </StageFit>
    </div>
  );
}

// ---- closing ----------------------------------------------------------------------------------------------------------

function ClosingBeat({ deck, beats }: Pick<BeatProps, 'deck' | 'beats'>) {
  const card = titleCard(deck.source);
  const quotes = useMemo(() => deckQuotes(beats), [beats]);
  const checks = checksLine(deck.checks, deck.quotes);
  const leftOut = leftOutLine(deck.leftOut);
  const shown = quotes.slice(0, CLOSING_QUOTES);
  return (
    <div className="pz-closing">
      <h2 className="pz-display pz-display-2">Where this came from</h2>
      <div className="pz-closing-grid">
        <section aria-label="Source page" className="pz-closing-source">
          {card !== null ? (
            <>
              <p className="pz-closing-label">The page</p>
              <p className="pz-closing-name">{card.name}</p>
              {card.from !== null && <p>{card.from}</p>}
              <p className="pz-muted">Licence: {card.licence}</p>
              {deck.source !== null && /^https?:\/\//.test(deck.source.locator) && <p className="pz-url">{deck.source.locator}</p>}
            </>
          ) : <p className="pz-muted">No source information was recorded.</p>}
        </section>
        <section aria-label="Quotes used" className="pz-closing-quotes">
          <p className="pz-closing-label">{shown.length === 0 ? 'The lesson quotes nothing from the page.' : 'In the page’s own words'}</p>
          <ul>
            {shown.map((q) => <li key={linkKey(q.sourceId, q.quote)}><blockquote>“{q.quote}”</blockquote></li>)}
          </ul>
        </section>
      </div>
      <p className="pz-calm">{checks !== null && <Mark kind="ok" />}{[checks, deck.review === undefined ? REVIEW_STATUS : reviewedStatus(deck.review)].filter((s) => s !== null).join(' · ')}</p>
      {leftOut !== null && <p className="pz-calm pz-muted">{leftOut}</p>}
      <p className="pz-fine">{withoutReviewNote(deck.disclosure)}</p>
    </div>
  );
}

/** One beat's content. */
export function BeatView(p: BeatProps) {
  switch (p.beat.kind) {
    case 'title': return <TitleBeat deck={p.deck} />;
    case 'overview': return <OverviewBeat beat={p.beat} step={p.step} deck={p.deck} />;
    case 'terms': return <TermsBeat beat={p.beat} step={p.step} deck={p.deck} concealed={p.concealed} />;
    case 'objectives': return <ObjectivesBeat beat={p.beat} step={p.step} deck={p.deck} />;
    case 'quiz': return <QuizBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} />;
    case 'compare': return <CompareBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} concealed={p.concealed} />;
    case 'predict': return <PredictBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} cite={p.cite} deck={p.deck} />;
    case 'stage': return <StageBeat beat={p.beat} cite={p.cite} deck={p.deck} repairBadge={p.repairBadge} />;
    case 'engine': return <EngineBeat beat={p.beat} step={p.step} revealed={p.revealed} cite={p.cite} />;
    case 'closing': return <ClosingBeat deck={p.deck} beats={p.beats} />;
  }
}
