import { costFromUsage, inputTokenBound, isValidUsage, reservationUSD } from './pricing.ts';
import type { Ledger } from './ledger.ts';
import type { MetaReceipt, Usage } from '../contracts/index.ts';

export type MetaErrorCode =
  | 'LIVE_CALLS_DISABLED'
  | 'MODEL_API_KEY_MISSING'
  | 'BUDGET_EXCEEDED'
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
  | 'INPUT_TOO_LARGE';

export const META_ERROR_MESSAGES: Readonly<Record<MetaErrorCode, string>> = {
  LIVE_CALLS_DISABLED: 'live calls disabled',
  MODEL_API_KEY_MISSING: 'model API key missing',
  BUDGET_EXCEEDED: 'budget exceeded',
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
};

export class MetaError extends Error {
  code: MetaErrorCode;
  status?: number;
  receipt?: MetaReceipt;
  chargedUSD?: number;
  costBasis?: 'usage' | 'reservation';
  providerErrorType?: string;
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
      receipt?: MetaReceipt;
      chargedUSD?: number;
      costBasis?: 'usage' | 'reservation';
      providerErrorType?: string;
    },
  ) {
    super(META_ERROR_MESSAGES[code]);
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
      if (opts.costBasis !== undefined) {
        this.costBasis = opts.costBasis;
      }
      if (
        opts.providerErrorType !== undefined &&
        /^[a-z_]{1,40}$/.test(opts.providerErrorType)
      ) {
        this.providerErrorType = opts.providerErrorType;
      }
    }
  }
}

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
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
  complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }>;
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
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

function toUsage(raw: unknown): Usage | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== 'object') {
    return null;
  }
  const o = raw as Record<string, unknown>;
  const pt: unknown = o['prompt_tokens'];
  const ct: unknown = o['completion_tokens'];
  if (typeof pt !== 'number' || typeof ct !== 'number') {
    return null;
  }
  if (!Number.isFinite(pt) || !Number.isFinite(ct)) {
    return null;
  }
  if (!Number.isInteger(pt) || !Number.isInteger(ct)) {
    return null;
  }
  if (pt < 0 || ct < 0) {
    return null;
  }
  let cached = 0;
  let reasoning = 0;
  const promptDetails: unknown = o['prompt_tokens_details'];
  if (promptDetails !== undefined && promptDetails !== null) {
    if (typeof promptDetails !== 'object') {
      return null;
    }
    const c: unknown = (promptDetails as Record<string, unknown>)['cached_tokens'];
    if (c !== undefined) {
      if (typeof c !== 'number' || !Number.isFinite(c) || !Number.isInteger(c) || c < 0) {
        return null;
      }
      cached = c;
    }
  }
  const compDetails: unknown = o['completion_tokens_details'];
  if (compDetails !== undefined && compDetails !== null) {
    if (typeof compDetails !== 'object') {
      return null;
    }
    const r: unknown = (compDetails as Record<string, unknown>)['reasoning_tokens'];
    if (r !== undefined) {
      if (typeof r !== 'number' || !Number.isFinite(r) || !Number.isInteger(r) || r < 0) {
        return null;
      }
      reasoning = r;
    }
  }
  if (cached > pt) {
    return null;
  }
  if (reasoning > ct) {
    return null;
  }
  const usage: Usage = {
    promptTokens: pt,
    completionTokens: ct,
    reasoningTokens: reasoning,
    cachedTokens: cached,
  };
  if (!isValidUsage(usage)) {
    return null;
  }
  return usage;
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

