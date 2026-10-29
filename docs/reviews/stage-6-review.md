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
