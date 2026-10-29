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

## Re-review (round 3) at 50a86d4506b5c500ca5507150be54427f82dab17

**Updated verdict: CHANGES REQUIRED.** Independent reviewer: OpenAI `gpt-6-astra` via `openai-codex`. Reviewed `f3e56d3`, `c340765` and `50a86d4` against the round-2 gate. Prior findings and historical evidence above remain unchanged.

**The original round-2 exploit cases are now rejected. The broader date and repair guarantees still fail on new inputs.** Most importantly, the real worker again publishes a repair that changes a previously passing event date while correcting only another event's label. The new source-span validator and the comparator's retained quote-only grounding disagree; the latter bypasses the former's authoritative baseline result. New era, qualification and century variants also publish incorrect exact dates at r1. These are synthetic-client executions through the actual worker, not speculation about Muse output or external publication.

The evaluation-liability and INTERNAL logging fixes are effective in the exercised operational paths. **Of S5B-01–S5B-16: ten CLOSED, six PARTIALLY CLOSED.** Of the five previously partial items, **S5B-07 and S5B-08 close; S5B-01, S5B-02 and S5B-03 do not.** Four new blocking findings are recorded below; separate hardening observations do not inflate that count.

### Executed verification and evidence

| Gate | Verified result |
|---|---|
| `npm run check` | Exit 0; TypeScript passed; **1,066 passed, 0 failed/cancelled/skipped**. `TEMP`, `TMP`, and `TMPDIR` were pinned to this review's scratch directory before execution. Log: `round3-check.log`. |
| `node scripts/build-schemas.ts --check` | Exit 0; `schemas up to date`. |
| Scratch-directed web build | `npm --prefix apps/web run build -- --outDir <review-scratch>/round3-web-dist`: exit 0, TypeScript/Vite passed, **78 modules transformed**. Only the expected outside-root output warning. Log: `round3-web-build.log`. |
| All prior probes | Re-ran all **nine executable probe drivers**: `probes.mjs`, `cost-probes.mjs`, `extra-probes.mjs`, `end-to-end.mjs`, `evidence.mjs`, `round2-adversarial.mjs`, `round2-e2e.mjs`, `round2-worker.mjs`, `round2-eval.mjs`. All exited 0; inspected their newly written JSON results, not just exits. Fresh transcripts are `round3-rerun-*.log`. The evaluation preload is exercised by its driver. |
| Retained cost/demo/error controls | **20/20** billed-stage persistence cases still match scratch-ledger commitments; **16/16** demo cases across all eight activities still publish r3, with effective injections and labels. Both debug settings now exclude the private payload from stderr and persisted output. Old forged-affected-path and reflected-label probes fail safely. |
| New date/comparator variants | `round3-adversarial.mjs`: **74 rows**, comprising **65 date/source/title rows and nine comparator rows**. Includes repeated occurrences, Unicode quotes/dashes/NBSP, punctuation boundaries, markup/newlines, a **950,572-character** source, era grammar, new qualifiers, centuries, title headings, and narrowing semantics. |
| New worker execution | `round3-adversarial.mjs`: **13 real-worker fake-client jobs**, including one new negative control for each of S5B-11/12/13. `round3-repairs.mjs`: **four more jobs**, three legitimate date repairs publishing r2 and the new unauthorized date rewrite publishing r3 after a rejected first repair. Every outcome was read back with `readJob`. |
| Evaluation journal variants | `round3-eval.mjs`: **19 scenarios / 20 driver executions** including a restart, injected in-process `fetch`, no server/network. Covered CRLF/BOM, 100,000 duplicate intents (**7,100,000 bytes**), a **5,000,012-byte** malformed line, truncation, conflicting entries, manual-resolution forgery, idle-wait reconciliation, and POST failure/restart. |
| Complete stored-spec enumeration | `round3-all-evidence.mjs` found and processed **35 spec revisions in 30 directories** under all `docs/evidence/`, a superset of `**/jobs` and `stage-5*/live`. **33 revisions have available source documents; all 25 source-backed published revisions pass.** All **seven timeline revisions across six jobs** retain their recorded check verdicts, including the stored injected-fault failure and accepted repair. See the unavailable-source qualification below. |

New durable scratch results: `round3-adversarial-results.json`, `round3-new-worker-results.json`, `round3-repair-results.json`, `round3-eval-results.json`, `round3-all-evidence-results.json`, and `round3-verification-summary.json`. Scripts, logs, generated jobs, fake journals and build output are under the active profile's `cache/scratch/review-5b/`. Original probe result filenames were refreshed by their original scripts. No historical repository evidence was regenerated.

### Per-finding disposition

