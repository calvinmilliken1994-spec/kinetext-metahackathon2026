import { costFromUsage, inputTokenBound, isMetaProvider, isValidUsage, reservationUSD } from './pricing.ts';
import type { Ledger } from './ledger.ts';
import type { MetaReceipt, Usage } from '../contracts/index.ts';
import type { MetaProvider, ModelChoice } from './pricing.ts';

export type { MetaProvider, ModelChoice } from './pricing.ts';

export const MODAL_MUSE_SPARK_OPEN_MODEL: 'meta-models/Muse-Spark-Open-816B-A42B' =
  'meta-models/Muse-Spark-Open-816B-A42B';

export type ProviderConfig =
  | { provider: 'meta-api' }
  | {
      provider: 'modal';
      baseUrl: string;
      proxyKey: string | undefined;
      proxySecret: string | undefined;
      modelString: string;
    };

export type ClientReceipt = MetaReceipt & {
  provider?: MetaProvider;
  model?: ModelChoice;
  providerModel?: string;
  cachedUnknown?: boolean;
};

export type MetaErrorCode =
  | 'LIVE_CALLS_DISABLED'
  | 'MODEL_API_KEY_MISSING'
  | 'MODAL_PROXY_TOKEN_MISSING'
  | 'PROVIDER_CONFIG_INVALID'
  | 'BUDGET_EXCEEDED'
  | 'LEDGER_ERROR'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_REQUEST'
  | 'AUTH_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'HTTP_ERROR'
  | 'RETURNED_MODEL_MISMATCH'
  | 'OUTPUT_TRUNCATED'
  | 'OUTPUT_NOT_JSON'
  | 'EMPTY_OUTPUT'
  | 'DEADLINE_EXCEEDED'
  | 'INPUT_TOO_LARGE'
  | 'IMAGES_NOT_SUPPORTED' // retained for stored receipts; no provider raises it since Stage 8d
  | 'IMAGE_IN_SYSTEM_MESSAGE'
  | 'SAM_STREAM_FAILED'
  | 'SAM_STREAM_INCOMPLETE'
  | 'SAM_USAGE_INVALID'
  | 'SAM_USAGE_EXCEEDED'
  | `SAM_HTTP_${number}`;

const META_ERROR_BASE_MESSAGES = {
  LIVE_CALLS_DISABLED: 'live calls disabled',
  MODEL_API_KEY_MISSING: 'model API key missing',
  MODAL_PROXY_TOKEN_MISSING: 'modal proxy token missing',
  PROVIDER_CONFIG_INVALID: 'provider configuration invalid',
  BUDGET_EXCEEDED: 'budget exceeded',
  LEDGER_ERROR: 'spend ledger unavailable; operator recovery required',
  TIMEOUT: 'timeout',
  RATE_LIMITED: 'rate limited',
  SERVER_ERROR: 'server error',
  NETWORK_ERROR: 'network error',
  BAD_REQUEST: 'bad request',
  AUTH_FAILED: 'authentication failed',
  MODEL_NOT_FOUND: 'model not found',
  HTTP_ERROR: 'http error',
  RETURNED_MODEL_MISMATCH: 'returned model mismatch',
  OUTPUT_TRUNCATED: 'output truncated',
  OUTPUT_NOT_JSON: 'output not JSON',
  EMPTY_OUTPUT: 'empty output',
  DEADLINE_EXCEEDED: 'job deadline exceeded',
  INPUT_TOO_LARGE: 'input too large',
  IMAGES_NOT_SUPPORTED: 'images not supported',
  IMAGE_IN_SYSTEM_MESSAGE: 'image in system message',
  SAM_STREAM_FAILED: 'segmentation stream failed',
  SAM_STREAM_INCOMPLETE: 'segmentation stream incomplete',
  SAM_USAGE_INVALID: 'segmentation usage invalid',
  SAM_USAGE_EXCEEDED: 'segmentation usage exceeded the reservation',
} as const;

