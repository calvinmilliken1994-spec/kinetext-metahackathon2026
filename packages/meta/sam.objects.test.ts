// Stage 8c slice S: box prompts, several objects per call, mask tokens. Fake fetch only; the documented request
// body is asserted exactly (a top-level input_text/image is NOT the API). Real stored SAM output feeds the parser tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildObjectsPrompt, parseSamOutput, segmentObjects, segmentPoints } from './sam.ts';
import type { SegmentPointsResult } from './sam.ts';
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

const EVIDENCE = new URL('../../docs/evidence/', import.meta.url);
const RAW_WIDE: string = readFileSync(new URL('sam-prompt-probe/raw-wideBox.txt', EVIDENCE), 'utf8');

describe('buildObjectsPrompt (documented grammar, strings verified live on sam-3.1)', (): void => {
  it('box: <0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|>', (): void => {
    assert.equal(
      buildObjectsPrompt([{ id: 1, box: { x1: 135, y1: 306, x2: 200, y2: 429 } }], 572, 504),
      '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|>',
    );
  });

  it('point: <0f>1<|point;x=166;y=375;w=572;h=504|>', (): void => {
    assert.equal(
      buildObjectsPrompt([{ id: 1, points: [{ x: 166, y: 375 }] }], 572, 504),
      '<0f>1<|point;x=166;y=375;w=572;h=504|>',
    );
  });

  it('several prompts of one object are concatenated after its id, box first', (): void => {
    assert.equal(
      buildObjectsPrompt([{ id: 1, box: { x1: 135, y1: 306, x2: 200, y2: 429 }, points: [{ x: 166, y: 375 }] }], 572, 504),
      '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|><|point;x=166;y=375;w=572;h=504|>',
    );
    assert.equal(
      buildObjectsPrompt(
        [{ id: 1, points: [{ x: 154, y: 375 }, { x: 166, y: 375 }, { x: 180, y: 375 }, { x: 192, y: 375 }] }],
        572,
        504,
      ),
      '<0f>1<|point;x=154;y=375;w=572;h=504|><|point;x=166;y=375;w=572;h=504|><|point;x=180;y=375;w=572;h=504|><|point;x=192;y=375;w=572;h=504|>',
    );
  });

  it('objects are joined by "," in input order; box and point objects can mix', (): void => {
    assert.equal(
      buildObjectsPrompt(
        [
          { id: 1, box: { x1: 135, y1: 306, x2: 200, y2: 429 } },
          { id: 2, points: [{ x: 10, y: 20 }] },
          { id: 3, box: { x1: 0, y1: 0, x2: 571, y2: 503 } },
        ],
        572,
        504,
      ),
      '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|>,2<|point;x=10;y=20;w=572;h=504|>,3<|box;x1=0;y1=0;x2=571;y2=503;w=572;h=504|>',
    );
  });

  it('clamps box edges into the image and keeps x2 >= x1', (): void => {
    assert.equal(
      buildObjectsPrompt([{ id: 1, box: { x1: -4, y1: 10.4, x2: 9999, y2: 3 } }], 100, 80),
      '<0f>1<|box;x1=0;y1=10;x2=99;y2=10;w=100;h=80|>',
    );
  });

  it('throws a fixed-code RangeError for unusable prompts', (): void => {
    const fail = (objects: Parameters<typeof buildObjectsPrompt>[0], code: string): void => {
      assert.throws(
        (): void => {
          buildObjectsPrompt(objects, 64, 64);
        },
        (err: unknown): boolean => err instanceof RangeError && err.message === code,
        code,
      );
    };
    fail([], 'SAM_NO_OBJECTS');
    fail(
      Array.from({ length: 17 }, (_, i) => ({ id: i + 1, points: [{ x: 1, y: 1 }] })),
      'SAM_TOO_MANY_OBJECTS',
    );
    fail([{ id: 1 }], 'SAM_PROMPT_INVALID_EMPTY_PROMPT');
    fail([{ id: 1, points: [{ x: 1, y: 1 }] }, { id: 1, points: [{ x: 2, y: 2 }] }], 'SAM_PROMPT_INVALID_DUPLICATE_OBJECT_ID');
    fail([{ id: -1, points: [{ x: 1, y: 1 }] }], 'SAM_PROMPT_INVALID_INVALID_OBJECT_ID');
  });
});

