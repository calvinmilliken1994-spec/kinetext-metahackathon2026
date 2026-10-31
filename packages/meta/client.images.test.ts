import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient, MetaError, MODAL_MUSE_SPARK_OPEN_MODEL } from './client.ts';
import type { ChatMessage } from './client.ts';
import type { Ledger } from './ledger.ts';
import { inputTokenBound } from './pricing.ts';

const SCHEMA: Record<string, unknown> = { type: 'object' };

function makeFakeLedger(): {
  ledger: Ledger;
  reserveCalls: Array<Parameters<Ledger['reserve']>[0]>;
} {
  const reserveCalls: Array<Parameters<Ledger['reserve']>[0]> = [];
  let n = 0;
  const ledger: Ledger = {
    capUSD: 10,
    reserve: (req: Parameters<Ledger['reserve']>[0]): string => {
      reserveCalls.push(req);
      n += 1;
      return `res-${n}`;
    },
    reconcile: (): void => {},
    committedUSD: (): number => 0,
    close: (): void => {},
  };
  return { ledger, reserveCalls };
}

function fakeChatFetch(captured: { body: Record<string, unknown>; count: number }): typeof fetch {
  return (async (
    _url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    captured.count += 1;
    captured.body = JSON.parse(init?.body as string) as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async (): Promise<unknown> => ({
        id: 'resp-1',
        model: 'muse-spark-1.3',
        choices: [{ finish_reason: 'stop', message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function imageUserMessage(): ChatMessage[] {
  return [
    {
      role: 'user',
      content: 'label this diagram',
      images: [{ url: 'data:image/jpeg;base64,AAA' }],
    },
  ];
}

describe('chat image transport', (): void => {
  it('serialises a user image as a text part then one image_url part', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const captured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const client = createMetaClient({
      apiKey: 'test-key',
      ledger: fake.ledger,
      allowLive: true,
      fetchImpl: fakeChatFetch(captured),
    });
    const result = await client.complete<{ ok: boolean }>({
      purpose: 'demo',
      schemaName: 's',
      jsonSchema: SCHEMA,
      messages: imageUserMessage(),
      maxOutputTokens: 16,
    });
    assert.equal(result.data.ok, true);
    assert.equal(captured.count, 1);
    const sent: unknown = (captured.body['messages'] as unknown[])[0];
    assert.deepEqual(sent, {
      role: 'user',
      content: [
        { type: 'text', text: 'label this diagram' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
      ],
    });
    assert.equal('images' in (sent as Record<string, unknown>), false);
  });

  it('sends text-only messages with string content, byte-identical to before', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const captured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const client = createMetaClient({
      apiKey: 'test-key',
      ledger: fake.ledger,
      allowLive: true,
      fetchImpl: fakeChatFetch(captured),
    });
    const messages: ChatMessage[] = [
      { role: 'system', content: 'you are a teacher' },
      { role: 'user', content: 'hello' },
    ];
    // Existing readers keep compiling unchanged: content reads as a string.
    const systemText: string = messages[0]?.content as string;
    assert.ok(systemText.includes('teacher'));
    const result = await client.complete<{ ok: boolean }>({
      purpose: 'demo',
      schemaName: 's',
      jsonSchema: SCHEMA,
      messages,
      maxOutputTokens: 16,
    });
    assert.equal(result.data.ok, true);
    assert.equal(captured.count, 1);
    const sentMessages: unknown = captured.body['messages'];
    assert.deepEqual(sentMessages, [
      { role: 'system', content: 'you are a teacher' },
      { role: 'user', content: 'hello' },
    ]);
    assert.equal(JSON.stringify(sentMessages), JSON.stringify(messages));
    for (const m of sentMessages as Array<Record<string, unknown>>) {
      assert.equal(typeof m['content'], 'string');
      assert.equal('images' in m, false);
    }
  });

  it('rejects an image in a system message before any call', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const captured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const client = createMetaClient({
      apiKey: 'test-key',
      ledger: fake.ledger,
      allowLive: true,
      fetchImpl: fakeChatFetch(captured),
    });
    await assert.rejects(
      client.complete({
        purpose: 'demo',
        schemaName: 's',
        jsonSchema: SCHEMA,
        messages: [
          {
            role: 'system',
            content: 'you are a teacher',
            images: [{ url: 'data:image/png;base64,AAA' }],
          },
        ],
        maxOutputTokens: 16,
      }),
      (err: unknown): boolean => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'IMAGE_IN_SYSTEM_MESSAGE');
        return true;
      },
    );
    assert.equal(captured.count, 0);
    assert.equal(fake.reserveCalls.length, 0);
  });

  it('rejects images on the Modal provider before any call', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const captured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const client = createMetaClient({
      apiKey: undefined,
      ledger: fake.ledger,
      allowLive: true,
      fetchImpl: fakeChatFetch(captured),
      providerConfig: {
        provider: 'modal',
        baseUrl: 'https://example.com',
        proxyKey: 'wk-testkey',
        proxySecret: 'ws-testsecret',
        modelString: MODAL_MUSE_SPARK_OPEN_MODEL,
      },
    });
    await assert.rejects(
      client.complete({
        purpose: 'demo',
        schemaName: 's',
        jsonSchema: SCHEMA,
        messages: imageUserMessage(),
        maxOutputTokens: 16,
      }),
      (err: unknown): boolean => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'IMAGES_NOT_SUPPORTED');
        return true;
      },
    );
    assert.equal(captured.count, 0);
    assert.equal(fake.reserveCalls.length, 0);
  });

  it('counts each image as 1600 tokens on top of the text bound', async (): Promise<void> => {
    const textBound: number = inputTokenBound([{ content: 'hello' }], SCHEMA);
    const withImage: ChatMessage[] = [
      {
        role: 'user',
        content: 'hello',
        images: [{ url: 'data:image/png;base64,AAA' }],
      },
    ];

    const overFake = makeFakeLedger();
    const overCaptured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const overClient = createMetaClient({
      apiKey: 'test-key',
      ledger: overFake.ledger,
      allowLive: true,
      maxInputTokens: textBound + 1599,
      fetchImpl: fakeChatFetch(overCaptured),
    });
    await assert.rejects(
      overClient.complete({
        purpose: 'demo',
        schemaName: 's',
        jsonSchema: SCHEMA,
        messages: withImage,
        maxOutputTokens: 4,
      }),
      (err: unknown): boolean => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'INPUT_TOO_LARGE');
        return true;
      },
    );
    assert.equal(overCaptured.count, 0);

    const exactFake = makeFakeLedger();
    const exactCaptured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const exactClient = createMetaClient({
      apiKey: 'test-key',
      ledger: exactFake.ledger,
      allowLive: true,
      maxInputTokens: textBound + 1600,
      fetchImpl: fakeChatFetch(exactCaptured),
    });
    const result = await exactClient.complete<{ ok: boolean }>({
      purpose: 'demo',
      schemaName: 's',
      jsonSchema: SCHEMA,
      messages: withImage,
      maxOutputTokens: 4,
    });
    assert.equal(result.data.ok, true);
    assert.equal(exactCaptured.count, 1);

    const twoImages: ChatMessage[] = [
      {
        role: 'user',
        content: 'hello',
        images: [{ url: 'data:image/png;base64,AAA' }, { url: 'data:image/png;base64,BBB' }],
      },
    ];
    const twoOverFake = makeFakeLedger();
    const twoOverCaptured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const twoOverClient = createMetaClient({
      apiKey: 'test-key',
      ledger: twoOverFake.ledger,
      allowLive: true,
      maxInputTokens: textBound + 3199,
      fetchImpl: fakeChatFetch(twoOverCaptured),
    });
    await assert.rejects(
      twoOverClient.complete({
        purpose: 'demo',
        schemaName: 's',
        jsonSchema: SCHEMA,
        messages: twoImages,
        maxOutputTokens: 4,
      }),
      (err: unknown): boolean => {
        assert.ok(err instanceof MetaError);
        assert.equal((err as MetaError).code, 'INPUT_TOO_LARGE');
        return true;
      },
    );
    assert.equal(twoOverCaptured.count, 0);

    const twoExactFake = makeFakeLedger();
    const twoExactCaptured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const twoExactClient = createMetaClient({
      apiKey: 'test-key',
      ledger: twoExactFake.ledger,
      allowLive: true,
      maxInputTokens: textBound + 3200,
      fetchImpl: fakeChatFetch(twoExactCaptured),
    });
    const twoResult = await twoExactClient.complete<{ ok: boolean }>({
      purpose: 'demo',
      schemaName: 's',
      jsonSchema: SCHEMA,
      messages: twoImages,
      maxOutputTokens: 4,
    });
    assert.equal(twoResult.data.ok, true);
    assert.equal(twoExactCaptured.count, 1);
    const sentTwo: unknown = (twoExactCaptured.body['messages'] as unknown[])[0];
    assert.deepEqual(sentTwo, {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,BBB' } },
      ],
    });
  });
});
