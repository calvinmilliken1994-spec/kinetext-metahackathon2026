import type { StageEvent } from '../../../../packages/contracts/index.ts';
import { ANALYSIS_REPAIR_LABEL } from '../lib/analysisRepairs.ts';
import type { AnalysisRepairRecord } from '../lib/analysisRepairs.ts';
import { stageCostLabel, timelineTotal } from '../lib/cost.ts';
import { buildTimeline, formatDuration, formatTokens, rowLabel, shortId } from '../lib/jobs.ts';
import type { JobStatus, RowStatus } from '../lib/jobs.ts';

const ICON: Record<RowStatus, { glyph: string; label: string }> = {
  pending: { glyph: '○', label: 'pending' },
  running: { glyph: '◔', label: 'running' },
  succeeded: { glyph: '✓', label: 'succeeded' },
  failed: { glyph: '✗', label: 'failed' },
};

export interface TimelineProps {
  events: readonly StageEvent[];
  jobStatus: JobStatus;
  totalCostUSD: number | null | undefined;
  reservedUnknownUSD?: number | undefined;
  interrupted?: boolean;
  /** Per-attempt analysis repair outcomes, so a repair that still failed is not drawn as a success. */
  analysisRepairs?: readonly AnalysisRepairRecord[] | undefined;
}

export function Timeline({ events, jobStatus, totalCostUSD, reservedUnknownUSD, interrupted, analysisRepairs }: TimelineProps) {
  const rows = buildTimeline(events, jobStatus, analysisRepairs);
  const total = timelineTotal(events, jobStatus, { totalCostUSD, reservedUnknownUSD, interrupted: interrupted === true });
  return (
    <div className="timeline-wrap">
      <ol className="timeline" aria-label="Pipeline stages">
        {rows.map((r) => {
          const tokens = formatTokens(r.usage);
          const cost = stageCostLabel(r);
          return (
            <li key={`${r.stage}:${r.target ?? ''}:${r.revision ?? ''}`} className={`stage stage-${r.status}${r.stage === 'inject' ? ' stage-inject' : ''}${r.target === 'analysis' ? ' stage-analysis-repair' : ''}`}>
              <span className={`stage-icon ${r.status}`} role="img" aria-label={ICON[r.status].label}>{ICON[r.status].glyph}</span>
              <div className="stage-body">
                <div className="stage-top">
                  <strong>{rowLabel(r)}</strong>
                  {r.durationMs !== null && <span className="stage-dur">{formatDuration(r.durationMs)}</span>}
                  {r.status === 'running' && <span className="stage-dur pulse">running…</span>}
                </div>
                {r.stage === 'inject' && <div className="stage-meta"><span className="tag tag-fault">System-made — not a model error</span></div>}
                {r.target === 'analysis' && <div className="stage-meta"><span className="tag tag-natural">{ANALYSIS_REPAIR_LABEL}</span></div>}
                {(r.model !== undefined || cost !== null) && (
                  <div className="stage-meta">
                    {r.model !== undefined && <span className="tag">{r.model}</span>}
                    {r.responseId !== undefined && <span className="tag mono" title={r.responseId}>{shortId(r.responseId)}</span>}
                    {cost !== null && <span className={`tag${cost.includes('reserved') || cost === 'cost unknown' ? ' tag-warn' : ''}`}>{cost}</span>}
                  </div>
                )}
                {tokens !== null && <div className="stage-tokens">{tokens} tokens</div>}
                {r.detail !== undefined && <div className="stage-detail">{r.detail}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="timeline-total">
        <span>Total est. cost</span>
        <strong>{total.text}</strong>
      </div>
    </div>
  );
}
