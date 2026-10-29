# STAGE 6 DESIGN — Subject Engines + Shared Interactive Component Kit

Status: FROZEN 2026-10-29 by the lead, with the addendum at the end (the addendum wins where they differ). Authored by Muse Spark 1.3 (receipts `docs/evidence/stage-6/muse-design{1,2}.json`).
Deadline: Nov 5. Demo prep from Nov 2. Baseline: 5b, 29 pages (9 published, 17 declined, 3 failed).

---

## 0. Summary and decisions

### 0.1 What is built

1. `SourceAnalysisV2` (`source-analysis.gen`, `analysisVersion: 2`): SEPARATE type/schema/validator. No legacy mirror fields. Fields: `subject`, `usable`/decline fields, `pageCoverage`, `overview` (headline + keyPoints + keyTerms, all quoted), `componentPlan` (1-3 entries). Same-call overview (saves 20-30 s; overview reuses analysis quotes).
2. Shared kit v1: `overview-v1`, `quiz-cards-v1`, `sequence-v1`, `sort-groups-v1`, `concept-map-v1`, `compare-table-v1`, `formula-explorer-v1`, plus `balance-equation-v1` (chemistry). Premium engines unchanged.
3. `SUBJECT_GUIDANCE` (10 rows): prompt text only, generic per subject, 3-6 sentences each. No subject-specific validator checks.
4. Pipeline: Call 1 = analysis + overview + plan. Calls 2..4 = one call per component, max concurrency 2. Overview renders after Call 1. Partial publish (overview + passed components).
5. Checks stay light: quotes verbatim, formulas computed by our code, structure valid, keys recomputed. Claim is "this is what the cited sentence says".

### 0.2 What is frozen

- Field names, limits, check ids in Sections 1-3. New checks get new ids; existing ids never renumbered (retired ids stay reserved).
- Expression grammar, evaluator, FE-08 transcription bridge, chemical parser contracts.
- Repair discipline: validator-owned `affected` paths recomputed from revision 1; max 2 repairs per call; repair returns a FULL corrected spec (validator enforces only-affected-paths-changed by comparing revisions); never weaken; ids stable; v2 id findings unlock only that id string (same discipline as v1).
- Decline criteria (Section 1.5). Teaching margin `max(case tolerance, 2% engine value)`; UI shows engine value.
- Budgets: hard `max_output_tokens` (reasoning included) 16,000 call 1, 12,000 per component/repair call; `maxInputTokens` 32,000. Repair budgeted at full-spec size.

### 0.3 What is cut first

1. Concept-map gap-fill (read-only first). 2. Compare predict-a-cell (reveal-only first). 3. Explorer graph (value table first). 4. Hydrate dots (rejected day 1). 5. Concurrency 2 (serial first). 6. Third plan slot.
MUST NOT CUT: overview, quiz, sequence, sort, analysis v2, quote checks, repair loop, partial publish, AI labels, decline integrity.

---

## 1. New analysis contract (`SourceAnalysisV2`, schema `source-analysis.gen`)

### 1.1 Decision: same-call overview

Same call. One input charge; overview reuses analysis quotes; overview failure fails the call (overview is the minimum publishable unit).

### 1.2 Subject enum and rules

`physics | maths | history | finance | chemistry | biology | earth-science | civics | language-reading | other`

| Subject | Choose when the page primarily teaches |
|---|---|
| physics | forces, motion, energy, fluids, waves, physical systems |
| maths | a procedure, function, or worked computation as the target |
| history | past events, actors, causes, documents, chronology |
| finance | saving, interest, loans, budgets, financial decisions |
| chemistry | substances, reactions, stoichiometry, concentration, gas laws, decay as chemistry |
| biology | genes, populations, bodies, ecosystems, living classification |
| earth-science | rocks, geologic time, atmosphere, oceans, space, climate |
| civics | law, government process, rights, participation |
| language-reading | passage comprehension, vocabulary in context, argument and evidence |
| other | none fits, or tie with no primary |

R-SUB-1: exactly one subject; primary teaching target wins, not setting. R-SUB-2: `other` uses generic guidance, still produces overview + kit; never `balance-equation-v1`. R-SUB-3: chemistry-earth ties go to `other` unless a reaction/computation or strata/process clearly dominates. R-SUB-4: never name the publisher in generated strings.

### 1.3 Full gen schema

Every key REQUIRED (present, no nulls). No count fields (array length is the count). No derived keys (system computes them). `""` means absent text only for explicitly marked fields.

```typescript
interface SourceAnalysisV2 {
  analysisVersion: 2;
  subject: Subject;
  usable: boolean;
  declineCode: string;        // "" when usable; else Section 1.5 code
  declineSummary: string;     // "" when usable; else 10-280 chars
  pageCoverage: string;       // ALWAYS 10-300 chars: what the page covers
  overview: OverviewGen;      // headline "" + [] when declined
  componentPlan: ComponentPlanEntry[]; // 1-3 when usable; [] when declined
}
interface OverviewGen {
  headline: string;           // 10-120 chars AI-written ("" on decline)
  keyPoints: KeyPointGen[];   // 3-6 when usable; [] on decline
  keyTerms: KeyTermGen[];     // 3-8 when usable; [] on decline
}
interface KeyPointGen { id: string; point: string; sourceId: string; quote: string; }
interface KeyTermGen { id: string; term: string; gloss: string; sourceId: string; quote: string; }
interface ComponentPlanEntry {
  componentId: string;        // kit id or premium id (Section 1.4)
  pedagogicalReason: string;  // 10-160 chars
  focusQuote: string;         // verbatim 1-150 chars, one paragraph
  focusSourceId: string;
}
```

Limits: ids `/^[a-z0-9][a-z0-9-]{0,39}$/`; quotes 1-150 chars verbatim; `point` 10-200; `term` 1-40; `gloss` 5-120. Visible-JSON target ~2200 tokens (Section 5.3).

### 1.4 Component plan rules

