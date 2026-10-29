// OW-2 — worker-side model/provider recording: the job summary, job.json, events and
// receipts carry model (ModelChoice), provider and providerModel; legacy records read
// back with the muse-spark-1.3/meta-api defaults. FAKE MetaClient + recorded real Muse
// fixtures only; no network, no credits, no .env access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startJob, listJobs, readJob, recoverInterruptedJobs } from './jobs.ts';
import type { JobSummary } from './jobs.ts';
import { MODAL_MUSE_SPARK_OPEN_MODEL } from '../../packages/meta/client.ts';
import type { ClientReceipt, CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type { GeneratedSpec, MetaReceipt, SourceAnalysis, StageEvent } from '../../packages/contracts/index.ts';

const analysisFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-analysis.recorded.json', import.meta.url), 'utf8'),
) as SourceAnalysis;
const genFixture = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/nasa-gen.recorded.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

function fakeReceipt(responseId: string, providerFields?: { provider: 'meta-api' | 'modal'; model: 'muse-spark-1.3' | 'muse-spark-open'; providerModel: string }): ClientReceipt {
  const base: MetaReceipt = {
    purpose: 'test-live',
    requestedModel: providerFields?.providerModel ?? 'muse-spark-1.3',
    returnedModel: providerFields?.providerModel ?? 'muse-spark-1.3',
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 42,
    estCostUSD: 0.01,
    finishReason: 'stop',
    attempts: 1,
  };
  return providerFields === undefined ? base : { ...base, ...providerFields };
}

interface FakeOptions {
  provider?: 'meta-api' | 'modal';
  model?: 'muse-spark-1.3' | 'muse-spark-open';
  providerModel?: string;
}

/** A fake client that declares (or omits) the OW-1 provider/model fields. */
function fakeClient(opts: FakeOptions = {}): MetaClient {
  const declared = opts.provider !== undefined;
  const providerFields = declared
    ? {
        provider: opts.provider as 'meta-api' | 'modal',
        model: opts.model as 'muse-spark-1.3' | 'muse-spark-open',
        providerModel: opts.providerModel as string,
      }
    : undefined;
  const client: MetaClient = {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: ClientReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        return { data: analysisFixture as T, receipt: fakeReceipt('fake-analysis-1', providerFields) };
      }
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1', providerFields) };
    },
  };
  if (declared) {
    Object.defineProperties(client, {
      provider: { value: providerFields?.provider },
      model: { value: providerFields?.model },
      providerModel: { value: providerFields?.providerModel },
    });
  }
  return client;
}

function tempStorage(): string {
  return mkdtempSync(join(tmpdir(), 'ow2-jobs-'));
}

function readEvents(storageDir: string, jobId: string): StageEvent[] {
  return readFileSync(join(storageDir, 'runs', jobId, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as StageEvent);
}

const MODAL_CLIENT: FakeOptions = {
  provider: 'modal',
  model: 'muse-spark-open',
  providerModel: MODAL_MUSE_SPARK_OPEN_MODEL,
};

test('OW-2: a modal client job records model/provider/providerModel on the summary, job.json and every event', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient(MODAL_CLIENT),
    storageDir,
    purpose: 'test-live',
    limits: { maxJobWallTimeMs: 60000, analysisMaxOutputTokens: 16000, specMaxOutputTokens: 32000, maxRepairAttempts: 2 },
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded', 'the recorded fixtures still publish');
  assert.equal(summary.model, 'muse-spark-open');
  assert.equal(summary.provider, 'modal');
  assert.equal(summary.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);

  // job.json on disk carries the same fields (the first 'running' write already had them).
  const stored = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'job.json'), 'utf8')) as JobSummary;
  assert.equal(stored.model, 'muse-spark-open');
  assert.equal(stored.provider, 'modal');
  assert.equal(stored.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);

  // EVERY event records the job's model (display id), provider and the exact provider string.
  const events = readEvents(storageDir, jobId);
  assert.ok(events.length >= 9);
  for (const e of events) {
    assert.equal(e.model, 'muse-spark-open', `event ${e.stage}:${e.status} records the display model id`);
    assert.equal((e as StageEvent & { provider?: string }).provider, 'modal');
    assert.equal((e as StageEvent & { providerModel?: string }).providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  }

  // Receipts are persisted verbatim, so the client's provider fields survive into analysis.json.
  const analysis = JSON.parse(readFileSync(join(storageDir, 'runs', jobId, 'analysis.json'), 'utf8')) as {
    receipt: ClientReceipt;
  };
  assert.equal(analysis.receipt.provider, 'modal');
  assert.equal(analysis.receipt.model, 'muse-spark-open');
  assert.equal(analysis.receipt.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);

  // readJob exposes the fields.
  const view = readJob(storageDir, jobId);
  assert.ok(view !== null);
  assert.equal(view.summary.model, 'muse-spark-open');
  assert.equal(view.summary.provider, 'modal');
  assert.equal(view.summary.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  // listJobs too.
  const listed = listJobs(storageDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].model, 'muse-spark-open');
  assert.equal(listed[0].provider, 'modal');
});

