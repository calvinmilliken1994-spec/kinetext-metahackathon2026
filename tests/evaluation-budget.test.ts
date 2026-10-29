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
  admissionAllowed,
  admissionLimitsFromConfig,
  assessLiabilities,
  classifyJournalLine,
  DEFAULT_EVAL_CONCURRENCY,
  describeLiability,
  evalConcurrencyFromArgv,
  evalModelFromArgv,
  parseJournal,
  parseJournalLine,
  perJobAdmissionUSD,
  PROVIDER_FOR_MODEL,
  reconcileJournal,
  recoveredRecord,
} from '../scripts/evaluation-budget.ts';
import type { AdmissionLimits, JournalEntry, Liability, ParsedJournal } from '../scripts/evaluation-budget.ts';
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
  // S6-W: the lesson-flow input bound from config/resource-limits.json (passed through).
  maxInputTokensV2: 72000,
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

/* ------------------------------------------------------------------ */
/* S5B-14: journal classification (job / intent / resolution / malformed) */
/* ------------------------------------------------------------------ */

test('S5B-14: classifyJournalLine sorts job, intent, resolution, malformed and blank lines', () => {
  assert.deepEqual(classifyJournalLine('{"jobId":"j1","sourceId":"s","at":"t"}'), {
    kind: 'job',
    entry: { jobId: 'j1', sourceId: 's', at: 't' },
  });
  assert.deepEqual(classifyJournalLine('{"jobId":"j1","sourceId":"s","intentId":"i1","at":"t"}'), {
    kind: 'job',
    entry: { jobId: 'j1', sourceId: 's', at: 't', intentId: 'i1' },
  });
  assert.deepEqual(classifyJournalLine('{"intentId":"i1","sourceId":"s","at":"t"}'), {
    kind: 'intent',
    entry: { intentId: 'i1', sourceId: 's', at: 't' },
  });
  assert.deepEqual(classifyJournalLine('{"intentId":"i1","resolution":"not-submitted"}'), {
    kind: 'resolution',
    entry: { intentId: 'i1', resolution: 'not-submitted', at: '' },
  });
  // Blank lines are not liabilities.
  assert.equal(classifyJournalLine(''), null);
  assert.equal(classifyJournalLine('   \r'), null);
  // Every NONEMPTY line that is not a well-formed job/intent/resolution record is malformed —
  // a blocking liability, never silently skipped (S5B-14).
  for (const bad of [
    'not json',
    '{"jobId":"j1","sourceId":"s","at":"t', // truncated mid-line (crash while appending)
    '{}',
    '{"jobId":"j"}',
    '{"sourceId":"s"}',
    '{"intentId":"i1"}', // intent without sourceId and without a resolution token
    '{"jobId":42,"sourceId":"s"}',
    '[1,2]',
  ]) {
    const c = classifyJournalLine(bad);
    assert.equal(c?.kind, 'malformed', bad);
    assert.equal(c?.kind === 'malformed' ? c.line : '', bad.trim(), bad);
  }
  // An unknown resolution token never resolves an intent; it degrades to a plain intent
  // (still a liability) rather than cancelling one.
  assert.equal(classifyJournalLine('{"intentId":"i1","resolution":"whatever","sourceId":"s"}')?.kind, 'intent');
});

test('S5B-14: parseJournal partitions a whole journal file', () => {
  const text = [
    '{"jobId":"j1","sourceId":"s1","at":"t"}',
    '',
    '   ',
    '{"intentId":"i2","sourceId":"s2","at":"t"}',
    '{"intentId":"i1","resolution":"not-submitted"}',
    '{"jobId":"j2","sourceId":"s2","intentId":"i2","at":"t"}',
    '{"jobId":"j3","source',
  ].join('\n');
  const j = parseJournal(text);
  assert.deepEqual(j.jobs.map(e => e.jobId), ['j1', 'j2']);
  assert.equal(j.jobs[1]?.intentId, 'i2');
  assert.deepEqual(j.intents.map(e => e.intentId), ['i2']);
  assert.deepEqual(j.resolutions.map(e => e.intentId), ['i1']);
  assert.deepEqual(j.malformed, ['{"jobId":"j3","source']);
  // An empty file parses to an empty journal.
  assert.deepEqual(parseJournal(''), { jobs: [], intents: [], resolutions: [], malformed: [] });
});