| Finding | Round-3 status | Evidence and residual boundary |
|---|---|---|
| **S5B-01** | **PARTIALLY CLOSED** | Original mixed-component/headcount and quote-edge attacks fail; positive ordinal/month/BCE controls work. Broader year parsing still invents positive years from BCE ranges/prefixes and a year from a century ordinal: **S5B-18/S5B-20**. |
| **S5B-02** | **PARTIALLY CLOSED** | Original trimmed `around`, `c.` and approximate-title cases fail, including repeated mixed contexts. Punctuation/markup-separated qualifiers and temporal bounds still become exact dates: **S5B-19**. |
| **S5B-03** | **PARTIALLY CLOSED** | Original reflected-id, own-label date rewrite and renamed-case pair attacks remain rejected on both attempts. New quote/source-unit disagreement unlocks a clean event in the real worker on r2 and r3: **S5B-17**. |
| **S5B-04** | **CLOSED** | Prior analysis deletion/reordering/append/decline escape and forged-report probes remain rejected; honest id-only, empty-list and multi-policy-field repairs pass. Both recorded natural analysis repairs still pass. The previously disclosed missing-root-property direct-API limitation remains fail-closed, not a new bypass. |
| **S5B-05** | **CLOSED** | Exhaustive two-fault/eight-activity second-repair matrix still gives 16/16 effective, labelled, successful r3 outcomes; all synthetic receipt charges retained. |
| **S5B-06** | **CLOSED** | Paid-error/event-write failure still persists USD 0.068125, equal to the ledger; all 20 stage/outcome combinations agree with committed liability. |
| **S5B-07** | **CLOSED** | Admission remains derived at USD 1.704; the driver now reserves unresolved liabilities, counts settled/out-of-manifest costs and persists pre-submit intent. The old eight driver cases submit nothing at USD 1.8. New recovery/restart controls confirm **S5B-14** closure within the supervised single-driver, trusted-local-record boundary. |
| **S5B-08** | **CLOSED** | Arbitrary code/name becomes `unknown`; raw exception message/stack does not appear with debug off **or on**. All prior vocabulary and worker probes rerun. |
| **S5B-09** | **CLOSED** | Additive correction notes remain present and agree with the refreshed 42-job audit and receipt totals. No summary, manifest, adjudication or historical verdict was rewritten. Passing validators still do not establish prose/event-label correctness. |
| **S5B-10** | **CLOSED** | Exhaustive 120-order probe still reports 108 rejected and zero per-card/violated-pair mismatches; shared-precision ties are retained. |
| **S5B-11** | **CLOSED** | Original day-token/era truncation and cross-newline fabrication fail in full validation and worker replay. New repeated-era/day-cut, LF/CRLF and NBSP variants behave correctly; complete-expression and long-source controls pass. Remaining grammar holes are **S5B-18/S5B-20**; the comparator integration disagreement is **S5B-17**, not a failure to locate raw spans. A punctuation false-negative is recorded separately below. |
| **S5B-12** | **PARTIALLY CLOSED** | `500–400 BCE` now grounds negative endpoints and rejects the positive endpoint, including spaces/em dash; honest correction publishes r2. Short-year and `to`/`until` ranges fall through the range grammar and still produce the wrong sign: **S5B-18**. |
| **S5B-13** | **PARTIALLY CLOSED** | `c.`, day-first ordinals, `early` titles, `approximately`, `roughly` and `sometime in` now block exact dates. Delimiters between the qualifier and expression defeat attachment; bounds such as `by`/`before` also remain exact: **S5B-19**. |
| **S5B-14** | **CLOSED** | Old recovery exploits all blocked; CRLF/BOM journals, large duplicate sets and malformed lines retain liability. A running job changing to known cost during idle is re-read before submission. A thrown POST leaves an intent; restart reserves USD 1.704 and makes no second POST. A legitimate recovered USD 1.70 job with sufficient USD 3.50 room permits the next USD 0.20 job. Operator-edited records remain a trust boundary, not authenticated financial evidence. |
| **S5B-15** | **PARTIALLY CLOSED** | All original contradictory caller findings now fail. Exact check-id/path intersection is implemented, but is not the sole authorization mechanism: `eventMayReground` still ORs it with a quote-only failure, producing the worker bypass in **S5B-17**. Empty/wrong caller scopes also do not consistently narrow genuine date-failure permission. |
| **S5B-16** | **CLOSED** | Removed debug branch verified by source diff and both debug-mode worker readbacks. Neither `PRIVATE_SOURCE_PAYLOAD` nor raw stack is emitted. |

### New blocking findings

#### S5B-17 — High: quote-only fallback overrides the source-grounded immutable baseline

**Location:** `packages/validation/timeline.ts:1647-1666,1697-1719,1754-1778`; `eventPassedGrounding` still calls `quoteGroundsDate` even with authoritative sources, and `eventMayReground` grants permission when that separate calculation fails.

**Evidence:** `round3-adversarial-results.json`, `comparator-normalized-*`; worker disk readbacks in `round3-new-worker-results.json` and `round3-repair-results.json`:

1. Source title/first heading is `The Harbor Survey (1889)`. Its opening source unit is `The office opened on March 3`, followed by a newline and `1900 was the report serial number.` The quote contains the same text with that newline normalized to a space. Baseline event `s1` is **1889-03-03**: the real source-span check passes under the allowed title-year rule, with no year in the first source unit.
2. The only r1 failure is another event's label, `s5: "NASA final report"`, producing only `policy.no-publisher-attribution`. No date failure or affected date path exists.
3. The candidate fixes that label but changes `s1` to **1888-01-01**, with a different valid quote from an additional source sentence. The comparator's quote-only parser sees `March 3 1900` in the old normalized quote and decides the baseline's 1889 date failed. Its fallback therefore unlocks the event despite the exact source revalidation saying it passed.
4. The actual worker makes three fake calls and publishes **r2** with the unauthorized date change. A second job deliberately leaves an invalid pair in the first repair; it rejects r2 for pair checks, then publishes the date rewrite at **r3**. Immutable-r1 storage alone does not prevent this authorization disagreement.

