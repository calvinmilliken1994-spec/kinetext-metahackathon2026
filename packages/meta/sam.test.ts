import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPointPrompt, parseSamOutput, segmentPoints } from './sam.ts';
import { MetaError } from './client.ts';
import type { Ledger } from './ledger.ts';

function makeFakeLedger(): {
  ledger: Ledger;
  reserveCalls: Array<Parameters<Ledger['reserve']>[0]>;
  reconcileCalls: Array<{ id: string; actual: Parameters<Ledger['reconcile']>[1] }>;
} {
  const reserveCalls: Array<Parameters<Ledger['reserve']>[0]> = [];
  const reconcileCalls: Array<{ id: string; actual: Parameters<Ledger['reconcile']>[1] }> = [];
  let n = 0;
  const ledger: Ledger = {
    capUSD: 10,
    reserve: (req: Parameters<Ledger['reserve']>[0]): string => {
      reserveCalls.push(req);
      n += 1;
      return `sam-res-${n}`;
    },
    reconcile: (id: string, actual: Parameters<Ledger['reconcile']>[1]): void => {
      reconcileCalls.push({ id, actual });
    },
    committedUSD: (): number => 0,
    close: (): void => {},
  };
  return { ledger, reserveCalls, reconcileCalls };
}

function sseBody(events: unknown[]): string {
  return events.map((e: unknown): string => `data: ${JSON.stringify(e)}`).join('\n') + '\n';
}

describe('buildPointPrompt', (): void => {
  it('builds SAM grammar for 2 points', (): void => {
    const prompt: string = buildPointPrompt(
      [
        { id: 1, x: 10, y: 20 },
        { id: 2, x: 590, y: 300 },
      ],
      600,
      600,
    );
    assert.equal(
      prompt,
      '<0f>1<|point;x=10;y=20;w=600;h=600|>,2<|point;x=590;y=300;w=600;h=600|>',
    );
  });

  it('clamps pixels into the image', (): void => {
    const prompt: string = buildPointPrompt([{ id: 1, x: -5, y: 9999 }], 100, 200);
    assert.equal(prompt, '<0f>1<|point;x=0;y=199;w=100;h=200|>');
  });

  it('rejects more than 16 points', (): void => {
    const points = Array.from({ length: 17 }, (_, i): { id: number; x: number; y: number } => ({
      id: i + 1,
      x: 1,
      y: 1,
    }));
    assert.throws((): void => {
      buildPointPrompt(points, 64, 64);
    }, (err: unknown): boolean => err instanceof RangeError && err.message === 'SAM_TOO_MANY_POINTS');
  });
});

describe('parseSamOutput', (): void => {
  it('parses a real-format line with tricky mask payloads', (): void => {
    const line =
      '<0f>1<|box;x1=10;y1=20;x2=30;y2=40;w=600;h=600;c=0.91|>' +
      '<|mask;x=0;y=0;c=0.91;data=27,60,~!!!!M!0c[0o9|>' +
      ',2<|box;x1=100;y1=120;x2=150;y2=170;w=600;h=600;c=0.5|>' +
      '<|mask;x=0;y=0;c=0.5;data=27,48,~abc!>~XYZ|>';
    const boxes = parseSamOutput(line);
    assert.equal(boxes.length, 2);
    assert.deepEqual(boxes[0], { id: 1, x1: 10, y1: 20, x2: 30, y2: 40, confidence: 0.91 });
    assert.deepEqual(boxes[1], { id: 2, x1: 100, y1: 120, x2: 150, y2: 170, confidence: 0.5 });
  });

  it('leaves a missing object absent', (): void => {
    const line =
      '<0f>1<|box;x1=1;y1=2;x2=3;y2=4;w=600;h=600|><|mask;x=0;y=0;data=2,2,~AA|>' +
      ',3<|box;x1=5;y1=6;x2=7;y2=8;w=600;h=600|><|mask;x=0;y=0;data=2,2,~BB|>';
    const boxes = parseSamOutput(line);
    assert.deepEqual(
      boxes.map((b): number => b.id),
      [1, 3],
    );
  });

  it('treats empty output as zero matches', (): void => {
    assert.deepEqual(parseSamOutput(''), []);
  });
});