describe('parseSamOutput mask tokens, real stored SAM output', (): void => {
  it('wideBox: one record whose mask is H=117 rows by W=62 columns (box 136..197 x 310..426)', (): void => {
    const boxes = parseSamOutput(RAW_WIDE);
    assert.equal(boxes.length, 1);
    const b = boxes[0];
    assert.ok(b !== undefined && b.mask !== undefined);
    assert.equal(b.id, 1);
    assert.equal(b.confidence, 0.73828125);
    assert.equal(b.mask.encoding, 'lossless');
    assert.equal(b.mask.height, 117);
    assert.equal(b.mask.width, 62);
    assert.equal(b.mask.height, b.y2 - b.y1 + 1);
    assert.equal(b.mask.width, b.x2 - b.x1 + 1);
    assert.ok(b.mask.payload.startsWith('~'));
  });

  it('mask-probe: five records, each with a box-sized mask', (): void => {
    const raw: string = readFileSync(new URL('sam-mask-probe/raw-output.txt', EVIDENCE), 'utf8');
    const boxes = parseSamOutput(raw);
    assert.deepEqual(boxes.map((b) => b.id), [1, 2, 3, 4, 5]);
    for (const b of boxes) {
      assert.ok(b.mask !== undefined, `mask of ${b.id}`);
      assert.equal(b.mask.width, b.x2 - b.x1 + 1);
      assert.equal(b.mask.height, b.y2 - b.y1 + 1);
    }
  });

  it('a one_bit marker gives encoding one_bit and an unreadable size drops only the mask', (): void => {
    const line =
      '<0f>1<|box;x1=1;y1=2;x2=3;y2=4;w=600;h=600|><|mask;x=0;y=0;data=3,3,!abcd|>' +
      ',2<|box;x1=5;y1=6;x2=7;y2=8;w=600;h=600|><|mask;x=0;y=0;data=0,3,~abcd|>';
    const boxes = parseSamOutput(line);
    assert.deepEqual(boxes[0]?.mask, { encoding: 'one_bit', payload: '!abcd', width: 3, height: 3 });
    assert.equal(boxes[1]?.id, 2);
    assert.equal(boxes[1]?.mask, undefined);
  });
});

