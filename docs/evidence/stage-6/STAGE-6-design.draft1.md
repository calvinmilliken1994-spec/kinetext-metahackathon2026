# STAGE 6 DESIGN — Subject Engines + Shared Interactive Component Kit

Status: DESIGN ONLY. No code. Contracts below are frozen by the lead (Opus) before build days.
Deadline: Nov 5. Demo prep from Nov 2. Evaluation baseline: 5b, 29 pages (9 published, 17 declined, 3 failed).

---

## 0. Summary and decisions

### 0.1 What is built

1. `SourceAnalysis` v2 (`source-analysis.gen`): adds `subject`, `overview` (headline + 3-6 key points + 3-8 key terms, all quoted), `componentPlan` (1-3 entries from kit ids + 8 premium engine ids), `usable` / decline fields, `analysisVersion: 2`. Generated in the SAME call as the analysis.
2. Shared kit v1, seven components: `overview-v1`, `quiz-cards-v1`, `sequence-v1`, `sort-groups-v1`, `concept-map-v1`, `compare-table-v1`, `formula-explorer-v1`. Plus one subject-specific component: `balance-equation-v1` (chemistry).
3. Eight premium engines are kept unchanged: `forces-1d-v1`, `projectile-v1`, `lift-equation-v1`, `speed-of-sound-v1`, `compound-interest-v1`, `hardy-weinberg-v1`, `half-life-v1`, `timeline-v1`. The component plan prefers a premium engine only when its `appliesWhen` genuinely fits.
4. Per-subject guidance table `SUBJECT_GUIDANCE` (10 rows) pasted into analysis and component prompts.
5. Pipeline: Call 1 = analysis + overview + plan. Calls 2..4 = one call per planned component, max concurrency 2. Overview renders after Call 1 passes. Components stream in as each passes. Lessons publish partial (overview + passed components). Overview-only is acceptable with a visible reason.
6. Deterministic checks only: quotes verbatim, formulas computed by our code, structure valid, answer keys recomputed. No AI judge. No truth claims. Claim is "this is what the cited sentence says".

### 0.2 What is frozen

- Field names, limits, and check ids in Sections 1-3.
- Expression grammar and evaluator contract for `formula-explorer-v1`.
- Chemical formula parser contract for `balance-equation-v1`.
- Repair discipline: validator-owned `affected` JSON-pointer paths recomputed from revision 1, max 2 repair attempts per call, repairs never weaken (fewer items, looser tolerances forbidden), ids stable.
- Decline criteria (Section 1.5). Decline is reserved for unusable sources.
- Teaching-margin rule: `margin = max(case tolerance, 2% of engine value)`; UI shows the engine value.
- Output budgets per call (Section 5.3). Gen schemas keep every key REQUIRED with sentinels (`""`, `0`, `false`).

### 0.3 What is cut first

1. `concept-map-v1` interactive gap-fill (ship read-only map first).
2. `compare-table-v1` predict-a-cell (ship reveal-only table first).
3. `formula-explorer-v1` graph (ship value + slider table first, add SVG graph second).
4. `balance-equation-v1` hydrate-dot support (ship without hydrates, add if time).
5. Parallel component calls (ship serial Calls 2..4, add concurrency 2 second).
6. MUST NOT CUT: `overview-v1`, `quiz-cards-v1`, `sequence-v1`, `sort-groups-v1`, analysis v2, quote checks, repair loop, partial publish.

---

## 1. New analysis contract (`SourceAnalysis` v2, schema `source-analysis.gen`)

### 1.1 Decision: same-call overview

Overview is generated in the SAME call as the analysis. Justification: one call saves 20-30 s median latency and one full source-input charge; overview fields reuse the same quotes the analysis already selected; failure of overview fails the whole call, which is correct because overview is the minimum publishable unit. Target output budget stays bounded (Section 5.3) because overview adds at most ~900 tokens.

### 1.2 Subject enum and rules

```
subject: "physics" | "maths" | "history" | "finance" | "chemistry" | "biology" | "earth-science" | "civics" | "language-reading" | "other"
```

| Subject | Choose when the page primarily teaches |
|---|---|
| physics | forces, motion, energy, fluids, waves, thermodynamics of physical systems |
| maths | a mathematical procedure, function, proof sketch, or worked computation as the teaching target |
| history | past events, actors, causes, documents, chronology |
| finance | saving, interest, loans, budgets, inflation, financial decisions |
| chemistry | substances, reactions, stoichiometry, concentration, gas laws, nuclear decay as chemistry |
| biology | genes, populations, bodies, ecosystems, classification of living things |
| earth-science | rocks, geologic time, atmosphere, oceans, space, climate |
| civics | law, government process, rights, civic participation |
| language-reading | comprehension of a passage, vocabulary in context, argument and evidence |
| other | none of the above fits, or two subjects tie with no primary |

Rules:

- R-SUB-1: choose exactly one subject. The primary teaching target wins, not the setting. A radioactive-waste policy page is `other` or `civics`, not `chemistry`, when no quantitative chemistry is taught.
- R-SUB-2: `other` disables subject-specific checks and uses generic guidance. It still produces overview + kit components. It never selects `balance-equation-v1`.
- R-SUB-3: chemistry-earth pages map to `chemistry` only when a reaction, stoichiometry, concentration, gas law, or decay computation is taught; to `earth-science` when rocks, time, strata, or planet processes dominate; to `other` when policy dominates. Ties go to `other`.
- R-SUB-4: never name the publisher in any generated string. Subject choice is about content, not source.

### 1.3 Full gen schema

Every key REQUIRED. Sentinels: `""` for absent text, `0` for absent counts, `false` for booleans.

```typescript
interface SourceAnalysisV2 {
  analysisVersion: 2;                    // literal 2
  subject: Subject;                      // Section 1.2 enum
  usable: boolean;                       // true unless Section 1.5 decline criteria met
  declineCode: string;                   // "" when usable; else one of Section 1.5 codes
  declineSummary: string;                // "" when usable; else 1-2 sentences, 10-280 chars, names page coverage
  pageCoverage: string;                  // 1-2 sentences ALWAYS, 10-300 chars: what the page covers (shown on decline)
  overview: OverviewGen;                 // required even on decline when usable=false? No: sentinel-empty (see limits)
  componentPlan: ComponentPlanEntry[];   // 1-3 entries when usable; [] encoded as [] with planCount 0 (see below)
  planCount: number;                     // 0-3, equals componentPlan.length; sentinel for required-keys constraint
  // Backward-compat mirrors (Section 1.6), all REQUIRED:
  supported: boolean;                    // == usable
  activity: string;                      // premium engine id or "none" (first premium entry in plan, else "none")
  unsupportedReason: string;             // "" when usable; else == declineSummary
  concepts: AnalysisConcept[];           // mirror of overview.keyTerms (min 1)
  objectives: string[];                  // 1-4 learner objectives, each 8-140 chars plain text
}

interface OverviewGen {
  headline: string;                      // 1 line, 10-120 chars, AI-written, UI-labelled "AI-written summary"
  keyPoints: KeyPointGen[];              // 3-6 when usable; [] when declined (with pointCount 0)
  pointCount: number;                    // 0,3,4,5,6; sentinel carrier
  keyTerms: KeyTermGen[];                // 3-8 when usable; [] when declined (with termCount 0)
  termCount: number;                     // 0 or 3-8
}

interface KeyPointGen {
  id: string;                            // /^[a-z0-9][a-z0-9-]{0,39}$/
  point: string;                         // AI-written, 10-200 chars, no new facts, no numbers unless in quote
  sourceId: string;                      // exact source id
  quote: string;                          // verbatim, 1-150 chars, one paragraph, no ellipsis
}

interface KeyTermGen {
  id: string;                            // kebab id
  term: string;                          // 1-40 chars plain text
  gloss: string;                         // AI-written, 5-120 chars, no new facts
  sourceId: string;
  quote: string;                          // verbatim term-in-context, 1-150 chars
}

interface ComponentPlanEntry {
  componentId: string;                   // kit id or premium engine id (Section 1.4 list)
  pedagogicalReason: string;             // 10-160 chars, one line: why this component for this page
  focusQuote: string;                    // verbatim 1-150 chars anchoring the page region to use
  focusSourceId: string;                 // exact source id for focusQuote
}

interface AnalysisConcept {
  id: string;                            // kebab
  name: string;                          // 1-60 chars
  evidence: Evidence[];                  // 1-2 entries
}
interface Evidence { sourceId: string; quote: string; } // quote 1-150 chars verbatim
```

Numeric limits (analysis call): `headline` <= 120; `point` <= 200; `gloss` <= 120; `term` <= 40; `pedagogicalReason` <= 160; `focusQuote` <= 150; `objectives` 1-4 items x 8-140 chars; `declineSummary` <= 280; `pageCoverage` <= 300; `keyPoints` 3-6; `keyTerms` 3-8; `componentPlan` 1-3. Target output budget: 2200 tokens max (Section 5.3).

### 1.4 Component plan rules

Allowed `componentId` values: `overview-v1` is implicit (never listed in the plan). Plan entries use: `quiz-cards-v1`, `sequence-v1`, `sort-groups-v1`, `concept-map-v1`, `compare-table-v1`, `formula-explorer-v1`, `balance-equation-v1`, `forces-1d-v1`, `projectile-v1`, `lift-equation-v1`, `speed-of-sound-v1`, `compound-interest-v1`, `hardy-weinberg-v1`, `half-life-v1`, `timeline-v1`.

