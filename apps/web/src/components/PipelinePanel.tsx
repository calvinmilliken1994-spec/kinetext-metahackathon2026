import { useState } from 'react';
import type { JobDetail, JobSummary, SourceMeta } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import type { GenerateState } from '../lib/health.ts';
import { isInterrupted } from '../lib/jobs.ts';
import { buildLessonSteps } from '../lib/lessonJob.ts';
import type { FlowId } from '../lib/lessonJob.ts';
import { resolveJobModel } from '../lib/models.ts';
import type { ModelId, ModelOption } from '../lib/models.ts';
import { runLine } from '../lib/runs.ts';
import { DEMO_FAULT_HELP, DEMO_FAULT_LABEL, demoFaultOptions, FREE_CREDITS_NOTE } from '../lib/sources.ts';
import { filterRuns, subjectCounts, subjectLabel, subjectOf, subjectOfSource } from '../lib/subjects.ts';
import type { Subject } from '../../../../packages/contracts/kit.ts';
import type { DemoChoice } from '../lib/sources.ts';
import { IconPlus } from './icons.tsx';
import { LessonSteps } from './LessonSteps.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { PasteSourceForm } from './PasteSourceForm.tsx';
import { SourcePicker } from './SourcePicker.tsx';
import { SubjectChips } from './SubjectChips.tsx';
import { Timeline } from './Timeline.tsx';

// ---- New lesson: page, model, Generate, run options -------------------------------------------------------------

export interface NewLessonSectionProps {
  sources: Loadable<SourceMeta[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A pasted source was stored: reload the list and select it. */
  onCreated: (sourceId: string) => void;
  /** The selected source is a teacher's pasted text (shows the free-credits notice next to Generate). */
  teacherSource: boolean;
  /** Button state derived from /api/health (busy flag), not from job history. */
  generate: GenerateState;
  onGenerate: () => void;
  demoChoice: DemoChoice;
  onDemoChoice: (c: DemoChoice) => void;
  generateError: string | null;
  /** GET /api/models; empty (older server) hides the picker. */
  models: readonly ModelOption[];
  modelChoice: ModelId;
  onModelChoice: (id: ModelId) => void;
  /** /api/health live flag; null until loaded. */
  live: boolean | null;
  /** Stage 6: build a lesson (default) or the classic single activity. */
  flow: FlowId;
  onFlow: (flow: FlowId) => void;
  /** Stage 7b: the subject filter shared with the source panel and the runs list. */
  subjectFilter: Subject | null;
  onSubjectFilter: (subject: Subject | null) => void;
}

export function NewLessonSection(p: NewLessonSectionProps) {
  const { generate } = p;
  const [pasting, setPasting] = useState(false);
  const [reuseMsg, setReuseMsg] = useState<string | null>(null);
  const list = p.sources.state === 'ready' ? p.sources.data : [];
  const disabled = generate.disabled || p.selectedId === null;
  const why = generate.reason;

  return (
    <section className="drawer-section" aria-label="New lesson">
      <div className="field">
        <SourcePicker
          id="new-lesson-source"
          label="Page"
          sources={list}
          selectedId={p.selectedId}
          onSelect={p.onSelect}
          filter={p.subjectFilter}
          onFilter={p.onSubjectFilter}
        />
        {!pasting && (
          <button type="button" className="btn btn-quiet btn-small paste-open" onClick={() => { setPasting(true); setReuseMsg(null); }}>
            <IconPlus /> Paste your own text
          </button>
        )}
        {reuseMsg !== null && <p className="callout small" role="status">{reuseMsg}</p>}
      </div>
      {pasting && (
        <PasteSourceForm
          onCancel={() => setPasting(false)}
          onCreated={(id, notice) => { setPasting(false); setReuseMsg(notice); p.onCreated(id); }}
        />
      )}

      <ModelPicker options={p.models} selected={p.modelChoice} onSelect={p.onModelChoice} live={p.live} locked={generate.busy} />

      <div className="generate-row">
        <button type="button" className="btn btn-primary" onClick={p.onGenerate} disabled={disabled} aria-describedby={why !== null ? 'generate-why' : undefined}>
          {generate.busy ? 'Generating…' : p.flow === 'lesson' ? 'Generate lesson' : 'Generate activity'}
        </button>
        {p.demoChoice !== 'none' && <span className="tone-fault small" data-testid="demo-fault-armed">With a system-made demo fault</span>}
      </div>
      {why !== null && <p id="generate-why" className="muted small">{why}</p>}
      {p.generateError !== null && <p className="field-error" role="alert">{p.generateError}</p>}
      {p.teacherSource && <p className="callout small" role="note">{FREE_CREDITS_NOTE}</p>}

      <details className="run-options" open={p.demoChoice !== 'none' || p.flow === 'activity' ? true : undefined}>
        <summary>Run options</summary>
        <div className="run-options-body">
          <label htmlFor="flow-classic" className="check-label">
            <input id="flow-classic" type="checkbox" checked={p.flow === 'activity'} disabled={generate.busy} aria-describedby="flow-classic-help" onChange={(e) => p.onFlow(e.target.checked ? 'activity' : 'lesson')} />
            <span>Classic single activity</span>
          </label>
          <p id="flow-classic-help" className="muted small field-help">
            {p.flow === 'activity'
              ? 'The next run builds one simulation or timeline, with no overview and no other parts.'
              : 'Off: the next run builds a lesson — an overview of the page, then a few interactive parts.'}
          </p>
          <div className="field">
            <label htmlFor="demo-fault-select" className="field-label">{DEMO_FAULT_LABEL}</label>
            <select id="demo-fault-select" value={p.demoChoice} disabled={generate.busy} aria-describedby="demo-fault-help" onChange={(e) => p.onDemoChoice(e.target.value as DemoChoice)}>
              {demoFaultOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p id="demo-fault-help" className="muted small field-help">{DEMO_FAULT_HELP}</p>
            {p.demoChoice !== 'none' && (
              <p className="callout callout-fault small" role="note">
                The next run will carry a fault planted by the system, not made by Muse.
              </p>
            )}
          </div>
        </div>
      </details>
    </section>
  );
}

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
  subjectFilter: Subject | null;
  onSubjectFilter: (subject: Subject | null) => void;
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
  const subjectOfRun = (j: JobSummary): Subject => subjectOfSource(p.sourcesById, j.sourceId);
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
