import { Component, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ErrorInfo, ReactNode } from 'react';
import type { KitSpec, LessonSpec, PlanComponentId, SourceAnalysisV2 } from '../../../../packages/contracts/kit.ts';
import type { SourceRef } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import type { AnyActivitySpec } from '../lib/timeline.ts';
import { declineText, lessonCards, lessonItems } from '../lib/lesson.ts';
import { sourceLicenseText } from '../lib/sources.ts';
import type { ReportLike } from '../lib/failures.ts';
import { heldBackChecks } from '../lib/lessonJob.ts';
import type { LessonCard, LessonItem, PendingSlot } from '../lib/lesson.ts';
import { activityFirst, buildingOrder, partCounts } from '../lib/partOrder.ts';
import { NOTES_ONLY_LINE } from '../lib/presentation.ts';
import { peekPartFocus, takePartFocus } from '../lib/review.ts';
import { reviewOfLesson } from '../lib/reviewState.ts';
import { revealInPanels } from '../lib/scroll.ts';
import { LessonPartsContext, LessonReviewContext } from './LessonPartsContext.ts';
import { ActivityPanel } from './ActivityPanel.tsx';
import { AlgorithmTraceView } from './AlgorithmTraceView.tsx';
import { BalanceView } from './BalanceView.tsx';
import { DataTableView } from './DataTableView.tsx';
import { LabelDiagramView } from './LabelDiagramView.tsx';
import { LogLadderView } from './LogLadderView.tsx';
import { ThresholdView } from './ThresholdView.tsx';
import { CompareView } from './CompareView.tsx';
import { ConceptMapView } from './ConceptMapView.tsx';
import { AiWritten } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { FormulaExplorerView } from './FormulaExplorerView.tsx';
import { KitCard, LeftOutNotice } from './KitCard.tsx';
import { OverviewView } from './OverviewView.tsx';
import { PendingCard } from './PendingCard.tsx';
import { BuildTrace, LiveBar, OverviewSlot, PartFrame, useFollowBuild } from './LiveBuild.tsx';
import type { LiveContext } from './LiveBuild.tsx';
import { IconPresent } from './presentation/icons.tsx';
import { QuizCardsView } from './QuizCardsView.tsx';
import { SequenceView } from './SequenceView.tsx';
import { SortView } from './SortView.tsx';
import '../styles/lesson-b.css';
import '../styles/review.css';

const NO_REPORTS: Readonly<Record<string, ReportLike>> = {};

export interface LessonViewProps {
  lesson: LessonSpec;
  /** Stored kit specs by spec id (`jobId:componentId:rN`). */
  specs: Readonly<Record<string, KitSpec>>;
  /** The v2 analysis: its decline fields drive the decline card (its page-coverage note only under technical details). Null when not loaded. */
  analysis: SourceAnalysisV2 | null;
  /** The lesson’s sources, for the decline card’s attribution. */
  sources: readonly SourceRef[];
  cite: CiteProps;
  /** AI-disclosure wording for this source kind (disclosureText). */
  disclosure: string;
  /** The one provenance line under the lesson title (who wrote it, checks, teacher review, repairs). */
  provenance?: ReactNode;
  /** Title when the lesson has no overview headline yet (the source page title). */
  fallbackTitle?: string;
  /** The premium activity (simulation or timeline) when the plan includes one; mounted through the existing ActivityPanel. */
  premium?: AnyActivitySpec | null;
  repairBadge?: Badge | null;
  /** Components that are planned but not ready yet (placeholders). Absent for a finished or recorded lesson. */
  pending?: readonly PendingSlot[];
  /** Plan order of the components, so each placeholder and each finished card sits in its place. */
  order?: readonly PlanComponentId[];
  /** Stage 7e: each part's last validation report by spec id (lib/failures.ts partReports), so a failed part can say what its repair tried. */
  reports?: Readonly<Record<string, ReportLike>>;
  /** Stage 9: present while this view is watching the job build (live or a labelled replay); absent for a stored lesson at rest. */
  live?: LiveContext | null;
}

// ---- a render error in one component must not take the lesson down -------------------------------------------------

class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo): void { console.error('Lesson component error', error.message, info.componentStack); }
  override render(): ReactNode {
    if (this.state.failed) return <p className="callout callout-error small" role="alert">This part could not be shown. The rest of the lesson is unaffected.</p>;
    return this.props.children;
  }
}

function KitBody({ spec, cite, building = false }: { spec: KitSpec; cite: CiteProps; building?: boolean }) {
  switch (spec.componentId) {
    case 'quiz-cards-v1': return <QuizCardsView spec={spec} cite={cite} />;
    case 'sequence-v1': return <SequenceView spec={spec} cite={cite} />;
    case 'sort-groups-v1': return <SortView spec={spec} cite={cite} />;
    case 'concept-map-v1': return <ConceptMapView spec={spec} cite={cite} />;
    case 'compare-table-v1': return <CompareView spec={spec} cite={cite} />;
    case 'formula-explorer-v1': return <FormulaExplorerView spec={spec} cite={cite} />;
    case 'balance-equation-v1': return <BalanceView spec={spec} cite={cite} />;
    case 'algorithm-trace-v1': return <AlgorithmTraceView spec={spec} cite={cite} />;
    case 'log-ladder-v1': return <LogLadderView spec={spec} cite={cite} />;
    case 'threshold-v1': return <ThresholdView spec={spec} cite={cite} />;
    case 'data-table-v1': return <DataTableView spec={spec} cite={cite} />;
    case 'label-diagram-v1': return <LabelDiagramView spec={spec} cite={cite} build={building} />;
    default: return null;
  }
}

