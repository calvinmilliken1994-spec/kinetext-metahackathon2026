// TASK-008 — full HTTP round trip through the real API + worker, with recorded Muse
// output standing in for the network. No Meta call, no credits, no .env access:
// a fake MetaClient returns the committed real Muse Spark 1.3 fixtures by schemaName.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApiServer } from '../../apps/api/server.ts';
import { startJob } from '../../workers/generation/jobs.ts';
import type { JobSummary } from '../../workers/generation/jobs.ts';
import { loadSource } from '../../packages/sources/index.ts';
import { validateSpec } from '../../packages/validation/validate.ts';
import type { CompleteRequest, MetaClient } from '../../packages/meta/client.ts';
import type {
  ActivitySpec,
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  StageEvent,
  ValidationReport,
} from '../../packages/contracts/index.ts';

const MODEL = 'muse-spark-1.3';
const SUPPORTED_SOURCE = 'nasa-grc-equations-of-motion';
const UNSUPPORTED_SOURCE = 'nasa-grc-speed-of-sound';
const UNSUPPORTED_MARKER = 'Speed of Sound';
const FIXTURE_COST_USD = 0.01;
const POLL_TIMEOUT_MS = 10_000;

function readFixture<T>(fileName: string): T {
  const url = new URL(`../fixtures/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

const analysisFixture = readFixture<SourceAnalysis>('nasa-analysis.recorded.json');
const genFixture = readFixture<GeneratedSpec>('nasa-gen.recorded.json');
const unsupportedAnalysisFixture = readFixture<SourceAnalysis>('nasa-unsupported-analysis.recorded.json');

interface JobView {
  summary: JobSummary;
  events: StageEvent[];
  analysis?: unknown;
  spec?: unknown;
  report?: unknown;
}

function fakeReceipt(responseId: string): MetaReceipt {
  return {
    purpose: 'test-live',
    requestedModel: MODEL,
    returnedModel: MODEL,
    responseId,
    usage: { promptTokens: 1200, completionTokens: 800, reasoningTokens: 300, cachedTokens: 0 },
    latencyMs: 1,
    estCostUSD: FIXTURE_COST_USD,
    finishReason: 'stop',
    attempts: 1,
  };
}

/** Recorded Muse output chosen by schemaName; the analysis follows the source in the prompt. */
function recordedClient(): MetaClient {
  return {
    complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
      if (req.schemaName === 'source_analysis') {
        const userMessage = req.messages.map(m => m.content).join('\n');
        const unsupported = userMessage.includes(UNSUPPORTED_MARKER);
        return {
          data: (unsupported ? unsupportedAnalysisFixture : analysisFixture) as T,
          receipt: fakeReceipt(unsupported ? 'fake-analysis-unsupported' : 'fake-analysis-1'),
        };
      }
      assert.equal(req.schemaName, 'activity_spec', `unexpected schemaName ${req.schemaName}`);
      return { data: genFixture as T, receipt: fakeReceipt('fake-gen-1') };
    },
  };
}

/** Same recorded output, but every call waits on a gate we open by hand. */
function gatedClient(): { client: MetaClient; release: () => void } {
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => {
    release = (): void => resolve();
  });
  const inner = recordedClient();
  return {
    release: () => release(),
    client: {
      complete: async <T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> => {
        await gate;
        return inner.complete<T>(req);
      },
    },
  };
}

async function postJob(base: string, sourceId: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}/api/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceId }),
  });
  return { status: res.status, body: (await res.json()) as unknown };
}

async function getJob(base: string, jobId: string): Promise<JobView> {
  const res = await fetch(`${base}/api/jobs/${jobId}`);
  assert.equal(res.status, 200, `GET /api/jobs/${jobId} answers 200`);
  return (await res.json()) as JobView;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Poll until the job leaves 'running'; the worker settles it in-process. */
async function waitForTerminal(base: string, jobId: string, timeoutMs = POLL_TIMEOUT_MS): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;
  let last: JobView | undefined;
  while (Date.now() < deadline) {
    last = await getJob(base, jobId);
    if (last.summary.status !== 'running') {
      return last;
    }
    await sleep(20);
  }
  throw new Error(
    `job ${jobId} did not leave 'running' within ${timeoutMs}ms (last status ${String(last?.summary.status)})`,
  );
}

/**
 * Temp storage + ephemeral server on 127.0.0.1:0, closed and deleted afterwards
 * even when an assertion fails.
 */
async function withPipeline(
  client: MetaClient,
  run: (ctx: { base: string; storageDir: string }) => Promise<void>,
): Promise<void> {
  const storageDir = mkdtempSync(join(tmpdir(), 'task008-api-'));
  const server: Server = createApiServer({
    storageDir,
    startJob: sourceId => startJob(sourceId, { client, storageDir, purpose: 'test-live' }),
  });
  try {
    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object', 'server bound to a port');
    const base = `http://127.0.0.1:${(address as AddressInfo).port}`;
    await run({ base, storageDir });
  } finally {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
    rmSync(storageDir, { recursive: true, force: true });
  }
}

