import { useId } from 'react';
import type { ValidationReport } from '../../../../packages/contracts/index.ts';
import { checkName, groupChecks, KIND_BLURB, PROSE_CHECK_ID, proseScopeNotice, summarizeReport, validationBlurb } from '../lib/checks.ts';
import { Mark } from './icons.tsx';

function PassIcon({ id, passed }: { id: string; passed: boolean }) {
  if (id === PROSE_CHECK_ID) return <Mark kind="info" label="scope notice" />;
  return <Mark kind={passed ? 'ok' : 'bad'} label={passed ? 'passed' : 'failed'} />;
}

export interface ValidationPanelProps {
  report: ValidationReport;
  heading: string;
  /** Show the (disabled) publish control — only for a full activity spec. */
  showPublish: boolean;
  /** Readable check names; defaults to the timeline names. The source-analysis panel passes the analysis names. */
  nameOf?: (id: string) => string | null;
  /** Fold each passing check group shut (the lesson's trust receipt); groups with a failure stay open. */
  compact?: boolean;
}

export function ValidationPanel({ report, heading, showPublish, nameOf = checkName, compact = false }: ValidationPanelProps) {
  const summary = summarizeReport(report);
  const groups = groupChecks(report);
  const scope = proseScopeNotice(report);
  // The same panel can be on screen twice (runs drawer and the lesson's trust receipt), so its heading id is per instance.
  const headingId = useId();
  return (
    <section className="drawer-section validation" aria-labelledby={headingId}>
      <div className="card-head">
        <h3 id={headingId} className="section-title">{heading}</h3>
        <span className={`card-status ${summary.allPassed ? 'tone-ok' : 'tone-bad'}`}>{summary.label}</span>
      </div>
      <p className="muted small">{validationBlurb(report)}</p>
      <p className="note small" role="note" data-testid="scope-notice">
        <strong>Not machine-verified:</strong> {scope.message}
      </p>
      {groups.map((g) => (
        <details key={g.kind} className="check-group" open={!compact || g.failed > 0}>
          <summary>
            <span className="group-name">{g.label}</span>
            <span className="group-blurb">{KIND_BLURB[g.kind]}</span>
            <span className={`group-count ${g.failed > 0 ? 'bad' : 'ok'}`}>{g.passed}/{g.checks.length}</span>
          </summary>
          <ul>
            {g.checks.map((c) => {
              const name = nameOf(c.id);
              return (
                <li key={c.id}>
                  <details className={`check ${c.passed ? 'check-pass' : 'check-fail'}`} open={!c.passed}>
                    <summary>
                      <PassIcon id={c.id} passed={c.passed} />
                      {name !== null ? <strong className="check-name">{name}</strong> : <code>{c.id}</code>}
                    </summary>
                    <p>{c.message}</p>
                    {(name !== null || c.path !== undefined) && (
                      <p className="tech">{name !== null && <>Check <code>{c.id}</code></>}{c.path !== undefined && <> · <code>{c.path}</code></>}</p>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
      {showPublish && (
        <div className="publish">
          <button type="button" className="btn" disabled aria-describedby="publish-note">Publish</button>
          <p id="publish-note" className="muted small">Teacher approval and publishing are not built yet.</p>
        </div>
      )}
    </section>
  );
}
