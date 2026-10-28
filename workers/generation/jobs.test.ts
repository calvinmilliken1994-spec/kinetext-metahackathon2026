// TASK-005 worker tests — all against a FAKE MetaClient and recorded real Muse fixtures.
// No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob, listJobs, readJob, recoverInterruptedJobs } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import { GeneratedOutputError } from '../../packages/meta/pipeline.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis, StageEvent } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;
const unsupportedFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-unsupported-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: 'muse-spark-1.3',
    returnedModel: 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
}

interface FakeOptions {
  analysis?: unknown;
  gen?: unknown;
  analyzeError?: MetaError;
  specError?: MetaError;
}

function fakeClient(opts: FakeOptions = {}): MetaClient {
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        if (opts.analyzeError !== undefined) {
          throw opts.analyzeError;
        }
        return { data: (opts.analysis ?? analysisFixture) as T, receipt: fakeReceipt('fake-analysis-1') };
      }
      if (opts.specError !== undefined) {
        throw opts.specError;
      }
      return { data: (opts.gen ?? genFixture) as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'task005-jobs-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

test('startJob: supported NASA source runs the full pipeline to a publishable spec', async () => {
  const storageDir = tempStorage();
  const seen: StageEvent[] = [];
  const { jobId, done } = startJob(
    'nasa-grc-equations-of-motion',
    { client: fakeClient(), storageDir, purpose: 'test-live' },
    e => seen.push(e),
  );
  assert.match(jobId, /^job-\d{14}-[a-f0-9]{8}$/);
  const summary: JobSummary = await done;

  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.publishable, true);
  assert.equal(summary.checksPassed, 15);
  assert.equal(summary.checksTotal, 15);
  assert.equal(summary.specId, `nasa-grc-equations-of-motion-${jobId}`.slice(0, 64));
  assert.equal(summary.totalCostUSD, 0.02);
  assert.equal(summary.reservedUnknownUSD, 0, 'a fully usage-billed run reserves nothing unknown');
  assert.equal(summary.error, undefined);
  assert.ok(summary.finishedAt !== undefined);

  const runDir = join(storageDir, 'runs', jobId);
  for (const file of ['job.json', 'events.jsonl', 'analysis.json', 'spec.r1.json', 'report.r1.json']) {
    assert.ok(existsSync(join(runDir, file)), `${file} should exist`);
  }
  const jobJson = JSON.parse(readFileSync(join(runDir, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.status, 'succeeded');

  const events = readEvents(storageDir, jobId);
  assert.deepEqual(seen, events, 'onEvent receives exactly what is persisted');
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    [
      'ingest:started',
      'ingest:succeeded',
      'analyze:started',
      'analyze:succeeded',
      'specify:started',
      'specify:succeeded',
      'validate:started',
      'validate:succeeded',
      'done:succeeded',
    ],
  );
  assert.deepEqual(
    events.map(e => e.seq),
    events.map((_, i) => i),
    'seq is contiguous from 0',
  );
  const ingestOk = events[1];
  assert.ok(ingestOk !== undefined);
  assert.match(ingestOk.detail ?? '', /^sha256 [0-9a-f]{12}$/);
  const analyzeOk = events[3];
  assert.ok(analyzeOk !== undefined);
  assert.equal(analyzeOk.model, 'muse-spark-1.3');
  assert.equal(analyzeOk.responseId, 'fake-analysis-1');
  assert.equal(analyzeOk.estCostUSD, 0.01);
  assert.match(analyzeOk.detail ?? '', /^supported; checks 6\/6 passed$/);
  const validateOk = events[7];
  assert.ok(validateOk !== undefined);
  assert.equal(validateOk.detail, '15/15 checks passed');

  const spec = JSON.parse(readFileSync(join(runDir, 'spec.r1.json'), 'utf8')) as { id: string; provenance: { runId: string } };
  assert.equal(spec.id, summary.specId);
  assert.equal(spec.provenance.runId, jobId);
});

test('startJob: unsupported source ends honestly with status unsupported and no spec', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-speed-of-sound', {
    client: fakeClient({ analysis: unsupportedFixture }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'unsupported');
  assert.equal(summary.specId, undefined);
  assert.equal(summary.publishable, undefined);
  assert.equal(summary.totalCostUSD, 0.01); // analysis call only
  const runDir = join(storageDir, 'runs', jobId);
  assert.ok(!existsSync(join(runDir, 'spec.r1.json')), 'no spec is generated for an unsupported source');
  assert.ok(!existsSync(join(runDir, 'report.r1.json')));
  assert.ok(existsSync(join(runDir, 'analysis.json')));
  const events = readEvents(storageDir, jobId);
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    ['ingest:started', 'ingest:succeeded', 'analyze:started', 'analyze:succeeded', 'done:succeeded'],
  );
  const analyzeOk = events[3];
  assert.ok(analyzeOk !== undefined);
  assert.match(analyzeOk.detail ?? '', /^unsupported: .+; checks 6\/6 passed$/);
  const doneOk = events[4];
  assert.ok(doneOk !== undefined);
  assert.equal(doneOk.detail, 'unsupported');
});

