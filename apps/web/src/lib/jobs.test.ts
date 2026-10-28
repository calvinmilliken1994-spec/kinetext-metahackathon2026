/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, formatCostUSD, formatDuration, INTERRUPTED_TEXT, isInterrupted, jobStatusLabel, newestFirst, pickDefaultJob, rowLabel, runBadge, shortId, totalEventCost } from './jobs.ts';
import type { StageEvent } from '../../../../packages/contracts/index.ts';
import type { TimelineRow } from './jobs.ts';

const usage = { promptTokens: 10, completionTokens: 20, reasoningTokens: 15, cachedTokens: 0 };
const ev = (seq: number, stage: StageEvent['stage'], status: StageEvent['status'], at: string, extra: Partial<StageEvent> = {}): StageEvent =>
  ({ jobId: 'j', seq, stage, status, at, ...extra });

test('runBadge: Live run only for ids started in this session', () => {
  const live = new Set(['job-a']);
  const fmt = (iso: string) => `FMT(${iso})`;
  assert.deepEqual(runBadge({ jobId: 'job-a', createdAt: '2026-10-26T23:40:08.280Z' }, live, fmt), { kind: 'live', label: 'Live run' });
  assert.deepEqual(runBadge({ jobId: 'job-b', createdAt: '2026-10-26T23:40:08.280Z' }, live, fmt), {
    kind: 'recorded',
    label: 'Recorded run · FMT(2026-10-26T23:40:08.280Z)',
  });
  assert.equal(runBadge({ jobId: 'job-a', createdAt: 'x' }, new Set(), fmt).kind, 'recorded');
});

test('runBadge default formatter yields a local date-time string', () => {
  const b = runBadge({ jobId: 'old', createdAt: '2026-10-26T23:40:08.280Z' }, new Set());
  assert.ok(b.label.startsWith('Recorded run · '));
  assert.ok(b.label.length > 'Recorded run · '.length);
});

test('buildTimeline uses only real events, with durations and per-stage metadata', () => {
  const events = [
    ev(0, 'ingest', 'started', '2026-10-26T23:40:08.281Z'),
    ev(1, 'ingest', 'succeeded', '2026-10-26T23:40:08.285Z'),
    ev(2, 'analyze', 'started', '2026-10-26T23:40:08.285Z'),
    ev(3, 'analyze', 'succeeded', '2026-10-26T23:40:20.801Z', { model: 'muse-spark-1.3', responseId: 'chatcmpl-abcdef0123456789', usage, latencyMs: 12510, estCostUSD: 0.0173595, detail: 'ok' }),
    ev(4, 'done', 'succeeded', '2026-10-26T23:40:20.802Z', { detail: 'unsupported' }),
  ];
  const rows = buildTimeline(events, 'unsupported');
  assert.deepEqual(rows.map((r) => r.stage), ['ingest', 'analyze', 'done']); // no invented specify/validate rows
  assert.equal(rows[0]?.durationMs, 4);
  const analyze = rows[1];
  assert.equal(analyze?.durationMs, 12516);
  assert.equal(analyze?.model, 'muse-spark-1.3');
  assert.equal(analyze?.latencyMs, 12510);
  assert.deepEqual(analyze?.usage, usage);
  assert.equal(rows[2]?.durationMs, null);
});

test('buildTimeline shows running + pending stages only while the job runs', () => {
  const events = [
    ev(0, 'ingest', 'started', '2026-10-26T23:40:08.281Z'),
    ev(1, 'ingest', 'succeeded', '2026-10-26T23:40:08.285Z'),
    ev(2, 'analyze', 'started', '2026-10-26T23:40:08.285Z'),
  ];
  const rows = buildTimeline(events, 'running');
  assert.deepEqual(rows.map((r) => [r.stage, r.status]), [
    ['ingest', 'succeeded'], ['analyze', 'running'], ['specify', 'pending'], ['validate', 'pending'], ['done', 'pending'],
  ]);
  assert.equal(rows[1]?.durationMs, null);
  assert.equal(buildTimeline([], 'failed').length, 0);
});