/* ------------------------------------------------------------------ */
/* S5B-14: run-liability assessment                                     */
/* ------------------------------------------------------------------ */

const ADM = 1.704;

function emptyJournal(): ParsedJournal {
  return { jobs: [], intents: [], resolutions: [], malformed: [] };
}

function assess(over: Partial<Parameters<typeof assessLiabilities>[0]> = {}) {
  return assessLiabilities({
    resultsLines: [],
    journal: emptyJournal(),
    summaryOf: () => undefined,
    perJobAdmissionUSD: ADM,
    manifestSourceIds: new Set(['src-a', 'src-b', 'src-c']),
    ...over,
  });
}

test('S5B-14: an empty run has no spend, no reservations and no liabilities', () => {
  const r = assess();
  assert.equal(r.spentUsd, 0);
  assert.equal(r.reservedUsd, 0);
  assert.deepEqual(r.liabilities, []);
  assert.deepEqual(r.recoverable, []);
  assert.deepEqual(r.unrecordable, []);
  assert.equal(r.blockedSourceIds.size, 0);
});

test('S5B-14: results lines — known costs count, null/unknown costs are charged blocking liabilities (never 0)', () => {
  const r = assess({
    resultsLines: [
      { sourceId: 'src-a', jobId: 'j-a', totalCostUSD: 0.5 },
      { sourceId: 'src-b', jobId: 'j-b', totalCostUSD: null },
      { sourceId: 'src-c' }, // cost field missing entirely
    ],
  });
  assert.ok(Math.abs(r.spentUsd - 0.5) < 1e-12);
  assert.deepEqual(r.liabilities.map(l => l.kind), ['result-unknown-cost', 'result-unknown-cost']);
  assert.ok(Math.abs(r.reservedUsd - 2 * ADM) < 1e-9);
  assert.deepEqual([...r.blockedSourceIds].sort(), ['src-b', 'src-c']);
});

test('round-3 hardening: a negative recorded cost never offsets spend; it is an unknown-cost liability', () => {
  const r = assess({
    resultsLines: [
      { sourceId: 'src-a', jobId: 'j-a', totalCostUSD: 1.7 },
      { sourceId: 'src-neg', jobId: 'j-neg', totalCostUSD: -1 },
    ],
  });
  assert.ok(Math.abs(r.spentUsd - 1.7) < 1e-12, 'the negative amount is not subtracted');
  assert.deepEqual(r.liabilities.map(l => l.kind), ['result-unknown-cost']);
  assert.ok(Math.abs(r.reservedUsd - ADM) < 1e-9);
  assert.deepEqual([...r.blockedSourceIds], ['src-neg']);
});

test('S5B-14: known settled journal costs count toward spent even when the source left the manifest; duplicates count once', () => {
  const journal: ParsedJournal = {
    ...emptyJournal(),
    jobs: [
      { jobId: 'j-in', sourceId: 'src-a', at: 't' },
      { jobId: 'j-out', sourceId: 'src-gone', at: 't' },
      { jobId: 'j-in', sourceId: 'src-a', at: 't' }, // duplicate submission line
    ],
  };
  const summaries: Record<string, { status: string; totalCostUSD: number }> = {
    'j-in': { status: 'failed', totalCostUSD: 1.7 },
    'j-out': { status: 'succeeded', totalCostUSD: 0.9 },
  };
  const r = assess({ journal, summaryOf: id => summaries[id] });
  assert.ok(Math.abs(r.spentUsd - 2.6) < 1e-9, 'both known costs count, j-in exactly once');
  assert.equal(r.reservedUsd, 0);
  assert.deepEqual(r.liabilities, []);
  assert.deepEqual(r.recoverable.map(x => x.entry.jobId), ['j-in'], 'in-manifest settled job gets a results line');
  assert.deepEqual(r.unrecordable.map(x => x.entry.jobId), ['j-out'], 'out-of-manifest settled job cannot get a line');
  assert.equal(r.unrecordable[0]?.costUsd, 0.9);
});

