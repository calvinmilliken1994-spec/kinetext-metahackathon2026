import type { JobDetail } from '../api.ts';

/** Centre-column states for jobs that did not produce a runnable activity. */
export function JobOutcome({ detail }: { detail: JobDetail }) {
  const { summary, analysis, report } = detail;
  if (summary.status === 'running') {
    const last = detail.events[detail.events.length - 1];
    return (
      <div className="outcome outcome-running" role="status">
        <div className="spinner" aria-hidden="true" />
        <h2>Muse Spark is working…</h2>
        <p className="muted">
          {last ? `Latest stage: ${last.stage} (${last.status}).` : 'Starting the pipeline.'} Every stage is validated by deterministic code before anything reaches a student.
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
  const failed = (report?.checks ?? []).filter((c) => !c.passed);
  return (
    <div className="outcome outcome-failed" role="alert">
      <p className="eyebrow">Generation did not finish</p>
      <h2>Blocked</h2>
      {summary.error !== undefined && <p>Error code: <code>{summary.error.code}</code>{summary.error.message ? <span className="muted"> — {summary.error.message}</span> : null}</p>}
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
