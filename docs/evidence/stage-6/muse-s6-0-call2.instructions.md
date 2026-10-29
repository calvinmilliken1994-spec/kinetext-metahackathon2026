# S6-0 call 2 — repair + review fixes for your call-1 files

Your call-1 files were saved verbatim (the lead only remapped the `=== FILE:` headers from `packages/meta/...` to the instructed paths; use the REAL paths below this time). Results: `node scripts/build-schemas.ts` wrote the 8 new schemas, `--check` passes, every existing schema file is byte-identical, 8 of 9 tests in `tests/contracts.stage6.test.ts` pass. Fix the items below and return COMPLETE files for exactly these three paths, in this order:

=== FILE: packages/contracts/kit.ts ===
=== FILE: scripts/build-schemas.ts ===
=== FILE: tests/contracts.stage6.test.ts ===

then `=== NOTES ===`. Do NOT return the fixtures (they are correct and stay unchanged). Use three-backtick fences only; never put three consecutive backticks inside file content. All other rules from call 1 still hold (erasable TypeScript only, `import type` for types, kit.ts browser-safe, existing schema output byte-identical, allowed schema keywords only).

## R1 (typecheck, `npm run typecheck`)
```
tests/contracts.stage6.test.ts(435,33): error TS2345: Argument of type 'BalanceEquationGen | CompareTableGen | ConceptMapGen | FormulaExplorerGen | QuizCardsGen | SequenceGen | SortGroupsGen' is not assignable to parameter of type 'QuizCardsGen'.
  Property 'cards' is missing in type 'BalanceEquationGen' but required in type 'QuizCardsGen'.
```
Type the per-component golden loaders so each returns its own gen type (e.g. a typed `goldenGen<C extends KitGenComponentId>(c: C): KitGenByComponent[C]` that reads `KIT_GEN_SCHEMA_FILES[c]` — the golden file names equal the schema file names), and remove the long file-name ternary chain.

## R2 (failing test "stage6 goldens quote real sources exactly ...")
`AssertionError: formula-explorer.gen.json unknown source` — `FormulaVarGen.quote` and `FormulaSourceExampleGen.quote` have no own `sourceId`; they quote the explorer's top-level `sourceId` (design §2.7). Fix `quoteEntries` to inherit the NEAREST ANCESTOR `sourceId` when an object has a `quote` but no `sourceId`. An empty quote may be skipped ONLY for `sourceExample.quote` when the golden's `hasSourceExample` is false; any other empty quote must fail the test. (The lead verified that, with inheritance, every golden quote is an exact substring of its source.)

## R3 (kit.ts + schema descriptions: make the inherited source explicit)
- Add a short doc comment on `FormulaVarGen.quote` and `FormulaSourceExampleGen.quote`: "Verbatim span of the explorer's `sourceId` source" (validators check them against that source).
- In `scripts/build-schemas.ts`, the descriptions of `variables[].quote` and `sourceExample.quote` must say they are copied from the same source as the formula quote (the explorer's sourceId). Keep everything else in the generated schemas the same.

## R4 (kit.ts: no aliasing of system objects)
`assembleKitSpec` and `assembleOverviewSpec` currently store `opts.execution ?? KIT_DEFAULT_EXECUTION` and `opts.provenance` by reference, so mutating one stored spec mutates `KIT_DEFAULT_EXECUTION` (shared by all later specs) or the caller's provenance. Store copies (`structuredClone`) of execution and provenance, and copy each source ref object. Additionally make `KIT_DEFAULT_EXECUTION` frozen (`Object.freeze`) while keeping its type `Execution`. Add a top-of-file header comment to kit.ts in the style of index.ts (Stage 6 kit contracts v0.6.0, frozen by the lead from `docs/specs/STAGE-6-design.md` + addendum; erasable syntax only; browser-safe), plus one-line doc comments on `KitSpecBase`, `LessonSpec`, `STAGE6_CHECKS` (A-02 and BAL-06 retired: reserved, never reused, always pass), `assembleKitSpec`, `assembleOverviewSpec`. No other behaviour change in kit.ts; every export name stays identical.

## R5 (build-schemas.ts: restore deleted comments)
Your version deleted four existing comments. Restore them verbatim at their original positions:
- the 4-line file header starting `// Generates the per-engine JSON schemas from packages/contracts/engines.ts (lead-owned).` (exact text in the ORIGINAL file below), extended by ONE added line saying it also generates the Stage 6 v2-analysis and kit gen schemas from `packages/contracts/kit.ts`;
- `// forces-1d-v1: original files; widen the accepted schema versions only.`
- `// timeline-v1 (sequence engine): events with integer dates (month/day 0 = not stated) + ordering pairs.`
Keep your new Stage 6 section; add a one-line comment above it.

## R6 (test strength — review findings)
1. Mutation rejection must cover EVERY object level, not only the first array: walk each golden together with its schema; for every object instance reached (root, and element 0 of every non-empty array at every depth, e.g. `cases[0].inputs[0]`, `variables[0]`, `overview.keyPoints[0]`, `sourceExample`) assert that (a) deleting each required key in turn is rejected and (b) adding an extra key `zzzExtra` is rejected. Report in the assertion message the JSON path and key. Remove the unused helpers `firstObjectProps` / `firstArrayItemSchema` and their `void` lines.
2. Smuggled gen keys: add `sources: 'x'` to the smuggled set and assert `clean.execution` deep-equals `KIT_DEFAULT_EXECUTION`, `clean.provenance` deep-equals the fixture provenance and `clean.sources` deep-equals the source refs (no `text`), instead of the weak `notEqual(maxWallTimeMs, 'x')`.
3. The current "mutation does not change the stored spec" check is wrong (it compares two fresh assemblies). Replace it: assemble a spec, snapshot `JSON.stringify(spec)`, then mutate the ORIGINAL gen deeply (change the first element's string fields inside the first body array or object, push an element, set `title`), and assert the snapshot still equals `JSON.stringify(spec)`. Same for `assembleOverviewSpec` (mutate `analysis.overview.keyPoints[0].point`, push to `keyTerms`).
4. Aliasing (R4): mutating `spec.execution.maxWallTimeMs` of one assembled spec leaves `KIT_DEFAULT_EXECUTION` and a second assembled spec unchanged; mutating `spec.provenance.runId` leaves the caller's provenance object unchanged; `Object.isFrozen(KIT_DEFAULT_EXECUTION)` is true.
5. Keep every other assertion you already have.

# CURRENT FILES
