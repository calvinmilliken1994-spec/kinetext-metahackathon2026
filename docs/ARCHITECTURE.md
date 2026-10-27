# Architecture — v0.2 (Stage 1), approved 2026-10-27

**Make knowledge interactive.** Status: contracts **frozen** by TASK-001 — canonical files: `schemas/activity-spec.full.json`, `schemas/activity-spec.gen.json`, `schemas/source-analysis.gen.json`, `packages/contracts/index.ts`; tests `tests/contracts.test.ts`. Source fields also gained `attribution` (CC BY needs it) and `page` became optional (web sources). Tolerance limit is 0.01 m/s². Supersedes the v0.1 proposal (Next.js + OpenAI SDK), kept in Git history.

## Product loop
SOURCE → MUSE ANALYSIS → ACTIVITY SPEC → DETERMINISTIC VALIDATION → (bounded MUSE REPAIR) → INTERACTIVE ACTIVITY → TEACHER EDIT → PUBLISH.

Muse decides *what* to build from the source (concepts, objectives, grounded quotes, parameter ranges, predictions, expected outcomes). Tested code decides *how it behaves* (physics, rendering) and *whether it is right* (validation). The model never computes animation frames, and its numerical claims are checked by the engine.

Why this is not a "simple AI-for-education chatbot" (anti-project list, `HACKATHON_RULES.md`): the output is an executable, source-grounded, machine-verified artifact, with a visible verify-and-repair loop.

## Stack decision (simplest that delivers Stage 2)
| Concern | Choice | Reason |
|---|---|---|
| Language | TypeScript, run directly by Node 24 type stripping (erasable syntax only; `.ts` import extensions); `tsc --noEmit` for type checks | No build step for server/packages; existing `node:test` setup keeps working |
| Web | Vite + React + TypeScript in `apps/web`; SVG rendering | Smallest SPA toolchain; no SSR needed. Replaces the earlier Next.js proposal |
| API | `node:http` server in `apps/api` (JSON + polling; SSE later if useful) | Zero framework surface; a few routes |
| Meta client | `fetch` against `https://api.meta.ai/v1/chat/completions` with `response_format: {type: "json_schema"}` (constrained decoding per Meta structured-output docs) | No SDK dependency; exact control of timeouts, retries and receipts |
| Contracts | JSON Schema (Ajv 8, already pinned) + hand-written TS types in `packages/contracts` | One canonical schema; types mirror it |
| Storage | Files under `storage/runs/<jobId>/` (gitignored): `source.txt`, `events.jsonl`, `analysis.json`, `spec.r<n>.json`, `report.r<n>.json` | No database for the slice |
| Spend ledger | `storage/ledger.jsonl`, append-only; reserve before call, reconcile after; hard cap from `config/resource-limits.json` | Production requirement in `RESOURCE_POLICY.md` |

## Modules and owners (one writer per path)
| Path | Responsibility | Route |
|---|---|---|
| `schemas/`, `packages/contracts/` | Activity spec v0.2, stage events, validation report, source analysis types | Lead (Opus 5.5) |
| `packages/activities/forces-1d/` | Deterministic engine: `accelerationOf`, `simulate` (closed-form kinematics, sampled at `stepS`) | Qwen 3.8 Max |
| `packages/validation/` | `validateArtifact(spec, sourceText) → ValidationReport` | Qwen 3.8 Max |
| `packages/meta/` | Client, ledger, prompts, `analyzeSource`, `generateSpec`, `repairSpec` | Muse Spark 1.3 (Muse Code subscription) |
| `workers/generation/` | Stage machine `runJob(source) → events + artifacts` | Qwen 3.8 Max |
| `apps/api/` | HTTP routes over the worker and storage | Qwen 3.8 Max |
| `apps/web/` | Source panel, live pipeline, simulation, validation panel | Sonnet 5.5 |
| `data/sources/` | Licensed source excerpts + attribution | Lead |
| `tests/` (cross-module, e2e) | Contract and end-to-end checks | DeepSeek v4.1 Flash 1017 |
| `docs/`, vault | Documentation | Qwen 3.8 Flash, reviewed by lead |