export const META_ERROR_MESSAGES: Readonly<Record<MetaErrorCode, string>> =
  META_ERROR_BASE_MESSAGES as unknown as Readonly<Record<MetaErrorCode, string>>;

export class MetaError extends Error {
  code: MetaErrorCode;
  status?: number;
  receipt?: ClientReceipt;
  chargedUSD?: number;
  reservedUnknownUSD?: number;
  costBasis?: 'usage' | 'reservation';
  providerErrorType?: string;
  provider?: MetaProvider;
  declare partialOutput?: string;
  /**
   * The second `message` argument is IGNORED for source compatibility only
   * (callers may pass the old message). `this.message` is always
   * `META_ERROR_MESSAGES[code]` so provider text can never enter the message.
   */
  constructor(
    code: MetaErrorCode,
    message?: string,
    opts?: {
      status?: number;
      receipt?: ClientReceipt;
      chargedUSD?: number;
      reservedUnknownUSD?: number;
      costBasis?: 'usage' | 'reservation';
      providerErrorType?: string;
      provider?: MetaProvider;
    },
  ) {
    super(META_ERROR_MESSAGES[code] ?? 'http error');
    void message;
    this.name = 'MetaError';
    this.code = code;
    if (opts !== undefined) {
      if (opts.status !== undefined) {
        this.status = opts.status;
      }
      if (opts.receipt !== undefined) {
        this.receipt = opts.receipt;
      }
      if (opts.chargedUSD !== undefined) {
        this.chargedUSD = opts.chargedUSD;
      }
      if (opts.reservedUnknownUSD !== undefined) {
        this.reservedUnknownUSD = opts.reservedUnknownUSD;
      }
      if (opts.costBasis !== undefined) {
        this.costBasis = opts.costBasis;
      }
      if (
        opts.providerErrorType !== undefined &&
        /^[a-z_]{1,40}$/.test(opts.providerErrorType)
      ) {
        this.providerErrorType = opts.providerErrorType;
      }
      if (opts.provider !== undefined && isMetaProvider(opts.provider)) {
        this.provider = opts.provider;
      }
    }
  }
}

export interface ChatImage {
  url: string;
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
  images?: ChatImage[];
}

export interface CompleteRequest {
  purpose: 'test-live' | 'demo';
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  messages: ChatMessage[];
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface MetaClient {
  complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: ClientReceipt }>;
  readonly provider?: MetaProvider;
  readonly model?: ModelChoice;
  readonly providerModel?: string;
}

export interface MetaClientOptions {
  apiKey: string | undefined;
  ledger: Ledger;
  allowLive: boolean;
  model?: 'muse-spark-1.3';
  baseUrl?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  maxInputTokens?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  providerConfig?: ProviderConfig;
}

export const IMAGE_PART_TOKEN_COUNT = 1600;

function countImages(messages: ReadonlyArray<ChatMessage>): number {
  let count = 0;
  for (const m of messages) {
    if (Array.isArray(m.images)) {
      count += m.images.length;
    }
  }
  return count;
}

function systemMessageHasImage(messages: ReadonlyArray<ChatMessage>): boolean {
  for (const m of messages) {
    if (m.role === 'system' && Array.isArray(m.images) && m.images.length > 0) {
      return true;
    }
  }
  return false;
}

type SerializedContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

function serializeMessages(
  messages: ReadonlyArray<ChatMessage>,
): Array<{ role: 'system' | 'user'; content: string | SerializedContentPart[] }> {
  return messages.map((m): { role: 'system' | 'user'; content: string | SerializedContentPart[] } => {
    if (Array.isArray(m.images) && m.images.length > 0) {
      const parts: SerializedContentPart[] = [{ type: 'text', text: m.content }];
      for (const img of m.images) {
        parts.push({ type: 'image_url', image_url: { url: img.url } });
      }
      return { role: m.role, content: parts };
    }
    return { role: m.role, content: m.content };
  });
}

