# OW-1 call B — provider-aware client (Meta API + Modal-hosted Muse Spark Open) + tests

Context: this is a NEW FEATURE wave (TASK-025 "open-weights mode", wave OW-1), not a review fix; read the "Hard rules" and "Output format" above and ignore the sentence about reviewer defects. In the previous call you already changed `pricing.ts` (ModelChoice, MetaProvider, `muse-spark-open` prices, UNKNOWN_MODEL) and `ledger.ts` (provider on entries, `reserve({ …, provider? })`, `providerCapsUSD`, `committedUSD(provider?)`); their CURRENT versions (your output, saved verbatim) are below. Now make `createMetaClient` provider-aware. The same pipeline, prompts and PROMPT_VERSION (`'v9'`) run on either provider; the model choice flows ONLY through the client.

Facts about the open-weight host (verified by a real smoke request; a sanitized copy of its response shape is included below):
- Modal Shared Endpoint, OpenAI-compatible: `POST <baseUrl>/chat/completions` where baseUrl ends in `/v1` (e.g. `https://<workspace>--ep-<name>-server.us-west.modal.direct/v1`).
- Exact model string: `meta-models/Muse-Spark-Open-816B-A42B` (sent as `model`, echoed back as `model`).
- Auth: two headers `Modal-Key` (a `wk-…` value) and `Modal-Secret` (a `ws-…` value) from a workspace proxy token. NO `Authorization` header. The API server stores the token as one string and splits it (a later wave); the client receives key and secret separately.
- Strict `json_schema` response_format and `reasoning_effort: 'high'` are supported; HTTP 429 means the shared concurrency limit was hit → the EXISTING retry/backoff policy applies unchanged.
- Usage shape differs: `reasoning_tokens` is TOP-LEVEL in `usage`, and `prompt_tokens_details` may be `null` (no cached-token count). Meta's API nests reasoning in `completion_tokens_details.reasoning_tokens` and reports `prompt_tokens_details.cached_tokens`.
- Price per MTok: 1.25 input / 0.15 cached / 4.25 output (ModelChoice `muse-spark-open` in pricing.ts).

## Required changes

### ledger.ts (one fix from your previous call)
`tsc` fails: `packages/meta/client.test.ts(145,9): error TS2741: Property 'providerCapsUSD' is missing in type '{ capUSD: number; reserve: …; reconcile: …; committedUSD: () => number; close: () => void; }' but required in type 'Ledger'.` Other packages also build fake `Ledger` objects. Make it OPTIONAL in the interface: `readonly providerCapsUSD?: Readonly<Partial<Record<MetaProvider, number>>>`. The real ledger keeps returning it (undefined when not configured). Change nothing else in ledger.ts; output the complete file.

### client.ts — exact new public surface (a later wave codes against these names; do not rename)
```ts
export type { MetaProvider, ModelChoice } from './pricing.ts';
export const MODAL_MUSE_SPARK_OPEN_MODEL = 'meta-models/Muse-Spark-Open-816B-A42B';   // typed as that literal
export type ProviderConfig =
  | { provider: 'meta-api' }
  | { provider: 'modal'; baseUrl: string; proxyKey: string | undefined; proxySecret: string | undefined; modelString: string };
export type ClientReceipt = MetaReceipt & {
  provider?: MetaProvider;        // always set by the real client
  model?: ModelChoice;            // display id: 'muse-spark-1.3' | 'muse-spark-open'
  providerModel?: string;         // exact model string sent to the provider
  cachedUnknown?: boolean;        // true when the provider did not report cached tokens
};
export interface MetaClientOptions { /* all existing fields unchanged */ providerConfig?: ProviderConfig; }
export interface MetaClient {
  complete<T>(req: CompleteRequest): Promise<{ data: T; receipt: ClientReceipt }>;
  readonly provider?: MetaProvider;   // set by the real client
  readonly model?: ModelChoice;
  readonly providerModel?: string;
}
```
The new fields are OPTIONAL in the types so existing fake clients/receipts across the repo (which return a plain `MetaReceipt` and have only `complete`) keep compiling; the REAL client always sets all of them. `MetaError` gets an optional `provider?: MetaProvider` field (constructor opts gain `provider?`, kept only if `isMetaProvider`), and its `receipt` field/opt type becomes `ClientReceipt`. New error codes with fixed messages: `MODAL_PROXY_TOKEN_MISSING: 'modal proxy token missing'`, `PROVIDER_CONFIG_INVALID: 'provider configuration invalid'`. Every existing code/message stays.