test('buildTimeline surfaces failure and repair rows only when emitted', () => {
  const events = [
    ev(0, 'validate', 'started', '2026-10-26T00:00:00.000Z'),
    ev(1, 'validate', 'failed', '2026-10-26T00:00:00.010Z', { detail: '2/13 failed' }),
    ev(2, 'repair', 'started', '2026-10-26T00:00:00.020Z'),
  ];
  const rows = buildTimeline(events, 'failed');
  assert.deepEqual(rows.map((r) => [r.stage, r.status]), [['validate', 'failed'], ['repair', 'running']]);
  assert.equal(rows[0]?.detail, '2/13 failed');
});

test('totalEventCost sums reported costs; unknown stays null (never zero)', () => {
  assert.equal(totalEventCost([ev(0, 'ingest', 'started', 'x')]), null);
  const t = totalEventCost([ev(0, 'analyze', 'succeeded', 'x', { estCostUSD: 0.01 }), ev(1, 'specify', 'succeeded', 'x', { estCostUSD: 0.02 })]);
  assert.ok(t !== null && Math.abs(t - 0.03) < 1e-12);
});

test('shortId / cost / duration formatting', () => {
  assert.equal(shortId('chatcmpl-01a17a96-6174-7530-8e23-1d847fadf1e3'), '…7fadf1e3');
  assert.equal(shortId('abc'), 'abc');
  assert.equal(formatCostUSD(0.0455), '$0.0455');
  assert.equal(formatCostUSD(0.0173595), '$0.0174');
  assert.equal(formatCostUSD(0.5), '$0.500');
  assert.equal(formatDuration(4), '4 ms');
  assert.equal(formatDuration(12510), '12.5 s');
  assert.equal(formatDuration(4103), '4.10 s');
});

test('isInterrupted / jobStatusLabel: INTERRUPTED is shown as Interrupted, not a plain failure', () => {
  const interrupted = { status: 'failed' as const, error: { code: 'INTERRUPTED' } };
  assert.equal(isInterrupted(interrupted), true);
  assert.equal(isInterrupted({ status: 'failed', error: { code: 'META_TIMEOUT' } }), false);
  assert.equal(isInterrupted({ status: 'failed' }), false);
  assert.equal(isInterrupted({ status: 'running', error: { code: 'INTERRUPTED' } }), false);
  assert.deepEqual(jobStatusLabel(interrupted), { text: 'Interrupted', tone: 'warn' });
  assert.deepEqual(jobStatusLabel({ status: 'failed', error: { code: 'VALIDATION_FAILED' } }), { text: 'Failed', tone: 'bad' });
  assert.equal(INTERRUPTED_TEXT, 'Interrupted — the server stopped before this job finished.');
});

test('jobStatusLabel: succeeded shows machine-check counts, never "Verified"', () => {
  assert.deepEqual(jobStatusLabel({ status: 'succeeded', checksPassed: 14, checksTotal: 14 }), { text: 'Checks 14/14', tone: 'ok' });
  assert.deepEqual(jobStatusLabel({ status: 'succeeded', checksPassed: 13, checksTotal: 14 }), { text: 'Checks 13/14', tone: 'warn' });
  assert.deepEqual(jobStatusLabel({ status: 'succeeded' }), { text: 'Succeeded', tone: 'ok' });
  assert.deepEqual(jobStatusLabel({ status: 'running' }), { text: 'Running', tone: 'running' });
  assert.deepEqual(jobStatusLabel({ status: 'running' }, true), { text: 'Running', tone: 'running' });
  // server says idle → the 'running' record is stale
  assert.deepEqual(jobStatusLabel({ status: 'running' }, false), { text: 'Stale (not running)', tone: 'warn' });
  assert.deepEqual(jobStatusLabel({ status: 'unsupported' }), { text: 'Not supported yet', tone: 'warn' });
});

