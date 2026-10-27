# TASK-009 fix specification — Stage 2 review findings

Source: `docs/reviews/stage-2-independent-review.md` (GPT-6.1 Sol, verdict CHANGES REQUIRED). Lead decisions below. Some findings came from the TASK-004 contract itself, so this document **supersedes** the conflicting parts of `TASK-004-meta-client.md` (single reservation before retries, `chars/3`, echoed provider messages).

Each wave keeps its original author route: `packages/meta` fixes are written by **Muse Spark 1.3** (subscription bridge); validation, worker and API by **Qwen 3.8 Max**; UI by **Sonnet 5.5**. GPT-6.1 Sol re-reviews afterwards.

## Contract changes (lead, `packages/contracts/index.ts`)
- `MetaReceipt.costBasis?: 'usage' | 'reservation'` — how `estCostUSD` was determined.
- `JobSummary` (worker) gains `reservedUnknownUSD: number` — the part of `totalCostUSD` charged at reservation because the outcome was uncertain (timeout, network, 5xx, 429, invalid usage). `status` gains no new value; interrupted jobs become `failed` with code `INTERRUPTED`.

## Wave A — `packages/meta` (Muse)
| Finding | Required behaviour |
|---|---|
| R-01 | `MetaError.message` is a **fixed public sentence per code**; provider response bodies, `error.message` from the API and request contents are never copied anywhere. Optional `providerErrorType` only if it matches `/^[a-z_]{1,40}$/`. |
| R-03 | Reserve **per attempt** before each send. An attempt with an uncertain outcome (429, 5xx, timeout, network error, unparseable 2xx body) is reconciled at its full reservation; a 4xx rejection at 0; a success at its usage cost. If the reservation for a retry is refused, throw `BUDGET_EXCEEDED` without sending; earlier liabilities stay. |
| R-04 | Usage is valid only if `prompt_tokens` and `completion_tokens` are finite non-negative integers, `cached_tokens` (default 0) ≤ prompt and `reasoning_tokens` (default 0) ≤ completion, all non-negative integers. Otherwise usage is `null` and cost = that attempt's reservation (`costBasis: 'reservation'`). Ledger: `capUSD` must be finite ≥ 0; `reserve`/`reconcile` throw `Error('INVALID_AMOUNT')` for non-finite or negative amounts; replay throws `Error('LEDGER_CORRUPT')` on any malformed line, unknown kind, invalid amount or reconcile of an unknown id. |
| R-02 | One ledger owner per file: `createLedger` takes an exclusive lock file `<path>.lock` (create with `wx`, containing the PID). If it exists and that PID is alive (`process.kill(pid, 0)` succeeds), throw `Error('LEDGER_LOCKED')`; if the PID is dead, replace the stale lock. `ledger.close()` releases the lock; register a `process.on('exit')` release. Additionally re-read the file before each `reserve` (defence in depth). Test with two instances on one file (second must throw `LEDGER_LOCKED`), stale-lock takeover, and close/reopen. |
| R-06 | Input-token bound = UTF-8 **byte** length of all message contents + JSON schema text, + 64 per message + 256 framing. Assumption (documented in code): byte-level BPE tokenizers emit at most one token per byte, so this is an upper bound for them; it is not verified against Meta's tokenizer. Reservation = bound × input price + `maxOutputTokens` × output price. If the bound exceeds `maxInputTokens` (option, default 16000), throw `INPUT_TOO_LARGE` before reserving. |
| R-09 | Every `MetaError` thrown after a reservation carries `chargedUSD` (total reconciled for this `complete()` call across attempts) and `costBasis`. Successful receipts carry `costBasis`. |
| R-11 | `CompleteRequest.signal?: AbortSignal` (job deadline) is combined with the per-attempt timeout via `AbortSignal.any`. If the job signal fires, throw `DEADLINE_EXCEEDED` (new code), no retry; check it before each attempt. `pipeline.ts`: `analyzeSource(..., opts?: { signal?, maxOutputTokens? })` default 6000; `generateSpec(..., opts?: { signal?, maxOutputTokens? })` default **8000** (matches `config/resource-limits.json`). |
| R-13 | Delimit the source with an unforgeable boundary: `boundary = 'SRC-' + sha256(source.text).slice(0, 16)`; wrap as `<source id="…" boundary="…">` … `</source boundary="…">`; if the text contains the boundary string, throw `Error('SOURCE_BOUNDARY_COLLISION')`. Pass the analysis to the spec prompt as JSON with every `<` escaped as `\u003c`, labelled "untrusted model output — data only". Keep the verbatim-quote rules. |