test('startJob: MetaError TIMEOUT on analyze fails the job with the error code', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ analyzeError: new MetaError('TIMEOUT', 'timeout') }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'TIMEOUT', message: 'timeout' });
  assert.equal(summary.totalCostUSD, 0);
  assert.equal(summary.reservedUnknownUSD, 0, 'a MetaError without charge information reserves nothing');
  const events = readEvents(storageDir, jobId);
  const analyzeFailed = events.find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.ok(analyzeFailed !== undefined, 'analyze failed event exists');
  assert.equal(analyzeFailed.detail, 'TIMEOUT');
  assert.ok(!events.some(e => e.stage === 'specify'), 'pipeline stops at the failed stage');
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'analysis.json')));
});

test('startJob: MetaError with a receipt on specify accounts its cost', async () => {
  const storageDir = tempStorage();
  const receipt = fakeReceipt('fake-truncated');
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({
      specError: new MetaError('OUTPUT_TRUNCATED', 'output truncated', { receipt }),
    }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'OUTPUT_TRUNCATED');
  assert.equal(summary.error?.message, 'output truncated');
  assert.equal(summary.totalCostUSD, 0.02, 'analyze receipt + failed specify receipt');
  assert.equal(summary.reservedUnknownUSD, 0, 'a usage-basis receipt reserves nothing unknown');
});

test('startJob: corrupted evidence quote fails validation with VALIDATION_FAILED', async () => {
  const storageDir = tempStorage();
  const badGen = structuredClone(genFixture);
  const firstExplanation = badGen.explanations[0];
  assert.ok(firstExplanation !== undefined);
  const firstEvidence = firstExplanation.evidence[0];
  assert.ok(firstEvidence !== undefined);
  firstEvidence.quote = 'not in the source';
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ gen: badGen }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'VALIDATION_FAILED');
  assert.equal(summary.error?.message, 'generated spec failed validation');
  assert.equal(summary.publishable, undefined);
  const events = readEvents(storageDir, jobId);
  const validateFailed = events.find(e => e.stage === 'validate' && e.status === 'failed');
  assert.ok(validateFailed !== undefined, 'validate failed event exists');
  assert.ok(validateFailed.detail?.includes('grounding.quotes'), `detail names the failing check: ${validateFailed.detail}`);
  assert.match(validateFailed.detail ?? '', /^VALIDATION_FAILED; failed checks: grounding\.quotes$/);
  assert.ok(!events.some(e => e.stage === 'done'), 'no done event for a failed job');
  assert.ok(existsSync(join(storageDir, 'runs', jobId, 'report.r1.json')));
});

test('startJob: unknown source id fails ingest with SOURCE_UNAVAILABLE', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('no-such-source', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'SOURCE_UNAVAILABLE');
  assert.equal(summary.error?.message, 'source unavailable', 'fixed public message, never the raw fs error');
  const events = readEvents(storageDir, jobId);
  const ingestFailed = events.find(e => e.stage === 'ingest' && e.status === 'failed');
  assert.equal(ingestFailed?.detail, 'SOURCE_UNAVAILABLE');
  assert.deepEqual(
    events.map(e => `${e.stage}:${e.status}`),
    ['ingest:started', 'ingest:failed'],
  );
});

test('startJob: invalid source id throws synchronously and creates nothing', () => {
  const storageDir = tempStorage();
  assert.throws(
    () => startJob('BAD/../x', { client: fakeClient(), storageDir, purpose: 'test-live' }),
    /SOURCE_ID_INVALID/,
  );
  assert.deepEqual(listJobs(storageDir), []);
});