Plan ids: `quiz-cards-v1`, `sequence-v1`, `sort-groups-v1`, `concept-map-v1`, `compare-table-v1`, `formula-explorer-v1`, `balance-equation-v1`, `forces-1d-v1`, `projectile-v1`, `lift-equation-v1`, `speed-of-sound-v1`, `compound-interest-v1`, `hardy-weinberg-v1`, `half-life-v1`, `timeline-v1` (`overview-v1` implicit, never listed).
R-PLAN-1: 1-3 entries usable; 0 declined. R-PLAN-2: premium-first only when its `appliesWhen` fully fits; near matches rejected. R-PLAN-3: at most one premium. R-PLAN-4: no duplicate family. R-PLAN-5: premium + 1-2 kit, or 2-3 kit; never 3 premiums. R-PLAN-6: distinct `focusQuote` regions. R-PLAN-7: teaching order preserved. R-PLAN-8: balance only if `subject=chemistry` + quoted equation. R-PLAN-9: explorer only for 2-4-variable page formulas; skipped when a premium models the same formula better.

### 1.5 Usable / decline fields

Decline reserved for UNUSABLE sources. Codes: `too-short` (prose <300 chars), `not-prose`, `boilerplate-only`, `no-teachable-content`, `unreadable`, `prompt-injection-only`.
R-DEC-1: the 17 old declines were coverage gaps; under v2 they publish. R-DEC-2: decline shows `pageCoverage` + `declineSummary` + attribution. R-DEC-3: stubs <300 chars decline even when an equation is guessable. R-DEC-4: on decline `overview` is headline `""` + empty arrays, plan `[]`.

### 1.6 Migration: v2 is separate; v1 path untouched

Decision: `SourceAnalysisV2` is a separate type/schema/validator selected by the job runner. No legacy mirror fields in v2 (`supported`, `activity`, `unsupportedReason`, `concepts`, `objectives` do not exist in v2). Stored v1 evidence and 600+ tests stay valid; v1 path unchanged.

| Consumer | v1 behavior | v2 behavior |
|---|---|---|
| `workers/generation/jobs.ts` | unchanged: routes v1 jobs to v1 path | new branch: `analysisVersion===2` jobs route to v2 pipeline; never coerces v2 to `supported/activity` |
| `packages/validation/validate.ts` `analysis.invariants` | unchanged for v1 | v2 uses new `analysisV2.invariants` (A-01..A-11 below); v1 invariants never run on v2 |
| `validate.ts` `analysis.concept-ids` / `concept-evidence` | unchanged for v1 | not run on v2; replaced by OV-02/OV-06 on `overview.keyTerms`/`keyPoints` |
| `workers/generation/pipeline.ts` | unchanged analysis repair for v1 | v2 repair uses same discipline (validator-owned `affected` paths from revision 1; id findings unlock only that id) via new repair function |
| `apps/web` `analysisRepairs.ts` | unchanged labels for v1 | new v2 label set; no `supported !== true` Declined mapping applied to v2 (`usable=false` renders decline card) |