This is a reachable model-output-to-worker failure, unlike round 2's direct-caller-only S5B-15 probe. The first event's new date is independently grounded; the violation is changing what already passed while repairing an unrelated field.

**Concrete fix:** with sources present, derive every event/pair unlock exclusively from the recomputed r1 check/path map. Remove the quote-only `|| !eventPassedGrounding(...)` authorization on that path; use one canonical per-event result from source-span validation. Without sufficient sources, fail closed on date/evidence mutation rather than assuming a textual failure authorizes it. Either enforce the advertised caller intersection consistently or remove caller narrowing from the API; it cannot be a second authority. Add full worker r2/r3 regressions for this normalized quote and preserve legitimate date repairs.

#### S5B-18 — High: unsupported era/range forms silently degrade into positive standalone years

**Location:** `packages/validation/timeline.ts:168-171,219-254,305-311,367-404`; the range alternative requires 3–4 digit endpoints and only dash/slash separators, while era recognition is suffix-only. Unmatched larger forms fall through to the standalone-year branch rather than failing closed.

**Evidence:** full-validator rows and r1 worker publications:

| Actual source wording | Incorrect accepted claim | Worker evidence |
|---|---|---|
| `The office was active during 50–40 BCE.` | **+50**, not −50 | `range-short`: succeeded, published r1 |
| `The office was active during 500 to 400 BCE.` | **+500**, not −500 | `range-to`: succeeded, published r1 |
| `The office was active during BCE 500.` | **+500**, not −500 | `BCE-prefix`: succeeded, published r1 |
| `The office opened on March 3, 1889 **BCE**.` | **+1889-03-03**, not −1889-03-03 | `inline-markup-era`: succeeded, published r1 |

The full validator also accepts the positive left endpoint of `500 until 400 BCE`, positive years after `BC`/`BCE` prefixes, and positive title-year inheritance from `(BCE 1889)`. AD/CE positive-prefix controls and the corrected 3-digit suffixed BCE range work. `500 BC–400 AD` currently fails closed rather than producing the expected positive endpoint; that compatibility limitation is safer than the positive-BCE acceptances.

**Concrete fix:** recognize the complete surrounding era/range syntax before accepting a standalone year. Support prefix/suffix eras, short endpoints and word separators with explicit sign inheritance, **or reject the whole unsupported expression**. Treat inline formatting adjacent to a date/era as part of the same lexical context, with mapped spans, or conservatively reject it; do not parse only the convenient numeric prefix. Share this grammar with title-year extraction. Add wrong-sign and valid-sign controls through both validator and worker.

#### S5B-19 — High: date qualification is lost across delimiters and temporal bounds become exact dates

**Location:** `packages/validation/timeline.ts:178-202,333-342,500-510,599-625,688-716`. Qualifier attachment allows whitespace/hyphen/article combinations but not parentheses, commas, opening quotes or markup; unit segmentation can detach a preceding-line qualifier. Bound/uncertainty words are absent from the date and title policies.

**Evidence:** `round3-adversarial-results.json` and actual worker r1 publications:

- `The office opened circa, March 3, 1889 in the customs house.`; quote `March 3, 1889 in the customs house.` → exact **1889-03-03**, all checks pass, worker publishes r1 (`qualifier-circa%2C`).
- `The office opened around ( March 3, 1889) in the customs house.`; quote omits `around (` → exact **1889-03-03**, worker publishes r1 (`qualifier-around%20(`).
- `The office had opened by 1776.` → exact event year **1776**, worker publishes r1 (`by-year`). A latest possible date is not an exact occurrence date.
- Full validation also accepts `c. (`, `approximately,`, `around “`, `circa **`, `circa` followed by a newline, `before`, `after`, `no later than`, and `probably in` before the claimed date. Titles `(before 1889)` and `(by 1889)` lend an exact 1889. These are broader forms of the same loss of temporal qualification, not proof that all natural-language qualifications can be recognized.

**Concrete fix:** carry qualification/bound information in the source expression representation, not just a narrowly anchored pre-expression regex. Preserve attachment across ordinary delimiters/formatting and explicitly recognize bounds/uncertain dates; reject those as exact claims. For newline/markup ambiguity, fail closed or require a clearly delimited supported date form rather than guessing. Apply the same policy to inherited titles. Retain the positive `about 40 delegates` control and ordinary exact/ordinal/date repairs; all of those pass this review's controls.

#### S5B-20 — High: century ordinals are parsed as literal years

**Location:** `packages/validation/timeline.ts:219,253-254,402-404,471-472`. The standalone year core has digit boundaries only; it accepts the `18` inside `18th` and never classifies the surrounding century expression.

