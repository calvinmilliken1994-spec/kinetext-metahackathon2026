// Arrow-tip probe (2026-11-03, Calvin: "the models should be focusing on the tip of where the arrows are"). On the
// NASA Glenn airplane figure (insignia removed), Muse Spark 1.3 is asked for each part's box AND the point where its
// printed label's arrow ends. SAM 3.1 is then prompted two ways per rep: (A) Muse's box alone, as the app does today;
// (B) the box plus the arrow tip as a point. Question: does the tip stop SAM merging the touching tail parts?
// Live: Muse Spark 1.3 via packages/meta/client.ts and SAM 3.1 via packages/meta/sam.ts, one project ledger.
// Run: node docs/evidence/arrow-tip-probe/probe.ts  (MODEL_API_KEY in the child env only; never printed)
import { readFileSync, writeFileSync } from 'node:fs';
import { createMetaClient } from '../../../packages/meta/client.ts';
import { segmentObjects } from '../../../packages/meta/sam.ts';
import { openLedger } from '../../../packages/meta/ledger.ts';

const ROOT = new URL('../../../', import.meta.url);
const OUT = new URL('docs/evidence/arrow-tip-probe/', ROOT);
const FIG_DIR = new URL('data/figures/', ROOT);
const REPEATS = Number(process.env.PROBE_REPEATS ?? '1');


const FIGURES = [
  { id: 'nasa-grc-airplane-parts-1', file: 'nasa-grc-airplane-parts-1.jpg', mime: 'image/jpeg', width: 1168, height: 765, parts: [
    ['wing', 'Wing'], ['jet engine', 'Jet Engine'], ['fuselage', 'Fuselage (Body)'], ['cockpit', 'Cockpit'],
    ['vertical stabilizer', 'Vertical Stabilizer'], ['horizontal stabilizer', 'Horizontal Stabilizer'],
  ] },
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
        required: ['object_name', 'bbox', 'tip'],
        properties: {
          object_name: { type: 'string' },
          tip: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y'],
            properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          },
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
    'Each printed label has an arrow or leader line that ends on the object it names: follow that line from the label to its end, and give that end point as "tip", on the drawing. The object to box is the one under that tip. ' +
    'For each object, answer in the format {"object_name": "<name>", "bbox": [{"x_min": <int>, "y_min": <int>, "x_max": <int>, "y_max": <int>}], "tip": {"x": <int>, "y": <int>}}. ' +
    'The coordinates should be in the 0-1000 range. Return a JSON object {"objects": [...]} with one entry per object. If you cannot find an object, omit it from the results.'
  );
}


const KEY = 'MODEL_' + 'API_KEY';
const env = process.env;
const limits = JSON.parse(readFileSync(new URL('config/resource-limits.json', ROOT), 'utf8'));
const ledgerPath = new URL('storage/ledger.jsonl', ROOT).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ledger = await openLedger({ path: ledgerPath, capUSD: limits.stageCapsUSD.stage2, lockPort: limits.ledgerLockPort, providerCapsUSD: limits.providerCapsUSD });
const client = createMetaClient({ apiKey: env[KEY], ledger, allowLive: true });
const results: unknown[] = [];
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, '');
try {
  for (const fig of FIGURES) {
    const bytes = new Uint8Array(readFileSync(new URL(fig.file, FIG_DIR)));
    const url = `data:${fig.mime};base64,${Buffer.from(bytes).toString('base64')}`;
    const W = fig.width, H = fig.height;
    for (let rep = 1; rep <= REPEATS; rep++) {
      const prompt = groundingPrompt(fig.parts);
      const t0 = Date.now();
      const { data, receipt } = await client.complete<{ objects: { object_name: string; bbox: { x_min: number; y_min: number; x_max: number; y_max: number }[]; tip?: { x: number; y: number } }[] }>({
        purpose: 'test-live', schemaName: 'grounding', jsonSchema: SCHEMA,
        messages: [{ role: 'user', content: prompt, images: [{ url }] }], maxOutputTokens: 16000,
      });
      const museMs = Date.now() - t0;
      const px = (v: number, s: number) => Math.max(0, Math.min(s - 1, Math.round((v * s) / 1000)));
      const found = fig.parts.map(([name]) => data.objects.find((x) => norm(x.object_name).includes(norm(name))));
      const boxOf = (o: (typeof found)[number]) => {
        if (o === undefined || o.bbox.length === 0) return null;
        const x1 = Math.min(...o.bbox.map(b => b.x_min)), y1 = Math.min(...o.bbox.map(b => b.y_min));
        const x2 = Math.max(...o.bbox.map(b => b.x_max)), y2 = Math.max(...o.bbox.map(b => b.y_max));
        const mx = (x2 - x1) * 0.04, my = (y2 - y1) * 0.04;
        return { x1: px(x1 - mx, W), y1: px(y1 - my, H), x2: px(x2 + mx, W), y2: px(y2 + my, H) };
      };
      const tipOf = (o: (typeof found)[number]) => (o === undefined || o.tip === undefined ? null : { x: px(o.tip.x, W), y: px(o.tip.y, H) });
      const boxes = found.map(boxOf), tips = found.map(tipOf);
      // (A) box alone, ids 1..n; (B) box + tip point, ids 101..; a part Muse missed falls back to its tip, else the centre.
      const objects: { id: number; box?: { x1: number; y1: number; x2: number; y2: number }; points?: { x: number; y: number }[] }[] = [];
      fig.parts.forEach((_p, i) => {
        const box = boxes[i], tip = tips[i];
        objects.push(box !== null ? { id: i + 1, box } : { id: i + 1, points: [tip ?? { x: Math.round(W / 2), y: Math.round(H / 2) }] });
        if (tip !== null) objects.push(box !== null ? { id: 101 + i, box, points: [tip] } : { id: 101 + i, points: [tip] });
      });
      const sam = await segmentObjects({ apiKey: env[KEY] as string, ledger, purpose: 'test-live', image: { bytes, mime: fig.mime, width: W, height: H }, objects });
      const inside = (b: { x1: number; y1: number; x2: number; y2: number }, p: { x: number; y: number } | null) => p !== null && p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;
      const samRows = sam.boxes.map(b => {
        const i = b.id > 100 ? b.id - 101 : b.id - 1;
        return { id: b.id, variant: b.id > 100 ? 'box+tip' : 'box', name: fig.parts[i]?.[0], x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2, confidence: b.confidence, tipInside: inside(b, tips[i] ?? null) };
      });
      const row = { figure: fig.id, rep, muse: data, museMs, museReceipt: receipt, samObjects: objects, tips, boxes, sam: samRows, samCostUSD: sam.costUSD };
      results.push(row);
      writeFileSync(new URL(`raw-${fig.id}-${rep}.sam.txt`, OUT), sam.raw);
      console.log(fig.id, rep, `muse ${museMs} ms`, JSON.stringify(samRows.map(b => [b.variant, b.name, Number((b.confidence ?? 0).toFixed(2)), b.tipInside ? 'tip-in' : 'tip-OUT'])));
    }
  }
} finally {
  ledger.close();
  writeFileSync(new URL('result.json', OUT), JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
}
