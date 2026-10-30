import { Component, useId } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import type { KitSpec, LessonSpec, PlanComponentId, SourceAnalysisV2 } from '../../../../packages/contracts/kit.ts';
import type { SourceRef } from '../../../../packages/contracts/index.ts';
import type { Badge } from '../lib/repairs.ts';
import type { AnyActivitySpec } from '../lib/timeline.ts';
import { declineText, lessonCards, lessonItems } from '../lib/lesson.ts';
import { sourceLicenseText } from '../lib/sources.ts';
import type { ReportLike } from '../lib/failures.ts';
import type { LessonCard, PendingSlot } from '../lib/lesson.ts';
import { ActivityPanel } from './ActivityPanel.tsx';
import { BalanceView } from './BalanceView.tsx';
import { CompareView } from './CompareView.tsx';
import { ConceptMapView } from './ConceptMapView.tsx';
import { AiWritten } from './Disclosure.tsx';
import type { CiteProps } from './Explanations.tsx';
import { FormulaExplorerView } from './FormulaExplorerView.tsx';
import { KitCard } from './KitCard.tsx';
import { OverviewView } from './OverviewView.tsx';
import { PendingCard } from './PendingCard.tsx';
import { QuizCardsView } from './QuizCardsView.tsx';
import { SequenceView } from './SequenceView.tsx';
import { SortView } from './SortView.tsx';

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

function KitBody({ spec, cite }: { spec: KitSpec; cite: CiteProps }) {
  switch (spec.componentId) {
    case 'quiz-cards-v1': return <QuizCardsView spec={spec} cite={cite} />;
    case 'sequence-v1': return <SequenceView spec={spec} cite={cite} />;
    case 'sort-groups-v1': return <SortView spec={spec} cite={cite} />;
    case 'concept-map-v1': return <ConceptMapView spec={spec} cite={cite} />;
    case 'compare-table-v1': return <CompareView spec={spec} cite={cite} />;
    case 'formula-explorer-v1': return <FormulaExplorerView spec={spec} cite={cite} />;
    case 'balance-equation-v1': return <BalanceView spec={spec} cite={cite} />;
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
 * One lesson: its title and the provenance line, the overview, then the parts in plan order as a vertical stack. A declined
 * page shows the decline card instead. A part that did not pass shows only its message, never its content.
 */
export function LessonView({ lesson, specs, analysis, sources, cite, disclosure, provenance = null, fallbackTitle = 'Lesson', premium = null, repairBadge = null, pending = [], order = [], reports = NO_REPORTS }: LessonViewProps) {
  const declined = analysis !== null && !analysis.usable;
  if (declined) return <div className="lesson" data-testid="lesson"><DeclineCard analysis={analysis} sources={sources} disclosure={disclosure} /></div>;

  const cards = lessonCards(lesson, specs, premium !== null, reports);
  const items = lessonItems(cards, pending, order);
  const empty = lesson.overview === null && items.length === 0;
  return (
    <div className="lesson" data-testid="lesson">
      <header className="lesson-head">
        <h2 className="lesson-title">{lesson.overview?.headline ?? fallbackTitle}</h2>
        {provenance}
      </header>
      {lesson.overview !== null && <CardBoundary><OverviewView overview={lesson.overview} /></CardBoundary>}
      {empty && (
        <div className="empty" role="status">
          <h2>This lesson has nothing to show yet</h2>
          <p className="muted">No overview and no parts were stored for this run.</p>
        </div>
      )}
      {items.map((item) => (
        item.kind === 'pending'
          ? <PendingCard key={`pending:${item.slot.componentId}`} slot={item.slot} />
          : (
            <CardBoundary key={item.card.key}>
              {item.card.premium && item.card.status === 'passed' && premium !== null
                ? <PremiumCard card={item.card} premium={premium} cite={cite} disclosure={disclosure} repairBadge={repairBadge} />
                : (
                  <KitCard card={item.card}>
                    {item.card.spec !== null && <KitBody spec={item.card.spec} cite={cite} />}
                  </KitCard>
                )}
            </CardBoundary>
          )
      ))}
    </div>
  );
}
