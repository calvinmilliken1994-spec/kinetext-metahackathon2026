// Cost display helpers (pure). Honesty rules (TASK-009 R-09):
//  - null / undefined / non-finite cost is 'unknown', never '$0';
//  - a charge made at a reservation (outcome uncertain) is shown as such, never hidden in a bare total;
//  - a failed model stage with no recorded cost says so instead of implying it was free.

import type { StageEvent } from '../../../../packages/contracts/index.ts';
import { formatCostUSD, totalEventCost } from './jobs.ts';
import type { JobStatus, TimelineRow } from './jobs.ts';

export const UNKNOWN_COST = 'unknown';

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** '$0.0276', or 'unknown' for null / undefined / NaN / Infinity. */
export function formatMaybeCostUSD(usd: number | null | undefined): string {
  return finite(usd) ? formatCostUSD(usd) : UNKNOWN_COST;
}

/** Reserved-for-uncertain-outcome part; a missing field (job recorded before the fix) is 0. */
export function reservedPart(reservedUnknownUSD: number | null | undefined): number {
  return finite(reservedUnknownUSD) && reservedUnknownUSD > 0 ? reservedUnknownUSD : 0;
}

export interface CostInput {
  totalCostUSD: number | null | undefined;
  reservedUnknownUSD?: number | null | undefined;
  /** An INTERRUPTED job may have had a call in flight whose cost was never recorded. */
  interrupted?: boolean;
}

/**
 * e.g. '$0.0276 (includes $0.0276 reserved for an uncertain outcome)'.
 * Interrupted jobs get ' · may be incomplete'. Unknown total → 'unknown'.
 */
export function describeJobCost(c: CostInput): string {
  if (!finite(c.totalCostUSD)) return UNKNOWN_COST;
  let text = formatCostUSD(c.totalCostUSD);
  const reserved = reservedPart(c.reservedUnknownUSD);
  if (reserved > 0) text += ` (includes ${formatCostUSD(reserved)} reserved for an uncertain outcome)`;
  if (c.interrupted === true) text += ' · may be incomplete';
  return text;
}

const RESERVATION_MARK = 'cost basis: reservation';
const MODEL_STAGES: ReadonlySet<string> = new Set(['analyze', 'specify', 'repair']);

/** True when the stage's event detail says its charge was a reservation (outcome uncertain). */
export function isReservedDetail(detail: string | undefined): boolean {
  return detail !== undefined && detail.includes(RESERVATION_MARK);
}

/**
 * Per-stage cost tag text, or null when there is nothing to say.
 * A recorded amount is always shown (also on failed stages). A failed model stage without one is 'cost unknown'.
 */
export function stageCostLabel(row: Pick<TimelineRow, 'stage' | 'status' | 'estCostUSD' | 'detail'>): string | null {
  const reserved = isReservedDetail(row.detail);
  if (finite(row.estCostUSD)) {
    return reserved
      ? `${formatCostUSD(row.estCostUSD)} reserved (outcome uncertain)`
      : `${formatCostUSD(row.estCostUSD)} est.`;
  }
  if (reserved || (row.status === 'failed' && MODEL_STAGES.has(row.stage))) return 'cost unknown';
  return null;
}

export interface TimelineTotal {
  text: string;
  /** True while a running job has not reported any cost yet. */
  pending: boolean;
}

/**
 * Timeline footer. While running: the sum of reported event costs (or pending). Once finished: the job
 * summary total is authoritative (it includes reservations), falling back to event costs, else 'unknown'.
 */
export function timelineTotal(
  events: readonly StageEvent[],
  jobStatus: JobStatus,
  summary: CostInput,
): TimelineTotal {
  const eventCost = totalEventCost(events);
  if (jobStatus === 'running') {
    return eventCost === null
      ? { text: '— (pending)', pending: true }
      : { text: formatCostUSD(eventCost), pending: false };
  }
  const total = finite(summary.totalCostUSD) ? summary.totalCostUSD : eventCost;
  const input: CostInput = { totalCostUSD: total };
  if (summary.reservedUnknownUSD !== undefined) input.reservedUnknownUSD = summary.reservedUnknownUSD;
  if (summary.interrupted !== undefined) input.interrupted = summary.interrupted;
  return { text: describeJobCost(input), pending: false };
}