/** Shown instead of a lesson when the analysis declined the page: what it covers, why nothing was built, and where it came from. */
export function DeclineCard({ analysis, sources, disclosure }: { analysis: SourceAnalysisV2; sources: readonly SourceRef[]; disclosure: string }) {
  const headId = useId();
  return (
    <section className="outcome outcome-declined" aria-labelledby={headId} data-testid="decline-card">
      <h2 id={headId}>No lesson was built from this page</h2>
      <p className="decline-reason">{declineText(analysis.declineCode)}</p>
      {analysis.declineSummary !== '' && (
        <figure className="decline-summary">
          <blockquote>{analysis.declineSummary}</blockquote>
          <figcaption className="small muted"><AiWritten extra="Muse Spark’s reading of the page" /> — {disclosure}</figcaption>
        </figure>
      )}
      <dl className="decline-facts">
        <div>
          <dt>Source</dt>
          <dd>
            {sources.length === 0 && <span className="muted">No source information was recorded.</span>}
            {sources.map((s) => (
              <span key={s.id} className="decline-source">
                <strong>{s.title}</strong>
                <span className="muted small">Licence: {sourceLicenseText(s)}</span>
                <span className="small decline-attribution">{s.attribution}</span>
              </span>
            ))}
          </dd>
        </div>
      </dl>
      <p className="muted">Nothing was generated from this page, so there is nothing to review. A longer page with running text usually works.</p>
      {analysis.pageCoverage !== '' && (
        // Muse's internal note on what the page covers: kept for the technical record, not shown as lesson content.
        <details className="small tech-details">
          <summary>Technical details</summary>
          <p><span className="muted">Muse’s page-coverage note:</span> {analysis.pageCoverage}</p>
        </details>
      )}
    </section>
  );
}

function PremiumCard({ card, premium, cite, disclosure, repairBadge }: { card: LessonCard; premium: AnyActivitySpec; cite: CiteProps; disclosure: string; repairBadge: Badge | null }) {
  return (
    <section className="lesson-premium" aria-label={card.label} data-component={card.componentId} data-status="passed">
      <ActivityPanel key={premium.id} spec={premium} cite={cite} disclosure={disclosure} repairBadge={repairBadge} />
    </section>
  );
}

/**
 * Stage 9: the title while the view watches a build. Muse's headline replaces the page title; the box never gets shorter
 * than the tallest title it has held (the text sits at its foot), so the lines under it never move up when a shorter
 * headline arrives. Keyed by its text, so the new title fades in rather than snapping.
 */
