# packages/validation — deterministic validation engine (TASK-003 / TASK-013)

Structural JSON Schema validation alone does not meet the publish gate. This
package re-verifies every claim in a generated artifact with deterministic
code before a student sees it: internal consistency, source grounding
(references, hashes, verbatim quotes) and physics behaviour re-executed
against the engine registered for the spec
(`packages/activities/registry.ts`).

`validateSpec` dispatches on `spec.simulation.engine` (all four catalogue
engines). A missing or unknown engine id yields a report containing a single
failed `schema.full` check naming the problem; otherwise the schema gate uses
`fullSchemaFor(engine)` (each schema compiled exactly once).

## API

```ts
import { validateSpec, validateAnalysis, repairFindings, compareRevisions, normalizeWhitespace, checkTrajectory } from './validate.ts';
```

- `normalizeWhitespace(s)` — replaces every `/\s+/g` run with one space, then
  trims. Case-sensitive; no quote/ellipsis folding. Quotes are compared
  against source text after this normalisation on both sides.
- `validateSpec(spec, sources) -> ValidationReport` — engine-generic checks
  (below). Check counts: forces 15, lift 15, projectile 14, speed-of-sound 14.
- `validateAnalysis(analysis, sources) -> ValidationReport` — 6 checks (below).
- `checkTrajectory(frames)` — the frame-invariant core of
  `behavior.trajectory`, exported for direct unit testing.
- `repairFindings(report, spec?) -> RepairFinding[]` — Stage 5: failed checks
  only, in report order, `message` truncated to 300 characters for display.
  For `behavior.tests` / `behavior.predictions`, when `spec` is given, the
  FIRST failing case's `expected` / `computed` / `tolerance` are attached in
  full precision with a case path like `behavioralTests[2]`. Never throws.
- `compareRevisions(previous, next, failedOnPrevious) -> ValidationCheck` —
  Stage 5 `repair.no-weakening` (kind `semantic`): fails when the engine
  changed; when a matched case's tolerance increased (tests by name,
  predictions by id) unless `semantic.tolerance` failed on the previous
  revision; when a simulation range width (max-min) shrank unless that
  range's own check id failed on the previous revision; and when the number
  of behavioral tests or predictions decreased (never excused — deleting a
  failing case is weakening, not repair). Never throws; junk fails closed.

Neither validate function ever throws: `null`, strings and malformed objects
degrade into failed checks. The Ajv schema check is a hard gate — when it
fails, the report contains only that check (message lists up to 5 errors as
`instancePath message`), `publishable: false`, and `revision: 1`. Every later
check is individually guarded, so a crash inside one check is recorded as a
failure and cannot hide the others. `publishable` is true only when **all**
checks pass.

## `validateSpec` checks (engine-generic, in report order)