describe('segmentPoints', (): void => {
  it('sends the SAM request, parses deltas, and reconciles usage cost', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const captured: { body: Record<string, unknown>; count: number } = { body: {}, count: 0 };
    const line =
      '<0f>1<|box;x1=10;y1=20;x2=30;y2=40;w=600;h=600;c=0.91|>' +
      '<|mask;x=0;y=0;c=0.91;data=27,60,~!!!!M!0c[0o9|>';
    const fetchImpl = (async (
      _url: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      captured.count += 1;
      captured.body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const body = sseBody([
        { type: 'response.output_text.delta', delta: line },
        { type: 'response.completed', usage: { images_processed: 2 } },
      ]);
      return { ok: true, status: 200, text: async (): Promise<string> => body } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await segmentPoints({
      apiKey: 'test-key',
      fetch: fetchImpl,
      ledger: fake.ledger,
      purpose: 'demo',
      image: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', width: 600, height: 600 },
      points: [
        { id: 1, x: 15, y: 25 },
        { id: 2, x: 590, y: 300 },
      ],
    });

    assert.equal(captured.count, 1);
    assert.equal(captured.body['model'], 'sam-3.1');
    assert.equal(captured.body['stream'], true);
    assert.deepEqual(captured.body['metadata'], { include_confidence: 'true' });
    assert.equal(
      captured.body['input_text'],
      '<0f>1<|point;x=15;y=25;w=600;h=600|>,2<|point;x=590;y=300;w=600;h=600|>',
    );
    assert.equal(result.imagesProcessed, 2);
    assert.equal(result.costUSD, 0.0025 * 2);
    assert.equal(result.boxes.length, 1);
    assert.equal(result.boxes[0]?.id, 1);
    assert.equal(fake.reserveCalls.length, 1);
    assert.equal(fake.reserveCalls[0]?.model, 'sam-3.1');
    assert.equal(fake.reserveCalls[0]?.estUSD, 0.0025);
    assert.equal(fake.reserveCalls[0]?.provider, 'meta-api');
    assert.equal(fake.reconcileCalls.length, 1);
    assert.equal(fake.reconcileCalls[0]?.actual.costUSD, 0.0025 * 2);
  });

  it('maps HTTP 400 to SAM_HTTP_400 without leaking the body', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const fetchImpl = (async (): Promise<Response> => {
      return {
        ok: false,
        status: 400,
        json: async (): Promise<unknown> => ({ error: { type: 'bad', message: 'SECRET-PROVIDER-TEXT' } }),
        text: async (): Promise<string> => 'SECRET-PROVIDER-TEXT',
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await assert.rejects(
      segmentPoints({
        apiKey: 'test-key',
        fetch: fetchImpl,
        ledger: fake.ledger,
        purpose: 'demo',
        image: { bytes: new Uint8Array([9]), mime: 'image/png', width: 64, height: 64 },
        points: [{ id: 1, x: 4, y: 4 }],
      }),
      (err: unknown): boolean => {
        if (!(err instanceof MetaError)) {
          return false;
        }
        assert.equal(err.code, 'SAM_HTTP_400');
        assert.ok(!err.message.includes('SECRET-PROVIDER-TEXT'));
        return true;
      },
    );
  });

  it('accepts zero matches with default usage', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const fetchImpl = (async (): Promise<Response> => {
      const body = sseBody([{ type: 'response.completed' }]);
      return { ok: true, status: 200, text: async (): Promise<string> => body } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await segmentPoints({
      apiKey: 'test-key',
      fetch: fetchImpl,
      ledger: fake.ledger,
      purpose: 'demo',
      image: { bytes: new Uint8Array([7]), mime: 'image/png', width: 64, height: 64 },
      points: [{ id: 1, x: 10, y: 10 }],
    });
    assert.deepEqual(result.boxes, []);
    assert.equal(result.raw, '');
    assert.equal(result.imagesProcessed, 1);
    assert.equal(result.costUSD, 0.0025 * 1);
  });
});