**Evidence:** source/quote `The office was active during the 18th century.` produces a full-validator pass for year **18**. `century-number` runs through the actual worker and publishes **r1**, two fake calls, no failed checks. `the 5th century BCE` similarly passes full validation for **+5**. The negative control claiming 1700 from `the 18th century` fails, so the problem is specifically ordinal-prefix token extraction, not permitted century-to-year conversion.

**Concrete fix:** reject ordinal/word suffixes on standalone year tokens, classify century expressions as non-exact ranges, and never reinterpret their ordinal number as a year. Keep day ordinals valid only in their connected month/day grammar. Test both CE/BCE centuries, quoted fragments within ordinals, and the already passing `the 4th of July 1776` control.

### Legitimate behaviour, recovery limits and non-blocking hardening

- **Real stored timelines are compatible.** Every stored timeline check retains its verdict, including published NARA/Wright-page timelines and the labelled injected case-order repair. Across all available-source spec revisions, the only historical-vs-current check differences are the already disclosed CFPB r2/r3 `repair.no-weakening` flips after BUG-003. These remain successful **replays**, not retroactively successful live repairs. Both real recorded id-only analysis repairs also pass.
- **Two archived teacher sources are unavailable.** The first all-evidence replay stopped on missing `user-accf5f60ebed`; the revised driver explicitly records missing source IDs and continues, without synthesizing text. `job-20261027181336-572d603f` and `job-20261027181422-546e7594` reference uncommitted teacher sources (the second is `user-0e818e7ef9c1`). Their source-independent checks retain their recorded verdicts; `refs.sources` cannot pass without those documents. The standard evidence tests already disclose the same limitation. Therefore a claim that **all 35 full source-dependent verdicts were verified unchanged** would be false; 33 were source-backed, and two received only partial replay.
- **Honest repairs remain possible.** Three new worker jobs repair a cut `March 30` quote/date, a +400→−400 BCE endpoint, and an approximate-date event by re-grounding it to a separately stated exact date; each publishes r2. Existing numeric id rename and real analysis-format repairs still pass; changing an unrelated correct numerical case still fails on both repair attempts.
- **Hardening, non-blocking — punctuation false-negative.** From source `The office opened on March 3, 500 BCE.`, the otherwise complete quote ending at `BCE` without the sentence's period is rejected (`BCE-quote-before-period`); the BCE regex consumes the period into the required expression span. Distinguish sentence punctuation from era spelling in spans. This rejects legitimate evidence rather than accepting a false date. The mixed-era range rejection noted above is likewise fail-closed.
- **Hardening, non-blocking — first-heading discovery.** With a leading blank line, `titleYearOf` ignores the now-second-line `# ... (around 1889)` and accepts the clean metadata title's year; the `heading-after-blank` worker publishes r1. The current documented rule literally checks the first text line, so this is a policy gap rather than a violation of that narrow implementation contract. Prefer the first nonempty top heading, or reject conflicting title/heading contexts explicitly. No claim is made that arbitrary section headings inherit dates safely.
- **Hardening, non-blocking — trusted operator journal/results.** A hand-authored `{intentId, resolution:"not-submitted"}` releases an uncertain intent even if placed before it; a matching known job still counts. Negative hand-authored result costs can offset positive costs: −1 plus 1.70 is treated as 0.70 and admits under a USD 2.50 run cap. This is **not** a model/API-reachable cap bypass: the probes edit local financial files as the operator, who can already delete them, and no normal worker path producing negative costs was found. Validate each cost as nonnegative, reject conflicting ID/source pairings, document who may resolve intents, and use an auditable resolution command if records become multi-user/untrusted. Journal BOM/CRLF works; results BOM currently aborts before submission (safe but inconvenient). Large tested journals retained reservations; this is not a proof of arbitrary-size resource bounds.
- **Hardening, non-blocking — durability/concurrency scope.** `appendFileSync` puts the intent before POST, which the fake transport verified, but no explicit fsync/transaction or multi-driver lock was added. This review covers process failure/restart in one supervised driver, not power-loss persistence or simultaneous independent drivers. Stronger guarantees require durable flushing and serialized admission. No USD 50 cumulative-ledger breach was reproduced.

### Round-3 approval gate and execution boundary

1. Close **S5B-17** by making source-recomputed r1 paths the sole repair authority. Re-run both unauthorized r2/r3 worker variants and legitimate repairs; do not certify non-weakening from comparator unit tests alone.
2. Close **S5B-18–S5B-20** with a supported grammar that fails closed on unsupported surrounding date syntax. A growing list of positive regex examples without negative fallback tests does not establish exact-date grounding. Re-run all prior/new probes and every available-source stored revision; retain explicit unavailable-source qualifications.
3. Keep the now-verified evaluation reservations/pre-submit intents and fixed-vocabulary logging. Keep supervised loopback-only operation, canonical ledger/port, licensed nonprivate sources, teacher review, and explicit system-made fault labels. No approval for external publication, unattended/multi-user service or general historical-claim verification is given.
4. Re-run the 1,066-test check, schema check and scratch web build after fixes; preserve original evidence and scores. The current green suite/build is not an exemption from the reproduced worker failures.