export function createMetaClient(opts: MetaClientOptions): MetaClient {
  if (opts.allowLive !== true) {
    throw new MetaError('LIVE_CALLS_DISABLED', 'live calls disabled');
  }
  const apiKey: string | undefined = opts.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new MetaError('MODEL_API_KEY_MISSING', 'model API key missing');
  }
  const key: string = apiKey;
  const ledger: Ledger = opts.ledger;
  const model: 'muse-spark-1.3' = opts.model ?? 'muse-spark-1.3';
  const baseUrl: string = opts.baseUrl ?? 'https://api.meta.ai/v1';
  const timeoutMs: number = opts.timeoutMs ?? 120000;
  const retryDelayMs: number = opts.retryDelayMs ?? 1000;
  const maxInputTokens: number = opts.maxInputTokens ?? 16000;
  const fetchImpl: typeof fetch = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const sleep: (ms: number) => Promise<void> =
    opts.sleep ??
    ((ms: number): Promise<void> => {
      return new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
      });
    });
  const now: () => number = opts.now ?? Date.now;

  async function complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: MetaReceipt }> {
    const bound: number = inputTokenBound(req.messages, req.jsonSchema);
    if (bound > maxInputTokens) {
      throw new MetaError('INPUT_TOO_LARGE', undefined, { chargedUSD: 0, costBasis: 'usage' });
    }
    if (jobAborted(req.signal)) {
      throw new MetaError('DEADLINE_EXCEEDED', undefined, { chargedUSD: 0, costBasis: 'usage' });
    }
    const perAttemptReservation: number = reservationUSD(model, bound, req.maxOutputTokens);

    const start: number = now();
    const url: string = `${baseUrl}/chat/completions`;
    const body: Record<string, unknown> = {
      model,
      messages: req.messages,
      max_tokens: req.maxOutputTokens,
      reasoning_effort: 'high',
      stream: false,
      response_format: {
        type: 'json_schema',
        json_schema: { name: req.schemaName, schema: req.jsonSchema },
      },
    };
    const bodyJson: string = JSON.stringify(body);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    };

    let totalCharged = 0;
    let anyReservationBasis = false;

    function currentBasis(): 'usage' | 'reservation' {
      return anyReservationBasis ? 'reservation' : 'usage';
    }

    function fail(
      code: MetaErrorCode,
      extra?: { status?: number; receipt?: MetaReceipt; providerErrorType?: string },
    ): MetaError {
      return new MetaError(code, undefined, {
        status: extra?.status,
        receipt: extra?.receipt,
        chargedUSD: totalCharged,
        costBasis: currentBasis(),
        providerErrorType: extra?.providerErrorType,
      });
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (jobAborted(req.signal)) {
        throw fail('DEADLINE_EXCEEDED');
      }
      let reservationId: string;
      try {
        reservationId = ledger.reserve({ purpose: req.purpose, model, estUSD: perAttemptReservation });
      } catch {
        throw fail('BUDGET_EXCEEDED');
      }

      const reconcileThis = (
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
        ledger.reconcile(reservationId, actual);
        totalCharged += costUSD;
        if (basis === 'reservation') {
          anyReservationBasis = true;
        }
      };

      let res: Response;
      try {
        const timeoutSignal: AbortSignal = AbortSignal.timeout(timeoutMs);
        const signal: AbortSignal =
          req.signal !== undefined ? AbortSignal.any([timeoutSignal, req.signal]) : timeoutSignal;
        res = await fetchImpl(url, { method: 'POST', headers, body: bodyJson, signal });
      } catch (err: unknown) {
        reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
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
            reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
            throw fail('DEADLINE_EXCEEDED');
          }
          reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('SERVER_ERROR');
        }
        if (jobAborted(req.signal)) {
          reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('DEADLINE_EXCEEDED');
        }
        const data = raw as Record<string, unknown>;
        const returnedModel: string =
          typeof data['model'] === 'string' ? (data['model'] as string) : '';
        const responseId: string = typeof data['id'] === 'string' ? (data['id'] as string) : '';
        const choicesUnknown: unknown = data['choices'];
        const choices: Array<Record<string, unknown>> = (Array.isArray(choicesUnknown)
          ? choicesUnknown
          : []) as Array<Record<string, unknown>>;
        const first: Record<string, unknown> | undefined =
          choices.length > 0 ? choices[0] : undefined;
        const finishReason: string =
          first !== undefined && typeof first['finish_reason'] === 'string'
            ? (first['finish_reason'] as string)
            : 'unknown';
        let content = '';
        if (first !== undefined) {
          const msg: unknown = first['message'];
          if (typeof msg === 'object' && msg !== null) {
            const c: unknown = (msg as Record<string, unknown>)['content'];
            if (typeof c === 'string') {
              content = c;
            }
          }
        }
        const usage: Usage | null = toUsage(data['usage']);
        let attemptCost: number;
        let attemptNote = '';
        let attemptBasis: 'usage' | 'reservation';
        if (usage === null) {
          attemptCost = perAttemptReservation;
          attemptBasis = 'reservation';
          attemptNote = 'uncertain outcome';
        } else {
          attemptCost = costFromUsage(model, usage);
          attemptBasis = 'usage';
          attemptNote = 'usage';
        }
        reconcileThis(attemptCost, attemptBasis, attemptNote, responseId, usage);
        const end: number = now();
        const latencyMs: number = Math.max(0, Math.round(end - start));
        const receipt: MetaReceipt = {
          purpose: req.purpose,
          requestedModel: model,
          returnedModel,
          responseId,
          usage,
          latencyMs,
          estCostUSD: totalCharged,
          finishReason,
          attempts: attempt,
          costBasis: currentBasis(),
        };

        if (data['model'] !== model) {
          throw fail('RETURNED_MODEL_MISMATCH', { receipt });
        }
        if (finishReason !== 'stop') {
          throw fail('OUTPUT_TRUNCATED', { receipt });
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
          reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
          throw fail('DEADLINE_EXCEEDED');
        }
        providerErrorType = undefined;
      }
      if (jobAborted(req.signal)) {
        // Error-body read finished but the job deadline fired: retain liability.
        // If this attempt was not reconciled yet, reconcile it now.
        reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
        throw fail('DEADLINE_EXCEEDED');
      }
      const retryable: boolean =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (retryable && attempt < 2) {
        reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
        const delay: number = retryDelayMs * (1 + Math.random());
        await sleep(delay);
        continue;
      }
      if (status === 429) {
        reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
        throw fail('RATE_LIMITED', { status, providerErrorType });
      }
      if (status >= 500 && status <= 599) {
        reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
        throw fail('SERVER_ERROR', { status, providerErrorType });
      }
      if (status === 400) {
        reconcileThis(0, 'rejected', 'rejected');
        throw fail('BAD_REQUEST', { status, providerErrorType });
      }
      if (status === 401 || status === 403) {
        reconcileThis(0, 'rejected', 'rejected');
        throw fail('AUTH_FAILED', { status, providerErrorType });
      }
      if (status === 404) {
        reconcileThis(0, 'rejected', 'rejected');
        throw fail('MODEL_NOT_FOUND', { status, providerErrorType });
      }
      if (status >= 400 && status < 500) {
        reconcileThis(0, 'rejected', 'rejected');
        throw fail('HTTP_ERROR', { status, providerErrorType });
      }
      reconcileThis(perAttemptReservation, 'reservation', 'uncertain outcome');
      throw fail('HTTP_ERROR', { status, providerErrorType });
    }
    throw new MetaError('SERVER_ERROR', undefined, {
      chargedUSD: totalCharged,
      costBasis: currentBasis(),
    });
  }

  return { complete };
}
