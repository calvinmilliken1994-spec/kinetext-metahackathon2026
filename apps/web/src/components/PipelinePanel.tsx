import type { JobDetail, JobSummary } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { describeJobCost } from '../lib/cost.ts';
import type { GenerateState } from '../lib/health.ts';
import { INTERRUPTED_TEXT, isInterrupted, jobStatusLabel, runBadge } from '../lib/jobs.ts';
import { Timeline } from './Timeline.tsx';

export interface PipelinePanelProps {
  sourceTitle: string | null;
  jobs: Loadable<JobSummary[]>;
  jobsForSource: readonly JobSummary[];
  /** Button state derived from /api/health (busy flag), not from job history. */
  generate: GenerateState;
  /** /api/health busy (incl. a POST in flight); null until health has loaded. */
  serverBusy: boolean | null;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  liveJobIds: ReadonlySet<string>;
  onGenerate: () => void;
  generateError: string | null;
  detail: Loadable<JobDetail> | null;
}

export function PipelinePanel(p: PipelinePanelProps) {
  const { generate } = p;
  const liveOff = generate.liveOff;
  const disabled = generate.disabled || p.sourceTitle === null;
  const why = generate.reason;

  return (
    <section className="panel pipeline-panel" aria-labelledby="pipeline-heading">
      <div className="panel-head">
        <h2 id="pipeline-heading"><span className="step-num">2</span> Muse Spark pipeline</h2>
      </div>

      <div className="pad">
        <button type="button" className="btn btn-primary btn-wide" onClick={p.onGenerate} disabled={disabled} aria-describedby={why !== null ? 'generate-why' : undefined}>
          {generate.busy ? '⏳ Generating…' : '✦ Generate with Muse Spark'}
        </button>
        {why !== null && <p id="generate-why" className="muted small gen-why">{why}</p>}
        {p.generateError !== null && <p className="field-error" role="alert">{p.generateError}</p>}
      </div>

      <div className="runs">
        <h3>Runs for this source</h3>
        {p.jobs.state === 'loading' && <p className="muted small pad">Loading runs…</p>}
        {p.jobs.state === 'error' && <p className="field-error pad" role="alert">{p.jobs.message}</p>}
        {p.jobs.state === 'ready' && p.jobsForSource.length === 0 && (
          <p className="muted small pad">No runs for this source yet.{liveOff ? '' : ' Generate one above.'}</p>
        )}
        <ul className="run-list">
          {p.jobsForSource.map((j) => {
            const badge = runBadge(j, p.liveJobIds);
            const st = jobStatusLabel(j, p.serverBusy);
            const interrupted = isInterrupted(j);
            const selected = j.jobId === p.selectedJobId;
            const cost = describeJobCost({ totalCostUSD: j.totalCostUSD, reservedUnknownUSD: j.reservedUnknownUSD, interrupted });
            return (
              <li key={j.jobId}>
                <button type="button" className={`run${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => p.onSelectJob(j.jobId)}>
                  <span className="run-top">
                    <span className={`badge ${badge.kind === 'live' ? 'badge-live' : 'badge-rec'}`}>{badge.label}</span>
                    <span className={`status st-${st.tone}`}>{st.text}</span>
                  </span>
                  <span className="run-sub mono">{j.jobId} · est. cost {cost}</span>
                  {interrupted && <span className="run-note">{INTERRUPTED_TEXT}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="stages">
        <h3>Stage timeline</h3>
        {p.detail === null && <p className="muted small pad">Select a run to see its stages.</p>}
        {p.detail?.state === 'loading' && <p className="muted small pad">Loading run…</p>}
        {p.detail?.state === 'error' && <p className="field-error pad" role="alert">{p.detail.message}</p>}
        {p.detail?.state === 'ready' && (
          <Timeline
            events={p.detail.data.events}
            jobStatus={p.detail.data.summary.status}
            totalCostUSD={p.detail.data.summary.totalCostUSD}
            reservedUnknownUSD={p.detail.data.summary.reservedUnknownUSD}
            interrupted={isInterrupted(p.detail.data.summary)}
          />
        )}
      </div>
    </section>
  );
}