- R-PLAN-1: 1-3 entries when `usable=true`; 0 entries when `usable=false`.
- R-PLAN-2: premium-first. If a premium engine `appliesWhen` genuinely fits, it is entry 1. "Genuinely fits" means every exclusion clause in its `appliesWhen` passes; near matches are rejected (drag is not projectile; decades are not timeline).
- R-PLAN-3: at most one premium engine per plan. Kit components complement it, never duplicate its teaching target.
- R-PLAN-4: no duplicate component family. At most one entry per `componentId`.
- R-PLAN-5: combining rule. Premium + 1-2 kit components is the default published shape (e.g. `half-life-v1` + `quiz-cards-v1`). Kit-only plans (2-3 kit components) are standard when no premium fits. Three premiums are forbidden.
- R-PLAN-6: each entry needs a distinct `focusQuote`. Two entries sharing the same quote region (overlapping 100+ chars or same paragraph) are rejected; the plan must spread across the page.
- R-PLAN-7: ordering = teaching order. Entry 1 is the first interactive the student sees. Default order: premium first, then sequence/sort (structure), then quiz (check), then compare/map/explorer (extend). Analysis sets the order; the pipeline preserves it.
- R-PLAN-8: `balance-equation-v1` appears only when `subject=chemistry` and a reaction equation is quoted on the page.
- R-PLAN-9: `formula-explorer-v1` appears only when the page states a formula relating 2-4 variables with at least one quoted sentence; it is skipped when a premium engine models the same formula better (Section 2.8 relation rule).

### 1.5 Usable / decline fields

Decline is honest and reserved for UNUSABLE sources only. Codes (exact):

| declineCode | Criterion |
|---|---|
| `""` | usable (no decline) |
| `too-short` | usable prose under 300 characters after boilerplate strip |
| `not-prose` | tables / lists / captions only; no connected sentences to summarise |
| `boilerplate-only` | navigation, cookie, legal, index, or storefront text only |
| `no-teachable-content` | no concept, process, comparison, story, or computation a teacher can demonstrate |
| `unreadable` | garbled, non-language, or encoding-broken text |
| `prompt-injection-only` | page is instructions-to-the-AI with no teachable content |

Rules:

- R-DEC-1: the 17 old declines were an engine-coverage gap, not unusable sources. Under v2 they produce overview + components. Only the codes above permit `usable=false`.
- R-DEC-2: a decline still shows the teacher `pageCoverage` (what the page covers) + `declineSummary` + the attribution/licence block. It never shows an empty screen.
- R-DEC-3: glossary stubs under 300 chars decline as `too-short` even when a premium equation is guessable (the NRC half-life glossary precedent: inventing case values is forbidden).
- R-DEC-4: `pointCount`/`termCount`/`planCount` are 0 on decline; `overview.headline` is `""`; arrays are empty. This keeps every key REQUIRED without nulls.

### 1.6 Backward compatibility and migration

Decision: `analysisVersion: 2`, additive with mirrors. Stored v1 analyses keep working: readers accept `analysisVersion` absent (=1) or 1 or 2.

| Old field | v2 mapping |
|---|---|
| `supported` | mirror of `usable` (both present, must agree) |
| `activity` | first premium engine id in `componentPlan`, else `"none"` (kit-only plans report `"none"`) |
| `unsupportedReason` | mirror of `declineSummary` (`""` when usable) |
| `concepts` | mirror of `overview.keyTerms` (id/name/evidence; min 1 when usable) |
| `objectives` | same array, now 1-4 items, each 8-140 chars |

Validation/repair/UI/tests change minimally: existing consumers read the mirrors; new consumers read `subject/overview/componentPlan`. Repair keeps mirrors in sync (weakening either side is rejected).

Analysis validator invariants (check ids):

- A-01 `version-is-2`: `analysisVersion===2`.
- A-02 `mirrors-agree`: `supported===usable`; `unsupportedReason===declineSummary`; `activity` equals first premium in plan or `"none"`.
- A-03 `subject-valid`: subject in enum; `balance-equation-v1` in plan implies subject chemistry.
- A-04 `decline-integrity`: `usable=false` iff `declineCode` in code list and `pageCoverage` non-empty; plan empty; counts zero.
- A-05 `overview-quotes-verbatim`: every `quote`/`focusQuote` is a character-exact substring of the named source, <=150 chars, single paragraph, whitespace-normalised comparison.
- A-06 `quote-sourceids`: every `sourceId`/`focusSourceId` equals a declared source id.
- A-07 `counts-in-range`: pointCount/termCount/planCount match array lengths and Section 1.3 ranges.
- A-08 `plan-rules`: R-PLAN-2..R-PLAN-9 hold (premium-first, distinct quotes, no duplicate family, max one premium).
- A-09 `no-publisher-claim`: no generated string matches publisher-attribution patterns (`according to`, publisher name from source metadata, `NASA|NRC|USGS|NIJ|CFPB|NARA` in generated text). Sources carry attribution separately.
- A-10 `ai-numbers-checkable`: every integer/decimal in AI-written strings (`headline`, `point`, `gloss`, `pedagogicalReason`, `objectives`, `pageCoverage`) either appears in a quote on the same entry or matches cheap rule N-01 (number token appears verbatim in the page). Failure is repairable by deleting the number or adding the quote.
- A-11 `plain-text`: no markdown/HTML markers (`#`, `*`, `_`, `[`, `]`, `(`, `)`, `<`, `>`, backtick) in generated strings except `^`, `*`, `/`, `+`, `-`, `=` inside formula text fields.

Repairable: A-04..A-08, A-10 (affected = the offending entry path). Not repairable by model rewrite: A-01..A-03 (schema shape errors go to full-call retry, max 2).

### 1.7 Example JSON (one page)

Page: `nasa-grc-drag-equation` (physics, 3158 chars, teaches `D = Cd*rho*V^2*A/2`).

```json
{
  "analysisVersion": 2,
  "subject": "physics",
  "usable": true,
  "declineCode": "",
  "declineSummary": "",
  "pageCoverage": "The page teaches the aerodynamic drag equation and how drag grows with speed, area, and coefficient.",
  "overview": {
    "headline": "AI-written summary: drag grows with speed squared, air density, area, and drag coefficient.",
    "keyPoints": [
      {"id": "drag-equation", "point": "AI-written: drag equals coefficient times dynamic pressure times area.", "sourceId": "src1", "quote": "D = Cd * rho * V^2 * A / 2"},
      {"id": "speed-squared", "point": "AI-written: doubling speed quadruples drag.", "sourceId": "src1", "quote": "drag varies with the square of the velocity"},
      {"id": "reference-area", "point": "AI-written: area means the reference area of the object.", "sourceId": "src1", "quote": "the reference area used for the drag coefficient"}
    ],
    "pointCount": 3,
    "keyTerms": [
      {"id": "drag-coefficient", "term": "drag coefficient", "gloss": "AI-written: number for how streamlined a shape is.", "sourceId": "src1", "quote": "drag coefficient Cd depends on the shape"},
      {"id": "dynamic-pressure", "term": "dynamic pressure", "gloss": "AI-written: airflow energy per volume from speed and density.", "sourceId": "src1", "quote": "dynamic pressure rho * V^2 / 2"},
      {"id": "reference-area", "term": "reference area", "gloss": "AI-written: the area used with the coefficient.", "sourceId": "src1", "quote": "reference area A of the object"}
    ],
    "termCount": 3
  },
  "componentPlan": [
    {"componentId": "formula-explorer-v1", "pedagogicalReason": "Students predict how doubling speed changes drag before moving sliders.", "focusQuote": "D = Cd * rho * V^2 * A / 2", "focusSourceId": "src1"},
    {"componentId": "quiz-cards-v1", "pedagogicalReason": "Checks which factors raise or lower drag.", "focusQuote": "drag varies with the square of the velocity", "focusSourceId": "src1"}
  ],
  "planCount": 2,
  "supported": true,
  "activity": "none",
  "unsupportedReason": "",
  "concepts": [{"id": "drag-equation", "name": "drag equation", "evidence": [{"sourceId": "src1", "quote": "D = Cd * rho * V^2 * A / 2"}]}],
  "objectives": ["Predict how speed, area, and coefficient change drag using the page equation."]
}
```

Note: quotes above are illustrative short forms; the validator requires character-exact page substrings.

---

## 2. Shared component kit

Global conventions for all kit gen schemas: every key REQUIRED with sentinels; strings plain text (no markdown/HTML); ids match `/^[a-z0-9][a-z0-9-]{0,39}$/`; quotes <=150 chars verbatim from one paragraph with exact `sourceId`; AI-written strings carry no new facts and obey rule N-01 for numbers. Per-call output budget: 1500-2500 tokens depending on component (Section 5.3).

### 2.1 `overview-v1` — Page overview

(a) Purpose and when it fits / does not fit. Purpose: the minimum publishable unit on every usable page. Teacher reads headline + key points + key terms in under a minute, then launches interactives. Fits every usable page. Does not fit declined pages (decline card shown instead). It is generated inside Call 1, not as a separate component call.

(b) Generation schema. Reuses `OverviewGen` from Section 1.3 (headline, keyPoints 3-6, keyTerms 3-8, counts). No separate gen call. Limits: headline 10-120; point 10-200; term 1-40; gloss 5-120; quotes 1-150.

(c) What the system adds. `specId`, `revision: 1`, `sources[]` with attribution/licence, `provenance {analysisVersion, model, timestamp}`, UI label "AI-written summary" on headline/points/glosses, quote citations under each item. No shuffle. No answer key.

(d) Deterministic checks.

- OV-01 `quotes-verbatim`: each quote is an exact page substring, <=150, one paragraph. Limit: proves the sentence exists, not that the point paraphrase is faithful. Repairable: yes (`affected`: `/overview/keyPoints/{i}/quote`).
- OV-02 `term-in-quote`: each key term label appears as a case-insensitive substring of its own quote. Limit: lexical match only, not definitional correctness. Repairable: yes.
- OV-03 `no-publisher-text`: Section A-09 pattern. Repairable: yes (rewrite string).
- OV-04 `numbers-checkable` (rule N-01): numbers in AI text appear in page or same quote. Limit: does not check arithmetic. Repairable: yes.
- OV-05 `counts-valid`: 3-6 points, 3-8 terms, counts match. Not repairable by narrowing (weakening forbidden); repair by full-call retry only.

(e) Rendering. Layout: `OverviewView` card stack. Headline with "AI-written" badge (`Disclosure`). Points as numbered list; each expands to its quote via existing `cite` prop pattern. Terms as definition list with quotes. States: loading skeleton, ready, failed (decline card). Accessibility: semantic headings/list, full keyboard, no drag. Reuses: `Disclosure`, `Explanations`, `cite` props. Student steps: none (read-only); teacher flow is read, then picks a component. Predict/commit/reveal does not apply.