test('listJobs returns newest first and skips unreadable dirs; readJob validates the id', async () => {
  const storageDir = tempStorage();
  const first = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
  await first.done;
  const second = startJob('nasa-grc-speed-of-sound', {
    client: fakeClient({ analysis: unsupportedFixture }),
    storageDir,
    purpose: 'test-live',
    now: () => new Date('2026-01-02T00:00:00.000Z'),
  });
  await second.done;
  // junk that must be skipped, not crash the listing
  mkdirSync(join(storageDir, 'runs', 'broken-dir'), { recursive: true });
  writeFileSync(join(storageDir, 'runs', 'broken-dir', 'job.json'), '{not json');

  const jobs = listJobs(storageDir);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]?.jobId, second.jobId, 'newest first');
  assert.equal(jobs[1]?.jobId, first.jobId);
  assert.equal(jobs[0]?.status, 'unsupported');
  assert.equal(jobs[1]?.status, 'succeeded');

  const full = readJob(storageDir, first.jobId);
  assert.ok(full !== null);
  assert.equal(full.summary.jobId, first.jobId);
  assert.equal(full.events.length, 9);
  assert.ok(full.analysis !== undefined);
  assert.ok(full.spec !== undefined);
  assert.ok(full.report !== undefined);

  const unsupportedJob = readJob(storageDir, second.jobId);
  assert.ok(unsupportedJob !== null);
  assert.equal(unsupportedJob.spec, undefined);
  assert.equal(unsupportedJob.report, undefined);

  assert.equal(readJob(storageDir, 'missing-but-valid-id'), null);
  assert.throws(() => readJob(storageDir, '../etc'), /JOB_ID_INVALID/);
  assert.throws(() => readJob(storageDir, 'HasCaps'), /JOB_ID_INVALID/);
});

test('listJobs on a missing storage dir returns an empty list', () => {
  assert.deepEqual(listJobs(join(tempStorage(), 'nope')), []);
});

/* ------------------------------------------------------------------ */
/* R-01 — fixed public error messages; no provider/exception text      */
/* ------------------------------------------------------------------ */

test('startJob: MetaError extras never reach job.json or events.jsonl (R-01)', async () => {
  const storageDir = tempStorage();
  const metaErr = new MetaError('SERVER_ERROR', undefined, { status: 500, providerErrorType: 'server_error' });
  // A synthetic marker in an unrelated property, standing in for a reflected provider body.
  (metaErr as unknown as Record<string, unknown>)['providerBody'] = 'SECRET-MARKER-KEY reflected provider text';
  const client: MetaClient = {
    complete: async () => {
      throw metaErr;
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.deepEqual(summary.error, { code: 'SERVER_ERROR', message: 'server error' });
  const runDir = join(storageDir, 'runs', jobId);
  const jobJson = readFileSync(join(runDir, 'job.json'), 'utf8');
  const eventsRaw = readFileSync(join(runDir, 'events.jsonl'), 'utf8');
  for (const blob of [jobJson, eventsRaw, JSON.stringify(summary)]) {
    assert.ok(!blob.includes('SECRET-MARKER'), `synthetic marker must not be persisted anywhere: ${blob.slice(0, 200)}`);
  }
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedEvent?.detail, 'SERVER_ERROR', 'failure detail is the code only');
});

test('startJob: an unexpected exception becomes INTERNAL with a fixed message (R-01)', async () => {
  const storageDir = tempStorage();
  const client: MetaClient = {
    complete: async () => {
      throw new Error('SECRET-MARKER source text');
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.deepEqual(summary.error, { code: 'INTERNAL', message: 'Unexpected internal error' });
  const runDir = join(storageDir, 'runs', jobId);
  assert.ok(!readFileSync(join(runDir, 'job.json'), 'utf8').includes('SECRET-MARKER'));
  assert.ok(!readFileSync(join(runDir, 'events.jsonl'), 'utf8').includes('SECRET-MARKER'));
  const failedEvent = readEvents(storageDir, jobId).find(e => e.status === 'failed');
  assert.equal(failedEvent?.detail, 'INTERNAL');
});

/* ------------------------------------------------------------------ */
/* R-09 — failure costs: chargedUSD and reservedUnknownUSD             */
/* ------------------------------------------------------------------ */

test('startJob: timeout with chargedUSD counts into totalCostUSD and reservedUnknownUSD (R-09 reviewer probe)', async () => {
  const storageDir = tempStorage();
  // Wave-A2 clients always attach reservedUnknownUSD (N-04); the worker sums that field.
  const err = new MetaError('TIMEOUT', undefined, {
    chargedUSD: 0.027565,
    reservedUnknownUSD: 0.027565,
    costBasis: 'reservation',
  });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ analyzeError: err }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.totalCostUSD, 0.027565, 'the reserved-unknown charge is part of the total');
  assert.equal(summary.reservedUnknownUSD, 0.027565);
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedEvent?.estCostUSD, 0.027565, 'the failed-stage event carries the charge');
  assert.equal(failedEvent?.detail, 'TIMEOUT; cost basis: reservation (outcome uncertain)');
});

test('startJob: a usage-basis failure keeps reservedUnknownUSD at zero (R-09)', async () => {
  const storageDir = tempStorage();
  const err = new MetaError('BAD_REQUEST', undefined, { status: 400, chargedUSD: 0, costBasis: 'usage' });
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ analyzeError: err }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.totalCostUSD, 0);
  assert.equal(summary.reservedUnknownUSD, 0);
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedEvent?.detail, 'BAD_REQUEST');
  assert.equal(failedEvent?.estCostUSD, 0);
});

