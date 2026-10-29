# Stage 5b independent review

**Verdict: CHANGES REQUIRED.**

- **Reviewed HEAD:** `682bebcc58e37210f0c2517780cbd35d393556c8`.
- **Reviewer:** OpenAI `gpt-6-astra` via `openai-codex`, independent of the implementation authors.
- **Baseline:** `8048d52928fef69ea4e12d1f6ea4ffe3d54a8319`, approved with conditions in `stage-5-review.md`, Addendum 2.
- **Scope:** the three new formula engines and views; timeline contracts, validation, repair, worker/API and UI; analysis repair; BUG-002/BUG-003; resource limits; both evaluation batches and their claims.

**The integrated Stage 5b pipeline is not approved as a demonstration of deterministically grounded dates or non-weakening repair at this HEAD.** An event can pass every date check with a date the quoted sentence never states. A model-controlled label in a different event can also authorize rewriting a clean event, and the real worker publishes that repair. Analysis preservation is enforced at whole-array/group granularity rather than at the finding's actual field. These are reproduced deterministic failures, not predictions about how often Muse will exploit them.

The formula implementations and ordinary metered transport paths are substantially sound. The USD 50 cumulative ledger gate remains in place under its existing accounting assumptions; this review did **not** reproduce an unconditional breach of that cap. There are separate job-accounting and evaluation-driver budget defects below. Here “published” means a successful worker preview with `publishedRevision`, not external publication.

## Executed verification

| Gate | Actual result |
|---|---|
| `npm run check` | Exit 0; TypeScript passed; **889 tests passed**, 0 failed/cancelled/skipped. |
| `npm --prefix apps/web run build -- --outDir <review-scratch>/web-dist` | Exit 0; frontend TypeScript and Vite passed; **78 modules transformed**. Output was redirected to scratch, not the repository. Vite's outside-root output-directory warning was expected. |
| `node scripts/build-schemas.ts --check` | Exit 0; `schemas up to date`. |
| Independent Node probes | Five probe scripts completed: date/repair/analysis/demo probes, real-client cost probes, UI/error probes, an end-to-end worker bypass, and stored-evidence replay. Synthetic responses only; no new model inference. |
| Stored evaluation audit | Read **42 distinct stored jobs**: 29 original evaluation jobs and 13 hard-page follow-up jobs. Revalidated **18 spec revisions across 16 jobs**, with source hashes/quotes and immutable-r1 comparison for repairs. Results-row summaries agree with their corresponding jobs; deduplicated event-receipt costs agree with all job totals within rounding. |

Evidence is in the active profile's `cache/scratch/review-5b/`: `probes.mjs`, `probe-results.json`, `probes.log`, `cost-probes.mjs`, `cost-results.json`, `extra-probes.mjs`, `extra-results.json`, `end-to-end.mjs`, `end-to-end-results.json`, `evidence.mjs`, `evidence-results.json`, `check.log`, `build.log`, and scratch job/ledger directories. The provider transport in cost probes is injected; its URL is never fetched. Only scratch ledger listeners bind loopback. Scripts exited and released their listeners.

## Findings

### S5B-01 — High: date components are a bag of tokens, not a stated date

**Location:** `packages/validation/timeline.ts:178-195,328-339`.

`dayInUnit`, `monthInUnit` and `standaloneYears` independently search the same unit. Sharing a sentence does not establish that the day belongs to the month, or that a number is a day at all.

**Evidence:** `probe-results.json`:

- `day-count-as-date`: source/quote `The office opened on March 3, 1889 with 4 delegates present.`; claimed event date **March 4, 1889**; full `validateSpec` returns `publishable:true`, no failed checks.
- `cross-month-day`: source/quote `The office opened on March 3, 1889 and moved on July 4, 1889.`; claimed date **March 4, 1889**; again publishable with every check passing.

These are not merely the documented label-entailment gap: the claimed date itself is absent. The plan specifically required a `4 delegates` negative case (`STAGE-5b-plan.md:142`).

**Fix:** parse explicit, connected date expressions into tuples with source spans; require each claimed component to belong to the same expression. Do not accept an arbitrary numerical token as the day. Preserve supported month-name, ordinal, BCE and range-endpoint forms, but fail closed on ambiguous combinations. Add full-validator and worker regressions for both examples, including ordering questions whose answer would change under the fabricated tuple.

### S5B-02 — High: quote trimming and title inheritance erase approximate-date context

**Location:** `packages/validation/timeline.ts:209-224,245-250,317-339,450-478`.

Approximation is checked only inside model-selected quotes. A verbatim substring can omit the approximation qualifier from its real source sentence. Title-year extraction also accepts an approximate year without checking the title's qualifier.

**Evidence:** `probe-results.json`:

- `trim-approximate`: the source sentence is `The office opened around March 3, 1889 in the customs house.`; Muse quotes only `March 3, 1889 in the customs house.` and claims an exact March 3 date. All checks pass. The probe replaces the original exact-date sentence, rather than leaving an independent exact statement of the event in the source.
- `approximate-title`: metadata title and first heading both say `The Harbor Survey (circa 1889)`; the event quote is `The office opened on March 3.`. Exact 1889-03-03 is accepted. Approximation in the title is never examined.

