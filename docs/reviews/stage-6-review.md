# Stage 6 independent review

## Verdict: CHANGES REQUIRED

Reviewer: OpenAI GPT-6.1 Sol, High reasoning. Review baseline: `45c5bc6763d7f0154d494f9d0b688d3d8d42ca0f`. Scope: `85fe5e2~1..HEAD`, including the earlier Stage 6 contracts, prompts and web commits and the later concurrency, normalisation, private-truncation, disclosure and compare-grid changes. The frozen Stage 6 design, its lead addendum and lesson-flow API contract, and `STAGE-6-compare-grid.md` were the contract references.

The data-only architecture is sound, but the current publication gate accepts demonstrably wrong formulas, a different chemical product from the source, and a wrong numerical quiz answer. It also omits the overview's own grounding checks. Repair scope and concurrent failure accounting have independent defects. Green existing tests therefore do not establish the Stage 6 acceptance criteria.

### Verification and boundaries

Executed without contacting the live API or any provider:

- `npx tsc -p . --noEmit`: exit 0.
- `node.exe --test packages/validation/expression.test.ts packages/validation/chemistry.test.ts packages/validation/stage6-*.test.ts`: **169 passed, 0 failed**.
- `node.exe --test apps/web/src/lib/*.test.ts`: **431 passed, 0 failed**.
- Independent pure validation probes: **21 vectors**, including positive and negative controls. Results were parsed and key verdicts asserted independently after execution. These are adversarial observations, not 21 claims of correct application behaviour.

Probe artifacts are in the active Hermes profile, **outside the repository**:

- `cache/scratch/review-s6/publish-probes.mjs`
- `cache/scratch/review-s6/publish-results.json`
- `cache/scratch/review-s6/verification-summary.json`
- `cache/scratch/review-s6/web-tests.txt`

Run the probe with `node.exe "<active-profile>/cache/scratch/review-s6/publish-probes.mjs"` from the repository. It imports only validation modules and reads fixture/library-source files; it does not import the Meta client, open a ledger, touch runtime storage, or make network calls. Synthetic vectors are expressly synthetic, not live model evidence. Probe ids below identify result rows.

Worker/API/client/ledger/evaluation integration findings below are **static findings with concrete regression-test recipes**, not claims that those integration tests were executed. No `npm test`, `npm run check`, server startup, worker test, ledger operation, runtime `storage/` operation, `.env` read, network operation, or Git write was performed. Existing untracked evaluation output was left alone. This report is the only repository file created by the reviewer.

## Findings

| ID | Severity | Finding |
|---|---|---|
| S6R-01 | P1 | Overview publishes without OV-02/OV-06 checks |
| S6R-02 | P1 | FE-08 diagonal sampling accepts a different multivariable formula |
| S6R-03 | P1 | Formula grounding accepts a cropped source formula or silently ignores a mathematical suffix |
| S6R-04 | P1 | FE-05 guesses input bindings and validates a reversed formula |
| S6R-05 | P1 | Chemistry grounding accepts H2O as the source's H2O2 product |
| S6R-06 | P1 | A compare-row count error unlocks previously passing cell contents |
| S6R-07 | P1 | Concurrent fatal component errors lose paid charges from the job accumulator |
| S6R-08 | P1 | Kit publication omits the publisher-attribution policy |
| S6R-09 | P1 | A numeric quiz answer can be a fragment of the quoted number |
| S6R-10 | P2 | Legitimate overview count repairs are impossible under the comparator |
| S6R-11 | P2 | Demo-fault repair attempt 2 is relabelled as a natural model mistake |
| S6R-12 | P2 | Evaluation metrics omit kit repairs and count only premium activities as published lessons |

### S6R-01 — P1: overview checks are not part of the publication gate

**Location:** `workers/generation/lesson.ts:193-205`, `:691-737`; `packages/validation/analysis-v2.ts:239-267`.

**Why it matters:** `validateLessonAnalysis` calls only `validateAnalysisV2`. A-05 checks the existence of the quotes, not whether a term or paraphrase belongs to its quote. The worker then assembles and publishes the overview without invoking OV-01..OV-06. The comment explicitly exempts those checks because an existing golden fixture fails OV-06. A failing fixture is not authority to bypass a frozen production check. A usable analysis can consequently publish unrelated key points and invented terms without any repair being attempted.

**Reproduction:** `overview-bypassed`: replace a drag key point with `Bananas become purple while mountains sing softly.`, and a term/gloss with teleportation wording, retaining the real drag quotes. `validateAnalysisV2` returns `publishable: true`; the overview validator returns `publishable: false` with OV-02 and OV-06. The production worker follows the former verdict.

**Minimal fix:** Include the applicable OV checks in the usable-analysis gate before publishing. Prefix their affected pointers with `/overview` so they participate in the same immutable revision-1 repair authority. Do not run usable-overview minimum counts on honest declines. Correct the authored golden wording, without rewriting historical live evidence or silently disabling checks.

### S6R-02 — P1: FE-08 only tests the diagonal of a multivariable domain

**Location:** `packages/validation/expression.ts:441-451`; `packages/validation/kit/formula-explorer.ts:493-515`.

**Why it matters:** Each variable uses the same fraction of its range in every sample. Equal ranges make `x === y` at all five points, so all errors containing a factor of `x-y` disappear. The generated cases only need finite outputs; they are not compared with the page formula. A published graph and graded case can therefore be wrong even at its own stored case inputs. This is a defect in the frozen sampling design as well as its implementation, not a request to recognise more prose hedges.

