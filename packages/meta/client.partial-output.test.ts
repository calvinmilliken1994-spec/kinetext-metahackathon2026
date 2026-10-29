import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openLedger } from './ledger.ts';
import type { Ledger } from './ledger.ts';
import { MODAL_MUSE_SPARK_OPEN_MODEL, createMetaClient, MetaError } from './client.ts';
import type { CompleteRequest } from './client.ts';

const SYNTH_META_KEY = 'SYNTH-PARTIAL-META-KEY-aa11bb22';
const SYNTH_MODAL_BASE = 'https://synth-partial-modal.example.test';
const SYNTH_MODAL_KEY = 'wk-synth-partial-key-001';
const SYNTH_MODAL_SECRET = 'ws-synth-partial-secret-001';
const PARTIAL_MARKER = 'SYNTH-PARTIAL-CONTENT-m7n8o9p0';
const CAP_MARKER = 'SYNTH-PARTIAL-CAP-q1r2s3t4-';

async function tempLedger(capUSD = 10): Promise<{ ledger: Ledger; dir: string; file: string }> {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const dir: string = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-partial-'));
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
    messages: [{ role: 'user', content: 'hello partial output' }],
    maxOutputTokens: 100,
  };
}

function okUsage(): Record<string, unknown> {
  return {
    prompt_tokens: 1000,
    completion_tokens: 500,
    completion_tokens_details: { reasoning_tokens: 50 },
    prompt_tokens_details: { cached_tokens: 100 },
  };
}

