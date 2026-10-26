# Separate provider usage and credit record

> Updated activation is in `PROFILE_ACTIVATION.md`: Meta and Qwen credentials/catalogs are verified in the dedicated profile; Opus 5.5 returned a real connectivity response. Older rows below retain the initial setup snapshot.
>
> **2026-10-27 update:** Meta Model API participant credits confirmed applied (USD 150 free credits in use; see `RESOURCE_POLICY.md`). First metered Meta completion sent — see ledger below.

## Meta Model API ledger (participant credits, cap USD 150)

Estimates use local token counts × published Standard rates (input $1.25/M, cached $0.15/M, output $4.25/M — `https://dev.meta.ai/docs/getting-started/pricing-rate-limits`, as encoded in `scripts/meta-smoke.mjs`; recheck before larger runs). Billing page is authoritative.

| # | Time (UTC) | Purpose | Model | Response ID | Prompt / completion (reasoning) tokens | Est. USD | Receipt |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-26T21:16:51Z | Setup API smoke (fixed "ready" prompt) | muse-spark-1.3 | chatcmpl-01a17a12-beb0-7197-9279-ff40a8217fd2 | 15 / 39 (29) | 0.0001845 | `docs/evidence/meta-api-spark-smoke.json` |

Cumulative estimated: **USD 0.0001845** of 150.

Checked 2026-10-27 KST. Public rates are not account credit balances. No paid infrastructure was provisioned.

| Provider | Account access observed | Verified credits | Setup usage |
|---|---|---|---|
| Meta Model API | MODEL_API_KEY absent | Unknown | No inference request sent; local smoke blocked |
| Baseten | BASETEN_API_KEY absent | Unknown | No requests sent |
| Modal | Token ID/secret absent in inspected environment | Unknown | No requests/provisioning |
| Fireworks | FIREWORKS_API_KEY absent | Unknown | No requests sent |
| OpenRouter | Default .env key present; credits call HTTP 401; other pooled credentials not exhaustively checked | Unverified | Public model listing and one failed account read; no inference |
| Alibaba / Qwen | Default-profile key successfully read /models; new profile auth says logged out | Unknown | Catalog request only; no inference |
| OpenAI Codex | Dedicated profile CLI authenticated; real connectivity returned ready | Subscription entitlement/remaining quota not queried; no claim of unlimited access | One bounded profile connectivity run; tokens/cost not instrumented by this scaffold; current setup conversation also uses OpenAI |
| Anthropic | Dedicated profile CLI reports logged in; model cache is fallback | Unknown | No inference in setup |

Production ledger must separately record each call/reservation/reconciliation per provider, including failed/unknown-cost attempts. No generation-loop or cumulative accounting implementation is claimed in this setup checkpoint. Prices and billing modes must be rechecked before approved use.
