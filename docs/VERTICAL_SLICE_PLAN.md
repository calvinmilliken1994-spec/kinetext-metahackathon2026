# Stage 2 plan — first functional vertical slice

Status: **approved 2026-10-27** — run all tasks in order, serially, via built-in Hermes subagents (`AGENT_ROLES.md`). Stage 2 Meta credit cap **USD 10**. Contracts: `ARCHITECTURE.md` v0.2. Supersedes `TASKS.md` T1–T3 (T1 is now done: credits confirmed, API smoke passed).

## Target flow and exit criterion
Licensed source text → Muse Spark 1.3 analysis → structured forces activity spec → deterministic validation report → interactive React simulation (student changes mass and force, sees correct acceleration and motion).

Exit: one real licensed source produces a working, validated activity through an observable pipeline, run live against the Meta API, with receipts in the ledger.

## Tasks (serial by default; parallel only with your approval after TASK-001)
| ID | Task | Owner / route | Owned paths | Depends | Acceptance |
|---|---|---|---|---|---|
| TASK-001 | Freeze contracts v0.2: schema, TS types, fixtures, tooling (TypeScript, `tsc --noEmit`, npm workspaces) | Opus 5.5 | `schemas/`, `packages/contracts/`, root manifests, `tests/fixtures/` | — | v0.1 tests migrated; new schema accepts fixture, rejects ≥ 10 unsafe/ungrounded mutations; `npm run check` green |
| TASK-007 | Licensed sources: NASA Glenn *Equations of Motion* (supported) and *Speed of Sound* (deliberately unsupported). OpenStax was rejected: CC BY-NC-SA and an explicit no-LLM-ingestion clause | Opus 5.5 | `data/sources/`, `packages/sources/`, `docs/REFERENCES.md` | — | Text + sha256 + attribution; hash-checked loader; license basis recorded |
| TASK-002 | forces-1d engine | Qwen 3.8 Max | `packages/activities/forces-1d/` | 001 | Closed-form `simulate`; tests for zero/negative force, tiny mass bounds, frame count, finite values, determinism |
| TASK-003 | Validation engine (checks 1–6 in `ARCHITECTURE.md`) | Qwen 3.8 Max | `packages/validation/` | 001, 002 | One failing fixture per check proves each check can fail; valid fixture passes |
| TASK-004 | Meta client + ledger + prompts + `analyzeSource` / `generateSpec` | Muse Spark 1.3 via Muse Code subscription | `packages/meta/` | 001 | Unit tests with a fake transport (budget refusal, timeout, 429 retry once, 400 no retry, schema-invalid output rejected); **one live run** on the TASK-007 source with receipt; GPT-6.1 Sol review |
| TASK-005 | Generation worker + HTTP API | Qwen 3.8 Max | `workers/generation/`, `apps/api/` | 003, 004 | Stage events persisted; unsupported-source path; API tests with fake Meta transport |
| TASK-006 | Web UI: source panel, live stage timeline, simulation (SVG cart, mass/force sliders, play/reset, v–t graph, predict-then-run), validation panel | Sonnet 5.5 | `apps/web/` | 001 (fixtures); 005 for live data | Browser-verified journey; keyboard-operable sliders; values match engine |
| TASK-008 | Integration + live e2e run + evidence | Opus 5.5; e2e checks by DeepSeek v4.1 Flash 1017 | `tests/e2e/`, `docs/evidence/` | 005, 006 | Live run receipt, report `publishable: true`, screenshot; ledger reconciled |
| TASK-009 | Independent review of Stage 2 | GPT-6.1 Sol (read-only) | — | 008 | Findings addressed or logged as issues |
| TASK-010 | Docs + Obsidian journal updates | Qwen 3.8 Flash, lead-reviewed | `docs/`, `obsidian-vault/` | each task | No unsupported claims |

Out of scope for Stage 2: PDF parsing, repair loop (Stage 5), teacher editing (Stage 6), SAM/Image (Stage 7), deployment.

Route constraint for TASK-004: the Muse Code subscription bridge (`scripts/muse-subscription.py`) is prompt-in/text-out — one model step, 90 s deadline, no file writes. Muse therefore authors `packages/meta/` module by module from the frozen contracts; the lead applies the code, runs the tests, and records each authored file in `META_CONTRIBUTIONS.md`. The runtime calls inside the product use the Model API (participant credits), a separate route.

## Budget for Stage 2 (Meta Model API, participant credits)
Building, including all unit and contract tests, uses subscriptions only and costs no credits. Credits are spent only by live product runs: the TASK-004 spike, the TASK-008 live end-to-end check and demo rehearsals.
Estimated per live pipeline run (analysis + spec, Spark Standard): ~8k input + ~5k output tokens incl. reasoning ≈ USD 0.03. Approved Stage 2 cap: **USD 10** inside the USD 150 total, enforced by the ledger. Engineering via the Muse Code subscription is not charged to the credits.

## Risks
| ID | Risk | Mitigation |
|---|---|---|
| RISK-001 | Constrained decoding may not support every JSON Schema keyword used by the spec schema | Spike in TASK-004 with the real schema; fall back to a simplified generation schema + full Ajv validation locally (no provider fallback) |
| RISK-002 | Delegated routes (Qwen, DeepSeek, Muse CLI) produce code that does not match contracts | Contracts + tests frozen first; lead verifies every claim by running tests |
| RISK-003 | Demo reads as a chatbot (anti-project) | No chat UI; artifact, live pipeline and validation are the product |
| RISK-004 | New-work-only rule | Provenance doc and commit log separate setup scaffold from event work |
| RISK-005 | Free-credit content may be used by Meta | Only licensed public/synthetic sources |

## Status (2026-10-27) — Stage 2 complete

- **All ten tasks DONE** (TASK-001…TASK-010), per the table above and `docs/REPOSITORY_LOG.md`; `main` HEAD `1ea0c7c`.
- **TASK-009 outcome:** three independent review rounds — GPT-6.1 Sol (`docs/reviews/stage-2-independent-review.md`, 13 findings R-01…R-13; `docs/reviews/stage-2-re-review.md`, N-01…N-07), then GPT-6 Astra (`docs/reviews/stage-2-final-review.md`, one blocker F-01) whose addendum verdicts **APPROVED WITH CONDITIONS** at `78e3745`: supervised, loopback-only live demos under the USD 10 Stage 2 cap; every ledger writer must use `ledgerLockPort` 47853 (`config/resource-limits.json`) and the same ledger; explanation prose needs teacher review. Fix decisions in `docs/specs/TASK-009-review-fixes.md`; accepted debt DEBT-001…003 logged in the vault Issue Register.
- **Tests:** `npm run check` **330/330** pass (re-run by the lead during TASK-010 at HEAD `1ea0c7c`); web production build passes (final review evidence).
- **Meta spend:** product runtime calls on participant credits ≈ **USD 0.132 of the USD 10 cap** (`docs/PROVIDER_USAGE.md`; enforced by the storage ledger). Engineering via the Muse Code subscription is not charged to credits (`docs/META_CONTRIBUTIONS.md`).
- The exit criterion was met live: NASA *Equations of Motion* → Muse analysis → spec → validation → interactive simulation, started from the web UI — 13/13 checks at run time (`docs/evidence/task-008/`); today the hardened validator runs 14 spec checks and the committed evidence re-validates in `npm run check`.