test('startJob: a reservation-basis receipt on a success path also lands in reservedUnknownUSD (R-09)', async () => {
  const storageDir = tempStorage();
  // Wave-A2 receipts always carry the explicit reserved-unknown amount (N-04).
  const reservationReceipt: MetaReceipt = {
    ...fakeReceipt('fake-reserved'),
    costBasis: 'reservation',
    reservedUnknownUSD: 0.01,
  };
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: reservationReceipt };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
  const { done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.02);
  assert.equal(summary.reservedUnknownUSD, 0.01, 'only the reservation-basis receipt is unknown-outcome');
});

/* ------------------------------------------------------------------ */
/* R-11 — job deadline and per-stage output caps                       */
/* ------------------------------------------------------------------ */

test('startJob: the job deadline aborts a hanging client with DEADLINE_EXCEEDED (R-11)', async () => {
  const storageDir = tempStorage();
  const client: MetaClient = {
    complete: <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> =>
      new Promise<{ data: T; receipt: MetaReceipt }>((_resolve, reject) => {
        const signal = req.signal;
        if (signal === undefined) {
          reject(new Error('NO_SIGNAL_PASSED'));
          return;
        }
        const onAbort = (): void => {
          reject(new MetaError('DEADLINE_EXCEEDED', undefined, { chargedUSD: 0, costBasis: 'usage' }));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }),
  };
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    limits: { maxJobWallTimeMs: 30 },
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'DEADLINE_EXCEEDED', message: 'job deadline exceeded' });
});

test('startJob: one signal and per-stage output caps reach every client call (R-11)', async () => {
  const inner = fakeClient();
  const seen: { schema: string; maxOutputTokens: number; hasSignal: boolean }[] = [];
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      seen.push({ schema: req.schemaName, maxOutputTokens: req.maxOutputTokens, hasSignal: req.signal !== undefined });
      return inner.complete<T>(req);
    },
  };
  const first = startJob('nasa-grc-equations-of-motion', { client, storageDir: tempStorage(), purpose: 'test-live' });
  await first.done;
  assert.deepEqual(seen, [
    { schema: 'source_analysis', maxOutputTokens: 6000, hasSignal: true },
    { schema: 'activity_spec', maxOutputTokens: 8000, hasSignal: true },
  ], 'defaults match config/resource-limits.json and the pipeline contract');

  seen.length = 0;
  const second = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir: tempStorage(),
    purpose: 'test-live',
    limits: { maxJobWallTimeMs: 60000, analysisMaxOutputTokens: 1234, specMaxOutputTokens: 4321 },
  });
  await second.done;
  assert.deepEqual(seen.map(s => s.maxOutputTokens), [1234, 4321], 'JobDeps.limits override the stage caps');
});

/* ------------------------------------------------------------------ */
/* R-10 — atomic artifacts and startup recovery                        */
/* ------------------------------------------------------------------ */

test('startJob: JSON artifacts land atomically with no leftover temp files (R-10)', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(),
    storageDir,
    purpose: 'test-live',
  });
  await done;
  const files = readdirSync(join(storageDir, 'runs', jobId)).sort();
  assert.deepEqual(files, ['analysis.json', 'events.jsonl', 'job.json', 'report.r1.json', 'spec.r1.json']);
  for (const f of files) {
    assert.ok(!f.includes('.tmp'), `no temp artifact may remain: ${f}`);
  }
});

