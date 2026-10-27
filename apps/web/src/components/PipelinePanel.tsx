import type { Health, JobDetail, JobSummary } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { formatCostUSD, runBadge } from '../lib/jobs.ts';
import { Timeline } from './Timeline.tsx';

export interface PipelinePanelProps {
  health: Health | null;
  down: boolean;
  sourceTitle: string | null;
  jobs: Loadable<JobSummary[]>;
  jobsForSource: readonly JobSummary[];
  anyRunning: boolean;
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
  liveJobIds: ReadonlySet<string>;
  onGenerate: () => void;
  generating: boolean;
  generateError: string | null;
  detail: Loadable<JobDetail> | null;
}

function statusLabel(j: JobSummary): { text: string; cls: string } {
  switch (j.status) {
    case 'running': return { text: 'Running', cls: 'st-running' };
    case 'succeeded': return { text: j.checksPassed !== undefined && j.checksTotal !== undefined ? `Verified ${j.checksPassed}/${j.checksTotal}` : 'Succeeded', cls: 'st-ok' };
    case 'unsupported': return { text: 'Not supported yet', cls: 'st-warn' };
    case 'failed': return { text: 'Failed', cls: 'st-bad' };
  }
}

export function PipelinePanel(p: PipelinePanelProps) {
  const liveOff = p.health !== null && !p.health.live;
  const disabled = p.down || p.health === null || liveOff || p.anyRunning || p.generating || p.sourceTitle === null;
  let why: string | null = null;
  if (p.down) why = 'The API is unreachable.';
  else if (liveOff) why = 'Live generation is switched off on this server, so no new Muse calls can be made. Recorded runs below are stored results.';
  else if (p.anyRunning || p.generating) why = 'A generation job is running. Only one can run at a time.';

  return (
    <section className="panel pipeline-panel" aria-labelledby="pipeline-heading">
      <div className="panel-head">
        <h2 id="pipeline-heading"><span className="step-num">2</span> Muse Spark pipeline</h2>
      </div>

      <div className="pad">
        <button type="button" className="btn btn-primary btn-wide" onClick={p.onGenerate} disabled={disabled} aria-describedby={why !== null ? 'generate-why' : undefined}>
          {p.generating || p.anyRunning ? '⏳ Generating…' : '✦ Generate with Muse Spark'}
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
            const st = statusLabel(j);
            const selected = j.jobId === p.selectedJobId;
            return (
              <li key={j.jobId}>
                <button type="button" className={`run${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => p.onSelectJob(j.jobId)}>
                  <span className="run-top">
                    <span className={`badge ${badge.kind === 'live' ? 'badge-live' : 'badge-rec'}`}>{badge.label}</span>
                    <span className={`status ${st.cls}`}>{st.text}</span>
                  </span>
                  <span className="run-sub mono">{j.jobId} · {formatCostUSD(j.totalCostUSD)} est.</span>
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
          <Timeline events={p.detail.data.events} jobStatus={p.detail.data.summary.status} totalCostUSD={p.detail.data.summary.totalCostUSD} />
        )}
      </div>
    </section>
  );
}
