import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { KitSpec } from '../../../../../packages/contracts/kit.ts';
import type { Badge } from '../../lib/repairs.ts';
import type { Beat, Deck, DeckPart, NumericAnswer } from '../../lib/presentation.ts';
import { checksLine, deckQuotes, isRevealed, leftOutLine, numericAnswer, predictVerdict, predictVisual, revealDelayMs, titleCard, visibleCount } from '../../lib/presentation.ts';
import { prettyExponents } from '../../lib/displayText.ts';
import { REVIEW_STATUS, withoutReviewNote } from '../../lib/provenance.ts';
import { quizCards } from '../../lib/quiz.ts';
import { compareGrid, NOT_STATED } from '../../lib/compare.ts';
import { parseGuess } from '../../lib/predictions.ts';
import { compareEvents, formatEventDate, gradePair } from '../../lib/timeline.ts';
import { linkKey, linkKeysOf } from '../../lib/linking.ts';
import { ActivityPanel } from '../ActivityPanel.tsx';
import { BalanceView } from '../BalanceView.tsx';
import { ConceptMapView } from '../ConceptMapView.tsx';
import { FormulaExplorerView } from '../FormulaExplorerView.tsx';
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
  deck: Deck;
  beats: readonly Beat[];
  /** The class's choice or estimate on this beat ('' when none). */
  answer: string;
  onAnswer: (value: string) => void;
  cite: CiteProps;
  repairBadge: Badge | null;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

type KindOf<K extends Beat['kind']> = Extract<Beat, { kind: K }>;
interface AskProps<K extends Beat['kind']> { beat: KindOf<K>; step: number; answer: string; onAnswer: (value: string) => void }

/** The page's own words, shown with a reveal: one quote, linked so hovering it lights the same words elsewhere. */
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
      <h1 className="pz-display">{prettyExponents(deck.headline)}</h1>
      {card !== null && (
        <dl className="pz-facts">
          <div><dt>Page</dt><dd>{card.name}</dd></div>
          {card.from !== null && <div><dt>From</dt><dd>{card.from}</dd></div>}
          <div><dt>Licence</dt><dd>{card.licence}</dd></div>
        </dl>
      )}
      <p className="pz-honest"><strong>{REVIEW_STATUS}</strong> · {withoutReviewNote(deck.disclosure)}</p>
    </div>
  );
}

// ---- overview, terms, objectives --------------------------------------------------------------------------------------

function OverviewBeat({ beat, step, deck }: Pick<BeatProps, 'beat' | 'step' | 'deck'>) {
  const points = deck.overview?.keyPoints ?? [];
  const shown = visibleCount(beat, step);
  return (
    <div className="pz-split">
      <header className="pz-split-head">
        <h2 className="pz-heading">What the page says</h2>
        {deck.overview !== null && deck.overview.coverage !== '' && <p className="pz-lead">{deck.overview.coverage}</p>}
      </header>
      <ul className={`pz-points${points.length > 4 ? ' pz-dense' : ''}`}>
        {points.map((p, i) => (
          <Linked as="li" key={p.id} links={linkKeysOf([p])} data-shown={i < shown ? 'true' : 'false'} aria-hidden={i < shown ? undefined : true}>
            {prettyExponents(p.point)}
          </Linked>
        ))}
      </ul>
    </div>
  );
}

function TermsBeat({ beat, step, deck }: Pick<BeatProps, 'beat' | 'step' | 'deck'>) {
  const terms = deck.overview?.keyTerms ?? [];
  const shown = visibleCount(beat, step);
  return (
    <div className="pz-list-beat">
      <h2 className="pz-heading">Key terms</h2>
      <dl className={`pz-terms${terms.length > 4 ? ' pz-dense' : ''}`}>
        {terms.map((t, i) => (
          <Linked key={t.id} className="pz-term" links={linkKeysOf([t])}>
            <dt>{prettyExponents(t.term)}</dt>
            <dd data-shown={i < shown ? 'true' : 'false'}>
              {i < shown ? prettyExponents(t.gloss) : <span className="pz-pending" aria-label="Meaning not shown yet">What does it mean?</span>}
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
          <li key={o} data-shown={i < shown ? 'true' : 'false'} aria-hidden={i < shown ? undefined : true}>{prettyExponents(o)}</li>
        ))}
      </ul>
    </div>
  );
}

