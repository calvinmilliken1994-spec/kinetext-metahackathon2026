import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSource, generateSpec } from './pipeline.ts';
import { PROMPT_VERSION } from './prompts.ts';
import { MetaError } from './client.ts';
import type { CompleteRequest, MetaClient } from './client.ts';
import type {
  GeneratedSpec,
  MetaReceipt,
  SourceAnalysis,
  SourceDocument,
} from '../contracts/index.ts';
import { activitySpecGenSchema, sourceAnalysisGenSchema } from '../contracts/schemas.ts';

const source: SourceDocument = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/source-doc.json', import.meta.url), 'utf8'),
) as SourceDocument;

const analysisForces: SourceAnalysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/analysis.forces.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

const genForces: GeneratedSpec = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/gen.forces.json', import.meta.url), 'utf8'),
) as GeneratedSpec;

const fakeReceipt: MetaReceipt = {
  purpose: 'test-live',
  requestedModel: 'muse-spark-1.3',
  returnedModel: 'muse-spark-1.3',
  responseId: 'resp_fake_1',
  usage: { promptTokens: 10, completionTokens: 20, reasoningTokens: 5, cachedTokens: 0 },
  latencyMs: 1,
  estCostUSD: 0.0001,
  finishReason: 'stop',
  attempts: 1,
};

test('analyzeSource validates, uses source_analysis schema and passes purpose through', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: analysisForces as unknown as T, receipt: fakeReceipt };
    },
  };
  const result = await analyzeSource(fake, source, 'test-live');
  assert.equal(result.report.publishable, true);
  assert.equal(seen.length, 1);
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.schemaName, 'source_analysis');
  assert.ok(req0.jsonSchema === sourceAnalysisGenSchema);
  assert.equal(req0.maxOutputTokens, 6000);
  assert.equal(req0.purpose, 'test-live');
});

test('generateSpec assembles provenance, strips source text and validates', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: genForces as unknown as T, receipt: fakeReceipt };
    },
  };
  const fixed: Date = new Date('2026-01-01T00:00:00.000Z');
  const result = await generateSpec(
    fake,
    source,
    analysisForces,
    { jobId: 'job-1', specId: 'spec-1' },
    'test-live',
    () => fixed,
  );
  assert.equal(result.spec.id, 'spec-1');
  assert.deepEqual(result.spec.provenance, {
    provider: 'meta',
    requestedModel: fakeReceipt.requestedModel,
    returnedModel: fakeReceipt.returnedModel,
    responseId: fakeReceipt.responseId,
    runId: 'job-1',
    promptVersion: PROMPT_VERSION,
    revision: 1,
    repairOf: null,
    generatedAt: fixed.toISOString(),
  });
  assert.equal(result.report.publishable, true);
  assert.equal(seen.length, 1);
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.schemaName, 'activity_spec');
  assert.ok(req0.jsonSchema === activitySpecGenSchema);
  assert.equal(req0.maxOutputTokens, 12000);
  assert.equal(req0.purpose, 'test-live');
  assert.equal(result.spec.sources.length, 1);
  const src0 = result.spec.sources[0];
  assert.ok(src0 !== undefined);
  assert.ok(!('text' in (src0 as unknown as Record<string, unknown>)));
});

test('unsupported analysis is returned unchanged', async () => {
  const unsupported: SourceAnalysis = {
    supported: false,
    activity: 'none',
    unsupportedReason: 'The text does not teach one-dimensional motion under a constant net force.',
    concepts: [],
    objectives: [],
  };
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      void req;
      return { data: unsupported as unknown as T, receipt: fakeReceipt };
    },
  };
  const result = await analyzeSource(fake, source, 'demo');
  assert.deepEqual(result.analysis, unsupported);
  assert.ok(result.analysis === unsupported);
});

test('MetaError thrown by the client propagates', async () => {
  const failing: MetaClient = {
    async complete<T>(_req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      throw new MetaError('TIMEOUT', 'timeout');
    },
  };
  await assert.rejects(
    () => analyzeSource(failing, source, 'demo'),
    (err: unknown) => err instanceof MetaError,
  );
  await assert.rejects(
    () =>
      generateSpec(failing, source, analysisForces, { jobId: 'job-1', specId: 'spec-1' }, 'demo'),
    (err: unknown) => err instanceof MetaError,
  );
});
