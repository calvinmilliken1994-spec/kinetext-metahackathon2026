import type { ReactNode } from 'react';
import type { StageEvent } from '../../../../packages/contracts/index.ts';
import { ANALYSIS_REPAIR_LABEL } from '../lib/analysisRepairs.ts';
import type { AnalysisRepairRecord } from '../lib/analysisRepairs.ts';
import { stageCostLabel, timelineTotal } from '../lib/cost.ts';
import { buildTimeline, formatDuration, formatTokens, rowLabel, rowModel, shortId } from '../lib/jobs.ts';
import type { JobModel } from '../lib/models.ts';
import type { JobStatus, RowStatus } from '../lib/jobs.ts';
import { IconCheck, IconCross, IconPending, IconRunning } from './icons.tsx';

export const STEP_ICON: Record<RowStatus, { icon: ReactNode; label: string }> = {
  pending: { icon: <IconPending />, label: 'pending' },
  running: { icon: <IconRunning />, label: 'running' },
  succeeded: { icon: <IconCheck />, label: 'succeeded' },
  failed: { icon: <IconCross />, label: 'failed' },
};

export interface TimelineProps {
  events: readonly StageEvent[];
  jobStatus: JobStatus;
  totalCostUSD: number | null | undefined;
  reservedUnknownUSD?: number | undefined;
  interrupted?: boolean;
  /** Per-attempt analysis repair outcomes, so a repair that still failed is not drawn as a success. */
  analysisRepairs?: readonly AnalysisRepairRecord[] | undefined;
  /** The job's own model: used for steps whose events recorded none (older runs). */
  jobModel?: JobModel | undefined;
}

/** The steps of a classic single-activity run. Tokens, response ids and model strings sit under Technical details. */
export function Timeline({ events, jobStatus, totalCostUSD, reservedUnknownUSD, interrupted, analysisRepairs, jobModel }: TimelineProps) {
  const rows = buildTimeline(events, jobStatus, analysisRepairs);
  const total = timelineTotal(events, jobStatus, { totalCostUSD, reservedUnknownUSD, interrupted: interrupted === true });
  return (
    <div className="timeline-wrap">
      <ol className="timeline" aria-label="Pipeline steps">
        {rows.map((r) => {
          const tokens = formatTokens(r.usage);
          const cost = stageCostLabel(r);
          const model = rowModel(r, jobModel);
          return (
            <li key={`${r.stage}:${r.target ?? ''}:${r.revision ?? ''}`} className={`stage stage-${r.status}${r.stage === 'inject' ? ' stage-inject' : ''}`}>
              <span className={`stage-icon ${r.status}`} role="img" aria-label={STEP_ICON[r.status].label}>{STEP_ICON[r.status].icon}</span>
              <div className="stage-body">
                <div className="stage-top">
                  <strong>{rowLabel(r)}</strong>
                  {r.durationMs !== null && <span className="stage-dur">{formatDuration(r.durationMs)}</span>}
                  {r.status === 'running' && <span className="stage-dur">running…</span>}
                </div>
                {r.stage === 'inject' && <p className="stage-detail tone-fault">System-made — not a model error</p>}
                {r.target === 'analysis' && <p className="stage-detail">{ANALYSIS_REPAIR_LABEL}</p>}
                {(model !== null || cost !== null) && (
                  <p className="stage-meta">
                    {model !== null && <span>{model.name}</span>}
                    {cost !== null && <span>{cost}</span>}
                    {r.responseId !== undefined && <span className="tech" title={r.responseId}><code>{shortId(r.responseId)}</code></span>}
                  </p>
                )}
                {tokens !== null && <p className="stage-detail tech">{tokens} tokens</p>}
                {r.detail !== undefined && <p className="stage-detail">{r.detail}</p>}
                {model !== null && <p className="stage-detail tech" data-testid="stage-model">Model: {model.label} · <code>{model.providerModel}</code></p>}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="timeline-total">
        <span>Total estimated cost</span>
        <strong>{total.text}</strong>
      </p>
    </div>
  );
}