test('recoverInterruptedJobs: a job left running by a previous process becomes failed/INTERRUPTED (R-10 reviewer probe)', async () => {
  const storageDir = tempStorage();
  const jobId = 'job-20260101000000-deadbeef';
  const runDir = join(storageDir, 'runs', jobId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'job.json'),
    JSON.stringify(
      {
        jobId,
        sourceId: 'nasa-grc-equations-of-motion',
        status: 'running',
        purpose: 'test-live',
        createdAt: '2026-01-01T00:00:00.000Z',
        totalCostUSD: 0.01,
        reservedUnknownUSD: 0.01,
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(runDir, 'events.jsonl'),
    `${JSON.stringify({ jobId, seq: 0, stage: 'ingest', status: 'started', at: '2026-01-01T00:00:00.000Z' })}\n` +
      `${JSON.stringify({ jobId, seq: 1, stage: 'analyze', status: 'started', at: '2026-01-01T00:00:01.000Z' })}\n`,
  );
  // A finished job that recovery must not touch.
  const finished = startJob('nasa-grc-speed-of-sound', {
    client: fakeClient({ analysis: unsupportedFixture }),
    storageDir,
    purpose: 'test-live',
  });
  await finished.done;

  const recovered = recoverInterruptedJobs(storageDir, () => new Date('2026-02-02T00:00:00.000Z'));
  assert.deepEqual(recovered, [jobId]);

  const job = readJob(storageDir, jobId);
  assert.ok(job !== null);
  assert.equal(job.summary.status, 'failed');
  assert.deepEqual(job.summary.error, {
    code: 'INTERRUPTED',
    message: 'The server stopped before this job finished.',
  });
  assert.equal(job.summary.finishedAt, '2026-02-02T00:00:00.000Z');
  assert.equal(job.summary.totalCostUSD, 0.01, 'already-accounted cost is kept');
  assert.equal(job.summary.reservedUnknownUSD, 0.01, 'unknown reservations are never refunded by recovery');
  const last = job.events[job.events.length - 1];
  assert.equal(last?.stage, 'done');
  assert.equal(last?.status, 'failed');
  assert.equal(last?.detail, 'INTERRUPTED');
  assert.equal(last?.seq, 2, 'the recovery event continues the sequence');
  assert.equal(last?.at, '2026-02-02T00:00:00.000Z');

  // The finished job is untouched and recovery is idempotent.
  const untouched = readJob(storageDir, finished.jobId);
  assert.equal(untouched?.summary.status, 'unsupported');
  assert.deepEqual(recoverInterruptedJobs(storageDir), []);
  for (const f of readdirSync(runDir)) {
    assert.ok(!f.includes('.tmp'), `no temp artifact may remain: ${f}`);
  }
});

test('recoverInterruptedJobs: missing or empty storage recovers nothing', () => {
  assert.deepEqual(recoverInterruptedJobs(join(tempStorage(), 'nope')), []);
  assert.deepEqual(recoverInterruptedJobs(tempStorage()), []);
});

/* ------------------------------------------------------------------ */
/* N-04 — reservedUnknownUSD is the explicit amount, never inferred    */
/* ------------------------------------------------------------------ */

test('startJob: a mixed 503→200 receipt reports only the reserved attempt as unknown (N-04 reviewer probe)', async () => {
  const storageDir = tempStorage();
  // Reviewer P3 numbers: the 503 attempt keeps its $0.02987 reservation while the
  // retried 200 bills $0.0000975 of known usage; the receipt total is $0.0299675
  // with costBasis 'reservation' — the unknown part is ONLY the 503 reservation.
  const mixed: MetaReceipt = {
    ...fakeReceipt('fake-503-then-200'),
    estCostUSD: 0.0299675,
    reservedUnknownUSD: 0.02987,
    costBasis: 'reservation',
    attempts: 2,
  };
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: mixed };
      }
      return {
        data: genFixture as T,
        receipt: { ...fakeReceipt('fake-gen-1'), costBasis: 'usage', reservedUnknownUSD: 0 },
      };
    },
  };
  const { done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.totalCostUSD, 0.039968, '0.0299675 + 0.01, rounded to 1e-6');
  assert.equal(
    summary.reservedUnknownUSD,
    0.02987,
    'only the 503 attempt reservation is unknown — not the whole costBasis=reservation total',
  );
});

test('startJob: MetaError.reservedUnknownUSD splits the charged total (N-04)', async () => {
  const storageDir = tempStorage();
  const err = new MetaError('SERVER_ERROR', undefined, {
    status: 503,
    chargedUSD: 0.0307,
    reservedUnknownUSD: 0.02987,
    costBasis: 'reservation',
  });
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ specError: err }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.totalCostUSD, 0.0407, 'analyze receipt 0.01 + charged 0.0307');
  assert.equal(summary.reservedUnknownUSD, 0.02987, 'only the explicit reserved-unknown part of the charge');
  const failedEvent = readEvents(storageDir, summary.jobId).find(
    e => e.stage === 'specify' && e.status === 'failed',
  );
  assert.equal(failedEvent?.estCostUSD, 0.0307, 'the failed-stage event still carries the full charge');
  assert.equal(failedEvent?.detail, 'SERVER_ERROR; cost basis: reservation (outcome uncertain)');
});

test('startJob: costBasis "reservation" with reservedUnknownUSD 0 no longer implies an unknown total (N-04)', async () => {
  const storageDir = tempStorage();
  const receipt: MetaReceipt = {
    ...fakeReceipt('fake-zero-unknown'),
    costBasis: 'reservation',
    reservedUnknownUSD: 0,
  };
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
  const { done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.totalCostUSD, 0.02);
  assert.equal(summary.reservedUnknownUSD, 0, 'the explicit amount wins over the basis flag');
});

/* ------------------------------------------------------------------ */
/* N-05 — owner-aware recovery                                         */
/* ------------------------------------------------------------------ */

function writeRunningJob(storageDir: string, jobId: string, overrides: Record<string, unknown> = {}): void {
  const runDir = join(storageDir, 'runs', jobId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'job.json'),
    JSON.stringify(
      {
        jobId,
        sourceId: 'nasa-grc-equations-of-motion',
        status: 'running',
        purpose: 'test-live',
        createdAt: '2026-01-01T00:00:00.000Z',
        totalCostUSD: 0,
        reservedUnknownUSD: 0,
        ...overrides,
      },
      null,
      2,
    ),
  );
}

function waitExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise<number | null>((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode);
      return;
    }
    const timer = setTimeout(() => reject(new Error('CHILD_EXIT_TIMEOUT')), timeoutMs);
    child.once('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('startJob records owner {pid, startedAt} in job.json from the first write (N-05)', async () => {
  const storageDir = tempStorage();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const inner = fakeClient();
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      await gate;
      return inner.complete<T>(req);
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    now: () => new Date('2026-03-03T04:05:06.000Z'),
  });
  // job.json is written synchronously at start — inspect it while the job is parked.
  const running = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(running.status, 'running');
  assert.deepEqual(running.owner, { pid: process.pid, startedAt: '2026-03-03T04:05:06.000Z' });
  // Reviewer P1: recovery inside the active process must not mark its own pending job failed.
  assert.deepEqual(recoverInterruptedJobs(storageDir), []);
  assert.equal(readJob(storageDir, jobId)?.summary.status, 'running');
  release();
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.owner?.pid, process.pid, 'the terminal record keeps the owner');
});

test('recoverInterruptedJobs: injected isAlive — live owner untouched, dead owner recovered (N-05 reviewer probe)', () => {
  const storageDir = tempStorage();
  const liveJob = 'job-20260404000000-aaaa0001';
  const deadJob = 'job-20260404000000-bbbb0002';
  writeRunningJob(storageDir, liveJob, { owner: { pid: 424242, startedAt: '2026-04-04T00:00:00.000Z' } });
  writeRunningJob(storageDir, deadJob, { owner: { pid: 434343, startedAt: '2026-04-04T00:00:00.000Z' } });
  const probed: number[] = [];
  const recovered = recoverInterruptedJobs(storageDir, () => new Date('2026-04-04T00:00:05.000Z'), {
    isAlive: (pid: number) => {
      probed.push(pid);
      return pid === 424242;
    },
  });
  assert.deepEqual(recovered, [deadJob]);
  assert.deepEqual([...probed].sort(), [424242, 434343], 'both owner pids are probed');
  assert.equal(readJob(storageDir, liveJob)?.summary.status, 'running', "the live owner's job is untouched");
  const dead = readJob(storageDir, deadJob);
  assert.equal(dead?.summary.status, 'failed');
  assert.deepEqual(dead?.summary.error, {
    code: 'INTERRUPTED',
    message: 'The server stopped before this job finished.',
  });
});

test('recoverInterruptedJobs: never touches a job owned by the current process, even if isAlive lies (N-05)', () => {
  const storageDir = tempStorage();
  const own = 'job-20260404000000-cccc0003';
  writeRunningJob(storageDir, own, {
    owner: { pid: process.pid, startedAt: new Date().toISOString() },
    createdAt: new Date().toISOString(),
  });
  assert.deepEqual(recoverInterruptedJobs(storageDir, undefined, { isAlive: () => false }), []);
  assert.equal(readJob(storageDir, own)?.summary.status, 'running');
});

test('recoverInterruptedJobs: default liveness probe — alive child owner untouched, recovered after it dies (N-05)', async () => {
  const storageDir = tempStorage();
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  try {
    const pid = child.pid;
    assert.ok(typeof pid === 'number' && pid > 0, 'the child has a pid');
    const jobId = 'job-20260404000000-dddd0004';
    writeRunningJob(storageDir, jobId, {
      owner: { pid, startedAt: new Date().toISOString() },
      createdAt: new Date().toISOString(),
    });
    // Reviewer P3: a startup sharing storage with a LIVE owner must not interrupt its job.
    assert.deepEqual(recoverInterruptedJobs(storageDir), []);
    assert.equal(readJob(storageDir, jobId)?.summary.status, 'running');
    child.kill();
    await waitExit(child, 10000);
    // The OS may need a moment before the pid reads dead; poll until recovery fires.
    const deadline = Date.now() + 5000;
    let recovered: string[] = [];
    while (Date.now() < deadline) {
      recovered = recoverInterruptedJobs(storageDir);
      if (recovered.length === 1) {
        break;
      }
      await sleepMs(50);
    }
    assert.deepEqual(recovered, [jobId], 'the dead owner\'s job is recovered');
    assert.equal(readJob(storageDir, jobId)?.summary.status, 'failed');
    assert.equal(readJob(storageDir, jobId)?.summary.error?.code, 'INTERRUPTED');
  } finally {
    try {
      child.kill();
    } catch {
      // already dead
    }
  }
});

