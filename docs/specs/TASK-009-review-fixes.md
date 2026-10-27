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

---

# Round 2 — after the re-review (`docs/reviews/stage-2-re-review.md`)

Re-review verdict: CHANGES REQUIRED. Resolved: R-01, R-03, R-04, R-05, R-08, R-12, R-13. Accepted as debt (documented): **R-06** (UTF-8 byte bound assumes a byte-level tokenizer; not verified against Meta billing) and **R-07** (Host/Origin allowlist in place; a per-session token is deferred). Lead decisions for the rest:

## Contract change (lead)
`MetaReceipt.reservedUnknownUSD?: number` — the part of `estCostUSD` charged at a reservation because an attempt's outcome was uncertain (0 when every attempt had valid usage or was a 4xx).

## Wave A2 — `packages/meta` (Muse)
| Finding | Required behaviour |
|---|---|
| N-01 (High), R-02 | Replace the lock file with an **operating-system-backed lock** that is released automatically when the process dies, so stale locks cannot exist: `export async function openLedger(opts: { path; capUSD; now?; newId?; lockPort?: number }): Promise<Ledger>` first listens with `node:net` on `127.0.0.1:<lockPort>`, where `lockPort` defaults to `49152 + (first 4 bytes of sha256(resolved absolute ledger path)) % 16000`. `EADDRINUSE` → throw `Error('LEDGER_LOCKED')`. The listening server is the lock; `ledger.close()` closes it (and `unref()` it so it never keeps the process alive). Remove the PID lock file and stale-takeover code. Keep the re-read before each reserve. `createLedger` is removed (all callers move to `await openLedger`). Tests: two `openLedger` calls on one path → second rejects `LEDGER_LOCKED`; **two child processes** started at the same moment against one path → exactly one acquires; after the owner exits (killed), a new owner acquires immediately; close/reopen. |
| N-02 | Only a genuine cap refusal maps to `BUDGET_EXCEEDED`. Any other ledger failure during reserve or reconcile → new code `LEDGER_ERROR` (fixed public message), no request sent if it happened at reserve time. |
| N-03 | Every failure after a reservation carries `chargedUSD`. Validate the response envelope: a 2xx body that is not an object, or whose `choices[0]` is not an object, is an uncertain outcome (reconcile at reservation). If `reconcile` itself throws, throw `LEDGER_ERROR` with `chargedUSD` = the reservation (conservative). |
| N-04 | Track known and uncertain amounts separately per attempt: receipts and `MetaError` carry `reservedUnknownUSD` (sum of attempt amounts charged at reservation); `costBasis` is `'reservation'` if that sum > 0, else `'usage'`. 503→200 must report reservedUnknownUSD = the 503 attempt's reservation only. |
| R-11 | The retry sleep must abort immediately when the job signal fires (`DEADLINE_EXCEEDED`, no second attempt). |

## Wave B2/C2 — validation, worker, API (Qwen)
| Finding | Required behaviour |
|---|---|
| N-06 | Publisher policy: `/\bNASA\b|National Aeronautics and Space Administration/i` still fails anywhere in generated fields. Attribution wording fails only when it names a source or authority: `according to|endorsed by|approved by|official (conclusion|position) of` followed within 40 characters by a word starting with a capital letter, or by `the (source|publisher|agency|author|text)`. Benign prose such as "accelerates according to the net force divided by its mass" passes. Add benign and malicious examples. |
| N-07 | A quote counts if (a) normalized length ≥ 8 with ≥ 3 letters/digits, **or** (b) it is a compact equation: contains `=`, normalized length ≥ 3, ≥ 3 letters/digits (e.g. `F=ma`). Whitespace-only and short non-equation quotes still fail. |
| N-05 | Each job records `owner: { pid, startedAt }` in job.json. `recoverInterruptedJobs` marks a `running` job INTERRUPTED only if its owner PID is not alive (`process.kill(pid, 0)` throws `ESRCH`; `EPERM` counts as alive) or the owner field is missing **and** the job is older than `maxJobWallTimeMs`. `main.ts` runs recovery only after it holds the ledger (live mode); offline servers never mutate jobs. |
| N-04 (worker) | Use `receipt.reservedUnknownUSD` / `MetaError.reservedUnknownUSD` for `JobSummary.reservedUnknownUSD` instead of inferring from `costBasis`. |
| R-11 (api) | `main.ts` passes `maxInputTokens` from `config/resource-limits.json` to `createMetaClient` and uses `await openLedger(...)`; closes the ledger on SIGINT/SIGTERM. |

Lead: `scripts/live-spike.ts` moves to `openLedger`, uses the configured job deadline and input cap.