No `.env` read, install, external network request, live Meta/Modal call, real-account ledger access, Git write, implementation edit, evidence rewrite, commit, push or deployment was performed. Only own scratch fake-client jobs/ledgers and loopback test listeners were used; no live product server was launched. The only intentional repository modification is this appended round-3 review. All test commands set `TEMP`/`TMP`/`TMPDIR` to review scratch. HEAD was rechecked as `50a86d4506b5c500ca5507150be54427f82dab17` before writing.

## Re-review (round 4) at 9ef291b514c87a2d570bd33045522a6149b78b40

**Updated verdict: CHANGES REQUIRED.** Independent reviewer: OpenAI `gpt-6-astra` via `openai-codex`. Scope: round-3 gate, `cbeba6f`, Wave A3 `bb56577`, and the additive evidence disclosure `9ef291b`; open-weights work is out of scope. Prior review text and historical evidence are preserved.

**The reachable repair-authority bypass is closed. Exact-date grounding is not.** Every old round-3 date attack now fails safely, and the normalized-quote repair is rejected at both r2 and r3. However, the new “clean” context still means absence of a small blacklist in a bounded token window, not positively established exactness. Bounds outside that window, punctuation that consumes the window, misplaced negation, and partial word tokens still publish through the real worker. **Remove the generic negated-until exception in its present form.** Its nearby-negator heuristic demonstrably upgrades an ordinary duration bound to an exact occurrence date.

### Executed verification

| Gate | Actual result |
|---|---|
| `npm run check` | Exit 0; TypeScript passed; **1,089 passed, 0 failed/cancelled/skipped**. `TEMP`, `TMP`, `TMPDIR` explicitly pinned to review scratch. |
| `node scripts/build-schemas.ts --check` | Exit 0; `schemas up to date`. |
| `npm --prefix apps/web run build -- --outDir <review-scratch>/round4-web-dist` | Exit 0; frontend TypeScript/Vite passed; **78 modules transformed**. Expected outside-root output warning only. |
| All prior probe drivers | Re-ran **13**: `probes`, `cost-probes`, `extra-probes`, `end-to-end`, `evidence`, `round2-adversarial`, `round2-e2e`, `round2-worker`, `round2-eval`, `round3-adversarial`, `round3-repairs`, `round3-eval`, `round3-all-evidence` (all `.mjs`). Every driver exited 0; JSON outcomes were inspected separately. |
| Round-3 gate | All 65 prior date/source/title rows meet their recorded expectations; all four normalized-quote comparator variants reject; empty/wrong caller scopes now narrow genuine failures to no permission. The two unauthorized worker scenarios fail at r2 **and** r3; all three honest date repairs still publish r2. |
| New adversarial probes | **60 date/source/title rows, 14 comparator rows, 37 real-worker fake-client jobs**. Every one of the **34 full-validator false-accept variants** was exercised through the worker, plus three positive controls. All 37 published r1 after two fake calls; each result was read from disk with `readJob`. This deliberately selected adversarial set is not an accuracy benchmark. |
| Retained operational controls | **20/20** billed-stage persistence cases match scratch-ledger commitments; **16/16** two-attempt demo jobs across eight engines still publish labelled/effective r3 repairs. Both debug settings exclude private payloads. The negative-local-cost driver scenario now refuses admission rather than offsetting liability. |
| Stored evidence | Re-enumerated **35 spec revisions in 30 directories**; **33** have source documents. Of **25 source-backed published revisions, 23 pass**; the other two have exactly the newly disclosed date-check failures. All seven timeline revisions across six jobs were replayed. Both stored natural analysis repairs and the historical CFPB r2/r3 id-rename replays remain acceptable. |

Durable scratch artifacts: `round4-run.py`, `round4-execution-results.json`, `round4-rerun-*.log`, `round4-adversarial.mjs`, `round4-adversarial-results.json`, `round4-adversarial.log`, `round4-summary.mjs`, `round4-verification-summary.json`, worker job directories and `round4-web-dist`. Prior result filenames were refreshed by their original drivers; pre-Wave-A3 snapshots were not modified. Suite/build logs are `round4-rerun-check.log`, `round4-rerun-schemas.log`, `round4-rerun-web-build.log`.

### Per-finding disposition: S5B-01–S5B-20