test('recoverInterruptedJobs: ownerless legacy jobs recover only past maxJobWallTimeMs (N-05)', () => {
  const storageDir = tempStorage();
  const nowMs = Date.parse('2026-04-04T00:10:00.000Z');
  const freshId = 'job-20260404000000-eeee0005';
  const oldId = 'job-20260404000000-ffff0006';
  const noPidId = 'job-20260404000000-aaaa0007';
  writeRunningJob(storageDir, freshId, { createdAt: new Date(nowMs - 30_000).toISOString() });
  writeRunningJob(storageDir, oldId, { createdAt: new Date(nowMs - 300_000).toISOString() });
  writeRunningJob(storageDir, noPidId, {
    createdAt: new Date(nowMs - 300_000).toISOString(),
    owner: { startedAt: new Date(nowMs - 300_000).toISOString() }, // owner without a usable pid
  });
  // Default budget 120000 ms: the two 5-minute-old jobs recover, the 30-second one stays.
  const recovered = recoverInterruptedJobs(storageDir, () => new Date(nowMs));
  assert.deepEqual(recovered, [noPidId, oldId].sort());
  assert.equal(readJob(storageDir, freshId)?.summary.status, 'running', 'a young ownerless job is not interrupted');
  // A tighter configured budget catches the fresh legacy job too.
  const recovered2 = recoverInterruptedJobs(storageDir, () => new Date(nowMs), { maxJobWallTimeMs: 10_000 });
  assert.deepEqual(recovered2, [freshId]);
});

test('recoverInterruptedJobs: an ownerless job with an unparseable start time is left alone (N-05)', () => {
  const storageDir = tempStorage();
  const brokenId = 'job-20260404000000-0bad0008';
  writeRunningJob(storageDir, brokenId, { createdAt: 'not-a-timestamp' });
  assert.deepEqual(recoverInterruptedJobs(storageDir), []);
  assert.equal(readJob(storageDir, brokenId)?.summary.status, 'running');
});

/* ------------------------------------------------------------------ */
/* F-01 — generated-output failures: receipts accounted, OUTPUT_INVALID */
/* ------------------------------------------------------------------ */

const OUTPUT_INVALID_MESSAGE = 'The model returned output that does not match the required structure.';

test('startJob: GeneratedOutputError on analyze accounts its receipt and persists OUTPUT_INVALID (F-01)', async () => {
  const storageDir = tempStorage();
  // Reviewer P3 valid-usage numbers: prompt 10 / completion 20 tokens = $0.0000975.
  const receipt: MetaReceipt = {
    ...fakeReceipt('fake-null-analysis'),
    usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 0, cachedTokens: 0 },
    estCostUSD: 0.0000975,
    costBasis: 'usage',
    reservedUnknownUSD: 0,
  };
  const client: MetaClient = {
    complete: async () => {
      throw new GeneratedOutputError('analyze', receipt);
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'OUTPUT_INVALID', message: OUTPUT_INVALID_MESSAGE });
  assert.equal(summary.totalCostUSD, 0.000098, 'the completed call is billed exactly like a successful receipt (rounded to 1e-6)');
  assert.equal(summary.reservedUnknownUSD, 0);
  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.status, 'failed', 'terminal state is persisted — never left running');
  assert.equal(jobJson.error?.code, 'OUTPUT_INVALID');
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.ok(failedEvent !== undefined, 'analyze failed event exists');
  assert.equal(failedEvent.detail, 'OUTPUT_INVALID');
  assert.equal(failedEvent.model, 'muse-spark-1.3');
  assert.equal(failedEvent.latencyMs, 42);
  assert.equal(failedEvent.estCostUSD, 0.0000975, 'the failed-stage event carries the receipt charge');
  assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'analysis.json')), 'invalid analysis is never persisted');
});