**Reproduction:** `formula-diagonal`: source `z = x+y`; generated expression `x+y+(x-y)^2`; both ranges `[1,9]`; stored case `{x:2,y:4}`. All component checks pass. At that case, the page gives **6**, while the accepted expression gives **10**, as computed by the probe. The browser uses independently offset samples in `apps/web/src/lib/explorer.ts:237-245`, so it can notice a mismatch that the publication validator accepted, but only shows an AI-transcription notice and still runs the wrong calculator.

**Minimal fix:** Require the defined canonical AST equivalence for direct transcriptions where possible; at minimum use independently varied points, including one-variable-at-a-time and stored case/default points, rather than one correlated line. Share the comparison implementation with the browser. Numeric spot checks alone should not be described as proof of arbitrary functional equivalence.

### S6R-03 — P1: formula matching does not preserve a complete source formula

**Location:** `packages/validation/kit/formula-explorer.ts:130-175`, `:268-288`; `packages/validation/kit/shared.ts:150-152`.

**Why it matters:** A generated quote is accepted as a raw substring, even when its edge cuts off the source's exponent. Separately, `lexTruncatedParse` truncates at the first unsupported mathematical character and calls the remaining prefix a parsed page formula. This can discard real mathematical content rather than merely trailing prose. FE-08 then certifies agreement with the manufactured prefix.

**Reproductions:**

- `formula-quote-cut`: source `The full formula is z = x/y^2.`; quote/formulaText `z = x/y`; expression `x/y`. **Every component check passes**, although the exponent was omitted at the quote boundary.
- `formula-unmapped-operator`: full verbatim quote/formulaText `z = x/y ÷ 2`; expression `x/y`. **Every check passes**; `parsePageFormulaFromQuote` returns a parsed AST for `x/y`, silently dropping `÷ 2`.

**Minimal fix:** Locate the actual source occurrence and require complete mathematical-token boundaries around the selected formula; an evidence edge must not manufacture a shorter expression. Parse the complete extracted RHS. Unsupported operators/symbols must produce an unparseable result, not success on a prefix. Strip trailing prose only at an explicit recognised prose boundary. Keep the source-example fallback fail-closed as described in S6R-04.

### S6R-04 — P1: FE-05 assigns quote numbers to whichever variables make the answer work

**Location:** `packages/validation/kit/formula-explorer.ts:216-245`, `:517-520`.

**Why it matters:** FE-05 tries every injective assignment of all distinct numbers in the passage to variables. It never establishes which number the source assigned to which page symbol, and even includes the stated result among candidate input numbers. This is not a verified source example. FE-08 uses this result as its entire authority when the formula is prose/unparseable.

**Reproduction:** `formula-bridge-swaps-input-identities`: source formula `z equals x divided by y`; worked quote `With x = 6 and y = 3 the result is 2.`; generated expression **`y/x`**, resultNumber 2, tolerance 0.001. The complete component is publishable because the search swaps the input assignments to x=3, y=6. At the source's actual x=6, y=3, the accepted expression gives **0.5**, not **2**.

**Minimal fix:** Derive explicit source-backed bindings between each page symbol and its value; compare the result at those bindings only. Never let a permutation search or an unbound result token stand in for grounding. If the supported source format cannot be bound deterministically, fail/degrade the explorer rather than using it as the FE-08 bridge. Handle repeated numeric input values without requiring them to be distinct tokens.

### S6R-05 — P1: a chemical formula can be cropped out of a different source product

**Location:** `packages/validation/kit/balance.ts:79-84`, `:112-124`, `:208-215`.

**Why it matters:** BAL-01 uses substring containment for equationText, and BAL-09 does the same for species formulae. BAL-02 compares the split only with the generated equationText, not with complete equation tokens in the source. Exact atom balancing is correct for the wrong reaction, so the later checks cannot recover the lost source identity.

**Reproduction:** `balance-product-token-cut`: source/quote `The page prints H2 + O2 -> H2O2.`; equationText `H2 + O2 -> H2O`; generated product H2O. **Every check passes** and the exact solver returns `[2,1,2]`. The source product is hydrogen peroxide; the activity silently substitutes water. `BalanceView.tsx:114` then says the balanced equation matches the page's equation.

**Minimal fix:** Extract a complete equation span from the source with chemical-token boundaries and compare its parsed formula/side multiset with the generated split. Do not accept a species or equation ending inside another species/subscript. Preserve the existing exact integer solver; the defect is the source-to-equation bridge, not floating-point balance arithmetic.

### S6R-06 — P1: compare list-resize authority also unlocks valid prefix cells

**Location:** `packages/validation/kit/compare.ts:173-176`; `packages/validation/kit/index.ts:181-187`; `packages/validation/kit/repair.ts:65-69`, `:94-96`, `:187-195`.

**Why it matters:** CT-03 emits `/rows/i/values` for a count mismatch. The new exception permits resizing that list, but `isAuthorized` also interprets the same parent pointer as permission to rewrite **every existing cell beneath it**. The prefix is diffed, yet every changed prefix leaf is authorised by the broad count pointer. Thus a structural defect grants content-replacement authority over cells whose grounding checks passed. This is an overbroad validator-owned authority, not a forged caller finding.