(f) Failure/degrade. If overview fails after repair, the job fails with reason shown (no overview-only fallback when overview itself is invalid). Job receipt records `overviewFailed` + validator findings. This is the only component whose failure fails the lesson.

### 2.2 `quiz-cards-v1` — Quiz cards (predict then reveal)

(a) Purpose. Predict-then-reveal factual check for lectures. Fits pages stating 3+ checkable facts (definitions, values, causes, outcomes). Does not fit pure narratives without discrete answers, or pages where answers need computation (use formula explorer or premium engine instead).

(b) Generation schema (Muse writes).

```typescript
interface QuizCardsGen {
  schemaVersion: "quiz-cards-v1";
  title: string;                       // 8-80 chars
  cards: QuizCardGen[];                // 3-5 items
  cardCount: number;                   // 3-5, equals cards.length
}
interface QuizCardGen {
  id: string;                          // kebab
  stem: string;                        // AI-written question, 10-160 chars, no new facts
  options: string[];                   // 3-4 items, each 1-80 chars, plain text
  optionCount: number;                 // 3-4
  correctIndex: number;                // 0-based SENTINEL: Muse writes 0 always; system recomputes
  sourceId: string;
  quote: string;                        // verbatim <=150 chars; states the answer
  answerText: string;                  // 1-80 chars; Muse proposal, system verifies or repairs
  hint: string;                        // "" or 5-120 chars AI-written, no new facts
}
```

Limits: cards 3-5; options 3-4; stem <=160; option <=80; hint <=120. Output budget 1800 tokens.

(c) System adds. Stable `id`s (Muse ids kept when valid, else regenerated once and frozen), `provenance`, seeded Fisher-Yates shuffle (`seed` stored per card set; shuffle happens client-side from seed so order is reproducible), recomputed answer key: `correctIndex` is set by OUR code to the index whose option text matches `answerText` under normalisation (trim, collapse whitespace, case-insensitive); ties/misses fail validation. `Disclosure` "options written by AI" label.

(d) Checks.

- Q-01 `quote-verbatim`: quote exact, <=150, one paragraph. Limit: existence only. Repairable (`/cards/{i}/quote`).
- Q-02 `answer-in-quote`: normalised `answerText` is a substring of normalised `quote`. Limit: does not prove the question asks for that answer. Repairable (`/cards/{i}/answerText`).
- Q-03 `options-distinct`: normalised options pairwise distinct; correct answer appears exactly once after recompute. Limit: does not prove distractors are plausible. Repairable (`/cards/{i}/options`).
- Q-04 `stem-no-answer-leak`: no option text appears verbatim inside `stem` (prevents giveaway). Repairable.
- Q-05 `one-correct`: recompute yields exactly one match. Not repairable by loosening; repair replaces `answerText` or one option.
- Q-06 `numbers-checkable` (N-01) on stem/options/hint. Repairable.

(e) Rendering. Reuses `PredictionCards`: stem shown, options as buttons (radio-group semantics), student commits (select + lock), then reveals answer + quote via `cite` + `EventEvidence`-style block. States: unanswered, committed (locked, can change before reveal only), revealed (correct/incorrect vs engine key, quote shown). Keyboard: arrows + Enter/Space; no drag. Shuffle seeded per mount. Explanations: one-line AI hint pre-reveal, quote post-reveal.

(f) Failure/degrade. Failed cards are dropped individually when possible (validator `affected` paths); if fewer than 3 cards survive, the whole component fails and the lesson publishes without it, with teacher-visible reason "Quiz cards could not be verified against the page." No unverified card is shown.

### 2.3 `sequence-v1` — Sequence / process

(a) Purpose. Generalises the timeline ordering activity to undated processes (water cycle, bill-to-law, digestion, loan steps). Fits pages describing 4-8 steps with a statable order. Does not fit when order is not teachable (independent facts) or when dates decide order and 5+ exact dates exist (use `timeline-v1` instead).

(b) Generation schema.

```typescript
interface SequenceGen {
  schemaVersion: "sequence-v1";
  title: string;                       // 8-80
  steps: SequenceStepGen[];            // 4-8
  stepCount: number;                   // 4-8
  orderNote: string;                   // "" or 5-120 chars AI-written (e.g. "in the order the page describes")
}
interface SequenceStepGen {
  id: string;                          // kebab
  label: string;                       // 1-80 chars
  sourceId: string;
  quote: string;                        // verbatim <=150; the step stated on the page
  orderHint: string;                   // "" or 1-60 chars AI-written, no new facts
}
```

Limits: steps 4-8; label <=80. Budget 1800 tokens. Order is the array order (position 0 = first). No separate order array (keeps output small).

(c) System adds. Stable ids, provenance, seeded shuffle for the ordering task, answer key = array order recomputed by OUR code (no trust in any index Muse writes; Muse writes no index). Transition words stripped from grading (grading is position equality only).

(d) Checks.

- SEQ-01 `quotes-verbatim` (each step). Repairable per step.
- SEQ-02 `labels-in-quotes`: each label appears (case-insensitive normalised) in its own quote. Limit: does not prove the label means the step. Repairable.
- SEQ-03 `order-signal`: at least one of (i) page numbering/lettering captured in quotes in order, or (ii) explicit sequence words (`first|then|next|after|before|finally|step \d`) across the step quotes in array order, or (iii) `orderNote` empty and validator accepts process order from quote offsets ascending in source order. Honest limit: proves an order signal exists, not that the scientific order is correct. Teacher sees quotes. Repairable by reordering steps only when quote offsets support it (`affected`: `/steps` whole array; ids stable).
- SEQ-04 `distinct-steps`: labels pairwise distinct (normalised). Repairable.
- SEQ-05 `count-valid`: 4-8 steps. Repair by retry only (removing steps weakens; forbidden).
- SEQ-06 `numbers-checkable` on labels/hints.

(e) Rendering. Reuses `OrderActivity` (drag AND Up/Down buttons, keyboard accessible, seeded shuffle, check-against-key). Student: sees shuffled steps, orders them (predict/commit), presses Check, sees correct order with per-step quotes (`EventEvidence`). States: unsorted, checked (score + per-item right/wrong), revealed. A11y: listbox with move buttons; drag is optional enhancement only.

(f) Failure/degrade. If order signal fails after repair, component fails; lesson publishes without it with reason "Steps could not be ordered from the page wording." Individual bad steps are dropped only when 4+ valid steps remain, else whole component fails.

### 2.4 `sort-groups-v1` — Sort into groups

(a) Purpose. Classification: drag items into 2-4 categories (igneous/sedimentary/metamorphic; assets/liabilities; producers/consumers). Fits pages naming categories with member examples. Does not fit when membership is arguable from the page, when only one group exists, or when groups overlap without page-stated criteria.

(b) Generation schema.

```typescript
interface SortGroupsGen {
  schemaVersion: "sort-groups-v1";
  title: string;                       // 8-80
  groups: SortGroupGen[];              // 2-4
  groupCount: number;                  // 2-4
  items: SortItemGen[];                // 6-12
  itemCount: number;                   // 6-12
}
interface SortGroupGen { id: string; label: string; } // label 1-40 chars
interface SortItemGen {
  id: string;                          // kebab
  label: string;                       // 1-60 chars
  groupId: string;                     // must equal one groups[].id
  sourceId: string;
  quote: string;                        // verbatim <=150 stating item-in-group
}
```

Limits: groups 2-4; items 6-12; item label <=60. Budget 2000 tokens.

(c) System adds. Stable ids, provenance, seeded initial pile order, answer key = `groupId` per item recomputed by OUR code from validated mapping (Muse mapping is the claim; validator checks each link has a quote; repair only replaces quote or groupId when the quote supports it). Group labels are AI-written and labelled as such.

(d) Checks.

- SORT-01 `quotes-verbatim` per item. Repairable per item.
- SORT-02 `item-and-group-in-quote`: normalised item label AND group label both appear in the item quote. Honest limit: proves co-mention, not taxonomic truth. Weakly supported links are the known risk; teacher sees every quote. Repairable (`/items/{i}/quote` or `/items/{i}/groupId` when quote supports another listed group).
- SORT-03 `groups-covered`: each group has >=2 items. Repair by retry only.
- SORT-04 `distinct-items`: item labels distinct. Repairable.
- SORT-05 `counts-valid`: 2-4 groups, 6-12 items. Retry only.
- SORT-06 `numbers-checkable` on labels.

(e) Rendering. New `SortView` reusing `PredictionCards` commit/reveal pattern + `OrderActivity` keyboard model: items as buttons, group columns as targets; keyboard: focus item, press 1..4 to assign, Enter to commit, Check button. No drag-only: click/tap and keyboard paths are complete. Student: assigns all items (predict), commits, reveals per-item quotes. States: sorting, committed, revealed (score + quotes).

(f) Failure/degrade. Items failing SORT-02 after repair are dropped when >=6 items and >=2 per group remain; else whole component fails with reason "Group membership could not be verified against the page."

### 2.5 `concept-map-v1` — Concept map

(a) Purpose. Shows how 4-8 ideas connect (edges labelled "causes", "needs", "is part of"), then asks one gap-fill (which link completes the map). Fits pages stating relationships explicitly. Does not fit fact lists without stated links, or pure sequences (use sequence), or pure comparisons (use compare table).

(b) Generation schema.

```typescript
interface ConceptMapGen {
  schemaVersion: "concept-map-v1";
  title: string;                       // 8-80
  nodes: MapNodeGen[];                 // 4-8
  nodeCount: number;                   // 4-8
  links: MapLinkGen[];                 // 3-10
  linkCount: number;                   // 3-10
  gapLinkIndex: number;                // 0-based; Muse writes 0; system recomputes (sentinel)
}
interface MapNodeGen { id: string; label: string; } // label 1-40
interface MapLinkGen {
  id: string;
  fromId: string;                      // node id
  toId: string;                        // node id, fromId != toId
  relation: string;                    // 1-24 chars, closed vocab: "causes|needs|is part of|uses|follows|contrasts with"
  sourceId: string;
  quote: string;                        // verbatim <=150 stating the link
}
```

Closed relation vocab keeps checks lexical. Budget 2000 tokens.