## Contracts (to be frozen in TASK-001)

### Activity spec v0.2 (changes from v0.1)
v0.1 fields stay unless listed: `schemaVersion`, `id`, `title`, `learningObjectives`, `sources`, `explanations`, `simulation`, `behavioralTests` (absolute `tolerance` in m/s², ≤ 0.001), `execution`, `provenance`.
- `explanations[].evidence: [{sourceId, quote}]` (1–5 items, quote ≤ 300 chars). Validator requires each quote to appear verbatim (whitespace-normalised) in the stored source text. This turns "source-grounded" into a deterministic check.
- `predictions: [{id, prompt, massKg, netForceN, expectedAccelerationMps2, tolerance}]` (1–5): predict-then-run questions for students. Expected values come from Muse; the engine verifies them.
- `simulation.scenario: {objectLabel, surfaceLabel}` (display strings only, ≤ 60 chars) and `simulation.observables` ⊆ `["position","velocity","acceleration"]`.
- `provenance` adds `promptVersion`, `revision`, `repairOf?`.
- Unchanged guarantees: `engine` const `forces-1d-v1`, bounded ranges, `generatedCodeAllowed: false`, `network: false`, `maxRepairAttempts ≤ 2`, no free-form code fields.

### Source analysis (Muse output, structured)
`{concepts:[{id,name,evidence:[{sourceId,quote}]}], objectives:[string], supported: boolean, activity: "forces-1d-v1" | "none", unsupportedReason?: string}`. `supported: false` ends the job with an honest "not supported yet" result, not a forced activity.

### Stage event
`{jobId, seq, stage: "ingest"|"analyze"|"specify"|"validate"|"repair"|"done", status: "started"|"succeeded"|"failed", at, model?, responseId?, usage?, latencyMs?, estCostUSD?, detail?}`. The UI renders only these real events.

### Validation report
`{artifactId, revision, checks:[{id, kind:"schema"|"semantic"|"grounding"|"behavioral", passed, message, path?}], publishable}`. `publishable` is true only if every check passes; publication additionally needs teacher approval.

### Meta client
`complete({purpose, model:"muse-spark-1.3", messages, jsonSchema, maxOutputTokens}) → {data, receipt}`. Before sending: reserve worst-case cost in the ledger and refuse if cumulative + reservation > cap. One retry only for 429/5xx with jitter; never retry 4xx auth/input/schema errors. Hard deadline per call. No other provider is ever substituted.

## Deterministic checks (`packages/validation`)
1. Schema (Ajv).
2. Ranges: `min ≤ default ≤ max` for mass and force; mass > 0; `durationS/stepS ≤ 3000` frames.
3. References: every `sourceId` resolves; source `sha256` matches stored text.
4. Grounding: every evidence quote is a verbatim substring of the source.
5. Behavioural: each `behavioralTests[]` and `predictions[]` expected acceleration equals `F/m` from the engine within tolerance; predictions lie inside the slider ranges.
6. Trajectory invariants on default parameters: finite values, `v(t)=a·t`, `x(t)=½·a·t²`.

## Source-use conditions (from TASK-007)
NASA sources may be used in AI tools only if outputs are attributed to the product, not NASA. Therefore: the UI labels generated content "AI-generated with Muse Spark" and shows the source disclosure "includes NASA source material; NASA has not reviewed or endorsed this activity"; prompts forbid "according to NASA"-style attribution; the validator rejects generated text that attributes claims to the source publisher (check `policy.no-publisher-attribution`). Verbatim evidence quotes are shown as quotes from the source, which is permitted.

