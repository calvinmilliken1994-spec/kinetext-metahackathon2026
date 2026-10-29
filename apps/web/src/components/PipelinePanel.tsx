import type { JobDetail, JobSummary } from '../api.ts';
import type { Loadable } from '../hooks.ts';
import { describeJobCost } from '../lib/cost.ts';
import { engineTitle } from '../lib/engines.ts';
import type { GenerateState } from '../lib/health.ts';
import { INTERRUPTED_TEXT, isInterrupted, jobStatusLabel, runBadge } from '../lib/jobs.ts';
import { analysisRepairTags } from '../lib/analysisRepairs.ts';
import { runTags } from '../lib/repairs.ts';
import { modelRunTag, resolveJobModel } from '../lib/models.ts';
import type { ModelId, ModelOption } from '../lib/models.ts';
import { DEMO_FAULT_HELP, DEMO_FAULT_LABEL, demoFaultOptions, FREE_CREDITS_NOTE } from '../lib/sources.ts';
import type { DemoChoice } from '../lib/sources.ts';
import { ModelPicker } from './ModelPicker.tsx';
import { Timeline } from './Timeline.tsx';

export interface PipelinePanelProps {
  sourceTitle: string | null;
  /** The selected source is a teacher's pasted text (shows the free-credits notice next to Generate). */
  teacherSource: boolean;
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
  demoChoice: DemoChoice;
  onDemoChoice: (c: DemoChoice) => void;
  generateError: string | null;
  detail: Loadable<JobDetail> | null;
  /** GET /api/models; empty (older server) hides the picker. */
  models: readonly ModelOption[];
  modelChoice: ModelId;
  onModelChoice: (id: ModelId) => void;
  /** /api/health live flag; null until loaded. */
  live: boolean | null;
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
        <ModelPicker options={p.models} selected={p.modelChoice} onSelect={p.onModelChoice} live={p.live} locked={generate.busy} />
        <button type="button" className="btn btn-primary btn-wide" onClick={p.onGenerate} disabled={disabled} aria-describedby={why !== null ? 'generate-why' : undefined}>
          {generate.busy ? '⏳ Generating…' : '✦ Generate with Muse Spark'}
        </button>
        {why !== null && <p id="generate-why" className="muted small gen-why">{why}</p>}
        {p.generateError !== null && <p className="field-error" role="alert">{p.generateError}</p>}
        {p.teacherSource && <p className="callout callout-warn small gen-why" role="note">{FREE_CREDITS_NOTE}</p>}

        <div className={`demo-fault${p.demoChoice !== 'none' ? ' demo-fault-on' : ''}`}>
          <label htmlFor="demo-fault-select" className="field-label">{DEMO_FAULT_LABEL}</label>
          <select id="demo-fault-select" value={p.demoChoice} disabled={generate.busy} aria-describedby="demo-fault-help" onChange={(e) => p.onDemoChoice(e.target.value as DemoChoice)}>
            {demoFaultOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p id="demo-fault-help" className="muted small">{DEMO_FAULT_HELP}</p>
          {p.demoChoice !== 'none' && (
            <p className="callout callout-fault small" role="note">
              Demonstration: the next run will carry a fault injected by the system (<code>{p.demoChoice}</code>), not made by Muse.
            </p>
          )}
        </div>
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
            const engine = engineTitle(j.engine);
            const jobModel = modelRunTag(resolveJobModel(j));
            const tags = [...analysisRepairTags(j), ...runTags(j)];
            return (
              <li key={j.jobId}>
                <button type="button" className={`run${selected ? ' selected' : ''}`} aria-pressed={selected} onClick={() => p.onSelectJob(j.jobId)}>
                  <span className="run-top">
                    <span className={`badge ${badge.kind === 'live' ? 'badge-live' : 'badge-rec'}`}>{badge.label}</span>
                    <span className={`status st-${st.tone}`}>{st.text}</span>
                  </span>
                  <span className="run-tags">
                    <span className={`tag tag-model-${jobModel.tone}`} data-testid="run-model-tag">{jobModel.text}</span>
                      {engine !== null && <span className="tag tag-engine" title={j.engine ?? undefined}>{engine}</span>}
                      {tags.map((t) => <span key={t.text} className={`tag tag-${t.tone}`}>{t.text}</span>)}
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
            analysisRepairs={p.detail.data.summary.analysisRepairs}
            jobModel={resolveJobModel(p.detail.data.summary)}
          />
        )}
      </div>
    </section>
  );
}