describe('segmentObjects', (): void => {
  function okFetch(seen: { body: Record<string, unknown>; count: number }, events: unknown[]): typeof fetch {
    return (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
      seen.count += 1;
      seen.body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const body = sseBody(events);
      return { ok: true, status: 200, text: async (): Promise<string> => body } as unknown as Response;
    }) as unknown as typeof fetch;
  }
  const newSeen = (): { body: Record<string, unknown>; count: number } => ({ body: {}, count: 0 });

  it('sends the documented body for box + point objects and returns the mask', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const seen = newSeen();
    const result = await segmentObjects({
      apiKey: 'k',
      fetch: okFetch(seen, [
        { type: 'response.output_text.delta', delta: RAW_WIDE },
        { type: 'response.completed', usage: { images_processed: 1 } },
      ]),
      ledger: fake.ledger,
      purpose: 'demo',
      image: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg', width: 572, height: 504 },
      objects: [
        { id: 1, box: { x1: 135, y1: 306, x2: 200, y2: 429 } },
        { id: 2, points: [{ x: 166, y: 375 }] },
      ],
    });
    assert.equal(seen.count, 1);
    assert.equal(seen.body['model'], 'sam-3.1');
    assert.equal(seen.body['stream'], true);
    assert.deepEqual(seen.body['metadata'], { include_confidence: 'true' });
    assert.ok(!('input_text' in seen.body));
    assert.ok(!('image' in seen.body));
    assert.ok(!('include_confidence' in seen.body));
    const input = seen.body['input'] as Array<Record<string, unknown>>;
    assert.equal(input.length, 1);
    assert.equal(input[0]?.['type'], 'message');
    assert.equal(input[0]?.['role'], 'user');
    const content = input[0]?.['content'] as Array<Record<string, unknown>>;
    assert.equal(content.length, 2);
    assert.equal(content[0]?.['type'], 'input_text');
    assert.equal(
      content[0]?.['text'],
      '<0f>1<|box;x1=135;y1=306;x2=200;y2=429;w=572;h=504|>,2<|point;x=166;y=375;w=572;h=504|>',
    );
    assert.equal(content[1]?.['type'], 'input_image');
    assert.equal(content[1]?.['image_url'], 'data:image/jpeg;base64,AQID');
    assert.equal(result.boxes.length, 1);
    assert.equal(result.boxes[0]?.mask?.height, 117);
    assert.equal(result.boxes[0]?.mask?.width, 62);
    assert.equal(result.costUSD, 0.0025);
    assert.equal(fake.reserveCalls.length, 1);
    assert.equal(fake.reserveCalls[0]?.estUSD, 0.0025);
    assert.equal(fake.reserveCalls[0]?.provider, 'meta-api');
    assert.equal(fake.reconcileCalls.length, 1);
    assert.equal(fake.reconcileCalls[0]?.actual.costUSD, 0.0025);
    assert.equal(fake.reconcileCalls[0]?.actual.note, 'usage');
  });

  it('segmentPoints keeps its exact request (one point object per point, clamped) through the shared path', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const seen = newSeen();
    await segmentPoints({
      apiKey: 'k',
      fetch: okFetch(seen, [{ type: 'response.completed' }]),
      ledger: fake.ledger,
      purpose: 'demo',
      image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 572, height: 504 },
      points: [
        { id: 1, x: 166, y: 375 },
        { id: 2, x: 600, y: -3 },
      ],
    });
    const message = (seen.body['input'] as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const content = message['content'] as Array<Record<string, unknown>>;
    assert.equal(content[0]?.['text'], '<0f>1<|point;x=166;y=375;w=572;h=504|>,2<|point;x=571;y=0;w=572;h=504|>');
  });

  it('an unusable prompt throws before anything is reserved or sent', async (): Promise<void> => {
    const fake = makeFakeLedger();
    const seen = newSeen();
    await assert.rejects(
      segmentObjects({
        apiKey: 'k',
        fetch: okFetch(seen, []),
        ledger: fake.ledger,
        purpose: 'demo',
        image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 64, height: 64 },
        objects: [{ id: 1 }],
      }),
      (err: unknown): boolean => err instanceof RangeError,
    );
    assert.equal(fake.reserveCalls.length, 0);
    assert.equal(seen.count, 0);
  });

  it('a missing key fails before reserving, with the fixed code', async (): Promise<void> => {
    const fake = makeFakeLedger();
    await assert.rejects(
      segmentObjects({
        apiKey: undefined,
        ledger: fake.ledger,
        purpose: 'demo',
        image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 64, height: 64 },
        objects: [{ id: 1, points: [{ x: 1, y: 1 }] }],
      }),
      (err: unknown): boolean => err instanceof MetaError && err.code === 'MODEL_API_KEY_MISSING',
    );
    assert.equal(fake.reserveCalls.length, 0);
  });

  it('fail-closed billing holds for box prompts: a failed stream stays charged + unknown, usage 2 is SAM_USAGE_EXCEEDED', async (): Promise<void> => {
    const seen = newSeen();
    const call = (fake: ReturnType<typeof makeFakeLedger>, events: unknown[]): Promise<SegmentPointsResult> =>
      segmentObjects({
        apiKey: 'k',
        fetch: okFetch(seen, events),
        ledger: fake.ledger,
        purpose: 'demo',
        image: { bytes: new Uint8Array([1]), mime: 'image/png', width: 600, height: 600 },
        objects: [{ id: 1, box: { x1: 10, y1: 20, x2: 30, y2: 40 } }],
      });
    const failed = makeFakeLedger();
    await assert.rejects(
      call(failed, [{ type: 'response.output_text.delta', delta: RAW_WIDE }, { type: 'response.failed' }]),
      (err: unknown): boolean =>
        err instanceof MetaError && err.code === 'SAM_STREAM_FAILED' && err.chargedUSD === 0.0025 && err.reservedUnknownUSD === 0.0025,
    );
    assert.equal(failed.reconcileCalls.length, 1);
    assert.equal(failed.reconcileCalls[0]?.actual.note, 'uncertain outcome');
    const over = makeFakeLedger();
    await assert.rejects(
      call(over, [
        { type: 'response.output_text.delta', delta: RAW_WIDE },
        { type: 'response.completed', usage: { images_processed: 2 } },
      ]),
      (err: unknown): boolean => err instanceof MetaError && err.code === 'SAM_USAGE_EXCEEDED' && err.chargedUSD === 0.005,
    );
    assert.equal(over.reconcileCalls[0]?.actual.costUSD, 0.005);
  });
});
