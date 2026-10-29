import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:net';
import type { Server, Socket } from 'node:net';
import { defaultLockPort, openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { costFromUsage, inputTokenBound, reservationUSD } from './pricing.ts';
import type { MetaProvider, ModelChoice } from './pricing.ts';
import { createMetaClient, MODAL_MUSE_SPARK_OPEN_MODEL, MetaError } from './client.ts';
import type { CompleteRequest, ProviderConfig } from './client.ts';
import type { Usage } from '../contracts/index.ts';

const SYNTH_MODAL_KEY = 'wk-SYNTHKEY0001';
const SYNTH_MODAL_SECRET = 'ws-SYNTHSECRET0001';
const SYNTH_MODAL_BASE = 'https://synth-workspace--ep-synth-server.us-west.modal.direct/v1';
const META_KEY = 'LLM_TEST_SECRET_KEY_123';
const MARKER = 'SYNTH-MARKER-OW-e8f2a1c4';

async function tempLedger(capUSD = 10): Promise<{ ledger: Ledger; dir: string; file: string }> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-ow-'));
    const file: string = path.join(dir, 'ledger.jsonl');
    try {
      const ledger: Ledger = await openLedger({ path: file, capUSD });
      return { ledger, dir, file };
    } catch (err: unknown) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      const msg: string = err instanceof Error ? err.message : '';
      if ((msg === 'LEDGER_LOCKED' || msg === 'LEDGER_LOCK_FAILED') && attempt < 10) {
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
    messages: [{ role: 'user', content: 'hello open weights' }],
    maxOutputTokens: 100,
  };
}

function metaBody(): Record<string, unknown> {
  return {
    id: 'resp_meta_1',
    model: 'muse-spark-1.3',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 500,
      completion_tokens_details: { reasoning_tokens: 200 },
      prompt_tokens_details: { cached_tokens: 100 },
    },
  };
}

function modalSmokeBody(): Record<string, unknown> {
  return {
    id: '18a39d89838b4d1b833af7fd3794b9f6',
    model: MODAL_MUSE_SPARK_OPEN_MODEL,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }],
    usage: {
      prompt_tokens: 183,
      total_tokens: 598,
      completion_tokens: 415,
      prompt_tokens_details: null,
      reasoning_tokens: 379,
    },
  };
}

interface Queued {
  status: number;
  body: unknown;
}