(c) System adds. Stable ids, provenance, layout computed client-side (fixed radial layout by index; no model coordinates), gap question computed by OUR code: hide one link (deterministic: link whose quote is longest, tie-break lowest id), student picks relation + target from closed options; answer key recomputed from stored link.

(d) Checks.

- CM-01 `quotes-verbatim` per link. Repairable per link.
- CM-02 `endpoints-in-quote`: both node labels appear in the link quote (normalised). Limit: co-mention only; weak links disclosed via visible quotes. Repairable.
- CM-03 `relation-in-quote`: relation stem (`caus|need|part|use|follow|contrast`) appears in quote, OR relation is `follows` with sequence words present. Limit: lexical only. Repairable (change relation within closed vocab when quote supports it).
- CM-04 `graph-connected`: underlying undirected graph is connected; no self-loops; no duplicate (fromId,toId) pairs. Retry/repair by dropping the offending link when counts still hold (dropping is weakening: allowed only when linkCount stays >=3; else retry).
- CM-05 `counts-valid`: nodes 4-8, links 3-10. Retry only.
- CM-06 `numbers-checkable` on labels.

(e) Rendering. `ConceptMapView`: SVG nodes + labelled edges (read-only first), then gap mode: one edge hidden, student selects relation (6 buttons) + target node (listbox), commits, reveals with quote. Keyboard complete. Reuses `Disclosure`, `cite`, `PredictionCards` commit pattern. Day-1 fallback: read-only map + quote list (gap-fill ships day 2-3; Section 7).

(f) Failure/degrade. Bad links dropped while CM-04/CM-05 hold; else component fails with reason "Connections could not be verified against the page." Map never renders unverified links.

### 2.6 `compare-table-v1` — Compare table

(a) Purpose. Side-by-side comparison of 2-4 entities across 2-5 attributes (savings options, amendments, rock types). Fits pages contrasting named entities on shared dimensions. Does not fit single-entity pages or pages without parallel attributes.

(b) Generation schema.

```typescript
interface CompareTableGen {
  schemaVersion: "compare-table-v1";
  title: string;                       // 8-80
  entities: string[];                  // 2-4, each 1-40 chars
  entityCount: number;                 // 2-4
  attributes: string[];                // 2-5, each 1-40 chars
  attributeCount: number;              // 2-5
  cells: CompareCellGen[];             // entityCount * attributeCount, row-major
  cellCount: number;
  predictCell: number;                 // index into cells[]; Muse writes 0; system recomputes
}
interface CompareCellGen {
  id: string;
  entityIndex: number;                 // 0-based, must match position
  attributeIndex: number;              // 0-based, must match position
  value: string;                       // 1-80 chars plain text
  sourceId: string;
  quote: string;                        // verbatim <=150 stating the cell fact
}
```

Budget 2200 tokens. Keep tables small: max 4x5=20 cells.

(c) System adds. Stable ids, provenance, `predictCell` chosen by OUR code (cell whose value is shortest non-trivial, deterministic), answer key = cell value recomputed from validated cells. Entity/attribute headers labelled AI-written.

(d) Checks.

- CT-01 `quotes-verbatim` per cell. Repairable per cell.
- CT-02 `cell-in-quote`: normalised cell value appears in its quote AND the entity name appears in the same quote (attribute name may appear in quote or header; headers are AI-written). Limit: does not prove the attribute framing is the page's. Repairable.
- CT-03 `shape-valid`: cellCount == entityCount*attributeCount; indices match positions; entities/attributes distinct. Retry only (shape errors are structural).
- CT-04 `numbers-checkable` on values/headers. Repairable.
- CT-05 `predict-cell-valid`: predicted cell value length >=2 and quote passes CT-01/02. System recomputes; failure falls back to reveal-only table (no prediction) rather than failing the component.

(e) Rendering. `CompareView`: HTML table with row/column headers; predict mode hides `predictCell` value (student types or picks from 3 seeded options built from same-column values, then reveals with quote); reveal-only fallback shows all cells with per-cell quote expansion. Keyboard: table navigation + option buttons. Reuses `PredictionCards`, `cite`, `Disclosure`.

(f) Failure/degrade. Cells failing CT-02 are blanked (shown as "Not stated on this page") when shape still holds; if >25% cells blank or predict cell invalid, ship reveal-only; if shape invalid after repair, component fails with reason "Comparison could not be verified against the page."

### 2.7 `formula-explorer-v1` — Formula explorer (full spec)

(a) Purpose. For pages stating a formula relating 2-4 variables but matching no premium engine (drag equation, gas laws, loan/inflation variants, geometry). Student moves sliders, watches value/graph, predicts before revealing. Does NOT fit: pages with 5+ variables, vector/calculus relations, unit-conversion tables only, or formulas needing conditionals. When a premium engine genuinely fits the same formula, the premium is preferred (relation rule below).

(b) Generation schema (Muse writes).

```typescript
interface FormulaExplorerGen {
  schemaVersion: "formula-explorer-v1";
  title: string;                       // 8-80
  formulaText: string;                 // 1-120 chars, as on page (e.g. "D = Cd * rho * V^2 * A / 2")
  sourceId: string;
  quote: string;                        // verbatim <=150 containing formulaText (normalised match)
  expression: string;                  // 1-120 chars, ASCII safe-grammar RHS only (e.g. "Cd * rho * V^2 * A / 2")
  variables: FormulaVarGen[];          // 2-4
  variableCount: number;               // 2-4
  xVariable: string;                   // name of graph x-axis variable, must be in variables[]
  cases: FormulaCaseGen[];            // 2-4
  caseCount: number;                   // 2-4
  sourceExample: FormulaExampleGen;    // required keys; sentinel-empty when absent
  hasSourceExample: boolean;           // true iff page states a worked numeric example
}
interface FormulaVarGen {
  name: string;                        // /^[a-z][a-z0-9_]{0,11}$/
  meaning: string;                     // 1-80 chars
  meaningQuoted: boolean;              // true iff meaning is page wording (then quote required)
  quote: string;                        // verbatim <=150 when meaningQuoted else ""
  unit: string;                        // "" or 1-24 chars plain text (AI-labelled when not quoted)
  min: number; max: number;            // slider range, finite, min < max, range ratio <= 1e6
  default: number;                     // within [min,max], finite
}
interface FormulaCaseGen {
  id: string;
  inputs: Record<string, number>;      // keys exactly variables[].name; values finite
  expected: number;                    // SENTINEL: Muse writes 0; system recomputes
  tolerance: number;                   // >0, relative-or-absolute rule below; Muse proposes, system caps
}
interface FormulaExampleGen {
  quote: string;                        // verbatim <=150 stating inputs AND result number, or "" when absent
  resultNumber: number;                // 0 sentinel when absent
  tolerance: number;                   // 0 sentinel when absent; else >0
}
```

Note on `inputs` with REQUIRED-keys constraint: JSON Schema `additionalProperties` carries the variable names; the validator enforces exact key set equality with `variables[].name`. No optional keys anywhere; `sourceExample.quote=""`, `resultNumber=0`, `tolerance=0` when `hasSourceExample=false`.

(c) What the system adds. `specId`, `revision`, `provenance`, parsed AST (OUR parser; never executed model code), slider step sizes (computed: `(max-min)/100`, rounded to 3 sig figs), sample table (101 points over `xVariable` range holding other variables at defaults), SVG graph path (computed client-side from evaluator), recomputed `expected` per case, `correctIndex`-style answer key for the predict step (predict the output at given inputs before reveal), `Disclosure` labels.

(d) Safe expression grammar (exact).

```
Expr    := Term (("+" | "-") Term)*
Term    := Factor (("*" | "/") Factor)*
Factor  := Unary ("^" Unary)?            // right-assoc single ^; chained ^ is rejected
Unary   := "-" Unary | Primary
Primary := Number | Variable | FuncCall | Constant | "(" Expr ")"
FuncCall:= ("sqrt"|"exp"|"log"|"sin"|"cos") "(" Expr ")"
Constant:= "pi" | "e"
Number  := /[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/
Variable:= /^[a-z][a-z0-9_]{0,11}$/
```

Tokenization: ASCII only (normalize unicode minus/superscripts before parse and reject if ambiguous); whitespace ignored; `^` is exponent; `**` rejected; implicit multiplication (`2V`, `)(`) rejected; function names lowercase exact; `pi`, `e` are constants. Limits: `expression` <=120 chars; AST nodes <=50; variables 2-4; exponent magnitude: `|exponent| <= 100` and `|base^exp|` must be finite (else domain error); name pattern above; reserved names (`sqrt,exp,log,sin,cos,pi,e`) cannot be variable names. Domain errors: division by zero, `sqrt(x<0)`, `log(x<=0)`, `0^negative`, overflow to non-finite all yield `NaN` + UI message "Not defined for these inputs"; NaN never grades as correct. Evaluation: IEEE-754 double; display rounding: 6 significant figures (shortest round-trip for integers); grading tolerance per case: `tol = max(case.tolerance, 2% of |engine value|)` consistent with the teaching-margin rule; UI shows the engine value. Graph: `xVariable` on x-axis; sliders for all variables; units text beside each slider; 101 sample points; y auto-scaled to finite samples; NaN points break the line (gap, not zero).

(e) Checks.

- FE-01 `formula-quoted`: normalised `formulaText` appears in `quote`, quote verbatim. Limit: proves transcription, not physical truth. Repairable (`/quote` or `/formulaText`).
- FE-02 `expression-parses`: OUR parser accepts `expression` within limits; variable set equals `variables[].name`. Not repairable by loosening grammar; repair rewrites expression only.
- FE-03 `variables-declared`: every variable has meaning; when `meaningQuoted=true`, quote verbatim and contains the variable name or meaning stem; when false, meaning is UI-labelled AI-written and contains no numbers failing N-01. Repairable.
- FE-04 `cases-recomputed`: OUR evaluator recomputes each `expected`; Muse value ignored; `tolerance` capped to `[1e-9, 0.25]` relative; inputs within slider ranges and finite. Limit: proves self-consistency, not that inputs are pedagogically good. Repairable (`expected` is system-set; `affected`: `/cases/{i}/inputs` or `/cases/{i}/tolerance`).
- FE-05 `sourceExample-check`: REQUIRED when the page states a worked numeric example with all inputs and a result number in one quotable passage (`hasSourceExample=true`); then `sourceExample.quote` is verbatim, contains the result number token, and `|eval(inputs)-result| <= tol`. OPTIONAL otherwise (`hasSourceExample=false` with sentinels). Limit: proves the explorer reproduces the page example, not that the example is true. Repairable once; persistent mismatch flips `hasSourceExample=false` only when re-read shows no single quotable example (validator decision, not model choice).
- FE-06 `ranges-sane`: min<max, finite, ratio<=1e6, default inside. Repairable.
- FE-07 `numbers-checkable` (N-01) on title/meanings/units. Repairable.

