import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { costFromUsage, inputTokenBound, reservationUSD } from './pricing.ts';
import { createMetaClient, META_ERROR_MESSAGES, MetaError } from './client.ts';
import type { CompleteRequest } from './client.ts';
import type { Usage } from '../contracts/index.ts';

const FAKE_KEY = 'LLM_TEST_SECRET_KEY_123';
const SECRET_MARKER = 'SYNTH_SECRET_MARKER_9f3a';
const SOURCE_MARKER = 'SYNTH_SOURCE_MARKER_7c1e';

async function tempLedger(capUSD = 10): Promise<{ ledger: Ledger; dir: string; file: string }> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const dir: string = mkdtempSync(path.join(os.tmpdir(), 'meta-client-'));
    const file: string = path.join(dir, 'ledger.jsonl');
    try {
      const ledger: Ledger = await openLedger({ path: file, capUSD });
      return { ledger, dir, file };
    } catch (err: unknown) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      const msg: string = err instanceof Error ? err.message : '';
      const retryable: boolean = msg === 'LEDGER_LOCKED' || msg === 'LEDGER_LOCK_FAILED';
      if (retryable && attempt < 10) {
        continue;
      }
      throw err;
    }
  }
  throw new Error('LEDGER_LOCKED');
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

function bodyWithUsage(usage: unknown): Record<string, unknown> {
  const b: Record<string, unknown> = successBody();
  if (usage === undefined) {
    delete b['usage'];
  } else {
    b['usage'] = usage;
  }
  return b;
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

function ledgerTextOrEmpty(file: string): string {
  if (!existsSync(file)) {
    return '';
  }
  return readFileSync(file, 'utf8');
}

function expectedReservation(req: CompleteRequest): number {
  return reservationUSD(
    'muse-spark-1.3',
    inputTokenBound(req.messages, req.jsonSchema),
    req.maxOutputTokens,
  );
}

function assertNoMarkers(err: unknown, receiptText: string, ledgerText: string, reqText: string): void {
  const markers: string[] = [SECRET_MARKER, SOURCE_MARKER, FAKE_KEY, reqText];
  assert.ok(err instanceof MetaError);
  const e = err as MetaError;
  for (const m of markers) {
    assert.ok(!e.message.includes(m), `message leaks ${m}`);
    assert.ok(!JSON.stringify(e).includes(m), `JSON leaks ${m}`);
    assert.ok(!String(e).includes(m), `String leaks ${m}`);
    assert.ok(!(e.stack ?? '').includes(m), `stack leaks ${m}`);
  }
  for (const m of [SECRET_MARKER, SOURCE_MARKER, FAKE_KEY]) {
    assert.ok(!receiptText.includes(m), `receipt leaks ${m}`);
    assert.ok(!ledgerText.includes(m), `ledger leaks ${m}`);
  }
}

function wrapLedger(
  real: Ledger,
  opts: {
    reserveThrow?: (callIndex: number) => unknown;
    reconcileThrow?: (callIndex: number) => unknown;
    onReserve?: () => void;
    onReconcile?: () => void;
  },
): { ledger: Ledger; reserveCalls: () => number; reconcileCalls: () => number } {
  let reserveCount = 0;
  let reconcileCount = 0;
  const ledger: Ledger = {
    capUSD: real.capUSD,
    reserve: (req: { purpose: 'test-live' | 'demo'; model: string; estUSD: number }): string => {
      reserveCount += 1;
      if (opts.onReserve !== undefined) {
        opts.onReserve();
      }
      if (opts.reserveThrow !== undefined) {
        const err: unknown = opts.reserveThrow(reserveCount);
        if (err !== undefined) {
          throw err;
        }
      }
      return real.reserve(req);
    },
    reconcile: (
      reservationId: string,
      actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
    ): void => {
      reconcileCount += 1;
      if (opts.onReconcile !== undefined) {
        opts.onReconcile();
      }
      if (opts.reconcileThrow !== undefined) {
        const err: unknown = opts.reconcileThrow(reconcileCount);
        if (err !== undefined) {
          throw err;
        }
      }
      real.reconcile(reservationId, actual);
    },
    committedUSD: (): number => real.committedUSD(),
    close: (): void => real.close(),
  };
  return {
    ledger,
    reserveCalls: (): number => reserveCount,
    reconcileCalls: (): number => reconcileCount,
  };
}

test('success receipt + ledger reconciled with real cost', async () => {
  const { ledger, dir, file } = await tempLedger();
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
    assert.equal(result.receipt.costBasis, 'usage');
    assert.equal(result.receipt.reservedUnknownUSD, 0);
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
    const ledgerText: string = ledgerTextOrEmpty(file);
    assert.ok(!ledgerText.includes(FAKE_KEY));
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('request body shape', async () => {
  const { ledger, dir } = await tempLedger();
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
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('budget refusal sends no request', async () => {
  const { ledger, dir } = await tempLedger(0);
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
      assert.equal((err as MetaError).message, 'budget exceeded');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('429 then 200 retries once', async () => {
  const { ledger, dir } = await tempLedger();
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
    const req: CompleteRequest = baseRequest();
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(result.receipt.attempts, 2);
    const reservation: number = expectedReservation(req);
    const usage: Usage = {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    };
    const usageCost: number = costFromUsage('muse-spark-1.3', usage);
    assert.equal(result.receipt.estCostUSD, reservation + usageCost);
    assert.equal(result.receipt.costBasis, 'reservation');
    assert.equal(result.receipt.reservedUnknownUSD, reservation);
    assert.equal(ledger.committedUSD(), reservation + usageCost);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('503 twice gives SERVER_ERROR after 2 attempts', async () => {
  const { ledger, dir } = await tempLedger();
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
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'SERVER_ERROR');
      assert.equal((err as MetaError).status, 503);
      assert.equal((err as MetaError).message, 'server error');
      assert.equal((err as MetaError).chargedUSD, 2 * reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, 2 * reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(ledger.committedUSD(), 2 * reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('400 gives BAD_REQUEST with 1 attempt and ledger 0', async () => {
  const { ledger, dir } = await tempLedger();
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
      assert.equal((err as MetaError).message, 'bad request');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('401 gives AUTH_FAILED', async () => {
  const { ledger, dir } = await tempLedger();
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
      assert.equal((err as MetaError).message, 'authentication failed');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('timeout gives TIMEOUT and ledger at reservation', async () => {
  const { ledger, dir } = await tempLedger();
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
          reject((s as AbortSignal).reason);
          return;
        }
        s.addEventListener(
          'abort',
          () => {
            reject((s as AbortSignal).reason);
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
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'TIMEOUT');
      assert.equal((err as MetaError).message, 'timeout');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('model mismatch gives RETURNED_MODEL_MISMATCH', async () => {
  const { ledger, dir } = await tempLedger();
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
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
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
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('finish_reason length gives OUTPUT_TRUNCATED', async () => {
  const { ledger, dir } = await tempLedger();
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
    const req: CompleteRequest = baseRequest();
    const usage: Usage = {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    };
    const usageCost: number = costFromUsage('muse-spark-1.3', usage);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'OUTPUT_TRUNCATED');
      assert.equal((err as MetaError).receipt?.finishReason, 'length');
      assert.ok((err as MetaError).receipt !== undefined);
      assert.equal((err as MetaError).chargedUSD, usageCost);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      assert.equal((err as MetaError).receipt?.estCostUSD, usageCost);
      assert.equal((err as MetaError).receipt?.reservedUnknownUSD, 0);
      return true;
    });
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('non-JSON content gives OUTPUT_NOT_JSON', async () => {
  const { ledger, dir } = await tempLedger();
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
      assert.ok((err as MetaError).receipt !== undefined);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('empty content gives EMPTY_OUTPUT', async () => {
  const { ledger, dir } = await tempLedger();
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
      assert.ok((err as MetaError).receipt !== undefined);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing usage costs reservation', async () => {
  const { ledger, dir } = await tempLedger();
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
    assert.equal(result.receipt.reservedUnknownUSD, expectedReservation(req));
    assert.equal(result.receipt.costBasis, 'reservation');
    assert.equal(ledger.committedUSD(), expectedReservation(req));
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('allowLive false and empty key throw', async () => {
  const { ledger, dir } = await tempLedger();
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
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API key never appears in errors, receipts or ledger file', async () => {
  const { ledger, dir, file } = await tempLedger();
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
    assert.equal(ok.receipt.reservedUnknownUSD, 0);
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      const receiptText: string = JSON.stringify((err as MetaError).receipt ?? null);
      assert.ok(!receiptText.includes(FAKE_KEY));
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.ok(!(err as MetaError).message.includes(FAKE_KEY));
      return true;
    });
    const ledgerText: string = ledgerTextOrEmpty(file);
    assert.ok(!ledgerText.includes(FAKE_KEY));
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-01: reflected markers never leak; providerErrorType allowlist', async () => {
  const reqText = 'request-message-text-abc123';
  const mkReq = (): CompleteRequest => ({
    ...baseRequest(),
    messages: [{ role: 'user', content: reqText }],
  });
  // 400 case
  {
    const { ledger, dir, file } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const bad400: Record<string, unknown> = {
        error: {
          type: 'invalid_request_error',
          message: `${SECRET_MARKER} key=sk-synth ${SOURCE_MARKER} ${reqText}`,
        },
      };
      const fetchImpl: typeof fetch = queueFetch([{ status: 400, body: bad400 }], calls);
      const client = createMetaClient({
        apiKey: FAKE_KEY,
        ledger,
        allowLive: true,
        fetchImpl,
        sleep: async () => {},
        now: () => 1000,
      });
      await assert.rejects(client.complete(mkReq()), (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'BAD_REQUEST');
        assert.equal((err as MetaError).message, 'bad request');
        assert.equal((err as MetaError).providerErrorType, 'invalid_request_error');
        assert.equal((err as MetaError).reservedUnknownUSD, 0);
        assertNoMarkers(err, JSON.stringify((err as MetaError).receipt ?? null), '', reqText);
        return true;
      });
      assertNoMarkers(
        new MetaError('BAD_REQUEST', 'bad request'),
        '',
        ledgerTextOrEmpty(file),
        reqText,
      );
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // 500 twice with markers in both attempts
  {
    const { ledger, dir, file } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const mkBad = (): Record<string, unknown> => ({
        error: {
          type: 'invalid_request_error',
          message: `${SECRET_MARKER} ${SOURCE_MARKER} ${reqText}`,
        },
      });
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 500, body: mkBad() }, { status: 500, body: mkBad() }],
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
      await assert.rejects(client.complete(mkReq()), (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'SERVER_ERROR');
        assert.equal((err as MetaError).message, 'server error');
        assert.equal((err as MetaError).providerErrorType, 'invalid_request_error');
        assertNoMarkers(err, JSON.stringify((err as MetaError).receipt ?? null), '', reqText);
        return true;
      });
      assert.equal(calls.length, 2);
      assertNoMarkers(
        new MetaError('SERVER_ERROR', 'server error'),
        '',
        ledgerTextOrEmpty(file),
        reqText,
      );
      const ledgerText: string = ledgerTextOrEmpty(file);
      assert.ok(!ledgerText.includes(reqText));
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // Bad type omitted: 'Bad Type!' and marker-containing type
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 400, body: { error: { type: 'Bad Type!', message: 'x' } } }],
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
        assert.equal((err as MetaError).providerErrorType, undefined);
        return true;
      });
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 400, body: { error: { type: SECRET_MARKER, message: 'x' } } }],
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
        assert.equal((err as MetaError).providerErrorType, undefined);
        assert.ok(!JSON.stringify(err).includes(SECRET_MARKER));
        assert.equal((err as MetaError).reservedUnknownUSD, 0);
        return true;
      });
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('R-03: 503 then 400 retains first reservation', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 400, body: { error: { message: 'bad' } } }],
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
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'BAD_REQUEST');
      assert.equal((err as MetaError).message, 'bad request');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 2);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-03: 503 then 200 success includes both charges', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
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
    const reservation: number = expectedReservation(req);
    const usage: Usage = {
      promptTokens: 1000,
      completionTokens: 500,
      reasoningTokens: 200,
      cachedTokens: 100,
    };
    const usageCost: number = costFromUsage('muse-spark-1.3', usage);
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(result.receipt.attempts, 2);
    assert.equal(result.receipt.estCostUSD, reservation + usageCost);
    assert.equal(result.receipt.reservedUnknownUSD, reservation);
    assert.equal(result.receipt.costBasis, 'reservation');
    assert.equal(ledger.committedUSD(), reservation + usageCost);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-03: 503 then timeout keeps both reservations', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    let n = 0;
    const fetchImpl: typeof fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      n += 1;
      if (n === 1) {
        return new Response(JSON.stringify({}), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      void input;
      void init;
      throw new DOMException('The operation timed out.', 'TimeoutError');
    };
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      timeoutMs: 60000,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'TIMEOUT');
      assert.equal((err as MetaError).chargedUSD, 2 * reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, 2 * reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(n, 2);
    assert.equal(ledger.committedUSD(), 2 * reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-03: retry refused by cap keeps first liability', async () => {
  const req: CompleteRequest = baseRequest();
  const reservation: number = reservationUSD(
    'muse-spark-1.3',
    inputTokenBound(req.messages, req.jsonSchema),
    req.maxOutputTokens,
  );
  const { ledger, dir } = await tempLedger(reservation);
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
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
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'BUDGET_EXCEEDED');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-04: invalid usages fall back to reservation', async () => {
  const cases: Array<{ name: string; usage: unknown }> = [
    { name: 'empty', usage: {} },
    { name: 'missing completion', usage: { prompt_tokens: 10 } },
    { name: 'missing prompt', usage: { completion_tokens: 10 } },
    { name: 'negative', usage: { prompt_tokens: -5, completion_tokens: 10 } },
    { name: 'fractional', usage: { prompt_tokens: 10.5, completion_tokens: 5 } },
    {
      name: 'cached gt prompt',
      usage: {
        prompt_tokens: 1,
        completion_tokens: 0,
        prompt_tokens_details: { cached_tokens: 1000 },
      },
    },
    {
      name: 'reasoning gt completion',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 2,
        completion_tokens_details: { reasoning_tokens: 5 },
      },
    },
  ];
  for (const c of cases) {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 200, body: bodyWithUsage(c.usage) }],
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
      const reservation: number = expectedReservation(req);
      const result = await client.complete<{ ok: boolean }>(req);
      assert.deepStrictEqual(result.data, { ok: true }, c.name);
      assert.equal(result.receipt.usage, null, c.name);
      assert.equal(result.receipt.estCostUSD, reservation, c.name);
      assert.equal(result.receipt.reservedUnknownUSD, reservation, c.name);
      assert.equal(result.receipt.costBasis, 'reservation', c.name);
      assert.equal(ledger.committedUSD(), reservation, c.name);
      assert.ok(ledger.committedUSD() >= 0, c.name);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('R-06: INPUT_TOO_LARGE sends nothing and writes nothing', async () => {
  const { ledger, dir, file } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      maxInputTokens: 10,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'INPUT_TOO_LARGE');
      assert.equal((err as MetaError).message, 'input too large');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      return true;
    });
    assert.equal(calls.length, 0);
    assert.equal(ledgerTextOrEmpty(file), '');
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-06: unicode-heavy input uses byte-based bound', async () => {
  const { ledger, dir } = await tempLedger();
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
    const text = '日本語テスト🎉'.repeat(20);
    const req: CompleteRequest = {
      ...baseRequest(),
      messages: [{ role: 'user', content: text }],
    };
    const bound: number = inputTokenBound(req.messages, req.jsonSchema);
    assert.ok(bound >= Buffer.byteLength(text, 'utf8'));
    const reservation: number = reservationUSD('muse-spark-1.3', bound, req.maxOutputTokens);
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(ledger.committedUSD() >= 0, true);
    void reservation;
    const before: number = ledger.committedUSD();
    assert.ok(before >= 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-06: unicode reservation equals byte-based reservation', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const failUsage: Record<string, unknown> = successBody();
    delete failUsage['usage'];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: failUsage }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const text = '日本語🎉é';
    const req: CompleteRequest = {
      ...baseRequest(),
      messages: [{ role: 'user', content: text }],
    };
    const bound: number = inputTokenBound(req.messages, req.jsonSchema);
    assert.ok(bound >= Buffer.byteLength(text, 'utf8'));
    const reservation: number = reservationUSD('muse-spark-1.3', bound, req.maxOutputTokens);
    const result = await client.complete<{ ok: boolean }>(req);
    assert.equal(result.receipt.usage, null);
    assert.equal(result.receipt.estCostUSD, reservation);
    assert.equal(result.receipt.reservedUnknownUSD, reservation);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-09: failure and success cost reporting', async () => {
  // 400 has chargedUSD 0
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 400, body: { error: { message: 'x' } } }],
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
        assert.equal((err as MetaError).chargedUSD, 0);
        assert.equal((err as MetaError).reservedUnknownUSD, 0);
        assert.equal((err as MetaError).costBasis, 'usage');
        return true;
      });
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // success receipt has costBasis usage
  {
    const { ledger, dir } = await tempLedger();
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
      const result = await client.complete<{ ok: boolean }>(baseRequest());
      assert.equal(result.receipt.costBasis, 'usage');
      assert.equal(result.receipt.reservedUnknownUSD, 0);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('R-09: fixed messages and constructor ignores message arg', async () => {
  assert.equal(META_ERROR_MESSAGES['BAD_REQUEST'], 'bad request');
  assert.equal(META_ERROR_MESSAGES['HTTP_ERROR'], 'http error');
  assert.equal(META_ERROR_MESSAGES['DEADLINE_EXCEEDED'], 'job deadline exceeded');
  assert.equal(META_ERROR_MESSAGES['INPUT_TOO_LARGE'], 'input too large');
  assert.equal(
    META_ERROR_MESSAGES['LEDGER_ERROR'],
    'spend ledger unavailable; operator recovery required',
  );
  const e = new MetaError('TIMEOUT', 'timeout');
  assert.equal(e.message, 'timeout');
  const ignored = new MetaError('BAD_REQUEST', 'injected provider text');
  assert.equal(ignored.message, 'bad request');
  const withStatus = new MetaError('RATE_LIMITED', 'rate limited', { status: 429 });
  assert.equal(withStatus.message, 'rate limited');
  assert.equal(withStatus.status, 429);
  const withUnknown = new MetaError('TIMEOUT', undefined, {
    chargedUSD: 1,
    reservedUnknownUSD: 1,
    costBasis: 'reservation',
  });
  assert.equal(withUnknown.chargedUSD, 1);
  assert.equal(withUnknown.reservedUnknownUSD, 1);
  assert.equal(withUnknown.costBasis, 'reservation');
});

test('R-11: already-aborted signal sends nothing', async () => {
  const { ledger, dir, file } = await tempLedger();
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
    const controller = new AbortController();
    controller.abort();
    const req: CompleteRequest = { ...baseRequest(), signal: controller.signal };
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'DEADLINE_EXCEEDED');
      assert.equal((err as MetaError).message, 'job deadline exceeded');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      return true;
    });
    assert.equal(calls.length, 0);
    assert.equal(ledgerTextOrEmpty(file), '');
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11: abort during fetch gives DEADLINE_EXCEEDED with one reservation', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const controller = new AbortController();
    const waitingFetch: typeof fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      calls.push({ url: input, init });
      const sig = init?.signal as AbortSignal | undefined;
      return await new Promise<Response>((_resolve, reject): void => {
        if (sig !== undefined && sig.aborted) {
          reject((sig as AbortSignal).reason);
          return;
        }
        sig?.addEventListener(
          'abort',
          () => {
            reject((sig as AbortSignal).reason);
          },
          { once: true },
        );
      });
    };
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      timeoutMs: 60000,
      fetchImpl: waitingFetch,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    const pending = client.complete({ ...req, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'DEADLINE_EXCEEDED');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11: abort during retry sleep gives DEADLINE_EXCEEDED with one fetch', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const controller = new AbortController();
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      sleep: async (_ms: number): Promise<void> => {
        controller.abort();
      },
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    await assert.rejects(
      client.complete({ ...req, signal: controller.signal }),
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'DEADLINE_EXCEEDED');
        assert.equal((err as MetaError).chargedUSD, reservation);
        assert.equal((err as MetaError).reservedUnknownUSD, reservation);
        return true;
      },
    );
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11: fetch combines job signal with timeout', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      timeoutMs: 5000,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const controller = new AbortController();
    await client.complete({ ...baseRequest(), signal: controller.signal });
    assert.equal(calls.length, 1);
    const sig = (calls[0]?.init as RequestInit).signal as AbortSignal;
    assert.ok(sig instanceof AbortSignal);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11a: default sleep aborts promptly on job signal', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      retryDelayMs: 10000,
      now: () => 1000,
    });
    const controller = new AbortController();
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    setTimeout((): void => {
      controller.abort();
    }, 50);
    const started: number = Date.now();
    await assert.rejects(
      client.complete({ ...req, signal: controller.signal }),
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'DEADLINE_EXCEEDED');
        assert.equal((err as MetaError).chargedUSD, reservation);
        assert.equal((err as MetaError).reservedUnknownUSD, reservation);
        assert.equal((err as MetaError).costBasis, 'reservation');
        return true;
      },
    );
    const elapsed: number = Date.now() - started;
    assert.ok(elapsed < 2000, `sleep not abortable, took ${elapsed}ms`);
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11b: injected sleep that ignores signal still aborts promptly', async () => {
  const { ledger, dir } = await tempLedger();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
      calls,
    );
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      retryDelayMs: 100,
      sleep: async (_ms: number): Promise<void> => {
        await new Promise<void>((resolve): void => {
          timer = setTimeout(resolve, 10000);
        });
      },
      now: () => 1000,
    });
    const controller = new AbortController();
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    setTimeout((): void => {
      controller.abort();
    }, 50);
    const started: number = Date.now();
    await assert.rejects(
      client.complete({ ...req, signal: controller.signal }),
      (err: unknown) => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'DEADLINE_EXCEEDED');
        assert.equal((err as MetaError).chargedUSD, reservation);
        assert.equal((err as MetaError).reservedUnknownUSD, reservation);
        return true;
      },
    );
    const elapsed: number = Date.now() - started;
    assert.ok(elapsed < 2000, `race did not abort promptly, took ${elapsed}ms`);
    assert.equal(calls.length, 1);
    assert.equal(ledger.committedUSD(), reservation);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-11d: quiet job signal retries normally with default sleep', async () => {
  const { ledger, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
      calls,
    );
    const controller = new AbortController();
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      fetchImpl,
      retryDelayMs: 5,
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    const result = await client.complete<{ ok: boolean }>({ ...req, signal: controller.signal });
    assert.deepStrictEqual(result.data, { ok: true });
    assert.equal(calls.length, 2);
    assert.equal(result.receipt.attempts, 2);
    assert.equal(result.receipt.reservedUnknownUSD, reservation);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-02a: corrupt ledger line gives LEDGER_ERROR, no fetch', async () => {
  const { ledger, dir, file } = await tempLedger();
  try {
    appendFileSync(file, 'this is not json\n');
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
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal(
        (err as MetaError).message,
        'spend ledger unavailable; operator recovery required',
      );
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      assert.equal((err as MetaError).costBasis, 'usage');
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-02b: closed ledger gives LEDGER_ERROR, no fetch', async () => {
  const { ledger, dir } = await tempLedger();
  ledger.close();
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
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal(
        (err as MetaError).message,
        'spend ledger unavailable; operator recovery required',
      );
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-02c: genuine cap refusal still BUDGET_EXCEEDED', async () => {
  const { ledger, dir } = await tempLedger(0);
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
      assert.equal((err as MetaError).message, 'budget exceeded');
      assert.equal((err as MetaError).chargedUSD, 0);
      assert.equal((err as MetaError).reservedUnknownUSD, 0);
      return true;
    });
    assert.equal(calls.length, 0);
  } finally {
    ledger.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-02d: retry reserve fails with non-cap error gives LEDGER_ERROR', async () => {
  const { ledger: real, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 200, body: successBody() }],
      calls,
    );
    const wrapped = wrapLedger(real, {
      reserveThrow: (n: number): unknown => (n >= 2 ? new Error('LEDGER_CORRUPT') : undefined),
    });
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger: wrapped.ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(wrapped.reserveCalls(), 2);
    assert.equal(real.committedUSD(), reservation);
  } finally {
    real.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-03: malformed 200 envelopes give SERVER_ERROR at reservation', async () => {
  const bodies: Array<{ name: string; body: unknown }> = [
    { name: 'null', body: null },
    { name: 'array', body: [] },
    { name: 'string', body: 'text' },
    { name: 'number', body: 42 },
    { name: 'no-choices', body: {} },
    { name: 'choices-string', body: { choices: 'x' } },
    { name: 'choices-empty', body: { choices: [] } },
    { name: 'choices-null', body: { choices: [null] } },
    { name: 'choices-string-elem', body: { choices: ['x'] } },
  ];
  for (const c of bodies) {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = async (
        input: string | URL | Request,
        init?: RequestInit,
      ): Promise<Response> => {
        calls.push({ url: input, init });
        return new Response(JSON.stringify(c.body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      };
      const client = createMetaClient({
        apiKey: FAKE_KEY,
        ledger,
        allowLive: true,
        fetchImpl,
        sleep: async () => {},
        now: () => 1000,
      });
      const req: CompleteRequest = baseRequest();
      const reservation: number = expectedReservation(req);
      await assert.rejects(client.complete(req), (err: unknown) => {
        assert.ok(err instanceof MetaError, c.name);
        assert.equal((err as MetaError).code, 'SERVER_ERROR', c.name);
        assert.equal((err as MetaError).chargedUSD, reservation, c.name);
        assert.equal((err as MetaError).reservedUnknownUSD, reservation, c.name);
        assert.equal((err as MetaError).costBasis, 'reservation', c.name);
        assert.ok(!String((err as MetaError).stack ?? '').includes('TypeError'), c.name);
        return true;
      }, c.name);
      assert.equal(calls.length, 1, c.name);
      assert.equal(ledger.committedUSD(), reservation, c.name);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('N-03: reconcile throws on 200 success gives LEDGER_ERROR', async () => {
  const { ledger: real, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: successBody() }], calls);
    const wrapped = wrapLedger(real, {
      reconcileThrow: (): unknown => new Error('disk full'),
    });
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger: wrapped.ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(wrapped.reconcileCalls(), 1);
    assert.equal(real.committedUSD(), reservation);
  } finally {
    real.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-03: reconcile throws on 503 gives LEDGER_ERROR with no retry', async () => {
  const { ledger: real, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 503, body: {} }, { status: 503, body: {} }],
      calls,
    );
    const wrapped = wrapLedger(real, {
      reconcileThrow: (): unknown => new Error('disk full'),
    });
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger: wrapped.ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      return true;
    });
    assert.equal(calls.length, 1);
    assert.equal(wrapped.reconcileCalls(), 1);
    assert.equal(wrapped.reserveCalls(), 1);
  } finally {
    real.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-03: reconcile throws on 400 gives LEDGER_ERROR at reservation', async () => {
  const { ledger: real, dir } = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const fetchImpl: typeof fetch = queueFetch(
      [{ status: 400, body: { error: { message: 'bad' } } }],
      calls,
    );
    const wrapped = wrapLedger(real, {
      reconcileThrow: (): unknown => new Error('disk full'),
    });
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger: wrapped.ledger,
      allowLive: true,
      fetchImpl,
      sleep: async () => {},
      now: () => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedReservation(req);
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      assert.equal((err as MetaError).code, 'LEDGER_ERROR');
      assert.equal((err as MetaError).chargedUSD, reservation);
      assert.equal((err as MetaError).reservedUnknownUSD, reservation);
      assert.equal((err as MetaError).costBasis, 'reservation');
      return true;
    });
    assert.equal(calls.length, 1);
  } finally {
    real.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N-03/N-04: post-reservation failures carry consistent cost metadata', async () => {
  const usage: Usage = {
    promptTokens: 1000,
    completionTokens: 500,
    reasoningTokens: 200,
    cachedTokens: 100,
  };
  const usageCost: number = costFromUsage('muse-spark-1.3', usage);
  type Scenario = {
    name: string;
    run: (
      fetchImpl: typeof fetch,
      calls: Array<{ url: unknown; init: unknown }>,
    ) => Promise<MetaError>;
  };
  async function runScenario(
    makeFetch: (
      calls: Array<{ url: unknown; init: unknown }>,
    ) => typeof fetch,
    req: CompleteRequest,
    ledger: Ledger,
  ): Promise<MetaError> {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: FAKE_KEY,
      ledger,
      allowLive: true,
      timeoutMs: 60000,
      fetchImpl: makeFetch(calls),
      sleep: async () => {},
      now: () => 1000,
    });
    await assert.rejects(client.complete(req), (err: unknown) => {
      assert.ok(err instanceof MetaError);
      (globalThis as Record<string, unknown>)['__lastErr'] = err;
      return true;
    });
    return (globalThis as Record<string, unknown>)['__lastErr'] as MetaError;
  }
  const scenarios: Array<{ name: string; make: (calls: Array<{ url: unknown; init: unknown }>) => typeof fetch }> = [
    {
      name: 'timeout',
      make: (calls) => (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: input, init });
        throw new DOMException('timed out', 'TimeoutError');
      }) as typeof fetch,
    },
    {
      name: 'network',
      make: (calls) => (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: input, init });
        throw new Error('socket hang up');
      }) as typeof fetch,
    },
    {
      name: '503x2',
      make: (calls) => queueFetch([{ status: 503, body: {} }, { status: 503, body: {} }], calls),
    },
    {
      name: '400',
      make: (calls) => queueFetch([{ status: 400, body: {} }], calls),
    },
    {
      name: '401',
      make: (calls) => queueFetch([{ status: 401, body: {} }], calls),
    },
    {
      name: '429x2',
      make: (calls) => queueFetch([{ status: 429, body: {} }, { status: 429, body: {} }], calls),
    },
    {
      name: 'model-mismatch',
      make: (calls) => {
        const b = successBody();
        b['model'] = 'wrong';
        return queueFetch([{ status: 200, body: b }], calls);
      },
    },
    {
      name: 'truncated',
      make: (calls) => {
        const b = successBody();
        (b['choices'] as Array<Record<string, unknown>>)[0]['finish_reason'] = 'length';
        return queueFetch([{ status: 200, body: b }], calls);
      },
    },
    {
      name: 'not-json',
      make: (calls) => {
        const b = successBody();
        ((b['choices'] as Array<Record<string, unknown>>)[0]['message'] as Record<string, unknown>)['content'] = 'zzz {{{';
        return queueFetch([{ status: 200, body: b }], calls);
      },
    },
    {
      name: 'empty',
      make: (calls) => {
        const b = successBody();
        ((b['choices'] as Array<Record<string, unknown>>)[0]['message'] as Record<string, unknown>)['content'] = '';
        return queueFetch([{ status: 200, body: b }], calls);
      },
    },
    {
      name: 'envelope-null',
      make: (calls) => (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: input, init });
        return new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch,
    },
  ];
  for (const s of scenarios) {
    const { ledger, dir } = await tempLedger();
    try {
      const req: CompleteRequest = baseRequest();
      const err: MetaError = await runScenario(s.make, req, ledger);
      const charged: number = err.chargedUSD ?? NaN;
      const unknown: number = err.reservedUnknownUSD ?? NaN;
      assert.ok(Number.isFinite(charged), `${s.name} charged finite`);
      assert.ok(Number.isFinite(unknown), `${s.name} unknown finite`);
      assert.ok(charged >= 0, `${s.name} charged >= 0`);
      assert.ok(unknown >= 0, `${s.name} unknown >= 0`);
      assert.ok(charged >= unknown, `${s.name} charged >= unknown`);
      const expectedBasis: 'usage' | 'reservation' = unknown > 0 ? 'reservation' : 'usage';
      assert.equal(err.costBasis, expectedBasis, s.name);
      assert.equal(charged, ledger.committedUSD(), s.name);
      if (s.name === '400' || s.name === '401') {
        assert.equal(charged, 0, s.name);
        assert.equal(unknown, 0, s.name);
      }
      if (s.name === 'truncated') {
        assert.equal(charged, usageCost, s.name);
        assert.equal(unknown, 0, s.name);
      }
      void usageCost;
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('N-04: mixed costs split known and unknown', async () => {
  const usage: Usage = {
    promptTokens: 1000,
    completionTokens: 500,
    reasoningTokens: 200,
    cachedTokens: 100,
  };
  const usageCost: number = costFromUsage('muse-spark-1.3', usage);
  // 503 -> 200
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 503, body: {} }, { status: 200, body: successBody() }],
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
      const reservation: number = expectedReservation(req);
      const result = await client.complete<{ ok: boolean }>(req);
      assert.equal(result.receipt.reservedUnknownUSD, reservation);
      assert.equal(result.receipt.estCostUSD, reservation + usageCost);
      assert.equal(result.receipt.costBasis, 'reservation');
      assert.equal(ledger.committedUSD(), reservation + usageCost);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // plain 200
  {
    const { ledger, dir } = await tempLedger();
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
      const result = await client.complete<{ ok: boolean }>(baseRequest());
      assert.equal(result.receipt.reservedUnknownUSD, 0);
      assert.equal(result.receipt.costBasis, 'usage');
      assert.equal(result.receipt.estCostUSD, usageCost);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // 200 invalid usage
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 200, body: bodyWithUsage({}) }],
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
      const reservation: number = expectedReservation(req);
      const result = await client.complete<{ ok: boolean }>(req);
      assert.equal(result.receipt.reservedUnknownUSD, reservation);
      assert.equal(result.receipt.estCostUSD, reservation);
      assert.equal(result.receipt.costBasis, 'reservation');
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // 503 -> 400
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 503, body: {} }, { status: 400, body: {} }],
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
      const reservation: number = expectedReservation(req);
      await assert.rejects(client.complete(req), (err: unknown) => {
        assert.equal((err as MetaError).chargedUSD, reservation);
        assert.equal((err as MetaError).reservedUnknownUSD, reservation);
        assert.equal((err as MetaError).costBasis, 'reservation');
        return true;
      });
      assert.equal(ledger.committedUSD(), reservation);
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // 400 alone
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch([{ status: 400, body: {} }], calls);
      const client = createMetaClient({
        apiKey: FAKE_KEY,
        ledger,
        allowLive: true,
        fetchImpl,
        sleep: async () => {},
        now: () => 1000,
      });
      await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
        assert.equal((err as MetaError).chargedUSD, 0);
        assert.equal((err as MetaError).reservedUnknownUSD, 0);
        assert.equal((err as MetaError).costBasis, 'usage');
        return true;
      });
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // OUTPUT_TRUNCATED with valid usage
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const b = successBody();
      (b['choices'] as Array<Record<string, unknown>>)[0]['finish_reason'] = 'length';
      const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: b }], calls);
      const client = createMetaClient({
        apiKey: FAKE_KEY,
        ledger,
        allowLive: true,
        fetchImpl,
        sleep: async () => {},
        now: () => 1000,
      });
      await assert.rejects(client.complete(baseRequest()), (err: unknown) => {
        assert.equal((err as MetaError).chargedUSD, usageCost);
        assert.equal((err as MetaError).reservedUnknownUSD, 0);
        assert.equal((err as MetaError).costBasis, 'usage');
        assert.equal((err as MetaError).receipt?.estCostUSD, usageCost);
        assert.equal((err as MetaError).receipt?.reservedUnknownUSD, 0);
        return true;
      });
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // 429 -> 200
  {
    const { ledger, dir } = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch(
        [{ status: 429, body: {} }, { status: 200, body: successBody() }],
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
      const reservation: number = expectedReservation(req);
      const result = await client.complete<{ ok: boolean }>(req);
      assert.equal(result.receipt.reservedUnknownUSD, reservation);
      assert.equal(result.receipt.estCostUSD, reservation + usageCost);
      assert.equal(result.receipt.costBasis, 'reservation');
    } finally {
      ledger.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