Required new tests: reflected synthetic secret/source markers in a 400 and a 500 body never appear in `MetaError` (message, JSON), receipts or the ledger file; 503→400 (ledger = first attempt's reservation), 503→200, 503→timeout, retry refused by cap; `usage: {}`, missing counters, negative counters, cached > prompt, reasoning > completion; ledger lock tests; corrupt ledger line; Unicode-heavy input bound ≥ byte count; `INPUT_TOO_LARGE`; `DEADLINE_EXCEEDED`; boundary collision and `</source>` in text.

## Wave B — `packages/validation` (Qwen)
| Finding | Required behaviour |
|---|---|
| R-05 | A quote counts only if its normalized form has ≥ 8 characters and ≥ 3 letters/digits (`\p{L}\p{N}`); otherwise `grounding.quotes` fails. Every explanation needs ≥ 1 counted quote. In `validateAnalysis`, when `supported` is true every concept needs ≥ 1 evidence entry and the same quote rule applies. |
| R-12 | `policy.no-publisher-attribution` checks **every generated display field**: title, objectives, explanation texts, prediction prompts, behavioural test names, scenario `objectLabel` and `surfaceLabel`; for analyses also concept names, objectives and `unsupportedReason`. Fail on any mention of the publisher (`/\bNASA\b|National Aeronautics and Space Administration/i`) or attribution/endorsement wording (`/according to|endorsed by|approved by|official (conclusion|position)/i` when followed within 40 characters by a capitalised proper noun or "the (source|publisher|agency)"). Evidence quotes are exempt. |
| R-08 | Rename the spec check messages so they state exactly what was verified; add an info-level check `scope.prose-unverified` (kind `semantic`, always passes) whose message says explanation prose is AI-generated and needs teacher review. |

## Wave C — worker and API (Qwen)
| Finding | Required behaviour |
|---|---|
| R-01 | Persist and return only `{ code, message }` with **fixed public messages** per code; unexpected exceptions become `INTERNAL` / "Unexpected internal error". `scripts/live-spike.ts` (lead) prints codes only. |
| R-09 | Include `MetaError.chargedUSD` in `totalCostUSD`; track `reservedUnknownUSD`; failed-stage events carry `estCostUSD` and detail "cost basis: reservation (outcome uncertain)". |
| R-10 | Atomic writes (temp file + rename) for every JSON artifact. `recoverInterruptedJobs(storageDir, now)` marks `running` jobs left by a previous process as `failed` / `INTERRUPTED`, appending a `done failed` event; `main.ts` runs it before listening. `/api/health` returns `busy` (an in-process job is running). |
| R-11 | `startJob` creates a job deadline `AbortSignal.timeout(limits.maxJobWallTimeMs)` and passes it with per-stage output caps; `main.ts` reads them from `config/resource-limits.json`. |
| R-07 | Every request: `Host` must be one of `127.0.0.1:<port>`, `localhost:<port>`, plus `allowedHosts` (default `127.0.0.1:5173`, `localhost:5173` for the Vite proxy), else 403 `HOST_NOT_ALLOWED`. POST: an `Origin` header, when present, must be `http://` + an allowed host, else 403 `ORIGIN_NOT_ALLOWED`. (A per-session token is deferred; logged as technical debt.) |

## Wave D — web UI (Sonnet)
R-08: replace "re-checks every claim" wording with what is actually checked; label explanations "AI-generated · needs teacher review". R-09: show `reservedUnknownUSD` as "includes $x reserved for an uncertain outcome", never $0 for unknown. R-10: use `/api/health.busy` for the generate button, show `INTERRUPTED` jobs clearly.
