// OW-2 — per-job model choice on the server side.
//
// Two model choices, two providers, one explicit selection per job (never a
// silent fallback between them):
//   muse-spark-1.3   → Meta API (Bearer MODEL_API_KEY, as before)
//   muse-spark-open  → Modal Shared Endpoint (open weights), auth via the
//                      MODAL_PROXY_TOKEN environment variable.
//
// Secret handling (frozen interface 4): the API server reads MODAL_PROXY_TOKEN
// ONLY when a muse-spark-open job is submitted. The stored value is one string
// `wk-…ws-…` (any separator between the halves); it is split here at the first
// 'ws-' boundary and separator characters are stripped from the key half. The
// token is never logged, never put in a response/event/job file, and never
// parsed on the client side. A missing or malformed token does NOT fail the
// HTTP request: the job starts and fails with the fixed public error
// MODAL_PROXY_TOKEN_MISSING before any ledger reservation is made — so the
// failure is recorded where every other job failure is recorded.

import { createMetaClient, MetaError, MODAL_MUSE_SPARK_OPEN_MODEL } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type { MetaProvider, ModelChoice } from '../../packages/meta/pricing.ts';

/** Frozen interface 5 labels (the web picker shows exactly these strings). */
export interface ModelInfo {
  id: ModelChoice;
  label: string;
  provider: MetaProvider;
}

export const MODEL_INFO: readonly ModelInfo[] = [
  { id: 'muse-spark-1.3', label: 'Muse Spark 1.3 — Meta API', provider: 'meta-api' },
  { id: 'muse-spark-open', label: 'Muse Spark Open — open weights, hosted on Modal', provider: 'modal' },
];

export const PROVIDER_FOR_MODEL: Readonly<Record<ModelChoice, MetaProvider>> = {
  'muse-spark-1.3': 'meta-api',
  'muse-spark-open': 'modal',
};

export const DEFAULT_MODEL: ModelChoice = 'muse-spark-1.3';

/**
 * OW-1 note: createMetaClient requires an apiKey field even for the modal
 * providerConfig, where it is IGNORED and never sent (the Modal branch only
 * sends Modal-Key/Modal-Secret headers). This fixed dummy satisfies the
 * signature without touching the real Meta key.
 */
const MODAL_PLACEHOLDER = 'unused';

export interface ModalProxyToken {
  proxyKey: string;
  proxySecret: string;
}

/**
 * Split the stored MODAL_PROXY_TOKEN (`wk-…<sep>ws-…`) at the first 'ws-'
 * boundary. Separator characters (whitespace, ':', ';', '|', ',') between the
 * halves are stripped from the key; surrounding whitespace is ignored. Returns
 * null for anything that cannot be a valid token pair — callers treat null as
 * MISSING (fixed MODAL_PROXY_TOKEN_MISSING), never as a config error to parse
 * further. The value itself is never logged or returned in any response.
 */
export function splitModalProxyToken(raw: string | undefined): ModalProxyToken | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const boundary = trimmed.indexOf('ws-');
  if (boundary <= 0) {
    return null; // no secret half, or nothing before it
  }
  const proxySecret = trimmed.slice(boundary);
  if (proxySecret.length <= 'ws-'.length) {
    return null; // empty secret payload
  }
  const proxyKey = trimmed.slice(0, boundary).replace(/[\s:;|,]+/g, '');
  if (!proxyKey.startsWith('wk-') || proxyKey.length <= 'wk-'.length) {
    return null;
  }
  return { proxyKey, proxySecret };
}

/**
 * Boolean availability of the Modal model for /api/health and /api/models —
 * a shape check of the environment variable only. The VALUE is used solely by
 * buildModalClient when a muse-spark-open job is submitted.
 */
export function modalTokenAvailable(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return splitModalProxyToken(env['MODAL_PROXY_TOKEN']) !== null;
}

/**
 * The client a muse-spark-open job gets when MODAL_PROXY_TOKEN is missing or
 * malformed: it carries the correct provider/model labels for the job record
 * and every complete() call throws the fixed MetaError BEFORE any ledger
 * reservation — the worker persists it as the public MODAL_PROXY_TOKEN_MISSING
 * failure like any other provider error.
 */
export function missingModalTokenClient(): MetaClient {
  return {
    provider: 'modal',
    model: 'muse-spark-open',
    providerModel: MODAL_MUSE_SPARK_OPEN_MODEL,
    complete: async <T,>(_req: unknown): Promise<{ data: T; receipt: never }> => {
      throw new MetaError('MODAL_PROXY_TOKEN_MISSING', undefined, {
        chargedUSD: 0,
        reservedUnknownUSD: 0,
        costBasis: 'usage',
        provider: 'modal',
      });
    },
  } as MetaClient;
}

export interface ModalClientDeps {
  ledger: Ledger;
  /** R-11: the configured input budget (config/resource-limits.json maxInputTokens). */
  maxInputTokens: number;
  /** Validated config value (config/resource-limits.json modalBaseUrl). */
  modalBaseUrl: string;
  /** Environment to read MODAL_PROXY_TOKEN from; defaults to process.env. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Test seam: fake transport, no live calls. */
  fetchImpl?: typeof fetch;
}

/**
 * Build the per-job client for a muse-spark-open job. Reads MODAL_PROXY_TOKEN
 * at call time (job submission) — never before — and never logs it. A missing
 * or malformed token returns the failing client above, so the job fails with
 * the fixed public error and zero spend.
 */
export function buildModalClient(deps: ModalClientDeps): MetaClient {
  const env: Readonly<Record<string, string | undefined>> = deps.env ?? process.env;
  const token = splitModalProxyToken(env['MODAL_PROXY_TOKEN']);
  if (token === null) {
    return missingModalTokenClient();
  }
  try {
    return createMetaClient({
      // OW-1: ignored for the modal providerConfig, never sent.
      apiKey: MODAL_PLACEHOLDER,
      ledger: deps.ledger,
      allowLive: true,
      maxInputTokens: deps.maxInputTokens,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      providerConfig: {
        provider: 'modal',
        baseUrl: deps.modalBaseUrl,
        proxyKey: token.proxyKey,
        proxySecret: token.proxySecret,
        modelString: MODAL_MUSE_SPARK_OPEN_MODEL,
      },
    });
  } catch (err: unknown) {
    // The client re-validates the token halves; a rejection there is still the
    // fixed MISSING public error (a malformed token is never a config error the
    // caller has to interpret), and never provider text.
    if (err instanceof MetaError && err.code === 'MODAL_PROXY_TOKEN_MISSING') {
      return missingModalTokenClient();
    }
    throw err;
  }
}
