import type { StageEvent } from '../../../../packages/contracts/index.ts';
import type { JobStatus } from '../lib/jobs.ts';
import { formatCostUSD, formatDuration } from '../lib/jobs.ts';
import { timelineTotal } from '../lib/cost.ts';
import type { LessonStep, StepStatus } from '../lib/lessonJob.ts';
import { modelRunTag, resolveJobModel } from '../lib/models.ts';
import type { JobModel } from '../lib/models.ts';

const ICON: Record<StepStatus, { glyph: string; label: string }> = {
  pending: { glyph: '○', label: 'pending' },
  running: { glyph: '◔', label: 'running' },
  succeeded: { glyph: '✓', label: 'succeeded' },
  failed: { glyph: '✗', label: 'failed' },
  skipped: { glyph: '–', label: 'not built' },
};

function costLabel(s: LessonStep): string | null {
  if (s.costUSD !== null) return `${formatCostUSD(s.costUSD)} est.`;
  return s.model !== null && (s.status === 'succeeded' || s.status === 'failed') ? 'cost unknown' : null;
}

export interface LessonStepsProps {
  steps: readonly LessonStep[];
  events: readonly StageEvent[];
  jobStatus: JobStatus;
  totalCostUSD: number | null | undefined;
  reservedUnknownUSD?: number | undefined;
  interrupted?: boolean;
  /** The job's own model, for steps whose events recorded none. */
  jobModel: JobModel;
}

/** The lesson's steps: Analyse page, Overview ready, one step per component (passed / repaired / items left out / could not be verified), Published. */
export function LessonSteps({ steps, events, jobStatus, totalCostUSD, reservedUnknownUSD, interrupted, jobModel }: LessonStepsProps) {
  const total = timelineTotal(events, jobStatus, { totalCostUSD, reservedUnknownUSD, interrupted: interrupted === true });
  return (
    <div className="timeline-wrap" data-testid="lesson-steps">
      <ol className="timeline" aria-label="Lesson steps">
        {steps.map((s) => {
          const cost = costLabel(s);
          const model = s.model === null ? null : resolveJobModel({ model: s.model }, jobModel);
          return (
            <li key={s.key} className={`stage stage-${s.status}${s.outcome === 'repaired' ? ' stage-repaired' : ''}`} data-step={s.key} data-outcome={s.outcome ?? undefined}>
              <span className={`stage-icon ${s.status}`} role="img" aria-label={ICON[s.status].label}>{ICON[s.status].glyph}</span>
              <div className="stage-body">
                <div className="stage-top">
                  <strong>{s.label}</strong>
                  {s.durationMs !== null && <span className="stage-dur">{formatDuration(s.durationMs)}</span>}
                  {s.status === 'running' && <span className="stage-dur pulse">running…</span>}
                </div>
                <div className="stage-detail" data-testid="step-detail">{s.detail}</div>
                {(s.tags.length > 0 || model !== null || cost !== null) && (
                  <div className="stage-meta">
                    {s.tags.map((t) => <span key={t.text} className={`tag tag-${t.tone}`}>{t.text}</span>)}
                    {model !== null && <span className={`tag tag-model-${modelRunTag(model).tone}`} title={model.label}>{model.name}</span>}
                    {cost !== null && <span className={`tag${cost === 'cost unknown' ? ' tag-warn' : ''}`}>{cost}</span>}
                  </div>
                )}
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