function toUsage(raw: unknown): { usage: Usage | null; cachedUnknown: boolean } {
  if (raw === null || raw === undefined) {
    return { usage: null, cachedUnknown: true };
  }
  if (typeof raw !== 'object') {
    return { usage: null, cachedUnknown: true };
  }
  const o = raw as Record<string, unknown>;
  const pt: unknown = o['prompt_tokens'];
  const ct: unknown = o['completion_tokens'];
  if (typeof pt !== 'number' || typeof ct !== 'number') {
    return { usage: null, cachedUnknown: true };
  }
  if (!Number.isFinite(pt) || !Number.isFinite(ct)) {
    return { usage: null, cachedUnknown: true };
  }
  if (!Number.isInteger(pt) || !Number.isInteger(ct)) {
    return { usage: null, cachedUnknown: true };
  }
  if (pt < 0 || ct < 0) {
    return { usage: null, cachedUnknown: true };
  }
  let cached = 0;
  let cachedUnknown = true;
  const promptDetails: unknown = o['prompt_tokens_details'];
  if (promptDetails !== undefined && promptDetails !== null) {
    if (typeof promptDetails !== 'object') {
      return { usage: null, cachedUnknown: true };
    }
    const c: unknown = (promptDetails as Record<string, unknown>)['cached_tokens'];
    if (c !== undefined) {
      if (typeof c !== 'number' || !Number.isFinite(c) || !Number.isInteger(c) || c < 0) {
        return { usage: null, cachedUnknown: true };
      }
      cached = c;
      cachedUnknown = false;
    } else {
      cached = 0;
      cachedUnknown = true;
    }
  } else {
    cached = 0;
    cachedUnknown = true;
  }
  let nestedHas = false;
  let nestedVal = 0;
  let topHas = false;
  let topVal = 0;
  const compDetails: unknown = o['completion_tokens_details'];
  if (compDetails !== undefined && compDetails !== null) {
    if (typeof compDetails !== 'object') {
      return { usage: null, cachedUnknown: true };
    }
    const r: unknown = (compDetails as Record<string, unknown>)['reasoning_tokens'];
    if (r !== undefined) {
      if (typeof r !== 'number' || !Number.isFinite(r) || !Number.isInteger(r) || r < 0) {
        return { usage: null, cachedUnknown: true };
      }
      nestedHas = true;
      nestedVal = r;
    }
  }
  const topR: unknown = o['reasoning_tokens'];
  if (topR !== undefined) {
    if (typeof topR !== 'number' || !Number.isFinite(topR) || !Number.isInteger(topR) || topR < 0) {
      return { usage: null, cachedUnknown: true };
    }
    topHas = true;
    topVal = topR;
  }
  let reasoning = 0;
  if (nestedHas && topHas) {
    if (nestedVal !== topVal) {
      return { usage: null, cachedUnknown: true };
    }
    reasoning = nestedVal;
  } else if (nestedHas) {
    reasoning = nestedVal;
  } else if (topHas) {
    reasoning = topVal;
  } else {
    reasoning = 0;
  }
  if (cached > pt) {
    return { usage: null, cachedUnknown: true };
  }
  if (reasoning > ct) {
    return { usage: null, cachedUnknown: true };
  }
  const usage: Usage = {
    promptTokens: pt,
    completionTokens: ct,
    reasoningTokens: reasoning,
    cachedTokens: cached,
  };
  if (!isValidUsage(usage)) {
    return { usage: null, cachedUnknown: true };
  }
  return { usage, cachedUnknown };
}

function isTimeoutError(err: unknown): boolean {
  if (err instanceof DOMException) {
    return err.name === 'TimeoutError' || err.name === 'AbortError';
  }
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name: unknown = (err as { name: unknown }).name;
    return name === 'TimeoutError' || name === 'AbortError';
  }
  return false;
}

function extractTypeFromBody(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const e: unknown = (body as Record<string, unknown>)['error'];
  if (typeof e !== 'object' || e === null) {
    return undefined;
  }
  const t: unknown = (e as Record<string, unknown>)['type'];
  if (typeof t !== 'string') {
    return undefined;
  }
  if (!/^[a-z_]{1,40}$/.test(t)) {
    return undefined;
  }
  return t;
}

function jobAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve): void => {
    if (jobAborted(signal)) {
      resolve();
      return;
    }
    const timer = setTimeout((): void => {
      if (signal !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    if (signal !== undefined) {
      signal.addEventListener('abort', onAbort, { once: true });
      if (jobAborted(signal)) {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve();
      }
    }
  });
}

const PARTIAL_OUTPUT_MAX_CHARS = 200000;

function withPartialOutput(err: MetaError, content: string): MetaError {
  Object.defineProperty(err, 'partialOutput', {
    value: content.slice(0, PARTIAL_OUTPUT_MAX_CHARS),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return err;
}

export function createMetaClient(opts: MetaClientOptions): MetaClient {
  if (opts.allowLive !== true) {
    throw new MetaError('LIVE_CALLS_DISABLED', 'live calls disabled');
  }
  let effectiveProvider: MetaProvider;
  let effectiveModelChoice: ModelChoice;
  let effectiveProviderModel: string;
  let requestUrl: string;
  let headers: Record<string, string>;
  const pc: unknown = opts.providerConfig;
  if (pc === undefined) {
    const apiKey: string | undefined = opts.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new MetaError('MODEL_API_KEY_MISSING', 'model API key missing');
    }
    const key: string = apiKey;
    const base: string = opts.baseUrl ?? 'https://api.meta.ai/v1';
    effectiveProvider = 'meta-api';
    effectiveModelChoice = opts.model ?? 'muse-spark-1.3';
    effectiveProviderModel = effectiveModelChoice;
    requestUrl = `${base}/chat/completions`;
    headers = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };
  } else {
    if (!isPlainObject(pc)) {
      throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
    }
    const prov: unknown = (pc as Record<string, unknown>)['provider'];
    if (prov !== 'meta-api' && prov !== 'modal') {
      throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
    }
    if (prov === 'meta-api') {
      const apiKey: string | undefined = opts.apiKey;
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new MetaError('MODEL_API_KEY_MISSING', 'model API key missing');
      }
      const key: string = apiKey;
      const base: string = opts.baseUrl ?? 'https://api.meta.ai/v1';
      effectiveProvider = 'meta-api';
      effectiveModelChoice = opts.model ?? 'muse-spark-1.3';
      effectiveProviderModel = effectiveModelChoice;
      requestUrl = `${base}/chat/completions`;
      headers = {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      };
    } else {
      const rec = pc as Record<string, unknown>;
      const proxyKeyU: unknown = rec['proxyKey'];
      const proxySecretU: unknown = rec['proxySecret'];
      const baseUrlU: unknown = rec['baseUrl'];
      const modelStringU: unknown = rec['modelString'];
      if (
        typeof proxyKeyU !== 'string' ||
        proxyKeyU.length === 0 ||
        typeof proxySecretU !== 'string' ||
        proxySecretU.length === 0
      ) {
        throw new MetaError('MODAL_PROXY_TOKEN_MISSING', undefined);
      }
      const proxyKey: string = proxyKeyU;
      const proxySecret: string = proxySecretU;
      if (!proxyKey.startsWith('wk-') || !proxySecret.startsWith('ws-')) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      if (!/^[\x21-\x7e]+$/.test(proxyKey) || !/^[\x21-\x7e]+$/.test(proxySecret)) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      if (typeof baseUrlU !== 'string') {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      let parsed: URL;
      try {
        parsed = new URL(baseUrlU);
      } catch {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      if (
        parsed.protocol !== 'https:' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== ''
      ) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      const stripped: string = (baseUrlU as string).replace(/\/+$/, '');
      if (stripped.length === 0) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      if (modelStringU !== MODAL_MUSE_SPARK_OPEN_MODEL) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      if (opts.baseUrl !== undefined || opts.model !== undefined) {
        throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
      }
      effectiveProvider = 'modal';
      effectiveModelChoice = 'muse-spark-open';
      effectiveProviderModel = MODAL_MUSE_SPARK_OPEN_MODEL;
      requestUrl = `${stripped}/chat/completions`;
      headers = {
        'Modal-Key': proxyKey,
        'Modal-Secret': proxySecret,
        'Content-Type': 'application/json',
      };
    }
  }
  const ledger: Ledger = opts.ledger;
  const timeoutMs: number = opts.timeoutMs ?? 120000;
  const retryDelayMs: number = opts.retryDelayMs ?? 1000;
  const maxInputTokens: number = opts.maxInputTokens ?? 16000;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const sleep: (ms: number, signal?: AbortSignal) => Promise<void> = opts.sleep ?? defaultSleep;
  const now: () => number = opts.now ?? Date.now;

  async function sleepWithSignal(ms: number, signal: AbortSignal | undefined): Promise<void> {
    if (signal === undefined) {
      await sleep(ms, undefined);
      return;
    }
    if (jobAborted(signal)) {
      return;
    }
    let onAbort: () => void = (): void => {};
    const abortPromise = new Promise<void>((resolve): void => {
      onAbort = (): void => {
        resolve();
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([sleep(ms, signal), abortPromise]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  async function complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: ClientReceipt }> {
    let knownUSD = 0;
    let reservedUnknownUSD = 0;

    function chargedUSD(): number {
      return knownUSD + reservedUnknownUSD;
    }

    function currentBasis(): 'usage' | 'reservation' {
      return reservedUnknownUSD > 0 ? 'reservation' : 'usage';
    }

    function fail(
      code: MetaErrorCode,
      extra?: { status?: number; receipt?: ClientReceipt; providerErrorType?: string },
    ): MetaError {
      return new MetaError(code, undefined, {
        status: extra?.status,
        receipt: extra?.receipt,
        chargedUSD: chargedUSD(),
        reservedUnknownUSD,
        costBasis: currentBasis(),
        providerErrorType: extra?.providerErrorType,
        provider: effectiveProvider,
      });
    }

    if (systemMessageHasImage(req.messages)) {
      throw new MetaError('IMAGE_IN_SYSTEM_MESSAGE', undefined, {
        chargedUSD: 0,
        reservedUnknownUSD: 0,
        costBasis: 'usage',
        provider: effectiveProvider,
      });
    }
    // Stage 8d: Modal Muse Spark Open accepts image_url parts; see docs/evidence/open-weights-vision-probe/.
    const imageCount: number = countImages(req.messages);
    const bound: number =
      inputTokenBound(req.messages, req.jsonSchema) +
      imageCount * IMAGE_PART_TOKEN_COUNT;
    if (bound > maxInputTokens) {
      throw new MetaError('INPUT_TOO_LARGE', undefined, {
        chargedUSD: 0,
        reservedUnknownUSD: 0,
        costBasis: 'usage',
        provider: effectiveProvider,
      });
    }
    if (jobAborted(req.signal)) {
      throw new MetaError('DEADLINE_EXCEEDED', undefined, {
        chargedUSD: 0,
        reservedUnknownUSD: 0,
        costBasis: 'usage',
        provider: effectiveProvider,
      });
    }
    const perAttemptReservation: number = reservationUSD(
      effectiveModelChoice,
      bound,
      req.maxOutputTokens,
    );

    const start: number = now();
    const url: string = requestUrl;
    const body: Record<string, unknown> = {
      model: effectiveProviderModel,
      messages: serializeMessages(req.messages),
      max_tokens: req.maxOutputTokens,
      reasoning_effort: 'high',
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: req.jsonSchema },
      },
    };
    const bodyJson: string = JSON.stringify(body);

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (jobAborted(req.signal)) {
        throw fail('DEADLINE_EXCEEDED');
      }
      let reservationId: string;
      try {
        reservationId = ledger.reserve({
          purpose: req.purpose,
          model: effectiveProviderModel,
          estUSD: perAttemptReservation,
          provider: effectiveProvider,
        });
      } catch (reserveErr: unknown) {
        if (reserveErr instanceof Error && reserveErr.message === 'BUDGET_EXCEEDED') {
          throw fail('BUDGET_EXCEEDED');
        }
        throw fail('LEDGER_ERROR');
      }

      let attemptReconciled = false;

      const settle = (
        costUSD: number,
        basis: 'usage' | 'reservation' | 'rejected',
        note: string,
        responseId?: string,
        usageVal?: Usage | null,
      ): void => {
        const actual: { costUSD: number; responseId?: string; usage?: Usage | null; note?: string } = {
          costUSD,
          note,
        };
        if (responseId !== undefined && responseId !== '') {
          actual.responseId = responseId;
        }
        if (usageVal !== undefined) {
          actual.usage = usageVal;
        }
        try {
          ledger.reconcile(reservationId, actual);
        } catch {
          reservedUnknownUSD += perAttemptReservation;
          attemptReconciled = true;
          throw fail('LEDGER_ERROR');
        }
        attemptReconciled = true;
        if (basis === 'reservation') {
          reservedUnknownUSD += costUSD;
        } else {
          knownUSD += costUSD;
        }
      };

      try {
        let res: Response;
        try {
          const timeoutSignal: AbortSignal = AbortSignal.timeout(timeoutMs);
          const signal: AbortSignal =
            req.signal !== undefined ? AbortSignal.any([timeoutSignal, req.signal]) : timeoutSignal;
          res = await fetchImpl(url, { method: 'POST', headers, body: bodyJson, signal });
        } catch (err: unknown) {
          settle(perAttemptReservation, 'reservation', 'uncertain outcome');
          if (jobAborted(req.signal)) {
            throw fail('DEADLINE_EXCEEDED');
          }
          if (isTimeoutError(err)) {
            throw fail('TIMEOUT');
          }
          throw fail('NETWORK_ERROR');
        }

        if (res.ok) {
          let raw: unknown;
          try {
            raw = (await res.json()) as unknown;
          } catch {
            if (jobAborted(req.signal)) {
              settle(perAttemptReservation, 'reservation', 'uncertain outcome');
              throw fail('DEADLINE_EXCEEDED');
            }
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('SERVER_ERROR');
          }
          if (jobAborted(req.signal)) {
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('DEADLINE_EXCEEDED');
          }
          if (!isPlainObject(raw)) {
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('SERVER_ERROR');
          }
          const data: Record<string, unknown> = raw;
          const choicesUnknown: unknown = data['choices'];
          if (!Array.isArray(choicesUnknown)) {
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('SERVER_ERROR');
          }
          const firstRaw: unknown = (choicesUnknown as Array<unknown>)[0];
          if (!isPlainObject(firstRaw)) {
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('SERVER_ERROR');
          }
          const first: Record<string, unknown> = firstRaw;
          const returnedModel: string =
            typeof data['model'] === 'string' ? (data['model'] as string) : '';
          const responseId: string = typeof data['id'] === 'string' ? (data['id'] as string) : '';
          const finishReason: string =
            typeof first['finish_reason'] === 'string'
              ? (first['finish_reason'] as string)
              : 'unknown';
          let content = '';
          const msg: unknown = first['message'];
          if (typeof msg === 'object' && msg !== null) {
            const c: unknown = (msg as Record<string, unknown>)['content'];
            if (typeof c === 'string') {
              content = c;
            }
          }
          const parsedUsage = toUsage(data['usage']);
          const usage: Usage | null = parsedUsage.usage;
          const cachedUnknown: boolean = parsedUsage.cachedUnknown;
          let attemptCost: number;
          let attemptBasis: 'usage' | 'reservation';
          let attemptNote = '';
          if (usage === null) {
            attemptCost = perAttemptReservation;
            attemptBasis = 'reservation';
            attemptNote = 'uncertain outcome';
          } else {
            attemptCost = costFromUsage(effectiveModelChoice, usage);
            attemptBasis = 'usage';
            attemptNote = 'usage';
          }
          settle(attemptCost, attemptBasis, attemptNote, responseId, usage);
          const end: number = now();
          const latencyMs: number = Math.max(0, Math.round(end - start));
          const receipt: ClientReceipt = {
            purpose: req.purpose,
            requestedModel: effectiveProviderModel,
            returnedModel,
            responseId,
            usage,
            latencyMs,
            estCostUSD: chargedUSD(),
            reservedUnknownUSD,
            finishReason,
            attempts: attempt,
            costBasis: currentBasis(),
            provider: effectiveProvider,
            model: effectiveModelChoice,
            providerModel: effectiveProviderModel,
            cachedUnknown,
          };

          if (data['model'] !== effectiveProviderModel) {
            throw fail('RETURNED_MODEL_MISMATCH', { receipt });
          }
          if (finishReason !== 'stop') {
            throw withPartialOutput(fail('OUTPUT_TRUNCATED', { receipt }), content);
          }
          if (content.length === 0) {
            throw fail('EMPTY_OUTPUT', { receipt });
          }
          let parsedContent: unknown;
          try {
            parsedContent = JSON.parse(content) as unknown;
          } catch {
            throw fail('OUTPUT_NOT_JSON', { receipt });
          }
          return { data: parsedContent as T, receipt };
        }

        const status: number = res.status;
        let providerErrorType: string | undefined;
        try {
          const errBody: unknown = (await res.json()) as unknown;
          providerErrorType = extractTypeFromBody(errBody);
        } catch {
          if (jobAborted(req.signal)) {
            settle(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('DEADLINE_EXCEEDED');
          }
          providerErrorType = undefined;
        }
        if (jobAborted(req.signal)) {
          settle(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('DEADLINE_EXCEEDED');
        }
        const retryable: boolean =
          status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
        if (retryable && attempt < 2) {
          settle(perAttemptReservation, 'reservation', 'uncertain outcome');
          const delay: number = retryDelayMs * (1 + Math.random());
          try {
            await sleepWithSignal(delay, req.signal);
          } catch {
            if (jobAborted(req.signal)) {
              throw fail('DEADLINE_EXCEEDED');
            }
            throw fail('SERVER_ERROR');
          }
          if (jobAborted(req.signal)) {
            throw fail('DEADLINE_EXCEEDED');
          }
          continue;
        }
        if (status === 429) {
          settle(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('RATE_LIMITED', { status, providerErrorType });
        }
        if (status >= 500 && status <= 599) {
          settle(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('SERVER_ERROR', { status, providerErrorType });
        }
        if (status === 400) {
          settle(0, 'rejected', 'rejected');
          throw fail('BAD_REQUEST', { status, providerErrorType });
        }
        if (status === 401 || status === 403) {
          settle(0, 'rejected', 'rejected');
          throw fail('AUTH_FAILED', { status, providerErrorType });
        }
        if (status === 404) {
          settle(0, 'rejected', 'rejected');
          throw fail('MODEL_NOT_FOUND', { status, providerErrorType });
        }
        if (status >= 400 && status < 500) {
          settle(0, 'rejected', 'rejected');
          throw fail('HTTP_ERROR', { status, providerErrorType });
        }
        settle(perAttemptReservation, 'reservation', 'uncertain outcome');
        throw fail('HTTP_ERROR', { status, providerErrorType });
      } catch (err: unknown) {
        if (err instanceof MetaError) {
          throw err;
        }
        if (!attemptReconciled) {
          try {
            ledger.reconcile(reservationId, {
              costUSD: perAttemptReservation,
              note: 'uncertain outcome',
            });
            reservedUnknownUSD += perAttemptReservation;
            attemptReconciled = true;
          } catch {
            reservedUnknownUSD += perAttemptReservation;
            attemptReconciled = true;
            throw fail('LEDGER_ERROR');
          }
        }
        throw fail('SERVER_ERROR');
      }
    }
    throw new MetaError('SERVER_ERROR', undefined, {
      chargedUSD: chargedUSD(),
      reservedUnknownUSD,
      costBasis: currentBasis(),
      provider: effectiveProvider,
    });
  }

  return {
    complete,
    provider: effectiveProvider,
    model: effectiveModelChoice,
    providerModel: effectiveProviderModel,
  };
}
