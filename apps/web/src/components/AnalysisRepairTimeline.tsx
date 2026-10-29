import type { AnalysisRepairOverall, AnalysisRepairStep, CheckRef } from '../lib/analysisRepairs.ts';
import { ANALYSIS_UNCHANGED_NAME, analysisRepairBadge, analysisRepairCostUSD, naturalRepairNoteParts, stepCostLabel } from '../lib/analysisRepairs.ts';
import { formatCostUSD, shortId } from '../lib/jobs.ts';
import { modelRunTag, repairedByLine } from '../lib/models.ts';
import type { JobModel } from '../lib/models.ts';

export interface AnalysisRepairTimelineProps {
  steps: readonly AnalysisRepairStep[];
  overall: AnalysisRepairOverall;
  /** The model that made this job: named on the repair attempts. */
  model: JobModel;
}

function Checks({ checks, tone }: { checks: readonly CheckRef[]; tone: 'ok' | 'bad' | 'neutral' }) {
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
 * Source-analysis repairs (TASK-024c): Muse's first analysis failed a check → what failed, in words → Muse's repair
 * (a before/after diff) → checks passed. A NATURAL repair: Muse's own mistake, never a system-made demo fault.
 */
export function AnalysisRepairTimeline({ steps, overall, model }: AnalysisRepairTimelineProps) {
  if (steps.length === 0) return null;
  const badge = analysisRepairBadge(overall);
  const total = analysisRepairCostUSD(steps);
  const note = naturalRepairNoteParts(overall.state);
  return (
    <section className="card repair-timeline analysis-repair" aria-labelledby="analysis-repair-heading" data-testid="analysis-repair">
      <div className="card-head">
        <h3 id="analysis-repair-heading">Analysis repair</h3>
        {badge !== null && (
          <span className={`badge badge-${badge.tone}`} data-testid="analysis-repair-badge">{badge.tone === 'natural' ? '✓ ' : '⚠ '}{badge.text}</span>
        )}
      </div>
      <p className="muted small">Before an activity is written, deterministic code checks Muse’s analysis of the source. When a check fails, Muse receives it and returns a corrected analysis (at most two repairs).</p>
      <p className={`callout ${overall.state === 'failed' ? 'callout-error' : 'callout-natural'} small`} role="note" data-testid="natural-note">
        <strong>{note.lead}.</strong>{' '}{note.body}
      </p>
      <p className="small repair-model" data-testid="repair-model">{repairedByLine(model, 'analysis')}</p>
      {total !== null && <p className="muted small">Analysis repair cost: <strong>{formatCostUSD(total)} est.</strong> (included in the run total)</p>}

      <ol className="rev-list" aria-label="Analysis repair attempts">
        {steps.map((s) => (
          <li key={s.revision} className={`rev rev-analysis rev-analysis-${s.state}`} data-testid="analysis-repair-step">
            <div className="rev-top">
              <strong>Repair attempt {s.attempt}</strong>
              <span className="muted small">of the {s.repairOf === 1 ? 'first analysis' : `analysis from attempt ${s.repairOf - 1}`}</span>
              {s.state === 'passed' && <span className="status st-ok">Checks passed</span>}
              {s.state === 'still-failing' && <span className="status st-bad">Still failing</span>}
              {s.state === 'call-failed' && <span className="status st-bad">No usable repair</span>}
              {s.state === 'running' && <span className="status st-warn">Running…</span>}
            </div>

            <ol className="flow small">
              <li>
                <strong>{s.attempt === 1 ? 'Muse’s first analysis failed a check' : `Muse’s attempt ${s.attempt - 1} still failed`}</strong>
                {s.failedBefore.length === 0 && <p className="muted">The failing checks were not stored for this analysis.</p>}
                <ul className="fail-list">
                  {s.failedBefore.map((f) => (
                    <li key={f.id}>
                      <span className="check-id check-id-bad" title={f.id}>{f.name !== f.id && <>{f.name} </>}<code className="check-code">{f.id}</code></span>
                      {f.plain !== null && <span className="plain"> {f.plain}</span>}
                      {f.message !== null && <span className="muted"> Checker said: <q className="checker-msg">{f.message}</q></span>}
                    </li>
                  ))}
                </ul>
              </li>

              <li>
                <strong>Muse’s repair{s.hasDiff ? `: ${s.changes.length === 0 ? 'nothing changed' : `${s.changes.length} ${s.changes.length === 1 ? 'change' : 'changes'}`}` : ''}</strong>
                {s.state === 'call-failed' && <p>Muse’s repair call returned no usable analysis; the earlier analysis stays as it was.</p>}
                {s.state === 'running' && <p className="muted">Muse is repairing the analysis…</p>}
                {s.state !== 'call-failed' && s.state !== 'running' && !s.hasDiff && <p className="muted">The earlier analysis was not stored, so the exact change cannot be shown.</p>}
                {s.hasDiff && s.changes.length > 0 && (
                  <ul className="diff-list" aria-label="What changed">
                    {s.changes.map((c, i) => (
                      <li key={`${c.kind}-${i}`} className="diff-row">
                        <span className="diff-label">{c.label}</span>
                        {c.before !== null && <span className="diff-side"><del className="diff-del">{c.kind === 'decision' ? c.before : `“${c.before}”`}</del>{c.beforeNote !== undefined && <span className="muted"> ({c.beforeNote})</span>}</span>}
                        {c.before === null && <span className="muted">added</span>}
                        <span aria-hidden="true" className="diff-arrow">{c.after === null ? '✕' : '→'}</span>
                        {c.after !== null && <span className="diff-side"><ins className="diff-ins">{c.kind === 'decision' ? c.after : `“${c.after}”`}</ins>{c.afterNote !== undefined && <span className="muted"> ({c.afterNote})</span>}</span>}
                        {c.after === null && <span className="muted">removed</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.state === 'passed' && s.hasDiff && s.changes.length > 0 && <p className="muted">Everything else in the analysis is unchanged (checked by “{ANALYSIS_UNCHANGED_NAME}”).</p>}
              </li>

              <li>
                <strong>{s.state === 'passed' ? 'Checks passed' : s.state === 'call-failed' ? 'Checks' : s.state === 'running' ? 'Checks' : 'Checks after the repair'}</strong>
                {s.after !== null ? (
                  <>
                    <p className={s.state === 'passed' ? '' : 'plain'}>{s.after.passed}/{s.after.total} checks pass.{s.state === 'passed' ? '' : ' The analysis was not accepted.'}</p>
                    <ul className="after-checks">
                      {s.after.checks.map((c) => (
                        <li key={c.id} className={c.passed ? 'after-ok' : 'after-bad'}>
                          <span className={`check-icon ${c.passed ? 'ok' : 'bad'}`} role="img" aria-label={c.passed ? 'passed' : 'failed'}>{c.passed ? '✓' : '✗'}</span>{' '}
                          {c.name !== c.id && <>{c.name} </>}<code className="check-code">{c.id}</code>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="muted">{s.state === 'running' ? 'Waiting for the repaired analysis.' : 'No repaired analysis to check.'}</p>
                )}
                {s.introduced.length > 0 && <p className="small">New failures: <Checks checks={s.introduced} tone="bad" /></p>}
              </li>
            </ol>

            <p className="small rev-outcome">{s.outcome}</p>
            {s.actor !== null && (
              <p className="rev-actor small" aria-label="Repair call">
                <span className="tag">Repair call</span>{' '}
                {s.actor.model !== null && <span className={`tag tag-model-${modelRunTag(model).tone}`} title={model.label}>{model.name}</span>}{' '}
                {s.actor.model !== null && <span className="tag mono" title="Model string sent to the provider">{model.providerModel}</span>}{' '}
                {s.actor.responseId !== null && <span className="tag mono" title={s.actor.responseId}>{shortId(s.actor.responseId)}</span>}{' '}
                {stepCostLabel(s) !== null && <span className={`tag${stepCostLabel(s) === 'cost unknown' ? ' tag-warn' : ''}`} data-testid="analysis-repair-cost">{stepCostLabel(s)}</span>}
                {s.actor.failed && <span className="tag tag-warn">repair call failed{s.actor.detail !== null ? `: ${s.actor.detail}` : ''}</span>}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