| id | kind | rule |
|----|------|------|
| `schema.full` | schema | Missing/unknown `simulation.engine` fails alone, naming the problem. Otherwise Ajv (allErrors) against `fullSchemaFor(engine)`; failure short-circuits the report. |
| per-input range | semantic | One check per descriptor input: `min < max` and `min <= default <= max`. Ids: forces keeps the Stage 2 `semantic.mass-range` / `semantic.force-range`; other engines use `semantic.range.<inputKey>` (e.g. `semantic.range.verticalSpeedMps`). |
| `semantic.frame-budget` | semantic | Forces only: `simulate()` with defaults does not throw `TOO_MANY_FRAMES` (frames <= `MAX_FRAMES`). |
| `semantic.unique-ids` | semantic | Explanation ids, prediction ids and behavioral test names are each unique. |
| `refs.sources` | grounding | Every evidence `sourceId` is declared in `spec.sources`, and every `spec.sources[].id` has a matching document in the provided `sources`. |
| `refs.sha256` | grounding | Per spec source: spec `sha256` == stored document `sha256` == `sha256(document.text)` recomputed. |
| `grounding.quotes` | grounding | Every explanation evidence quote, after `normalizeWhitespace`, is a substring of the normalised text of its document. Failure messages list offending quotes truncated to 60 chars. |
| `behavior.tests` | behavioral | Every `behavioralTests` item: `abs(expected - computeOutput(engine, case)) <= tolerance`, where `expected` is the descriptor's output key (`expectedAccelerationMps2`, `expectedMaxHeightM`, `expectedLiftN`, `expectedSpeedMps`). |
| `behavior.predictions` | behavioral | Same rule for every `predictions` item. |
| `semantic.tolerance` | semantic | Stage 5 (Muse review finding 5): every case (tests and predictions) also satisfies `tolerance <= maxTolerance(engine, computed) = max(absMax, relMax*\|computed\|)` — the schema's flat tolerance maximum is only a coarse guard. For forces this can never fail a schema-valid spec (Stage 2 cap 0.01 = absMax), which keeps recorded evidence valid. |
| `semantic.predictions-in-range` | semantic | Every prediction's input values lie inside the simulation slider ranges (inclusive), so students can reproduce them. |
| `behavior.trajectory` | behavioral | Forces only: `simulate()` at defaults: >= 2 frames; every `t/x/v/a` finite; per frame `v === a*t` and `x === 0.5*a*t^2` within 1e-9 absolute + 1e-9 relative. The other engines carry no duration/step budget in their specs. |
| `policy.no-publisher-attribution` | semantic | No generated display field (`title`, `learningObjectives`, `explanations[].text`, `predictions[].prompt`, `behavioralTests[].name`, and this engine's `scenario` labels from the descriptor) mentions the publisher (NASA / "National Aeronautics and Space Administration") or uses attribution/endorsement wording naming a source or authority (N-06: trigger phrase + capitalised word or "the source/publisher/agency/author/text" within 40 chars). Evidence quotes are exempt. |
| `scope.prose-unverified` | semantic | Always passes (R-08 honest scope): explanation prose is AI-generated; the wording needs teacher review. |

Report: `artifactId = spec.id`, `revision = spec.provenance.revision`
(`artifactId: 'unknown'`, `revision: 1` when the schema gate fails).

## `validateAnalysis` checks

| # | id | kind | rule |
|---|----|------|------|
| A | `schema.analysis` | schema | Ajv against `sourceAnalysisGenSchema`; failure short-circuits (`artifactId: 'source-analysis'`, `revision: 1`). |
| B | `analysis.invariants` | semantic | `supported === true` ⇒ `activity` is one of the four catalogue engine ids, `concepts.length >= 1`, `objectives.length >= 1`. `supported === false` ⇒ `activity === 'none'` and `unsupportedReason.trim()` non-empty (`supported ⇔ activity !== 'none'`). |
| C | `analysis.concept-ids` | semantic | Concept ids unique and each matches `/^[a-z0-9-]{1,40}$/`. |
| D | `refs.sources` | grounding | Every concept evidence `sourceId` has a matching document in `sources`. |
| E | `grounding.quotes` | grounding | Every concept evidence quote (whitespace-normalised) is a substring of its document's normalised text. |
| F | `policy.no-publisher-attribution` | semantic | Concept names, objectives and `unsupportedReason` carry no publisher attribution (same N-06 rule as the spec check); evidence quotes are exempt. |

## Design note: one root cause, one check

`refs.sources` is the only check that reports references which cannot be
resolved (an undeclared evidence `sourceId`, a spec source without a provided
document). `refs.sha256` and `grounding.quotes` skip unresolvable references,
because `publishable: true` requires `refs.sources` to pass — so an
unverifiable reference can never reach publication, and repair loops see each
defect under exactly one check id.

## Tests

```bash
node --test "packages/validation/**/*.test.ts"      # this package
npm run check                                       # repo typecheck + all tests
```

`validate.test.ts` covers the forces happy path (all 15 checks present and
passing), one schema-valid mutation per check that fails exactly the intended
check, schema-gate inputs (`null`, `'text'`, `{}`, …), whitespace-normalised
and ellipsis quotes, the real licensed source
`data/sources/nasa-grc-equations-of-motion.txt` (exact quote grounds;
paraphrase fails), direct `checkTrajectory` unit tests, and all
`validateAnalysis` invariants.

`validate.engines.test.ts` covers the Stage 5 generalisation: valid
hand-written specs for projectile/lift/sound (builders in
`fixtures/engine-specs.ts`, deliberately NOT under `tests/`), engine dispatch
(unknown/missing engine → a single failed `schema.full` naming the problem),
per-engine failing mutations (wrong output, too-large tolerance on a small
output, inverted range, prediction out of range, NASA in `settingLabel`,
hard-bound violations caught at the schema gate), `repairFindings`
structure/truncation, every `compareRevisions` (`repair.no-weakening`) rule,
and `validateAnalysis` with all four engine ids.

---

# Stage 6 (S6-V) — analysis v2 + kit component validation

Deterministic validators for `SourceAnalysisV2` (A-01..A-11) and every shared
component-kit gen (OV/Q/SEQ/SORT/CM/CT/FE/BAL check ids), per
`docs/specs/STAGE-6-design.md` (frozen) + the lead freeze addendum, on the
S6-0 contracts (`packages/contracts/kit.ts`). v1 behaviour is untouched.

## API

```ts
import { validateAnalysisV2, compareAnalysisV2Revisions, analysisV2RepairAuthority } from './analysis-v2.ts';
import {
  validateKitComponent,          // (componentId, gen, sources, opts?) -> ValidationReport
  compareKitRevisions,           // (componentId, baseline, next, {sources, findings?}) -> ValidationCheck 'repair.no-weakening'
  pruneQuizCards, pruneSequenceSteps, pruneSortItems, pruneConceptMapLinks,
  computeCaseOutputs, deriveBalanceSolution, KIT_FAILURE_MESSAGES,
} from './kit/index.ts';
```

- `validateAnalysisV2(analysis, sources)` — gate `schema.analysis-v2` +
  A-01..A-11 in frozen order. A-02 is retired (always passes).
- `validateKitComponent(componentId, gen, sources)` — `overview-v1` takes the
  `OverviewGen` body (manual structural gate; S6-0 ships no overview schema
  file); every other component goes through the Ajv gen-schema gate
  (`schema.gen`) and then its frozen check ids. **Item-count-only Ajv errors
  (minItems/maxItems) do NOT short-circuit**: the design's counts checks
  (OV-05, SEQ-05, SORT-05, CM-05, CT-03, BAL-02, and the quiz/FE structural
  `schema.gen` pass) own count violations with per-field `affected` paths.
  Any other schema error short-circuits like v1's `schema.full`.
- Reports: `publishable` requires every check to pass; failing checks carry
  validator-owned `affected` JSON-pointers into the GEN object (the artifact a
  repair revises). Nothing throws; every check is `guarded()`.
- Prune helpers (design §2.2f/§2.3f/§2.4f/§2.5d): drop items whose
  item-scoped checks fail while the component minimum remains (quiz >= 3
  cards, sequence >= 4 steps, sort >= 6 items AND >= 2/group, map >= 3 links),
  revalidating after every drop; return `{gen|null, dropped[{index,id,reason,checks}], failureMessage|null}`
  with the frozen design failure strings (`KIT_FAILURE_MESSAGES`).
- Repair comparators: the ONLY authority is the recomputed revision-1 report
  over the provided sources; caller `findings` may only narrow it (exact check
  id AND exact affected path). Changes only under authorized paths, list
  lengths/structure frozen (the SYSTEM prunes, never the model), `/id` leaves
  changeable only when the authority names them (valid pattern, no collision
  with sibling baseline ids), `tolerance` never increases, FE slider widths
  never shrink unless FE-06 failed, `hasSourceExample` never flips true→false
  unless FE-05 failed, analysis `usable` never flips true→false unless A-04
  failed. Without sources: fail closed.

## Parsers (no eval/Function anywhere)

- `expression.ts` — the frozen §2.7(d) grammar exactly: `^` tighter than
  unary minus, right-associative, `2^-1` allowed; functions
  `sqrt|exp|log|sin|cos|tan`, constants `pi|e`; longest-match lexer (`1e5` is
  one number, bare `e` the constant, `e5` an unknown name, `1e` implicit
  multiplication → rejected); `**` and implicit multiplication rejected in
  the final `expression` form; fixed normalisation for page formulas
  (`×·∙⋅→*`, `**→^`, unicode minus/superscripts, whitespace ignored); AST
  budget 50; total evaluator — ÷0, `sqrt(<0)`, `log(<=0)`, `0^negative`,
  `|exponent|>100` and any non-finite intermediate yield NaN.
- `chemistry.ts` — element symbols Z=1..118 (unknown rejected), subscripts
  1-999 without leading zeros, `()`/`[]` groups depth <= 2, hydrate dots and
  charges rejected, state symbols `(s)|(l)|(g)|(aq)` stripped, unicode
  subscripts/arrows normalised. `balanceSpecies` solves M·c=0 EXACTLY over
  BigInt (Bareiss elimination; kernel via signed maximal minors): nullity 0 →
  `no-solution`, nullity 1 → lowest positive integers (gcd 1, verified
  A·c=0), nullity >= 2 → `ambiguous`.

## FE-08 (addendum definition)

Parse the page's quoted formula line with the same lexer/grammar when
possible (split at the first `=`, cut trailing prose, map `pageSymbol` →
`name` at token boundaries, truncate at unmappable tokens/characters) and
compare with `expression` at 5 sample points spread over the slider ranges
(fractions 0.1/0.3/0.5/0.7/0.9 of every `[min,max]`), relative tolerance
1e-9, skipping non-finite points; >= 3 finite agreeing points required. An
unparseable page formula publishes ONLY with a verified FE-05 source example
(the UI shows the "Formula entered by AI" note); else FE-08 fails with the
frozen message "The formula could not be checked with our calculator."
FE-05 verifies a declared example by searching every injective assignment of
the quote's number tokens to the variables for one that reproduces
`resultNumber` within `tolerance` (design vector: `X=(1/2)*a*t^2`,
`a=9.8, t=2 → 19.6`).

## Recorded interpretations (lead may overrule)

1. **OV-02 sentence fallback**: a term grounds via its quote OR the source
   sentence containing the located quote (needed by the golden fixture's
   "dynamic pressure" entry; mirrors the timeline S5B-02 sentence-unit
   precedent).
2. **CM-03 trigger table** (`kit/concept-map.ts` `RELATION_TRIGGERS`): the
   relation phrase in the quote, or a frozen per-relation trigger word in the
   quote/its sentence; `needs`/`uses` include equation connectors
   (times/multiplied/divided/equal to/squared) so formula-page maps ground.
3. **CT-05 never fails** (design: reveal-only fallback is not a component
   failure); the message records predict-mode availability.
4. **A-08 single-kit plans allowed** (R-PLAN-1 "1-3 entries" vs R-PLAN-5
   "2-3 kit" conflict; the lenient reading serves partial publish).
5. **SEQ-03 across documents** compares `(provided-source index, offset)`.
6. Quiz Q-05 can never fail without Q-02 or Q-07 (same substring rule) — the
   co-failures are pinned in tests.
7. **KNOWN GOLDEN GAP**: `tests/fixtures/stage6/source-analysis-v2.usable.json`
   → overview fails OV-06 on `/keyPoints/1/point`, `/keyTerms/0/gloss`,
   `/keyTerms/1/gloss` (paraphrases share too few content words). This is the
   design's own documented false-reject class; the fixture should be reworded
   (repair path) rather than the check weakened. `fixtures/stage6.ts`
   `repairedOverviewGen()` shows a passing rewrite; the gap is pinned in
   `stage6-kit-golden.test.ts`.
8. A-09 publisher tokens: publisher phrase = first comma segment after
   "Source material:" and of the post-dash title part; distinctive single
   words only from those segments (COMMON_PUBLISHER_WORDS stoplist); all-caps
   acronyms from the attribution (NASA, NIJ, ...); plus the frozen generic
   phrases. Non-conforming attributions (teacher-pasted) match as full
   phrases only. Tested against every real `data/sources` metadata entry with
   a neutral-text battery (no false rejects).

## Stage 6 tests

`expression.test.ts`, `chemistry.test.ts` (parser/balance vectors incl. all
task-required cases); `stage6-analysis-v2.test.ts` (goldens, per-check
fixtures, A-09 on all real sources, v2 repair discipline);
`stage6-kit-golden.test.ts` (every frozen golden fixture; check-id order;
count-exempt gate); `stage6-kit-checks.test.ts` (one failing fixture per
OV/Q/SEQ/SORT/CM/CT check id); `stage6-formula-explorer.test.ts`;
`stage6-balance.test.ts`; `stage6-kit-prune.test.ts`;
`stage6-kit-repair.test.ts`. Fixtures/synthetics live in
`packages/validation/fixtures/stage6.ts` (deliberately NOT under `tests/`).