| Finding | Round-4 status | Evidence / remaining boundary |
|---|---|---|
| **S5B-01** | **PARTIALLY CLOSED** | Mixed day/month/headcount and quote-edge attacks remain rejected. Whole-token exactness still fails for `March 3ish`, `1888ish`, and connected dates ending in word suffixes (**S5B-23**). |
| **S5B-02** | **PARTIALLY CLOSED** | Original trimmed approximation/title probes remain rejected; source context is used. Longer bounds in the source and title still pass (**S5B-21**). |
| **S5B-03** | **CLOSED** | Reflected ids, own-label date changes, case rename/pair rewrites and normalized-quote collateral changes all reject. New reordered-event label-only repair passes; reordered collateral date rewrite fails. See **S5B-17** and the direct-caller hardening note. |
| **S5B-04** | **CLOSED** | Prior analysis deletion/reordering/append/decline escapes and forged-report attacks still fail; legitimate id-only, empty-list and all-policy-field repairs pass. Both archived natural analysis repairs pass. |
| **S5B-05** | **CLOSED** | Exhaustive eight-activity/two-fault second-repair matrix remains 16/16, with labels, effective injections and receipt costs retained. |
| **S5B-06** | **CLOSED** | Original paid-error/event-write case retains USD 0.068125; all 20 stage/outcome cases agree with scratch ledger. |
| **S5B-07** | **CLOSED** | Conservative USD 1.704 admission and unresolved-liability/pre-submit-intent controls remain intact. Negative recorded costs now reserve unknown liability, not negative spend. |
| **S5B-08** | **CLOSED** | Fixed vocabulary remains effective; arbitrary names/codes map to `unknown`; default/debug logs do not expose raw payloads. |
| **S5B-09** | **CLOSED** | Original additive numerical/wording corrections remain consistent with the refreshed 42-job audit. New `9ef291b` notes disclose the two stricter timeline rejections beside their evidence; no historical scores were changed. A new live rerun is not claimed by this review. |
| **S5B-10** | **CLOSED** | 120-order exhaustive probe retains 108 rejections and zero feedback/violated-pair mismatches; legitimate shared-precision ties remain accepted. |
| **S5B-11** | **CLOSED** | Original day/era cuts and newline fabrication remain rejected, including worker replay. Complete source spans, not quote-created token edges, decide grounding. Word-boundary parsing inside those spans is separately **S5B-23**. |
| **S5B-12** | **CLOSED** | Original and short suffixed BCE ranges preserve negative signs; positive claims reject. Unsupported `to`/`until` ranges reject instead of leaking positive endpoints. Mixed-era range positive control now works. Contradictory markers on one endpoint/year are **S5B-24**. |
| **S5B-13** | **PARTIALLY CLOSED** | Abbreviations, ordinal qualifiers and early titles remain fixed. Longer qualifications evade the new window (**S5B-21**); this is not an abbreviation-segmentation regression. |
| **S5B-14** | **CLOSED** | Prior recovery cases remain blocked; known recovered spend with enough room still permits submission; POST-failure restart retains uncertain liability. Negative-cost hardening now passes. Trusted operator resolution and single-driver durability boundaries remain unchanged. |
| **S5B-15** | **CLOSED** | Real-source recomputation plus exact check/path intersection rejects forged, parent, empty and wrong-check/field authority. Caller findings no longer broaden date permission. Missing/mismatched source inputs are a separate non-blocking direct-caller hardening issue below. |
| **S5B-16** | **CLOSED** | Both debug-mode probes confirm no private message/stack leakage. |
| **S5B-17** | **CLOSED** | Quote-only fallback removed from authorization. Baseline fails only the other event's policy label; changed clean date gets `repair.no-weakening` at r2 and r3 in both old worker scenarios. Honest cut-date, BCE and approximate-date repairs still publish r2. |
| **S5B-18** | **PARTIALLY CLOSED** | All original prefix/range/markup wrong-sign cases reject, and supported signs work. Conflicting consumed era markers are resolved by precedence rather than rejected (**S5B-24**). |
| **S5B-19** | **PARTIALLY CLOSED** | All old comma/parenthesis/markup/newline qualifiers and short temporal bounds now reject. Two-token/160-character boundaries and the added negation exception leave new reachable false accepts (**S5B-21/S5B-22**). |
| **S5B-20** | **CLOSED** | `18th century` and `5th century BCE` no longer produce literal years; worker rejects the old century attack. Day ordinals stay valid. Other attached word suffixes are **S5B-23**. |

### New findings

#### S5B-21 — High: the “clean” context window can be displaced or simply outlived

**Location:** `packages/validation/timeline.ts:379-400,441-474,502-540`; reused by source indexing and title-year extraction.

**Evidence:** all examples below pass full validation and publish r1 in `round4-adversarial-results.json`:

- `before-start`: `The office opened before the start of March 3, 1889.` → exact **1889-03-03**. Only `start of` reaches the preceding-word check. `around the date of March 3, 1889` and `approximately on the date of March 3, 1889` similarly lose qualification.
- `suffix-earliest` / `suffix-latest`: `The office opened on March 3, 1889 at the earliest.` / `... at the latest.` → exact **1889-03-03**, although these are bounds. The following two tokens are only `at the`.
- `before-dash` / `circa-dashes`: `before - - March 3, 1889` and `circa - - March 3, 1889` pass. `WINDOW_TOKEN_RE` counts connector punctuation toward the two-token limit; the frozen decision said to ignore punctuation **between words**. Thus even the narrow two-word contract is not implemented faithfully.
- `before-long-space`: `before` followed by 170 spaces and `March 3, 1889` passes. The 160-character slice ends before the only preceding bound word. Whitespace normalization in quote matching does not repair the raw-source context scan.
- `title-three-word-bound`: title/heading `The Harbor Survey (before the start of 1889)` lends exact 1889 to `The office opened March 3.` and the worker publishes.
- `probably-signed`: `The office was probably opened on March 3, 1889.` passes. Ordinary uncertainty is three words away, not an exotic adversarial spelling. `March 3, 1889 perhaps` also passes because following-word qualification is not symmetric.