function LiveTitle({ title }: { title: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [tallest, setTallest] = useState(0);
  useLayoutEffect(() => {
    const h = textRef.current?.getBoundingClientRect().height ?? 0;
    if (h > tallest) setTallest(h);
  });
  return (
    <h2 className="lesson-title lb-title" tabIndex={-1} style={tallest > 0 ? { minBlockSize: tallest } : undefined}>
      <span key={title} ref={textRef} className="lb-title-text">{title}</span>
    </h2>
  );
}

/** Set A: today's failed checks of a part the API's re-check withheld (null for every other part). */
function heldBackOf(lesson: LessonSpec, card: LessonCard): ReturnType<typeof heldBackChecks> {
  const entry = lesson.components.find((c) => `${c.componentId}:${c.specId}` === card.key);
  return entry === undefined ? null : heldBackChecks(entry);
}

/** Stage 9: a part that arrives while the view is watching the build reveals itself; a lesson at rest renders as before. */
function Arrival({ live, index, children }: { live: boolean; index: number; children: ReactNode }) {
  if (!live) return <>{children}</>;
  return <div className="lb-arrive" style={{ '--i': index } as CSSProperties}>{children}</div>;
}

/**
 * One lesson: its title, the status line and one provenance sentence, then (Set B) the most visual checked part with its
 * first question, the overview as "Lesson notes", the other working parts in plan order, and one compact notice for the
 * parts left out. While a build is watched the plan order is kept, overview first, so nothing jumps as parts arrive.
 * A declined page shows the decline card instead. A part that did not pass shows only its message, never its content.
 */
export function LessonView({ lesson, specs, analysis, sources, cite, disclosure, provenance = null, fallbackTitle = 'Lesson', premium = null, repairBadge = null, pending = [], order = [], reports = NO_REPORTS, live = null }: LessonViewProps) {
  const declined = analysis !== null && !analysis.usable;
  const liveClass = live === null ? 'lesson' : 'lesson is-live';
  const rootRef = useRef<HTMLDivElement>(null);
  const cards = lessonCards(lesson, specs, premium !== null, reports);
  const items = lessonItems(cards, pending, order);
  // Stage 9b: while watching a build, keep the part where something is happening in view (until the user scrolls).
  const arrived = items.flatMap((it) => (it.kind === 'card' ? [it.card.componentId as string] : []));
  useFollowBuild(rootRef, live, arrived, order);
  // Stage 10b: "Open" on the Review page brings the lesson up scrolled to that part (taken once, so a later visit starts at the top).
  useEffect(() => {
    if (peekPartFocus() === null) return undefined;
    const timer = window.setTimeout(() => {
      const id = takePartFocus();
      if (id === null) return;
      const part = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-component]') ?? []).find((el) => el.dataset.component === id);
      if (part === undefined) return;
      revealInPanels(part, 'start', 16);
      part.setAttribute('data-review-target', 'true');
      window.setTimeout(() => part.removeAttribute('data-review-target'), 2400);
    }, 80);
    return () => window.clearTimeout(timer);
  }, []);
  if (declined) {
    return (
      <div className={liveClass} data-testid="lesson" ref={rootRef}>
        {live !== null && <LiveBar live={live} />}
        <div className="lb-arrive"><DeclineCard analysis={analysis} sources={sources} disclosure={disclosure} /></div>
      </div>
    );
  }

  const empty = lesson.overview === null && items.length === 0;
  const title = lesson.overview?.headline ?? fallbackTitle;
  const atRest = live === null;
  const layout = atRest ? activityFirst(items) : null;
  const counts = atRest ? partCounts(cards) : null;
  // Every planned part held back or unverified: the lesson is its notes, and says so once (not only "2 held back").
  const notesOnly = counts !== null && counts.ready === 0 && counts.heldBack > 0;
  const heldBack = (card: LessonCard): ReturnType<typeof heldBackOf> => heldBackOf(lesson, card);
  const renderItem = (item: LessonItem, i: number): ReactNode => (
    item.kind === 'pending'
      ? (live !== null
        ? <PartFrame key={`pending:${item.slot.componentId}`} slot={item.slot} build={live.builds[item.slot.componentId]} clock={live.clock} />
        : <PendingCard key={`pending:${item.slot.componentId}`} slot={item.slot} />)
      : (
        <CardBoundary key={item.card.key}>
          <Arrival live={live !== null} index={i}>
            {item.card.premium && item.card.status === 'passed' && premium !== null
              ? <PremiumCard card={item.card} premium={premium} cite={cite} disclosure={disclosure} repairBadge={repairBadge} />
              : (
                <KitCard card={item.card} heldBack={heldBack(item.card)} trace={live === null ? null : <BuildTrace build={live.builds[item.card.componentId]} />}>
                  {item.card.spec !== null && <KitBody spec={item.card.spec} cite={cite} building={live !== null} />}
                </KitCard>
              )}
          </Arrival>
        </CardBoundary>
      )
  );
  const notes = lesson.overview !== null && <CardBoundary><OverviewView overview={lesson.overview} live={live !== null} notes={atRest} /></CardBoundary>;
  return (
    <LessonReviewContext.Provider value={reviewOfLesson(lesson)}>
    <LessonPartsContext.Provider value={counts}>
    <div className={liveClass} data-testid="lesson" ref={rootRef}>
      {live !== null && <LiveBar live={live} />}
      <header className="lesson-head">
        {/* Keyed by its text, so Muse's headline replacing the page title fades in rather than snapping. */}
        {/* tabIndex -1: the app moves focus here after the tour closes (no ring round the whole column). */}
        {live === null ? <h2 className="lesson-title" tabIndex={-1}>{title}</h2> : <LiveTitle title={title} />}
        {/* While building: an invisible twin of the Present button holds its column, so the title never rewraps when it appears. */}
        {live !== null && <span className="btn present-launch lb-present-slot" aria-hidden="true"><IconPresent size={18} />Present</span>}
        {provenance}
        {notesOnly && <p className="notes-only" role="note" data-testid="notes-only"><strong>{NOTES_ONLY_LINE.slice(0, NOTES_ONLY_LINE.indexOf(':') + 1)}</strong>{NOTES_ONLY_LINE.slice(NOTES_ONLY_LINE.indexOf(':') + 1)}</p>}
      </header>
      {!atRest && notes}
      {lesson.overview === null && live !== null && !live.strip.finished && <OverviewSlot words={live.sourceWords} />}
      {empty && live === null && (
        <div className="empty" role="status">
          <h2>This lesson has nothing to show yet</h2>
          <p className="muted">No overview and no parts were stored for this run.</p>
        </div>
      )}
      {layout === null
        ? buildingOrder(items).map(renderItem)
        : (
          <>
            {layout.lead !== null && renderItem(layout.lead, 0)}
            {notes}
            {layout.rest.map((item, i) => renderItem(item, i + 1))}
            <LeftOutNotice cards={layout.leftOut} heldBackOf={heldBack} />
          </>
        )}
    </div>
    </LessonPartsContext.Provider>
    </LessonReviewContext.Provider>
  );
}
