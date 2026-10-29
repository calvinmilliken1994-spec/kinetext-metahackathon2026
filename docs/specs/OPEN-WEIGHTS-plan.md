# Open-weights mode — plan (TASK-025)

Status: READY (interfaces below frozen before implementation). Owner of record: lead (Opus 5.5).

## Why
Meta Muse Spark Open is the open-weight release of the model family we use. Running the **same pipeline, prompts, checks and repair loop** on it shows that the product's guarantees come from the deterministic checks, not from one hosted API, and that a school district or education publisher could run it on infrastructure it controls. It also enables a side-by-side evaluation (hosted Muse Spark 1.3 vs open-weight Muse Spark Open) on the pre-registered 29-page manifest.

Honest framing: the 816B-A42B model needs a multi-GPU server; this is "a district or publisher can self-host", **not** "runs on a classroom laptop" (Muse Glimmer on school hardware was rejected as niche, 2026-10-29).

## Smoke result (2026-10-29)
- `GET /v1/models` on the Modal Shared Endpoint: one model `meta-models/Muse-Spark-Open-816B-A42B`, 1M context, max output 262,144, features `tools, json_mode, structured_outputs, reasoning`, reasoning effort `low|medium|high|xhigh`.
- One strict `json_schema` completion, `reasoning_effort: high`: HTTP 200, 1.9 s, correct (19.62 m), finish `stop`, usage `183 prompt / 415 completion / 379 reasoning`. Receipt `docs/evidence/open-weights/modal-smoke.json`. Estimated USD 0.0019.
- Usage shape differs from Meta's API: `reasoning_tokens` is top-level, `prompt_tokens_details` may be `null` (no cached-token count).
- Auth: `Modal-Key` + `Modal-Secret` headers from a workspace proxy token.
- Baseten Model APIs also host Muse Spark Open (`meta-models/muse-spark-open`, same price) but **do not support structured outputs/JSON mode for it** (Baseten docs), so it cannot run our constrained-decoding pipeline as is. Baseten credit is reserved for a later experiment (see below).

## Frozen interfaces
1. **Model choice is per job.** `ModelChoice = 'muse-spark-1.3' | 'muse-spark-open'`. Default `muse-spark-1.3`. API `POST /api/jobs` accepts optional `model`; unknown values → 400. Job summary, events and receipts record `model` (display id) and `provider` (`meta-api` | `modal`), plus the provider's exact model string.
2. **Client (packages/meta, Muse-authored).** `createMetaClient` gains a provider config: `{ provider: 'meta-api', key }` (unchanged) or `{ provider: 'modal', baseUrl, proxyKey, proxySecret, modelString: 'meta-models/Muse-Spark-Open-816B-A42B' }`. Same request body (strict `json_schema`, `reasoning_effort: 'high'`, `max_tokens`), same retry/timeout/abort/receipt/ledger behaviour; usage parser accepts both shapes (top-level `reasoning_tokens`, null details → cached 0 **and** flagged `cachedUnknown`); errors stay fixed-vocabulary (no provider text). `PRICES_PER_MTOK` gains `muse-spark-open` (1.25 / 0.15 / 4.25). Prompts unchanged (same PROMPT_VERSION) so results are comparable.
3. **Ledger.** Entries carry `provider`; the cap check uses the configured cap **per provider** (`config/resource-limits.json` `providerCapsUSD: { "meta-api": 50, "modal": 50 }`); the existing stage cap remains for `meta-api`.
4. **Secrets.** API server reads `MODAL_PROXY_TOKEN` (format `wk-…ws-…`, split server-side) only when a `muse-spark-open` job is submitted; never logged, never sent to the browser.
5. **UI.** A model picker on the source screen ("Muse Spark 1.3 — Meta API" / "Muse Spark Open — open weights, hosted on Modal"); every job, receipt and repair card shows which model produced it.
6. **Evaluation.** `scripts/evaluation-run.ts --model muse-spark-open` with output to `docs/evidence/open-weights/evaluation/`; the manifest and expectations are the pre-registered ones (unchanged); a comparison report puts both runs side by side (decisions, checks passed first time, repairs, cost, latency).

## Waves (serial, one owner per path)
| Wave | Owner (route) | Paths |
|---|---|---|
| OW-1 | Muse via Opus orchestrator (subscription bridge) | `packages/meta/**` (client provider config, pricing, usage parser, ledger provider tag + per-provider cap, tests) |
| OW-2 | Qwen 3.8 Max | `workers/**`, `apps/api/**`, `config/resource-limits.json`, `scripts/evaluation-*.ts`, run script |
| OW-3 | Sonnet 5.5 | `apps/web/**` |
| OW-4 | Lead | live smoke per engine on Modal, then the 29-page evaluation on Muse Spark Open, comparison report |

Prerequisite: Stage 5b review fixes (S5B-17..20) land first; OW-1 starts after the current validation wave.

## Later (stretch)
- **Baseten USD 100:** candidates — (a) Muse Glimmer 30B small-model stress test on a dedicated deployment (does check+repair make a small open model usable? likely our richest source of natural repairs), or (b) a second host for portability. Needs `BASETEN_API_KEY` in the profile `.env`.
