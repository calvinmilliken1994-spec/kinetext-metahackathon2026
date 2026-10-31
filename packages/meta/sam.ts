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

/** One request carries exactly one image: the upper bound of any honest usage report. */
export const SAM_IMAGES_PER_CALL = 1;

type UsageRead = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'count'; value: number };

/**
 * B-07: usage is trusted only as a non-negative SAFE INTEGER. Anything else that is present
 * (fractional, negative, text, null, a usage that is not an object, two usage objects that
 * disagree) is `invalid` and is NEVER floored to a number: the caller keeps the reservation
 * as uncertain. A completion without any images_processed is `absent` (the request bound,
 * one image, applies).
 */
function readUsage(evt: Record<string, unknown>): UsageRead {
  const candidates: unknown[] = [evt['usage']];
  const responseRaw: unknown = evt['response'];
  if (typeof responseRaw === 'object' && responseRaw !== null) {
    candidates.push((responseRaw as Record<string, unknown>)['usage']);
  }
  const counts: number[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      return { kind: 'invalid' };
    }
    const record = candidate as Record<string, unknown>;
    if (!('images_processed' in record)) {
      continue;
    }
    const value: unknown = record['images_processed'];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      return { kind: 'invalid' };
    }
    counts.push(value);
  }
  if (counts.length === 0) {
    return { kind: 'absent' };
  }
  const first: number = counts[0] as number;
  return counts.every((c: number): boolean => c === first) ? { kind: 'count', value: first } : { kind: 'invalid' };
}

const FAILURE_EVENT_RE = /(^|\.)(failed|error|incomplete|cancelled|canceled)$/;
const FAILED_STATUSES: ReadonlySet<string> = new Set<string>(['failed', 'incomplete', 'cancelled', 'canceled', 'error']);

interface ParsedSamStream {
  output: string;
  /** An explicit failed/error/incomplete event (or a completion that says it failed). */
  failed: boolean;
  /** A `response.completed` event was seen. */
  completed: boolean;
  usage: UsageRead;
}

function mergeUsage(a: UsageRead, b: UsageRead): UsageRead {
  if (a.kind === 'invalid' || b.kind === 'invalid') {
    return { kind: 'invalid' };
  }
  if (a.kind === 'absent') {
    return b;
  }
  if (b.kind === 'absent') {
    return a;
  }
  return a.value === b.value ? a : { kind: 'invalid' };
}

function completionSaysFailed(record: Record<string, unknown>): boolean {
  const response: unknown = record['response'];
  const holders: Record<string, unknown>[] = [record];
  if (typeof response === 'object' && response !== null) {
    holders.push(response as Record<string, unknown>);
  }
  for (const holder of holders) {
    const status: unknown = holder['status'];
    if (typeof status === 'string' && FAILED_STATUSES.has(status.toLowerCase())) {
      return true;
    }
    const error: unknown = holder['error'];
    if (error !== undefined && error !== null && error !== false) {
      return true;
    }
  }
  return false;
}

function parseSamStream(body: string): ParsedSamStream {
  const parsed: ParsedSamStream = { output: '', failed: false, completed: false, usage: { kind: 'absent' } };
  let eventName = '';
  for (const line of body.split('\n')) {
    const trimmed: string = line.trim();
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice('event:'.length).trim();
      if (FAILURE_EVENT_RE.test(eventName)) {
        parsed.failed = true;
      }
      continue;
    }
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
    const type: string = typeof record['type'] === 'string' ? (record['type'] as string) : eventName;
    if (FAILURE_EVENT_RE.test(type)) {
      parsed.failed = true;
    } else if (type === 'response.output_text.delta' && typeof record['delta'] === 'string') {
      parsed.output += record['delta'] as string;
    } else if (type === 'response.completed') {
      parsed.completed = true;
      if (completionSaysFailed(record)) {
        parsed.failed = true;
      }
      parsed.usage = mergeUsage(parsed.usage, readUsage(record));
    }
  }
  return parsed;
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
    Accept: 'text/event-stream',
  };
  const imageBase64: string = Buffer.from(opts.image.bytes).toString('base64');
  const dataUrl: string = `data:${opts.image.mime};base64,${imageBase64}`;
  const bodyJson: string = JSON.stringify({
    model: SAM_MODEL,
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl },
        ],
      },
    ],
    stream: true,
    metadata: { include_confidence: 'true' },
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
  // B-07: fail closed. Every branch below settles the reservation exactly once, and a stream
  // that did not provably complete with coherent usage keeps the reservation as UNCERTAIN
  // (charged AND unknown). Errors carry fixed codes only, never provider text.
  const uncertain = (code: MetaErrorCode): never => {
    reconcileOrThrow(SAM_COST_USD_PER_IMAGE, 'uncertain outcome');
    throw new MetaError(code, undefined, {
      provider: 'meta-api',
      chargedUSD: SAM_COST_USD_PER_IMAGE,
      reservedUnknownUSD: SAM_COST_USD_PER_IMAGE,
    });
  };
  let parsed: ParsedSamStream;
  let boxes: SamBox[];
  try {
    parsed = parseSamStream(sseText);
    boxes = parseSamOutput(parsed.output);
  } catch {
    return uncertain('SAM_STREAM_FAILED');
  }
  if (parsed.failed) {
    return uncertain('SAM_STREAM_FAILED');
  }
  if (!parsed.completed) {
    return uncertain('SAM_STREAM_INCOMPLETE');
  }
  if (parsed.usage.kind === 'invalid') {
    return uncertain('SAM_USAGE_INVALID');
  }
  const imagesProcessed: number = parsed.usage.kind === 'count' ? parsed.usage.value : SAM_IMAGES_PER_CALL;
  if (imagesProcessed > SAM_IMAGES_PER_CALL) {
    // The provider billed more images than were sent: never settle that as plain usage.
    // Record the ACTUAL charge (the ledger keeps the larger amount), flag it, fail the call.
    const actualUSD: number = imagesProcessed * SAM_COST_USD_PER_IMAGE;
    reconcileOrThrow(actualUSD, 'usage exceeded reservation');
    throw new MetaError('SAM_USAGE_EXCEEDED', undefined, {
      provider: 'meta-api',
      chargedUSD: actualUSD,
      reservedUnknownUSD: 0,
    });
  }
  if (imagesProcessed === 0 && boxes.length > 0) {
    // Boxes came back but the provider says nothing was processed: contradictory.
    return uncertain('SAM_USAGE_INVALID');
  }
  const costUSD: number = imagesProcessed * SAM_COST_USD_PER_IMAGE;
  reconcileOrThrow(costUSD, 'usage');
  const latencyMs: number = Math.max(0, Date.now() - start);
  return {
    boxes,
    raw: parsed.output,
    imagesProcessed,
    costUSD,
    latencyMs,
  };
}
