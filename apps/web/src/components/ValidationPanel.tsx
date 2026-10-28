import type { ValidationReport } from '../../../../packages/contracts/index.ts';
import { checkName, groupChecks, KIND_BLURB, PROSE_CHECK_ID, proseScopeNotice, summarizeReport, validationBlurb } from '../lib/checks.ts';

function PassIcon({ id, passed }: { id: string; passed: boolean }) {
  if (id === PROSE_CHECK_ID) return <span className="check-icon info" role="img" aria-label="scope notice">ⓘ</span>;
  return passed
    ? <span className="check-icon ok" role="img" aria-label="passed">✓</span>
    : <span className="check-icon bad" role="img" aria-label="failed">✗</span>;
}

export interface ValidationPanelProps {
  report: ValidationReport;
  heading: string;
  /** Show the (disabled) publish control — only for a full activity spec. */
  showPublish: boolean;
  /** Readable check names; defaults to the timeline names. The source-analysis panel passes the analysis names. */
  nameOf?: (id: string) => string | null;
}

export function ValidationPanel({ report, heading, showPublish, nameOf = checkName }: ValidationPanelProps) {
  const summary = summarizeReport(report);
  const groups = groupChecks(report);
  const scope = proseScopeNotice(report);
  return (
    <section className="card validation" aria-labelledby="val-heading">
      <div className="card-head">
        <h3 id="val-heading">{heading}</h3>
        <span className={`badge ${summary.allPassed ? 'badge-ok' : 'badge-bad'}`}>{summary.allPassed ? '✓ ' : '⛔ '}{summary.label}</span>
      </div>
      <p className="muted small">{validationBlurb(report)}</p>
      <div className="callout callout-info scope-notice" role="note" data-testid="scope-notice">
        <strong>Not machine-verified:</strong> {scope.message}
      </div>
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
                  <summary>
                    <PassIcon id={c.id} passed={c.passed} />{' '}
                    {nameOf(c.id) !== null && <><strong className="check-name">{nameOf(c.id)}</strong>{' '}</>}
                    <code>{c.id}</code>
                  </summary>
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