test('newestFirst / pickDefaultJob prefer running, then newest succeeded', () => {
  const jobs = [
    { jobId: 'a', status: 'failed' as const, createdAt: '2026-10-27T00:00:00Z' },
    { jobId: 'b', status: 'succeeded' as const, createdAt: '2026-10-26T00:00:00Z' },
    { jobId: 'c', status: 'succeeded' as const, createdAt: '2026-10-25T00:00:00Z' },
  ];
  assert.deepEqual(newestFirst(jobs).map((j) => j.jobId), ['a', 'b', 'c']);
  assert.equal(pickDefaultJob(jobs, false)?.jobId, 'b');
  assert.equal(pickDefaultJob([...jobs, { jobId: 'r', status: 'running' as const, createdAt: '2026-10-20T00:00:00Z' }], true)?.jobId, 'r');
  // a stale 'running' record is ignored when the server says it is not busy
  assert.equal(pickDefaultJob([...jobs, { jobId: 'r', status: 'running' as const, createdAt: '2026-10-20T00:00:00Z' }], false)?.jobId, 'b');
  assert.equal(pickDefaultJob([], true), null);
  assert.equal(pickDefaultJob([jobs[0] as (typeof jobs)[number]], false)?.jobId, 'a');
});

// ---- TASK-024c: analysis repair rows sit between Analyse and Specify, labelled as their own step -------------------

test('buildTimeline: analysis repair is its own step between Analyse and Specify; Analyse excludes the repair time', () => {
  const events = [
    ev(0, 'ingest', 'started', '2026-10-28T18:17:32.646Z'),
    ev(1, 'ingest', 'succeeded', '2026-10-28T18:17:32.650Z'),
    ev(2, 'analyze', 'started', '2026-10-28T18:17:32.651Z'),
    ev(3, 'repair', 'started', '2026-10-28T18:17:43.840Z', { target: 'analysis', revision: 2 }),
    ev(4, 'repair', 'succeeded', '2026-10-28T18:17:53.270Z', { target: 'analysis', revision: 2, model: 'muse-spark-1.3', estCostUSD: 0.0105, detail: 'analysis repair 1 passed; 7/7 checks passed' }),
    ev(5, 'analyze', 'succeeded', '2026-10-28T18:17:53.272Z', { model: 'muse-spark-1.3', estCostUSD: 0.0115, detail: 'supported; checks 7/7 passed' }),
    ev(6, 'specify', 'started', '2026-10-28T18:17:53.273Z'),
    ev(7, 'specify', 'succeeded', '2026-10-28T18:18:27.261Z'),
    // a SPEC repair with the same revision number gets its own row
    ev(8, 'repair', 'started', '2026-10-28T18:18:28.000Z', { revision: 2 }),
    ev(9, 'repair', 'succeeded', '2026-10-28T18:18:30.000Z', { revision: 2 }),
  ];
  const rows = buildTimeline(events, 'succeeded');
  assert.deepEqual(rows.map((r) => [r.stage, r.target ?? null, r.revision ?? null]), [
    ['ingest', null, null], ['analyze', null, null], ['repair', 'analysis', 2], ['specify', null, null], ['repair', null, 2],
  ]);
  assert.equal(rows[2]?.durationMs, 9430);
  assert.equal(rows[2]?.status, 'succeeded');
  assert.equal(rows[1]?.durationMs, 20621 - 9430); // 11 s of analysis, not the repair on top
  assert.equal(rowLabel(rows[2] as TimelineRow), 'Repair analysis · attempt 1');
  assert.equal(rowLabel(rows[4] as TimelineRow), 'Repair · revision 2');
  assert.equal(rowLabel(rows[1] as TimelineRow), 'Analyse source');
});

test('buildTimeline: an analysis repair that still failed its checks is shown as failed, not as a green tick', () => {
  const events = [
    ev(0, 'analyze', 'started', '2026-10-28T00:00:00.000Z'),
    ev(1, 'repair', 'started', '2026-10-28T00:00:10.000Z', { target: 'analysis', revision: 2 }),
    ev(2, 'repair', 'succeeded', '2026-10-28T00:00:20.000Z', { target: 'analysis', revision: 2, detail: 'analysis repair 1 still failing checks: analysis.concept-ids' }),
    ev(3, 'analyze', 'failed', '2026-10-28T00:00:20.001Z', { detail: 'ANALYSIS_INVALID' }),
  ];
  const withRecord = buildTimeline(events, 'failed', [{ revision: 2, passed: false }]);
  assert.equal(withRecord.find((r) => r.stage === 'repair')?.status, 'failed');
  const detailOnly = buildTimeline(events, 'failed');
  assert.equal(detailOnly.find((r) => r.stage === 'repair')?.status, 'failed');
});
