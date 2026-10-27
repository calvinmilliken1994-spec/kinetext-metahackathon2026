import type { StageEvent } from '../../../../packages/contracts/index.ts';
import { buildTimeline, formatCostUSD, formatDuration, formatTokens, shortId, STAGE_LABEL, totalEventCost } from '../lib/jobs.ts';
import type { JobStatus, RowStatus } from '../lib/jobs.ts';

const ICON: Record<RowStatus, { glyph: string; label: string }> = {
  pending: { glyph: '○', label: 'pending' },
  running: { glyph: '◔', label: 'running' },
  succeeded: { glyph: '✓', label: 'succeeded' },
  failed: { glyph: '✗', label: 'failed' },
};

export function Timeline({ events, jobStatus, totalCostUSD }: { events: readonly StageEvent[]; jobStatus: JobStatus; totalCostUSD: number }) {
  const rows = buildTimeline(events, jobStatus);
  const eventCost = totalEventCost(events);
  const cost = eventCost ?? (jobStatus === 'running' ? null : totalCostUSD);
  return (
    <div className="timeline-wrap">
      <ol className="timeline" aria-label="Pipeline stages">
        {rows.map((r) => {
          const tokens = formatTokens(r.usage);
          return (
            <li key={r.stage} className={`stage stage-${r.status}`}>
              <span className={`stage-icon ${r.status}`} role="img" aria-label={ICON[r.status].label}>{ICON[r.status].glyph}</span>
              <div className="stage-body">
                <div className="stage-top">
                  <strong>{STAGE_LABEL[r.stage]}</strong>
                  {r.durationMs !== null && <span className="stage-dur">{formatDuration(r.durationMs)}</span>}
                  {r.status === 'running' && <span className="stage-dur pulse">running…</span>}
                </div>
                {r.model !== undefined && (
                  <div className="stage-meta">
                    <span className="tag">{r.model}</span>
                    {r.responseId !== undefined && <span className="tag mono" title={r.responseId}>{shortId(r.responseId)}</span>}
                    {r.estCostUSD !== undefined && <span className="tag">{formatCostUSD(r.estCostUSD)} est.</span>}
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
        <strong>{cost === null ? '— (pending)' : formatCostUSD(cost)}</strong>
      </div>
    </div>
  );
}