test('POST/GET round trip: recorded Muse output becomes a publishable 15/15 spec over HTTP', async () => {
  await withPipeline(recordedClient(), async ({ base, storageDir }) => {
    const created = await postJob(base, SUPPORTED_SOURCE);
    assert.equal(created.status, 202, 'a live job is accepted with 202');
    const jobId = (created.body as { jobId?: unknown }).jobId;
    assert.equal(typeof jobId, 'string');
    assert.match(String(jobId), /^job-\d{14}-[0-9a-f]{8}$/);

    const view = await waitForTerminal(base, String(jobId));
    const summary = view.summary;
    assert.equal(summary.status, 'succeeded');
    assert.equal(summary.publishable, true);
    assert.equal(summary.checksPassed, 15);
    assert.equal(summary.checksTotal, 15);
    assert.equal(summary.totalCostUSD, 0.02, 'analysis receipt + spec receipt');
    assert.equal(summary.error, undefined);
    assert.equal(summary.specId, `${SUPPORTED_SOURCE}-${String(jobId)}`);
    assert.ok(existsSync(join(storageDir, 'runs', String(jobId), 'spec.r1.json')), 'the spec is persisted');

    // The returned spec still verifies deterministically against the real source.
    const spec = view.spec as ActivitySpec;
    assert.equal(spec.id, summary.specId);
    assert.equal(spec.provenance.provider, 'meta');
    assert.equal(spec.provenance.requestedModel, MODEL);
    assert.equal(spec.provenance.returnedModel, MODEL);
    assert.equal(spec.provenance.responseId, 'fake-gen-1');
    assert.equal(spec.provenance.runId, String(jobId));

    const source = loadSource(SUPPORTED_SOURCE);
    const revalidated: ValidationReport = validateSpec(spec, [source]);
    assert.equal(
      revalidated.publishable,
      true,
      `returned spec re-validates: ${revalidated.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.message}`).join('; ')}`,
    );
    assert.equal(revalidated.checks.length, 15);
    const storedReport = view.report as ValidationReport;
    assert.deepEqual(
      revalidated.checks.map(c => ({ id: c.id, passed: c.passed })),
      storedReport.checks.map(c => ({ id: c.id, passed: c.passed })),
      'the served report matches a fresh validation',
    );
    assert.deepEqual(
      view.events.map(e => `${e.stage}:${e.status}`),
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

    // The run is listed newest-first.
    const list = await fetch(`${base}/api/jobs`);
    assert.equal(list.status, 200);
    const jobs = (await list.json()) as JobSummary[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.jobId, String(jobId));
    assert.equal(jobs[0]?.status, 'succeeded');
    assert.equal(jobs[0]?.checksPassed, 15);
  });
});

test('POST/GET round trip: unsupported source ends honestly, with no spec', async () => {
  await withPipeline(recordedClient(), async ({ base, storageDir }) => {
    const created = await postJob(base, UNSUPPORTED_SOURCE);
    assert.equal(created.status, 202);
    const jobId = String((created.body as { jobId: unknown }).jobId);

    const view = await waitForTerminal(base, jobId);
    assert.equal(view.summary.status, 'unsupported');
    assert.equal(view.summary.specId, undefined);
    assert.equal(view.summary.publishable, undefined);
    assert.equal(view.spec, undefined, 'the API serves no spec for an unsupported source');
    assert.equal(view.report, undefined);
    assert.equal(view.summary.totalCostUSD, FIXTURE_COST_USD, 'analysis call only');
    assert.equal(view.summary.error, undefined);

    const analysis = view.analysis as { analysis: SourceAnalysis; report: ValidationReport };
    assert.equal(analysis.analysis.supported, false);
    assert.equal(analysis.analysis.activity, 'none');
    assert.ok(analysis.analysis.unsupportedReason.trim().length > 0, 'unsupportedReason is non-empty');
    assert.equal(analysis.report.publishable, true);
    assert.ok(!existsSync(join(storageDir, 'runs', jobId, 'spec.r1.json')), 'no spec file is written');

    assert.equal(
      view.events.find(e => e.stage === 'done')?.detail,
      'unsupported',
      'the done event records the honest outcome',
    );
  });
});

test('POST while a job is running answers 409 JOB_RUNNING, then accepts again once settled', async () => {
  const gate = gatedClient();
  await withPipeline(gate.client, async ({ base }) => {
    const first = await postJob(base, SUPPORTED_SOURCE);
    assert.equal(first.status, 202);
    const jobId = String((first.body as { jobId: unknown }).jobId);

    // The job is parked inside analyze (the gated MetaClient call), so it is running.
    const parked = await getJob(base, jobId);
    assert.equal(parked.summary.status, 'running');

    const blocked = await postJob(base, SUPPORTED_SOURCE);
    assert.equal(blocked.status, 409);
    assert.deepEqual(blocked.body, { error: 'JOB_RUNNING' });

    gate.release();
    const settled = await waitForTerminal(base, jobId);
    assert.equal(settled.summary.status, 'succeeded');
    assert.equal(settled.summary.checksPassed, 15);

    const second = await postJob(base, SUPPORTED_SOURCE);
    assert.equal(second.status, 202, 'the in-flight gate is cleared once the run settles');
    const secondId = String((second.body as { jobId: unknown }).jobId);
    assert.notEqual(secondId, jobId);
    const secondView = await waitForTerminal(base, secondId);
    assert.equal(secondView.summary.status, 'succeeded');
  });
});