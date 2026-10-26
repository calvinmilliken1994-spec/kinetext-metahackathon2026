// TASK-005 worker tests — all against a FAKE MetaClient and recorded real Muse fixtures.
// No network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob, listJobs, readJob } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MetaError } from '../../packages/meta/client.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
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
  assert.equal(summary.checksPassed, 13);
  assert.equal(summary.checksTotal, 13);
  assert.equal(summary.specId, `nasa-grc-equations-of-motion-${jobId}`.slice(0, 64));
  assert.equal(summary.totalCostUSD, 0.02);
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
  assert.match(analyzeOk.detail ?? '', /^supported; checks 5\/5 passed$/);
  const validateOk = events[7];
  assert.ok(validateOk !== undefined);
  assert.equal(validateOk.detail, '13/13 checks passed');

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
  assert.match(analyzeOk.detail ?? '', /^unsupported: .+; checks 5\/5 passed$/);
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
  const events = readEvents(storageDir, jobId);
  const analyzeFailed = events.find(e => e.stage === 'analyze' && e.status === 'failed');
  assert.ok(analyzeFailed !== undefined, 'analyze failed event exists');
  assert.equal(analyzeFailed.detail, 'TIMEOUT: timeout');
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
  assert.equal(summary.totalCostUSD, 0.02, 'analyze receipt + failed specify receipt');
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
  assert.equal(summary.publishable, undefined);
  const events = readEvents(storageDir, jobId);
  const validateFailed = events.find(e => e.stage === 'validate' && e.status === 'failed');
  assert.ok(validateFailed !== undefined, 'validate failed event exists');
  assert.ok(validateFailed.detail?.includes('grounding.quotes'), `detail names the failing check: ${validateFailed.detail}`);
  assert.match(validateFailed.detail ?? '', /^12\/13 checks passed/);
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
  const events = readEvents(storageDir, jobId);
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