**Reproduction:** `compare-resize-changes-passing-cell`: two columns `texture, age`; Alpha's row initially contains only the valid texture `hard`, quoted from `Alpha rock is hard and old.`. Revision 1 fails only CT-03. The repair adds age `old` **and changes the already-valid texture from `hard` to `old`**. Both the new component report and `compareKitRevisions` pass. The resulting texture answer is wrong, despite the original texture cell needing no repair.

**Minimal fix:** Separate structural resize permission from descendant content permission. Allow only the missing/excess tail slots needed for the column count, freeze retained prefix fields unless their own failing paths authorise a change, and retain individually affected-cell repair authority. Add a regression test that combines an honest append with an unauthorised mutation of a passing prefix cell.

### S6R-07 — P1: concurrent fatal errors are deferred in one overwriteable slot before accounting

**Location:** `workers/generation/lesson.ts:790-830`, `:1020-1025`, `:1230-1235`, `:1370-1374`; accounting sink `workers/generation/jobs.ts:751-806`.

**Why it matters:** Successful receipts and component output failures are accounted immediately, but all other paid MetaErrors are merely assigned to `fatalRef.current`. Two active components can both fail after their client has settled paid/unknown charges; the later assignment overwrites the earlier error. Only the surviving error reaches `failFromError` after draining. A concurrent unexpected persistence crash also takes the `crashRef` branch before that error is accounted. The durable ledger still holds the charges, but job.json/API/results understate spend and unknown liability. Evaluation admission replaces settled reservations with these understated job totals.

**Concrete regression recipe (not run under the live-ledger constraint):** Start a fake-client lesson with two simultaneous kit calls. Resolve analysis normally, then reject both outstanding calls with separately charged `TIMEOUT` or `NETWORK_ERROR` MetaErrors. Assert terminal totalCostUSD and reservedUnknownUSD include **both** errors exactly once, and compare with the fake call charges. Repeat with one paid fatal error and the other task throwing during persistence. Current code retains/accounts only the final fatal slot, or skips it on the crash path.

**Minimal fix:** Account every caught error's paid/unknown amount at its own catch boundary, before any fallible emit/write and before storing terminal-cause metadata. Preserve a first terminal cause separately from charge collection. Make the final failure path explicitly non-accounting for already-accounted errors, avoiding double counting. Keep the shared ledger's per-attempt reservations unchanged.

### S6R-08 — P1: kit text is never checked for publisher-attribution claims

**Location:** `packages/validation/kit/index.ts:122-129`; representative complete check list `packages/validation/kit/quiz.ts:75-201`; policy helper exists in `packages/validation/kit/shared.ts:335-351`.

**Why it matters:** A-09 and OV-03 cover analysis/overview strings, but none of the seven generated kit dispatches applies the publisher policy to component-generated text. The prompts forbid these claims; prompts are not a deterministic publish gate. A component can display NASA endorsement claims while the provenance line simultaneously denies endorsement. This regresses the source-use condition documented in `docs/ARCHITECTURE.md:67-68`.

**Reproduction:** `kit-publisher-claim`: set the otherwise valid drag quiz's title to **`Official NASA-endorsed lesson`**. `validateKitComponent('quiz-cards-v1', ...)` returns `publishable: true` with no failures. The title is copied into the published spec and displayed as component text.

**Minimal fix:** Run a shared policy sweep over every AI-generated kit display field, exempting genuinely verbatim evidence quotes. Emit exact field-scoped affected pointers for all hits, and include the sweep in repair revalidation. Apply the frozen plain-text rule at this shared boundary too; React text escaping is useful XSS protection, but does not enforce the promised content policy.

### S6R-09 — P1: numeric quiz keys need not match whole numeric tokens in their quote

**Location:** `packages/validation/kit/quiz.ts:93-99`, `:141-157`, `:168-178`; `packages/validation/kit/shared.ts:157-159`.

**Why it matters:** Q-02 and Q-05 use unrestricted substring containment. N-01 searches the whole page, not the answer's own quote, so another occurrence of the short number elsewhere hides a truncated numerical answer. This produces a wrong graded key, not merely an AI paraphrase requiring teacher review.

**Reproduction:** `quiz-number-token-cut`: first card asks `What value did the experiment record?`, options start with **`2`**, quote is `This experiment records a value of 20.`; elsewhere on the source page is `Another observation has 2 parts.`. The other two golden cards remain valid. **Every quiz check passes**, although the quoted answer is 20, not 2.

**Minimal fix:** For numeric content, require whole, signed numeric-token identity within the specific quoted answer span, not substring or page-global token existence. Apply equivalent token boundaries to numeric distractor matching. Do not broaden this into a general semantic entailment promise; this is the narrower wrong-token class with a deterministic fix.

### S6R-10 — P2: valid count repairs cannot pass the analysis comparator

**Location:** `packages/validation/analysis-v2.ts:294-305`, `:501-514`; `packages/validation/kit/repair.ts:60-74`, `:162-165`; conflicting repair instruction `packages/meta/prompts-v2.ts:201`.

**Why it matters:** A-07 names the overview list when a usable analysis has too few points/terms, and the repair prompt expressly says to add entries. The comparator unconditionally rejects analysis array-length changes even when that exact list pointer is authorised. No bounded repair attempt can fix the count, so a usable source loses its whole lesson and pays for futile repairs. Decline escape remains blocked, which is correct; the authorised append path is missing.

**Reproduction:** `analysis-count-repair`: remove the last point from the three-point usable golden. Baseline fails only A-07 with `/overview/keyPoints`; restore the unchanged original point as a third entry. Candidate analysis validation passes, but `compareAnalysisV2Revisions` fails `repair.no-weakening` solely for list length.

