import type { ReactNode } from 'react';
import type { StageEvent } from '../../../../packages/contracts/index.ts';
import type { JobStatus } from '../lib/jobs.ts';
import { formatCostUSD, formatDuration } from '../lib/jobs.ts';
import { timelineTotal } from '../lib/cost.ts';
import type { LessonStep, StepStatus } from '../lib/lessonJob.ts';
import { resolveJobModel } from '../lib/models.ts';
import type { JobModel } from '../lib/models.ts';
import { toTone } from '../lib/runs.ts';
import { IconSkipped } from './icons.tsx';
import { STEP_ICON } from './Timeline.tsx';

function stepIcon(status: StepStatus): { icon: ReactNode; label: string } {
  return status === 'skipped' ? { icon: <IconSkipped />, label: 'not built' } : STEP_ICON[status];
}

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

/** The lesson's steps: Analyse page, Overview ready, one step per part (passed / repaired / items left out / could not be verified), Published. */
export function LessonSteps({ steps, events, jobStatus, totalCostUSD, reservedUnknownUSD, interrupted, jobModel }: LessonStepsProps) {
  const total = timelineTotal(events, jobStatus, { totalCostUSD, reservedUnknownUSD, interrupted: interrupted === true });
  return (
    <div className="timeline-wrap" data-testid="lesson-steps">
      <ol className="timeline" aria-label="Lesson steps">
        {steps.map((s) => {
          const cost = costLabel(s);
          const model = s.model === null ? null : resolveJobModel({ model: s.model }, jobModel);
          const icon = stepIcon(s.status);
          return (
            <li key={s.key} className={`stage stage-${s.status}`} data-step={s.key} data-outcome={s.outcome ?? undefined}>
              <span className={`stage-icon ${s.status}`} role="img" aria-label={icon.label}>{icon.icon}</span>
              <div className="stage-body">
                <div className="stage-top">
                  <strong>{s.label}</strong>
                  {s.durationMs !== null && <span className="stage-dur">{formatDuration(s.durationMs)}</span>}
                  {s.status === 'running' && <span className="stage-dur">running…</span>}
                </div>
                <p className="stage-detail" data-testid="step-detail">{s.detail}</p>
                {(s.tags.length > 0 || model !== null || cost !== null) && (
                  <p className="stage-meta">
                    {s.tags.map((t) => <span key={t.text} className={`tone-${toTone(t.tone)}`}>{t.text}</span>)}
                    {model !== null && <span title={model.label}>{model.name}</span>}
                    {cost !== null && <span>{cost}</span>}
                  </p>
                )}
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