// ---- choices (quiz, compare, which-came-first) --------------------------------------------------------------------------

interface ChoiceItem { value: string; text: ReactNode; right: boolean; detail?: ReactNode }

/**
 * Large answer options. Before the reveal a click marks the class's choice (a toggle); after it the page's answer is
 * marked, and the class's choice when it differs.
 */
function Choices({ items, answer, onAnswer, revealed, label, pair = false }: { items: readonly ChoiceItem[]; answer: string; onAnswer: (v: string) => void; revealed: boolean; label: string; pair?: boolean }) {
  return (
    <ol className={`pz-choices${pair ? ' pz-pair' : ''}`} aria-label={label}>
      {items.map((it, i) => {
        const mine = answer === it.value;
        const state = !revealed ? (mine ? 'picked' : 'open') : it.right ? 'right' : mine ? 'wrong' : 'other';
        return (
          <li key={it.value} data-state={state}>
            <button type="button" className="pz-choice" aria-pressed={mine} disabled={revealed} onClick={() => onAnswer(mine ? '' : it.value)}>
              <span className="pz-letter" aria-hidden="true">{LETTERS[i] ?? ''}</span>
              <span className="pz-choice-text">{it.text}</span>
              {revealed && it.right && <span className="pz-choice-mark"><Mark kind="ok" />{pair ? 'First' : 'The page’s answer'}</span>}
              {revealed && !it.right && mine && <span className="pz-choice-mark"><Mark kind="bad" />Class choice</span>}
              {!revealed && mine && <span className="pz-choice-mark">Class choice</span>}
            </button>
            {revealed && it.detail !== undefined && <div className="pz-choice-detail">{it.detail}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function QuizBeat({ beat, step, answer, onAnswer }: AskProps<'quiz'>) {
  const card = useMemo(() => quizCards(beat.spec).find((c) => c.id === beat.cardId), [beat]);
  if (card === undefined) return null;
  const revealed = isRevealed(beat, step);
  const items = card.options.map((o): ChoiceItem => ({ value: String(o.index), text: prettyExponents(o.text), right: o.index === 0 }));
  return (
    <div className="pz-ask">
      <h2 className="pz-question">{prettyExponents(card.stem)}</h2>
      <Choices items={items} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Answer options" />
      {revealed ? <PageWords sourceId={card.sourceId} quote={card.quote} /> : <p className="pz-hint">Vote: {items.map((_, i) => LETTERS[i]).join(', ').replace(/, ([^,]*)$/, ' or $1')}?</p>}
    </div>
  );
}

function CompareBeat({ beat, step, answer, onAnswer }: AskProps<'compare'>) {
  const grid = useMemo(() => compareGrid(beat.spec), [beat]);
  const plan = beat.plan;
  const revealed = plan === null || isRevealed(beat, step);
  const hidden = plan === null ? null : beat.spec.cells.find((c) => c.id === plan.cellId) ?? null;
  const right = plan !== null && answer !== '' && answer.trim().toLowerCase() === plan.correct.trim().toLowerCase();
  return (
    <div className="pz-ask pz-compare">
      <h2 className="pz-heading">{beat.spec.title}</h2>
      <div className="pz-table-wrap">
        <table className="pz-table">
          <caption className="sr-only">{beat.spec.title}</caption>
          <thead>
            <tr><td /> {grid.attributes.map((a) => <th key={a} scope="col">{a}</th>)}</tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.entity}>
                <th scope="row">{row.entity}</th>
                {row.cells.map((cell, ai) => {
                  if (cell === null) return <td key={ai} className="pz-cell-blank">{NOT_STATED}</td>;
                  if (plan !== null && cell.id === plan.cellId && !revealed) return <td key={ai} className="pz-cell-hidden"><span aria-label="Hidden until the reveal">?</span></td>;
                  const isTarget = plan !== null && cell.id === plan.cellId;
                  return (
                    <Linked as="td" key={ai} className={isTarget ? (answer === '' ? 'pz-cell-revealed' : right ? 'pz-cell-right' : 'pz-cell-miss') : undefined} links={[linkKey(cell.sourceId, cell.quote)]}>
                      {cell.value}
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
          <p className="pz-prompt">What does the page say for <strong>{beat.spec.entities[plan.entityIndex]}</strong> · <strong>{beat.spec.attributes[plan.attributeIndex]}</strong>?</p>
          <Choices items={plan.options.map((o) => ({ value: o, text: o, right: o === plan.correct }))} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Options for the hidden cell" />
        </>
      )}
      {plan !== null && revealed && hidden !== null && <PageWords sourceId={hidden.sourceId} quote={hidden.quote} />}
      {plan !== null && !revealed && <p className="pz-hint">Which value is hidden?</p>}
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
    <StageFit width={visual === 'graph' ? 760 : 940} contain>
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
        value: e.id, text: prettyExponents(e.label), right: e.id === earlierId,
        detail: <><p className="pz-date">{formatEventDate(e)}</p>{q !== undefined && <PageWords sourceId={q.sourceId} quote={q.quote} />}</>,
      };
    });
    return (
      <div className="pz-ask">
        <h2 className="pz-question">{prettyExponents(t.prompt)}</h2>
        <Choices items={items} answer={answer} onAnswer={onAnswer} revealed={revealed} label="Which came first" pair />
        {!revealed && <p className="pz-hint">Vote: A or B?</p>}
        {revealed && earlierId === null && <p className="pz-grade">The page gives the same date for both, so neither came first.</p>}
        {revealed && grade !== null && grade.status === 'graded' && (
          <p className={`pz-grade ${grade.correct ? 'pz-grade-ok' : ''}`}><Mark kind={grade.correct ? 'ok' : 'bad'} />{grade.correct ? 'The class had it right.' : 'Not this time — the dates decide.'}</p>
        )}
      </div>
    );
  }

  const value = numericAnswer(t);
  const tolerance = t.kind === 'engine' ? (t.prediction as { tolerance?: number }).tolerance ?? 0 : null;
  const prompt = prettyExponents(t.kind === 'engine' ? t.prediction.prompt : t.prompt);
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
              <input id={inputId} inputMode="decimal" autoComplete="off" placeholder="?" size={Math.max(2, answer.length + 1)} value={answer} disabled={revealed} onChange={(e) => onAnswer(e.target.value)} />
              {unit !== '' && <span className="pz-unit">{prettyExponents(unit)}</span>}
            </span>
          </form>
          <div className="pz-slot pz-slot-answer" data-revealed={landed && value !== null ? 'true' : 'false'} role="status">
            <p className="pz-slot-label">{value === null ? 'Answer' : t.kind === 'engine' ? `Engine · ${value.label.toLowerCase()}` : `Calculator · ${value.label}`}</p>
            {landed && value !== null
              ? <p className="pz-slot-value pz-answer-value"><span className="num">{value.display}</span>{unit !== '' && <span className="pz-unit">{prettyExponents(unit)}</span>}</p>
              : <p className="pz-slot-value pz-slot-hidden" aria-label="Hidden until the reveal">?</p>}
          </div>
          {verdict !== null && (
            <p className={`pz-grade pz-verdict ${verdict.within ? 'pz-grade-ok' : ''}`} aria-label={verdict.text}>
              <Mark kind={verdict.within ? 'ok' : 'bad'} /><strong>{verdict.headline}</strong>
              <span className="pz-verdict-detail">{verdict.detail}</span>
            </p>
          )}
          {landed && value !== null && verdict === null && <p className="pz-grade pz-verdict">No class prediction was entered.</p>}
          {landed && value !== null
            ? <p className="pz-fine">Computed by code from this case’s inputs. Close means within 2% of this value.</p>
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
function StageFit({ children, width = 980, hero, follow, contain = false }: { children: ReactNode; width?: number; hero?: string; follow?: string; contain?: boolean }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const followed = useRef(false);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (o === null || i === null) return undefined;
    const fit = (): void => {
      const natural = i.offsetHeight;
      if (natural <= 0) return;
      const box = i.getBoundingClientRect();
      const current = box.height / natural;
      // Once the part reveals its answer further down (a timeline after "Check order"), that answer becomes what must fit.
      const target = follow === undefined ? null : i.querySelector<HTMLElement>(follow);
      const marker = target ?? (hero === undefined ? null : i.querySelector(hero));
      const needed = target !== null ? target.offsetHeight + 16 : marker === null ? natural : (marker.getBoundingClientRect().bottom - box.top) / current;
      const byWidth = o.clientWidth / width;
      const byHeight = o.clientHeight / Math.max(1, needed);
      // Fill the stage; a part taller than the stage shrinks to fit, but never below its own size (it scrolls instead).
      // `contain` (a predict beat's scene): always the whole part on screen, shrinking below its own size if it must.
      setZoom(contain ? Math.min(byWidth, byHeight, 1.9) : Math.max(Math.min(byWidth, 1), Math.min(byWidth, byHeight, 1.9)));
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
  }, [width, hero, follow, contain]);
  return (
    <div ref={outer} className="pz-fit">
      <div className="pz-fit-zoom" style={{ zoom }}>
        <div ref={inner} className="pz-fit-inner" style={{ width }}>{children}</div>
      </div>
    </div>
  );
}

function KitPart({ spec, cite }: { spec: KitSpec; cite: CiteProps }) {
  switch (spec.componentId) {
    case 'sequence-v1': return <SequenceView spec={spec} cite={cite} />;
    case 'sort-groups-v1': return <SortView spec={spec} cite={cite} />;
    case 'concept-map-v1': return <ConceptMapView spec={spec} cite={cite} />;
    case 'formula-explorer-v1': return <FormulaExplorerView spec={spec} cite={cite} presentation={{ mode: 'stage' }} />;
    case 'balance-equation-v1': return <BalanceView spec={spec} cite={cite} />;
    case 'compare-table-v1': return <CompareView spec={spec} cite={cite} />;
    case 'quiz-cards-v1': return <QuizCardsView spec={spec} cite={cite} />;
    default: return null;
  }
}

function StageBeat({ beat, cite, deck, repairBadge }: { beat: KindOf<'stage'>; cite: CiteProps; deck: Deck; repairBadge: Badge | null }) {
  const part: DeckPart = beat.part;
  return (
    <div className="pz-stage" data-part={part.kind === 'kit' ? part.spec.componentId : 'activity'}>
      <h2 className="pz-heading">{prettyExponents(beat.title)}</h2>
      <StageFit
        hero={part.kind === 'activity' ? '.eq-line' : part.spec.componentId === 'formula-explorer-v1' ? '.explorer-main' : undefined}
        follow={part.kind === 'activity' ? '[data-pz-follow]' : undefined}
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
  const shown = quotes.slice(0, 3);
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
      <p className="pz-calm">{checks !== null && <Mark kind="ok" />}{[checks, REVIEW_STATUS].filter((s) => s !== null).join(' · ')}</p>
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
    case 'terms': return <TermsBeat beat={p.beat} step={p.step} deck={p.deck} />;
    case 'objectives': return <ObjectivesBeat beat={p.beat} step={p.step} deck={p.deck} />;
    case 'quiz': return <QuizBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} />;
    case 'compare': return <CompareBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} />;
    case 'predict': return <PredictBeat beat={p.beat} step={p.step} answer={p.answer} onAnswer={p.onAnswer} cite={p.cite} deck={p.deck} />;
    case 'stage': return <StageBeat beat={p.beat} cite={p.cite} deck={p.deck} repairBadge={p.repairBadge} />;
    case 'closing': return <ClosingBeat deck={p.deck} beats={p.beats} />;
  }
}