Analysis validator invariants: A-01 `version-is-2`. A-02 RETIRED (was mirrors-agree; no mirrors in v2; id reserved, always pass). A-03 `subject-valid` (enum; balance only if chemistry). A-04 `decline-integrity`. A-05 `overview-quotes-verbatim`. A-06 `quote-sourceids`. A-07 `counts-in-range` (array lengths in Section 1.3 ranges; no count fields). A-08 `plan-rules` (R-PLAN-2..9). A-09 `no-publisher-claim` (no token from the source's own title/attribution/publisher metadata and no generic phrase `according to|as stated by|official|endorsed` in generated text). A-10 `ai-numbers-checkable` (rule N-01). A-11 `plain-text` (forbid `<`, `>`, backticks, control chars, URLs, markdown heading/link/emphasis patterns `# | []( | __ **`; formula/equation fields exempt).
Repairable: A-04..A-08, A-10. Schema-shape failures (A-01/A-03) go to full-call retry, max 2.

### 1.7 Example JSON (drag page, real quotes)

```json
{
  "analysisVersion": 2,
  "subject": "physics",
  "usable": true,
  "declineCode": "",
  "declineSummary": "",
  "pageCoverage": "The page teaches the drag equation and which factors change drag.",
  "overview": {
    "headline": "AI-written summary: drag rises with speed squared, density, area, and coefficient.",
    "keyPoints": [
      {"id": "drag-equation", "point": "AI-written: one equation collects the drag factors.", "sourceId": "src1", "quote": "D = Cd * (rho * V^2 * A) / 2"},
      {"id": "cd-single-variable", "point": "AI-written: the coefficient packs the complex effects.", "sourceId": "src1", "quote": "For drag, this variable is called the drag coefficient, designated “Cd.”"},
      {"id": "reference-area", "point": "AI-written: the area in the equation is a reference area.", "sourceId": "src1", "quote": "Notice that the area (A) given in the drag equation is given as a reference area."}
    ],
    "keyTerms": [
      {"id": "drag-coefficient", "term": "drag coefficient", "gloss": "AI-written: one number for shape effects.", "sourceId": "src1", "quote": "For drag, this variable is called the drag coefficient, designated “Cd.”"},
      {"id": "density", "term": "density", "gloss": "AI-written: written rho in the equation.", "sourceId": "src1", "quote": "In the equation given above, the density is designated by the letter rho (ρ)."},
      {"id": "dynamic-pressure", "term": "dynamic pressure", "gloss": "AI-written: density-velocity combination.", "sourceId": "src1", "quote": "The combination of terms “density times the square of the velocity divided by two” is called the dynamic pressure and appears in Bernoulli’s pressure equation."}
    ]
  },
  "componentPlan": [
    {"componentId": "formula-explorer-v1", "pedagogicalReason": "Students predict speed-squared scaling before moving sliders.", "focusQuote": "D = Cd * (rho * V^2 * A) / 2", "focusSourceId": "src1"},
    {"componentId": "quiz-cards-v1", "pedagogicalReason": "Checks which factors raise or lower drag.", "focusQuote": "The drag equation states that drag D is equal to the drag coefficient Cd times the density rho (ρ) times half of the velocity V squared times the reference area A.", "focusSourceId": "src1"}
  ]
}
```

---

## 2. Shared component kit

Conventions: every key REQUIRED; ids kebab; quotes verbatim <=150 chars one paragraph with exact `sourceId`; strings plain text; N-01: numbers in AI text appear in the page or same quote. Per-call visible-JSON targets in Section 5.3.

Common envelope (F15). Every stored kit spec extends:

```typescript
interface KitSpecBase {
  schemaVersion: string; id: string; componentId: string; title: string;
  sources: { id: string; attribution: string; licence: string }[];
  execution: { network: false; generatedCodeAllowed: false; maxWallTimeMs: number };
  provenance: { model: string; promptsHash: string; sourceHash: string; revision: number; repairOf: string; timestamp: string };
  seed: number;
}
interface LessonSpec {
  jobId: string; analysisRef: string; overview: object;
  components: { componentId: string; specId: string; status: "passed"|"failed"|"skipped"; reason: string; revision: number }[];
}
```

`LessonSpec` coexists with existing `ActivitySpec` (premium engines/timeline): one lesson = `LessonSpec` (overview + kit + plan order) plus zero-or-one `ActivitySpec` when the plan includes a premium. Storage per job: `jobs/{jobId}/analysis.json`, `jobs/{jobId}/lesson.json`, `jobs/{jobId}/{componentId}.r{revision}.json`. `LessonView` renders overview first, then components in plan order as a vertical stack (chosen over tabs: preserves teaching order, lecture-friendly predict-reveal flow, less state, mobile-safe). `ActivityPanel` keeps doing exactly what it does today for premium specs (engine dispatch, prediction grading, unknown-type fallback); kit views mount alongside it by `componentId`.

### 2.1 `overview-v1`

(a) Fits every usable page; declined pages show the decline card instead.
(b) Schema: `OverviewGen` (Section 1.3). Generated inside Call 1.
(c) System adds: `KitSpecBase` fields, "AI-written summary" badge, citations.
(d) Checks: OV-01 `quotes-verbatim`. OV-02 `term-in-quote`. OV-03 `no-publisher-text`. OV-04 `numbers-checkable`. OV-05 `counts-valid` (lengths 3-6/3-8; repair by retry only). OV-06 `point-quote-overlap`: each key-point `point` shares >=2 distinct content words (>=4 letters, stoplist `this,that,with,from,have,are,was,will,when,which`, case-insensitive) with its own quote; each `gloss` shares >=1. Guard against mismatched pairs. False-reject risk: paraphrase with synonyms fails despite faithful meaning; repair path: rewrite point/gloss wording (`affected` per entry), never rewrite the quote to match.
(e) Rendering: `OverviewView` headline + numbered points + term list, quotes via `cite`, `Disclosure` badges, semantic headings, keyboard-safe.
(f) Failure/degrade: overview failure after repair is the ONLY lesson-level failure (the job fails; receipt records `overviewFailed`). A decline card still shows page coverage + attribution, never an empty screen.

### 2.2 `quiz-cards-v1`

(a) Fits pages with 3+ checkable facts. Not for computation answers (use explorer/premium).
(b) Schema (Muse writes; correct answer is ALWAYS `options[0]`, system shuffles for display):

```typescript
interface QuizCardsGen { schemaVersion: "quiz-cards-v1"; title: string; cards: QuizCardGen[]; }
interface QuizCardGen { id: string; stem: string; options: string[]; sourceId: string; quote: string; hint: string; }
```

Limits: cards 3-5; options 3-4; stem 10-160; option 1-80; hint `""`/5-120.
(c) System adds: `KitSpecBase`, seeded shuffle from `seed`, answer key = pre-shuffle `options[0]`, AI-options label.
(d) Checks: Q-01 `quote-verbatim`. Q-02 `answer-in-quote` (normalised `options[0]` substring of quote). Q-03 `options-distinct`. Q-04 `stem-no-answer-leak`. Q-05 `one-correct` (exactly one option matches the quote; repair replaces an option). Q-06 `numbers-checkable`. Q-07 `distractors-not-in-quote` (no `options[1..]` normalised value occurs in the quote; forces discriminating distractors).
(e) Rendering: reuses `PredictionCards` (select, lock, reveal + quote via `cite`/`EventEvidence`); radio-group keyboard; seeded order.
(f) Failure: drop bad cards while >=3 remain, else fail with "Quiz cards could not be verified against the page."

### 2.3 `sequence-v1`

(a) Fits pages that actually state an order (numbering, ordinals, or page order). Not for formula derivations, tables, or dated-event sets (use explorer or `timeline-v1`).
(b) Schema (array order = taught order):

```typescript
interface SequenceGen { schemaVersion: "sequence-v1"; title: string; orderBasis: "numbered"|"page-order"; cyclic: boolean; orderNote: string; steps: SequenceStepGen[]; }
interface SequenceStepGen { id: string; label: string; sourceId: string; quote: string; orderHint: string; }
```

Limits: steps 4-8; label 1-80; `orderNote` `""`/5-120.
(c) System adds: `KitSpecBase`, seeded shuffle, key = stored array order.
(d) Checks: SEQ-01 `quotes-verbatim`. SEQ-02 `labels-in-quotes`. SEQ-03 `order-basis-holds`: if `orderBasis=numbered`, ordinal words/numbers appear in the quotes lexically in array order (verified by our code); if `page-order`, quote start offsets strictly ascend in array order (computed by our code). Dated events fail here (use timeline). `cyclic=true` only for page-stated cycles; UI wording: "Starting point shown is the page's first step." Honest limit: proves an order signal, not scientific correctness. SEQ-04 `distinct-steps`. SEQ-05 `count-valid` (retry only). SEQ-06 `numbers-checkable`.
(e) Rendering: reuses `OrderActivity` (drag optional; Up/Down buttons + listbox keyboard); check then per-step quotes.
(f) Failure: "Steps could not be ordered from the page wording." Drop single bad steps only while >=4 remain.

### 2.4 `sort-groups-v1`

(a) Fits pages naming categories with member examples. Not for single/overlapping groups without page criteria.
(b) Schema:

```typescript
interface SortGroupsGen { schemaVersion: "sort-groups-v1"; title: string; groups: { id: string; label: string }[]; items: SortItemGen[]; }
interface SortItemGen { id: string; label: string; groupId: string; sourceId: string; quote: string; }
```

Limits: groups 2-4; items 6-12; labels 1-40/1-60.
(c) System adds: `KitSpecBase`, seeded pile order, key = validated `groupId` mapping.
(d) Checks: SORT-01 `quotes-verbatim`. SORT-02 `item-and-group-in-quote`: item label in quote (required) AND (group label in quote OR group label occurs in the same paragraph as the quote, computed by our code via blank-line paragraph split). False accepts: a long paragraph mentioning several categories can validate a weak link; teacher sees every quote. SORT-03 `groups-covered` (>=2 items each). SORT-04 `distinct-items`. SORT-05 `counts-valid`. SORT-06 `numbers-checkable`.
(e) Rendering: new `SortView` with `PredictionCards` commit pattern; keys 1..4 + click assign; no drag-only.
(f) Failure: drop items while >=6 items and >=2/group remain, else "Group membership could not be verified against the page."

### 2.5 `concept-map-v1`

(a) Fits pages stating explicit relationships. Not for fact lists, sequences, or comparisons.
(b) Schema:

```typescript
interface ConceptMapGen { schemaVersion: "concept-map-v1"; title: string; nodes: { id: string; label: string }[]; links: MapLinkGen[]; }
interface MapLinkGen { id: string; fromId: string; toId: string; relation: string; sourceId: string; quote: string; }
```

Relation vocab: `causes|needs|is part of|uses|follows|contrasts with`. Limits: nodes 4-8; links 3-10.
(c) System adds: `KitSpecBase`, radial layout by index, gap link chosen by our code (longest quote, lowest id tie-break).
(d) Checks: CM-01 `quotes-verbatim`. CM-02 `endpoints-in-quote`: one endpoint label in quote (required) AND the other in quote or same paragraph (same rule as SORT-02). False accepts: paragraph-level co-mention without a stated link; quotes visible. CM-03 `relation-in-quote`. CM-04 `graph-connected` (connected, no self-loops/duplicates; drop link while >=3 remain). CM-05 `counts-valid`. CM-06 `numbers-checkable`.
(e) Rendering: `ConceptMapView` SVG read-only, then gap mode (relation + target pick, keyboard complete). Day-1 fallback read-only.
(f) Failure: "Connections could not be verified against the page." Never render unverified links.

### 2.6 `compare-table-v1`

(a) Fits pages contrasting 2-4 named entities on shared attributes. Not single-entity pages.
(b) Schema:

```typescript
interface CompareTableGen { schemaVersion: "compare-table-v1"; title: string; entities: string[]; attributes: string[]; cells: CompareCellGen[]; }
interface CompareCellGen { id: string; entityIndex: number; attributeIndex: number; value: string; sourceId: string; quote: string; }
```

Limits: entities 2-4; attributes 2-5; cells = product (max 20); value 1-80. System chooses the predict cell.
(c) System adds: `KitSpecBase`, predict-cell selection, key = validated cell value.
(d) Checks: CT-01 `quotes-verbatim`. CT-02 `cell-in-quote`: cell value in quote (required) AND entity name in quote or same paragraph (same rule as SORT-02). False accepts: paragraph-level entity attribution without a direct statement. CT-03 `shape-valid`. CT-04 `numbers-checkable`. CT-05 `predict-cell-valid` (falls back to reveal-only, not component failure).
(e) Rendering: `CompareView` table; predict hides one cell (3 seeded same-column options); reveal-only fallback blanks unverified cells as "Not stated on this page".
(f) Failure: shape failure gives "Comparison could not be verified against the page."

### 2.7 `formula-explorer-v1`

(a) Fits page-stated formulas with 2-4 variables and no fitting premium (drag, gas laws, variants, geometry). Not for 5+ variables, vectors/calculus, or tables alone. Premium preferred when its `appliesWhen` fits; never wrap a premium formula to dodge its checks. Glider `tan(a)=h/d` is valid here (`tan` in grammar).
(b) Schema (Muse writes inputs only; system computes all outputs):

```typescript
interface FormulaExplorerGen {
  schemaVersion: "formula-explorer-v1"; title: string; formulaText: string; sourceId: string; quote: string;
  expression: string; variables: FormulaVarGen[]; xVariable: string;
  cases: { id: string; inputs: Record<string, number> }[];
  sourceExample: { quote: string; resultNumber: number; tolerance: number }; hasSourceExample: boolean;
}
interface FormulaVarGen {
  name: string; pageSymbol: string; meaning: string; meaningQuoted: boolean;
  quote: string; unit: string; min: number; max: number; default: number;
}
```

`inputs` keys must equal variable names exactly. `sourceExample` is `""`/`0`/`0` when `hasSourceExample=false`. Limits: expression <=120 chars; AST <=50 nodes; 2-4 vars; `|exponent|<=100`, finite results; name `/^[a-z][a-z0-9_]{0,11}$/`; reserved names never variable names; slider ratio <=1e6.
(c) System adds: `KitSpecBase`, AST, steps `(max-min)/100`, 101 samples over `xVariable`, SVG path, recomputed case outputs, predict key, labels.
(d) Grammar (exact; functions `sqrt|exp|log|sin|cos|tan` only; constants `pi|e`):

```
Expr := Term (("+"|"-") Term)*
Term := Unary (("*"|"/") Unary)*
Unary := "-" Unary | Power
Power := Primary ("^" Unary)?
Primary := Number | Variable | FuncCall | Constant | "(" Expr ")"
```

`^` binds tighter than unary minus (`-x^2 = -(x^2)`), right-associative (`a^b^c = a^(b^c)`), `2^-1` allowed. `log` is natural log; sin/cos/tan in radians. Lexer: longest match wins, so `1e5` is a Number while bare `e` is the constant; `e5`/`1e` rejected; ASCII with fixed normalisation (`×·∙→*`, `**→^`, unicode minus/superscripts mapped, whitespace ignored); implicit multiplication and `**` in final form rejected. Domain errors (÷0, `sqrt(<0)`, `log(<=0)`, `0^negative`, non-finite) yield NaN + "Not defined for these inputs". IEEE-754 double; display 6 sig figs; grading margin per Section 0.2.
(e) Checks: FE-01 `formula-quoted`. FE-02 `expression-parses` (variable set equality). FE-03 `variables-declared`. FE-04 `cases-recomputed` (system sets outputs; inputs finite/in-range; tolerance capped `[1e-9,0.25]`). FE-05 `sourceExample-check` (required when a single quotable passage states inputs + result; then result appears in quote and matches evaluation). FE-06 `ranges-sane`. FE-07 `numbers-checkable`. FE-08 `expression-matches-page-formula`: map each `pageSymbol` (exact page token, e.g. `Cd`, `rho`, `V`) to `name`; normalise the quote's formula line with the fixed rules above; lex with the same lexer; parse RHS with the same grammar; compare to `expression` by AST structural equality (parentheses canonical by construction; commutative `+`/`*` operands sorted by canonical string) with numeric tie-break: evaluate both at 5 fixed points (per-variable values `[0.7, 1.3, 2.1, 3.7, 5.9]` cycled deterministically) and require relative error <=1e-6 at all points. Unparseable page formulas (words, subscripts, Greek-only names): explorer publishes ONLY with a verified FE-05 example, and the UI shows "Formula entered by AI from the quoted line - compare with the quote"; else fail. Fixtures: `D = Cd * (rho * V^2 * A) / 2`; `V = a * t`; `X = (1 / 2) * a * t^2` with `a=9.8, t=2 → V=19.6, X=19.6` as the table-based sourceExample.
Grammar vectors (input | vars | expected): `2+3*4` → 14; `-x^2, x=3` → -9; `2^-1` → 0.5; `2^3^2` → 512; `sqrt(4)` → 2; `log(e)` → 1; `sin(0)` → 0; `cos(0)` → 1; `tan(0)` → 0; `1e5` → 100000; `1/0` → domain-NaN; `sqrt(-1)` → domain-NaN.
(f) Rendering: `FormulaExplorerView` formula + quote, sliders, readout, SVG graph (101 points, NaN gaps), predict-commit-reveal reusing `PredictionCards`/`Graph`.
(g) Grading uses the teaching margin; engine value always shown.
(h) Failure: parse/FE-04/FE-08 failure gives "The formula could not be checked with our calculator." FE-05 mismatch alone drops to `hasSourceExample=false` when FE-01..FE-04 pass.

### 2.8 Cross-component notes

Dispatch by `componentId` under `ActivityPanel`; unknown ids use the existing fallback.

---

## 3. `balance-equation-v1`

(a) Fits chemistry pages printing a reaction with 2-5 species. Not for prose-only decay, half-reaction/redox bookkeeping, or mechanisms. Requires `subject=chemistry`. Already-balanced and unbalanced printed equations are both fine.
(b) Schema (Muse writes split; system derives the solution):

```typescript
interface BalanceEquationGen {
  schemaVersion: "balance-equation-v1"; title: string; equationText: string;
  sourceId: string; quote: string; species: BalanceSpeciesGen[]; hint: string;
}
interface BalanceSpeciesGen { id: string; formula: string; side: "left"|"right"; sourceId: string; quote: string; }
```

Limits: species 2-5; elements 1-8; per-species atoms <=40; coefficients 1-12.
(c) Parser (our code): symbols `[A-Z][a-z]?`, unknown rejected; subscripts 1-999, no leading zeros; `()` depth <=2; hydrate dots rejected day 1; normalisation (unicode subscripts/arrows, whitespace, `+` separators); charges EXCLUDED (`Fe3+`, `e-` rejected); state symbols stripped and not verified.
(d) Checks: BAL-01 `equation-quoted`. BAL-02 `formulas-parse`. BAL-03 `atom-balance-exact` (system solution, integers). BAL-04 `lowest-terms` (gcd 1). BAL-05 `solution-exists` (1-12). BAL-06 `coefficient-shape` (retired values check; ids kept). BAL-07 `numbers-checkable`. BAL-08 `unique-up-to-scale` (nullspace dimension exactly 1, else fail `ambiguous`). NOT verified: occurrence, conditions, states, charges, energy/rate.
(e) Rendering: `BalanceView` equation + quote, steppers 1-12, live atom table (our counter), Check (exact match), Reveal. Keyboard complete; reuses commit/`Disclosure`/`cite` patterns.
(f) Failure: BAL-01/02/05/08 failure gives "The reaction equation could not be verified against the page." No wrong key shown. None of the 29 evaluation pages prints a reaction equation, so no evaluation coverage is claimed; the demo needs one extra licensed chemistry source with: a printed equation (2-5 species, common elements, no charges/hydrates), prose context, classroom licence, quotable text.

---

## 4. Per-subject guidance (`SUBJECT_GUIDANCE`, prompt text only)

Order listed = default preference when no premium fits. Examples are one-line starters.

### 4.1 Physics

Fits: premium; explorer; quiz; sequence (derivations in page order); compare (regimes). Examples: drag equation explorer + scaling quiz; free-fall explorer + table quiz. Guidance: "Prefer a premium engine only on an exact appliesWhen fit. Quote equations character-for-character with exponents and units. Keep worked numbers inside quotes. Model derivations as sequences in page order. Label conversions AI-written unless page-stated. Use tan only for the page's own right-triangle relation." Pitfalls: unit mixing; net force vs weight; imported background motion.

### 4.2 Maths

Fits: explorer; sequence (worked steps); quiz. Examples: quadratic explorer + completing-square sequence; tree-diagram sequence + conditions quiz. Guidance: "Turn worked examples into sequences before adding explorers. Quote functions exactly. State domain limits only as page-quoted or AI-labelled notes. Keep AI-text numbers inside quotes. Require a page example before hasSourceExample." Pitfalls: invented skipped steps; unlicensed division; over-generalised example numbers.

### 4.3 History

Fits: timeline (5+ exact dates); sequence (cause-effect); quiz; compare (documents). Examples: purchase signing-to-impact sequence + date quiz; proposal-vs-ratification compare + quiz. Guidance: "Use timeline only with five exact page dates. Otherwise build cause-effect sequences in page order with one connective quote per step. Quote short primary-source phrases verbatim. Keep each quote on its own sourceId." Pitfalls: decades as dates; background-knowledge ordering; merged source dates.

### 4.4 Finance

Fits: compound-interest premium (lump-sum only); explorer (loans/inflation); compare; quiz. Examples: lump-sum explorer + start-early compare; compounding-steps sequence + quiz. Guidance: "Keep lump-sum and recurring-deposit numbers strictly separate. Quote rate, frequency, and time basis exactly. Exclude off-page worksheet totals. Compare options side by side rather than merging formulas." Pitfalls: off-page totals; APR/APY confusion; unstated inflation formulas.

### 4.5 Chemistry

Fits: half-life premium; balance-equation; explorer (gas/concentration); quiz; sequence. Examples: decay premium + isotope quiz; quoted-equation balance + observation quiz. Guidance: "Balance only the printed equation; never invent products. Quote the full equation once. Keep charges and states out of grading. Keep conflicting values source-local to the quoted page. Use explorer only for page-stated relations." Pitfalls: invented products; cross-source value conflicts; moles vs concentration.

### 4.6 Biology

Fits: hardy-weinberg premium (population frequencies only); sort; sequence (cycles); map; quiz. Examples: genotype sort + frequency quiz; mating-pattern map + quiz. Guidance: "Require population frequencies before any equilibrium plan. Quote the count for each classified item. Keep single-family examples out of population cases. Label glosses AI-written with page quotes. Use maps only for page-stated links." Pitfalls: Punnett vs population confusion; forced equilibrium; uninputted statistics.

### 4.7 Earth science

Fits: sequence (cycles/layers); sort; timeline (5+ dates); explorer; half-life dating. Examples: era sequence + dating quiz; zone sequence + cross-zone compare. Guidance: "Prefer sequences for cycles and layered models in page order. Quote the criterion for each sorted item. Keep conflicting values source-local. Never build timelines from era names without exact years." Pitfalls: dateless eras; multi-step unit chains; cross-page value conflicts.

### 4.8 Civics

Fits: sequence (processes); compare (institutions); quiz. Examples: bill-to-law sequence + veto quiz; proposal-vs-ratification compare + quiz. Guidance: "Model processes as sequences in taught order. Quote thresholds and counts exactly. Give one quote per compare cell. Never state current law beyond the page; report what the cited sentence says." Pitfalls: background-law claims; threshold confusion; federal/state merges.

### 4.9 Language-reading

Fits: quiz; sort (vocabulary); map (claim-evidence); sequence (argument). Examples: passage quiz + evidence map; connotation sort with in-passage quotes. Guidance: "Make every answer answerable from its shown quote. Quote the answering sentence, not a neighbour. Tie glosses to in-passage usage with AI labels. Never test outside knowledge. Keep inference out of answer checks." Pitfalls: background-knowledge tests; nearby-sentence quotes; paraphrase drift.

### 4.10 Other

Fits: overview + quiz, sequence, compare in that order. No premium/balance. Examples: policy quiz + high-vs-low compare; guide quiz or honest decline. Guidance: "Publish overview plus an interactive whenever teachable content exists. Prefer quiz and compare for descriptive pages. Decline only under Section 1.5. Never compute what the page does not compute." Pitfalls: forced premiums; stray-number computation; indexes as processes.

---

## 5. Generation flow and speed

### 5.1 Pipeline

```
Source (300-8000 pasted; licensed sources whole)
 -> [Call 1: ANALYSIS+OVERVIEW+PLAN] -> PASS renders overview; FAIL after 2 repairs -> decline/job fail
 -> [Call 2: plan[0]] -> [Call 3: plan[1]] (max concurrency 2) -> [Call 4: plan[2]]
 -> PUBLISH overview + passed components (partial OK; overview-only with reasons)
```

Analysis never parallel with components. Repairs reuse a free slot. All calls carry source/prior output in boundary tags; findings are untrusted; only validator `affected` paths authorised.

### 5.2 Calls and latency

Facts: median 24 s decline; median 70 s published analysis + one spec (34-109 s); USD 0.032/job; input cap 32,000; wall cap 420 s/job.

| Case | Calls | Overview | First comp. | Done |
|---|---|---|---|---|
| Decline | 1 (+1 retry) | decline <30 s | n/a | <40 s |
| Best (1 comp) | 2 | <35 s | <70 s | <75 s |
| Typical (2 + repair) | 3-4 | <35 s | <75 s | <120 s |
| Worst (3 + repairs) | <=8 | <45 s | <90 s | <300 s |

### 5.3 Budgets and page-size policy

Visible-JSON targets: call 1 ~2200; quiz/sequence ~1800; sort/map ~2000; compare/explorer ~2200; balance ~1500. Hard `max_output_tokens`: 16,000 call 1 (current `analysisMaxOutputTokens`), 12,000 per component and per repair call. Repair returns a FULL corrected spec budgeted at full-spec size.
Page policy: send the whole page always. Pasted limit 8,000 chars. Reject (never truncate) anything above 40,000 chars with a clear error. No `truncated` provenance or teacher note.

### 5.4 Repair per component

Max 2 repairs per call. Repair input: revision 1 + findings + `affected` pointers + cited source slices. Model returns the full spec; validator rejects any change outside `affected`, any weakening, or any id change. Failures store findings; lessons publish passed parts with per-component reasons. Receipt extension only: `componentsPlanned/Published/Failed{id,reason}`, `partialPublish`, token counts. `partialPublish=true` shows one badge.

### 5.5 Labelled demo faults (two families only)

Stage 6 adds: (1) quiz fabricated quote (must fail Q-01/Q-02); (2) formula-explorer wrong expression (must fail FE-08, else FE-05/FE-04; name the failing check). Faulty revisions are re-validated and carry the existing harness `effective` flag; faults render labelled banners and are excluded from metrics. Later: sequence/sort/map/compare/balance faults.

### 5.6 Caching and idempotency

Per spec: `specId {jobId}:{componentId}:r{revision}`, `revision`, `seed`, sources, provenance, findings. Same `sourceHash`+`promptsHash` replays stored specs without model calls. Passed specs persist before the next call.

---

## 6. Mapping of the 29 evaluation pages

Prediction from notes only; page texts not seen; confirm by rerun. Confidence per row: high/med/low.

| # | Page | Subject | New components + region | Checks | Conf |
|---|---|---|---|---|---|
| 1 | weight-equation | physics | explorer on weight formula + quiz on mass/weight | FE-01/02/08/04; Q-02 | med |
| 2 | free-falling-object | physics | explorer on `V=a*t`, `X=(1/2)*a*t^2` with table sourceExample + quiz on constant-g facts | FE-08/05/04; Q-02 | high |
| 3 | range-constant-velocity | physics | explorer on horizontal `d=V*t` scoped honestly + quiz | FE-08/04 | med |
| 4 | effect-of-size-on-lift | physics | compare (area/flap configs) + quiz on area facts | CT-02; Q-02 | med |
| 5 | lift-equation-1900s | physics | explorer on quoted `k*V^2` form + quiz on units/history | FE-08/06; Q-02 | med |
| 6 | specific-heat-cp-cv | physics | explorer on `cp=cv+R` relations + quiz on definitions | FE-08/04; Q-02 | med |
| 7 | earth-atmosphere-english | earth-science | compare across zones + quiz on zone facts | CT-02/03; Q-02 | med |
| 8 | role-of-mach-number | physics | compare (regimes) + quiz on derivation facts | CT-02; Q-02 | med |
| 9 | nrc-radioactive-waste | other | quiz on storage facts + compare high-vs-low | Q-02; CT-02 | low |
| 10 | nij-heterozygosity | biology | sort (genotype examples) + quiz on frequency facts | SORT-02; Q-02 | med |
| 11 | nij-random-mating | biology | map (mating-pattern links) + quiz | CM-02/03; Q-02 | low |
| 12 | nij-population-genetics | biology | quiz + sort or map whichever has quoted links | Q-02; SORT-02/CM-02 | low |
| 13 | louisiana-purchase | history | sequence (signing->expansion chain) + quiz on dates | SEQ-03; Q-02 | med |
| 14 | constitution | history | sequence (convene->quorum->redesign->signing) + quiz | SEQ-03; Q-02 | med |
| 15 | bill-of-rights | history | compare (12/10/27th) + quiz | CT-02; Q-02 | med |
| 16 | emancipation-proclamation | history | sequence (preliminary->final + scope) + quiz | SEQ-03; Q-02 | med |
| 17 | drag-equation | physics | explorer on `D=Cd*(rho*V^2*A)/2` + quiz | FE-08/04; Q-02 | high |
| 18 | bernoullis-equation | physics | explorer on page-form relation + quiz on pressure facts | FE-08/04; Q-02 | low |
| 19 | re-living-wright-way | other | quiz on flight-history facts + sequence on narrative milestones | Q-02; SEQ-03 | low |
| 20 | glider-trajectory | physics | explorer on `tan(a)=h/d` + quiz on equilibrium facts | FE-08/04; Q-02 | med |

Sequence used only where notes indicate stated order; derivations/tables use explorer + quiz.

### 6.2 The 9 successes

Newtons/simplified-aircraft keep PREMIUM-FIRST forces-1d + quiz/sequence + overview. Teen/post-secondary keep compound-interest (lump-sum only) + quiz/sequence + overview. Plutonium keeps half-life + quiz + overview. Powell/lee keep timeline + quiz/sequence + overview. Fossils keeps half-life + sequence + overview. Half-life glossary (254 chars) now declines `too-short` with coverage card (old publish was an error).

### 6.3 Count table (definitive prediction, pending rerun)

Overview 28/29; >=1 interactive 28/29; premium 9/29 (8 keeps minus glossary + free-fall/glider stay kit); declines 1/29 (glossary `too-short`). Wright-way publishes (quiz + sequence, low confidence) rather than declining. Failures predicted 0.

---

## 7. Risks and cut list

| # | Risk | Like. | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Truncation (reasoning vs output cap) | Med | High | 16k/12k hard caps; small schemas; full-spec repair budget |
| R2 | Quote failures (short/messy) | High | Med | Per-item drops; overview-only with reason; decline codes |
| R3 | Paraphrase drift | Med | High | OV-02/OV-06, Q-02/Q-07, N-01, AI badges, visible quotes |
| R4 | Formula transcription | Med | High | FE-01 + FE-02 + FE-04 + FE-05 + FE-08; no unverified outputs |
| R5 | Weak sort/map links | High | Med | Paragraph co-occurrence + visible quotes + drops |
| R6 | UI scope (3 days) | High | High | Read-only fallbacks; reuse PredictionCards/OrderActivity/cite |
| R7 | Ledger/rate limits | Med | Med | Concurrency <=2; serial fallback; replay cache |
| R8 | Test churn | Med | Med | Frozen ids; new ids only; pinned stored evidence |
| R9 | AI-label inconsistency | Med | Med | Single `Disclosure`; A-09 rejects publisher phrasing |

Cut order: map gap-fill, compare predict, explorer graph, hydrates, concurrency, third slot. Day 1: analysis + overview + quiz + sequence + sort (serial, partial publish). Day 2: explorer + balance (no hydrates) + compare reveal-only. Day 3: map + predict mode + concurrency + rerun + demo. Must not cut Section 0.3 list.

---

## 8. Build slicing

### 8.1 Frozen first

Contracts: `packages/contracts/index.ts`, `engines.ts`, `schemas/source-analysis.gen.json`, `schemas/quiz-cards.gen.json`, `schemas/sequence.gen.json`, `schemas/sort-groups.gen.json`, `schemas/concept-map.gen.json`, `schemas/compare-table.gen.json`, `schemas/formula-explorer.gen.json`, `schemas/balance-equation.gen.json`. Prompts: `packages/meta/prompts.ts` (v2 + `SUBJECT_GUIDANCE` + component prompts). Validation: `analysis.ts` (A-01..A-11), `quotes.ts` (verbatim + N-01), `quiz.ts` (Q-01..Q-07), `sequence.ts`, `sort.ts`, `conceptMap.ts`, `compareTable.ts`, `formulaExplorer.ts` (parser + FE-01..FE-08), `balanceEquation.ts` (BAL-01..BAL-08), `repair.ts`. Web: `OverviewView`, `QuizCardsView`, `SequenceView`, `SortView`, `ConceptMapView`, `CompareView`, `FormulaExplorerView`, `BalanceView`, `ActivityView`, `LessonView`, `Disclosure`.

### 8.2 Slicing (2-3 owners, non-overlapping)

- A: analysis + overview + quiz + sequence + guidance wiring + views.
- B: sort + map + compare validators + views.
- C: expression/chemical parsers + explorer + balance + pipeline/jobs/receipts + rerun + LessonSpec storage.

### 8.3 Test-first checklist

Validator unit: golden accept; one fixture per check id; repair revision-1→2 keeps ids without weakening; parser vectors (Section 2.7) and balance (groups, charges, gcd, BAL-08). Stored evidence: quotes vs source; recomputed keys/outputs within tolerance; frozen check-id counts; repair replay byte-identical. Pipeline: overview-first, plan-order streaming, exact failure strings, overview-only reasons, decline coverage, labelled faults excluded.

---

## 9. Open decisions

1. Confirm 10-subject list or merge small ones.
2. Weight equation: keep explorer-only (recommended) vs broaden forces-1d.
3. Free-fall: kit-only default stands (validator decides premium fit).
4. Cap plans at 2 vs 3 for latency (recommend 3 allowed, 2 typical).
5. Hydrates deferred (recommended) vs day 1.
6. Explorer graph day 3 vs value-table-only.
7. Confirm paste 8,000 / reject 40,000 thresholds.
8. Keep 300-char stub threshold (recommended; glossary must decline).
9. Fault harness now (2 families) vs after rerun (recommended now).
10. Freeze Sections 1-3 verbatim 24 h before day 1; later changes add ids only.

---

## Lead freeze addendum (2026-10-29) — wins over the sections above

**Product direction (Calvin):** summarise any page quickly and accurately; output demonstrational **visuals** and interactive components; checks stay a light trust layer. So visual components are protected from cuts.

**Decisions on §9:**
1. Subjects: the 10-value enum stands (guidance is prompt text only, so merging later is cheap). Calvin may still trim.
2. Weight equation: explorer-only. 3. Free-fall: validator decides premium fit. 4. Plans: 3 allowed, 2 typical.
5. Hydrates deferred. 6. **Explorer graph is a must-have (day 2)**, not a cut item — it is the main visual for formula pages; the value table ships with it. Concept map read-only view is also must-have (visual); only its gap-fill mode is cuttable.
7. Paste 8,000 / reject 40,000: confirmed. 8. 300-char stub threshold: confirmed. 9. Fault harness now (2 families). 10. Freeze now (no 24 h wait; build starts Oct 30).

**Defect fixes:**
- `KitSpecBase` reuses the existing contract types: `sources: SourceRef[]` (field `license`, US spelling as in the repo), `provenance` reuses the existing `Provenance` type with `repairOf: number | null`. No new source shape.
- §1.7 example quotes must be ≤150 chars; implementers use shorter verbatim spans from the drag page (the example is illustrative, not a fixture).
- §6.3: premium **8**/29, not 9.
- `BalanceSpeciesGen` keeps the per-species quote **and** a check BAL-09 `species-quote-verbatim` uses it (no unused required fields).
- FE-08 is defined precisely by the implementer with tests: parse the page's quoted formula line with the same grammar when possible and compare it with `expression` at 5 sample points spread over the slider ranges (relative tolerance 1e-9, skip non-finite points; need ≥3 finite agreeing points). If the page formula cannot be parsed, FE-05 (source example) must pass, else the explorer fails with the FE-08 message.
- A-09 publisher-claim tokens: tested on the 29 evaluation sources before freezing the phrase list.

**Build slicing by package (replaces §8.2; one owner per path, parallel after S6-0):**
| Slice | Owner | Paths |
|---|---|---|
| S6-0 contracts + gen schemas + `LessonSpec` | Muse (bridge) | `packages/contracts/**`, `schemas/**`, `scripts/build-schemas.ts` |
| S6-M prompts v2 + `SUBJECT_GUIDANCE` + analyse-v2 / generate-component / repair-component | Muse (bridge) | `packages/meta/**` |
| S6-V validators (A-, OV-, Q-, SEQ-, SORT-, CM-, CT-, FE- parser, BAL-) | Qwen 3.8 Max | `packages/validation/**` |
| S6-U views (`LessonView`, Overview, Quiz, Sequence, Sort, ConceptMap, Compare, FormulaExplorer + graph, Balance, Disclosure) | Sonnet 5.5 | `apps/web/**` |
| S6-W job runner v2 branch, storage, receipts, API, demo faults, rerun | Qwen 3.8 Max (after OW-2 lands) | `workers/**`, `apps/api/**`, `scripts/**` |
| Chemistry demo source (licensed page with a printed reaction equation) | Qwen 3.8 Flash | `data/sources/**` |
