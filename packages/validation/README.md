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