test('S5B-14: running, unresolved and settled-unknown-cost journal jobs each hold a full reservation and block their page', () => {
  const journal: ParsedJournal = {
    ...emptyJournal(),
    jobs: [
      { jobId: 'j-null', sourceId: 'src-c', at: 't' },
      { jobId: 'j-run', sourceId: 'src-a', at: 't' },
      { jobId: 'j-gone', sourceId: 'src-b', at: 't' },
      { jobId: 'j-weird', sourceId: 'src-a', at: 't' },
    ],
  };
  const summaries: Record<string, { status: string; totalCostUSD?: null }> = {
    'j-null': { status: 'failed', totalCostUSD: null },
    'j-run': { status: 'running' },
    'j-weird': { status: 'nonsense' },
  };
  const r = assess({ journal, summaryOf: id => summaries[id] });
  assert.equal(r.spentUsd, 0);
  // Deterministic order: recovered-unknown-cost, running, then unresolved entries.
  assert.deepEqual(r.liabilities.map(l => l.kind), [
    'job-settled-unknown-cost',
    'job-running',
    'job-unresolved',
    'job-unresolved',
  ]);
  assert.ok(Math.abs(r.reservedUsd - 4 * ADM) < 1e-9);
  assert.deepEqual([...r.blockedSourceIds].sort(), ['src-a', 'src-b', 'src-c']);
  // The settled-unknown-cost job still gets a results line (its outcome is known) — but it is charged.
  assert.deepEqual(r.recoverable.map(x => x.entry.jobId), ['j-null']);
});

test('S5B-14: an out-of-manifest settled job with UNKNOWN cost is a charged liability, not a silent skip', () => {
  const r = assess({
    journal: { ...emptyJournal(), jobs: [{ jobId: 'j-x', sourceId: 'src-gone', at: 't' }] },
    summaryOf: () => ({ status: 'failed', totalCostUSD: null }),
  });
  assert.deepEqual(r.liabilities.map(l => l.kind), ['job-settled-unknown-cost']);
  assert.ok(Math.abs(r.reservedUsd - ADM) < 1e-12);
  assert.deepEqual(r.recoverable, [], 'no manifest page → no results line can be written');
  assert.deepEqual(r.unrecordable, [], 'unknown cost is never "unrecordable with a known cost"');
});

test('S5B-14: nonempty malformed journal lines are blocking liabilities charged at the per-job admission amount', () => {
  const r = assess({ journal: { ...emptyJournal(), malformed: ['{"jobId":"j1","source'] } });
  assert.deepEqual(r.liabilities.map(l => l.kind), ['malformed-journal-line']);
  assert.ok(Math.abs(r.reservedUsd - ADM) < 1e-12);
  assert.equal(r.spentUsd, 0);
});

test('S5B-14: an intent without a job line is an uncertain-submission liability; job lines and resolutions pair it away', () => {
  const journal: ParsedJournal = {
    jobs: [{ jobId: 'j-p', sourceId: 'src-b', at: 't', intentId: 'i-paired' }],
    intents: [
      { intentId: 'i-open', sourceId: 'src-a', at: 't' },
      { intentId: 'i-paired', sourceId: 'src-b', at: 't' },
      { intentId: 'i-resolved', sourceId: 'src-c', at: 't' },
      { intentId: 'i-open', sourceId: 'src-a', at: 't' }, // duplicate intent line charges once
    ],
    resolutions: [{ intentId: 'i-resolved', resolution: 'not-submitted', at: 't' }],
    malformed: [],
  };
  const r = assess({ journal, summaryOf: id => (id === 'j-p' ? { status: 'failed', totalCostUSD: 0.3 } : undefined) });
  assert.deepEqual(r.liabilities.map(l => l.kind), ['intent-without-job']);
  assert.ok(Math.abs(r.spentUsd - 0.3) < 1e-12, 'the paired job line is reconciled normally');
  assert.ok(Math.abs(r.reservedUsd - ADM) < 1e-12);
  assert.deepEqual([...r.blockedSourceIds], ['src-a'], 'the uncertain page is never re-submitted');
});

