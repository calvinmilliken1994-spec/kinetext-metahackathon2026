# Spending, execution and privacy policy

## Usage split — confirmed by Calvin 2026-10-27
| Activity | Paid by | Routes |
|---|---|---|
| **Building** (design, code, tests, review, docs, Meta engineering) | Subscriptions only | Opus 5.5 / Sonnet 5.5 (Claude OAuth), GPT-6.1 Sol (Codex OAuth), Qwen Max / Qwen Flash / DeepSeek (Alibaba Token Plan), Muse Spark 1.3 (Muse Code subscription via `scripts/muse-subscription.py`) |
| **Product runtime for testing and demo** | Meta Model API participant credits (USD 150) | The product's own Meta client, live runs only |

Rules that enforce the split:
- No Hermes alias or launch command points at the `meta-ai` provider (which bills the credits). Meta engineering goes only through the Muse subscription bridge, which removes `MODEL_API_KEY` from its child environment.
- Building-time tests never call the Meta API: `npm test` uses a fake transport. Live calls happen only through explicit live/demo commands that log `purpose: "test-live" | "demo"` in the ledger.
- Verified live 2026-10-27: every building route answered on its subscription endpoint, and no Hermes session has ever billed `meta-ai` (`docs/evidence/building-routes-subscription-check.json`).

## Meta Model API credits — confirmed 2026-10-27 06:16 KST (user screenshot of Billing page)
- Billing page shows **Free credits in use: $150.00**, current balance £0.00 ("Your balance won't increase while using free credits"). Approved Meta Model API cap: **USD 150**, i.e. the participant credits only. Spend beyond the credits is not approved.
- Billing currency displays GBP while credits are USD; reconcile actual consumption from the Billing page, not only from local estimates.
- Recommended (user action, not doable by the agent): set the Billing page "Spend Limit" notification at or below the credit amount.
- **Privacy consequence:** the page states "While using free credits your content may be used for product improvement." Treat every Meta Model API request made on these credits as potentially retained for product improvement, *regardless of choosing Standard rather than Contributor model IDs*. Send only licensed public sources, project-authored fixtures and synthetic test content. No private, student or third-party-confidential material while free credits are active.
- All other metered spend (Baseten, Modal, Fireworks, other APIs) remains USD 0.
- Every Meta API call is recorded in the ledger in `PROVIDER_USAGE.md`; the per-command reservation check below still applies until the durable ledger exists.

## Default
Approved metered inference budget = **USD 0**. No paid infrastructure. Setting a positive budget is an explicit human approval step, not an agent convenience. Subscriptions do not imply free/unlimited API calls.

## Prepared smoke (implemented)
Direct Meta only, exact model gate via `/models`; one completion, zero retries, 512 output-token cap, 4096-token conservative input reservation, one 30-second abort deadline shared across catalog + generation, no alternate provider. Estimated reservation uses current Standard rates. Before sending, require `META_APPROVED_JOB_BUDGET_USD` >= reservation. This is a single-command check, **not a durable global spend limiter**. Repeated independent invocations require accounting/approval; do not use it as an unattended worker.

## Production requirements (planned, must precede product jobs)
Atomic per-provider spend reservations and shared durable usage ledger; reconcile actual billed units, conservative reservation on unknown/timeout results; per-job/cumulative thresholds; configurable token/time/tool/repair budgets; default max 2 repair attempts; retry only explicit transient errors with jitter and hard total deadline; never retry auth, input, schema or safety failures blindly; reject jobs without capacity; cache immutable stage artifacts safely; abort/cancel on exhaustion; show explicit unavailable errors. No automatic account purchases or self-host GPU deployment.

Separate accounts/usage: Meta Model API, Baseten, Modal, Fireworks, and other metered engineering APIs. Credit balance, expiration, rate tier and billing mode must be verified on the real account. Presently unknown, not assumed zero or free. Local OpenRouter .env credential failed credits check (401); this does not establish all pooled credentials are invalid.

Credentials only in ignored local env/secret stores and server processes; never Git, browser code, generated activity contexts, agent logs or public receipts. Standard Meta mode is default; Contributor mode can permit training on content and needs separate explicit approval. Do not send private/student educational material without consent. Generated imagery is labeled and cannot substitute for validated scientific diagrams.
