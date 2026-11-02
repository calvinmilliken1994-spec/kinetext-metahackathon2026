// Stage 11 slice L — the clients a job gets in relay mode (docs/specs/STAGE-11-judge-relay.md).
//
//   Meta chat   apiKey = access code, baseUrl = <relay>/meta/v1      (relay forwards to api.meta.ai/v1)
//   SAM         baseUrl = <relay>/meta/v1, key = access code        (relay forwards /responses)
//   Modal       providerConfig { proxyKey 'wk-relay', proxySecret 'ws-' + code,
//               baseUrl <relay>/modal/v1, modelString }              (code travels in Modal-Secret)
//
// The code is passed in by the caller at job submission time and lives only in the client's closure.
// Nothing here logs, stores or returns it. A code that cannot be an HTTP header value fails closed.

import { createMetaClient, MetaError } from '../../packages/meta/client.ts';
import type { MetaClient } from '../../packages/meta/client.ts';
import type { Ledger } from '../../packages/meta/ledger.ts';
import type { ModelChoice } from '../../packages/meta/pricing.ts';
import type { JobFlow } from '../../workers/generation/jobs.ts';
import type { SamSegmentDeps } from '../../workers/generation/lesson.ts';
import { buildModalClient } from './model-clients.ts';
import { RELAY_CODE_PATTERN } from './relay.ts';
import type { RelayControl } from './relay.ts';

/** The fixed Modal-Key the relay ignores; the code travels as the Modal-Secret. */
export const RELAY_MODAL_PROXY_KEY = 'wk-relay';

export interface RelayClientDeps {
  ledger: Ledger;
  /** The validated relay base URL (no trailing slash). */
  relayUrl: string;
  /** The access code the relay accepted. Never logged. */
  code: string;
  /** Test seam: a fake relay transport. */
  fetchImpl?: typeof fetch;
}

export interface RelayChatClientDeps extends RelayClientDeps {
  /** R-11: the configured input budget for this job's flow. */
  maxInputTokens: number;
}

function assertCode(code: string): void {
  if (!RELAY_CODE_PATTERN.test(code)) {
    throw new MetaError('PROVIDER_CONFIG_INVALID', undefined);
  }
}

/** Muse Spark 1.3 through the relay: the code is the bearer, the relay swaps in Calvin's key. */
export function buildRelayMetaClient(deps: RelayChatClientDeps): MetaClient {
  assertCode(deps.code);
  return createMetaClient({
    apiKey: deps.code,
    ledger: deps.ledger,
    allowLive: true,
    maxInputTokens: deps.maxInputTokens,
    baseUrl: `${deps.relayUrl}/meta/v1`,
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** Muse Spark Open through the relay's Modal route. */
export function buildRelayModalClient(deps: RelayChatClientDeps): MetaClient {
  assertCode(deps.code);
  return buildModalClient({
    ledger: deps.ledger,
    maxInputTokens: deps.maxInputTokens,
    modalBaseUrl: `${deps.relayUrl}/modal/v1`,
    token: { proxyKey: RELAY_MODAL_PROXY_KEY, proxySecret: `ws-${deps.code}` },
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  });
}

/** SAM 3.1 through the relay (same Meta route, same bearer). The job's own ledger meters it. */
export function relaySamDeps(deps: RelayClientDeps): SamSegmentDeps {
  assertCode(deps.code);
  return {
    apiKey: deps.code,
    ledger: deps.ledger,
    baseUrl: `${deps.relayUrl}/meta/v1`,
    ...(deps.fetchImpl !== undefined ? { fetch: deps.fetchImpl } : {}),
  };
}

export interface RelayJobClientsDeps {
  relay: Pick<RelayControl, 'url' | 'code'>;
  model: ModelChoice;
  flow: JobFlow;
  ledger: Ledger;
  /** Config maxInputTokens (activity flow) and maxInputTokensV2 (lesson flow). */
  maxInputTokens: number;
  maxInputTokensV2: number;
  fetchImpl?: typeof fetch;
}

/**
 * Everything one job needs in relay mode, built at submission time from the in-memory code: the model
 * client for the job's model and flow, and the SAM deps. With no code held it throws ACCESS_REQUIRED
 * (the API's access gate answers 403 first; this is defence in depth).
 */
export function buildRelayJobClients(deps: RelayJobClientsDeps): { client: MetaClient; sam: SamSegmentDeps } {
  const code = deps.relay.code();
  if (code === null) {
    throw new Error('ACCESS_REQUIRED');
  }
  const common = {
    ledger: deps.ledger,
    relayUrl: deps.relay.url,
    code,
    ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
  };
  const maxInputTokens = deps.flow === 'lesson' ? deps.maxInputTokensV2 : deps.maxInputTokens;
  return {
    client:
      deps.model === 'muse-spark-open'
        ? buildRelayModalClient({ ...common, maxInputTokens })
        : buildRelayMetaClient({ ...common, maxInputTokens }),
    sam: relaySamDeps(common),
  };
}
