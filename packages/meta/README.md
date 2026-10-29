# packages/meta — Meta Model API client, spend ledger, prompts, pipeline (TASK-004 + OW-1)

Server-only. Implementation and tests authored by **Muse Spark 1.3** through the Muse Code subscription bridge (`scripts/muse-subscription.py`); receipts in `docs/evidence/task-004/`. Spec: `docs/specs/TASK-004-meta-client.md`.

| Module | Role |
| --- | --- |
| `pricing.ts` | Two `ModelChoice` values (`muse-spark-1.3`, `muse-spark-open`) over two `MetaProvider` values (`meta-api`, `modal`); per-MTok prices (currently 1.25 input / 0.15 cached / 4.25 output for both); `costFromUsage`, conservative `reservationUSD`, `UNKNOWN_MODEL`. |
| `ledger.ts` | Append-only JSONL spend ledger with a hard cap; reserve → reconcile; replays on restart. Every entry carries `provider`; `reserve({ …, provider? })` defaults to `meta-api`; `committedUSD(provider?)` filters per provider; optional `providerCapsUSD` enforces per-provider caps (meta-api additionally bounded by `capUSD`; a provider without a configured cap fails closed). |
| `client.ts` | `createMetaClient` with `providerConfig`: `{ provider: 'meta-api' }` (Bearer, default `https://api.meta.ai/v1`) or `{ provider: 'modal', baseUrl, proxyKey, proxySecret, modelString }` (`Modal-Key`/`Modal-Secret`, no `Authorization`, `POST <base>/chat/completions`, exact model `meta-models/Muse-Spark-Open-816B-A42B`). Same body key order, input bound, timeout, one retry on 429/5xx, settle/reconcile, and error mapping on both providers. Usage parser accepts Meta nested `completion_tokens_details.reasoning_tokens` + `prompt_tokens_details.cached_tokens` and Modal top-level `reasoning_tokens` with `prompt_tokens_details: null`; conflicting reasoning values are invalid (reservation basis). Missing cached counts use `cachedTokens: 0` with `cachedUnknown: true` (also true when usage is null). Every real receipt carries `provider`, `model`, `providerModel`, `cachedUnknown`; `MetaError.provider` is set on call failures. New codes `MODAL_PROXY_TOKEN_MISSING`, `PROVIDER_CONFIG_INVALID`. Never emits keys, secrets, URLs, request/response text. |
| `prompts.ts` | `PROMPT_VERSION`, analysis and spec message builders (source as untrusted data, verbatim-quote rules). |
| `pipeline.ts` | `analyzeSource` and `generateSpec`: Muse call → `assembleSpec` → deterministic validation report. |

Tests (`*.test.ts`) use a fake `fetch` / fake client only; none touches the network.