**Fix:** locate quotes in the original source and inspect the containing source sentence/heading and the matched date span, not just the selected substring. Reject inheritance from approximate/ranged/ambiguous titles. Preserve qualifiers when presenting evidence; reject ambiguous repeated occurrences rather than selecting a conveniently unqualified match. Add shortened-quote and approximate-title regressions.

### S5B-03 — High: timeline repair authorization trusts reflected prose and unlocks unrelated fields

**Location:** `packages/validation/timeline.ts:749-764,884-886,998-1007,1039-1077`; integrated by `packages/meta/pipeline.ts:398-405`.

`findingNamesItem` authorizes an item when its quoted id appears anywhere in a finding's **message**. That message includes model-controlled labels/quotes. A different item's error can therefore name an otherwise clean event. Separately, a finding at `/simulation/events/0/label` unlocks that event's date and evidence, and a case-name policy finding unlocks an already-correct ordering pair. A rename is not actually pair-frozen on the timeline path.

**Evidence:**

- `message-quoted-id-unlocks-clean-event`: only event `s5` has the bad label `NASA says "s1"`. Its policy finding reflects `"s1"`; a candidate fixes `s5` but also replaces clean `s1`'s 1889 date, label and quote with a different 1888 event. Both full validation and `repair.no-weakening` pass.
- `end-to-end-results.json`, `timeline-scope-bypass-worker`: the real pipeline/worker makes three fake-client calls, stores failed r1 with only `policy.no-publisher-attribution`, then returns **`succeeded`, `publishedRevision:2`**, with the formerly passing date changed **1889 → 1888**. Disk readback confirms it.
- `event-policy-date-rewrite`: correcting an event's own NASA-bearing label likewise permits replacing its previously grounded date/evidence.
- `case-policy-pair-rewrite`: renaming `NASA opening` to a clean name simultaneously replaces the correct `s1→s2` pair with `s3→s5`; both guards pass.

**Fix:** use structured, validator-owned affected-item identifiers and exact field paths, never substring searches over rendered messages. Carry all affected paths separately from truncated display text. A label/name/id correction must preserve grounded dates, quotes and correct pairs; only a recomputed date/order failure may authorize those respective changes. Test both occurrence identity and positional renames, collateral names inside model text, and unchanged malicious candidates on repeated repairs against r1.

### S5B-04 — High: analysis repair can delete/rewrite passing concepts; some valid repairs are impossible

**Location:** `packages/meta/pipeline.ts:537-575,603-629`; `packages/validation/validate.ts:595-617,620-631,678-690`.

Any finding under `/concepts` unlocks the entire concept array, including every name, quote and unaffected concept. `analysis.invariants` unlocks all groups, even when only a required list is empty. Conversely, policy validation reports only its first path, so the guard cannot authorize legitimate corrections in a second affected group. These conflict with the prompt's field-scoped promise (`prompts.ts:273-275`) and the UI's “changed only what the check named” claim.

**Evidence:**

- `analysis-id-unlocks-entire-concepts`: baseline has three concepts and only one overlong id. Repair deletes two other concepts, replaces the remaining concept's name with `Gravity is caused by invisible dragons`, and fixes the id. `repairAnalysis` returns **publishable**, with `repair.analysis-unchanged` passing (`changed groups: concepts`). Verbatim quote checks cannot establish that the new name is true.
- `empty-concepts-decline-escape`: a supported, correctly selected engine with empty concepts/objectives fails only `analysis.invariants`; returning a decline is accepted instead of repairing those lists.
- Positive control: declining to evade only an id-format finding is correctly rejected.
- `multiple-policy-groups-cannot-fix`: baseline has publisher wording in a concept name **and** an objective. Fixing both is rejected because only the concept path is exposed. Immutable-r1 comparison means a later attempt cannot legitimately finish the objective correction either.

**Fix:** emit structured per-field/per-occurrence findings; preserve the supported/activity decision unless that particular decision is inconsistent. For an id failure, allow only the affected id to change, retaining its name/evidence and all unaffected concepts/objectives. Collect every policy-violating field. Add acceptance tests for legitimate multi-field fixes and rejection tests for deletion, prose replacement, quote replacement and decline escape on r2 and r3.

### S5B-05 — Medium: demo faults crash all three new formula engines after paid generation

**Location:** `workers/generation/jobs.ts:325-342,925-934`.

`assembleForActivity` handles the four older numeric engines and timeline, but not `compound-interest-v1`, `hardy-weinberg-v1` or `half-life-v1`. A demo fault on any of the new formula activities reaches `ENGINE_REQUIRED` after the normal generation result has returned.

**Evidence:** worker probes replaying valid committed compound-interest and half-life generations each make two fake billed calls, then end **`failed/INTERNAL`**, cost **USD 0.02**, with no repair. The shared switch proves the same missing dispatch for Hardy-Weinberg. This is not a problem with the formulas or ordinary no-fault generation.

**Fix:** make assembly dispatch exhaustive across the numeric catalogue, preferably through one shared assembler rather than a second partial switch. Test both fault kinds end-to-end on all seven numeric engines and timeline, including `effective`, system-made labels, repair records and preserved costs.

### S5B-06 — Medium: BUG-002 misses billed MetaError paths when event persistence fails

**Location:** `workers/generation/jobs.ts:643-649,661-664,686-719,563-569`.

