# Separate provider usage and credit record

> Updated activation is in `PROFILE_ACTIVATION.md`: Meta and Qwen credentials/catalogs are verified in the dedicated profile; Opus 5.5 returned a real connectivity response. Credits remain unknown; no metered Meta completion was sent. Older rows below retain the initial setup snapshot.

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
