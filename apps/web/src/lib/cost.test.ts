/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeJobCost, formatMaybeCostUSD, isReservedDetail, reservedPart, stageCostLabel, timelineTotal } from './cost.ts';
import type { StageEvent } from '../../../../packages/contracts/index.ts';

const ev = (seq: number, stage: StageEvent['stage'], status: StageEvent['status'], extra: Partial<StageEvent> = {}): StageEvent =>
  ({ jobId: 'j', seq, stage, status, at: '2026-10-27T00:00:00.000Z', ...extra });

test('formatMaybeCostUSD: null / undefined / NaN are "unknown", never $0', () => {
  assert.equal(formatMaybeCostUSD(null), 'unknown');
  assert.equal(formatMaybeCostUSD(undefined), 'unknown');
  assert.equal(formatMaybeCostUSD(Number.NaN), 'unknown');
  assert.equal(formatMaybeCostUSD(0.0276), '$0.0276');
  assert.equal(formatMaybeCostUSD(0), '$0');
});

test('reservedPart: missing field (old job.json) counts as 0', () => {
  assert.equal(reservedPart(undefined), 0);
  assert.equal(reservedPart(null), 0);
  assert.equal(reservedPart(0), 0);
  assert.equal(reservedPart(0.0276), 0.0276);
});

test('describeJobCost without reservation', () => {
  assert.equal(describeJobCost({ totalCostUSD: 0.0455 }), '$0.0455');
  assert.equal(describeJobCost({ totalCostUSD: 0.0455, reservedUnknownUSD: 0 }), '$0.0455');
});

test('describeJobCost with reservedUnknownUSD', () => {
  assert.equal(
    describeJobCost({ totalCostUSD: 0.0276, reservedUnknownUSD: 0.0276 }),
    '$0.0276 (includes $0.0276 reserved for an uncertain outcome)',
  );
  assert.equal(
    describeJobCost({ totalCostUSD: 0.0731, reservedUnknownUSD: 0.0276 }),
    '$0.0731 (includes $0.0276 reserved for an uncertain outcome)',
  );
});

test('describeJobCost: null/undefined total is unknown; interrupted is flagged incomplete', () => {
  assert.equal(describeJobCost({ totalCostUSD: null }), 'unknown');
  assert.equal(describeJobCost({ totalCostUSD: undefined, reservedUnknownUSD: 0.01 }), 'unknown');
  assert.equal(describeJobCost({ totalCostUSD: 0.0173, interrupted: true }), '$0.0173 · may be incomplete');
  assert.equal(
    describeJobCost({ totalCostUSD: 0.02, reservedUnknownUSD: 0.02, interrupted: true }),
    '$0.0200 (includes $0.0200 reserved for an uncertain outcome) · may be incomplete',
  );
});

test('stageCostLabel: failed stage with an amount shows it (never $0); reservation is labelled', () => {
  assert.equal(stageCostLabel({ stage: 'analyze', status: 'succeeded', estCostUSD: 0.0174 }), '$0.0174 est.');
  assert.equal(
    stageCostLabel({ stage: 'analyze', status: 'failed', estCostUSD: 0.027565, detail: 'META_TIMEOUT; cost basis: reservation (outcome uncertain)' }),
    '$0.0276 reserved (outcome uncertain)',
  );
  assert.equal(stageCostLabel({ stage: 'specify', status: 'failed', estCostUSD: 0.01, detail: 'META_HTTP_ERROR' }), '$0.0100 est.');
});

test('stageCostLabel: failed model stage without a recorded cost is "cost unknown"; other stages say nothing', () => {
  assert.equal(stageCostLabel({ stage: 'analyze', status: 'failed', detail: 'META_TIMEOUT' }), 'cost unknown');
  assert.equal(stageCostLabel({ stage: 'specify', status: 'failed' }), 'cost unknown');
  assert.equal(stageCostLabel({ stage: 'analyze', status: 'failed', detail: 'X; cost basis: reservation (outcome uncertain)' }), 'cost unknown');
  assert.equal(stageCostLabel({ stage: 'ingest', status: 'succeeded' }), null);
  assert.equal(stageCostLabel({ stage: 'validate', status: 'failed', detail: 'VALIDATION_FAILED' }), null);
  assert.equal(isReservedDetail('A; cost basis: reservation (outcome uncertain)'), true);
  assert.equal(isReservedDetail('A'), false);
  assert.equal(isReservedDetail(undefined), false);
});

test('timelineTotal: finished jobs use the summary total incl. reservations (the R-09 $0 regression)', () => {
  // failed analysis whose only charge was a reservation: events carry no usage cost, summary has it
  const events = [ev(0, 'analyze', 'started'), ev(1, 'analyze', 'failed', { detail: 'META_TIMEOUT' })];
  const t = timelineTotal(events, 'failed', { totalCostUSD: 0.027565, reservedUnknownUSD: 0.027565 });
  assert.equal(t.text, '$0.0276 (includes $0.0276 reserved for an uncertain outcome)');
  assert.equal(t.pending, false);
});

test('timelineTotal: unknown total with no event costs is "unknown"; running without cost is pending', () => {
  assert.equal(timelineTotal([], 'failed', { totalCostUSD: null }).text, 'unknown');
  assert.equal(timelineTotal([], 'failed', { totalCostUSD: undefined }).text, 'unknown');
  const running = timelineTotal([ev(0, 'ingest', 'started')], 'running', { totalCostUSD: 0 });
  assert.deepEqual(running, { text: '— (pending)', pending: true });
  const runningWithCost = timelineTotal([ev(0, 'analyze', 'succeeded', { estCostUSD: 0.0173595 })], 'running', { totalCostUSD: 0 });
  assert.equal(runningWithCost.text, '$0.0174');
});

test('timelineTotal: falls back to event costs when the summary total is not a number; flags interrupted', () => {
  const events = [ev(0, 'analyze', 'succeeded', { estCostUSD: 0.0173595 })];
  assert.equal(timelineTotal(events, 'succeeded', { totalCostUSD: null }).text, '$0.0174');
  assert.equal(timelineTotal(events, 'failed', { totalCostUSD: 0.0174, interrupted: true }).text, '$0.0174 · may be incomplete');
  // old job.json without reservedUnknownUSD behaves as 0
  assert.equal(timelineTotal(events, 'succeeded', { totalCostUSD: 0.0174 }).text, '$0.0174');
});
