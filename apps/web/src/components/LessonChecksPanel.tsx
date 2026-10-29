import type { CheckSection } from '../lib/lessonJob.ts';

/** The checks behind a lesson, kept quiet: one closed fold-out per checked part, readable names with the raw id beside them. */
export function LessonChecksPanel({ sections }: { sections: readonly CheckSection[] }) {
  if (sections.length === 0) return null;
  const passed = sections.reduce((n, s) => n + s.passed, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const allPassed = passed === total;
  return (
    <section className="card validation lesson-checks" aria-labelledby="lesson-checks-heading" data-testid="lesson-checks">
      <div className="card-head">
        <h3 id="lesson-checks-heading">Checks behind this lesson</h3>
        <span className={`badge ${allPassed ? 'badge-ok' : 'badge-warn'}`}>{allPassed ? '✓ ' : '⚠ '}{passed}/{total} passed</span>
      </div>
      <p className="muted small">Deterministic code compares every quote with the page and recomputes every number. It runs in the background; open a part to see what it checked. The wording itself is AI-written and still needs teacher review.</p>
      {sections.map((sec) => (
        <details key={sec.key} className="check-group" open={sec.passed < sec.total}>
          <summary>
            <span className="group-name">{sec.label}</span>
            <span className={`group-count ${sec.passed < sec.total ? 'bad' : 'ok'}`}>{sec.passed}/{sec.total}</span>
          </summary>
          <ul>
            {sec.checks.map((c) => (
              <li key={c.id}>
                <details className={`check ${c.passed ? 'check-pass' : 'check-fail'}`} open={!c.passed}>
                  <summary>
                    {c.passed
                      ? <span className="check-icon ok" role="img" aria-label="passed">✓</span>
                      : <span className="check-icon bad" role="img" aria-label="failed">✗</span>}{' '}
                    {c.name !== c.id && <><strong className="check-name">{c.name}</strong>{' '}</>}
                    <code>{c.id}</code>
                  </summary>
                  <p>{c.message}</p>
                </details>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
