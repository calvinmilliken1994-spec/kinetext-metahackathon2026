import type { ValidationReport } from '../../../../packages/contracts/index.ts';
import { groupChecks, KIND_BLURB, summarizeReport } from '../lib/checks.ts';

function PassIcon({ passed }: { passed: boolean }) {
  return passed
    ? <span className="check-icon ok" role="img" aria-label="passed">✓</span>
    : <span className="check-icon bad" role="img" aria-label="failed">✗</span>;
}

export interface ValidationPanelProps {
  report: ValidationReport;
  heading: string;
  /** Show the (disabled) publish control — only for a full activity spec. */
  showPublish: boolean;
}

export function ValidationPanel({ report, heading, showPublish }: ValidationPanelProps) {
  const summary = summarizeReport(report);
  const groups = groupChecks(report);
  return (
    <section className="card validation" aria-labelledby="val-heading">
      <div className="card-head">
        <h3 id="val-heading">{heading}</h3>
        <span className={`badge ${summary.verified ? 'badge-ok' : 'badge-bad'}`}>{summary.verified ? '✓ ' : '⛔ '}{summary.label}</span>
      </div>
      <p className="muted small">Deterministic code re-checks every claim. Nothing here is the model grading itself.</p>
      {groups.map((g) => (
        <details key={g.kind} className="check-group" open>
          <summary>
            <span className="group-name">{g.label}</span>
            <span className="group-blurb">{KIND_BLURB[g.kind]}</span>
            <span className={`group-count ${g.failed > 0 ? 'bad' : 'ok'}`}>{g.passed}/{g.checks.length}</span>
          </summary>
          <ul>
            {g.checks.map((c) => (
              <li key={c.id}>
                <details className={`check ${c.passed ? 'check-pass' : 'check-fail'}`} open={!c.passed}>
                  <summary><PassIcon passed={c.passed} /> <code>{c.id}</code></summary>
                  <p>{c.message}{c.path !== undefined && <span className="muted"> · {c.path}</span>}</p>
                </details>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {showPublish && (
        <div className="publish">
          <button type="button" className="btn" disabled aria-describedby="publish-note">Publish</button>
          <p id="publish-note" className="muted small">Teacher approval &amp; publishing arrive in Stage 6.</p>
        </div>
      )}
    </section>
  );
}
