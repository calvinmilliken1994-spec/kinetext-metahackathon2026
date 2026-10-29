import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSource } from './pipeline.ts';
import { buildAnalysisMessages, PROMPT_VERSION } from './prompts.ts';
import { createMetaClient, MODAL_MUSE_SPARK_OPEN_MODEL } from './client.ts';
import type { Ledger } from './ledger.ts';
import type { MetaProvider } from './pricing.ts';
import type { CompleteRequest } from './client.ts';
import type { SourceAnalysis, SourceDocument, Usage } from '../contracts/index.ts';

const SYNTH_KEY = 'wk-SYNTHKEY0001';
const SYNTH_SECRET = 'ws-SYNTHSECRET0001';
const SYNTH_BASE = 'https://synth-workspace--ep-synth-server.us-west.modal.direct/v1';
const META_KEY = 'LLM_TEST_SECRET_KEY_123';

const source: SourceDocument = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/source-doc.json', import.meta.url), 'utf8'),
) as SourceDocument;

const analysisForces: SourceAnalysis = JSON.parse(
  readFileSync(new URL('../../tests/fixtures/analysis.forces.json', import.meta.url), 'utf8'),
) as SourceAnalysis;

function fakeLedger(): Ledger {
  let n = 0;
  return {
    capUSD: 100,
    reserve: (_req: {
      purpose: 'test-live' | 'demo';
      model: string;
      estUSD: number;
      provider?: MetaProvider;
    }): string => {
      n += 1;
      return `r-${n}`;
    },
    reconcile: (
      _id: string,
      _actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
    ): void => {},
    committedUSD: (_provider?: MetaProvider): number => 0,
    close: (): void => {},
  };
}

function capturingFetch(calls: Array<{ url: unknown; init: unknown }>): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const body = JSON.parse((init?.body as string) as string) as Record<string, unknown>;
    const model: string = typeof body['model'] === 'string' ? (body['model'] as string) : '';
    const resp: Record<string, unknown> = {
      id: 'resp_pipeline_1',
      model,
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: JSON.stringify(analysisForces) },
        },
      ],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 200,
        completion_tokens_details: { reasoning_tokens: 50 },
        prompt_tokens_details: { cached_tokens: 10 },
      },
    };
    return new Response(JSON.stringify(resp), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

test('pipeline open-weights: same report on both providers, bodies equal except model', async (): Promise<void> => {
  assert.strictEqual(PROMPT_VERSION, 'v9');
  const metaCalls: Array<{ url: unknown; init: unknown }> = [];
  const modalCalls: Array<{ url: unknown; init: unknown }> = [];
  const metaClient = createMetaClient({
    apiKey: META_KEY,
    ledger: fakeLedger(),
    allowLive: true,
    maxInputTokens: 64000,
    fetchImpl: capturingFetch(metaCalls),
    sleep: async (): Promise<void> => {},
    now: (): number => 1000,
  });
  const modalClient = createMetaClient({
    apiKey: undefined,
    ledger: fakeLedger(),
    allowLive: true,
    maxInputTokens: 64000,
    providerConfig: {
      provider: 'modal',
      baseUrl: SYNTH_BASE,
      proxyKey: SYNTH_KEY,
      proxySecret: SYNTH_SECRET,
      modelString: MODAL_MUSE_SPARK_OPEN_MODEL,
    },
    fetchImpl: capturingFetch(modalCalls),
    sleep: async (): Promise<void> => {},
    now: (): number => 1000,
  });
  const metaOut = await analyzeSource(metaClient, source, 'test-live');
  const modalOut = await analyzeSource(modalClient, source, 'test-live');
  assert.deepStrictEqual(metaOut.analysis, analysisForces);
  assert.deepStrictEqual(modalOut.analysis, analysisForces);
  assert.deepStrictEqual(metaOut.report, modalOut.report);
  assert.strictEqual(metaCalls.length, 1);
  assert.strictEqual(modalCalls.length, 1);
  const metaBody = JSON.parse((metaCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
  const modalBody = JSON.parse((modalCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
  assert.strictEqual(metaBody['model'], 'muse-spark-1.3');
  assert.strictEqual(modalBody['model'], MODAL_MUSE_SPARK_OPEN_MODEL);
  assert.deepStrictEqual({ ...metaBody, model: 'X' }, { ...modalBody, model: 'X' });
  const expectedMessages = buildAnalysisMessages(source);
  assert.deepStrictEqual(metaBody['messages'], expectedMessages);
  assert.deepStrictEqual(modalBody['messages'], expectedMessages);
  const metaReq = metaOut.receipt as unknown as Record<string, unknown>;
  const modalReq = modalOut.receipt as unknown as Record<string, unknown>;
  assert.strictEqual(metaReq['provider'], 'meta-api');
  assert.strictEqual(metaReq['model'], 'muse-spark-1.3');
  assert.strictEqual(metaReq['providerModel'], 'muse-spark-1.3');
  assert.strictEqual(modalReq['provider'], 'modal');
  assert.strictEqual(modalReq['model'], 'muse-spark-open');
  assert.strictEqual(modalReq['providerModel'], MODAL_MUSE_SPARK_OPEN_MODEL);
  void ({} as { _?: CompleteRequest });
});
