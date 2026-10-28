// S5B-07 (Stage 5b review, Wave C) — pure evaluation-budget functions:
// (a) a CONSERVATIVE per-job admission amount derived from config/resource-limits.json
//     via packages/meta/pricing.ts (replacing the fixed, non-conservative USD 0.15 that
//     could not bound a single spec attempt's USD 0.176 reservation), and
// (b) submitted-job journal parsing/reconciliation so a job submitted but never recorded
//     (crash, poll failure) has its cost counted on the next start and its page is never
//     re-submitted while the journaled job is running or finished.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  admissionLimitsFromConfig,
  parseJournalLine,
  perJobAdmissionUSD,
  reconcileJournal,
  recoveredRecord,
} from '../scripts/evaluation-budget.ts';
import type { AdmissionLimits, JournalEntry } from '../scripts/evaluation-budget.ts';
import { reservationUSD } from '../packages/meta/pricing.ts';

const CONFIG = JSON.parse(
  readFileSync(new URL('../config/resource-limits.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const CURRENT: AdmissionLimits = {
  maxInputTokens: 32000,
  maxOutputTokens: 32000,
  analysisMaxOutputTokens: 16000,
  maxRepairAttempts: 2,
  maxRetries: 1,
};

/* ------------------------------------------------------------------ */
/* admissionLimitsFromConfig                                            */
/* ------------------------------------------------------------------ */

test('S5B-07: admissionLimitsFromConfig reads the real resource limits', () => {
  assert.deepEqual(admissionLimitsFromConfig(CONFIG), CURRENT);
});

test('S5B-07: admissionLimitsFromConfig fails closed on invalid config', () => {
  for (const bad of [
    null,
    'x',
    {},
    { ...CURRENT, maxInputTokens: -1 },
    { ...CURRENT, maxInputTokens: Number.NaN },
    { ...CURRENT, maxOutputTokens: Number.POSITIVE_INFINITY },
    { ...CURRENT, analysisMaxOutputTokens: 0 },
    { ...CURRENT, maxRepairAttempts: 1.5 },
    { ...CURRENT, maxRepairAttempts: -1 },
    { ...CURRENT, maxRepairAttempts: 3 }, // above the absolute ≤2 bound (S5-06)
    { ...CURRENT, maxRetries: 2.5 },
    { ...CURRENT, maxRetries: -1 },
    { ...CURRENT, maxInputTokens: '32000' },
  ]) {
    assert.throws(() => admissionLimitsFromConfig(bad), { message: 'ADMISSION_LIMITS_INVALID' }, JSON.stringify(bad));
  }
});

/* ------------------------------------------------------------------ */
/* perJobAdmissionUSD                                                   */
/* ------------------------------------------------------------------ */

test('S5B-07: per-job admission at the current configured limits is the reviewer ceiling USD 1.704', () => {
  const usd = perJobAdmissionUSD(CURRENT);
  // (analysis attempt × (1+repairs) + spec attempt × (1+repairs)) × (1+retries)
  const analysisAttempt = reservationUSD('muse-spark-1.3', 32000, 16000); // 0.108
  const specAttempt = reservationUSD('muse-spark-1.3', 32000, 32000); // 0.176
  assert.ok(Math.abs(analysisAttempt - 0.108) < 1e-12);
  assert.ok(Math.abs(specAttempt - 0.176) < 1e-12);
  assert.ok(Math.abs(usd - 1.704) < 1e-9, `admission ${usd}`);
  // The old fixed 0.15 did not even bound ONE spec attempt (0.176) — the derived
  // amount must always be at least the worst single attempt.
  assert.ok(usd > specAttempt);
});

test('S5B-07: admission scales with repair attempts and transport retries', () => {
  const noLoops: AdmissionLimits = { ...CURRENT, maxRepairAttempts: 0, maxRetries: 0 };
  assert.ok(Math.abs(perJobAdmissionUSD(noLoops) - (0.108 + 0.176)) < 1e-9);
  const oneRetry: AdmissionLimits = { ...CURRENT, maxRepairAttempts: 0, maxRetries: 1 };
  assert.ok(Math.abs(perJobAdmissionUSD(oneRetry) - 2 * (0.108 + 0.176)) < 1e-9);
  const repairsOnly: AdmissionLimits = { ...CURRENT, maxRepairAttempts: 2, maxRetries: 0 };
  assert.ok(Math.abs(perJobAdmissionUSD(repairsOnly) - 3 * (0.108 + 0.176)) < 1e-9);
  // Monotone in every token limit.
  const base = perJobAdmissionUSD(CURRENT);
  assert.ok(perJobAdmissionUSD({ ...CURRENT, maxInputTokens: 33000 }) > base);
  assert.ok(perJobAdmissionUSD({ ...CURRENT, maxOutputTokens: 33000 }) > base);
  assert.ok(perJobAdmissionUSD({ ...CURRENT, analysisMaxOutputTokens: 17000 }) > base);
});

test('S5B-07: perJobAdmissionUSD rejects invalid limits', () => {
  assert.throws(() => perJobAdmissionUSD({ ...CURRENT, maxInputTokens: -5 }), { message: 'ADMISSION_LIMITS_INVALID' });
  assert.throws(() => perJobAdmissionUSD({ ...CURRENT, maxRepairAttempts: 7 }), { message: 'ADMISSION_LIMITS_INVALID' });
});

/* ------------------------------------------------------------------ */
/* journal parsing                                                      */
/* ------------------------------------------------------------------ */

test('S5B-07: parseJournalLine accepts well-formed entries and rejects everything else', () => {
  assert.deepEqual(
    parseJournalLine('{"jobId":"job-1","sourceId":"src-a","at":"2026-10-29T00:00:00.000Z"}'),
    { jobId: 'job-1', sourceId: 'src-a', at: '2026-10-29T00:00:00.000Z' } satisfies JournalEntry,
  );
  for (const bad of [
    '',
    '   ',
    'not json',
    '{}',
    '{"jobId":"j"}',
    '{"sourceId":"s"}',
    '{"jobId":42,"sourceId":"s","at":"x"}',
    '{"jobId":"j","sourceId":7,"at":"x"}',
    '[1,2]',
  ]) {
    assert.equal(parseJournalLine(bad), null, bad);
  }
});

/* ------------------------------------------------------------------ */
/* journal reconciliation                                               */
/* ------------------------------------------------------------------ */

function entry(jobId: string, sourceId: string): JournalEntry {
  return { jobId, sourceId, at: '2026-10-29T00:00:00.000Z' };
}

test('S5B-07: reconcileJournal recovers settled jobs, blocks running ones, flags unresolved ones', () => {
  const journal = [
    entry('job-recorded', 'src-recorded'),
    entry('job-settled', 'src-settled'),
    entry('job-running', 'src-running'),
    entry('job-missing', 'src-missing'),
    entry('job-weird', 'src-weird'),
    entry('job-settled', 'src-settled'), // duplicate submission line for the same job
  ];
  const summaries: Record<string, { status: string; totalCostUSD?: number }> = {
    'job-settled': { status: 'failed', totalCostUSD: 0.1394 },
    'job-running': { status: 'running' },
    'job-weird': { status: 'nonsense' },
  };
  const result = reconcileJournal({
    journal,
    recordedJobIds: new Set(['job-recorded']),
    summaryOf: (jobId) => summaries[jobId],
  });

  // A job that already has a results line is untouched.
  assert.deepEqual(result.recovered.map(r => r.entry.jobId), ['job-settled'], 'deduplicated by jobId');
  assert.equal(result.recovered[0]?.summary.totalCostUSD, 0.1394, 'the recovered cost is available for spentUsd');
  assert.deepEqual(result.running.map(e => e.sourceId), ['src-running']);
  // Unknown status fails closed as unresolved (never re-submitted silently).
  assert.deepEqual(result.unresolved.map(e => e.sourceId).sort(), ['src-missing', 'src-weird']);
});

test('S5B-07: reconcileJournal with an empty journal is a no-op', () => {
  const result = reconcileJournal({ journal: [], recordedJobIds: new Set(), summaryOf: () => undefined });
  assert.deepEqual(result, { recovered: [], running: [], unresolved: [] });
});

/* ------------------------------------------------------------------ */
/* recovered result records                                             */
/* ------------------------------------------------------------------ */

test('S5B-07: recoveredRecord marks the record recovered:true and carries the summary costs', () => {
  const page = {
    sourceId: 'cfpb-saving-post-secondary-education',
    candidate: 12,
    subject: 'finance' as const,
    expected: 'compound-interest-v1',
    acceptable: [] as string[],
    difficulty: 'hard' as const,
  };
  const summary = {
    jobId: 'job-20261028182320-bc3e9bff',
    status: 'failed',
    engine: 'compound-interest-v1',
    publishedRevision: undefined,
    revisions: 3,
    repairs: [{ targeted: ['behavior.tests'], fixed: [] }],
    analysisRepairs: [],
    error: { code: 'VALIDATION_FAILED', message: 'generated spec failed validation' },
    totalCostUSD: 0.139421,
  };
  const record = recoveredRecord(page, summary, '2026-10-29T01:00:00.000Z');
  assert.equal(record.recovered, true);
  assert.equal(record.jobId, 'job-20261028182320-bc3e9bff');
  assert.equal(record.sourceId, page.sourceId);
  assert.equal(record.candidate, 12);
  assert.equal(record.status, 'failed');
  assert.equal(record.engine, 'compound-interest-v1');
  assert.equal(record.error, 'VALIDATION_FAILED');
  assert.equal(record.totalCostUSD, 0.139421);
  assert.equal(record.publishedRevision, null);
  assert.equal(record.wallS, null);
  assert.equal(record.at, '2026-10-29T01:00:00.000Z');
  assert.deepEqual(record.repairs, [{ targeted: ['behavior.tests'], fixed: [] }]);
  // A non-numeric cost never becomes 0-by-assumption.
  const noCost = recoveredRecord(page, { ...summary, totalCostUSD: undefined }, '2026-10-29T01:00:00.000Z');
  assert.equal(noCost.totalCostUSD, null);
});
