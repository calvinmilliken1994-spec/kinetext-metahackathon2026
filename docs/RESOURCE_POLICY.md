# Spending, execution and privacy policy

## Default
Approved metered inference budget = **USD 0**. No paid infrastructure. Setting a positive budget is an explicit human approval step, not an agent convenience. Subscriptions do not imply free/unlimited API calls.

## Prepared smoke (implemented)
Direct Meta only, exact model gate via `/models`; one completion, zero retries, 512 output-token cap, 4096-token conservative input reservation, one 30-second abort deadline shared across catalog + generation, no alternate provider. Estimated reservation uses current Standard rates. Before sending, require `META_APPROVED_JOB_BUDGET_USD` >= reservation. This is a single-command check, **not a durable global spend limiter**. Repeated independent invocations require accounting/approval; do not use it as an unattended worker.

## Production requirements (planned, must precede product jobs)
Atomic per-provider spend reservations and shared durable usage ledger; reconcile actual billed units, conservative reservation on unknown/timeout results; per-job/cumulative thresholds; configurable token/time/tool/repair budgets; default max 2 repair attempts; retry only explicit transient errors with jitter and hard total deadline; never retry auth, input, schema or safety failures blindly; reject jobs without capacity; cache immutable stage artifacts safely; abort/cancel on exhaustion; show explicit unavailable errors. No automatic account purchases or self-host GPU deployment.

Separate accounts/usage: Meta Model API, Baseten, Modal, Fireworks, and other metered engineering APIs. Credit balance, expiration, rate tier and billing mode must be verified on the real account. Presently unknown, not assumed zero or free. Local OpenRouter .env credential failed credits check (401); this does not establish all pooled credentials are invalid.

Credentials only in ignored local env/secret stores and server processes; never Git, browser code, generated activity contexts, agent logs or public receipts. Standard Meta mode is default; Contributor mode can permit training on content and needs separate explicit approval. Do not send private/student educational material without consent. Generated imagery is labeled and cannot substitute for validated scientific diagrams.