test('S5B-14: a journal job whose id already has a results line is never reconciled or charged twice', () => {
  const r = assess({
    resultsLines: [{ sourceId: 'src-a', jobId: 'j1', totalCostUSD: 0.4 }],
    journal: { ...emptyJournal(), jobs: [{ jobId: 'j1', sourceId: 'src-a', at: 't' }] },
    summaryOf: () => {
      throw new Error('recorded jobs must not be looked up');
    },
  });
  assert.ok(Math.abs(r.spentUsd - 0.4) < 1e-12);
  assert.equal(r.reservedUsd, 0);
  assert.deepEqual(r.liabilities, []);
});

test('S5B-14: assessLiabilities rejects a non-conservative admission amount', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assess({ perJobAdmissionUSD: bad }), { message: 'ADMISSION_AMOUNT_INVALID' }, String(bad));
  }
});

/* ------------------------------------------------------------------ */
/* S5B-14: admission rule                                               */
/* ------------------------------------------------------------------ */

test('S5B-14: admission rule is spent + reserved + perJobAdmission <= maxUsd, boundary inclusive', () => {
  assert.equal(admissionAllowed({ spentUsd: 1, reservedUsd: 0.5, perJobAdmissionUSD: 0.25, maxUsd: 1.75 }), true);
  assert.equal(admissionAllowed({ spentUsd: 1, reservedUsd: 0.5, perJobAdmissionUSD: 0.25, maxUsd: 1.749999 }), false);
  assert.equal(admissionAllowed({ spentUsd: 0, reservedUsd: 0, perJobAdmissionUSD: ADM, maxUsd: ADM }), true);
  // A reservation makes the difference: the same run without it would be admitted.
  assert.equal(admissionAllowed({ spentUsd: 0, reservedUsd: ADM, perJobAdmissionUSD: ADM, maxUsd: 1.8 }), false);
  assert.equal(admissionAllowed({ spentUsd: 0, reservedUsd: 0, perJobAdmissionUSD: ADM, maxUsd: 1.8 }), true);
  for (const bad of [
    { spentUsd: Number.NaN, reservedUsd: 0, perJobAdmissionUSD: 1, maxUsd: 5 },
    { spentUsd: 0, reservedUsd: Number.POSITIVE_INFINITY, perJobAdmissionUSD: 1, maxUsd: 5 },
    { spentUsd: -0.1, reservedUsd: 0, perJobAdmissionUSD: 1, maxUsd: 5 },
    { spentUsd: 0, reservedUsd: -1, perJobAdmissionUSD: 1, maxUsd: 5 },
    { spentUsd: 0, reservedUsd: 0, perJobAdmissionUSD: 0, maxUsd: 5 },
    { spentUsd: 0, reservedUsd: 0, perJobAdmissionUSD: 1, maxUsd: Number.NaN },
  ]) {
    assert.throws(() => admissionAllowed(bad), /ADMISSION_CHECK_INVALID/, JSON.stringify(bad));
  }
});

/* ------------------------------------------------------------------ */
/* S5B-14: liability messages                                           */
/* ------------------------------------------------------------------ */

