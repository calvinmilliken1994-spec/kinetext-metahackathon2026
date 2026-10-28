import type { FaultRecord, RepairRecord, StageEvent } from '../../../../packages/contracts/index.ts';
import type { RevisionInput } from '../lib/repairs.ts';
import { buildRepairSteps, faultChangeLine, METRICS_NOTE, overallRepairBadge } from '../lib/repairs.ts';
import { checkName } from '../lib/checks.ts';
import { shortId } from '../lib/jobs.ts';

export interface RepairTimelineProps {
  revisions: readonly RevisionInput[];
  repairs: readonly RepairRecord[] | undefined;
  demoFault: FaultRecord | undefined;
  events: readonly StageEvent[];
  publishedRevision: number | undefined;
  bestRevision: number | undefined;
  /** Revision whose checks the validation panel currently shows. */
  viewing: number | null;
  onView: (revision: number) => void;
  /** Timeline jobs: event id -> label, so a swapped-answer fault is described in words. */
  eventLabels?: Readonly<Record<string, string>>;
}

function CheckIds({ ids, tone }: { ids: readonly string[]; tone: 'ok' | 'bad' | 'neutral' }) {
  if (ids.length === 0) return <span className="muted">none</span>;
  return (
    <span className="check-ids">
      {ids.map((id) => {
        const name = checkName(id);
        return name === null
          ? <code key={id} className={`check-id check-id-${tone}`}>{id}</code>
          : <span key={id} className={`check-id check-id-${tone}`} title={id}>{name} <code className="check-code">{id}</code></span>;
      })}
    </span>
  );
}

/** Revision 1 → 2 → 3: what failed, what Muse targeted, fixed and left failing, with an honest label for system-made faults. */
export function RepairTimeline(p: RepairTimelineProps) {
  const steps = buildRepairSteps({
    revisions: p.revisions, repairs: p.repairs, demoFault: p.demoFault, events: p.events,
    publishedRevision: p.publishedRevision, bestRevision: p.bestRevision, eventLabels: p.eventLabels,
  });
  if (steps.length === 0) return null;
  const overall = overallRepairBadge({ publishedRevision: p.publishedRevision, repairs: p.repairs, demoFault: p.demoFault });
  // A run with one revision and no injected fault has nothing to show beyond the validation panel.
  if (steps.length === 1 && p.demoFault === undefined) return null;

  return (
    <section className="card repair-timeline" aria-labelledby="repair-heading">
      <div className="card-head">
        <h3 id="repair-heading">Repair timeline</h3>
        {overall !== null && <span className={`badge badge-${overall.tone}`} data-testid="overall-repair-badge">{overall.tone === 'ok' ? '✓ ' : '⚠ '}{overall.text}</span>}
      </div>
      <p className="muted small">Each revision is validated from scratch by deterministic code. When checks fail, Muse receives the failing checks and returns a corrected revision (at most two repairs).</p>
      {p.demoFault !== undefined && <p className="muted small">{METRICS_NOTE}</p>}

      <ol className="rev-list" aria-label="Revisions">
        {steps.map((s) => {
          const viewing = p.viewing === s.revision;
          return (
            <li key={`${s.revision}-${s.failedAttempt ? 'x' : 'r'}`} className={`rev rev-${s.role}${s.failedAttempt ? ' rev-failed-attempt' : ''}${viewing ? ' rev-viewing' : ''}`}>
              <div className="rev-top">
                <strong>Revision {s.revision}</strong>
                <span className="muted small">{s.role === 'initial' ? 'first draft by Muse' : `repair of revision ${s.repairOf ?? s.revision - 1}`}</span>
                {s.isPublished && <span className="badge badge-ok">Published</span>}
                {s.isBest && <span className="badge badge-bad">Best of a blocked run</span>}
                {s.passed !== null && s.total !== null && (
                  <span className={`status ${s.publishable === true ? 'st-ok' : 'st-bad'}`}>{s.passed}/{s.total} checks{s.publishable === true ? ' · pass' : ' · blocked'}</span>
                )}
              </div>

              {s.faultNotice !== null && (
                <p className="callout callout-fault small" role="note" data-testid="fault-notice">
                  <strong>{s.faultNotice}</strong>
                  {s.faultChange !== null && <><br /><span>{faultChangeLine(s.faultChange)}</span></>}
                </p>
              )}

              {s.badge !== null && s.role === 'repair' && (
                <p><span className={`badge badge-${s.badge.tone}`} data-testid="step-repair-badge">{s.badge.tone === 'ok' ? '✓ ' : '⚠ '}{s.badge.text}</span></p>
              )}

              {s.role === 'initial' && s.failedIds.length > 0 && (
                <p className="small">Failing checks: <CheckIds ids={s.failedIds} tone="bad" /></p>
              )}

              {s.role === 'repair' && (
                <dl className="rev-checks small">
                  <div><dt>Targeted</dt><dd><CheckIds ids={s.targeted} tone="neutral" /></dd></div>
                  <div><dt>Fixed</dt><dd><CheckIds ids={s.fixed} tone="ok" /></dd></div>
                  <div><dt>Remaining</dt><dd><CheckIds ids={s.remaining} tone="bad" /></dd></div>
                </dl>
              )}

              <p className="small rev-outcome">{s.outcome}</p>

              {s.actor !== null && (
                <p className="rev-actor small">
                  {s.actor.model !== null && <span className="tag">{s.actor.model}</span>}{' '}
                  {s.actor.responseId !== null && <span className="tag mono" title={s.actor.responseId}>{shortId(s.actor.responseId)}</span>}{' '}
                  {s.actor.cost !== null && <span className={`tag${s.actor.cost.includes('reserved') || s.actor.cost === 'cost unknown' ? ' tag-warn' : ''}`}>{s.actor.cost}</span>}
                  {s.actor.failed && <span className="tag tag-warn">repair call failed{s.actor.detail !== null ? `: ${s.actor.detail}` : ''}</span>}
                </p>
              )}
              {s.role === 'repair' && s.actor === null && !s.failedAttempt && <p className="muted small">No repair event was recorded for this revision, so its model and cost are unknown.</p>}

              {s.hasReport && (
                <button type="button" className="btn btn-small" aria-pressed={viewing} onClick={() => p.onView(s.revision)}>
                  {viewing ? 'Showing checks below' : `View revision ${s.revision} checks`}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