Successful/invalid-output receipts update both local totals and the in-memory summary. The `MetaError` branch updates only local counters, then emits an event **before** `finish` copies them into the summary. If that append throws, the last-resort catch persists the stale summary.

**Evidence:** `cost-results.json`, `paid-error-event-write-fails`: real client + real scratch ledger + fake 2xx truncated output with valid usage. The probe deliberately makes only the scratch event file unwritable by replacing it with a directory, while `job.json` remains writable. The completed and reread job is **`failed/INTERNAL`, `totalCostUSD:0`**; ledger committed cost is **USD 0.068125**. Ordinary truncation with the same usage correctly reports USD 0.068125.

This does not refund the ledger or bypass its cap, and it is not a claim of general disk durability. It is a fixable in-memory accounting omission in the very last-resort path BUG-002 is intended to cover.

**Fix:** funnel every charge/unknown amount through one accumulator that updates the summary before any fallible event/artifact write, including `MetaError`. Test event-write failure after paid truncation, timeout and uncertain retry outcomes, asserting job/ledger agreement whenever `job.json` remains writable.

### S5B-07 — Medium: the evaluation driver's advertised budget uses a non-conservative reservation

**Location:** `scripts/evaluation-run.ts:10,25,55-59,98-103,112-123`; current limits in `config/resource-limits.json:11-17`.

The driver calls **USD 0.15** a per-job reserve and uses it to enforce `--max-usd`. At current caps a single spec attempt can reserve **USD 0.176**, and a complete job can reserve **USD 1.704**. The admission check therefore does not bound that user-supplied run budget. A submitted job is also absent from its budget bookkeeping until polling succeeds; a poll failure can leave paid work outside `spentUsd` on restart. The stored omitted CFPB attempt demonstrates that latter bookkeeping gap in real evidence.

**Evidence:** `cost-results.json` computes the ceilings with the actual `reservationUSD` function. The source permits admission whenever `spentUsd + 0.15 <= maxUsd`, irrespective of the higher configured bound. The cumulative API ledger's USD 50 gate still applies; this is **not** a USD 50 cap bypass.

**Fix:** derive a conservative per-job admission amount from the same configured input/output/retry/analysis-repair/spec-repair limits, or enforce a lower batch budget in the ledger itself. Persist a submitted-job journal before waiting, reconcile unfinished jobs before resuming, and include all their costs. If `--max-usd` is only a soft target, name/document it as such rather than promising a cap.

### S5B-08 — Medium: INTERNAL diagnostics are not a fixed vocabulary and raw exceptions go to logs

**Location:** `workers/generation/jobs.ts:249-258,560-562,590`; contradicts `docs/ARCHITECTURE.md:93`.

`sanitisedCause` accepts any regex-shaped `err.code` or `err.name`; this limits syntax, not vocabulary. The last-resort path also prints the entire exception to stderr. The prior R-01 condition explicitly excluded raw exceptions/request contents from logs, not merely HTTP error messages.

**Evidence:** `extra-results.json`, `cause-not-fixed-vocabulary`: a deliberately throwing fake receipt serializer produces code `PRIVATE_MARKER_TOKEN`. That exact marker is persisted and returned by `readJob` in `INTERNAL; during analyze; cause PRIVATE_MARKER_TOKEN`; stderr prints `PRIVATE_EXCEPTION_MESSAGE` and the stack. The billed receipt remains accounted in this success-receipt branch.

This is a synthetic exception-boundary test, **not** evidence that a real provider can currently inject a serializer or arbitrary error class. Real-client timeout/503 marker probes did not leak provider-body text.

**Fix:** enumerate permitted errno/class tokens explicitly and map everything else to `unknown`; log only job id, stage and the same safe code by default. Any richer local diagnostic mode needs explicit opt-in and redaction, without source/provider payloads. Test both regex-valid arbitrary markers and ordinary built-in errors.

### S5B-09 — Medium: evaluation prose overstates correctness and the rerun aggregate omits a paid failure

**Location:** `docs/evidence/stage-5b/evaluation/adjudication.md:19`; `docs/evidence/stage-5b/evaluation-rerun-hard/README.md:8,14-18`; `evaluation-rerun-hard/summary.md:3,15,20,55`; `scripts/evaluation-metrics.ts:309,321,331`.

“**Muse's published lessons were all correct first time**” equates passing checks with subject-matter/source correctness. The checker does not validate prose entailment, applicability or event labels, and S5B-01/S5B-02 invalidate even the stronger date claim. The hard rerun's aggregate contains 12 results and zero failures, although its job archive contains **13 jobs including a failed two-repair attempt** subsequently replaced by a new run of that page. README disclosure is useful, but does not make the aggregate an all-attempt outcome rate. Its stated USD 0.58 for the 12 jobs is also unsupported.

**Evidence:** independent replay/counting yields **USD 0.501058** for the 12 results, plus **USD 0.139421** for omitted `job-20261028182320-bc3e9bff`, or **USD 0.640479** for all 13 stored jobs. That failed job has two natural spec repair attempts; it did not succeed in the recorded run. See the accuracy section below for the supported claims.

**Fix:** say “all nine published specs passed the implemented deterministic checks” rather than “all correct.” Preserve the original pre-registered scores. For the follow-up, publish both all-attempt outcomes/costs and explicitly labelled latest-per-page outcomes, with the code/config change boundary. Correct the README amount, wrong results-file path, and definition of `correct-after-repair` to include analysis repair. Say “repair attempts” rather than implying every attempted repair succeeded.