**Minimal fix:** Provide an explicit append-only exception for an undersized, validator-authorised analysis list, preserving all existing entries/ids and checking new entries normally. Do not reuse the compare-table broad subtree permission from S6R-06. For an oversized list, specify an honest bounded regeneration/degrade rule rather than claiming an impossible repair is supported.

### S6R-11 — P2: the second repair of an injected fault becomes a natural-repair claim

**Location:** `apps/web/src/lib/lessonJob.ts:392-400`, `:444-446`, `:472`; `apps/web/src/lib/provenance.ts:25-36`.

**Why it matters:** `buildLessonRepairs` labels a faulted component system-made only when `attempt === 1` (or revision 2 for a running call). Its next attempt is natural regardless of the immutable injected baseline. The main provenance uses only the latest repair per component. If attempt 1 fails and attempt 2 succeeds, the visible line reports a **natural repair (Muse's own mistake)** and no system-made fault for that component. The worker also records premium repairs as afterInjectedFault whenever any FaultRecord exists (`lesson.ts:1259`), including an explicitly not-injected request, rather than tying origin to an actual injection.

**Concrete regression recipe (static):** Take the existing `system-fault` lesson fixture, retain its successful inject event, make the first component repair fail, and append a passing attempt 2/revision 3 for the same component. `buildLessonRepairs` classifies the latter natural; `lessonRepairCounts` keeps that latest record and discards the earlier system origin. Also test a requested-but-not-injected fault with a natural premium repair; it must not acquire afterInjectedFault merely because summary.demoFault exists.

**Minimal fix:** Derive immutable component fault origin from a successful injection record/component id, not attempt number or FaultRecord presence alone. Preserve it through every subsequent repair against that injected baseline. Distinguish requested/not-injected, injected/not-caught and injected/caught states; do not turn any of them into an unsupported natural-repair success claim.

### S6R-12 — P2: evaluation reporting retains activity-only repair/publication arithmetic

**Location:** `scripts/evaluation-metrics.ts:309-329`, `:435-451`; recorded kit repair input `scripts/evaluation-run.ts:295-305`.

**Why it matters:** The driver now records componentRepairs, but `computeMetrics` adds only premium `repairs` and analysisRepairs. A repaired kit is absent from the report's total natural repairs and targeted-check counts. Similarly, `publishedLessons` and cost-per-published-lesson require publishedRevision, which lesson jobs set only for a premium activity. A successfully published overview plus quiz/formula lesson is counted in the Stage 6 section but excluded from the same report's published-lessons/cost denominator. These are misleading public evidence/report values even though the driver submitted no demo faults.

**Concrete regression recipe (static):** Supply `computeMetrics` with one succeeded lesson result having overviewPublished=true, componentsPublished=1, one passing componentRepairs record, a finite cost, and no premium/publishedRevision. The lesson section counts the published interactive, while repairs.total and cost.publishedLessons remain zero. Add another premium lesson to show its cost denominator differs solely because of component type.

**Minimal fix:** Extend the metrics input/aggregation to componentRepairs, with component-scoped check identities and honest missing-field handling for older results. For lesson-flow cost statistics use the frozen lesson publication semantics (overview published), or introduce separately named overview/interactive/premium denominators. Keep v1 statistics unchanged and label legacy engine-class accuracy as inapplicable to kit-only lesson outcomes. Do not regenerate pre-registered evidence in place; issue additive corrected reports.

## What is solid

- **No generated-code execution path was found in the inspected Stage 6 flow.** Contracts assemble allowlisted data bodies and system-owned execution fields; formula evaluation is an explicit grammar/AST walk, not eval/Function. The grammar's precedence, domain and exponent controls passed the targeted tests. The leading `<identifier> =` normaliser changes only expression, records normalisedFrom, and reruns FE checks. No independent code-execution or lhs-normaliser bypass was found; its safety claim still depends on fixing the FE source/comparison defects above.
- **The chemistry solver itself uses exact integer arithmetic and verifies the resulting atom matrix.** It detects impossible/ambiguous solutions and derives gcd-1 positive coefficients. The wrong-product finding is specifically a grounding-boundary defect.
- **Repair authority is genuinely recomputed from revision 1**, and caller findings only narrow it. Ordinary unrelated leaf edits, tolerance widening, unauthorised ids and decline escape are rejected in the exercised unit/probe cases. S6R-06 is the overbroad count-path exception; S6R-10 is the opposite, missing authorised append support.
- **Spend cap enforcement remains separate from the reporting defect.** Static inspection found synchronous reserve/reconcile writes, fresh ledger replay before reserve, and outstanding reservations charged against provider/stage capacity. API admission is bounded by the configured concurrent-job count; component scheduling is bounded at two slots per lesson. S6R-07 does not establish a ledger-cap bypass, but it does invalidate exact per-job spend reporting and can weaken evaluation's separate run cap.
- **Private truncated text is deliberately separated.** The client attaches bounded partialOutput non-enumerably; the lesson worker saves it only to private `.truncated.txt` files. The inspected events/job/API read paths do not forward it. Truncated and schema-invalid component calls have explicit partial-publication failure branches and normal receipts are accounted before persistence.
- **The API/web shape broadly follows the frozen contract:** lesson default with explicit activity compatibility mode, overview-first progress, plan-order components, passed kit specs separated from failed components, premium adapter validation before a paid premium call, and source-specific publisher/model disclosure. Source metadata, previous model outputs and repair findings enter the prompts as escaped, explicitly untrusted data; source text uses the existing collision-checked boundary. There is no invisible non-Meta fallback in the inspected routing.
- **The web has usable non-drag controls:** native radio groups/buttons, sequence up/down controls, labelled coefficient steppers, graph/table alternatives and source quotes. The source-kind/publisher disclosure and open-weights model labels are not hardcoded to NASA/Meta API for every job. Static review and pure tests are not a browser/screen-reader audit.

## Limits and approval gate

No live job, provider invoice, active ledger contents, runtime storage, production bundle, visual browser session, or full worker/API test suite was exercised in this round, deliberately preserving the running evaluation jobs. No claim is made that existing published evidence contains every synthetic defect above; the probes establish that the current deterministic gate would accept those outputs. Static integration findings are accompanied by test recipes rather than fabricated execution results.

Before Stage 6 is called done, fix or explicitly triage these findings and independently recheck the changed gate/accounting paths. Any stricter source/formula rule must be replayed against stored real published outputs **before adoption**: list newly failing true source sentences for lead adjudication, preserve historical verdicts/scores, and never weaken the checker simply to keep old totals green. The independent review verdict remains **CHANGES REQUIRED**.

## Lead triage (2026-10-30, Claude Opus 5.5)

All 12 findings accepted: they are wrong-answer, honesty or accounting classes with deterministic narrow fixes, not wording-hedge hunting. One fix wave, four parallel workers with disjoint files, time-boxed; every stricter rule is replayed against the stored real published outputs (`docs/evidence/stage-6/evaluation-*/jobs/` and `docs/evidence/stage-6/live/jobs/`) before adoption, and a worker STOPS and reports any true page content that newly fails (lead adjudicates; historical verdicts are not rewritten).

| Wave | Findings | Owner (model) | Files |
|---|---|---|---|
| A1 formula | S6R-02, S6R-03, S6R-04 | Qwen 3.8 Max | `packages/validation/expression.ts`, `packages/validation/kit/formula-explorer.ts` (+ tests); browser comparison stays as is unless the shared helper is a pure import |
| A2 numbers/chemistry | S6R-05, S6R-09 | DeepSeek v4.1 Flash | `packages/validation/kit/balance.ts`, `packages/validation/kit/quiz.ts`, `packages/validation/kit/shared.ts` (+ tests) |
| A3 gate/repair/policy | S6R-01 (validation side), S6R-06, S6R-08, S6R-10 | Claude Sonnet 5.5 | `packages/validation/analysis-v2.ts`, `packages/validation/kit/{repair,compare,index}.ts`, new `kit/policy.ts`, overview golden fixture (+ tests) |
| B worker/web/metrics | S6R-01 (worker wiring), S6R-07, S6R-11, S6R-12 | Claude Opus 5.5 | `workers/generation/**`, `apps/web/src/lib/{lessonJob,provenance}.ts`, `scripts/evaluation-metrics.ts` (+ tests) |

Re-review: GPT-6.1 Sol, one round, on the changed paths only.

### Lead adjudication of A3 replay hits (2026-10-30)

Replay of the new gate/policy over 90 stored jobs (131 analysis revisions, 226 kit gens) found real stored content that newly fails. Historical verdicts and scores are not rewritten; rulings for future runs:

1. **OV-06 on Bernoulli `streamline` gloss** ("path that confines Bernoulli constant when restrictions apply" vs quote "…restricts this equation to be true only along a single streamline") — **real catch, rule kept.** The gloss is garbled; the repair loop will rewrite it. No stemming added.
2. **Plain-text `>` in quiz options** ("Lift > Weight = Aircraft Rises", job `…143609-b3ac3e67`) — **real catch, rule kept.** Composed text not on the page; prompts s6-v2 already forbid `A > B`.
3. **"according to" in kit quiz stems** ("…according to the definition", "…according to the study?") — **false positive, narrow the kit sweep:** in kit display fields, "according to" counts as a publisher claim only when followed by a publisher name/acronym. Overview A-09/OV-03 unchanged.
4. **Single-word publisher token** (`ocean` from "NOAA Office of Ocean Exploration" rejecting "deep ocean") — **false positive, narrow the token set:** publisher matching uses acronyms (NASA, NOAA, NARA, CFPB, NRC, USGS, NIJ) and the full publisher name, never ordinary words inside the name.

Rulings 3–4 are implemented after Wave A2 releases `kit/shared.ts`, with the replay re-run.

## Round 2

### Verdict: CHANGES REQUIRED

Reviewer: **OpenAI GPT-6.1 Sol, High reasoning**. Re-reviewed fix commit `b75897324239f844f4f300ea2b8a039d625d788d` against `51896f1`, including the lead's final publisher/compare narrowing. At completion HEAD was `f11dd72` (an evidence-only follow-up); `git diff b758973..HEAD -- packages workers apps scripts tests docs/reviews/stage-6-review.md` was empty before this append. No implementation files were edited by this reviewer.

**Eight findings are CLOSED; four are PARTIALLY CLOSED.** The original wrong-answer vectors now fail, the overview reaches the actual publish gate, list repairs preserve passing prefixes, concurrent charges are retained, and fault origin/kit metrics have regression coverage. However, complete-token/source binding still fails on ordinary numeric/equation continuations. A newly introduced numerical-option inconsistency also publishes a quiz with two equivalent answers and grades one wrong (**S6R-13, P1**). These are concrete wrong-answer consequences, not requests to revisit the lead's wording-hedge or publisher policy.

### Verification, artifacts and boundaries

- `npx --no-install tsc -p . --noEmit`: **exit 0**.
- `node.exe --test packages/validation/*.test.ts packages/contracts/*.test.ts apps/web/src/lib/*.test.ts tests/evaluation-metrics*.test.ts`: **1,019 passed, 0 failed**.
- The three inspected worker regression files `lesson.concurrent-fatal.test.ts`, `lesson.overview-gate.test.ts`, and `lesson.fault-origin.test.ts`: **12 passed, 0 failed**. All calls used fake clients or fake transport and temporary job directories. The accounting file's real-ledger/fake-transport subtest also ran: its ledger was temporary, its loopback lock was OS-assigned, and its assertion excluding port **47853** passed. No live ledger/API was opened. The command included a negative test-name pattern intended to omit that subtest, but the execution output shows it ran; the count above includes it rather than claiming it was skipped.
- Copied the round-1 `publish-probes.mjs` to active-profile `cache/scratch/review-s6-r2/`, changed the overview vector to invoke the new pure `validateLessonAnalysisGate`, and added class/positive controls: **33 uniquely identified vectors**, saved in `publish-results.json`. Independently parsed and asserted the relevant old/new verdicts and controls; `verification-summary.json` records the result. Imports are pure validation/contracts code, plus Node file I/O; no client/worker/ledger imports.
- `baseline-probe.mjs` loads scratch copies of `51896f1`'s quiz/shared validators (only import paths adjusted) and compares them with the fixed validator. It verifies **S6R-13 was rejected before the wave and accepted after it**; `baseline-results.json` retains both reports.
- Read-only `replay.mjs` rechecked historical `evaluation-lesson-*` and `live` job copies under `docs/evidence/stage-6/`, expressly excluding the active/new `evaluation-recheck-*` runs: **149 job directories, 211 analysis revisions, 318 kit generations, including 50 explorers**. `replay-results.json` keeps each changed verdict/new failing check. No evidence was rewritten. These are comparisons to archived reports, not a claim that all old generations used the immediately preceding code.
- No `npm test` / `npm run check`, API startup, provider request, `.env` read, live `storage/` access, live-ledger access, or Git write was performed. The only repository modification is this appended section. Test/probe logs and scripts remain outside the repository in `cache/scratch/review-s6-r2/`.

### Per-finding disposition

| Finding | Status | Evidence |
|---|---|---|
| **S6R-01** | **CLOSED** | `overview-bypassed` now fails OV-02/OV-06 through `validateLessonAnalysisGate`, with `/overview/...` affected paths. Worker tests verify repair precedes the overview event, and repeated failure publishes no lesson. Wiring: `lesson.ts:209-217`; gate/repair authority: `analysis-v2.ts:489-508,563-566,592-594`. |
| **S6R-02** | **CLOSED** | `formula-diagonal` now fails FE-08: stored/default `{x:2,y:4}` is checked (page **6**, wrong expression **10**). Samples independently vary variables, include defaults and stored cases; `expression.ts:496-541`, `formula-explorer.ts:698-716`. This is bounded numeric comparison, not proof of arbitrary functional equivalence. |
| **S6R-03** | **PARTIALLY CLOSED** | Cropped exponent, `÷ 2`, and chained `=` probes are rejected. But `formula-thousands-suffix` publishes source `z = x+y+1,000` as `x+y+1`: the new prose-boundary cutter deletes `,000`, producing **7 instead of 1006** at the stored case. Details below. |
| **S6R-04** | **PARTIALLY CLOSED** | The reversed/permuted original formulas fail FE-05/FE-08; explicit-binding and repeated-equal-input controls pass. But `formula-example-exponent-input` binds the prefix `6` of `6e2`, authorizing a formula that gives **20000 instead of 200** at the actual source inputs. Details below. |
| **S6R-05** | **PARTIALLY CLOSED** | `balance-product-token-cut` now fails BAL-01/BAL-09; water positive control passes. But `balance-omitted-product` removes the source's entire final `+ H2O2` product and still passes every check: the source span is only the generated substring with chemical-character edges, not a complete reaction. Details below. |
| **S6R-06** | **CLOSED** | Honest compare-tail append/removal pass. `compare-resize-changes-passing-cell` now fails `repair.no-weakening` at `/rows/0/values/0/value`. `repair.ts:175-176,206-210` removes enclosing resize authority for retained leaves; `kit/index.ts:200-202` bounds the resize to the baseline column count. Own-cell failure paths remain usable. |
| **S6R-07** | **CLOSED** | Executed concurrent-fatal regressions: both settle orders retain both paid/unknown amounts exactly once (synthetic totals **0.51 / 0.50**); fatal-plus-persistence-crash retains **0.25 / 0.20**; one fatal repair is not double-counted. The isolated fake-transport ledger test matches persisted job totals with its ledger. `recordFatal` accounts before storing/emitting terminal metadata; analysis catches do likewise, final `ctx.fail` is non-accounting (`lesson.ts:601-612,654-665,784-791,1418-1420`; shared extractor `job-support.ts:112-171`). |
| **S6R-08** | **CLOSED** | Original `Official NASA-endorsed lesson` fails field-scoped `schema.gen`. The shared display-field sweep participates in dispatch and repair recomputation (`kit/index.ts:123,198`; `policy.ts:49-145`). Both independent “according to the definition” / “according to NASA” controls behave as adjudicated. Executed ruling tests also cover the seven publisher acronyms, ordinary `ocean`, metadata junk, and genuinely on-page hyphenated compare names. No wording-policy re-litigation. |
| **S6R-09** | **PARTIALLY CLOSED** | Original `2` vs `20` with `2` elsewhere on the page is rejected; signed/grouped/currency controls behave correctly. But `quiz-number-elsewhere-in-own-quote` accepts answer **`a value of 2`** inside **`a value of 20`** when an unrelated whole `2` occurs later in the same quote. The containment match and numeric-token occurrence remain detached. Details below; related newly introduced option-equivalence defect is S6R-13. |
| **S6R-10** | **CLOSED** | Both key-point and key-term append controls pass; append plus mutation of a previously passing point fails comparison even though the candidate itself validates. Exact authorised paths, tail-only growth and max counts are enforced (`analysis-v2.ts:545-573`; `repair.ts:206-210`). Oversized analysis lists remain an explicitly documented bounded-repair limitation, not claimed deletion support. |
| **S6R-11** | **CLOSED** | Worker and web tests execute attempt-1-fails / attempt-2-passes, requested-not-injected, injected-not-caught, other-component natural repair, and no-fault cases. Both attempts of the injected component stay system-made; requested-but-not-injected premium repair remains natural. Origin comes from actual successful injection/component identity, not attempt number (`lesson.ts:574-577,1098,1303`; `lessonJob.ts:404-435,463-477`; provenance preserves any system origin). |
| **S6R-12** | **CLOSED** | Executed `evaluation-metrics-s6r12.test.ts` review recipe: kit repair joins total/scoped check counts; kit-only lesson joins published-lesson cost denominator; overview/interactive/premium denominators are separate. Missing component-repair fields are disclosed, injected component repairs excluded, v1 statistics pinned, comparison output tested. `evaluation-budget.ts:499` carries fault origin into result records. No report generator or pre-registered rewrite was run. |

### Remaining wrong-answer paths under the original findings

These are **incomplete closures of the existing findings**, not five new policy-hardening requests. Each full component passed `validateKitComponent` in the saved probes.

**S6R-03 — complete RHS parsing still truncates a numeric token.**  
Location: `packages/validation/kit/formula-explorer.ts:144-152,201`.

- Reproduction `formula-thousands-suffix`: exact source/quote/formulaText **`z = x+y+1,000`**, generated expression **`x+y+1`**, both variables `[1,9]`, stored inputs `{x:2,y:4}`. `parsePageFormulaFromQuote` reports `status:'parsed', rhs:'x+y+1'`; all checks pass. Independent calculator evaluation gives source **1006**, generated **7**.
- Cause: every comma is classified as prose before lexical validation, including a comma inside a printed number. This still manufactures a shorter mathematical expression.
- Minimal fix: recognise complete numeric tokens before treating punctuation as prose. Either normalise supported thousands-grouped literals to their value or mark the entire formula unparseable/fail closed; never successfully parse the prefix. Add the whole-token negative test alongside the existing `÷`/exponent vectors and replay explorers again.

**S6R-04 — an “explicit binding” may still be a prefix of a different value.**  
Location: `packages/validation/kit/formula-explorer.ts:335-338,368-375,434-445`.

- Reproduction `formula-example-exponent-input`: formula quote **`z equals x divided by y`**; worked quote **`With x = 6e2 and y = 3 the result is 200.`**; generated expression **`100*x/y`**, resultNumber 200, tolerance 0.001. Binder returns **`{x:6,y:3}`**, so FE-05 and the unparseable-formula FE-08 bridge pass. At the source's actual `{x:600,y:3}`, page division is **200**, accepted formula is **20000**.
- Cause: the binding guard only excludes attached digits/thousands commas; it does not require the entire RHS numeric expression/token to end. Unsupported notation becomes a supported prefix.
- Minimal fix: enforce a complete-value boundary after every supported binding, including rejecting attached exponent/decimal/operator continuations the binder cannot parse. Unsupported bindings must fail closed, not guess. Keep the positive plain-decimal and repeated-value controls.

**S6R-05 — complete species edges are not a complete reaction span.**  
Location: `packages/validation/kit/shared.ts:332,352-365`; `packages/validation/kit/balance.ts:56-59,108-114,145-147`.

- Reproduction `balance-omitted-product`: exact source/top/species quotes **`The page prints H2 + O2 -> H2O + H2O2.`**, generated equationText **`H2 + O2 -> H2O`**, product list only H2O. All checks pass and the solver returns **`[2,1,2]`** for the truncated reaction; the printed peroxide product disappears.
- Cause: `chemicallyCompleteOccurrences` only tests immediately adjacent alphanumeric/subscript characters. Whitespace followed by `+` is considered a clean edge. `sourceEquationSpan(...).text` is the same generated needle, so parsing it adds no independent source-span authority.
- Minimal fix: locate/extract the maximal reaction containing the arrow, respecting supported species/group/state syntax, and compare its parsed side/formula multiset. At minimum fail closed when a selected edge continues through whitespace into a reaction operator/species. Preserve exact integer balancing.

**S6R-09 — the whole number must belong to the actual matched answer occurrence.**  
Location: `packages/validation/kit/shared.ts:300-324`; `packages/validation/kit/quiz.ts:104,160,206`.

- Reproduction `quiz-number-elsewhere-in-own-quote`: quote **`The experiment records a value of 20 in sample 2.`**, stem **`What value did the experiment record?`**, options **`['a value of 2','other','unknown']`**. All checks pass. The only occurrence of `a value of 2` actually ends inside **20**; the separate sample number **2** supplies the whole-number check.
- Cause: `containsNormalized` and `missingSignedNumbers` search independently over the entire quote. Passing one does not prove the other's token is at the matched answer span.
- Minimal fix: find candidate answer occurrences and validate numeric boundaries/value identity **at that same occurrence**. One unrelated token elsewhere in the quote must not rescue a cropped answer. Share that span-aware predicate across Q-02/Q-05/Q-07; this requires no general entailment model.

### New finding

#### S6R-13 — P1: value-canonical number grounding accepts a numerically identical distractor, but grading rejects it

**Location:** `packages/validation/kit/shared.ts:233-242,300-324`; `packages/validation/kit/quiz.ts:121-133,153-169,200-209`; grading consequence `apps/web/src/lib/quiz.ts:47-55`.

**Reproduction:** `quiz-equivalent-numeric-distractor` changes one otherwise-valid golden card to quote **`The experiment records a value of 5.0.`**, stem **`What value did the experiment record?`**, options **`['5','5.00','unknown']`**. All fixed-validator checks pass. Both numerical choices equal the printed value, but `gradeQuizCard` grades by stored index 0 only, so a learner choosing **5.00** is marked wrong. The quote makes no significant-figure/precision question or distinction.

**Regression evidence:** `baseline-probe.mjs` evaluates that exact candidate with `51896f1`'s pure quiz/shared validators: **not publishable (Q-06)**. The fixed gate returns **publishable with no failures**. Thus this is an actual new acceptance introduced by value canonicalisation, not merely an old unreviewed quiz limitation.

**Cause:** N-01 now equates `5`, `5.0`, and `5.00` by value, correctly, but Q-03 still distinguishes their raw strings; Q-05/Q-07 still require raw substring containment before checking numeric value. `5` is a substring of `5.0`, while `5.00` is not, so the equivalent distractor is not recognised as a second correct option. The checks disagree on what counts as the same numerical answer.

**Minimal fix:** retain value-canonical grounding (do not re-break `828,000 ≡ 828000` / currency values), but use a consistent canonical token/span representation for numerical-option identity and quote matching. At least reject numerically equivalent numeric-only options and recognise equivalent numeric distractors; preserve signs and nonnumeric wording. Add both spelling directions and grouped-number variants, then verify that every published card still has exactly one numerically distinct correct option before index-only grading.

### Historical replay and approval boundary

- **50 explorers:** no publishability changes against their archived reports. Only one declares a source example, so this replay does not establish broad real-world coverage of the new explicit-binding grammar.
- Of the **529** historical artifacts, **8** formerly passing reports now fail: **6 legacy compare gens** have the old `entities/cells` shape instead of `rows` (the compare-grid schema predates this fix wave), plus the **2 already adjudicated catches**: `job-20261029143609-b3ac3e67` quiz options with `>` and `job-20261029145943-048d50e0` Bernoulli `streamline` gloss. The latter quote is “restricts this equation to be true only along a single streamline”; its gloss is “path that confines Bernoulli constant when restrictions apply.” These are not newly discovered false rejections to undo the lead's rulings. Historical verdicts/scores remain unchanged.
- **36** formerly failing archived artifacts now pass (including number-token fixes and old repair-comparison reports absent from pure content revalidation). This is not a new evaluation score or proof those historical jobs would have completed under the new pipeline. All per-artifact differences remain in the scratch replay result.
- Publisher narrowing, on-page hyphenated names, structural-vs-content compare permission, independent sampling, and append-only prefix preservation behaved as intended in the executed controls/tests. No new accounting defect was demonstrated in this round.

**Approval gate:** close the four concrete incomplete grounding paths and S6R-13 (or explicitly decide to disable/degrade the affected output class). Preserve the accepted policy rulings, positive controls, independent sampling and cost/fault-origin fixes. Do not call all S6R-01..12 closed on the basis of the original vectors alone. This re-review stops here; it does not propose another open-ended wording-hardening loop.


## Lead closure (2026-10-30, Claude Opus 5.5)

Final narrow wave (no round 3, per the two-round cap): S6R-03/S6R-04 remaining paths (Qwen 3.8 Max: thousands-grouped numbers parsed by value; e-notation bound as a whole token, `x10^n` fails closed) and S6R-05/S6R-09/S6R-13 (DeepSeek v4.1 Flash: maximal reaction span with fail-closed continuation; numeric identity at the matched answer occurrence; value-equal quiz options rejected under Q-03).

Lead verification on the combined tree: `npm run check` **1816/1816**, web build ok; the round-2 probe script (copied to scratch, results not overwritten) — **every attack vector not publishable**, every control publishable (`formula-control`, `balance-control`, binding and repeated-input controls, `analysis-control`, "according to the definition" control). Replays: 0 verdict changes on 50 stored formula explorers; 0 newly failing on 140 stored quiz gens, the balance gen and 58 analyses.

Known limits kept and disclosed: a printed reaction continuation with no operator and no subscript is not absorbed; an equation printed inside parentheses fails BAL-09 (pre-existing, fails closed); the six-species NOAA chemosynthesis equation exceeds the frozen species limit; oversized analysis lists are not repaired by deletion; `-15 N` is not grounded by a page printing `15 N`.

**Stage 6 review status: closed by the lead** after two independent rounds.