Direct `not on` / `never on` variants also pass. They underscore that a syntactically recognizable date mention is not necessarily a positive exact-date statement; they are not needed to establish this finding, whose bounds/approximation examples already violate the promised date contract independently of event-label entailment.

**Concrete fix:** do not describe a fixed blacklist window as a fail-closed grammar. Parse a supported **date phrase plus its complete governing context**, including qualified/bounded/alternative forms on either side, and reject unsupported context rather than extracting a convenient inner date. At minimum, scan actual word boundaries without a character-cut fallback, do not let connector punctuation evict words, reject negated/uncertain/bound phrases throughout the governing clause, and apply the same policy to title inheritance. Merely increasing the window to three/four words moves the failure boundary. If a reliable restricted clause grammar is out of scope, narrow the supported input to explicitly delimited exact-date fields or require human confirmation instead of certifying unrestricted prose as exact. Retain the passing headcount control (`About 40 delegates ... on March 3, 1889`).

#### S5B-22 — High: negated-until accepts a negator that does not negate the temporal bound

**Location:** `packages/validation/timeline.ts:481-495,512-515`; `packages/validation/negated-until.test.ts:13-22` establishes the broad exception but not syntactic negation scope.

**Evidence:** full validator and real-worker r1 publications:

| Source | Accepted claim / defect |
|---|---|
| `The office (not the museum) operated until March 3, 1889.` | Exact **1889-03-03**; `not` distinguishes the subject, while `operated until` remains an un-negated duration bound. |
| Same source, quote only `operated until March 3, 1889.` | Still publishes. The source lookup supplies the unrelated parenthetical `not` even though it is absent from the evidence excerpt. |
| `The office was not only open until March 3, 1889.` | `not only` is treated as negating `until`; the bound is incorrectly lifted. |
| `The office was probably not opened until March 3, 1889.` | Uncertainty survives in the sentence, but the exception upgrades the date to exact. |
| `The office could not open until March 3, 1889, and in fact opened in 1890.` | A lower-bound condition is treated as an exact occurrence. |

Both `not not opened until` and `not never opened until` also publish: the function asks whether **any** of four whitespace-separated words is negative, not whether the statement has the supported meaning. Parentheses are not clause boundaries; commas are, causing an inconsistent combination of false accepts and false rejects.

**Opinion on the lead exception:** the specific unqualified past-tense `was not approved until September of 1776` is a reasonable ordinary-language reading of an approval month. That does **not** justify a general “nearby `not`/`never`/`n't` makes until exact” rule. Even `not until` can state only a lower bound under a modal or uncertainty qualifier. **Remove this generic exception now**, accepting another safe rejection in stored evidence if necessary. If retained later, require an explicitly specified narrow affirmative-event construction with correct negation scope, no modal/uncertainty/extra negation or parenthetical attachment, and unambiguous full source context. Do not infer scope by counting words. A page-specific exemption or silently trusting the model is not a sound substitute.

Controls: ordinary un-negated `until`, `not until about`, and `until not ... but ...` reject; the intended plain `not opened until` construction and its quote trimmed before `not` pass. Those positives show the exception is exercised, not that it is safe.

#### S5B-23 — High: allow-listed forms still match inside unsupported word tokens

**Location:** `packages/validation/timeline.ts:263-281,293-311,624-632,677-686`; title-year extraction inherits the same year parser.

**Evidence:** all pass every check and publish r1:

- `The office opened in 1888ish.` → exact **1888** (`year-ish`). The suffix explicitly makes the year approximate.
- `The office opened on March 3ish.` → exact **1889-03-03**, borrowing the clean title year (`day-ish`).
- `The office record was March 3, 1889xyz.` → exact **1889-03-03** (`mdy-word-suffix`).
- `The office record was 18thousand.` → literal year **18** (`year-ordinal-fragment`). The ordinal negative lookahead applies only when `th` is not followed by another letter.
- Title/heading `The Harbor Survey (1889xyz)` lends exact 1889 (`title-word-suffix`).

The source-span check correctly finds the parser's span; the **parser itself** stops inside a word. This is a direct violation of the frozen “year token must not carry an ordinal/word suffix” rule, not merely a semantic-entailment limitation. Bare `1889xyz` in the five-event fixture also passes date grounding but hits an unrelated shared-precision ordering failure; the examples above avoid that incidental protection and establish worker reachability.

**Concrete fix:** require complete lexical boundaries around numeric year and day tokens, including after the allowed day ordinal suffix. Reject a larger alphanumeric/apostrophe token as a whole; do not retry an interior numeric prefix or permit title inheritance from it. Use the same tokenization in full dates, standalone years, ranges and titles. Add `ish`, arbitrary letters, ordinal-plus-word, quote truncation and title variants; retain genuine `3rd`, `4th of July`, abbreviations and BCE controls.

#### S5B-24 — Medium: contradictory consumed era markers silently select a sign

**Location:** `packages/validation/timeline.ts:638-645,655-667,677-686`.

**Evidence:** `The office operated in AD 500 BCE.` grounds **−500**; `The office operated in BCE 500 AD.` grounds **+500**. Both full-validator cases and both real-worker jobs publish r1. `sufEra ?? preEra` explicitly gives the suffix precedence. Because both markers were consumed, the unconsumed-era context guard sees no conflict. Range endpoint handling likewise chooses a prefix when both markers are present rather than checking agreement.