### S5B-10 — Low: partial-date order grading can mark every card correct in a wrong order

**Location:** `apps/web/src/lib/timeline.ts:179-199`; `apps/web/src/components/OrderActivity.tsx:19-21,115,134-135`.

Per-card feedback tests only whether an index lies within a possible position range. It does not test actual ordering constraints against the submitted neighbors/other cards.

**Evidence:** `extra-results.json`, `all-green-wrong-order`: events dated 1855, June 1855, June 1 1855, June 2 1855, and 1856; submitted order is year-only, **June 2, June 1**, month-only, 1856. `gradeOrder` returns **`correct:false`, `rightCount:5`, `positions:[true,true,true,true,true]`**. The UI says all five are in the right place and marks no card to fix, while rejecting the order.

**Fix:** mark endpoints of actual violated strict-order constraints, or use a partial-order-aware feedback algorithm. Keep acceptance of genuine precision ties, but ensure a rejected order visibly identifies a real violated pair. This does not undermine the correct overall rejection.

## Evaluation-claims accuracy

### Original pre-registered evaluation

- Commit `32ca75ef23edb5da4e009d2d51feba1efa098461` records the manifest at `2026-10-29T01:56:21+09:00`, before the first stored job at `2026-10-28T16:57:18Z`. `git diff 32ca75e..HEAD -- data/evaluation/manifest.json` is empty. The pre-registration/unchanged-expectations claim is supported by local Git and job timestamps.
- All **29 distinct pages/jobs** are represented. Recomputed classes match the saved summary: 7 correct-first-try, 0 correct-after-repair, 9 correct-decline, 1 wrong-engine, 8 wrong-decline, 1 false-accept, 3 failed. **16/29** is an expectation-matching decision score, not independently established content correctness.
- Jobs comprise **9 succeeded, 17 unsupported, 3 failed**; total **USD 0.928613**, zero repair attempts. Every stored published spec passes the current implementation on replay with its licensed source.
- Post-hoc adjudication is clearly labelled and does not rewrite the manifest, which is appropriate. Its “all correct” conclusion is not justified. Its #4 concept-id length is also misstated as 51; the stored id has **53** characters.

### Hard-page follow-up and natural repairs

- The 12 rows cover the ten hard pages plus #4/#28, without injected faults. Their metrics reproduce: 4 correct-first-try, 1 correct-after-repair, 3 correct-decline, 3 wrong-decline, 1 false-accept; six published lessons. They are a selected follow-up, not a fresh unbiased 29-page benchmark.
- **Two genuine natural analysis repairs are supported by the files.** Free-fall job `job-20261028181732-c760fe12` changes a concept id from 53 to 32 characters and then publishes spec r1. Mach job `job-20261028182141-78f83d2f` changes a concept id from 42 to 37 characters and then declines. Independently removing ids before comparing the analyses shows every other field unchanged in both jobs. These are format repairs, not demonstrations of scientific reasoning correction.
- The CFPB job `job-20261028182320-bc3e9bff` contains **two attempted natural spec repairs**. Both were rejected at run time. Under HEAD, replay of r2 and r3 against the original r1 passes after BUG-003. This establishes that the historical candidate is now acceptable to the code, **not** a successful historical live repair. Its later replacement job publishes r1, not a repaired revision.
- Thus the 13 stored follow-up jobs show **four repair attempts across three jobs**: two accepted analysis repairs and two rejected spec repair attempts. The 12-row aggregate intentionally excludes the latter job; README disclosure must remain beside any rates/costs. No benchmark-wide natural repair success rate or science-correction rate follows from this small, changed-code follow-up.
- Known timeline label gap: **Medium for the expressly teacher-reviewed local product; High if presented as verified historical-event correctness or used without review.** Dates and ordering of model-labelled cards do not establish that those named events occurred on those dates. The Wright-page archive actually supplies secondary description quotes for several labels; absence of an entailment check is not proof those particular labels are false. Keep event labels/prompts explicitly subject to teacher review, and do not describe the existing prose warning as verification. Extractive event labels tied to source spans would provide a stronger deterministic contract. This known debt is not counted again as a new finding.

## Spend, BUG fixes and retained controls

### Current configured ceiling

Computed using `packages/meta/pricing.ts`, with 32,000 input tokens at USD 1.25/M and output at USD 4.25/M:

| Bound | USD |
|---|---:|
| Analysis or analysis-repair attempt: 16,000 output | 0.108000 |
| Spec or spec-repair attempt: 32,000 output | 0.176000 |
| Three analysis calls + three spec calls, no transport retries | **0.852000** |
| One retry per logical call: at most twelve HTTP attempts | **1.704000** |

The two repair loops have **separate** budgets, each integer 0–2, so the old four-logical-call ceiling is obsolete. All calls share the 420,000 ms job deadline. The client retains its per-call timeout and reserves **before each attempt** against cumulative committed/unresolved liability. At the USD 50 cap a job can stop partway through when the next reservation will not fit; the whole-job ceiling is not reserved upfront. These remain estimates under DEBT-003's tokenizer/framing/pricing assumptions, not verified provider invoices. DEBT-002's canonical ledger/port condition and the deferred session-token condition remain unchanged, not re-raised as new findings.