function queueFetch(queue: Queued[], calls: Array<{ url: unknown; init: unknown }>): typeof fetch {
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

function modalConfig(overrides?: {
  baseUrl?: string;
  proxyKey?: string | undefined;
  proxySecret?: string | undefined;
  modelString?: string;
}): ProviderConfig {
  return {
    provider: 'modal',
    baseUrl: overrides?.baseUrl ?? SYNTH_MODAL_BASE,
    proxyKey: overrides !== undefined && 'proxyKey' in overrides ? overrides.proxyKey : SYNTH_MODAL_KEY,
    proxySecret:
      overrides !== undefined && 'proxySecret' in overrides ? overrides.proxySecret : SYNTH_MODAL_SECRET,
    modelString: overrides?.modelString ?? MODAL_MUSE_SPARK_OPEN_MODEL,
  };
}

function expectedRes(req: CompleteRequest, m: ModelChoice): number {
  return reservationUSD(m, inputTokenBound(req.messages, req.jsonSchema), req.maxOutputTokens);
}

function wrapCounting(real: Ledger): {
  ledger: Ledger;
  reserves: Array<{ purpose: 'test-live' | 'demo'; model: string; estUSD: number; provider?: MetaProvider }>;
  reserveCalls: () => number;
} {
  const reserves: Array<{
    purpose: 'test-live' | 'demo';
    model: string;
    estUSD: number;
    provider?: MetaProvider;
  }> = [];
  const ledger: Ledger = {
    capUSD: real.capUSD,
    reserve: (req: {
      purpose: 'test-live' | 'demo';
      model: string;
      estUSD: number;
      provider?: MetaProvider;
    }): string => {
      reserves.push({ purpose: req.purpose, model: req.model, estUSD: req.estUSD, provider: req.provider });
      return real.reserve(req);
    },
    reconcile: (
      id: string,
      actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
    ): void => {
      real.reconcile(id, actual);
    },
    committedUSD: (provider?: MetaProvider): number => real.committedUSD(provider),
    close: (): void => real.close(),
  };
  return { ledger, reserves, reserveCalls: (): number => reserves.length };
}

function ledgerText(file: string): string {
  if (!fs.existsSync(file)) {
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function listenOn(port: number): Promise<Server> {
  const srv: Server = createServer();
  srv.on('connection', (s: Socket): void => {
    s.destroy();
  });
  return new Promise<Server>((resolve, reject): void => {
    const onListening = (): void => {
      srv.removeListener('error', onError);
      srv.unref();
      srv.on('error', (): void => {});
      resolve(srv);
    };
    const onError = (err: unknown): void => {
      srv.removeListener('listening', onListening);
      reject(err);
    };
    srv.once('listening', onListening);
    srv.once('error', onError);
    srv.listen({ host: '127.0.0.1', port, exclusive: true });
  });
}

function closeServer(srv: Server): Promise<void> {
  return new Promise<void>((resolve): void => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    srv.once('close', finish);
    try {
      srv.close((): void => {
        finish();
      });
    } catch {
      finish();
    }
  });
}

async function freshLedgerPath(prefix: string): Promise<{ dir: string; ledgerPath: string; port: number }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const ledgerPath: string = path.join(dir, 'ledger.jsonl');
    const port: number = defaultLockPort(ledgerPath);
    let probe: Server | null = null;
    try {
      probe = await listenOn(port);
    } catch (err: unknown) {
      lastErr = err;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
      continue;
    }
    await closeServer(probe);
    return { dir, ledgerPath, port };
  }
  const detail: string = lastErr instanceof Error && lastErr.message.length > 0 ? `: ${lastErr.message}` : '';
  throw new Error('NO_FREE_LOCK_PORT' + detail);
}

function readEntries(file: string): Array<Record<string, unknown>> {
  const text: string = fs.readFileSync(file, 'utf8');
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    out.push(JSON.parse(line) as Record<string, unknown>);
  }
  return out;
}