(f) Rendering. `FormulaExplorerView`: formula line + quote (`cite`); sliders per variable with units; value readout (6 sig figs); SVG graph (x = `xVariable`, 101 points); Predict step: given case inputs, student enters estimate, commits, system grades within `margin = max(tolerance, 2% engine value)` and shows engine value; then Reveal shows quote. Keyboard: sliders are native range inputs. Reuses `PredictionCards` (predict), `Graph` (existing numeric graph), `Disclosure`, `Explanations`.

(g) Relation to premium engines and grading. Prefer premium when its `appliesWhen` genuinely fits (premium has tested pedagogy, units, and worked ranges). Use explorer when: formula is on the page but no premium matches (drag, gas laws with T in K, savings/inflation variants, geometry/trig like glide `tan(a)=h/d`); or premium exclusions fire (drag present, amortisation, selection/drift). Never wrap a premium formula in the explorer to dodge premium checks. Prediction grading uses the same margin rule as numeric engines; the UI always shows the engine value after commit.

(h) Failure/degrade. Parse failure or FE-04 mismatch after repair fails the component with reason "The formula could not be checked with our calculator." FE-05 mismatch alone drops to `hasSourceExample=false` (explorer still ships when FE-01..FE-04 pass). No unverified expected value is ever shown.

### 2.8 Cross-component rendering notes

All kit views mount under `ActivityPanel` dispatch by `componentId` with `key={spec.id}`. Shared chrome: `ActivityHeader` (title, objectives, repair badge), `Disclosure` (AI-written labels), `cite` props for quotes, `EventEvidence`/`Explanations` for reveal quotes. Unknown component ids render the existing "Unknown activity type" fallback (unchanged behaviour).

---

## 3. Chemistry component: `balance-equation-v1` — Balance the equation

(a) Purpose and when it fits / does not fit. Purpose: student balances a chemical equation by adjusting per-species coefficients with live atom counts, then checks against OUR exact integer count. Fits chemistry pages stating a reaction with an equation (unbalanced or balanced) involving 2-5 species. Does not fit: nuclear decay prose without a reaction equation, pages without any equation, redox in acidic/basic half-reaction form needing H+/e- bookkeeping beyond whole-species coefficients, or polymer/organic mechanisms with undefined products. Requires `subject=chemistry`.

(b) Generation schema (Muse writes vs OUR code derives).

```typescript
interface BalanceEquationGen {
  schemaVersion: "balance-equation-v1";
  title: string;                       // 8-80
  equationText: string;                // 1-160 chars, as on page (e.g. "H2 + O2 -> H2O")
  sourceId: string;
  quote: string;                        // verbatim <=150 containing equationText (normalised match)
  species: BalanceSpeciesGen[];        // 2-5
  speciesCount: number;                 // 2-5
  solution: number[];                  // Muse proposal, length == speciesCount, each 1-12; SYSTEM RECOMPUTES
  hint: string;                        // "" or 5-120 chars AI-written
}
interface BalanceSpeciesGen {
  id: string;                          // kebab
  formula: string;                     // 1-40 chars (e.g. "H2O", "Ca(OH)2", "CuSO4·5H2O" when hydrates enabled)
  side: string;                        // "left" | "right"
  quote: string;                        // "" or verbatim <=150; species-level quote optional (equation quote suffices)
  hasQuote: boolean;                   // true iff quote non-empty
}
```

Muse writes: equation text, species split with sides, a proposed solution (ignored for grading), hint. OUR code derives: parsed composition per species (element -> count per molecule), atom totals per side as a function of coefficients, the lowest-whole-number solution (recomputed by brute force over 1..12 then gcd-normalised), the answer key, and the live count table.

(c) Chemical-formula parser spec (OUR code, exact).

- Alphabet: element symbols `[A-Z][a-z]?` (1-2 letters). Unknown symbols (X, R, placeholders) rejected.
- Digits: subscripts `[0-9]+` after symbol or group; value 1-999; leading zeros rejected.
- Groups: parentheses `()` only, nesting depth <=2 (e.g. `Ca(OH)2`, `Al2(SO4)3`). Brackets `[]` rejected.
- Hydrate dots: `·` (U+00B7), `.` (U+002E), `•` accepted as dot, splitting adduct parts (e.g. `CuSO4·5H2O` = CuSO4 + 5*H2O). Day-1 build ships WITHOUT hydrates (dot rejected); hydrates enabled only if time allows (Section 7 cut list). Decision recorded here so implementers branch once.
- Normalisation: unicode subscripts `₀-₉` mapped to digits; arrows `→`, `⇒`, `⇌` mapped to `->` for `equationText` matching only (stored text keeps page form); whitespace collapsed; `+` separators required between species on the same side.
- Charges: EXCLUDED. Superscripts, `+`/`-` charge marks inside formulas (`Fe3+`, `SO4^2-`), and ionic half-equations with `e-` are rejected at validation (BAL-02). Rationale: keeps the integer-balance check exact and small; redox ions return as `quiz-cards-v1` or `formula-explorer-v1` instead.
- State symbols (`(s)`, `(l)`, `(g)`, `(aq)`) are stripped before parsing and ignored (explicitly NOT verified).
- Limits: species 2-5; total distinct elements 1-8; per-species atom sum <=40; coefficients 1-12; brute-force search space bounded (12^5 worst case pruned by per-element equations; wall-bounded in OUR code, not model code).

(d) Deterministic checks.

- BAL-01 `equation-quoted`: normalised `equationText` appears in verbatim `quote`. Limit: proves the reaction is page-stated, not invented. Repairable (`/quote`, `/equationText`).
- BAL-02 `formulas-parse`: every `formula` parses under (c) with charges/hydrates-per-build-flag enforced; sides split matches `equationText` sides. Limit: syntax only. Repairable (formula spelling only when quote supports it).
- BAL-03 `atom-balance-exact`: for the SYSTEM-RECOMPUTED solution, per-element totals left == right exactly (integers). This is computed, not model-asserted. Unrepairable by model; failure means wrong species set (full retry).
- BAL-04 `lowest-terms`: gcd of system solution == 1 and no all-even reduction exists; solution is the lexicographically smallest lowest-terms solution found. Limit: proves minimality within coefficient range 1-12. System-set; not model-repairable.
- BAL-05 `solution-exists`: a balancing with coefficients 1-12 exists. If not, component fails (page equation may be incomplete or need excluded chemistry). Retry only.
- BAL-06 `coefficient-range`: Muse `solution` values 1-12 (shape check; values ignored for grading). Repairable but irrelevant post-recompute.
- BAL-07 `numbers-checkable` on title/hint. Repairable.

NOT verified: that the reaction occurs in reality; reaction conditions; catalysts; state symbols; ionic charges (excluded); reaction enthalpy or rate.

(e) Rendering. `BalanceView`: equation line + quote (`cite`); per-species steppers (1-12, native buttons + number input, keyboard complete); live atom-count table (rows = elements, columns = left/right/total, updated by OUR counter on every change); Check button compares against system solution (exact match required; no tolerance); Reveal shows balanced equation + per-element counts + quote. States: editing, checked-correct, checked-incorrect (counts shown, solution hidden), revealed. Reuses `PredictionCards` commit pattern, `Disclosure` ("hint written by AI"), `cite`. No drag.

(f) Failure/degrade. BAL-01/BAL-02 failure after repair fails the component with reason "The reaction equation could not be verified against the page." BAL-03/BAL-05 failure fails the component (never show an unbalanced "solution"). No partial balance view is shown with a wrong key.

---

## 4. Per-subject guidance

Each row is paste-ready into `SUBJECT_GUIDANCE[subject]` for analysis and component prompts. Order listed = default component preference when no premium fits. Pitfalls are hard constraints. Subject checks are additional validator rules (light, lexical/structural only).

### 4.1 Physics

- Fits (ordered): premium engine when `appliesWhen` fits; else `formula-explorer-v1`, `quiz-cards-v1`, `sequence-v1` (derivation steps), `compare-table-v1` (regimes).
- Examples: (1) Drag page: explorer on `D=Cd*rho*V^2*A/2` + quiz on speed-squared scaling. (2) Free-fall table page: `sequence-v1` on 1-second interval reasoning + quiz on constant-g facts.
- Guidance (paste): "Prefer the premium engine only when its appliesWhen fits exactly; near matches are rejected. Quote the equation character-for-character including exponents and units. Keep worked numbers inside quotes; never carry annuity-style multi-step results into lump-sum cases. For derivations, use sequence steps in page order. Label unit conversions as AI-written unless the page states them."
- Pitfalls: unit mixing (imperial vs SI); confusing net force with weight; importing vertical motion into horizontal-only pages; Smeaton-coefficient ambiguity.
- Check: PHY-01 `units-present`: explorer `unit` non-empty for physics variables or `""` with AI label; failure is warning-only (does not block publish).

### 4.2 Maths

- Fits: `formula-explorer-v1` (function graph), `sequence-v1` (worked-example stepper), `quiz-cards-v1` (definitions/conditions).
- Examples: (1) Quadratic page: explorer on `y=ax^2+bx+c` with slider on `a` + sequence of completing-the-square steps. (2) Probability page: sequence of tree-diagram steps + quiz on conditions.
- Guidance: "Turn each worked example into a sequence before adding an explorer. Quote the function exactly. Declare domain restrictions stated on the page (e.g. denominator nonzero) as AI-labelled notes, never as new claims. Keep every number in AI text inside a quote."
- Pitfalls: inventing steps the page skips; dividing by expressions without stated nonzero condition; over-generalising example numbers.
- Check: MTH-01 `example-quoted`: when `hasSourceExample=true`, FE-05 applies; maths pages default `hasSourceExample=true` when any worked numbers appear.