These are contradictory synthetic source forms, not an observed defect in the licensed timelines, so severity is lower than the ordinary-language cases above. They nevertheless contradict the advertised fail-closed treatment of unsupported/ambiguous date forms; this is a reachable false accept, not non-exploitable hardening.

**Concrete fix:** resolve prefix and suffix independently and require agreement whenever both occur on one year/endpoint. On conflict, consume the complete expression but mark it ungroundable; never expose an inner standalone year. Preserve valid mixed-era **different** endpoints (`500 BC–400 AD`) and consistent duplicate markers if intentionally supported. Test both signs through validator and worker.

### Legitimate behaviour, stored evidence and non-blocking hardening

- **Real-source replay is accurately disclosed.** The newly failing stored events are exactly Lee Resolution `e4` (`deferred until July 2`) and `e7` (`delayed until November of 1777`), plus Articles `e5` (`from March 1, 1781, until 1789`). They affect **two published specs and one check per spec**, not three failed jobs. `9ef291b` places additive correction notes beside the original evidence. The other source-backed published specs pass, including the Declaration and Wright timelines and the injected timeline repair. The stricter rejection is an accepted compatibility cost, not a reason to weaken the check. No new live rerun was performed here, and none is certified from a note promising one.
- **Unavailable sources remain unavailable.** The two archived teacher-source jobs identified in round 3 still cannot receive full source-dependent replay. They are excluded from the 25 source-backed published revisions. Historical CFPB r2/r3 acceptance remains a replay, not a retroactively successful live repair.
- **Honest repairs still work.** The three prior worker repairs (cut day, BCE sign, approximate-date re-grounding) publish r2. Both genuine analysis id repairs and numeric prediction-id rename pass. Repeating collateral numerical/timeline rewrites still fails. Ordinary connected dates, ordinals, abbreviations, short BCE ranges and punctuation-trimmed BCE quotes pass. First-nonempty-heading discovery now rejects the old blank-line/approximate-heading case.
- **The requested short qualification controls reject correctly:** `not long after`, `in or about`, `as early as`, `some time before`. `in the spring of 1889` legitimately grounds the **year**, not a fabricated month/day: the fixture fails only `timeline.case-order` because its year-only first event ties another 1889 event at shared precision. That row is not a date-validator false rejection.
- **Hardening, non-blocking — direct comparator with insufficient source documents.** `canonicalKnown` at `timeline.ts:1981-1990` means only `sources.length > 0`. Supplying a nonempty list with the wrong source id, or the right id with different text/hash, makes previously passing dates fail recomputation and unlocks a rewrite. Both new direct-call probes return `guard.passed:true`; the same rewrite with the real source, or no sources, rejects. The worker supplies its loaded authoritative source and separately validates the candidate, so no model-to-worker bypass was reproduced. Require complete id/hash-matching baseline sources before granting date permission; unavailable evidence is not proof the baseline claim was wrong. Keep the actual worker fix **S5B-17 closed**, rather than conflating this caller-precondition weakness with the removed competing authority.
- **Hardening, non-blocking — safe false rejections and documentation.** A comma before `until`, or more than four intervening words after a genuine `not`, rejects a legitimate plain past-tense construction. These are safe and do not justify widening the heuristic. `quoteGroundsDate`'s comment at `timeline.ts:769-773` still calls it a comparator fallback even though authorization no longer uses it; update the stale comment. Existing single-driver/trusted-local-journal durability limits and fail-closed missing-root-property analysis repairability remain unchanged.

### Round-4 approval gate

1. Close **S5B-21–S5B-23** with genuinely restricted date/context parsing, complete token boundaries, and removal or formally narrower replacement of the generic negated-until exception. Preserve positive controls, but do not trade false accepts for compatibility with historical evidence. The literal two-word decision itself needs revision: implementation fidelity alone cannot make it a sufficient exactness guarantee.
2. Reject conflicting era markers (**S5B-24**) instead of selecting a preferred sign. Re-run all prior/new full-validator and worker probes. Preserve the now-working single-authority comparator and the legitimate r2/r3 repairs; harden its incomplete-source direct API separately.
3. Re-run the complete suite, schema check and scratch build after fixes; replay every available-source archived revision, preserving the two missing-source qualifications. Keep additive disclosures and original evaluation scores. Record any newly stricter timeline rejection beside its evidence; a fresh live rerun remains the lead's separately authorized work.
4. Retain teacher review, labelled system-made faults, licensed nonprivate sources, canonical ledger/port and supervised loopback-only operation. Green tests do not support general historical-event/prose correctness, unattended operation, external publication or an exact-date certification claim while the reproduced false accepts remain.

No `.env` read, install, external network request, live Meta/Modal call, real-account ledger access, Git write, implementation/evidence edit, commit, push or deployment was performed. Only scratch fake-client jobs/ledgers and loopback test listeners were used; no live product server was launched. All test executions pinned temporary-directory variables to review scratch. The only repository change is this appended review; HEAD was rechecked as `9ef291b514c87a2d570bd33045522a6149b78b40` before writing.