### Construction rules (createMetaClient)
1. `allowLive !== true` → `LIVE_CALLS_DISABLED` first (unchanged), before looking at any provider config.
2. `providerConfig` absent or `{ provider: 'meta-api' }` → EXACTLY today's behaviour (top-level `apiKey`, `baseUrl`, `model`; `MODEL_API_KEY_MISSING`; Bearer header). provider `meta-api`, model `muse-spark-1.3`, providerModel `muse-spark-1.3`.
3. `providerConfig` present but not a plain object, or `provider` not `'meta-api'`/`'modal'` → `PROVIDER_CONFIG_INVALID`.
4. `{ provider: 'modal', … }`:
   - `proxyKey` or `proxySecret` not a string or empty → `MODAL_PROXY_TOKEN_MISSING` (no fetch, no ledger reservation). Top-level `apiKey` is IGNORED for Modal (never required, never sent).
   - `proxyKey` not starting with `wk-`, `proxySecret` not starting with `ws-` (catches a swapped pair), or either containing any character outside visible ASCII `\x21-\x7e` → `PROVIDER_CONFIG_INVALID`.
   - `baseUrl` must parse with `new URL`, protocol `https:`, no username/password, no search, no hash → else `PROVIDER_CONFIG_INVALID`. Strip trailing `/` characters; request URL is `${base}/chat/completions`.
   - `modelString !== MODAL_MUSE_SPARK_OPEN_MODEL` → `PROVIDER_CONFIG_INVALID` (pricing is keyed by ModelChoice, so an unknown model string must not be priced as Spark Open).
   - Top-level `baseUrl` or `model` also given → `PROVIDER_CONFIG_INVALID` (no ambiguous source of truth).
   - provider `modal`, model `muse-spark-open`, providerModel `meta-models/Muse-Spark-Open-816B-A42B`.
   - No error, receipt, ledger entry or message ever contains the key, secret, base URL or any provider response text.

### Request (both providers)
- Body: IDENTICAL object and key order to today (`model, messages, max_tokens, reasoning_effort: 'high', stream: false, response_format: { type: 'json_schema', json_schema: { name, schema } }`), the ONLY difference being `model` = providerModel. Do not add fields for one provider only.
- Headers, exact key sets: meta-api `{ Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }` (unchanged); modal `{ 'Modal-Key': proxyKey, 'Modal-Secret': proxySecret, 'Content-Type': 'application/json' }` — no Authorization header on Modal, no Modal-* headers on Meta.
- Same input-bound check, timeout, abort, retry (one retry on 429/500/502/503/504 with the existing delay), settle/reconcile, cost accumulation and error mapping as today for both providers.
- Ledger: `ledger.reserve({ purpose, model: providerModel, estUSD, provider })`. Pricing: `reservationUSD(modelChoice, …)`, `costFromUsage(modelChoice, usage)`.
- Returned-model check compares `data.model` with providerModel (`RETURNED_MODEL_MISMATCH` otherwise; e.g. Modal answering `muse-spark-1.3` is a mismatch).

