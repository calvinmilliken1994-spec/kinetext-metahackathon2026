// Muse grounding probe (2026-11-02): can a DEDICATED Muse Spark grounding call (Meta's documented
// "object grounding expert" box prompt, uncluttered) box each diagram part more cleanly than the area box
// Muse writes inside the long label-diagram generation call? Then SAM 3.1 is prompted with Muse's box.
// Live: Muse Spark 1.3 via packages/meta/client.ts and SAM 3.1 via packages/meta/sam.ts, one project ledger.
// Run: node docs/evidence/muse-grounding-probe/probe.ts  (MODEL_API_KEY in the child env only; never printed)
import { readFileSync, writeFileSync } from 'node:fs';
import { createMetaClient } from '../../../packages/meta/client.ts';
import { segmentObjects } from '../../../packages/meta/sam.ts';
import { openLedger } from '../../../packages/meta/ledger.ts';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('docs/evidence/muse-grounding-probe/', ROOT);
const REPEATS = Number(process.env.PROBE_REPEATS ?? '2');

const FIGURES = [
  {
    id: 'noaa-hydrologic-cycle-1',
    parts: [
      ['Condensation', 'Condensation'],
      ['Precipitation', 'Precipitation'],
      ['Transpiration', 'Transpiration'],
      ['Evaporation', 'Evaporation'],
      ['Runoff', 'Surface Runoff'],
    ],
  },
  {
    id: 'medlineplus-dna-structure-1',
    parts: [
      ['base pairs', 'Base pairs'],
      ['adenine', 'Adenine'],
      ['thymine', 'Thymine'],
      ['guanine', 'Guanine'],
      ['cytosine', 'Cytosine'],
      ['sugar-phosphate backbone', 'Sugar phosphate backbone'],
    ],
  },
] as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objects'],
  properties: {
    objects: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['object_name', 'bbox'],
        properties: {
          object_name: { type: 'string' },
          bbox: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['x_min', 'y_min', 'x_max', 'y_max'],
              properties: { x_min: { type: 'integer' }, y_min: { type: 'integer' }, x_max: { type: 'integer' }, y_max: { type: 'integer' } },
            },
          },
        },
      },
    },
  },
};

function groundingPrompt(parts: ReadonlyArray<readonly [string, string]>): string {
  const objects = parts.map(([name, printed]) => `"the drawn ${name} that the printed label '${printed}' points to"`).join(', ');
  return (
    'You are an object grounding expert. Provide the bounding box coordinates of the objects in the image: ' +
    `${objects}. Box the drawing itself, never the printed label text. When one object is drawn as several pieces ` +
    '(for example several arrows), give one box per piece. Ensure the objects accurately match the request and do not miss any objects. ' +
    'For each object, answer in the format {"object_name": "<name>", "bbox": [{"x_min": <int>, "y_min": <int>, "x_max": <int>, "y_max": <int>}]}. ' +
    'The coordinates should be in the 0-1000 range. Return a JSON object {"objects": [...]} with one entry per object. If you cannot find an object, omit it from the results.'
  );
}

const env = process.env;
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const ledgerPath = new URL('storage/ledger.jsonl', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ledger = await openLedger({ path: ledgerPath, capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort, providerCapsUSD: limits.providerCapsUSD });
const client = createMetaClient({ apiKey: env['MODEL_API_KEY'], ledger, allowLive: true });
const results: unknown[] = [];
try {
  for (const fig of FIGURES) {
    const meta = JSON.parse(readFileSync(new URL(`data/figures/${fig.id}.json`, ROOT), 'utf8'));
    const bytes = new Uint8Array(readFileSync(new URL(`data/figures/${meta.file}`, ROOT)));
    const url = `data:${meta.mime};base64,${Buffer.from(bytes).toString('base64')}`;
    for (let rep = 1; rep <= REPEATS; rep++) {
      const prompt = groundingPrompt(fig.parts);
      const t0 = Date.now();
      const { data, receipt } = await client.complete<{ objects: { object_name: string; bbox: { x_min: number; y_min: number; x_max: number; y_max: number }[] }[] }>({
        purpose: 'test-live',
        schemaName: 'grounding',
        jsonSchema: SCHEMA,
        messages: [{ role: 'user', content: prompt, images: [{ url }] }],
        maxOutputTokens: 16000,
      });
      const museMs = Date.now() - t0;
      // SAM: one object per part, prompted with the union of Muse's boxes (pixels, 4% margin).
      const W = meta.width, H = meta.height;
      const objects = fig.parts.map((_, i) => {
        const o = data.objects[i];
        if (o === undefined || o.bbox.length === 0) return { id: i + 1, points: [{ x: Math.round(W / 2), y: Math.round(H / 2) }] };
        const x1 = Math.min(...o.bbox.map(b => b.x_min)), y1 = Math.min(...o.bbox.map(b => b.y_min));
        const x2 = Math.max(...o.bbox.map(b => b.x_max)), y2 = Math.max(...o.bbox.map(b => b.y_max));
        const mx = (x2 - x1) * 0.04, my = (y2 - y1) * 0.04;
        const px = (v: number, s: number) => Math.max(0, Math.min(s - 1, Math.round((v * s) / 1000)));
        return { id: i + 1, box: { x1: px(x1 - mx, W), y1: px(y1 - my, H), x2: px(x2 + mx, W), y2: px(y2 + my, H) } };
      });
      const sam = await segmentObjects({ apiKey: env['MODEL_API_KEY'] as string, ledger, purpose: 'test-live', image: { bytes, mime: meta.mime, width: W, height: H }, objects });
      const row = {
        figure: fig.id, rep, prompt, muse: data, museMs, museReceipt: receipt,
        samObjects: objects, sam: sam.boxes.map(b => ({ id: b.id, x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, confidence: b.confidence })), samCostUSD: sam.costUSD,
      };
      results.push(row);
      writeFileSync(new URL(`raw-${fig.id}-${rep}.sam.txt`, OUT), sam.raw);
      console.log(fig.id, rep, `muse ${museMs} ms`, JSON.stringify(row.sam.map(b => [b.id, Number((b.confidence ?? 0).toFixed(2))])));
    }
  }
} finally {
  ledger.close();
  writeFileSync(new URL('result.json', OUT), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
}