Independent real-client/fake-transport results at the enlarged analysis cap:

| Path | Job total | Unknown portion | Ledger committed |
|---|---:|---:|---:|
| Truncated output, valid usage | 0.068125 | 0 | 0.068125 |
| Truncated output, absent usage | 0.080090 | 0.080090 | 0.080090 |
| 503 followed by successful decline | 0.148215 | 0.080090 | 0.148215 |
| Timeout exception | 0.080090 | 0.080090 | 0.080090 |
| Insufficient cap | 0 | 0 | 0; **zero transport calls** |

No refund or lost prior-attempt liability appeared in those ordinary paths. The exceptional event-write hole is S5B-06. No real ledger, credential file, provider account or billing endpoint was read or changed.

### Other verified behavior and limits

- New numerical implementations match their stated formulas: compound interest `P(1+r/(100n))^(nt)`, Hardy-Weinberg `2p(1-p)` with `p²/2pq/q²` bars, and half-life `N0·0.5^(t/T)`. Registry dispatch, full/gen schemas and ordinary recorded generation work. Their views use the same engines, state schematic/idealized assumptions, and avoid inventing genotype allele names or decay time units. Build/helper tests are not a new browser interaction or accessibility audit.
- Timeline case ordering and the UI compare at shared precision, not array position. The independent mixed-precision comparison probe agrees on every tested pair. Overall order grading rejects the reversed strict pair even where its per-card explanation is wrong. Source hash, quote occurrence, distinct tuples and schema checks remain present; they do not cure S5B-01/S5B-02.
- Worker analysis/spec repairs retain immutable r1 baselines; analysis revisions, `analysisRepairs`, and `target:'analysis'` events are persisted and exposed by `readJob`/the API. Full-suite API tests pass. The UI distinguishes natural analysis repairs, system-made spec faults, still-failing results and calls that return no usable repair. The preservation wording is too strong until S5B-03/S5B-04 are fixed.
- **BUG-003 numeric behavior is verified:** the real recorded rename passes. A new probe keeps the valid repaired id but changes a correct prediction's principal and recomputes its answer: ordinary validation passes, while the no-weakening guard rejects both that candidate and its repeated r3 against r1. Timeline policy renames do not retain the equivalent pair freeze (S5B-03). Also align `prompts.ts:171,186` with the new invalid-id exception: they still call publisher-policy renaming the “only exception.” That is a reliability condition, not evidence that the numeric guard is bypassed.
- Prompts are subject-neutral and keep source metadata, previous output, baseline analysis and findings in labelled untrusted/escaped data blocks. No generated code or new model fallback is enabled. Structural delimiting does not establish live prompt-injection immunity; S5B-03 demonstrates an independent code-level trust failure in using reflected diagnostic prose as authorization.

## Gate to approval

1. Close S5B-01–S5B-04 with field-scoped, source-span-based checks and independent end-to-end adversarial replay. Repeating a rejected revision must never change its obligations.
2. Correct the new-engine demo dispatcher, paid-error accounting, evaluation-run budget/journal and R-01 diagnostics; retain all original evidence rather than rewriting old failed reports.
3. Correct evaluation wording/totals and distinguish all attempts, latest-per-page results, format repairs, and deterministic checks from independently assessed correctness. Resolve or explicitly accept the narrow UI feedback limitation.
4. Re-run `check`, schema check, scratch-directed web build and these probes after fixes. Continue supervised loopback-only operation, canonical ledger/port, licensed nonprivate data, explicit system-made fault labels and teacher review. No approval for unattended service, external publication or general claim verification is implied.

No `.env` read, install, network retrieval, live Meta/Modal call, live server startup, Git write, implementation edit, evidence regeneration, commit, push or deployment was performed. Repository changes are limited to this report; probes, their job data and frontend build output are in scratch.

## Re-review (round 2) at fb99f458b2d7e7d027ccbe1ef9b4d8b0c886d239

**Updated verdict: CHANGES REQUIRED.** Independent reviewer: OpenAI `gpt-6-astra` via `openai-codex`. Reviewed all six commits after `682bebc`, including the additive evidence correction and Waves A–D. The original report above is preserved.

The original exploit probes now produce the safe outcomes, including rejection of both repeated timeline repair candidates by the real worker. **The broader date-grounding and evaluation-budget contracts are not yet closed.** New source-boundary, BCE-range and approximation variants still publish incorrect exact dates on revision 1; restarting the evaluation driver with unresolved liability can still admit spending outside its advertised run budget. These are exercised failures, not speculative concerns about model behaviour.

### Verification performed

