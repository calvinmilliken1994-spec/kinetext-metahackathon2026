import type { JobDetail, JobSummary, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { isInterrupted } from '../lib/jobs.ts';
import { buildLessonSteps } from '../lib/lessonJob.ts';
import { resolveJobModel } from '../lib/models.ts';
import { runLine } from '../lib/runs.ts';
import { filterRuns, retiredRunNote, subjectCounts, subjectLabel, subjectOf, subjectOfSource } from '../lib/subjects.ts';
import type { SubjectKey } from '../lib/subjects.ts';
import { LessonSteps } from './LessonSteps.tsx';
import { SubjectChips } from './SubjectChips.tsx';
import { Timeline } from './Timeline.tsx';

// ---- Runs for this page: one line each, details under the selected one -------------------------------------------

export type RunScope = 'page' | 'all';

export interface RunsSectionProps {
  jobs: Loadable<JobSummary[]>;
  jobsForSource: readonly JobSummary[];
  /** Stage 7b: every run, newest first (the "All pages" view). */
  allJobs: readonly JobSummary[];
  /** Page metadata by id: titles and subjects for the "All pages" view. */
  sourcesById: ReadonlyMap<string, SourceMeta>;
  scope: RunScope;
  onScope: (scope: RunScope) => void;
  /** The subject filter shared with the page pickers. */
  subjectFilter: SubjectKey | null;
  onSubjectFilter: (subject: SubjectKey | null) => void;
  /** /api/health busy (incl. a POST in flight); null until health has loaded. */
  serverBusy: boolean | null;
  selectedJobId: string | null;
  /** Select a run (and, from the "All pages" view, its page). */
  onSelectJob: (jobId: string, sourceId: string) => void;
  liveJobIds: ReadonlySet<string>;
  canGenerate: boolean;
  onNewLesson: () => void;
}

export function RunsSection(p: RunsSectionProps) {
  const all = p.scope === 'all';
  const subjectOfRun = (j: JobSummary): SubjectKey => subjectOfSource(p.sourcesById, j.sourceId);
  const shown = all ? filterRuns(p.allJobs, p.sourcesById, p.subjectFilter) : p.jobsForSource;
  const pageMeta = p.jobsForSource[0] !== undefined ? p.sourcesById.get(p.jobsForSource[0].sourceId) : undefined;
  return (
    <section className="drawer-section" aria-labelledby="runs-heading">
      <div className="runs-head">
        <h3 id="runs-heading" className="section-title">{all ? 'All runs' : 'Runs for this page'}</h3>
        <div className="runs-scope" role="group" aria-label="Which runs to list">
          <button type="button" className="subject-chip" aria-pressed={!all} onClick={() => p.onScope('page')}>This page</button>
          <button type="button" className="subject-chip" aria-pressed={all} onClick={() => p.onScope('all')}>All pages</button>
        </div>
      </div>
      {all && p.jobs.state === 'ready' && (
        <SubjectChips
          counts={subjectCounts(p.allJobs, subjectOfRun)}
          total={p.allJobs.length}
          active={p.subjectFilter}
          onChange={p.onSubjectFilter}
          label="Filter runs by subject"
          unit="run"
        />
      )}
      {p.jobs.state === 'loading' && <p className="muted small">Loading runs…</p>}
      {p.jobs.state === 'error' && <p className="field-error" role="alert">{p.jobs.message}</p>}
      {!all && p.jobs.state === 'ready' && p.jobsForSource.length === 0 && (
        <p className="muted small">
          No runs for this page yet.{' '}
          {p.canGenerate && <button type="button" className="link-btn" onClick={p.onNewLesson}>Start a new lesson</button>}
        </p>
      )}
      {all && p.jobs.state === 'ready' && shown.length === 0 && (
        <p className="muted small">{p.subjectFilter !== null ? `No ${subjectLabel(p.subjectFilter)} runs yet.` : 'No runs yet.'}</p>
      )}
      {shown.length > 0 && (
        <p className="muted small">
          {!all && pageMeta?.subject !== undefined && <span className="runs-subject">{subjectLabel(subjectOf(pageMeta))} · </span>}
          {!all && pageMeta !== undefined && retiredRunNote(p.sourcesById, pageMeta.id) !== null && <span className="runs-subject">Retired page · </span>}
          {all && <span className="runs-subject">{shown.length} {shown.length === 1 ? 'run' : 'runs'} · </span>}
          Stored results unless marked Live.
        </p>
      )}
      <ul className="run-list">
        {shown.map((j) => {
          const r = runLine(j, { liveJobIds: p.liveJobIds, serverBusy: p.serverBusy });
          const selected = j.jobId === p.selectedJobId;
          const tags = r.tags.filter((t) => t.text !== r.status.text);
          const page = all ? p.sourcesById.get(j.sourceId) : undefined;
          return (
            <li key={j.jobId} className={`run${selected ? ' selected' : ''}`}>
              <button type="button" className="run-line" aria-pressed={selected} onClick={() => p.onSelectJob(j.jobId, j.sourceId)}>
                <span className="run-when">{r.when}</span>
                <span className="run-model"><span className="run-sep" aria-hidden="true">·</span>{r.model}</span>
                <span className={`run-status tone-${r.status.tone}`}><span className="run-sep" aria-hidden="true">·</span>{r.status.text}</span>
                {r.live && <span className="status-chip">Live</span>}
                {r.systemFault && <span className="run-fault tone-fault">Demo fault</span>}
                {all && (
                  <span className="run-page">
                    <span className="run-subject">{subjectLabel(subjectOfRun(j))}</span>
                    <span className="run-sep" aria-hidden="true">·</span>
                    <span className="run-page-title">{page?.title ?? 'A page no longer listed'}</span>
                    {retiredRunNote(p.sourcesById, j.sourceId) !== null && (
                      <><span className="run-sep" aria-hidden="true">·</span><span className="run-retired">{retiredRunNote(p.sourcesById, j.sourceId)}</span></>
                    )}
                  </span>
                )}
              </button>
              {selected && (
                <div className="run-details" data-testid="run-details">
                  <p className="run-tags">
                    <span>{r.modelHow}</span>
                    {tags.map((t) => <span key={t.text} className={`tone-${t.tone}`}>{t.text}</span>)}
                  </p>
                  <p>Estimated cost {r.cost}</p>
                  {r.note !== null && <p className="muted">{r.note}</p>}
                  <p className="tech">Job <code>{r.jobId}</code></p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---- Steps of the selected run --------------------------------------------------------------------------------------

export function StepsSection({ detail }: { detail: Loadable<JobDetail> | null }) {
  const lesson = detail?.state === 'ready' && detail.data.lessonData !== undefined;
  return (
    <section className="drawer-section" aria-labelledby="steps-heading">
      <h3 id="steps-heading" className="section-title">{lesson ? 'Lesson steps' : 'Steps'}</h3>
      {detail === null && <p className="muted small">Select a run to see its steps.</p>}
      {detail?.state === 'loading' && <p className="muted small">Loading run…</p>}
      {detail?.state === 'error' && <p className="field-error" role="alert">{detail.message}</p>}
      {detail?.state === 'ready' && detail.data.lessonData !== undefined && (
        <LessonSteps
          steps={buildLessonSteps(detail.data)}
          events={detail.data.events}
          jobStatus={detail.data.summary.status}
          totalCostUSD={detail.data.summary.totalCostUSD}
          reservedUnknownUSD={detail.data.summary.reservedUnknownUSD}
          interrupted={isInterrupted(detail.data.summary)}
          jobModel={resolveJobModel(detail.data.summary)}
        />
      )}
      {detail?.state === 'ready' && detail.data.lessonData === undefined && (
        <Timeline
          events={detail.data.events}
          jobStatus={detail.data.summary.status}
          totalCostUSD={detail.data.summary.totalCostUSD}
          reservedUnknownUSD={detail.data.summary.reservedUnknownUSD}
          interrupted={isInterrupted(detail.data.summary)}
          analysisRepairs={detail.data.summary.analysisRepairs}
          jobModel={resolveJobModel(detail.data.summary)}
        />
      )}
    </section>
  );
}
