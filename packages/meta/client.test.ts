import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { costFromUsage, reservationUSD } from './pricing.ts';
import { createMetaClient, MetaError } from './client.ts';
import type { CompleteRequest } from './client.ts';
import type { Usage } from '../contracts/index.ts';

const FAKE_KEY = 'LLM_TEST_SECRET_KEY_123';

function tempLedger(capUSD = 10): { ledger: Ledger; dir: string; file: string } {
  const dir: string = mkdtempSync(path.join(os.tmpdir(), 'meta-client-'));
  const file: string = path.join(dir, 'ledger.jsonl');
  const ledger: Ledger = createLedger({ path: file, capUSD });
  return { ledger, dir, file };
}

function baseRequest(): CompleteRequest {
  return {
    purpose: 'demo',
    schemaName: 'test_schema',
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    messages: [{ role: 'user', content: 'hello' }],
    maxOutputTokens: 100,
  };
}

function successBody(): Record<string, unknown> {
  return {
    id: 'resp_1',
    model: 'muse-spark-1.3',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: '{"ok":true}' },
      },
    ],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 200 },
      prompt_tokens_details: { cached_tokens: 100 },
    },
  };
}

interface Queued {
  status: number;
  body: unknown;
}

function queueFetch(
  queue: Queued[],
  calls: Array<{ url: unknown; init: unknown }>,
): typeof fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const next: Queued | undefined = queue.shift();
    if (next === undefined) {
      throw new Error('no queued response');
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function expectedReservation(req: CompleteRequest): number {
  let chars = 0;
  for (const m of req.messages) {
    chars += m.content.length;
  }
  return reservationUSD('muse-spark-1.3', chars + JSON.stringify(req.jsonSchema).length, req.maxOutputTokens);
}

test('success receipt + ledger reconciled with real cost', async () => {
  const { ledger, dir, file } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(result.receipt.purpose, 'demo');
    assert.equal(result.receipt.requestedModel, 'muse-spark-1.3');
    assert.equal(result.receipt.returnedModel, 'muse-spark-1.3');
    assert.equal(result.receipt.responseId, 'resp_1');
    assert.equal(result.receipt.finishReason, 'stop');
    assert.equal(result.receipt.attempts, 1);
    const expectedUsage: Usage = {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    };
    assert.deepStrictEqual(result.receipt.usage, expectedUsage);
    const expectedCost: number = costFromUsage('muse-spark-1.3', expectedUsage);
    assert.equal(result.receipt.estCostUSD, expectedCost);
    assert.equal(ledger.committedUSD(), expectedCost);
    assert.ok(!JSON.stringify(result.receipt).includes(FAKE_KEY));
    const ledgerText: string = readFileSync(file, 'utf8');
    assert.ok(!ledgerText.includes(FAKE_KEY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('request body shape', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    await client.complete<{ ok: boolean }>(req);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'https://api.meta.ai/v1/chat/completions');
    const init = calls[0]?.init as RequestInit;
    const headers = init.headers as Record<string, string>;
    assert.equal(headers['Authorization'], `Bearer ${FAKE_KEY}`);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    assert.equal(body['model'], 'muse-spark-1.3');
    assert.equal(body['max_tokens'], 100);
    assert.equal(body['reasoning_effort'], 'high');
    assert.equal(body['stream'], false);
    assert.deepStrictEqual(body['messages'], req.messages);
    const responseFormat = body['response_format'] as Record<string, unknown>;
    assert.equal(responseFormat['type'], 'json_schema');
    const jsonSchema = responseFormat['json_schema'] as Record<string, unknown>;
    assert.equal(jsonSchema['name'], 'test_schema');
    assert.deepStrictEqual(jsonSchema['schema'], req.jsonSchema);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('budget refusal sends no request', async () => {
  const { ledger, dir } = tempLedger(0);
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'BUDGET_EXCEEDED');
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('429 then 200 retries once', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 429, body: { error: { message: 'slow' } } }, { status: 200, body: successBody() }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const result = await client.complete<{ ok: boolean }>(baseRequest());
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(result.receipt.attempts, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('503 twice gives SERVER_ERROR after 2 attempts', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 503, body: {} }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'SERVER_ERROR');
      assert.equal((err as MetaError).status, 503);
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(ledger.committedUSD(), expectedReservation(req));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('400 gives BAD_REQUEST with 1 attempt and ledger 0', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 400, body: { error: { message: 'bad thing' } } }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'BAD_REQUEST');
      assert.equal((err as MetaError).status, 400);
      assert.ok((err as MetaError).message.includes('bad thing'));
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('401 gives AUTH_FAILED', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 401, body: {} }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'AUTH_FAILED');
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timeout gives TIMEOUT and ledger at reservation', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const hangingFetch: typeof fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: input, init });
      return await new Promise<Response>((_resolve, reject): void => {
        const signal: unknown = init?.signal;
        if (signal === null || signal === undefined) {
          reject(new Error('no signal'));
          return;
        }
        const s: AbortSignal = signal as AbortSignal;
        if (s.aborted) {
          reject(s.reason);
          return;
        }
        s.addEventListener(
          'abort',
          () => {
            reject(s.reason);
          },
          { once: true },
        );
      });
    };
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      timeoutMs: 20,
      fetchImpl: hangingFetch,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'TIMEOUT');
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), expectedReservation(req));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model mismatch gives RETURNED_MODEL_MISMATCH', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const body: Record<string, unknown> = successBody();
    body['model'] = 'wrong-model';
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'RETURNED_MODEL_MISMATCH');
      assert.ok((err as MetaError).receipt !== undefined);
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    const expectedUsage: Usage = {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    };
    assert.equal(ledger.committedUSD(), costFromUsage('muse-spark-1.3', expectedUsage));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finish_reason length gives OUTPUT_TRUNCATED', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const body: Record<string, unknown> = successBody();
    const choices = body['choices'] as Array<Record<string, unknown>>;
    choices[0]['finish_reason'] = 'length';
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'OUTPUT_TRUNCATED');
      assert.equal((err as MetaError).receipt?.finishReason, 'length');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-JSON content gives OUTPUT_NOT_JSON', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const body: Record<string, unknown> = successBody();
    const choices = body['choices'] as Array<Record<string, unknown>>;
    const message = choices[0]['message'] as Record<string, unknown>;
    message['content'] = 'not json {{{';
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'OUTPUT_NOT_JSON');
      assert.ok(!(err as MetaError).message.includes('not json'));
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty content gives EMPTY_OUTPUT', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const body: Record<string, unknown> = successBody();
    const choices = body['choices'] as Array<Record<string, unknown>>;
    const message = choices[0]['message'] as Record<string, unknown>;
    message['content'] = '';
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'EMPTY_OUTPUT');
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing usage costs reservation', async () => {
  const { ledger, dir } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const body: Record<string, unknown> = successBody();
    delete body['usage'];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(result.receipt.usage, null);
    assert.equal(result.receipt.estCostUSD, expectedReservation(req));
    assert.equal(ledger.committedUSD(), expectedReservation(req));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowLive false and empty key throw', async () => {
  const { ledger, dir } = tempLedger();
  try {
    assert.throws(
      () => {
        createMetaClient({ apiKey: FAKE_KEY, ledger, allowLive: false });
      },
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'LIVE_CALLS_DISABLED');
        return true;
      },
    );
    assert.throws(
      () => {
        createMetaClient({ apiKey: '', ledger, allowLive: true });
      },
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'MODEL_API_KEY_MISSING');
        return true;
      },
    );
    assert.throws(
      () => {
        createMetaClient({ apiKey: undefined, ledger, allowLive: true });
      },
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'MODEL_API_KEY_MISSING');
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API key never appears in errors, receipts or ledger file', async () => {
  const { ledger, dir, file } = tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const mismatch: Record<string, unknown> = successBody();
    mismatch['model'] = 'wrong-model';
    const fetchImpl: typeof fetch = queueFetch(
      [
        { status: 200, body: successBody() },
        { status: 400, body: { error: { message: 'nope' } } },
        { status: 200, body: mismatch },
      ],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const ok = await client.complete<{ ok: boolean }>(baseRequest());
    assert.ok(!JSON.stringify(ok.receipt).includes(FAKE_KEY));
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.ok(!((err as MetaError).message.includes(FAKE_KEY)));
      const receiptText: string = JSON.stringify((err as MetaError).receipt ?? null);
      assert.ok(!receiptText.includes(FAKE_KEY));
      return true;
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.ok(!((err as MetaError).message.includes(FAKE_KEY)));
      return true;
    });
    const ledgerText: string = readFileSync(file, 'utf8');
    assert.ok(!ledgerText.includes(FAKE_KEY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
