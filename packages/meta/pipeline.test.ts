import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSource, generateSpec, GeneratedOutputError } from './pipeline.ts';
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

const FIXED_MESSAGE = 'The model returned output that does not match the required structure.';
const MARKER_ANALYZE = 'SYNTH-MARKER-ANALYZE-q7w4e9z2k1';
const MARKER_SPEC = 'SYNTH-MARKER-SPEC-m8n3p6r5t2';

function fakeClientFor<T>(data: unknown): MetaClient {
  return {
    async complete<U>(req: CompleteRequest): Promise<{ data: U; receipt: MetaReceipt }> {
      void req;
      return { data: data as unknown as U, receipt: fakeReceipt };
    },
  };
}

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
  assert.equal(req0.maxOutputTokens, 8000);
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

test('analyzeSource sends maxOutputTokens 6000 by default and honours the override', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: analysisForces as unknown as T, receipt: fakeReceipt };
    },
  };
  await analyzeSource(fake, source, 'demo');
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.maxOutputTokens, 6000);
  await analyzeSource(fake, source, 'demo', { maxOutputTokens: 1234 });
  const req1 = seen[1];
  assert.ok(req1 !== undefined);
  assert.equal(req1.maxOutputTokens, 1234);
});

test('generateSpec sends maxOutputTokens 8000 by default and honours the override', async () => {
  const seen: CompleteRequest[] = [];
  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seen.push(req);
      return { data: genForces as unknown as T, receipt: fakeReceipt };
    },
  };
  await generateSpec(fake, source, analysisForces, { jobId: 'job-1', specId: 'spec-1' }, 'demo');
  const req0 = seen[0];
  assert.ok(req0 !== undefined);
  assert.equal(req0.maxOutputTokens, 8000);
  await generateSpec(
    fake,
    source,
    analysisForces,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { maxOutputTokens: 4321 },
  );
  const req1 = seen[1];
  assert.ok(req1 !== undefined);
  assert.equal(req1.maxOutputTokens, 4321);
});

test('provided signal is forwarded as the same object; no signal key when not provided', async () => {
  const seenAnalyze: CompleteRequest[] = [];
  const fakeAnalyze: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seenAnalyze.push(req);
      return { data: analysisForces as unknown as T, receipt: fakeReceipt };
    },
  };
  await analyzeSource(fakeAnalyze, source, 'demo');
  const defaultAnalyze = seenAnalyze[0];
  assert.ok(defaultAnalyze !== undefined);
  assert.ok(!('signal' in defaultAnalyze));
  const controllerA = new AbortController();
  await analyzeSource(fakeAnalyze, source, 'demo', { signal: controllerA.signal });
  const withSignalAnalyze = seenAnalyze[1];
  assert.ok(withSignalAnalyze !== undefined);
  assert.ok(withSignalAnalyze.signal === controllerA.signal);

  const seenSpec: CompleteRequest[] = [];
  const fakeSpec: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      seenSpec.push(req);
      return { data: genForces as unknown as T, receipt: fakeReceipt };
    },
  };
  await generateSpec(fakeSpec, source, analysisForces, { jobId: 'job-1', specId: 'spec-1' }, 'demo');
  const defaultSpec = seenSpec[0];
  assert.ok(defaultSpec !== undefined);
  assert.ok(!('signal' in defaultSpec));
  const controllerB = new AbortController();
  await generateSpec(
    fakeSpec,
    source,
    analysisForces,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
    { signal: controllerB.signal },
  );
  const withSignalSpec = seenSpec[1];
  assert.ok(withSignalSpec !== undefined);
  assert.ok(withSignalSpec.signal === controllerB.signal);
});

test('aborted job signal with a DEADLINE_EXCEEDED client error propagates that MetaError', async () => {
  const failing: MetaClient = {
    async complete<T>(_req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      throw new MetaError('DEADLINE_EXCEEDED');
    },
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => analyzeSource(failing, source, 'demo', { signal: controller.signal }),
    (err: unknown) => err instanceof MetaError && err.code === 'DEADLINE_EXCEEDED',
  );
  await assert.rejects(
    () =>
      generateSpec(failing, source, analysisForces, { jobId: 'job-1', specId: 'spec-1' }, 'demo', () => new Date(), {
        signal: controller.signal,
      }),
    (err: unknown) => err instanceof MetaError && err.code === 'DEADLINE_EXCEEDED',
  );
});