### 4.3 History

- Fits: `timeline-v1` when 5+ exact dates; else `sequence-v1` (cause-effect chain), `quiz-cards-v1` (primary-source facts), `compare-table-v1` (then/now, two documents).
- Examples: (1) Louisiana Purchase intro: sequence (treaty signed -> expansion -> tensions) + quiz on dates stated. (2) Bill of Rights: compare table (12 proposed vs 10 ratified vs 27th) + quiz.
- Guidance: "Use timeline-v1 only with five exact dates stated in page text; decades and circa never qualify. Otherwise build cause-and-effect sequences in page order and quote the connective sentence for each link. Quote short primary-source phrases verbatim. Never merge two sources dates; each quote carries its own sourceId."
- Pitfalls: decade-dated events forced into timeline; ordering by background knowledge instead of page wording; unattributed agency-intro text treated as transcript.
- Check: HIS-01 `no-circa-timeline`: timeline plans rejected when any focusQuote contains `circa|decade|early \d|s|that summer`.

### 4.4 Finance

- Fits: `compound-interest-v1` when lump-sum compounding is taught; else `formula-explorer-v1` (loans, savings, inflation), `compare-table-v1` (options), `quiz-cards-v1` (definitions).
- Examples: (1) Teen saving page: explorer on annuity-vs-lump-sum kept strictly lump-sum + compare (start at 14 vs 35). (2) Education guide: sequence of compounding steps ($1,000 -> $1,050 -> $1,102.50) + quiz.
- Guidance: "Never publish annuity numbers as lump-sum cases. Quote the rate, frequency, and time basis exactly. Keep worksheet totals out unless their inputs are on the same page. Compare options side by side instead of merging them into one formula."
- Pitfalls: dangling answer-key totals from companion PDFs; frequency confusion (APR vs APY); inflation adjustments without a stated formula.
- Check: FIN-01 `no-annuity-as-lump`: compound cases rejected when case inputs imply recurring deposits (validator flags repeated same-year inputs).

### 4.5 Chemistry

- Fits: `half-life-v1` when decay computation taught; `balance-equation-v1` when a reaction equation is stated; else `formula-explorer-v1` (gas laws, concentration), `quiz-cards-v1`, `sequence-v1` (procedure).
- Examples: (1) Plutonium backgrounder: half-life premium + quiz on isotope facts. (2) Reaction page: balance-equation on quoted equation + quiz on state/observation facts.
- Guidance: "Balance only the equation the page prints; never invent or complete a reaction. Quote the full equation in one quote. Keep charges and state symbols out of grading. Keep half-life conflicts source-local: quote your own page value when two pages disagree."
- Pitfalls: inventing products; half-life value conflicts across sources; confusing concentration with moles.
- Checks: BAL-01..BAL-07 (Section 3) + CHM-01 `no-charge-grading`: formulas containing charge marks fail BAL-02.

### 4.6 Biology

- Fits: `hardy-weinberg-v1` when equilibrium calculation taught; else `sort-groups-v1` (classification), `sequence-v1` (cycles: mitosis, carbon cycle), `concept-map-v1` (gene-pool relations), `quiz-cards-v1`.
- Examples: (1) Heterozygosity page: sort (homozygous/heterozygous examples) + quiz on allele-frequency facts. (2) Mating-patterns page: concept map (random/assortative mating links) + quiz.
- Guidance: "Do not force Hardy-Weinberg onto descriptive pages without allele frequencies. Quote the frequency or count for every classified item. Keep Punnett-square couple problems out of population-equilibrium cases. Label textbook-style definitions as AI-written glosses with page quotes."
- Pitfalls: single-couple Punnett vs population equilibrium; selection/drift pages forced into equilibrium cases; diversity statistics quoted without inputs.
- Check: BIO-01 `no-single-couple-hw`: hardy-weinberg plans rejected when focusQuote mentions a single couple or pedigree without population frequencies.

### 4.7 Earth science

- Fits: `sequence-v1` (cycles, strata order), `sort-groups-v1` (rock types, layers), `timeline-v1` when 5+ exact dates, `formula-explorer-v1` (simple laws), `half-life-v1` for dating pages.
- Examples: (1) Geologic-time feature: timeline or sequence of eras + quiz on dating facts. (2) Atmosphere-zones page: sequence of zones + compare table across zones.
- Guidance: "Prefer sequences for cycles and layered models in page order. Quote the zone/layer criterion for every sorted item. Keep U-235 half-life conflicts source-local. Do not build timelines from era names without exact years."
- Pitfalls: era names without dates; customary-unit chains needing multi-step substitution; conflicting half-life values across USGS pages.
- Check: EAR-01 `zone-criterion-quoted`: sort items on zone pages require group label in quote (SORT-02 strictly enforced).

### 4.8 Civics

- Fits: `sequence-v1` (how-a-bill-becomes-law, court process), `compare-table-v1` (branches, rights), `quiz-cards-v1` (facts, dates, thresholds).
- Examples: (1) Bill-to-law page: 6-step sequence + quiz on veto/override facts. (2) Amendments page: compare (proposal vs ratification thresholds) + quiz.
- Guidance: "Model processes as sequences in the order the page teaches. Quote thresholds and vote counts exactly. Compare institutions attribute-by-attribute with one quote per cell. Never state current law beyond the page; the claim is what the cited sentence says."
- Pitfalls: stating current law from background knowledge; vote-threshold confusion; merging federal/state processes.
- Check: CIV-01 `thresholds-quoted`: numbers in civics quiz answers require CT-02/Q-02 quote containment (no standalone numbers).

### 4.9 Language-reading

- Fits: `quiz-cards-v1` (comprehension), `sort-groups-v1` (vocabulary in context), `concept-map-v1` (claim-and-evidence map), `sequence-v1` (argument steps).
- Examples: (1) Speech/passage: 5 comprehension quiz cards + claim-evidence map. (2) Vocabulary set: sort words into connotation groups with in-passage quotes.
- Guidance: "Every answer must be answerable from the passage quote shown. Quote the sentence containing the answer, not a nearby sentence. Keep vocabulary glosses AI-labelled and tied to in-passage usage. Never test outside knowledge or publisher context."
- Pitfalls: testing background knowledge; quoting nearby-but-insufficient sentences; paraphrase drift in answerText.
- Check: LAN-01 `answer-sentence-sufficient`: Q-02 strictly enforced; answerText must appear in quote (no inference).

### 4.10 Other

- Fits: `overview-v1` + `quiz-cards-v1`, `sequence-v1`, `compare-table-v1` in that default order. No premium, no balance equation.
- Examples: (1) Waste-policy page: overview + quiz on storage facts + compare (high-level vs low-level). (2) Index/guide page with no model: overview + quiz on stated facts, or decline when no teachable content.
- Guidance: "Produce an overview plus at least one interactive whenever any teachable content exists. Prefer quiz and compare for descriptive pages. Decline only under Section 1.5 codes. Keep policy pages descriptive; never compute what the page does not compute."
- Pitfalls: forcing a premium onto policy text; computing from stray numbers; treating indexes as processes.
- Check: none beyond kit checks.

---

## 5. Generation flow and speed

### 5.1 Pipeline diagram (text)

```
Source text (licensed, 300-14000 chars)
  -> [Call 1: ANALYSIS+OVERVIEW+PLAN] --checks A-01..A-11, OV-01..OV-05--> VALIDATED
       |--FAIL after 2 repairs--> DECLINE CARD or JOB FAIL (receipt)
       |--PASS--> RENDER OVERVIEW to teacher immediately
  -> [Call 2: COMPONENT plan[0]] --checks per family--> PASS? stream to teacher : repair x2 : drop with reason
  -> [Call 3: COMPONENT plan[1]] (parallel-safe with Call 2, max concurrency 2)
  -> [Call 4: COMPONENT plan[2]] (starts when a slot frees)
  -> PUBLISH LESSON = overview + passed components (partial OK; overview-only OK with reason)
  -> JOB RECEIPT = summary extension (Section 5.5)
```

Concurrency: max 2 component calls in flight. Reason: spending-ledger lock serialises metering; 3-way parallel gains no latency and risks rate-limit retries. Analysis call is never parallel with component calls (plan required first). Repair calls reuse the freed slot (concurrency still <=2).

Untrusted-data handling every call: source text and prior model output travel in `<source>` / `<analysis>` boundary-tagged blocks; repair findings are untrusted data; repair authorised ONLY by validator-owned `affected` JSON-pointer paths recomputed from revision 1.

### 5.2 Calls and latency targets

Measured facts: median 24 s decline (analysis only); median 70 s published lesson with analysis + one spec (range 34-109 s); mean USD 0.032/job API pricing; analysis output budget 16000 tokens (cap, not target); input cap 32000 tokens; wall cap 420 s/job.

| Case | Model calls | Target: overview visible | Target: first component | Target: all done |
|---|---|---|---|---|
| Decline (unusable) | 1 (maybe +1 retry) | n/a (decline card <30 s) | n/a | <40 s |
| Best publish (plan 1, no repair) | 2 | <35 s | <70 s | <75 s |
| Typical (plan 2, one repair) | 3-4 | <35 s | <75 s | <120 s |
| Worst (plan 3, full repairs) | 1 + 3 + up to 4 repairs = 8 | <45 s | <90 s | <300 s (wall cap 420 s) |

Budget justification: overview-after-call-1 beats the old 70 s median time-to-first-paint; components stream so teachers see value before the full job ends.

### 5.3 Token budgets and page-size policy

Per-call TARGET output budgets (not caps; caps stay higher to allow retry headroom):

| Call | Target output | Cap |
|---|---|---|
| Call 1 analysis+overview+plan | 2200 tokens | 4000 |
| quiz-cards-v1 | 1800 | 3000 |
| sequence-v1 | 1800 | 3000 |
| sort-groups-v1 | 2000 | 3500 |
| concept-map-v1 | 2000 | 3500 |
| compare-table-v1 | 2200 | 3500 |
| formula-explorer-v1 | 2200 | 4000 |
| balance-equation-v1 | 1500 | 3000 |
| Repair call (any) | 1200 (only `affected` paths rewritten) | 2500 |

