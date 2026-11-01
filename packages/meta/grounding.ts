// Stage 8c Addendum A (docs/specs/STAGE-8c-label-coverage-and-outlines.md): a dedicated Muse Spark grounding call
// boxes each label-diagram part far more cleanly than the area fields inside the long generation call
// (docs/evidence/muse-grounding-probe/). This module holds the pure pieces: Meta's documented "object grounding
// expert" box prompt, its strict JSON schema, the per-part union of the returned boxes, and the pixel boxes SAM and
// the stored region use. The worker (workers/generation/lesson.ts) makes the call through the job's own MetaClient.

/** Schema name the grounding call is made under (receipts and test fakes key on it). */
export const GROUNDING_SCHEMA_NAME = 'label_grounding';
/** Reasoning alone used ~4,000 tokens in the probe; a 4,000-token cap truncated with no result. */
export const GROUNDING_MAX_OUTPUT_TOKENS = 16000;
/** SAM's box prompt is the union grown by this fraction of its width/height on each side. */
export const GROUNDING_MARGIN_FRACTION = 0.04;
/** The normalised grid Muse answers on (x right, y down). */
const GRID = 1000;
/** A part name or printed label longer than this is cut (untrusted text inside the prompt). */
const PHRASE_MAX_CHARS = 80;

/** Strict output schema: {objects:[{object_name, bbox:[{x_min,y_min,x_max,y_max}]}]} on the 0..1000 grid. */
export const GROUNDING_SCHEMA: Record<string, unknown> = {
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
              properties: {
                x_min: { type: 'integer' },
                y_min: { type: 'integer' },
                x_max: { type: 'integer' },
                y_max: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
};

/** One part to locate: its name and the printed label its label box claims (null when it claims none). */
export interface GroundingObject {
  name: string;
  printed: string | null;
}

export interface GroundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Untrusted text (a model-written part name, a stored printed label) becomes one plain phrase: control characters
 * and runs of spaces collapse to one space, straight quotes and backticks become a typographic apostrophe (so the
 * text cannot close the quoted object phrase), and it is cut at 80 characters. Empty text becomes `fallback`.
 */
function phrase(text: string, fallback: string): string {
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, ' ')
    .replace(/["'`]/g, '\u2019')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PHRASE_MAX_CHARS)
    .trim();
  return cleaned === '' ? fallback : cleaned;
}

/**
 * Meta's documented object-grounding prompt for the given parts, in part order. Each object is
 * `"the drawn <name> that the printed label '<printed label>' points to"`, or `"the drawn <name>"` when the part
 * claims no printed label. Identical to the prompt of the live probe (docs/evidence/muse-grounding-probe/probe.ts).
 */
export function buildGroundingPrompt(objects: readonly GroundingObject[]): string {
  const listed = objects
    .map(o => {
      const name = phrase(o.name, 'part');
      return o.printed === null
        ? `"the drawn ${name}"`
        : `"the drawn ${name} that the printed label '${phrase(o.printed, name)}' points to"`;
    })
    .join(', ');
  return (
    'You are an object grounding expert. Provide the bounding box coordinates of the objects in the image: ' +
    `${listed}. Box the drawing itself, never the printed label text. When one object is drawn as several pieces ` +
    '(for example several arrows), give one box per piece. Ensure the objects accurately match the request and do not miss any objects. ' +
    'For each object, answer in the format {"object_name": "<name>", "bbox": [{"x_min": <int>, "y_min": <int>, "x_max": <int>, "y_max": <int>}]}. ' +
    'The coordinates should be in the 0-1000 range. Return a JSON object {"objects": [...]} with one entry per object. If you cannot find an object, omit it from the results.'
  );
}

/** The data URL of the figure exactly as the generation call attaches it. */
export function groundingImageUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}

function validBox(b: unknown): b is { x_min: number; y_min: number; x_max: number; y_max: number } {
  if (typeof b !== 'object' || b === null) return false;
  const o = b as Record<string, unknown>;
  const v = [o['x_min'], o['y_min'], o['x_max'], o['y_max']];
  if (!v.every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= GRID)) return false;
  return (v[0] as number) < (v[2] as number) && (v[1] as number) < (v[3] as number);
}