test('OW-2: a legacy fake client without provider fields defaults to muse-spark-1.3/meta-api', async () => {
  const storageDir = tempStorage();
  const { jobId, done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({}),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.status, 'succeeded');
  assert.equal(summary.model, 'muse-spark-1.3');
  assert.equal(summary.provider, 'meta-api');
  assert.equal(summary.providerModel, 'muse-spark-1.3');
  for (const e of readEvents(storageDir, jobId)) {
    assert.equal(e.model, 'muse-spark-1.3');
    assert.equal((e as StageEvent & { provider?: string }).provider, 'meta-api');
    assert.equal((e as StageEvent & { providerModel?: string }).providerModel, 'muse-spark-1.3');
  }
});

test('OW-2: a meta-api client declaring its fields records them unchanged', async () => {
  const storageDir = tempStorage();
  const { done } = startJob('nasa-grc-equations-of-motion', {
    client: fakeClient({ provider: 'meta-api', model: 'muse-spark-1.3', providerModel: 'muse-spark-1.3' }),
    storageDir,
    purpose: 'test-live',
  });
  const summary = await done;
  assert.equal(summary.model, 'muse-spark-1.3');
  assert.equal(summary.provider, 'meta-api');
  assert.equal(summary.providerModel, 'muse-spark-1.3');
});

test('OW-2: old job records without the fields read back as muse-spark-1.3/meta-api', () => {
  const storageDir = tempStorage();
  const runDir = join(storageDir, 'runs', 'job-20261001000000-deadbeef');
  mkdirSync(runDir, { recursive: true });
  // A job.json written before OW-2: no model/provider/providerModel keys at all.
  const legacy: Record<string, unknown> = {
    jobId: 'job-20261001000000-deadbeef',
    sourceId: 'nasa-grc-equations-of-motion',
    status: 'succeeded',
    purpose: 'test-live',
    createdAt: '2026-10-01T00:00:00.000Z',
    finishedAt: '2026-10-01T00:01:00.000Z',
    totalCostUSD: 0.02,
    reservedUnknownUSD: 0,
    engine: 'forces-1d-v1',
    revisions: 1,
    repairs: [],
    sourceKind: 'library',
  };
  writeFileSync(join(runDir, 'job.json'), JSON.stringify(legacy, null, 2));
  writeFileSync(join(runDir, 'events.jsonl'), '');

  const view = readJob(storageDir, 'job-20261001000000-deadbeef');
  assert.ok(view !== null);
  assert.equal(view.summary.model, 'muse-spark-1.3');
  assert.equal(view.summary.provider, 'meta-api');
  assert.equal(view.summary.providerModel, 'muse-spark-1.3');
  // Other fields are untouched.
  assert.equal(view.summary.status, 'succeeded');
  assert.equal(view.summary.totalCostUSD, 0.02);

  const listed = listJobs(storageDir);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].model, 'muse-spark-1.3');
  assert.equal(listed[0].provider, 'meta-api');
  assert.equal(listed[0].providerModel, 'muse-spark-1.3');

  // Invalid stored values also fall back to the defaults (never trusted blindly).
  const corruptDir = join(storageDir, 'runs', 'job-20261001000001-feedface');
  mkdirSync(corruptDir, { recursive: true });
  writeFileSync(
    join(corruptDir, 'job.json'),
    JSON.stringify({ ...legacy, jobId: 'job-20261001000001-feedface', model: 'gpt-something', provider: 'openai', providerModel: 42 }, null, 2),
  );
  const corrupt = readJob(storageDir, 'job-20261001000001-feedface');
  assert.ok(corrupt !== null);
  assert.equal(corrupt.summary.model, 'muse-spark-1.3');
  assert.equal(corrupt.summary.provider, 'meta-api');
  assert.equal(corrupt.summary.providerModel, 'muse-spark-1.3');
});

test('OW-2: recovering an interrupted legacy job records the default model fields on the recovery event', () => {
  const storageDir = tempStorage();
  const runDir = join(storageDir, 'runs', 'job-20261001000002-abcd1234');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'job.json'),
    JSON.stringify(
      {
        jobId: 'job-20261001000002-abcd1234',
        sourceId: 'nasa-grc-equations-of-motion',
        status: 'running',
        purpose: 'test-live',
        createdAt: '2026-10-01T00:00:00.000Z',
        totalCostUSD: 0,
        reservedUnknownUSD: 0,
        engine: null,
        revisions: 0,
        repairs: [],
        sourceKind: 'library',
      },
      null,
      2,
    ),
  );
  const recovered = recoverInterruptedJobs(storageDir, () => new Date('2026-10-29T00:00:00.000Z'), {
    isAlive: () => false,
  });
  assert.deepEqual(recovered, ['job-20261001000002-abcd1234']);
  const events = readEvents(storageDir, 'job-20261001000002-abcd1234');
  assert.equal(events.length, 1);
  assert.equal(events[0].detail, 'INTERRUPTED');
  assert.equal(events[0].model, 'muse-spark-1.3');
  assert.equal((events[0] as StageEvent & { provider?: string }).provider, 'meta-api');
  assert.equal((events[0] as StageEvent & { providerModel?: string }).providerModel, 'muse-spark-1.3');
});