test('analyzeSource rejects null, number, array, empty object and missing-supported with GeneratedOutputError and no leakage', async () => {
  const missingSupported = JSON.parse(JSON.stringify(analysisForces)) as Record<string, unknown>;
  delete missingSupported['supported'];
  missingSupported['objectives'] = [MARKER_ANALYZE];
  const cases: unknown[] = [null, 42, [], {}, missingSupported];
  for (const bad of cases) {
    const fake: MetaClient = fakeClientFor(bad);
    let caught: unknown;
    try {
      await analyzeSource(fake, source, 'demo');
      assert.fail('expected GeneratedOutputError');
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof GeneratedOutputError);
    const outErr = caught as GeneratedOutputError;
    assert.equal(outErr.code, 'OUTPUT_INVALID');
    assert.equal(outErr.stage, 'analyze');
    assert.ok(outErr.receipt === fakeReceipt);
    assert.equal(outErr.message, FIXED_MESSAGE);
    assert.equal(outErr.name, 'GeneratedOutputError');
    assert.ok(outErr instanceof Error);
    assert.ok(!outErr.message.includes(MARKER_ANALYZE));
    assert.ok(!JSON.stringify(outErr).includes(MARKER_ANALYZE));
  }
});

test('analyzeSource error for a marker-bearing invalid object never echoes model output', async () => {
  const badWithMarker: Record<string, unknown> = {
    supported: true,
    activity: 'forces-1d-v1',
    unsupportedReason: MARKER_ANALYZE,
    concepts: [],
    objectives: [MARKER_ANALYZE],
  };
  delete badWithMarker['supported'];
  const fake: MetaClient = fakeClientFor(badWithMarker);
  let caught: unknown;
  try {
    await analyzeSource(fake, source, 'demo');
    assert.fail('expected GeneratedOutputError');
  } catch (err: unknown) {
    caught = err;
  }
  assert.ok(caught instanceof GeneratedOutputError);
  const outErr = caught as GeneratedOutputError;
  assert.equal(outErr.stage, 'analyze');
  assert.ok(outErr.receipt === fakeReceipt);
  assert.equal(outErr.message, FIXED_MESSAGE);
  assert.ok(!outErr.message.includes(MARKER_ANALYZE));
  assert.ok(!JSON.stringify(outErr).includes(MARKER_ANALYZE));
});

test('generateSpec rejects null, empty object, null simulation and missing required field with GeneratedOutputError', async () => {
  const missingTitle = JSON.parse(JSON.stringify(genForces)) as Record<string, unknown>;
  delete missingTitle['title'];
  missingTitle['learningObjectives'] = [MARKER_SPEC];
  const cases: unknown[] = [null, {}, { simulation: null }, missingTitle];
  for (const bad of cases) {
    const fake: MetaClient = fakeClientFor(bad);
    let caught: unknown;
    try {
      await generateSpec(
        fake,
        source,
        analysisForces,
        { jobId: 'job-1', specId: 'spec-1' },
        'demo',
        () => new Date('2026-01-01T00:00:00.000Z'),
      );
      assert.fail('expected GeneratedOutputError');
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof GeneratedOutputError);
    const outErr = caught as GeneratedOutputError;
    assert.equal(outErr.code, 'OUTPUT_INVALID');
    assert.equal(outErr.stage, 'specify');
    assert.ok(outErr.receipt === fakeReceipt);
    assert.equal(outErr.message, FIXED_MESSAGE);
    assert.equal(outErr.name, 'GeneratedOutputError');
    assert.ok(outErr instanceof Error);
    assert.ok(!outErr.message.includes(MARKER_SPEC));
    assert.ok(!JSON.stringify(outErr).includes(MARKER_SPEC));
  }
});

test('GeneratedOutputError shape is fixed and schema-valid recorded spec still succeeds', async () => {
  const err = new GeneratedOutputError('specify', fakeReceipt);
  assert.equal(err.code, 'OUTPUT_INVALID');
  assert.equal(err.stage, 'specify');
  assert.ok(err.receipt === fakeReceipt);
  assert.equal(err.name, 'GeneratedOutputError');
  assert.equal(err.message, FIXED_MESSAGE);
  assert.ok(err instanceof Error);
  const analyzeErr = new GeneratedOutputError('analyze', fakeReceipt);
  assert.equal(analyzeErr.stage, 'analyze');
  assert.equal(analyzeErr.code, 'OUTPUT_INVALID');

  const fake: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      void req;
      return { data: genForces as unknown as T, receipt: fakeReceipt };
    },
  };
  const result = await generateSpec(
    fake,
    source,
    analysisForces,
    { jobId: 'job-1', specId: 'spec-1' },
    'demo',
    () => new Date('2026-01-01T00:00:00.000Z'),
  );
  assert.equal(result.report.publishable, true);
  assert.ok(result.receipt === fakeReceipt);
  assert.equal(result.generated, genForces as unknown as GeneratedSpec);

  const fakeAnalysis: MetaClient = {
    async complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
      void req;
      return { data: analysisForces as unknown as T, receipt: fakeReceipt };
    },
  };
  const analysisResult = await analyzeSource(fakeAnalysis, source, 'demo');
  assert.ok(analysisResult.analysis === analysisForces);
});