/**
 * Per part, by ORDER (entry i answers part i), the union of the part's valid boxes on the 0..1000 grid. A box is
 * valid when all four edges are integers inside 0..1000 with min < max; every other box is ignored. A part with no
 * valid box (missing entry, empty or malformed bbox) is null, and so is every part when `data` has no
 * `objects` array. Never throws. Entries beyond `count` are dropped.
 */
export function groundingUnions(data: unknown, count: number, names?: readonly string[]): (GroundingBox | null)[] {
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  const objects: unknown =
    typeof data === 'object' && data !== null ? (data as { objects?: unknown }).objects : undefined;
  const list: unknown[] = Array.isArray(objects) ? objects : [];
  const union = (entry: unknown): GroundingBox | null => {
    const bbox: unknown =
      typeof entry === 'object' && entry !== null ? (entry as { bbox?: unknown }).bbox : undefined;
    const boxes = Array.isArray(bbox) ? bbox.filter(validBox) : [];
    return boxes.length === 0
      ? null
      : {
          x1: Math.min(...boxes.map(b => b.x_min)),
          y1: Math.min(...boxes.map(b => b.y_min)),
          x2: Math.max(...boxes.map(b => b.x_max)),
          y2: Math.max(...boxes.map(b => b.y_max)),
        };
  };
  // Muse may omit an object it cannot find, so position alone can shift later parts onto the wrong boxes. With the
  // part names, each part takes the entry whose object_name names it; position is used only for a full list (one entry
  // per part) whose names match nothing, the shape the probe returned.
  const matched = names === undefined || names.length !== n ? null : matchByName(list, names);
  const out: (GroundingBox | null)[] = [];
  for (let i = 0; i < n; i++) {
    const at = matched === null ? i : matched[i];
    out.push(at === undefined || at === null ? null : union(list[at]));
  }
  return out;
}

/** Lowercase words of a name ("Sugar-phosphate backbone" → "sugar phosphate backbone"). */
function nameWords(s: unknown): string {
  return typeof s === 'string' ? s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
}

/** Entry index per part by object_name; null when no name matches at all and the list is not one entry per part. */
function matchByName(list: readonly unknown[], names: readonly string[]): (number | null)[] {
  const echoed = list.map(e => {
    const raw = nameWords(typeof e === 'object' && e !== null ? (e as { object_name?: unknown }).object_name : '');
    // The prompt phrase "the drawn <name> that the printed label '<label>' points to": keep <name>.
    const m = /^(?:the )?drawn (.+?)(?: that the printed label .*)?$/.exec(raw);
    return m !== null ? (m[1] as string) : raw;
  });
  const used = new Set<number>();
  const out: (number | null)[] = names.map(name => {
    const want = nameWords(name);
    const at = echoed.findIndex((e, j) => !used.has(j) && want !== '' && e === want);
    if (at >= 0) used.add(at);
    return at >= 0 ? at : null;
  });
  if (out.every(i => i === null)) {
    return list.length === names.length ? names.map((_, i) => i) : out;
  }
  return out;
}

/** 0..1000 grid value → image pixel (rounded, clamped into 0..size-1). */
function px(v: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.round((v * size) / GRID)));
}

function pixelBox(x1: number, y1: number, x2: number, y2: number, width: number, height: number): GroundingBox | null {
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  const box = { x1: px(x1, width), y1: px(y1, height), x2: px(x2, width), y2: px(y2, height) };
  return box.x2 > box.x1 && box.y2 > box.y1 ? box : null;
}

/** The union itself in image pixels (what a region stores as `ground`), or null when it collapses once rounded. */
export function groundingPixelBox(union: GroundingBox, width: number, height: number): GroundingBox | null {
  return pixelBox(union.x1, union.y1, union.x2, union.y2, width, height);
}

/**
 * SAM's box prompt for a part: the union grown by 4% of its width/height on each side, in image pixels (rounded,
 * clamped into the image, edges inclusive). Null when it is degenerate, so the caller falls back to the gen area.
 */
export function groundingPromptBox(union: GroundingBox, width: number, height: number): GroundingBox | null {
  const mx = (union.x2 - union.x1) * GROUNDING_MARGIN_FRACTION;
  const my = (union.y2 - union.y1) * GROUNDING_MARGIN_FRACTION;
  return pixelBox(union.x1 - mx, union.y1 - my, union.x2 + mx, union.y2 + my, width, height);
}