| Gate | Verified result |
|---|---|
| `npm run check` | Exit 0; TypeScript passed; **1,006 passed, 0 failed/cancelled/skipped**. Final run explicitly set `TEMP`, `TMP` and `TMPDIR` to review scratch. |
| `node scripts/build-schemas.ts --check` | Exit 0; `schemas up to date`. |
| `npm --prefix apps/web run build -- --outDir <review-scratch>/round2-web-dist` | Exit 0; frontend TypeScript and Vite passed; **78 modules transformed**. Expected outside-root output warning only. |
| Original independent probes | Re-ran `probes.mjs`, `cost-probes.mjs`, `extra-probes.mjs`, `end-to-end.mjs`, `evidence.mjs`; every script exited 0. Inspected results rather than equating script exit with safety. |
| New adversarial probes | `round2-adversarial.mjs`: **45 result rows**, including connected dates, source contexts, affected paths, analysis repairs and exhaustive order feedback. `round2-e2e.mjs`: seven real-worker synthetic jobs plus two real recorded analysis-repair replays. |
| Billed-stage persistence matrix | **20/20** job totals agree with real scratch-ledger committed amounts within USD 0.000001: analyze, analysis repair, specify, spec repair × success, invalid generated output, truncation, timeout, uncertain retry. Each target deliberately loses its event file after the call begins; `job.json` remains writable and is read back. |
| Demo matrix | Both fault kinds on **all eight activities: 16/16** succeeded at r3 after deliberately repeating faulty r1 as the first repair. Every injection was effective, retained the system-made label, recorded the first failed/second successful repair, and preserved all four different synthetic receipt charges (USD 0.10 total). |
| Evaluation recovery | Eight isolated executions of the actual driver, with preloaded fake `fetch` and scratch-only result/journal paths. No API server or network request. Settled/duplicate recovery works; six other recovery cases incorrectly permit a new submission, detailed below. |
| Stored evidence | Re-enumerated every `docs/evidence/stage-5b/**/jobs/`: **42 jobs, 18 spec revisions across 16 jobs**. Result rows and deduplicated receipt totals still agree with job files. All previously published specs still pass. Both recorded analysis repairs pass the new guard. The only stored-vs-current spec verdict differences remain the already-disclosed BUG-003 CFPB r2/r3 replays. |

All new scripts, logs, generated jobs, fake journals and build output are under the active profile's `cache/scratch/review-5b/`. Durable result files: `round2-adversarial-results.json`, `round2-worker-results.json`, `round2-eval-results.json`, `round2-e2e-results.json`, `round2-verification-summary.json`; original probes retain their original result filenames, with fresh `round2-*.log` transcripts. The final suite log is `round2-check-scoped.log`.

### Disposition of S5B-01–S5B-10

| Finding | Round-2 status | Evidence and remaining boundary |
|---|---|---|
| **S5B-01** | **PARTIALLY CLOSED** | Original headcount/mixed-month exploits fail. Valid ordinal `the 4th of July 1776`, `Sept. 4th, 1776`, day-month and ordinary BCE dates pass; AD range endpoints pass and the interior fails. But quote-edge truncation/source-unit normalisation still fabricates dates (**S5B-11**), and BCE range suffixes are lost (**S5B-12**). |
| **S5B-02** | **PARTIALLY CLOSED** | Original `around March` trimming and `circa` title probes fail safely. Repeated clean/approximate occurrences, headings, whitespace changes and quotes spanning sentences retain approximation context. `c.` sentence splitting, day-first qualifiers and `early` title inheritance still bypass it (**S5B-13**). |
| **S5B-03** | **PARTIALLY CLOSED** | Reflected ids, own-label date rewrites and case-name pair rewrites are rejected. Worker r2 **and r3** fail `repair.no-weakening`; no publication. Legitimate label correction with reordered event arrays passes by event identity. The exported comparator still unions caller-supplied affected paths with recomputation, allowing a contradictory caller finding to unlock a clean event (**S5B-15**). The current worker is protected by pipeline-side recomputation; this is not a newly reproduced model-to-worker bypass. |
| **S5B-04** | **CLOSED** | Id-only repair cannot delete, append, reorder or rewrite unaffected concepts, change an unrelated reason, or escape an empty-list finding by declining. Repeating rejected candidates against r1 still fails. Forged caller reports naming root/parent/decision paths do not expand permission. Legitimate empty-list additions, unsupportedReason-only repairs and all policy-field corrections pass. Both archived id-only repairs pass. See the fail-closed structural-input limitation below. |
| **S5B-05** | **CLOSED** | Exhaustive assembly switch covers the catalogue. Full suite's immediate-repair matrix passes; the new 16-run second-repair matrix also passes, including all three new formula engines, fault effectiveness, labels and costs. |
| **S5B-06** | **CLOSED** | Original paid-error/event-write failure now persists **USD 0.068125**, equal to the ledger. New 20-run matrix covers all four billed stages and both receipt/error accounting paths, including unknown retry/timeout liability. No loss or double count reproduced. |
| **S5B-07** | **PARTIALLY CLOSED** | USD **1.704** admission is correctly derived at the configured caps; known settled journal jobs are recovered and duplicate entries counted once. Running/unresolved/unknown-cost/corrupt journal state still permits other pages without reserving its liability (**S5B-14**). |
| **S5B-08** | **PARTIALLY CLOSED** | Default stderr and persisted diagnostics use the fixed allowlist; arbitrary code/name markers become `unknown`. Every declared allowlisted token was exercised. The newly introduced opt-in debug path prints raw message/stack without the required redaction (**S5B-16**). |
| **S5B-09** | **CLOSED** | Additive correction sections agree with the stored files: original evaluation USD **0.928613**; follow-up's 12 rows USD **0.501058**, omitted failed job USD **0.139421**, all 13 jobs USD **0.640479**. Four follow-up repair attempts: two accepted analysis-format repairs, two historically rejected spec repairs. Original scores, manifest, summaries and historical claims remain preserved, explicitly superseded by the corrections. |
| **S5B-10** | **CLOSED** | Original wrong order now marks the two reversed cards wrong (`rightCount:3`, one violated pair). Exhausted all **120** permutations of the mixed-precision example: **108 rejected**, zero mismatches between per-card feedback and endpoints of actual violated strict pairs. Legitimate partial-precision ties remain accepted. |