### Usage parser (both shapes)
- prompt/completion tokens validated as today.
- Reasoning: `completion_tokens_details.reasoning_tokens` if present; otherwise top-level `usage.reasoning_tokens` if present; otherwise 0. Each present value is validated like today (finite non-negative integer, ≤ completion). If BOTH are present and differ → usage invalid (null → reservation-basis charge, as today for invalid usage).
- Cached: `prompt_tokens_details.cached_tokens` when `prompt_tokens_details` is an object with that field (validated as today). When `prompt_tokens_details` is null/absent or has no `cached_tokens`, use `cachedTokens: 0` (cost = full input price, conservative) AND set `cachedUnknown: true` on the receipt. `cachedUnknown` is also true when usage is null.
- Receipt fields on EVERY real receipt (success and those attached to MetaError): existing fields (requestedModel = providerModel) plus `provider`, `model`, `providerModel`, `cachedUnknown`. Errors thrown by `fail()` inside a call also set `MetaError.provider`.

### Tests (fake transport only; never the network, never real credentials)
- Do NOT change `client.test.ts`: every existing test there must pass unchanged (it is included read-only so you can reuse its fake-fetch/fake-ledger patterns — copy helpers, do not import from test files). If one existing assertion really cannot hold, say so in NOTES instead of editing it.
- New file `packages/meta/client.open-weights.test.ts` covering at least: both providers' URL, exact header key sets and values (synthetic markers like `wk-SYNTHKEY0001` / `ws-SYNTHSECRET0001`), body deep-equal across providers except `model`; Modal with `apiKey` also set still sends no Authorization; Modal usage shape from the smoke (183 prompt / 415 completion / `prompt_tokens_details: null` / top-level `reasoning_tokens: 379`) → usage {183,415,379,0}, cost (183*1.25+415*4.25)/1e6, `cachedUnknown: true`, costBasis usage; Meta nested shape with cached reported → `cachedUnknown: false` and cached price applied; both reasoning fields present and different → reservation basis; missing/empty proxyKey or proxySecret → MODAL_PROXY_TOKEN_MISSING with zero fetch calls and zero reservations; swapped/malformed tokens, http:// or credentialed/queried baseUrl, wrong modelString, top-level baseUrl/model with modal, unknown provider → PROVIDER_CONFIG_INVALID; 429 then 200 on Modal → attempts 2, two reservations both `provider: 'modal'` and model string; 429 twice → RATE_LIMITED; abort mid-request → DEADLINE_EXCEEDED; returned model mismatch on Modal; a provider error body with a marker string never appears in `err.message`, `JSON.stringify(err)` or receipts; key/secret/baseUrl never appear in the ledger file, receipts or errors; a REAL `openLedger` with `providerCapsUSD` (copy the free-lock-port helper pattern from your ledger tests: probe `defaultLockPort(path)`, retry with a new temp dir) where a modal reservation over the modal cap throws BUDGET_EXCEEDED with zero fetch calls while a meta-api client on the same ledger still succeeds, and ledger lines carry the right provider; client.provider/model/providerModel getters for both.
- New file `packages/meta/pipeline.open-weights.test.ts`: run `analyzeSource(client, source, 'test-live')` (signature unchanged) through a REAL `createMetaClient` for each provider with a fake fetch that returns the analysis fixture `tests/fixtures/analysis.forces.json` as the message content (source fixture `tests/fixtures/source-doc.json`, loaded like `pipeline.test.ts` does; pass a `maxInputTokens` large enough, e.g. 64000, since the client default is 16000; use an in-memory fake Ledger). Assert both runs publish the same report, the two captured request bodies are deep-equal except `model`, the messages equal `buildAnalysisMessages(source)`, `PROMPT_VERSION === 'v9'`, and the returned receipt carries provider/model/providerModel.

### README
Update `packages/meta/README.md` (table rows for pricing/ledger/client) to describe the two providers, `cachedUnknown`, and per-provider caps. Output it in a ```md block.

Output exactly these files:
=== FILE: packages/meta/ledger.ts ===
=== FILE: packages/meta/client.ts ===
=== FILE: packages/meta/client.open-weights.test.ts ===
=== FILE: packages/meta/pipeline.open-weights.test.ts ===
=== FILE: packages/meta/README.md ===
then === NOTES === (what changed, which tests prove each requirement, any deviation with the reason).
