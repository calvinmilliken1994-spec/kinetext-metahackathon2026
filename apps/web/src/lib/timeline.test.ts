/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, rowLabel } from './jobs.ts';
import { stageCostLabel } from './cost.ts';
import type { StageEvent } from '../../../../packages/contracts/index.ts';

const ev = (seq: number, stage: StageEvent['stage'], status: StageEvent['status'], at: string, extra: Partial<StageEvent> = {}): StageEvent =>
  ({ jobId: 'j', seq, stage, status, at, ...extra });

const T = (s: number): string => new Date(Date.UTC(2026, 9, 28, 0, 0, s)).toISOString();

test('buildTimeline (Stage 5): one validate/repair row per revision, in emitted order, with a labelled inject row', () => {
  const events = [
    ev(0, 'specify', 'started', T(0)),
    ev(1, 'specify', 'succeeded', T(10), { model: 'muse-spark-1.3', estCostUSD: 0.03 }),
    ev(2, 'inject', 'succeeded', T(10), { revision: 1, detail: 'demo fault injected by the system: wrong-answer at behavioralTests[0].expectedLiftN' }),
    ev(3, 'validate', 'started', T(10), { revision: 1 }),
    ev(4, 'validate', 'failed', T(10), { revision: 1, detail: 'VALIDATION_FAILED; failed checks: behavior.tests' }),
    ev(5, 'repair', 'started', T(10), { revision: 2, detail: 'targeted checks: behavior.tests' }),
    ev(6, 'repair', 'succeeded', T(20), { revision: 2, model: 'muse-spark-1.3', estCostUSD: 0.02, detail: 'repaired revision 1' }),
    ev(7, 'validate', 'started', T(20), { revision: 2 }),
    ev(8, 'validate', 'succeeded', T(20), { revision: 2, detail: '15/15 checks passed' }),
    ev(9, 'done', 'succeeded', T(20), { detail: 'publishable after repair (revision 2)' }),
  ];
  const rows = buildTimeline(events, 'succeeded');
  assert.deepEqual(rows.map((r) => [r.stage, r.revision, r.status]), [
    ['specify', undefined, 'succeeded'],
    ['inject', 1, 'succeeded'],
    ['validate', 1, 'failed'],
    ['repair', 2, 'succeeded'],
    ['validate', 2, 'succeeded'],
    ['done', undefined, 'succeeded'],
  ]);
  const repair = rows[3];
  assert.ok(repair !== undefined);
  assert.equal(repair.durationMs, 10000);
  assert.equal(repair.model, 'muse-spark-1.3');
  assert.equal(stageCostLabel(repair), '$0.0200 est.');
  assert.equal(rowLabel(rows[1]!), 'Demo fault (system-injected)');
  assert.equal(rowLabel(rows[2]!), 'Validate · revision 1');
  assert.equal(rowLabel(rows[3]!), 'Repair · revision 2');
  assert.equal(rowLabel(rows[0]!), 'Specify activity');
});

test('buildTimeline (Stage 5): a running repair shows as running and a failed repair keeps its reservation honesty', () => {
  const running = buildTimeline([
    ev(0, 'validate', 'failed', T(0), { revision: 1 }),
    ev(1, 'repair', 'started', T(1), { revision: 2 }),
  ], 'running');
  const repair = running.find((r) => r.stage === 'repair');
  assert.equal(repair?.status, 'running');
  assert.equal(repair?.revision, 2);
  const failed = buildTimeline([
    ev(0, 'repair', 'started', T(0), { revision: 2 }),
    ev(1, 'repair', 'failed', T(5), { revision: 2, model: 'muse-spark-1.3', detail: 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)' }),
  ], 'failed');
  assert.equal(failed.length, 1);
  assert.equal(stageCostLabel(failed[0]!), 'cost unknown'); // never implies the failed repair was free
});

test('buildTimeline: events without a revision (Stage 2 runs) still collapse to one row per stage', () => {
  const rows = buildTimeline([
    ev(0, 'validate', 'started', T(0)),
    ev(1, 'validate', 'succeeded', T(1), { detail: '14/14 checks passed' }),
  ], 'succeeded');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.revision, undefined);
  assert.equal(rowLabel(rows[0]!), 'Validate');
});