test('startJob: reservation-basis OUTPUT_INVALID keeps the unknown part and marks the cost basis (F-01 reviewer probe)', async () => {
  const storageDir = tempStorage();
  // Reviewer P3: absent usage on the analysis call retains the $0.0326875 reservation.
  const receipt: MetaReceipt = {
    ...fakeReceipt('fake-analysis-reserved'),
    usage: null,
    estCostUSD: 0.0326875,
    costBasis: 'reservation',
    reservedUnknownUSD: 0.0326875,
  };
  const client: MetaClient = {
    complete: async () => {
      throw new GeneratedOutputError('analyze', receipt);
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'OUTPUT_INVALID');
  assert.equal(summary.totalCostUSD, 0.032688, 'reservation rounded to 1e-6');
  assert.equal(summary.reservedUnknownUSD, 0.032688, 'the whole reservation is unknown-outcome');
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.equal(failedEvent?.detail, 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)');
  assert.equal(failedEvent?.estCostUSD, 0.0326875);
});

test('startJob: GeneratedOutputError on specify accounts BOTH receipts exactly once (F-01 reviewer probe)', async () => {
  const storageDir = tempStorage();
  const analysisReceipt: MetaReceipt = {
    ...fakeReceipt('fake-analysis-ok'),
    usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 0, cachedTokens: 0 },
    estCostUSD: 0.0000975,
    costBasis: 'usage',
    reservedUnknownUSD: 0,
  };
  const specReceipt: MetaReceipt = { ...analysisReceipt, responseId: 'fake-spec-bad' };
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: analysisReceipt };
      }
      throw new GeneratedOutputError('specify', specReceipt);
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.equal(summary.error?.code, 'OUTPUT_INVALID');
  assert.equal(summary.totalCostUSD, 0.000195, 'reviewer P3: analysis + spec receipts, each counted once');
  assert.equal(summary.reservedUnknownUSD, 0);
  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.status, 'failed', 'terminal state is persisted — never left running');
  assert.equal(jobJson.error?.code, 'OUTPUT_INVALID');
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'specify' && e.status === 'failed');
  assert.ok(failedEvent !== undefined, 'specify failed event exists');
  assert.equal(failedEvent.detail, 'OUTPUT_INVALID');
  assert.equal(failedEvent.estCostUSD, 0.0000975, 'the failed-stage event carries the spec receipt charge');
  assert.ok(existsSync(join(storageDir, 'runs', jobId, 'analysis.json')), 'the successful analysis stays persisted');
});

test('startJob: a duck-typed OUTPUT_INVALID error with a receipt is accounted like GeneratedOutputError (F-01)', async () => {
  const storageDir = tempStorage();
  const client: MetaClient = {
    complete: async () => {
      // Same shape, different realm/module instance: code + a receipt with a finite estCostUSD.
      throw {
        code: 'OUTPUT_INVALID',
        stage: 'analyze',
        receipt: { ...fakeReceipt('fake-duck'), estCostUSD: 0.02, costBasis: 'usage', reservedUnknownUSD: 0 },
      };
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', { client, storageDir, purpose: 'test-live' });
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'OUTPUT_INVALID', message: OUTPUT_INVALID_MESSAGE });
  assert.equal(summary.totalCostUSD, 0.02);
  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.error?.code, 'OUTPUT_INVALID');
});

test('startJob: an unpublishable analysis fails ANALYSIS_INVALID without dereferencing analysis fields (F-01)', async () => {
  const storageDir = tempStorage();
  // Schema-valid analysis that fails grounding: the first concept's quote no longer counts.
  const bad = structuredClone(analysisFixture);
  const firstConcept = bad.concepts[0];
  assert.ok(firstConcept !== undefined);
  firstConcept.evidence = [{ quote: 'abc', sourceId: 'nasa-grc-equations-of-motion' }];
  // Trap: after analysis.json exists (i.e. after the pipeline returned), ANY read of
  // the model's supported/unsupportedReason fields throws — the publishable check
  // must gate every dereference of the analysis (reviewer F-01 ordering).
  let jobIdHolder: string | undefined;
  const trapped = new Proxy(bad, {
    get(target, prop, receiver) {
      if (
        (prop === 'supported' || prop === 'unsupportedReason') &&
        jobIdHolder !== undefined &&
        existsSync(join(storageDir, 'runs', jobIdHolder, 'analysis.json'))
      ) {
        throw new Error('ANALYSIS_FIELD_DEREFERENCED_AFTER_REPORT_GATE');
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: trapped as unknown as T, receipt: fakeReceipt('fake-trap') };
      }
      throw new Error('specify must not run for an unpublishable analysis');
    },
  };
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client,
    storageDir,
    purpose: 'test-live',
    // TASK-024b: maxRepairAttempts 0 keeps today's behaviour — this test pins the
    // F-01 dereference gate, not the analysis repair loop (covered in jobs.analysis-repair.test.ts).
    limits: { maxRepairAttempts: 0 },
  });
  jobIdHolder = jobId;
  const summary = await done;
  assert.equal(summary.status, 'failed');
  assert.deepEqual(summary.error, { code: 'ANALYSIS_INVALID', message: 'analysis failed validation' });
  assert.equal(summary.totalCostUSD, 0.01, 'the analysis receipt is still accounted');
  const jobJson = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(jobJson.status, 'failed');
  assert.equal(jobJson.error?.code, 'ANALYSIS_INVALID');
  const failedEvent = readEvents(storageDir, jobId).find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.ok(failedEvent !== undefined);
  assert.equal(failedEvent.detail, 'ANALYSIS_INVALID', 'the detail never dereferences analysis fields');
  assert.equal(failedEvent.estCostUSD, 0.01);
  assert.ok(existsSync(join(storageDir, 'runs', jobId, 'analysis.json')), 'the analysis + failing report stay persisted');
  assert.ok(!readEvents(storageDir, jobId).some(e => e.stage === 'specify'));
});
