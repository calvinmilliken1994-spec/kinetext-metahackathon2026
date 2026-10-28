# Separate provider usage and credit record

> Updated activation is in `PROFILE_ACTIVATION.md`: Meta and Qwen credentials/catalogs are verified in the dedicated profile; Opus 5.5 returned a real connectivity response. Older rows below retain the initial setup snapshot.
>
> **2026-10-27 update:** Meta Model API participant credits confirmed applied (USD 150 free credits in use; see `RESOURCE_POLICY.md`). First metered Meta completion sent — see ledger below.

## Meta Model API ledger (participant credits, cap USD 150)

Estimates use local token counts × published Standard rates (input $1.25/M, cached $0.15/M, output $4.25/M — `https://dev.meta.ai/docs/getting-started/pricing-rate-limits`, as encoded in `scripts/meta-smoke.mjs`; recheck before larger runs). Billing page is authoritative.

| # | Time (UTC) | Purpose | Model | Response ID | Prompt / completion (reasoning) tokens | Est. USD | Receipt |
|---|---|---|---|---|---|---|---|
| 1 | 2026-10-26T21:16:51Z | Setup API smoke (fixed "ready" prompt) | muse-spark-1.3 | chatcmpl-01a17a12-beb0-7197-9279-ff40a8217fd2 | 15 / 39 (29) | 0.0001845 | `docs/evidence/meta-api-spark-smoke.json` |

| 2 | 2026-10-27 (KST 08:30) | Stage 2 live spike: analysis, supported source | muse-spark-1.3 | chatcmpl-01a17a7b-36cb-74f4-837a-6b198ab92d7b | 1,073 / 3,779 (3,484) | 0.017402 | `docs/evidence/task-004/` |
| 3 | 2026-10-27 | Stage 2 live spike: spec, supported source | muse-spark-1.3 | chatcmpl-01a17a7b-5b20-7359-8650-77e87bab980c | 1,980 / 3,413 (2,782) | 0.016980 | `docs/evidence/task-004/` |
| 4 | 2026-10-27 | Stage 2 live spike: analysis, unsupported source | muse-spark-1.3 | chatcmpl-01a17a7b-9f26-73da-9858-9c496d26d09d | 1,453 / 904 (847) | 0.005658 | `docs/evidence/task-004/` |

| 5–7 | 2026-10-27 08:40 KST | First jobs through the product API (`job-20261026234008-04c93801` supported: analysis + spec; `job-20261026234051-0d51ecdc` unsupported: analysis) | muse-spark-1.3 | see `storage/runs/<job>/events.jsonl` | — | 0.017360 + 0.028178 + 0.005031 | product ledger |
| 8–9 | 2026-10-27 09:18 KST | TASK-008 live run started from the web UI (`job-20261027001819-25261a8c`): analysis + spec, 13/13 | muse-spark-1.3 | see `docs/evidence/task-008/` | — | 0.018290 + 0.023541 | product ledger |

From row 2 on, calls are also recorded by the product's own ledger (`storage/ledger.jsonl`, gitignored), which enforces the Stage 2 cap of USD 10.

Cumulative estimated: **USD 0.1326** of 150 (Stage 2: USD 0.1324 of 10, per the product ledger).

| 10+ | 2026-10-28 03:08–03:19 KST | Stage 5 live runs (TASK-017): 11 jobs on participant credits, purpose `test-live` — one per supported source/engine (lift, ballistic, sound, forces), the drag decline, two teacher-pasted sources (incl. the prompt-injection test), two labelled demo-fault repairs, two superseded failed attempts | muse-spark-1.3 | per-job events with response IDs in `docs/evidence/stage-5/live/` | — | **0.525535** total | product ledger; per-job costs in `docs/evidence/stage-5/live/README.md` |

**Stage 5 update 2026-10-28:** cumulative estimated **USD 0.658** of 150 (USD 0.1326 setup+Stage 2 rows above, plus Stage 5 USD 0.5255). The product ledger's committed total (all `reconcile` entries) is **USD 0.713831 of the USD 10 cap** — it also covers two runs Calvin started from the web UI on 2026-10-27 after Stage 2 closed (`job-20261027115756-63fa4ce9` speed of sound, declined, USD 0.005627; `job-20261027123517-0c6652a3` equations of motion, published, USD 0.05023; together USD 0.055857), which are not in committed evidence; the reviewer independently re-summed it (`docs/reviews/stage-5-review.md`, Addendum 2). Limits used at these runs: input bound 32,000, spec/repair output 16,000, job deadline 240 s (`config/resource-limits.json`; reasons in `RESOURCE_POLICY.md` "Stage 5 update"). Provider billing still not queried; local estimates, Standard prices.

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