test('open-weights: both providers URL, exact headers and body parity except model', async (): Promise<void> => {
  const m = await tempLedger();
  const o = await tempLedger();
  try {
    const metaCalls: Array<{ url: unknown; init: unknown }> = [];
    const modalCalls: Array<{ url: unknown; init: unknown }> = [];
    const metaClient = createMetaClient({
      apiKey: META_KEY,
      ledger: m.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], metaCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const modalClient = createMetaClient({
      apiKey: undefined,
      ledger: o.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], modalCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const req: CompleteRequest = baseRequest();
    await metaClient.complete<{ ok: boolean }>(req);
    await modalClient.complete<{ ok: boolean }>(req);
    assert.strictEqual(metaCalls.length, 1);
    assert.strictEqual(modalCalls.length, 1);
    assert.strictEqual(metaCalls[0]?.url, 'https://api.meta.ai/v1/chat/completions');
    assert.strictEqual(modalCalls[0]?.url, `${SYNTH_MODAL_BASE}/chat/completions`);
    const metaHeaders = (metaCalls[0]?.init as RequestInit).headers as Record<string, string>;
    const modalHeaders = (modalCalls[0]?.init as RequestInit).headers as Record<string, string>;
    assert.deepStrictEqual(Object.keys(metaHeaders).sort(), ['Authorization', 'Content-Type']);
    assert.strictEqual(metaHeaders['Authorization'], `Bearer ${META_KEY}`);
    assert.deepStrictEqual(Object.keys(modalHeaders).sort(), ['Content-Type', 'Modal-Key', 'Modal-Secret']);
    assert.strictEqual(modalHeaders['Modal-Key'], SYNTH_MODAL_KEY);
    assert.strictEqual(modalHeaders['Modal-Secret'], SYNTH_MODAL_SECRET);
    assert.ok(!('Authorization' in modalHeaders));
    assert.ok(!('Modal-Key' in metaHeaders));
    const metaBodyJson = JSON.parse((metaCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
    const modalBodyJson = JSON.parse((modalCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(metaBodyJson), [
      'model',
      'messages',
      'max_tokens',
      'reasoning_effort',
      'stream',
      'response_format',
    ]);
    assert.deepStrictEqual(Object.keys(modalBodyJson), Object.keys(metaBodyJson));
    assert.strictEqual(metaBodyJson['model'], 'muse-spark-1.3');
    assert.strictEqual(modalBodyJson['model'], MODAL_MUSE_SPARK_OPEN_MODEL);
    assert.deepStrictEqual({ ...metaBodyJson, model: 'X' }, { ...modalBodyJson, model: 'X' });
    assert.strictEqual(metaBodyJson['reasoning_effort'], 'high');
    assert.strictEqual(modalBodyJson['reasoning_effort'], 'high');
  } finally {
    m.ledger.close();
    o.ledger.close();
    fs.rmSync(m.dir, { recursive: true, force: true });
    fs.rmSync(o.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal trailing slashes stripped', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig({ baseUrl: `${SYNTH_MODAL_BASE}///` }),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await client.complete<{ ok: boolean }>(baseRequest());
    assert.strictEqual(calls[0]?.url, `${SYNTH_MODAL_BASE}/chat/completions`);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal ignores top-level apiKey', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: META_KEY,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await client.complete<{ ok: boolean }>(baseRequest());
    const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>;
    assert.ok(!('Authorization' in headers));
    assert.strictEqual(headers['Modal-Key'], SYNTH_MODAL_KEY);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal smoke usage shape costs full input and cachedUnknown true', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const result = await client.complete<{ ok: boolean }>(baseRequest());
    assert.deepStrictEqual(result.receipt.usage, {
      promptTokens: 183,
      completionTokens: 415,
      reasoningTokens: 379,
      cachedTokens: 0,
    });
    const expected: number = (183 * 1.25 + 415 * 4.25) / 1e6;
    assert.ok(Math.abs(result.receipt.estCostUSD - expected) < 1e-12);
    assert.strictEqual(result.receipt.cachedUnknown, true);
    assert.strictEqual(result.receipt.costBasis, 'usage');
    assert.strictEqual(result.receipt.provider, 'modal');
    assert.strictEqual(result.receipt.model, 'muse-spark-open');
    assert.strictEqual(result.receipt.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
    assert.strictEqual(result.receipt.requestedModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: meta-api nested cached usage applies cached price and cachedUnknown false', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: META_KEY,
      ledger: t.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const result = await client.complete<{ ok: boolean }>(baseRequest());
    const usage: Usage = { promptTokens: 1000, completionTokens: 500, reasoningTokens: 200, cachedTokens: 100 };
    assert.deepStrictEqual(result.receipt.usage, usage);
    assert.strictEqual(result.receipt.estCostUSD, costFromUsage('muse-spark-1.3', usage));
    assert.strictEqual(result.receipt.cachedUnknown, false);
    assert.strictEqual(result.receipt.provider, 'meta-api');
    assert.strictEqual(result.receipt.model, 'muse-spark-1.3');
    assert.strictEqual(result.receipt.providerModel, 'muse-spark-1.3');
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: conflicting reasoning fields fall back to reservation', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const body: Record<string, unknown> = modalSmokeBody();
    body['usage'] = {
      prompt_tokens: 100,
      completion_tokens: 200,
      completion_tokens_details: { reasoning_tokens: 50 },
      reasoning_tokens: 60,
      prompt_tokens_details: { cached_tokens: 0 },
    };
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedRes(req, 'muse-spark-open');
    const result = await client.complete<{ ok: boolean }>(req);
    assert.strictEqual(result.receipt.usage, null);
    assert.strictEqual(result.receipt.cachedUnknown, true);
    assert.strictEqual(result.receipt.estCostUSD, reservation);
    assert.strictEqual(result.receipt.costBasis, 'reservation');
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: missing proxy token throws with zero fetch and zero reservations', async (): Promise<void> => {
  const cases: Array<{ name: string; key: string | undefined; secret: string | undefined }> = [
    { name: 'key undefined', key: undefined, secret: SYNTH_MODAL_SECRET },
    { name: 'secret undefined', key: SYNTH_MODAL_KEY, secret: undefined },
    { name: 'key empty', key: '', secret: SYNTH_MODAL_SECRET },
    { name: 'secret empty', key: SYNTH_MODAL_KEY, secret: '' },
  ];
  for (const c of cases) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const fetchImpl: typeof fetch = queueFetch([{ status: 200, body: modalSmokeBody() }], calls);
      const real = t.ledger;
      let reserves = 0;
      const counting: Ledger = {
        capUSD: real.capUSD,
        reserve: (req: {
          purpose: 'test-live' | 'demo';
          model: string;
          estUSD: number;
          provider?: MetaProvider;
        }): string => {
          reserves += 1;
          return real.reserve(req);
        },
        reconcile: (
          id: string,
          actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string },
        ): void => real.reconcile(id, actual),
        committedUSD: (p?: MetaProvider): number => real.committedUSD(p),
        close: (): void => real.close(),
      };
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: counting,
            allowLive: true,
            providerConfig: modalConfig({ proxyKey: c.key, proxySecret: c.secret }),
            fetchImpl,
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError);
          assert.strictEqual((err as MetaError).code, 'MODAL_PROXY_TOKEN_MISSING');
          assert.strictEqual((err as MetaError).message, 'modal proxy token missing');
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, c.name);
      assert.strictEqual(reserves, 0, c.name);
      assert.strictEqual(ledgerText(t.file), '', c.name);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('open-weights: invalid provider configs throw PROVIDER_CONFIG_INVALID', async (): Promise<void> => {
  const badKeys: Array<{ name: string; key: string; secret: string }> = [
    { name: 'swapped', key: SYNTH_MODAL_SECRET, secret: SYNTH_MODAL_KEY },
    { name: 'key prefix', key: 'xx-SYNTHKEY0001', secret: SYNTH_MODAL_SECRET },
    { name: 'secret prefix', key: SYNTH_MODAL_KEY, secret: 'xx-SYNTHSECRET0001' },
    { name: 'key space', key: 'wk-ABC DEF', secret: SYNTH_MODAL_SECRET },
    { name: 'secret space', key: SYNTH_MODAL_KEY, secret: 'ws-ABC DEF' },
  ];
  const badBases: Array<{ name: string; baseUrl: string }> = [
    { name: 'http', baseUrl: 'http://example.test/v1' },
    { name: 'creds', baseUrl: 'https://user:pass@example.test/v1' },
    { name: 'query', baseUrl: 'https://example.test/v1?x=1' },
    { name: 'hash', baseUrl: 'https://example.test/v1#frag' },
    { name: 'unparseable', baseUrl: 'not a url' },
  ];
  type Case = { name: string; run: () => void };
  const cases: Case[] = [];
  for (const b of badKeys) {
    cases.push({
      name: `token ${b.name}`,
      run: (): void => {
        const t = { dir: '', file: '' } as unknown as { dir: string; file: string };
        void t;
      },
    });
    void b;
  }
  void cases;
  // tokens
  for (const b of badKeys) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: modalConfig({ proxyKey: b.key, proxySecret: b.secret }),
            fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, b.name);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID', b.name);
          assert.strictEqual((err as MetaError).message, 'provider configuration invalid', b.name);
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, b.name);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // baseUrls
  for (const b of badBases) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: modalConfig({ baseUrl: b.baseUrl }),
            fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, b.name);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID', b.name);
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, b.name);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // wrong modelString
  {
    const t = await tempLedger();
    try {
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: modalConfig({ modelString: 'muse-spark-1.3' }),
            fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], []),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID');
          return true;
        },
      );
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // top-level baseUrl / model with modal
  for (const extra of ['baseUrl', 'model'] as const) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: modalConfig(),
            ...(extra === 'baseUrl'
              ? { baseUrl: 'https://api.meta.ai/v1' }
              : { model: 'muse-spark-1.3' as const }),
            fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, extra);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID', extra);
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, extra);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // unknown provider + non-object configs
  const bogus: unknown[] = [
    { provider: 'bogus' },
    { provider: undefined },
    {},
    null,
    [],
    'modal',
    42,
  ];
  for (let i = 0; i < bogus.length; i += 1) {
    const t = await tempLedger();
    try {
      assert.throws(
        () =>
          createMetaClient({
            apiKey: META_KEY,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: bogus[i] as unknown as ProviderConfig,
            fetchImpl: queueFetch([{ status: 200, body: metaBody() }], []),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, `bogus ${i}`);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID', `bogus ${i}`);
          return true;
        },
      );
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('open-weights: allowLive false takes precedence over provider config', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    assert.throws(
      () =>
        createMetaClient({
          apiKey: undefined,
          ledger: t.ledger,
          allowLive: false,
          providerConfig: { provider: 'bogus' } as unknown as ProviderConfig,
        }),
      (err: unknown): boolean => {
        assert.ok(err instanceof MetaError);
        assert.strictEqual((err as MetaError).code, 'LIVE_CALLS_DISABLED');
        return true;
      },
    );
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal 429 then 200 retries with two modal reservations', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const real = t.ledger;
    const wrapped = wrapCounting(real);
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: wrapped.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch(
        [{ status: 429, body: { error: { message: 'busy' } } }, { status: 200, body: modalSmokeBody() }],
        calls,
      ),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const result = await client.complete<{ ok: boolean }>(req);
    assert.deepStrictEqual(result.data, { ok: true });
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(result.receipt.attempts, 2);
    assert.strictEqual(wrapped.reserveCalls(), 2);
    assert.strictEqual(wrapped.reserves.length, 2);
    for (const r of wrapped.reserves) {
      assert.strictEqual(r.provider, 'modal');
      assert.strictEqual(r.model, MODAL_MUSE_SPARK_OPEN_MODEL);
    }
    const reservation: number = expectedRes(req, 'muse-spark-open');
    assert.strictEqual(result.receipt.reservedUnknownUSD, reservation);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal 429 twice gives RATE_LIMITED', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 429, body: {} }, { status: 429, body: {} }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      assert.strictEqual((err as MetaError).code, 'RATE_LIMITED');
      assert.strictEqual((err as MetaError).provider, 'modal');
      return true;
    });
    assert.strictEqual(calls.length, 2);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal abort mid-request gives DEADLINE_EXCEEDED', async (): Promise<void> => {
  const t = await tempLedger();
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
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      timeoutMs: 60000,
      providerConfig: modalConfig(),
      fetchImpl: waitingFetch,
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const req: CompleteRequest = baseRequest();
    const reservation: number = expectedRes(req, 'muse-spark-open');
    const pending = client.complete({ ...req, signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      assert.strictEqual((err as MetaError).code, 'DEADLINE_EXCEEDED');
      assert.strictEqual((err as MetaError).provider, 'modal');
      assert.strictEqual((err as MetaError).chargedUSD, reservation);
      return true;
    });
    assert.strictEqual(calls.length, 1);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: modal returned model mismatch', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const body: Record<string, unknown> = modalSmokeBody();
    body['model'] = 'muse-spark-1.3';
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      assert.strictEqual((err as MetaError).code, 'RETURNED_MODEL_MISMATCH');
      assert.strictEqual((err as MetaError).provider, 'modal');
      const receipt = (err as MetaError).receipt;
      assert.ok(receipt !== undefined);
      assert.strictEqual(receipt?.provider, 'modal');
      assert.strictEqual(receipt?.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
      return true;
    });
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: provider error text never leaks', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const bad = { error: { type: 'invalid_request_error', message: `leak ${MARKER} body` } };
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 400, body: bad }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await assert.rejects(client.complete(baseRequest()), (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      assert.strictEqual((err as MetaError).code, 'BAD_REQUEST');
      assert.ok(!(err as MetaError).message.includes(MARKER));
      assert.ok(!JSON.stringify(err).includes(MARKER));
      assert.ok(!String(err).includes(MARKER));
      assert.ok(!((err as MetaError).stack ?? '').includes(MARKER));
      const receiptText: string = JSON.stringify((err as MetaError).receipt ?? null);
      assert.ok(!receiptText.includes(MARKER));
      return true;
    });
    assert.ok(!ledgerText(t.file).includes(MARKER));
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: secrets never appear in ledger, receipts or errors', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: META_KEY,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch(
        [
          { status: 200, body: modalSmokeBody() },
          { status: 400, body: { error: { message: 'bad' } } },
        ],
        calls,
      ),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const ok = await client.complete<{ ok: boolean }>(baseRequest());
    for (const s of [SYNTH_MODAL_KEY, SYNTH_MODAL_SECRET, SYNTH_MODAL_BASE, META_KEY]) {
      assert.ok(!JSON.stringify(ok.receipt).includes(s));
    }
    await assert.rejects(client.complete(baseRequest()), (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      for (const s of [SYNTH_MODAL_KEY, SYNTH_MODAL_SECRET, SYNTH_MODAL_BASE, META_KEY]) {
        assert.ok(!(err as MetaError).message.includes(s));
        assert.ok(!JSON.stringify(err).includes(s));
        assert.ok(!String(err).includes(s));
        assert.ok(!((err as MetaError).stack ?? '').includes(s));
        assert.ok(!JSON.stringify((err as MetaError).receipt ?? null).includes(s));
      }
      return true;
    });
    const text: string = ledgerText(t.file);
    for (const s of [SYNTH_MODAL_KEY, SYNTH_MODAL_SECRET, SYNTH_MODAL_BASE, META_KEY]) {
      assert.ok(!text.includes(s));
    }
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('open-weights: per-provider caps enforce modal while meta-api succeeds', async (): Promise<void> => {
  const fresh = await freshLedgerPath('meta-ow-caps-');
  const ledger: Ledger = await openLedger({
    path: fresh.ledgerPath,
    capUSD: 10,
    lockPort: fresh.port,
    providerCapsUSD: { 'meta-api': 10, modal: 0 },
  });
  try {
    const modalCalls: Array<{ url: unknown; init: unknown }> = [];
    const modalClient = createMetaClient({
      apiKey: undefined,
      ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], modalCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    await assert.rejects(modalClient.complete(baseRequest()), (err: unknown): boolean => {
      assert.ok(err instanceof MetaError);
      assert.strictEqual((err as MetaError).code, 'BUDGET_EXCEEDED');
      assert.strictEqual((err as MetaError).provider, 'modal');
      return true;
    });
    assert.strictEqual(modalCalls.length, 0);
    const metaCalls: Array<{ url: unknown; init: unknown }> = [];
    const metaClient = createMetaClient({
      apiKey: META_KEY,
      ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], metaCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const result = await metaClient.complete<{ ok: boolean }>(baseRequest());
    assert.deepStrictEqual(result.data, { ok: true });
    assert.strictEqual(metaCalls.length, 1);
    assert.strictEqual(result.receipt.provider, 'meta-api');
    const entries = readEntries(fresh.ledgerPath);
    assert.ok(entries.length >= 2);
    for (const e of entries) {
      assert.strictEqual(e['provider'], 'meta-api');
    }
  } finally {
    ledger.close();
    fs.rmSync(fresh.dir, { recursive: true, force: true });
  }
});

test('open-weights: client provider/model/providerModel getters for both', async (): Promise<void> => {
  const m = await tempLedger();
  const o = await tempLedger();
  try {
    const metaClient = createMetaClient({
      apiKey: META_KEY,
      ledger: m.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], []),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const modalClient = createMetaClient({
      apiKey: undefined,
      ledger: o.ledger,
      allowLive: true,
      providerConfig: modalConfig(),
      fetchImpl: queueFetch([{ status: 200, body: modalSmokeBody() }], []),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    assert.strictEqual(metaClient.provider, 'meta-api');
    assert.strictEqual(metaClient.model, 'muse-spark-1.3');
    assert.strictEqual(metaClient.providerModel, 'muse-spark-1.3');
    assert.strictEqual(modalClient.provider, 'modal');
    assert.strictEqual(modalClient.model, 'muse-spark-open');
    assert.strictEqual(modalClient.providerModel, MODAL_MUSE_SPARK_OPEN_MODEL);
  } finally {
    m.ledger.close();
    o.ledger.close();
    fs.rmSync(m.dir, { recursive: true, force: true });
    fs.rmSync(o.dir, { recursive: true, force: true });
  }
});
