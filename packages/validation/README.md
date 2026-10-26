# packages/validation — deterministic validation engine (TASK-003)

Structural JSON Schema validation alone does not meet the publish gate. This
package re-verifies every claim in a generated artifact with deterministic
code before a student sees it: internal consistency, source grounding
(references, hashes, verbatim quotes) and physics behaviour against the
closed-form `forces-1d-v1` engine.

## API

```ts
import { validateSpec, validateAnalysis, normalizeWhitespace, checkTrajectory } from './validate.ts';
```

- `normalizeWhitespace(s)` — replaces every `/\s+/g` run with one space, then
  trims. Case-sensitive; no quote/ellipsis folding. Quotes are compared
  against source text after this normalisation on both sides.
- `validateSpec(spec, sources) -> ValidationReport` — 13 checks (below).
- `validateAnalysis(analysis, sources) -> ValidationReport` — 5 checks (below).
- `checkTrajectory(frames)` — the frame-invariant core of
  `behavior.trajectory`, exported for direct unit testing.

Neither validate function ever throws: `null`, strings and malformed objects
degrade into failed checks. The Ajv schema check is a hard gate — when it
fails, the report contains only that check (message lists up to 5 errors as
`instancePath message`), `publishable: false`, and `revision: 1`. Every later
check is individually guarded, so a crash inside one check is recorded as a
failure and cannot hide the others. `publishable` is true only when **all**
checks pass.

## `validateSpec` checks

| # | id | kind | rule |
|---|----|------|------|
| 1 | `schema.full` | schema | Ajv (allErrors) against `activitySpecFullSchema`; failure short-circuits the report. |
| 2 | `semantic.mass-range` | semantic | `massKg.min < massKg.max` and `min <= default <= max`. |
| 3 | `semantic.force-range` | semantic | `netForceN.min < netForceN.max` and `min <= default <= max`. |
| 4 | `semantic.frame-budget` | semantic | `simulate()` with defaults does not throw `TOO_MANY_FRAMES` (frames <= `MAX_FRAMES`). |
| 5 | `semantic.unique-ids` | semantic | Explanation ids, prediction ids and behavioral test names are each unique. |
| 6 | `refs.sources` | grounding | Every evidence `sourceId` is declared in `spec.sources`, and every `spec.sources[].id` has a matching document in the provided `sources`. |
| 7 | `refs.sha256` | grounding | Per spec source: spec `sha256` == stored document `sha256` == `sha256(document.text)` recomputed. |
| 8 | `grounding.quotes` | grounding | Every explanation evidence quote, after `normalizeWhitespace`, is a substring of the normalised text of its document. Failure messages list offending quotes truncated to 60 chars. |
| 9 | `behavior.tests` | behavioral | Every `behavioralTests` item: `abs(expectedAccelerationMps2 - accelerationOf(massKg, netForceN)) <= tolerance`. |
| 10 | `behavior.predictions` | behavioral | Same rule for every `predictions` item. |
| 11 | `semantic.predictions-in-range` | semantic | Every prediction's `massKg`/`netForceN` lie inside the simulation slider ranges (inclusive), so students can reproduce them. |
| 12 | `behavior.trajectory` | behavioral | `simulate()` at defaults: >= 2 frames; every `t/x/v/a` finite; per frame `v === a*t` and `x === 0.5*a*t^2` within 1e-9 absolute + 1e-9 relative. |
| 13 | `policy.no-publisher-attribution` | semantic | `title`, `learningObjectives`, `explanations[].text` and `predictions[].prompt` must not attribute claims to the publisher (fails on `/according to nasa|\bnasa (says\|said\|states\|stated\|explains\|confirms\|recommends\|reports)\b/i`). NASA's AI-use guidance forbids attributing AI output to NASA. |

Report: `artifactId = spec.id`, `revision = spec.provenance.revision`
(`artifactId: 'unknown'`, `revision: 1` when the schema gate fails).

## `validateAnalysis` checks

| # | id | kind | rule |
|---|----|------|------|
| A | `schema.analysis` | schema | Ajv against `sourceAnalysisGenSchema`; failure short-circuits (`artifactId: 'source-analysis'`, `revision: 1`). |
| B | `analysis.invariants` | semantic | `supported === true` ⇒ `activity === 'forces-1d-v1'`, `concepts.length >= 1`, `objectives.length >= 1`. `supported === false` ⇒ `activity === 'none'` and `unsupportedReason.trim()` non-empty. |
| C | `analysis.concept-ids` | semantic | Concept ids unique and each matches `/^[a-z0-9-]{1,40}$/`. |
| D | `refs.sources` | grounding | Every concept evidence `sourceId` has a matching document in `sources`. |
| E | `grounding.quotes` | grounding | Every concept evidence quote (whitespace-normalised) is a substring of its document's normalised text. |

## Design note: one root cause, one check

`refs.sources` is the only check that reports references which cannot be
resolved (an undeclared evidence `sourceId`, a spec source without a provided
document). `refs.sha256` and `grounding.quotes` skip unresolvable references,
because `publishable: true` requires `refs.sources` to pass — so an
unverifiable reference can never reach publication, and repair loops see each
defect under exactly one check id.

## Tests

```bash
node --test packages/validation/validate.test.ts   # this package
npm run check                                       # repo typecheck + all tests
```

The suite covers the happy path (all checks present and passing), one
schema-valid mutation per check (2–13) that fails exactly the intended check,
schema-gate inputs (`null`, `'text'`, `{}`, …), whitespace-normalised and
ellipsis quotes, the real licensed source
`data/sources/nasa-grc-equations-of-motion.txt` (exact quote grounds;
paraphrase fails), direct `checkTrajectory` unit tests, and all
`validateAnalysis` invariants.
