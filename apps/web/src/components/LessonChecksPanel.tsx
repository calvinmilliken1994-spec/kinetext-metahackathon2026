import type { CheckSection } from '../lib/lessonJob.ts';
import { Mark } from './icons.tsx';

/** The checks behind a lesson, kept quiet: one closed fold-out per checked part, readable names, raw ids under Technical details. */
export function LessonChecksPanel({ sections }: { sections: readonly CheckSection[] }) {
  if (sections.length === 0) return null;
  const passed = sections.reduce((n, s) => n + s.passed, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  const allPassed = passed === total;
  return (
    <section className="drawer-section validation lesson-checks" aria-labelledby="lesson-checks-heading" data-testid="lesson-checks">
      <div className="card-head">
        <h3 id="lesson-checks-heading" className="section-title">Checks behind this lesson</h3>
        <span className={`card-status ${allPassed ? 'tone-ok' : 'tone-bad'}`}>{passed} of {total} passed</span>
      </div>
      <p className="muted small">Code compares every quote with the page and recomputes every number. Open a part to see what it checked.</p>
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
                    <Mark kind={c.passed ? 'ok' : 'bad'} label={c.passed ? 'passed' : 'failed'} />
                    {c.name !== c.id ? <strong className="check-name">{c.name}</strong> : <code>{c.id}</code>}
                  </summary>
                  <p>{c.message}</p>
                  {c.name !== c.id && <p className="tech">Check <code>{c.id}</code></p>}
                </details>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}