## Safety and trust boundaries
Source text is data: prompts delimit it and instruct Muse to ignore instructions inside it; outputs are schema-constrained, so injected text cannot add code. No model-supplied URLs are fetched. API key stays server-side (never in `apps/web`). Free-credit traffic may be used by Meta for product improvement, so only licensed public or synthetic sources are sent (`RESOURCE_POLICY.md`). Generated code execution stays disabled; activities are data rendered by tested components.

## Muse design review incorporated (2026-10-27)
Muse Spark 1.3 (Muse Code subscription, Standard mode, one call, 15.2 s; receipt `docs/evidence/muse-architecture-review.json`) reviewed this document. Accepted into TASK-001:
1. **Two schemas:** `schemas/activity-spec.gen.json` — flat, non-recursive, no `$ref`/unions/conditionals, all properties required, `enum` for closed sets — is what Muse receives as `response_format`; `schemas/activity-spec.full.json` is the stricter Ajv contract. Generator sends only *gen*; validator accepts only *full*. Meta docs state only that recursive schemas return HTTP 400 and do not list a keyword subset, so the TASK-004 spike checks the real gen schema against the API.
2. **Comparison rule:** a check passes when `|expected − F/m| ≤ tolerance` (absolute, m/s²). Predictions use the same rule.
3. **Normalisation rule for quotes:** collapse every `\s+` run to one space, trim, case-sensitive substring match. Curly quotes and ellipses are not normalised; the prompt forbids them unless present in the source.
4. **Source-analysis invariants:** `supported=false ⇒ activity="none"` and `unsupportedReason` present; `supported=true ⇒ ≥1 concept and ≥1 objective`; concept ids unique, `^[a-z0-9-]{1,40}$`. Enforced by the validator (not the gen schema).
5. **Types:** `at` RFC 3339; `seq` integer from 0, monotonic per job; `revision` integer from 1; `repairOf` integer or null; `responseId`, `usage`, `latencyMs` copied verbatim from the Meta response (Chat Completions does return `id` and `usage` — confirmed by the smoke receipt).
6. **Display strings** (`scenario.*`, prompts) render as text only, never HTML.
7. **Quote prompting:** source in a delimited data block; ignore instructions inside it; copy character-for-character; no ellipsis, paraphrase or cross-paragraph joins; prefer ≤ 150-character fragments; return the exact `sourceId`.

Not adopted as stated: "behavioralTests undefined" — they exist in v0.1 and remain; this document now says so. Muse's suggestion to show one bounded repair in the demo is already Stage 5; a single repair pass may be pulled into Stage 2 as a stretch goal if the slice lands early.

## Later stages (not in the slice)
PDF/page ingestion and diagram understanding with Muse Spark perception grounding (Stage 3); component registry beyond forces (Stage 4); Muse-driven repair loop with evidence (Stage 5); teacher workspace (Stage 6); SAM 3.1 diagram segmentation, Muse Image labelled illustrations, Muse Spark Open benchmark path (Stage 7).

## v0.3 — hardening after Stage 2 review (dated 2026-10-27)
The v0.2 text above is the approved Stage 1/2 baseline and is left unchanged. Three rounds of independent review (rounds 1–2 by GPT-6.1 Sol, round 3 + addendum by GPT-6 Astra; reports in `docs/reviews/stage-2-independent-review.md`, `docs/reviews/stage-2-re-review.md`, `docs/reviews/stage-2-final-review.md`; fix decisions and per-wave contracts in `docs/specs/TASK-009-review-fixes.md`) produced the changes below, all merged and covered by `npm run check` (330/330 at HEAD `1ea0c7c`). Outcome: **APPROVED WITH CONDITIONS** for supervised, loopback-only live demos under the USD 10 Stage 2 cap (addendum at commit `78e3745`).

