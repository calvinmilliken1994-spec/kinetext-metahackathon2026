import type { JobDetail } from '../api.ts';
import { describeJobCost } from '../lib/cost.ts';
import { INTERRUPTED_TEXT, isInterrupted } from '../lib/jobs.ts';

/** Centre-column states for jobs that did not produce a runnable activity. `serverBusy`: /api/health busy flag (null = unknown). */
export function JobOutcome({ detail, serverBusy }: { detail: JobDetail; serverBusy: boolean | null }) {
  const { summary, analysis, report } = detail;
  if (summary.status === 'running' && serverBusy === false) {
    return (
      <div className="outcome outcome-interrupted" role="status">
        <p className="eyebrow">Stale record</p>
        <h2>Not running</h2>
        <p>This record says “running”, but the server reports no job in progress. It was probably left behind when the server stopped; restarting the API marks such runs as interrupted.</p>
      </div>
    );
  }
  if (summary.status === 'running') {
    const last = detail.events[detail.events.length - 1];
    return (
      <div className="outcome outcome-running" role="status">
        <div className="spinner" aria-hidden="true" />
        <h2>Muse Spark is working…</h2>
        <p className="muted">
          {last ? `Latest stage: ${last.stage} (${last.status}).` : 'Starting the pipeline.'} When it finishes, deterministic code machine-checks the result; explanation wording will still need teacher review.
        </p>
      </div>
    );
  }
  if (summary.status === 'unsupported') {
    const reason = analysis?.analysis.unsupportedReason ?? 'No reason was recorded.';
    return (
      <div className="outcome outcome-unsupported">
        <p className="eyebrow">Muse Spark analysed this source</p>
        <h2>Not supported yet</h2>
        <blockquote>{reason}</blockquote>
        <p className="muted">
          The only activity engine available today is <code>forces-1d-v1</code> (net force and mass → acceleration in one dimension).
          Rather than force a mismatched simulation, the pipeline stopped here and nothing was generated.
        </p>
      </div>
    );
  }
  if (isInterrupted(summary)) {
    return (
      <div className="outcome outcome-interrupted" role="status">
        <p className="eyebrow">Run interrupted</p>
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
  const failed = (report?.checks ?? []).filter((c) => !c.passed);
  return (
    <div className="outcome outcome-failed" role="alert">
      <p className="eyebrow">Generation did not finish</p>
      <h2>Blocked</h2>
      {summary.error !== undefined && <p>Error code: <code>{summary.error.code}</code>{summary.error.message ? <span className="muted"> — {summary.error.message}</span> : null}</p>}
      <p className="muted">Estimated cost: {describeJobCost({ totalCostUSD: summary.totalCostUSD, reservedUnknownUSD: summary.reservedUnknownUSD })}.</p>
      {failed.length > 0 && (
        <>
          <p>Failed checks:</p>
          <ul>
            {failed.map((c) => <li key={c.id}><code>{c.id}</code> — {c.message}</li>)}
          </ul>
        </>
      )}
      {summary.error === undefined && failed.length === 0 && <p className="muted">No further detail was recorded for this run.</p>}
    </div>
  );
}
