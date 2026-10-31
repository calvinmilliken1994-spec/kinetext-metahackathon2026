import { MetaError } from './client.ts';
import type { MetaErrorCode } from './client.ts';
import type { Ledger } from './ledger.ts';

export const SAM_MODEL = 'sam-3.1';
export const SAM_BASE_URL = 'https://api.meta.ai/v1';
export const SAM_COST_USD_PER_IMAGE = 0.0025;
export const SAM_MAX_POINTS = 16;

export interface SamPoint {
  id: number;
  x: number;
  y: number;
}

export interface SamImage {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export interface SamBox {
  id: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  confidence: number | null;
}

export interface SegmentPointsOptions {
  apiKey: string | undefined;
  baseUrl?: string;
  fetch?: typeof fetch;
  ledger: Ledger;
  purpose: 'test-live' | 'demo';
  image: SamImage;
  points: SamPoint[];
  signal?: AbortSignal;
}

export interface SegmentPointsResult {
  boxes: SamBox[];
  raw: string;
  imagesProcessed: number;
  costUSD: number;
  latencyMs: number;
}

function clampPixel(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    return lo;
  }
  const rounded: number = Math.round(value);
  if (rounded < lo) {
    return lo;
  }
  if (rounded > hi) {
    return hi;
  }
  return rounded;
}

export function buildPointPrompt(points: ReadonlyArray<SamPoint>, width: number, height: number): string {
  if (points.length > SAM_MAX_POINTS) {
    throw new RangeError('SAM_TOO_MANY_POINTS');
  }
  const w: number = Math.floor(width);
  const h: number = Math.floor(height);
  const records: string[] = points.map((p: SamPoint): string => {
    const px: number = clampPixel(p.x, 0, w - 1);
    const py: number = clampPixel(p.y, 0, h - 1);
    return `${p.id}<|point;x=${px};y=${py};w=${w};h=${h}|>`;
  });
  return `<0f>${records.join(',')}`;
}

const BOX_TOKEN_RE =
  /^<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([0-9]+(?:\.[0-9]+)?))?\|>/;
const FRAME_MARKER_RE = /^<\d+f>/;
const OBJECT_ID_RE = /^[0-9]+/;
const MASK_TOKEN_RE =
  /^<\|mask;x=0;y=0(?:;c=([0-9]+(?:\.[0-9]+)?))?;data=\d+,\d+,[~!][\s\S]*\|>$/;

function parseConfidence(raw: string | undefined): number | null {
  if (raw === undefined) {
    return null;
  }
  const value: number = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

export function parseSamOutput(output: string): SamBox[] {
  const found: Map<number, SamBox> = new Map<number, SamBox>();
  if (output.length === 0) {
    return [];
  }
  let i = 0;
  const n: number = output.length;
  while (i < n) {
    const rest: string = output.slice(i, i + 24);
    const frame: RegExpExecArray | null = FRAME_MARKER_RE.exec(rest);
    if (frame !== null && output.startsWith(frame[0], i)) {
      i += frame[0].length;
      continue;
    }
    const ch: string = output[i] ?? '';
    if (ch === ',' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }
    const idMatch: RegExpExecArray | null = OBJECT_ID_RE.exec(output.slice(i, i + 16));
    if (idMatch === null) {
      i += 1;
      continue;
    }
    const id: number = Number.parseInt(idMatch[0], 10);
    let j: number = i + idMatch[0].length;
    const boxMatch: RegExpExecArray | null = BOX_TOKEN_RE.exec(output.slice(j, j + 256));
    if (boxMatch === null) {
      i = j;
      continue;
    }
    const x1: number = Number.parseInt(boxMatch[1] ?? '0', 10);
    const y1: number = Number.parseInt(boxMatch[2] ?? '0', 10);
    const x2: number = Number.parseInt(boxMatch[3] ?? '0', 10);
    const y2: number = Number.parseInt(boxMatch[4] ?? '0', 10);
    const boxConfidence: number | null = parseConfidence(boxMatch[7]);
    j += boxMatch[0].length;
    if (!output.startsWith('<|mask;', j)) {
      i = j;
      continue;
    }
    const end: number = output.indexOf('|>', j);
    if (end === -1) {
      break;
    }
    const maskToken: string = output.slice(j, end + 2);
    const maskMatch: RegExpExecArray | null = MASK_TOKEN_RE.exec(maskToken);
    if (maskMatch === null) {
      i = end + 2;
      continue;
    }
    const maskConfidence: number | null = parseConfidence(maskMatch[1]);
    const confidence: number | null = boxConfidence ?? maskConfidence;
    found.set(id, { id, x1, y1, x2, y2, confidence });
    i = end + 2;
  }
  return [...found.values()].sort((a: SamBox, b: SamBox): number => a.id - b.id);
}

function readImagesProcessed(evt: Record<string, unknown>): number | null {
  const candidates: unknown[] = [evt['usage']];
  const responseRaw: unknown = evt['response'];
  if (typeof responseRaw === 'object' && responseRaw !== null) {
    candidates.push((responseRaw as Record<string, unknown>)['usage']);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'object' && candidate !== null) {
      const value: unknown = (candidate as Record<string, unknown>)['images_processed'];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return Math.floor(value);
      }
    }
  }
  return null;
}

