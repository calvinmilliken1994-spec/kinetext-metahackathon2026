import { costFromUsage, reservationUSD } from './pricing.ts';
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
  | 'EMPTY_OUTPUT';

export class MetaError extends Error {
  code: MetaErrorCode;
  status?: number;
  receipt?: MetaReceipt;
  constructor(code: MetaErrorCode, message: string, opts?: { status?: number; receipt?: MetaReceipt }) {
    super(message);
    this.name = 'MetaError';
    this.code = code;
    if (opts !== undefined) {
      if (opts.status !== undefined) {
        this.status = opts.status;
      }
      if (opts.receipt !== undefined) {
        this.receipt = opts.receipt;
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
  const promptTokens: number = typeof o['prompt_tokens'] === 'number' ? o['prompt_tokens'] : 0;
  const completionTokens: number = typeof o['completion_tokens'] === 'number' ? o['completion_tokens'] : 0;
  let reasoningTokens = 0;
  let cachedTokens = 0;
  const compDetails: unknown = o['completion_tokens_details'];
  if (typeof compDetails === 'object' && compDetails !== null) {
    const cd = compDetails as Record<string, unknown>;
    if (typeof cd['reasoning_tokens'] === 'number') {
      reasoningTokens = cd['reasoning_tokens'];
    }
  }
  const promptDetails: unknown = o['prompt_tokens_details'];
  if (typeof promptDetails === 'object' && promptDetails !== null) {
    const pd = promptDetails as Record<string, unknown>;
    if (typeof pd['cached_tokens'] === 'number') {
      cachedTokens = pd['cached_tokens'];
    }
  }
  return { promptTokens, completionTokens, reasoningTokens, cachedTokens };
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
    let messageChars = 0;
    for (const m of req.messages) {
      messageChars += m.content.length;
    }
    const schemaLen: number = JSON.stringify(req.jsonSchema).length;
    const reservation: number = reservationUSD(model, messageChars + schemaLen, req.maxOutputTokens);
    let reservationId: string;
    try {
      reservationId = ledger.reserve({ purpose: req.purpose, model, estUSD: reservation });
    } catch {
      throw new MetaError('BUDGET_EXCEEDED', 'budget exceeded');
    }

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

    for (let attempt = 1; attempt <= 2; attempt++) {
      let res: Response;
      try {
        const signal: AbortSignal = AbortSignal.timeout(timeoutMs);
        res = await fetchImpl(url, { method: 'POST', headers, body: bodyJson, signal });
      } catch (err: unknown) {
        ledger.reconcile(reservationId, { costUSD: reservation });
        if (isTimeoutError(err)) {
          throw new MetaError('TIMEOUT', 'timeout');
        }
        throw new MetaError('NETWORK_ERROR', 'network error');
      }

      if (res.ok) {
        let raw: unknown;
        try {
          const parsed: unknown = await res.json();
          raw = parsed;
        } catch {
          ledger.reconcile(reservationId, { costUSD: reservation });
          throw new MetaError('SERVER_ERROR', 'server error');
        }
        const data = raw as Record<string, unknown>;
        const returnedModel: string = typeof data['model'] === 'string' ? (data['model'] as string) : '';
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
        const cost: number = usage === null ? reservation : costFromUsage(model, usage);
        const end: number = now();
        const latencyMs: number = Math.max(0, Math.round(end - start));
        const receipt: MetaReceipt = {
          purpose: req.purpose,
          requestedModel: model,
          returnedModel,
          responseId,
          usage,
          latencyMs,
          estCostUSD: cost,
          finishReason,
          attempts: attempt,
        };
        const settled: { costUSD: number; responseId?: string; usage?: Usage | null } = {
          costUSD: cost,
        };
        if (responseId !== '') {
          settled.responseId = responseId;
        }
        settled.usage = usage;

        if (data['model'] !== model) {
          ledger.reconcile(reservationId, settled);
          throw new MetaError('RETURNED_MODEL_MISMATCH', 'returned model mismatch', { receipt });
        }
        if (finishReason !== 'stop') {
          ledger.reconcile(reservationId, settled);
          throw new MetaError('OUTPUT_TRUNCATED', 'output truncated', { receipt });
        }
        if (content.length === 0) {
          ledger.reconcile(reservationId, settled);
          throw new MetaError('EMPTY_OUTPUT', 'empty output', { receipt });
        }
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(content) as unknown;
        } catch {
          ledger.reconcile(reservationId, settled);
          throw new MetaError('OUTPUT_NOT_JSON', 'output not JSON', { receipt });
        }
        ledger.reconcile(reservationId, settled);
        return { data: parsedContent as T, receipt };
      }

      const status: number = res.status;
      const retryable: boolean =
        status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
      if (retryable && attempt < 2) {
        const delay: number = retryDelayMs * (1 + Math.random());
        await sleep(delay);
        continue;
      }
      if (status === 429) {
        ledger.reconcile(reservationId, { costUSD: reservation });
        throw new MetaError('RATE_LIMITED', 'rate limited', { status });
      }
      if (status >= 500 && status <= 599) {
        ledger.reconcile(reservationId, { costUSD: reservation });
        throw new MetaError('SERVER_ERROR', 'server error', { status });
      }
      if (status === 400) {
        let apiMsg = '';
        try {
          const eb: unknown = await res.json();
          if (typeof eb === 'object' && eb !== null) {
            const e: unknown = (eb as Record<string, unknown>)['error'];
            if (typeof e === 'object' && e !== null) {
              const m: unknown = (e as Record<string, unknown>)['message'];
              if (typeof m === 'string' && m.length > 0) {
                apiMsg = m.slice(0, 300);
              }
            } else if (typeof e === 'string' && e.length > 0) {
              apiMsg = e.slice(0, 300);
            }
          }
        } catch {
          apiMsg = '';
        }
        const msg: string = apiMsg !== '' ? `bad request: ${apiMsg}` : 'bad request';
        ledger.reconcile(reservationId, { costUSD: 0 });
        throw new MetaError('BAD_REQUEST', msg, { status });
      }
      if (status === 401 || status === 403) {
        ledger.reconcile(reservationId, { costUSD: 0 });
        throw new MetaError('AUTH_FAILED', 'authentication failed', { status });
      }
      if (status === 404) {
        ledger.reconcile(reservationId, { costUSD: 0 });
        throw new MetaError('MODEL_NOT_FOUND', 'model not found', { status });
      }
      if (status >= 400 && status < 500) {
        ledger.reconcile(reservationId, { costUSD: 0 });
        throw new MetaError('HTTP_ERROR', `http error: ${status}`, { status });
      }
      ledger.reconcile(reservationId, { costUSD: reservation });
      throw new MetaError('HTTP_ERROR', `http error: ${status}`, { status });
    }
    throw new MetaError('SERVER_ERROR', 'server error');
  }

  return { complete };
}