### New findings and residual mechanisms

#### S5B-11 — High: date expressions are bounded by the model's quote, not the actual source span

**Location:** `packages/validation/timeline.ts:248-293,333-358,610-649`; source-location helpers at `430-560` are used for approximation but not to constrain the grounded date expression.

**Evidence:** `round2-adversarial-results.json` and real-worker disk readbacks in `round2-e2e-results.json`:

- Source: `The survey office opened on March 30, 1889 in the customs house.` Quote: `The survey office opened on March 3`. Claimed **1889-03-03** passes every check and the worker publishes r1. Substring-verbatim accepts a cut inside `30`; the parser sees a complete `3` at the quote edge and borrows 1889 from the title.
- Source: `The survey office opened on March 3, 1889 BCE in the customs house.` Quote stops immediately after `1889`. The worker publishes **+1889-03-03**, although the source says **−1889-03-03**. Approximation-context lookup does not preserve the omitted era suffix.
- Full-validator variant: source has an actual newline between `March` and `3, 1889 were reference numbers.` A whitespace-normalised quote joins them into `March 3, 1889`, producing `publishable:true` despite the documented newline-separated source-unit rule.

**Concrete fix:** parse dates in the original source units with exact raw spans, including token boundaries and attached era/range syntax. Map the quote's occurrence to those spans; never let a quote edge manufacture a token end or a whitespace-normalised quote erase a source-unit boundary. Use the complete source expression when determining sign/precision/title inheritance. Add full-validator and worker regressions for all three variants, retaining legitimate whole-expression shortened quotes.

#### S5B-12 — High: the year-range alternative strips BCE from the endpoint

**Location:** `packages/validation/timeline.ts:194-201,276-282`.

**Evidence:** `BCE-range-wrong-sign` accepts **+400** from the verbatim sentence `The office was active during 500–400 BCE.`; `BCE-range-right-sign` rejects **−400**. The range alternative consumes `500–400` without the suffix and emits positive years; the later standalone-year branch never gets to read `400 BCE`. The real worker publishes +400 at r1 (`BCE-range`, two fake calls, all checks passing).

**Concrete fix:** include and resolve era markers as part of the range grammar, or reject era-bearing ranges until supported. At a minimum the explicitly suffixed right endpoint must be negative, never positive; ambiguous sign inheritance for the other endpoint must fail closed. Test BC/B.C./BCE suffixes, both endpoints, mixed eras and abbreviated ranges alongside existing AD controls.

#### S5B-13 — High: approximation handling still loses abbreviations and misses supported date/title forms

**Location:** `packages/validation/timeline.ts:110-139,366-397,408-423,459-485`.

**Evidence:** each of the following passes full validation and publishes r1 in the real worker:

1. `The office opened c. March 3, 1889 in the customs house.` Quoting just `March 3, 1889 in the customs house.` accepts an exact date. `c.` is not protected by the abbreviation masker, so source-context splitting puts the qualifier in a different unit. Even the full sentence quote passes the approximation check.
2. `The office opened around the 4th of July 1776.` accepts exact 1776-07-04. The parser supports this day-first expression, but the approximation regex only recognises `around` directly before a year/month, not this date expression.
3. Metadata title and first heading both `The Harbor Survey (early 1889)` lend exact 1889 to `The office opened on March 3.` The title rejection regex omits the already-recognised approximation words `early/mid/late`.

**Concrete fix:** protect approximation abbreviations during unit segmentation, attach qualifiers to parsed expressions (including optional articles and ordinal day-first forms), and share a consistent approximation policy with title inheritance. Preserve existing tests that distinguish `about 40 delegates` from an approximate date. Re-run the positive ordinal/abbreviation controls as well as shortened-quote negatives.

#### S5B-14 — Medium: journal recovery blocks a page, not its outstanding financial liability

**Location:** `scripts/evaluation-run.ts:79-87,158-205,240-259,272-274`; `scripts/evaluation-budget.ts:110-136,171-198`.

**Evidence:** `round2-eval.mjs` executes the actual driver against an in-process fake transport, with `--max-usd 1.8`, an old journaled job and another manifest page:

- When the old job is already settled with cost **1.70**, recovery records it and correctly refuses the next job. A duplicate journal line is counted once.
- When the old job is initially `running`, it is merely added to `blockedSourceIds`. The fake job then settles at **1.70** before `/api/health` returns idle. The driver does not re-reconcile or hold a reservation; it submits the next page, records **0.20**, and prints only **0.20** spent. Actual synthetic aggregate is **1.90 > 1.80**. No concurrent jobs are needed for this race.
- An unresolved old job, recovered `totalCostUSD:null`, an existing results row with null cost, a truncated nonempty journal line, and a known-cost job whose source is absent from the manifest each also permit a new submission with no liability assigned to the old job. Malformed journal lines are silently skipped.

The independent cumulative ledger cap is still intact; this is the evaluation-run admission guarantee, not a demonstrated USD 50 cap breach.

