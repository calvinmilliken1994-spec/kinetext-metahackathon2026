import type { ComponentRepairCard } from '../lib/lessonJob.ts';
import { formatCostUSD, shortId } from '../lib/jobs.ts';
import { repairedByLine } from '../lib/models.ts';
import type { JobModel } from '../lib/models.ts';
import { RepairStory } from './RepairStory.tsx';

/** A check in plain words; its raw id only with technical details on (a check without a plain name says "a check"). */
function CheckLabel({ c }: { c: { id: string; name: string } }) {
  return c.name !== c.id
    ? <>{c.name} <code className="check-code tech">{c.id}</code></>
    : <><span className="no-tech">A check</span><code className="check-code tech">{c.id}</code></>;
}

function Checks({ checks, tone }: { checks: readonly { id: string; name: string }[]; tone: 'ok' | 'bad' }) {
  if (checks.length === 0) return <span className="muted">none</span>;
  return (
    <span className="check-ids">
      {checks.map((c) => (
        <span key={c.id} className={`check-id check-id-${tone}`}><CheckLabel c={c} /></span>
      ))}
    </span>
  );
}

/** Cards grouped by component, in first-seen order. */
function byComponent(cards: readonly ComponentRepairCard[]): ComponentRepairCard[][] {
  const out = new Map<string, ComponentRepairCard[]>();
  for (const c of cards) out.set(c.componentId, [...(out.get(c.componentId) ?? []), c]);
  return [...out.values()].map((g) => [...g].sort((a, b) => a.revision - b.revision));
}

/**
 * Set B: repairs of single lesson parts as a story a teacher can read (check found an issue → revised by Muse →
 * rechecked → published), with the diagram's before/after points drawn on the figure. Who caused the first failure is
 * always said: Muse's own mistake, or a fault the system planted on purpose. The per-attempt record (check ids, the
 * checker's own words, model string, response id) is shown only with technical details on.
 */
export function ComponentRepairTimeline({ cards, model }: { cards: readonly ComponentRepairCard[]; model: JobModel }) {
  if (cards.length === 0) return null;
  const anySystem = cards.some((c) => c.origin === 'system');
  return (
    <section className="card repair-timeline component-repair" aria-labelledby="component-repair-heading" data-testid="component-repair">
      <div className="card-head"><h3 id="component-repair-heading">How Muse revised this lesson</h3></div>
      {anySystem && (
        <p className="callout callout-fault small" role="note" data-testid="system-made-note">
          A demonstration fault was planted by the system on purpose. It is labelled system-made and is not a model error; runs with a fault are excluded from quality metrics.
        </p>
      )}
      <ol className="rev-list" aria-label="Revised parts">
        {byComponent(cards).map((group) => {
          const last = group[group.length - 1] as ComponentRepairCard;
          const cost = group.reduce<number | null>((sum, c) => (c.costUSD === null ? sum : (sum ?? 0) + c.costUSD), null);
          return (
            <li key={last.componentId} className={`rev rev-component rev-component-${last.state} rev-origin-${last.origin}`} data-testid="component-repair-card" data-origin={last.origin}>
              <div className="rev-top">
                <span className={`badge badge-${last.badge.tone}`} data-testid="component-repair-badge">{last.badge.text}</span>
              </div>
              {last.story !== null && <RepairStory story={last.story} />}
              <p className="small story-foot">
                {last.story?.originNote}{' '}
                <span className="muted">{repairedByLine(model, 'spec')}{cost !== null && <> · {formatCostUSD(cost)} est.</>}</span>
              </p>
              {/* The attempt-by-attempt record, for whoever maintains the checks: technical details only. */}
              <div className="tech story-tech">
                {group.map((c) => (
                  <ol key={c.key} className="flow small" aria-label={`Repair attempt ${c.attempt}`}>
                    <li>
                      <strong>Attempt {c.attempt} (revision {c.revision}): failed before</strong>
                      <p><Checks checks={c.targeted} tone="bad" /></p>
                    </li>
                    <li>
                      <strong>Result</strong>
                      {c.state === 'running' ? <p className="muted">Muse is repairing this component…</p> : <p>{c.outcome}</p>}
                      {c.fixed.length > 0 && <p>Fixed: <Checks checks={c.fixed} tone="ok" /></p>}
                    </li>
                    {c.remaining.length > 0 && (
                      <li>
                        <strong>Still failing</strong>
                        <ul className="fail-list">
                          {c.remaining.map((r) => (
                            <li key={r.id}>
                              <span className="check-id check-id-bad"><CheckLabel c={r} /></span>
                              {r.message !== null && <span className="muted"> Checker said: <q className="checker-msg">{r.message}</q></span>}
                            </li>
                          ))}
                        </ul>
                      </li>
                    )}
                    {(c.model !== null || c.responseId !== null) && (
                      <li className="mono">{c.model}{c.responseId !== null && <> · {shortId(c.responseId)}</>}</li>
                    )}
                  </ol>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