Page-size policy: evaluation sources 1-14 k chars; pasted 300-8000 chars; input cap 32000 tokens. Rule: pages up to 12000 chars pass whole (paragraph-truncated at 12000 on a paragraph boundary, recorded in provenance as `truncated:false|paragraph-capped`). Pages over 12000 chars: send leading 9000 chars (cut at paragraph boundary) + trailing 1000 chars, with `truncated:true` in provenance and a teacher-visible note "Long page: built from the opening sections." Rationale: teaching targets cluster at openings; trailing slice preserves worked examples/answer keys. Never middle-sample silently.

### 5.4 Repair per component

- Attempts: max 2 repair calls per component spec (plus the original = 3 generations max). Analysis call: max 2 repairs.
- Authorised: only validator-owned `affected` paths. Repair prompt includes: the revision-1 spec, the findings as untrusted data, and the exact `affected` pointer list. Model may rewrite ONLY those paths. Ids stable. Weakening forbidden: fewer items, looser tolerances, dropped quotes, or widened ranges reject the repair outright.
- Sent: minimal context (spec revision 1 + findings + affected paths + source slices containing the cited quotes). Never the full chat history.
- Kept on failure: lesson publishes with components that passed. Overview-only is acceptable but shows a visible per-component reason (Section 2 failure strings). Failed components are stored as `failed` specs with findings for audit, never rendered.
- Job status/receipts (minimal extension, not a rewrite): add `componentsPlanned: string[]`, `componentsPublished: string[]`, `componentsFailed: {id, reason}[]`, `partialPublish: boolean`, `overviewTokens`, `componentTokens: Record<id,number>`. Existing `JobOutcome` rendering adds one "Partial lesson" badge when `partialPublish=true`.

### 5.5 Labelled demo faults (smallest honest extension)

Extend the existing labelled-fault harness with one fault kind per NEW family (faults are labelled in UI and excluded from quality metrics):

| Family | Fault kind A (fabricated quote) | Fault kind B (wrong key) |
|---|---|---|
| quiz | `quiz-fabricated-quote` | `quiz-wrong-answerText` |
| sequence | `seq-fabricated-quote` | `seq-swapped-order` |
| sort | `sort-fabricated-quote` | `sort-wrong-group` |
| concept-map | `map-fabricated-quote` | `map-wrong-relation` |
| compare | `cell-fabricated-quote` | `cell-wrong-value` |
| formula-explorer | `fe-fabricated-formula-quote` | `fe-wrong-expected` (caught by recompute) |
| balance | `bal-fabricated-equation` | `bal-wrong-coefficients` (caught by recompute) |

Each fault is injected by test harness only, rendered with a "DEMO FAULT — not from the page" banner, and excluded from pass-rate metrics.

### 5.6 Caching and idempotency

Stored per component spec: `specId` (`{jobId}:{componentId}:r{revision}`), `componentId`, `revision` (1,2,3 for repairs), `seed` (shuffle seed, random per job, stored), `sources[]`, `provenance {model, promptsHash, sourceHash, timestamp}`, `findings[]` (validator history). Ids inside a spec are stable across repairs (model must return the same id set; new ids rejected). Re-running a job with the same `sourceHash` + `promptsHash` returns stored validated specs without new model calls (idempotent replay). Partial publish stores passed specs durably before attempting the next component call.

---

## 6. Mapping of the 29 evaluation pages

Prediction from page notes only. Page texts were not seen. Must be confirmed by a rerun. Flag `PREMIUM-FIRST` where the premium engine remains the better first choice.

### 6.1 The 20 declined or failed pages: what the new design produces

| # | Page (chars) | Subject | New components (ordered) + page region used | Key checks |
|---|---|---|---|---|
| 1 | weight-equation (2470, declined) | physics | 1. `formula-explorer-v1` on `W=m*g` + gravitation paragraph. 2. `quiz-cards-v1` on mass-vs-weight units + altitude change. | FE-01/02/04; Q-02. PREMIUM-FIRST is defensible only if lead broadens forces to weight form; as specced, explorer is correct (forces-1d `appliesWhen` requires net-force form not on page). |
| 2 | free-falling-object (2627, ANALYSIS_INVALID) | physics | 1. `sequence-v1` on 1-second-interval table reasoning. 2. `quiz-cards-v1` on constant-g facts. Premium alt: forces-1d if `F=W` reading holds — validator decides. | SEQ-03 order signal from table order; Q-02. |
| 3 | range-constant-velocity (3117, declined) | physics | 1. `formula-explorer-v1` on `d=V*t` / `R=V*tmax` (horizontal only, honestly scoped). 2. `quiz-cards-v1` on constant-velocity facts. | FE-01/04; explicit non-claim: no vertical behaviour. |
| 4 | effect-of-size-on-lift (2575, declined) | physics | 1. `compare-table-v1` (area choices, flap/slat configurations). 2. `quiz-cards-v1` on reference-area facts. | CT-02 entity-in-quote; Q-02. |
| 5 | lift-equation-1900s (4820, TRUNCATED) | physics | 1. `formula-explorer-v1` on `L=k*V^2*A*cl` with quoted k values (units labelled). 2. `sequence-v1` on unit-conversion steps. Small schemas avoid truncation. | FE-01/02/06 (ranges sane across imperial units); SEQ-02. |
| 6 | specific-heat-cp-cv (5407, declined) | physics | 1. `formula-explorer-v1` on `cp=cv+R` / `gamma=cp/cv`. 2. `quiz-cards-v1` on enthalpy/internal-energy definitions. 3. `sequence-v1` derivation steps. | FE-04 cases recomputed; SEQ-03. |
| 7 | earth-atmosphere-english (3876, declined) | earth-science | 1. `sequence-v1` on three-zone model in page order. 2. `compare-table-v1` across zones (T/p/rho fits). | SEQ-03; CT-03 shape. |
| 8 | role-of-mach-number (3708, declined) | physics | 1. `compare-table-v1` (subsonic/transonic/supersonic regimes). 2. `quiz-cards-v1` on `gamma*R*T=a^2` derivation facts. Premium excluded by `appliesWhen` (regimes excluded) — kit is correct. | CT-02; Q-02. |
| 9 | nrc-radioactive-waste (11891, declined) | other | 1. `quiz-cards-v1` on storage/classification facts. 2. `compare-table-v1` (high-level vs low-level). Long-page policy applies (`truncated:true`). | Q-02; CT-02. Decline only if `no-teachable-content`; notes suggest teachable facts exist. |
| 10 | nij-heterozygosity (2545, declined) | biology | 1. `sort-groups-v1` (homozygous/heterozygous examples; genotype-count facts). 2. `quiz-cards-v1` on allele-frequency + 85%/15% statistics (numbers quoted). | SORT-02; Q-02 + N-01. |
| 11 | nij-random-mating (1073, declined) | biology | 1. `concept-map-v1` (random/positive-assortative/negative-assortative links). 2. `quiz-cards-v1` on mating-pattern facts. Honest-decline fallback acceptable if quotes too thin (`too-short` is not met at 1073 chars, so components expected). | CM-02/03; Q-02. |
| 12 | nij-population-genetics (1790, declined) | biology | 1. `quiz-cards-v1` on population/gene-pool facts. 2. `sort-groups-v1` or `concept-map-v1` on evolutionary forces (whichever has quoted links). | Q-02; SORT-02 or CM-02. |
| 13 | louisiana-purchase (2597, declined) | history | 1. `sequence-v1` (signing -> expansion -> tensions chain). 2. `quiz-cards-v1` on April 30 1803 + impact facts. | SEQ-03 (page-order signal); Q-02. |
| 14 | constitution (1194, declined) | history | 1. `sequence-v1` (May 14 convene -> May 25 quorum -> mid-June redesign -> Sept 17 signing). 2. `quiz-cards-v1` on convention facts. Timeline correctly rejected (<5 exact dates). | SEQ-02/03; Q-02. |
| 15 | bill-of-rights (1480, declined) | history | 1. `compare-table-v1` (12 proposed / 10 ratified / 27th in 1992). 2. `quiz-cards-v1` on proposal/ratification facts. | CT-02; Q-02. |
| 16 | emancipation-proclamation (2667, declined) | history | 1. `sequence-v1` (Sept 22 1862 preliminary -> Jan 1 1863 final + scope). 2. `quiz-cards-v1` on scope/significance facts. | SEQ-03; Q-02. |
| 17 | drag-equation (3158, declined) | physics | 1. `formula-explorer-v1` on `D=Cd*rho*V^2*A/2`. 2. `quiz-cards-v1` on coefficient/area facts. (Worked example in Section 1.7.) | FE-01..FE-04; Q-02. |
| 18 | bernoullis-equation (8387, declined) | physics | 1. `formula-explorer-v1` on Bernoulli pressure relation as stated (scoped to page form). 2. `sequence-v1` on streamline reasoning steps. | FE-01/02; SEQ-03. |
| 19 | re-living-wright-way (5428, TRUNCATED) | other | 1. `quiz-cards-v1` on history-of-flight facts. 2. `sequence-v1` on narrative milestones in page order. If `no-teachable-content`, honest decline stands. Small schemas fix truncation. | Q-02; SEQ-03. |
| 20 | glider-trajectory (2078, declined) | physics | 1. `formula-explorer-v1` on `tan(a)=h/d` glide relation (NOT projectile; drag-equilibrium stated). 2. `quiz-cards-v1` on lift-drag-weight equilibrium facts. Forced projectile mapping stays forbidden. | FE-01/04; Q-02. |

### 6.2 The 9 pages that already succeeded: what changes