**Concrete fix:** before any submission, reconcile **all run liabilities**, not only the page selected next. Retain a conservative reservation for each unresolved/running/unknown-cost job, or stop the entire run until it can be resolved; recheck after waiting for idle. Count known costs even for sources no longer in the manifest. Treat nonempty malformed journal lines and unknown result costs as blocking/charged liabilities, not zero. Also close the POST-to-journal crash window with a durable pre-submit intent and idempotent job identifier (or explicit uncertain-submission liability); a post-response append alone is not crash-safe admission accounting.

#### S5B-15 — Medium: a contradictory caller finding overrides exact timeline recomputation

**Location:** `packages/validation/timeline.ts:1235-1288,1398-1417`.

**Evidence:** a clean baseline and a fully valid candidate changing event `s1` from 1889-03-03 to 1888-01-01 normally fail comparison. Supply `failedOnBaseline:[]`, real sources, and a fabricated finding `{ id:'timeline.date-grounded', affected:['/simulation/events/0'] }`: the guard passes. `'/simulation/events/0/year'` also passes. Root/collection-parent paths fail closed, but the event-parent path unlocks date/evidence even though recomputation says every baseline check passed.

**Reachability qualification:** the current `repairSpec` integration (`packages/meta/pipeline.ts:514-526`) recomputes baseline findings before passing them, so this did **not** reproduce a model-controlled worker bypass. The issue is the exported comparator's authorization contract: externally supplied finding metadata takes precedence over the authoritative result instead of being checked against it.

**Concrete fix:** when sources are present, derive scopes exclusively from failing checks in the recomputed immutable-r1 report. Do not union unchecked caller findings; if retained for diagnostics, intersect them with recomputed check ids and exact affected paths. Without sufficient source context, fail closed rather than broadening permission. Add direct comparator regressions with stale, fabricated, parent-path and wrong-check-id findings, plus the existing pipeline tests.

#### S5B-16 — Medium: opt-in INTERNAL logging is not redacted

**Location:** `workers/generation/jobs.ts:597-610`.

**Evidence:** `round2-worker-results.json`, `debug-logging-false/true`: a fake receipt serializer throws an Error with `code:'PRIVATE_TOKEN'` and message `PRIVATE_SOURCE_PAYLOAD`. Default stderr and persisted output contain neither marker and report `unknown`. With `MKI_DEBUG_INTERNAL=1`, stderr contains the entire message and stack including `PRIVATE_SOURCE_PAYLOAD`; persisted output remains safe. The probe restores the environment setting afterwards.

**Concrete fix:** remove the raw debug branch, or make its richer output an allowlisted, redacted structure that cannot include arbitrary exception message/stack text. Opt-in alone does not satisfy round 1's explicit “opt-in **and redaction**, without source/provider payloads” requirement. Add assertions for debug-mode stderr as well as the default path. This is a local diagnostic-mode issue, not evidence that production HTTP responses leak raw payloads.

### Legitimate behaviour and evidence limits

- The new analysis guard is intentionally position-based: concept reordering accompanying an id repair is rejected, including on the second attempt. The same id-only repair without reordering is accepted. Filling actually empty concepts/objectives and correcting every policy-affected group remain possible; affected lists survive display-message truncation.
- Root-level required-property errors still emit no affected path (`schemaAffectedPaths` skips empty `instancePath` before refining `missingProperty`). A direct `repairAnalysis` call cannot restore missing `/supported`, even with an otherwise correct candidate. This is fail-closed, not a permission bypass; the current worker rejects such generation-schema-invalid initial analysis before entering repair (`pipeline.ts:90-95`). It is a known direct-API repairability limitation, **not** evidence that the two real recorded repairs regressed. Refine required root properties before skipping uninformative root errors if structural repair becomes an intended API capability.
- Archived CFPB r2 and r3 still pass the legitimate id-rename exception; changing an already-correct numeric case and repeating it still fails. All published archive specs pass the current validators. That demonstrates compatibility with these fixtures, not independent correctness of event labels or teaching prose.
- The S5B-09 corrections are additive and numerically correct. Keep the correction notes beside any reuse of historical summary tables; the old “all correct” wording is not restored by green deterministic tests.

### Round-2 approval gate and execution boundary

1. Fix **S5B-11–S5B-13** and re-run both full-validator and real-worker adversarial date probes, plus every stored timeline revision and positive date control. No claim of deterministically grounded dates is justified while these publish at r1.
2. Fix **S5B-14** with conservative unresolved-liability accounting and recovery tests against the actual driver. Fix the comparator authority boundary (**S5B-15**) and debug redaction (**S5B-16**), or obtain an explicit narrowly scoped acceptance of those two limitations; they are not silently waived here.
3. Retain immutable-r1 comparison, teacher review, canonical ledger/port, licensed nonprivate sources, supervised loopback-only use and explicit injected-fault labels. Re-run `check`, schema verification and scratch web build after changes. No new approval for external publication or unattended service is given.

No `.env` was read; no install, external network request, live Meta/Modal call, API server launch, implementation/evidence edit, Git write, commit or push was performed. New standalone probes and final build/test outputs were directed to review scratch. **Execution note:** the initial standard suite invocation used Node's inherited Windows temporary directory; this differed from the advertised scratch environment, so the suite was re-run with all three temporary-directory variables explicitly pinned to review scratch. No cleanup outside the allowed scope was attempted. The only repository modification is this appended review section.