function chatBody(model: string, finishReason: string, content: string): Record<string, unknown> {
  return {
    id: 'resp_synth_partial_1',
    model,
    choices: [
      { index: 0, finish_reason: finishReason, message: { role: 'assistant', content } },
    ],
    usage: okUsage(),
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

test('partial-output: length attaches content as non-enumerable partialOutput', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const content: string = `{"part":1,"marker":"${PARTIAL_MARKER}"}`;
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: SYNTH_META_KEY,
      ledger: t.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: chatBody('muse-spark-1.3', 'length', content) }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    let caught: unknown;
    try {
      await client.complete<{ ok: boolean }>(baseRequest());
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof MetaError);
    const metaErr = caught as MetaError;
    assert.strictEqual(metaErr.code, 'OUTPUT_TRUNCATED');
    assert.strictEqual(metaErr.message, 'output truncated');
    assert.strictEqual(metaErr.partialOutput, content);
    const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(metaErr, 'partialOutput');
    assert.ok(desc !== undefined);
    assert.strictEqual(desc.enumerable, false);
    assert.strictEqual(desc.writable, false);
    assert.strictEqual(desc.configurable, false);
    assert.strictEqual(desc.value, content);
    assert.ok(!Object.keys(metaErr).includes('partialOutput'));
    assert.ok(!JSON.stringify(metaErr).includes(PARTIAL_MARKER));
    assert.ok(!metaErr.message.includes(PARTIAL_MARKER));
    assert.ok(!String(metaErr).includes(PARTIAL_MARKER));
    const spread: Record<string, unknown> = { ...metaErr };
    assert.ok(!('partialOutput' in spread));
    assert.ok(metaErr.receipt !== undefined);
    assert.ok(!JSON.stringify(metaErr.receipt).includes(PARTIAL_MARKER));
    assert.ok(!ledgerText(t.file).includes(PARTIAL_MARKER));
    assert.strictEqual(calls.length, 1);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('partial-output: 250000-char content is capped to 200000', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const content: string = CAP_MARKER + 'x'.repeat(250000 - CAP_MARKER.length);
    assert.strictEqual(content.length, 250000);
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: SYNTH_META_KEY,
      ledger: t.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: chatBody('muse-spark-1.3', 'length', content) }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    let caught: unknown;
    try {
      await client.complete<{ ok: boolean }>(baseRequest());
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof MetaError);
    const metaErr = caught as MetaError;
    assert.strictEqual(metaErr.code, 'OUTPUT_TRUNCATED');
    assert.ok(typeof metaErr.partialOutput === 'string');
    assert.strictEqual((metaErr.partialOutput as string).length, 200000);
    assert.strictEqual(metaErr.partialOutput, content.slice(0, 200000));
    assert.ok((metaErr.partialOutput as string).includes(CAP_MARKER));
    assert.ok(!JSON.stringify(metaErr).includes(CAP_MARKER));
    assert.ok(!Object.keys(metaErr).includes('partialOutput'));
    assert.ok(!String(metaErr).includes(CAP_MARKER));
    assert.ok(!ledgerText(t.file).includes(CAP_MARKER));
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('partial-output: normal stop response is unchanged', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: SYNTH_META_KEY,
      ledger: t.ledger,
      allowLive: true,
      fetchImpl: queueFetch([{ status: 200, body: chatBody('muse-spark-1.3', 'stop', '{"ok":true}') }], calls),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    const result = await client.complete<{ ok: boolean }>(baseRequest());
    assert.deepStrictEqual(result.data, { ok: true });
    assert.strictEqual(result.receipt.finishReason, 'stop');
    assert.strictEqual(calls.length, 1);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});

test('partial-output: other error codes carry no partialOutput', async (): Promise<void> => {
  // EMPTY_OUTPUT: finish stop but empty content.
  {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const client = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: t.ledger,
        allowLive: true,
        fetchImpl: queueFetch([{ status: 200, body: chatBody('muse-spark-1.3', 'stop', '') }], calls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      let caught: unknown;
      try {
        await client.complete<{ ok: boolean }>(baseRequest());
      } catch (err: unknown) {
        caught = err;
      }
      assert.ok(caught instanceof MetaError);
      const metaErr = caught as MetaError;
      assert.strictEqual(metaErr.code, 'EMPTY_OUTPUT');
      assert.strictEqual(Object.getOwnPropertyDescriptor(metaErr, 'partialOutput'), undefined);
      assert.strictEqual(metaErr.partialOutput, undefined);
      assert.ok(!('partialOutput' in metaErr));
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
  // RETURNED_MODEL_MISMATCH: wrong model string.
  {
    const t = await tempLedger();
    try {
      const calls: Array<{ url: unknown; init: unknown }> = [];
      const client = createMetaClient({
        apiKey: SYNTH_META_KEY,
        ledger: t.ledger,
        allowLive: true,
        fetchImpl: queueFetch([
          { status: 200, body: chatBody('synth-wrong-model', 'stop', '{"ok":true}') },
        ], calls),
        sleep: async (): Promise<void> => {},
        now: (): number => 1000,
      });
      let caught: unknown;
      try {
        await client.complete<{ ok: boolean }>(baseRequest());
      } catch (err: unknown) {
        caught = err;
      }
      assert.ok(caught instanceof MetaError);
      const metaErr = caught as MetaError;
      assert.strictEqual(metaErr.code, 'RETURNED_MODEL_MISMATCH');
      assert.strictEqual(Object.getOwnPropertyDescriptor(metaErr, 'partialOutput'), undefined);
      assert.strictEqual(metaErr.partialOutput, undefined);
      assert.ok(!('partialOutput' in metaErr));
    } finally {
      t.ledger.close();
      fs.rmSync(t.dir, { recursive: true, force: true });
    }
  }
});

test('partial-output: modal length attaches partialOutput', async (): Promise<void> => {
  const t = await tempLedger();
  try {
    const content: string = `{"part":9,"marker":"${PARTIAL_MARKER}-modal"}`;
    const calls: Array<{ url: unknown; init: unknown }> = [];
    const client = createMetaClient({
      apiKey: undefined,
      ledger: t.ledger,
      allowLive: true,
      providerConfig: {
        provider: 'modal',
        baseUrl: SYNTH_MODAL_BASE,
        proxyKey: SYNTH_MODAL_KEY,
        proxySecret: SYNTH_MODAL_SECRET,
        modelString: MODAL_MUSE_SPARK_OPEN_MODEL,
      },
      fetchImpl: queueFetch(
        [{ status: 200, body: chatBody(MODAL_MUSE_SPARK_OPEN_MODEL, 'length', content) }],
        calls,
      ),
      sleep: async (): Promise<void> => {},
      now: (): number => 1000,
    });
    let caught: unknown;
    try {
      await client.complete<{ ok: boolean }>(baseRequest());
    } catch (err: unknown) {
      caught = err;
    }
    assert.ok(caught instanceof MetaError);
    const metaErr = caught as MetaError;
    assert.strictEqual(metaErr.code, 'OUTPUT_TRUNCATED');
    assert.strictEqual(metaErr.partialOutput, content);
    const desc: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(metaErr, 'partialOutput');
    assert.ok(desc !== undefined);
    assert.strictEqual(desc.enumerable, false);
    assert.strictEqual(desc.writable, false);
    assert.strictEqual(desc.configurable, false);
    assert.ok(!Object.keys(metaErr).includes('partialOutput'));
    assert.ok(!JSON.stringify(metaErr).includes(PARTIAL_MARKER));
    assert.ok(!String(metaErr).includes(PARTIAL_MARKER));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.url, `${SYNTH_MODAL_BASE}/chat/completions`);
  } finally {
    t.ledger.close();
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
});