test('S5B-14: describeLiability names the charge and the manual fix for every liability kind', () => {
  const cases: Liability[] = [
    { kind: 'result-unknown-cost', sourceId: 'src-r', jobId: 'j-r', chargeUsd: ADM },
    { kind: 'result-unknown-cost', sourceId: 'src-r', jobId: null, chargeUsd: ADM },
    { kind: 'malformed-journal-line', line: '{"jobId":"j1","source', chargeUsd: ADM },
    { kind: 'job-running', entry: { jobId: 'j-run', sourceId: 'src-a', at: 't' }, chargeUsd: ADM },
    { kind: 'job-unresolved', entry: { jobId: 'j-gone', sourceId: 'src-b', at: 't' }, chargeUsd: ADM },
    { kind: 'job-settled-unknown-cost', entry: { jobId: 'j-null', sourceId: 'src-c', at: 't' }, summary: { status: 'failed' }, chargeUsd: ADM },
    { kind: 'intent-without-job', intent: { intentId: 'i-9', sourceId: 'src-x', at: 't' }, chargeUsd: ADM },
  ];
  for (const l of cases) {
    const m = describeLiability(l);
    assert.match(m, /1\.704/, `${l.kind} must state its charge`);
  }
  assert.match(describeLiability(cases[0]!), /src-r/);
  assert.match(describeLiability(cases[0]!), /no known cost/);
  assert.match(describeLiability(cases[2]!), /malformed/i);
  assert.match(describeLiability(cases[2]!), /\{"jobId":"j1","source/, 'quotes the offending line');
  assert.match(describeLiability(cases[3]!), /RUNNING/);
  assert.match(describeLiability(cases[4]!), /could not be resolved/);
  assert.match(describeLiability(cases[5]!), /UNKNOWN cost/);
  const intentMsg = describeLiability(cases[6]!);
  assert.match(intentMsg, /i-9/);
  assert.match(intentMsg, /src-x/);
  assert.match(intentMsg, /UNCERTAIN/);
  // The message must tell the operator exactly how to resolve the intent manually.
  assert.match(intentMsg, /"intentId":"i-9","resolution":"not-submitted"/);
  assert.match(intentMsg, /"jobId":"<id>","sourceId":"src-x","intentId":"i-9"/);
});

/* ------------------------------------------------------------------ */
/* OW-2: model-aware admission and --model parsing                      */
/* ------------------------------------------------------------------ */

test('OW-2: perJobAdmissionUSD uses the chosen model pricing (same rates today)', () => {
  const dflt = perJobAdmissionUSD(CURRENT);
  const hosted = perJobAdmissionUSD(CURRENT, 'muse-spark-1.3');
  const open = perJobAdmissionUSD(CURRENT, 'muse-spark-open');
  assert.equal(dflt, hosted, 'the default model stays muse-spark-1.3');
  assert.ok(Math.abs(dflt - 1.704) < 1e-9, 'unchanged at the current caps');
  // Both models price identically today, so the admission amount must match exactly —
  // computed through reservationUSD with the CHOSEN model, never a hardcoded number.
  assert.equal(open, hosted);
  const manual =
    (reservationUSD('muse-spark-open', CURRENT.maxInputTokens, CURRENT.analysisMaxOutputTokens) +
      reservationUSD('muse-spark-open', CURRENT.maxInputTokens, CURRENT.maxOutputTokens)) *
    (1 + CURRENT.maxRepairAttempts) *
    (1 + CURRENT.maxRetries);
  assert.ok(Math.abs(open - manual) < 1e-12);
  // An unknown model fails closed with pricing's fixed code — never priced as 1.3.
  assert.throws(
    () => perJobAdmissionUSD(CURRENT, 'muse-spark-9' as 'muse-spark-open'),
    (err: unknown) => err instanceof Error && err.message === 'UNKNOWN_MODEL',
  );
});

test('OW-2: evalModelFromArgv defaults to muse-spark-1.3 and fails closed on anything else', () => {
  assert.equal(evalModelFromArgv(['node', 'evaluation-run.ts']), 'muse-spark-1.3');
  assert.equal(evalModelFromArgv(['node', 'x', '--only', 'src']), 'muse-spark-1.3');
  assert.equal(evalModelFromArgv(['--model', 'muse-spark-open']), 'muse-spark-open');
  assert.equal(evalModelFromArgv(['--model', 'muse-spark-1.3', '--only', 'src']), 'muse-spark-1.3');
  for (const argv of [
    ['--model', 'muse-spark-9'],
    ['--model', 'MUSE-SPARK-OPEN'],
    ['--model', ''],
    ['--model'], // flag without a value
    ['--model', '--rerun'], // next token is a flag, not a model
  ]) {
    assert.throws(
      () => evalModelFromArgv(argv),
      (err: unknown) => err instanceof Error && err.message === 'EVAL_MODEL_INVALID',
      `${JSON.stringify(argv)} must fail closed`,
    );
  }
});

test('OW-2: PROVIDER_FOR_MODEL maps each model choice to its provider', () => {
  assert.deepEqual(PROVIDER_FOR_MODEL, { 'muse-spark-1.3': 'meta-api', 'muse-spark-open': 'modal' });
});

test('OW-2: recoveredRecord carries model/provider when the summary has them, null otherwise', () => {
  const page = {
    sourceId: 'nasa-grc-equations-of-motion',
    candidate: 1,
    subject: 'physics',
    expected: 'forces-1d-v1',
    acceptable: [] as string[],
    difficulty: 'easy',
  };
  const withModel = recoveredRecord(
    page,
    { jobId: 'j1', status: 'succeeded', totalCostUSD: 0.1, model: 'muse-spark-open', provider: 'modal' },
    '2026-10-29T01:00:00.000Z',
  );
  assert.equal(withModel.model, 'muse-spark-open');
  assert.equal(withModel.provider, 'modal');
  const legacy = recoveredRecord(page, { jobId: 'j2', status: 'failed', totalCostUSD: 0.1 }, '2026-10-29T01:00:00.000Z');
  assert.equal(legacy.model, null, 'an old summary without the fields records null, never an invented model');
  assert.equal(legacy.provider, null);
});

/* ------------------------------------------------------------------ */
/* Concurrency (BUG-006 wave, part B): --concurrency parsing             */
/* ------------------------------------------------------------------ */

test('concurrency: evalConcurrencyFromArgv defaults to 1, accepts integers >= 1, and fails closed otherwise', () => {
  assert.equal(DEFAULT_EVAL_CONCURRENCY, 1, 'the default keeps the pre-registered sequential behaviour');
  assert.equal(evalConcurrencyFromArgv(['node', 'run.ts']), 1);
  assert.equal(evalConcurrencyFromArgv(['node', 'run.ts', '--concurrency', '1']), 1);
  assert.equal(evalConcurrencyFromArgv(['node', 'run.ts', '--concurrency', '3']), 3);
  assert.equal(evalConcurrencyFromArgv(['node', 'run.ts', '--concurrency', '8']), 8);
  for (const bad of [
    ['--concurrency'],
    ['--concurrency', '0'],
    ['--concurrency', '-1'],
    ['--concurrency', '1.5'],
    ['--concurrency', ''],
    ['--concurrency', 'abc'],
    ['--concurrency', '9'],
    ['--concurrency', '--max-usd'],
  ]) {
    assert.throws(
      () => evalConcurrencyFromArgv(['node', 'run.ts', ...bad]),
      (err: unknown) => err instanceof Error && err.message === 'EVAL_CONCURRENCY_INVALID',
      `--concurrency ${JSON.stringify(bad)} must fail closed`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* BUG-006: recovered lesson lines carry the summary componentRepairs    */
/* ------------------------------------------------------------------ */

test('BUG-006: recoveredRecord passes summary componentRepairs through and records null componentFailures without a detail view', () => {
  const page = {
    sourceId: 'nij-population-genetics',
    candidate: 12,
    subject: 'biology',
    expected: 'quiz-cards-v1',
    acceptable: [] as string[],
    difficulty: 'hard',
  };
  const repairs = [
    {
      componentId: 'concept-map-v1',
      attempt: 1,
      revision: 2,
      targeted: ['CM-03'],
      fixed: [],
      remaining: ['CM-03'],
      passed: false,
    },
  ];
  const lessonLine = recoveredRecord(
    page,
    { jobId: 'j1', status: 'succeeded', totalCostUSD: 0.2, flow: 'lesson', componentRepairs: repairs },
    '2026-10-30T01:00:00.000Z',
  );
  assert.deepEqual(lessonLine['componentRepairs'], repairs);
  assert.equal(lessonLine['componentFailures'], null, 'a summary-only recovery cannot know component failures — null, never invented');

  const legacy = recoveredRecord(page, { jobId: 'j2', status: 'failed', totalCostUSD: 0.1 }, '2026-10-30T01:00:00.000Z');
  assert.deepEqual(legacy['componentRepairs'], [], 'a summary without the field records an empty list');
  assert.equal(legacy['componentFailures'], null);
});