| Page | Old | New (overview first + extras). PREMIUM-FIRST kept where flagged |
|---|---|---|
| newtons-laws-of-motion | forces-1d-v1 | PREMIUM-FIRST forces-1d-v1 stays entry 1 + `quiz-cards-v1` on three laws + overview. |
| simplified-aircraft-motion | forces-1d-v1 | PREMIUM-FIRST forces-1d-v1 stays + `sequence-v1` balanced-vs-unbalanced reasoning + overview. |
| teenagers-and-saving | compound-interest-v1 | PREMIUM-FIRST compound-interest-v1 stays (lump-sum cases only) + `quiz-cards-v1` definitions + overview. Annuity numbers stay out of cases (FIN-01). |
| saving-post-secondary | compound-interest-v1 | PREMIUM-FIRST compound stays (canonical $1,000 example) + `sequence-v1` compounding steps + overview. Worksheet totals excluded (inputs off-page). |
| plutonium-backgrounder | half-life-v1 | PREMIUM-FIRST half-life-v1 stays + `quiz-cards-v1` isotope facts + overview. Own-page 24,100 yr quoted (cross-source trap contained). |
| half-life-glossary (254 chars) | half-life-v1 (published) | CHANGE: now declines `too-short` (R-DEC-3). Publishing invented cases was the old error; decline card shows page coverage. |
| powell-geologic-time | timeline-v1 | PREMIUM-FIRST timeline-v1 stays + `quiz-cards-v1` on halving analogy + overview. Own-page 710 Myr quoted. |
| fossils-numeric-time-scale | half-life-v1 | PREMIUM-FIRST half-life-v1 stays (hypothetical-T cases labelled) + `sequence-v1` parent/daughter reasoning + overview. |
| lee-resolution | timeline-v1 | PREMIUM-FIRST timeline-v1 stays + `sequence-v1` or quiz on committee facts + overview. |

### 6.3 Count table (predicted, pending rerun)

| Metric | Count / 29 |
|---|---|
| Pages with overview | 27 (all usable; 2 declines get decline card with page coverage instead) |
| Pages with >=1 interactive component | 27 |
| Pages with a premium simulation/timeline | 10 (8 old keeps excluding glossary + 2 borderline where validator accepts premium: free-fall and possibly weight-equation) |
| Pages where a decline remains | 2 predicted: half-life glossary (`too-short`) and possibly wright-way index (`no-teachable-content` if quotes too thin) |
| Failed (truncation/invalid) after fix | 0 predicted (small bounded schemas + budgets); must confirm by rerun |

Stated clearly: this mapping is a PREDICTION from page notes. Page texts were not seen. Confirm by rerunning the 29-page evaluation before freezing scope.

---

## 7. Risks and cut list

| # | Risk | Likelihood | Impact | Mitigation (decisive) |
|---|---|---|---|---|
| R1 | Output truncation on long pages | Medium (2/29 observed) | High (job fail) | Small bounded schemas + per-call budgets (Section 5.3); paragraph-capped page policy; repair rewrites `affected` paths only. |
| R2 | Quote failures on short/messy pages | High | Medium | Per-item drop rules (Sections 2.2-2.6); overview-only publish with reason; decline codes for stubs. |
| R3 | Over-confident summaries (paraphrase drift) | Medium | High (trust) | OV-02/Q-02 label-in-quote rules; N-01 number rule; AI-written badges; quotes always visible. |
| R4 | Formula transcription errors | Medium | High (wrong answers) | FE-01 quote containment + FE-02 parse + FE-04 recompute + FE-05 example check; no unverified expected shown. |
| R5 | Weak sort/map links (co-mention only) | High | Medium | SORT-02/CM-02 enforced; quotes visible per link; teacher sees weakness; drop rules. |
| R6 | UI scope overrun in 3 build days | High | High | Cut list order below; read-only fallbacks for map/compare; reuse PredictionCards/OrderActivity/cite. |
| R7 | Ledger/rate limits with parallel calls | Medium | Medium | Max concurrency 2; serial fallback; replay cache avoids repeat calls. |
| R8 | Test-suite churn when check counts change | Medium | Medium | Freeze check ids in this doc; stored-evidence tests pin counts per component; new checks get new ids, never renumber. |
| R9 | AI-text labelling inconsistency | Medium | Medium | Single `Disclosure` component owns all AI labels; A-09/LAN-01 validators reject publisher naming. |

CUT LIST (cut first):

1. Concept-map gap-fill interactivity (ship read-only map + quotes).
2. Compare predict-a-cell (ship reveal-only table).
3. Explorer SVG graph (ship sliders + value table).
4. Hydrate-dot formulas (ship without; reject dots).
5. Concurrency 2 (ship serial component calls).
6. Third plan slot (cap plans at 2 components).
7. Subject-specific checks PHY-01..CIV-01 warnings-only (kit checks block; subject checks warn).

Minimal viable Stage 6 for 3 build days:

- Day 1: analysis v2 + overview-v1 + quiz-cards-v1 + sequence-v1 + sort-groups-v1; pipeline serial; partial publish; repair loop extended. Demo-safe fallback: overview + quiz only.
- Day 2: formula-explorer-v1 (parser + evaluator + sliders/value, graph if time) + balance-equation-v1 (no hydrates) + compare-table-v1 reveal-only.
- Day 3: concept-map-v1 (read-only, gap-fill if time) + compare predict mode + concurrency 2 + 29-page rerun + demo script.

MUST NOT CUT: overview, quiz, sequence, sort, analysis v2 contract, quote checks, repair discipline, partial publish with reasons, AI-written labels, decline integrity.

---

## 8. Build slicing for parallel work

### 8.1 Frozen first (names only; lead freezes before build days)

Contracts: `packages/contracts/index.ts` (SourceAnalysisV2, kit spec types), `packages/contracts/engines.ts` (appliesWhen unchanged + kit ids), `schemas/source-analysis.gen.json`, `schemas/quiz-cards.gen.json`, `schemas/sequence.gen.json`, `schemas/sort-groups.gen.json`, `schemas/concept-map.gen.json`, `schemas/compare-table.gen.json`, `schemas/formula-explorer.gen.json`, `schemas/balance-equation.gen.json`. Prompts: `packages/meta/prompts.ts` (ANALYSIS_SYSTEM_PROMPT v2 + SUBJECT_GUIDANCE table + per-component SPEC prompts). Validation: `packages/validation/analysis.ts` (A-01..A-11), `packages/validation/quotes.ts` (shared verbatim + N-01), `packages/validation/quiz.ts` (Q-01..Q-06), `packages/validation/sequence.ts`, `packages/validation/sort.ts`, `packages/validation/conceptMap.ts`, `packages/validation/compareTable.ts`, `packages/validation/formulaExplorer.ts` (parser + evaluator + FE-01..FE-07), `packages/validation/balanceEquation.ts` (parser + BAL-01..BAL-07), `packages/validation/repair.ts` (affected-path discipline). Web: `apps/web/src/components/OverviewView.tsx`, `QuizCardsView.tsx`, `SequenceView.tsx` (reuse OrderActivity), `SortView.tsx`, `ConceptMapView.tsx`, `CompareView.tsx`, `FormulaExplorerView.tsx` (reuse Graph), `BalanceView.tsx`, `ActivityView.tsx` (dispatch), `Disclosure.tsx` (labels).

### 8.2 Task slicing (2-3 implementers, non-overlapping)

- Implementer A (contracts + analysis + text kit): analysis v2 schema/validator/repair, SUBJECT_GUIDANCE wiring, overview + quiz + sequence validators + views. Owns: analysis.ts, quotes.ts, quiz.ts, sequence.ts, OverviewView, QuizCardsView, SequenceView reuse.
- Implementer B (structure kit): sort + concept-map + compare-table validators + views. Owns: sort.ts, conceptMap.ts, compareTable.ts, SortView, ConceptMapView, CompareView. No parser work.
- Implementer C (formula + chemistry + pipeline): safe expression parser/evaluator + formula explorer + chemical parser/balancer + pipeline concurrency/partial-publish/receipts + rerun harness. Owns: formulaExplorer.ts, balanceEquation.ts, pipeline/jobs changes, FormulaExplorerView, BalanceView.

No shared-file edits across owners without lead approval after freeze.

### 8.3 Test-first checklist per component

Unit test (validator): (i) accepts a golden valid spec; (ii) rejects each check id with a dedicated fixture (one fixture per id); (iii) repair fixture: invalid revision 1 + `affected` paths -> valid revision 2 with same ids and no weakening (counts/tolerances not loosened); (iv) parser tests (explorer: grammar limits, domain NaN cases, 6-sig-fig display; balance: groups, subscripts, dot/hydrate flag, charge rejection, gcd=1).

Stored-evidence test (frozen real page + recorded model output): (i) quotes verify against stored source text; (ii) answer keys/expected values recomputed by OUR code equal stored keys within tolerance; (iii) check-id counts match the frozen list (no silent renumber); (iv) repair replay: stored findings + stored revision 1 produce the stored revision 2 byte-identically (idempotent).

Pipeline tests: overview renders after Call 1; components stream in order; failed component drops with the exact Section 2 reason string; overview-only publish shows reasons; decline codes render coverage; labelled demo faults render banners and are excluded from metrics.

---

## 9. Open decisions for the product owner

1. Confirm the 10-subject list, or merge earth-science into chemistry/physics and civics into other/history.
2. Weight equation: broaden `forces-1d-v1` to cover `W=m*g`, or keep explorer-only as specced (recommendation: keep explorer-only; broadening risks unit/altitude scope creep).
3. Free-fall table page: allow forces-1d via `F=W` reading, or keep kit-only (recommendation: let the validator decide per-quote; default kit-only).
4. Cap plans at 2 vs 3 components for latency (recommendation: 3 allowed, 2 typical; cut to 2 first if slow).
5. Hydrate-dot support in balance parser day 1 or deferred (recommendation: deferred, reject dots day 1).
6. Graph in explorer day 2 or deferred to value-table-only (recommendation: value table day 2, SVG graph day 3 if green).
7. Long-page policy cut point 12000/9000+1000 vs whole-14000 passthrough (recommendation: keep 12000 cap; evaluation max is ~11900 so rerun is unaffected).
8. Glossary-stub decline threshold 300 chars: keep or lower to 200 (recommendation: keep 300; the 254-char half-life stub must decline).
9. Demo-fault harness: extend to new families now or after rerun (recommendation: now, one fault kind per family minimum).
10. Freeze date for contracts before build days (recommendation: freeze Sections 1-3 verbatim 24 h before day 1; later changes get new check ids only).
