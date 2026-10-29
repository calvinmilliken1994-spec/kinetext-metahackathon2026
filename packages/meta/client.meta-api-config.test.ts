import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { createMetaClient, MetaError } from './client.ts';
import type { CompleteRequest, ProviderConfig } from './client.ts';
import type { Usage } from '../contracts/index.ts';
import type { MetaProvider } from './pricing.ts';

const SYNTH_META_KEY = 'SYNTH-META-KEY-a1b2c3d4e5';
const SYNTH_CUSTOM_BASE = 'https://synth-meta-custom.example.test/v1';
const SMUGGLED_PROXY_KEY = 'SYNTH-SMUGGLED-PROXYKEY-f1f2f3f4';
const SMUGGLED_PROXY_SECRET = 'SYNTH-SMUGGLED-PROXYSECRET-a5a6a7a8';
const SMUGGLED_BASE_URL = 'https://synth-smuggled-modal.example.test/v1';
const SMUGGLED_MODEL_STRING = 'SYNTH-SMUGGLED-MODELSTRING-b9c0d1e2';
const SMUGGLED_MARKERS: readonly string[] = [
  SMUGGLED_PROXY_KEY,
  SMUGGLED_PROXY_SECRET,
  SMUGGLED_BASE_URL,
  SMUGGLED_MODEL_STRING,
];

async function tempLedger(capUSD = 10): Promise<{ ledger: Ledger; dir: string; file: string }> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-explicit-'));
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
    messages: [{ role: 'user', content: 'hello explicit meta-api' }],
    maxOutputTokens: 100,
  };
}

