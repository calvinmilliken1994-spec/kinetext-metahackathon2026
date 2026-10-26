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
