import type { ComponentRepairCard } from '../lib/lessonJob.ts';
import { formatCostUSD } from '../lib/jobs.ts';
import { repairedByLine } from '../lib/models.ts';
import type { JobModel } from '../lib/models.ts';

function Checks({ checks, tone }: { checks: readonly { id: string; name: string }[]; tone: 'ok' | 'bad' }) {
  if (checks.length === 0) return <span className="muted">none</span>;
  return (
    <span className="check-ids">
      {checks.map((c) => (
        <span key={c.id} className={`check-id check-id-${tone}`} title={c.id}>
          {c.name !== c.id && <>{c.name} </>}<code className="check-code">{c.id}</code>
        </span>
      ))}
    </span>
  );
}

/**
 * Repairs of single lesson components. A check named what was wrong, Muse got the failure back and returned a corrected
 * component, and the checks ran again. Natural = Muse's own mistake; system-made = a demonstration fault planted on purpose.
 */
export function ComponentRepairTimeline({ cards, model }: { cards: readonly ComponentRepairCard[]; model: JobModel }) {
  if (cards.length === 0) return null;
  const anySystem = cards.some((c) => c.origin === 'system');
  return (
    <section className="card repair-timeline component-repair" aria-labelledby="component-repair-heading" data-testid="component-repair">
      <div className="card-head"><h3 id="component-repair-heading">Component repairs</h3></div>
      <p className="muted small">When a check fails on a lesson component, Muse receives the failure and returns a corrected component (at most two repairs). Nothing from a component is shown unless it passes.</p>
      {anySystem && (
        <p className="callout callout-fault small" role="note" data-testid="system-made-note">
          A demonstration fault was planted by the system on purpose. It is labelled system-made and is not a model error; runs with a fault are excluded from quality metrics.
        </p>
      )}
      <ol className="rev-list" aria-label="Component repair attempts">
        {cards.map((c) => (
          <li key={c.key} className={`rev rev-component rev-component-${c.state} rev-origin-${c.origin}`} data-testid="component-repair-card" data-origin={c.origin}>
            <div className="rev-top">
              <strong>{c.label}</strong>
              <span className="muted small">repair attempt {c.attempt}</span>
              <span className={`badge badge-${c.badge.tone}`} data-testid="component-repair-badge">{c.badge.tone === 'bad' ? '⚠ ' : '✓ '}{c.badge.text}</span>
            </div>
            <ol className="flow small">
              <li>
                <strong>{c.origin === 'system' ? 'The planted fault failed a check' : 'Muse’s first version failed a check'}</strong>
                <p><Checks checks={c.targeted} tone="bad" /></p>
              </li>
              <li>
                <strong>Muse’s repair</strong>
                {c.state === 'running' ? <p className="muted">Muse is repairing this component…</p> : <p>{c.outcome}</p>}
                {c.fixed.length > 0 && <p>Fixed: <Checks checks={c.fixed} tone="ok" /></p>}
              </li>
              {c.remaining.length > 0 && (
                <li>
                  <strong>Still failing</strong>
                  <ul className="fail-list">
                    {c.remaining.map((r) => (
                      <li key={r.id}>
                        <span className="check-id check-id-bad" title={r.id}>{r.name !== r.id && <>{r.name} </>}<code className="check-code">{r.id}</code></span>
                        {r.message !== null && <span className="muted"> Checker said: <q className="checker-msg">{r.message}</q></span>}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ol>
            <p className="small repair-model">{repairedByLine(model, 'spec')}{c.costUSD !== null && <> Cost <strong>{formatCostUSD(c.costUSD)} est.</strong></>}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
