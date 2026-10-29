import type { JobDetail } from '../api.ts';
import { describeJobCost } from '../lib/cost.ts';
import { activityTitles, engineTitle } from '../lib/engines.ts';
import { INTERRUPTED_TEXT, isInterrupted } from '../lib/jobs.ts';
import { analysisRepairNote, analysisRepairOverall } from '../lib/analysisRepairs.ts';
import { demoFaultNotice, repairAttemptCount } from '../lib/repairs.ts';
import { friendlyJobError } from '../lib/models.ts';
import { lessonCheckName } from '../lib/lessonJob.ts';

/** Centre-column states for jobs that did not produce a runnable activity. `serverBusy`: /api/health busy flag (null = unknown). */
export function JobOutcome({ detail, serverBusy }: { detail: JobDetail; serverBusy: boolean | null }) {
  const { summary, analysis, report } = detail;
  if (summary.status === 'running' && serverBusy === false) {
    return (
      <div className="outcome outcome-interrupted" role="status">
        <h2>Not running</h2>
        <p>This record says “running”, but the server reports no job in progress. It was probably left behind when the server stopped; restarting the API marks such runs as interrupted.</p>
      </div>
    );
  }
  if (summary.status === 'running') {
    const last = detail.events[detail.events.length - 1];
    return (
      <div className="outcome outcome-running" role="status">
        <div className="pending-bar" aria-hidden="true"><span /></div>
        <h2>Muse Spark is reading the page…</h2>
        {detail.lessonData !== undefined
          ? <p className="muted">The overview appears here as soon as it is ready, and the interactive parts follow one by one.</p>
          : (
            <p className="muted">
              {last ? `Latest step: ${last.stage} (${last.status}).` : 'Starting.'} When it finishes, code checks the result; the wording will still need teacher review.
            </p>
          )}
      </div>
    );
  }
  const analysisNote = analysisRepairOverall({ analysisRepairs: summary.analysisRepairs }).state === 'none' ? null : analysisRepairNote(summary.analysisRepairs);
  if (summary.status === 'unsupported') {
    const reason = analysis?.analysis.unsupportedReason ?? 'No reason was recorded.';
    return (
      <div className="outcome outcome-unsupported">
        <h2>Not supported yet</h2>
        <figure className="decline-summary">
          <blockquote>{reason}</blockquote>
          <figcaption className="small muted">Muse Spark’s reading of the page (AI-written)</figcaption>
        </figure>
        <p className="muted">
          Muse Spark can choose among these tested activity types: {activityTitles().join('; ')}.
          None of them fits this page, so rather than force a mismatched simulation the run stopped here and nothing was generated.
        </p>
        {analysisNote !== null && <p className="note small" role="note">{analysisNote}</p>}
      </div>
    );
  }
  if (isInterrupted(summary)) {
    return (
      <div className="outcome outcome-interrupted" role="status">
        <h2>Interrupted</h2>
        <p>{INTERRUPTED_TEXT}</p>
        <p className="muted">
          Nothing from this run is usable. A model call may have been in flight when the server stopped, so its cost
          may be missing from the total: {describeJobCost({ totalCostUSD: summary.totalCostUSD, reservedUnknownUSD: summary.reservedUnknownUSD, interrupted: true })}.
          Start a new run to try again.
        </p>
      </div>
    );
  }
  const failed = (report ?? detail.lessonData?.analysisReport ?? undefined)?.checks.filter((c) => !c.passed) ?? [];
  const chosen = engineTitle(summary.engine);
  const friendly = friendlyJobError(summary.error?.code);
  const repairCount = repairAttemptCount(summary.repairs, detail.events);
  return (
    <div className="outcome outcome-failed" role="alert">
      <h2>Blocked: nothing from this run is shown</h2>
      {detail.lessonData !== undefined && <p className="muted">The page analysis or overview did not pass its checks, so no lesson was published.</p>}
      {chosen !== null && <p className="muted">Activity type Muse chose: <strong>{chosen}</strong></p>}
      {summary.demoFault !== undefined && <p className="callout callout-fault" role="note">{demoFaultNotice(summary.demoFault)}</p>}
      {friendly !== null && <p className="callout callout-error" data-testid="friendly-error">{friendly}</p>}
      {analysisNote !== null && <p className="note small" role="note">{analysisNote}</p>}
      {repairCount > 0 && (
        <p>
          Muse made {repairCount} repair attempt{repairCount === 1 ? '' : 's'}, but no revision passed every check
          {summary.bestRevision !== undefined ? `; the checks below are from revision ${summary.bestRevision}, the one with the fewest failures` : ''}.
        </p>
      )}
      <p className="muted">Estimated cost: {describeJobCost({ totalCostUSD: summary.totalCostUSD, reservedUnknownUSD: summary.reservedUnknownUSD })}.</p>
      {failed.length > 0 && (
        <>
          <p>Checks that failed:</p>
          <ul className="outcome-list">
            {failed.map((c) => <li key={c.id}>{lessonCheckName(c.id) ?? 'Check'} — {c.message}</li>)}
          </ul>
        </>
      )}
      {(summary.error !== undefined || summary.engine != null || failed.length > 0) && (
        <details className="small tech-details">
          <summary>Technical details</summary>
          {summary.engine != null && <p>Activity engine <code>{summary.engine}</code></p>}
          {summary.error !== undefined && <p>Error code <code>{summary.error.code}</code>{summary.error.message ? <span className="muted"> — {summary.error.message}</span> : null}</p>}
          {failed.length > 0 && <p>Failed check ids: {failed.map((c) => <code key={c.id}>{c.id} </code>)}</p>}
        </details>
      )}
      {summary.error === undefined && failed.length === 0 && <p className="muted">No further detail was recorded for this run.</p>}
    </div>
  );
}