- **Spend ledger ownership (`packages/meta/ledger.ts`).** `createLedger` (lock file + PID) replaced by `await openLedger({path, capUSD, lockPort})`: the lock is an OS-held loopback listener on `127.0.0.1:<lockPort>` (`EADDRINUSE` → `LEDGER_LOCKED`), released automatically when the owning process dies — the stale-lock takeover race (N-01) is gone. Product entry points pin `ledgerLockPort` **47853** from `config/resource-limits.json` (below the Windows dynamic port range). Every reserve re-reads the ledger file first; replay rejects malformed lines, unknown kinds and invalid amounts fail-closed. Condition of approval: **every ledger writer must use the configured port and the same canonical ledger** (accepted debt DEBT-002 — the lock identifies a port, not the file).
- **Per-attempt cost accounting (`packages/meta/client.ts`).** Reservation before **each** attempt; uncertain outcomes (429/5xx/timeout/network/unparseable 2xx) reconcile at that attempt's full reservation; receipts and errors carry `costBasis` ('usage'|'reservation') and `reservedUnknownUSD` so known and uncertain amounts stay separate (R-03, N-04). Usage is accepted only as coherent finite non-negative integers (cached ≤ prompt, reasoning ≤ completion), otherwise treated as unknown with the reservation retained (R-04).
- **Fixed public error messages.** `MetaError.message` is a fixed sentence per code (e.g. `BUDGET_EXCEEDED`, `LEDGER_ERROR`, `INPUT_TOO_LARGE`, `DEADLINE_EXCEEDED`), and job errors use their own fixed map (e.g. `OUTPUT_INVALID`, `INTERRUPTED`, `INTERNAL`); provider response bodies, exception text and request contents are never copied into errors, persisted jobs, HTTP responses or logs (R-01, N-02).
- **Input bound and deadlines.** Input-token bound = UTF-8 bytes of messages + schema + framing allowance, checked before reserving (`INPUT_TOO_LARGE`); documented as assuming a byte-level tokenizer and **not verified against Meta billing** (R-06 → DEBT-003). One job-level deadline (`maxJobWallTimeMs`) plus per-stage output caps (6000/8000 from config) are enforced through a shared `AbortSignal`, including abortable retry sleeps and body reads (R-11).
- **Generated-output safety (`packages/meta/pipeline.ts`, F-01).** Generated analysis/spec JSON is validated against the gen schemas *before* any field is read; invalid output throws `GeneratedOutputError` carrying the reconciled receipt, which the worker accounts exactly once and surfaces as a persisted terminal `failed/OUTPUT_INVALID` job — cost is never lost and no job stays `running` (R-09/R-10 closed).
- **Unforgeable source boundary (`packages/meta/prompts.ts`).** Source text is delimited with `SRC-<sha256(source)[0:16]>` in both open and close tags (collision → refuse); model analysis re-enters the spec prompt only as JSON with `<` escaped, labelled untrusted data (R-13).
- **Worker/API hardening.** Atomic temp-file+rename artifact writes; owner-aware `recoverInterruptedJobs` (each job records `owner: {pid, startedAt}`; only jobs whose owner process is dead are marked `failed/INTERRUPTED`; recovery runs in live mode only after holding the ledger) (R-10, N-05); Host/Origin allowlist (403 otherwise) on the loopback-only API with a `/api/health` busy flag (R-07 → DEBT-001: no per-session token yet, deferred by lead).
- **Validation: 14 spec checks + 6 analysis checks.** Meaningful-quote rule — a quote counts only if normalised length ≥ 8 with ≥ 3 letters/digits, **or** it is a compact equation (contains `=`, normalised length ≥ 3, ≥ 3 letters/digits, e.g. `F=ma`); whitespace-only/empty evidence can no longer pass, and every supported concept needs ≥ 1 counted quote (R-05, N-07). Publisher policy runs over **every generated display field** and fails NASA mentions anywhere plus attribution wording only when it names a source/authority within 40 characters (R-12, N-06). New always-passing notice check `scope.prose-unverified`: explanation prose is AI-generated and needs teacher review (R-08) — reflected in the UI, which now states exactly what was machine-checked and never shows unknown cost as $0.