function parseSamStream(body: string): { output: string; imagesProcessed: number } {
  let output = '';
  let imagesProcessed = 1;
  for (const line of body.split('\n')) {
    const trimmed: string = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }
    const payload: string = trimmed.slice('data:'.length).trim();
    if (payload === '' || payload === '[DONE]') {
      continue;
    }
    let evt: unknown;
    try {
      evt = JSON.parse(payload) as unknown;
    } catch {
      continue;
    }
    if (typeof evt !== 'object' || evt === null) {
      continue;
    }
    const record = evt as Record<string, unknown>;
    if (record['type'] === 'response.output_text.delta' && typeof record['delta'] === 'string') {
      output += record['delta'] as string;
    } else if (record['type'] === 'response.completed') {
      const count: number | null = readImagesProcessed(record);
      if (count !== null) {
        imagesProcessed = count;
      }
    }
  }
  return { output, imagesProcessed };
}

export async function segmentPoints(opts: SegmentPointsOptions): Promise<SegmentPointsResult> {
  if (opts.points.length > SAM_MAX_POINTS) {
    throw new RangeError('SAM_TOO_MANY_POINTS');
  }
  if (typeof opts.apiKey !== 'string' || opts.apiKey.length === 0) {
    throw new MetaError('MODEL_API_KEY_MISSING', undefined, { provider: 'meta-api' });
  }
  let reservationId: string;
  try {
    reservationId = opts.ledger.reserve({
      purpose: opts.purpose,
      model: SAM_MODEL,
      estUSD: SAM_COST_USD_PER_IMAGE,
      provider: 'meta-api',
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'BUDGET_EXCEEDED') {
      throw new MetaError('BUDGET_EXCEEDED', undefined, { provider: 'meta-api' });
    }
    throw new MetaError('LEDGER_ERROR', undefined, { provider: 'meta-api' });
  }

  const reconcileOrThrow = (costUSD: number, note: string): void => {
    try {
      opts.ledger.reconcile(reservationId, { costUSD, note });
    } catch {
      throw new MetaError('LEDGER_ERROR', undefined, { provider: 'meta-api' });
    }
  };

  const prompt: string = buildPointPrompt(opts.points, opts.image.width, opts.image.height);
  const base: string = opts.baseUrl ?? SAM_BASE_URL;
  const url = `${base}/responses`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Content-Type': 'application/json',
  };
  const bodyJson: string = JSON.stringify({
    model: SAM_MODEL,
    stream: true,
    metadata: { include_confidence: 'true' },
    input_text: prompt,
    image: {
      data: Buffer.from(opts.image.bytes).toString('base64'),
      mime: opts.image.mime,
      width: opts.image.width,
      height: opts.image.height,
    },
  });
  const fetchImpl: typeof fetch = opts.fetch ?? (globalThis.fetch as typeof fetch);
  const start: number = Date.now();

  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: bodyJson, signal: opts.signal });
  } catch {
    reconcileOrThrow(SAM_COST_USD_PER_IMAGE, 'uncertain outcome');
    if (opts.signal !== undefined && opts.signal.aborted) {
      throw new MetaError('TIMEOUT', undefined, { provider: 'meta-api' });
    }
    throw new MetaError('NETWORK_ERROR', undefined, { provider: 'meta-api' });
  }

  if (!res.ok) {
    const status: number = res.status;
    if (status === 429 || (status >= 500 && status <= 599)) {
      reconcileOrThrow(SAM_COST_USD_PER_IMAGE, 'uncertain outcome');
    } else {
      reconcileOrThrow(0, 'rejected');
    }
    throw new MetaError(`SAM_HTTP_${status}` as MetaErrorCode, undefined, {
      status,
      provider: 'meta-api',
    });
  }

  let sseText: string;
  try {
    sseText = await res.text();
  } catch {
    reconcileOrThrow(SAM_COST_USD_PER_IMAGE, 'uncertain outcome');
    throw new MetaError('NETWORK_ERROR', undefined, { provider: 'meta-api' });
  }
  const parsed: { output: string; imagesProcessed: number } = parseSamStream(sseText);
  const boxes: SamBox[] = parseSamOutput(parsed.output);
  const costUSD: number = parsed.imagesProcessed * SAM_COST_USD_PER_IMAGE;
  reconcileOrThrow(costUSD, 'usage');
  const latencyMs: number = Math.max(0, Date.now() - start);
  return {
    boxes,
    raw: parsed.output,
    imagesProcessed: parsed.imagesProcessed,
    costUSD,
    latencyMs,
  };
}