function metaBody(): Record<string, unknown> {
  return {
    id: 'resp_meta_explicit_1',
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

function ledgerText(file: string): string {
  if (!fs.existsSync(file)) {
    return '';
  }
  return fs.readFileSync(file, 'utf8');
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

function countingLedger(real: Ledger): {
  ledger: Ledger;
  reserves: Array<{ purpose: 'test-live' | 'demo'; model: string; estUSD: number; provider?: MetaProvider }>;
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
    committedUSD: (p?: MetaProvider): number => real.committedUSD(p),
    close: (): void => real.close(),
  };
  return { ledger, reserves };
}

test('meta-api-config: explicit matches absent URL headers and body (default and custom base)', async (): Promise<void> => {
  // Default base.
  {
    const a = await tempLedger();
    const b = await tempLedger();
    try {
      const absentCalls: Array<{ url: unknown; init: unknown }> = [];
      const explicitCalls: Array<{ url: unknown; init: unknown }> = [];
      const absentClient = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: a.ledger,
        allowLive: true,
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], absentCalls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      const explicitClient = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: b.ledger,
        allowLive: true,
        providerConfig: { provider: 'meta-api' },
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], explicitCalls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      await absentClient.complete<{ ok: boolean }>(baseRequest());
      await explicitClient.complete<{ ok: boolean }>(baseRequest());
      assert.strictEqual(absentCalls.length, 1);
      assert.strictEqual(explicitCalls.length, 1);
      assert.strictEqual(absentCalls[0]?.url, 'https://api.meta.ai/v1/chat/completions');
      assert.strictEqual(explicitCalls[0]?.url, 'https://api.meta.ai/v1/chat/completions');
      const absentHeaders = (absentCalls[0]?.init as RequestInit).headers as Record<string, string>;
      const explicitHeaders = (explicitCalls[0]?.init as RequestInit).headers as Record<string, string>;
      assert.deepStrictEqual(Object.keys(explicitHeaders).sort(), ['Authorization', 'Content-Type']);
      assert.deepStrictEqual(Object.keys(absentHeaders).sort(), ['Authorization', 'Content-Type']);
      assert.strictEqual(explicitHeaders['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      assert.strictEqual(absentHeaders['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      assert.ok(!('Modal-Key' in explicitHeaders));
      assert.ok(!('Modal-Secret' in explicitHeaders));
      const absentJson = JSON.parse((absentCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
      const explicitJson = JSON.parse(
        (explicitCalls[0]?.init as RequestInit).body as string,
      ) as Record<string, unknown>;
      assert.deepStrictEqual(explicitJson, absentJson);
      assert.strictEqual(explicitJson['model'], 'muse-spark-1.3');
    } finally {
      a.ledger.close();
      b.ledger.close();
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.rmSync(b.dir, { recursive: true, force: true });
    }
  }
  // Custom top-level baseUrl.
  {
    const a = await tempLedger();
    const b = await tempLedger();
    try {
      const absentCalls: Array<{ url: unknown; init: unknown }> = [];
      const explicitCalls: Array<{ url: unknown; init: unknown }> = [];
      const absentClient = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: a.ledger,
        allowLive: true,
        baseUrl: SYNTH_CUSTOM_BASE,
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], absentCalls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      const explicitClient = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: b.ledger,
        allowLive: true,
        baseUrl: SYNTH_CUSTOM_BASE,
        providerConfig: { provider: 'meta-api' },
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], explicitCalls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      await absentClient.complete<{ ok: boolean }>(baseRequest());
      await explicitClient.complete<{ ok: boolean }>(baseRequest());
      assert.strictEqual(absentCalls[0]?.url, `${SYNTH_CUSTOM_BASE}/chat/completions`);
      assert.strictEqual(explicitCalls[0]?.url, `${SYNTH_CUSTOM_BASE}/chat/completions`);
      const absentHeaders = (absentCalls[0]?.init as RequestInit).headers as Record<string, string>;
      const explicitHeaders = (explicitCalls[0]?.init as RequestInit).headers as Record<string, string>;
      assert.deepStrictEqual(Object.keys(explicitHeaders).sort(), ['Authorization', 'Content-Type']);
      assert.strictEqual(explicitHeaders['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      assert.strictEqual(absentHeaders['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      assert.ok(!('Modal-Key' in explicitHeaders));
      assert.ok(!('Modal-Secret' in explicitHeaders));
      const absentJson = JSON.parse((absentCalls[0]?.init as RequestInit).body as string) as Record<string, unknown>;
      const explicitJson = JSON.parse(
        (explicitCalls[0]?.init as RequestInit).body as string,
      ) as Record<string, unknown>;
      assert.deepStrictEqual(explicitJson, absentJson);
    } finally {
      a.ledger.close();
      b.ledger.close();
      fs.rmSync(a.dir, { recursive: true, force: true });
      fs.rmSync(b.dir, { recursive: true, force: true });
    }
  }
});

test('meta-api-config: missing or empty apiKey throws MODEL_API_KEY_MISSING', async (): Promise<void> => {
  const cases: Array<{ name: string; apiKey: string | undefined }> = [
    { name: 'undefined', apiKey: undefined },
    { name: 'empty', apiKey: '' },
  ];
  for (const c of cases) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const wrapped = countingLedger(t.ledger);
      assert.throws(
        () =>
          createMetaClient({
            apiKey: c.apiKey,
            ledger: wrapped.ledger,
            allowLive: true,
            providerConfig: { provider: 'meta-api' },
            fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, c.name);
          assert.strictEqual((err as MetaError).code, 'MODEL_API_KEY_MISSING', c.name);
          assert.strictEqual((err as MetaError).message, 'model API key missing', c.name);
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, c.name);
      assert.strictEqual(wrapped.reserves.length, 0, c.name);
      assert.strictEqual(ledgerText(t.file), '', c.name);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('meta-api-config: allowLive false throws LIVE_CALLS_DISABLED first', async (): Promise<void> => {
  // Valid key still blocked when live calls are disabled.
  {
    const t = await tempLedger();
    try {
      assert.throws(
        () =>
          createMetaClient({
            apiKey: SYNTH_META_KEY,
            ledger: t.ledger,
            allowLive: false,
            providerConfig: { provider: 'meta-api' },
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError);
          assert.strictEqual((err as MetaError).code, 'LIVE_CALLS_DISABLED');
          assert.strictEqual((err as MetaError).message, 'live calls disabled');
          return true;
        },
      );
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // Missing key must still report LIVE_CALLS_DISABLED first, not MODEL_API_KEY_MISSING.
  {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      assert.throws(
        () =>
          createMetaClient({
            apiKey: undefined,
            ledger: t.ledger,
            allowLive: false,
            providerConfig: { provider: 'meta-api' },
            fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError);
          assert.strictEqual((err as MetaError).code, 'LIVE_CALLS_DISABLED');
          return true;
        },
      );
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(ledgerText(t.file), '');
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('meta-api-config: receipt fields getters and ledger match absent config', async (): Promise<void> => {
  const a = await tempLedger();
  const b = await tempLedger();
  try {
    const absentCalls: Array<{ url: unknown; init: unknown }> = [];
    const explicitCalls: Array<{ url: unknown; init: unknown }> = [];
    const absentWrapped = countingLedger(a.ledger);
    const explicitWrapped = countingLedger(b.ledger);
    const absentClient = createMetaClient({
      apiKey: SYNTH_META_KEY,
      ledger: absentWrapped.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], absentCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const explicitClient = createMetaClient({
      apiKey: SYNTH_META_KEY,
      ledger: explicitWrapped.ledger,
      allowLive: true,
      providerConfig: { provider: 'meta-api' },
      fetchImpl: queueFetch([{ status: 200, body: metaBody() }], explicitCalls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const absentResult = await absentClient.complete<{ ok: boolean }>(baseRequest());
    const explicitResult = await explicitClient.complete<{ ok: boolean }>(baseRequest());
    for (const receipt of [absentResult.receipt, explicitResult.receipt]) {
      assert.strictEqual(receipt.provider, 'meta-api');
      assert.strictEqual(receipt.model, 'muse-spark-1.3');
      assert.strictEqual(receipt.providerModel, 'muse-spark-1.3');
      assert.strictEqual(receipt.requestedModel, 'muse-spark-1.3');
    }
    assert.deepStrictEqual(
      {
        provider: explicitResult.receipt.provider,
        model: explicitResult.receipt.model,
        providerModel: explicitResult.receipt.providerModel,
        requestedModel: explicitResult.receipt.requestedModel,
      },
      {
        provider: absentResult.receipt.provider,
        model: absentResult.receipt.model,
        providerModel: absentResult.receipt.providerModel,
        requestedModel: absentResult.receipt.requestedModel,
      },
    );
    assert.strictEqual(explicitClient.provider, 'meta-api');
    assert.strictEqual(explicitClient.model, 'muse-spark-1.3');
    assert.strictEqual(explicitClient.providerModel, 'muse-spark-1.3');
    assert.strictEqual(explicitClient.provider, absentClient.provider);
    assert.strictEqual(explicitClient.model, absentClient.model);
    assert.strictEqual(explicitClient.providerModel, absentClient.providerModel);
    assert.strictEqual(explicitWrapped.reserves.length, 1);
    assert.strictEqual(explicitWrapped.reserves[0]?.provider, 'meta-api');
    assert.strictEqual(explicitWrapped.reserves[0]?.model, 'muse-spark-1.3');
    const entries = readEntries(b.file);
    const reserves = entries.filter((e: Record<string, unknown>): boolean => e['kind'] === 'reserve');
    assert.strictEqual(reserves.length, 1);
    assert.strictEqual(reserves[0]?.['provider'], 'meta-api');
    assert.strictEqual(reserves[0]?.['model'], 'muse-spark-1.3');
  } finally {
    a.ledger.close();
    b.ledger.close();
    fs.rmSync(a.dir, { recursive: true, force: true });
    fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

test('meta-api-config: smuggled modal-only fields are ignored', async (): Promise<void> => {
  const smuggled: ProviderConfig = {
    provider: 'meta-api',
    proxyKey: SMUGGLED_PROXY_KEY,
    proxySecret: SMUGGLED_PROXY_SECRET,
    baseUrl: SMUGGLED_BASE_URL,
    modelString: SMUGGLED_MODEL_STRING,
  } as unknown as ProviderConfig;
  // Default top-level base: URL must be the default, not the smuggled baseUrl.
  {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const client = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: t.ledger,
        allowLive: true,
        providerConfig: smuggled,
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      const result = await client.complete<{ ok: boolean }>(baseRequest());
      assert.strictEqual(calls.length, 1);
      const url: unknown = calls[0]?.url;
      assert.strictEqual(url, 'https://api.meta.ai/v1/chat/completions');
      const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>;
      assert.deepStrictEqual(Object.keys(headers).sort(), ['Authorization', 'Content-Type']);
      assert.strictEqual(headers['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      const bodyText: string = (calls[0]?.init as RequestInit).body as string;
      const headerText: string = JSON.stringify(headers);
      const receiptText: string = JSON.stringify(result.receipt);
      for (const marker of SMUGGLED_MARKERS) {
        assert.ok(!String(url).includes(marker));
        assert.ok(!headerText.includes(marker));
        assert.ok(!bodyText.includes(marker));
        assert.ok(!receiptText.includes(marker));
      }
      assert.strictEqual(result.receipt.provider, 'meta-api');
      const ledgerContents: string = ledgerText(t.file);
      for (const marker of SMUGGLED_MARKERS) {
        assert.ok(!ledgerContents.includes(marker));
      }
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // Custom top-level baseUrl: URL must follow the top-level option, not the smuggled one.
  {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const client = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: t.ledger,
        allowLive: true,
        baseUrl: SYNTH_CUSTOM_BASE,
        providerConfig: smuggled,
        fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      const result = await client.complete<{ ok: boolean }>(baseRequest());
      assert.strictEqual(calls[0]?.url, `${SYNTH_CUSTOM_BASE}/chat/completions`);
      const headers = (calls[0]?.init as RequestInit).headers as Record<string, string>;
      assert.ok(!('Modal-Key' in headers));
      assert.ok(!('Modal-Secret' in headers));
      assert.strictEqual(headers['Authorization'], `Bearer ${SYNTH_META_KEY}`);
      const bodyText: string = (calls[0]?.init as RequestInit).body as string;
      for (const marker of SMUGGLED_MARKERS) {
        assert.ok(!String(calls[0]?.url).includes(marker));
        assert.ok(!JSON.stringify(headers).includes(marker));
        assert.ok(!bodyText.includes(marker));
        assert.ok(!JSON.stringify(result.receipt).includes(marker));
      }
      assert.ok(!ledgerText(t.file).includes(SMUGGLED_PROXY_KEY));
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('meta-api-config: invalid providerConfig values throw PROVIDER_CONFIG_INVALID', async (): Promise<void> => {
  const bogus: Array<{ name: string; value: unknown }> = [
    { name: 'null', value: null },
    { name: 'array', value: [] },
    { name: 'string', value: 'meta-api' },
    { name: 'empty object', value: {} },
    { name: 'uppercase provider', value: { provider: 'META-API' } },
  ];
  for (const c of bogus) {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      assert.throws(
        () =>
          createMetaClient({
            apiKey: SYNTH_META_KEY,
            ledger: t.ledger,
            allowLive: true,
            providerConfig: c.value as unknown as ProviderConfig,
            fetchImpl: queueFetch([{ status: 200, body: metaBody() }], calls),
            sleep: async (): Promise<void> => {},
            now: (): number => 1000,
          }),
        (err: unknown): boolean => {
          assert.ok(err instanceof MetaError, c.name);
          assert.strictEqual((err as MetaError).code, 'PROVIDER_CONFIG_INVALID', c.name);
          assert.strictEqual((err as MetaError).message, 'provider configuration invalid', c.name);
          return true;
        },
      );
      assert.strictEqual(calls.length, 0, c.name);
      assert.strictEqual(ledgerText(t.file), '', c.name);
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});
