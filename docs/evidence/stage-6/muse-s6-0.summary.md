# S6-0 summary — Stage 6 contracts (Muse Spark 1.3, 2 bridge calls)

Authored by `muse-spark-1.3` (receipts `muse-s6-0-call1.json`, `muse-s6-0-call2.json`); applied byte-for-byte by the orchestrator.

## Files
- `packages/contracts/kit.ts` (new; re-exported from `index.ts`), `packages/contracts/schemas.ts` (+ `sourceAnalysisV2GenSchema`, `kitGenSchemaFor(componentId)`), `scripts/build-schemas.ts` (+ Stage 6 section).
- Generated gen schemas: `schemas/source-analysis-v2.gen.json`, `quiz-cards.gen.json`, `sequence.gen.json`, `sort-groups.gen.json`, `concept-map.gen.json`, `compare-table.gen.json`, `formula-explorer.gen.json`, `balance-equation.gen.json`.
- Tests `tests/contracts.stage6.test.ts`; goldens `tests/fixtures/stage6/*` (real quotes from nasa-grc-drag-equation, nara-constitution, nij-heterozygosity, nasa-grc-earth-atmosphere-equation-english; balance golden quotes a synthetic text).

## kit.ts exports
KIT_SCHEMA_VERSION KitSchemaVersion SUBJECTS Subject isSubject DECLINE_CODES DeclineCode KIT_COMPONENT_IDS KitComponentId isKitComponentId KIT_GEN_COMPONENT_IDS KitGenComponentId isKitGenComponentId PLAN_COMPONENT_IDS PlanComponentId isPlanComponentId KIT_GEN_SCHEMA_FILES SOURCE_ANALYSIS_V2_GEN_SCHEMA_FILE CONCEPT_MAP_RELATIONS ConceptMapRelation SEQUENCE_ORDER_BASES SequenceOrderBasis BALANCE_SIDES BalanceSide KIT_ID_PATTERN FORMULA_VAR_NAME_PATTERN FORMULA_FUNCTIONS FORMULA_CONSTANTS FORMULA_RESERVED_NAMES KIT_LIMITS SourceAnalysisV2 OverviewGen KeyPointGen KeyTermGen ComponentPlanEntry QuizCardsGen QuizCardGen SequenceGen SequenceStepGen SortGroupsGen SortGroupGen SortItemGen ConceptMapGen MapNodeGen MapLinkGen CompareTableGen CompareCellGen FormulaExplorerGen FormulaVarGen FormulaCaseGen FormulaInputGen FormulaSourceExampleGen BalanceEquationGen BalanceSpeciesGen KitGenByComponent KitSpecBase OverviewSpec QuizCardsSpec SequenceSpec SortGroupsSpec ConceptMapSpec CompareTableSpec FormulaExplorerSpec BalanceEquationSpec KitSpecByComponent KitSpec LESSON_COMPONENT_STATUSES LessonComponentStatus LessonComponentEntry LessonSpec STAGE6_CHECKS Stage6CheckId STAGE6_CHECK_IDS RETIRED_STAGE6_CHECK_IDS ANALYSIS_V2_REPAIRABLE_CHECK_IDS CHECK_PREFIX_BY_COMPONENT checkIdsFor KitAssembleOptions KIT_DEFAULT_EXECUTION kitSpecId KIT_GEN_BODY_KEYS assembleKitSpec assembleOverviewSpec

## Deviations from STAGE-6-design.md (decided by the orchestrator in the call-1 brief)
- D1 `FormulaExplorerGen.cases[].inputs` is `{ name, value }[]` (`FormulaInputGen`), not `Record<string, number>`: a constrained-decoding schema needs every key known and required.
- D2 `sourceExample` is an object `{ quote, resultNumber, tolerance }`; `''/0/0` when `hasSourceExample` is false. Variable quotes and `sourceExample.quote` carry no own sourceId: they quote the explorer's `sourceId` source.
- D3 explorer `cases` count 1-4 (design gave none).
- D4 `KitSpecBase` reuses `SourceRef`, `Provenance` (`repairOf: number | null`, unchanged) and the existing `Execution` (which also has `maxRepairAttempts`). No change to Provenance was needed.
- D5 v2 analysis schema is `schemas/source-analysis-v2.gen.json` (the design's `source-analysis.gen.json` is the live v1 file and stays unchanged).
- D6 `LessonSpec.overview: OverviewSpec | null` (null only for a declined analysis).
- D7 `ComponentPlanEntry.componentId` is an enum of `PLAN_COMPONENT_IDS` (15 ids); `declineCode` is an enum of `['', ...DECLINE_CODES]`.
- D8 retired ids `A-02`, `BAL-06` (reserved, always pass).
- D9 stored kit specs: `schemaVersion: '0.6.0'` + `componentId`; the gen-level `schemaVersion` (= component id) is checked by `assembleKitSpec` (`KIT_COMPONENT_MISMATCH`) and not stored.
- Gen schemas carry array `minItems`/`maxItems` only where unconditional; string lengths, id patterns and numeric ranges stay in descriptions and are validator checks (repairable), as in the v1 gen schemas. `minItems`/`maxItems` are not yet proven against the live Meta / Modal structured-output endpoints — S6-M should smoke one kit schema before relying on them.

## Mechanical orchestrator edits
1. Call 1 `=== FILE:` headers remapped from `packages/meta/...` to the instructed paths (`muse-s6-0-call1.pathmap.json`); bodies unchanged.
2. Appended `export * from './kit.ts';` to `packages/contracts/index.ts`.
3. Ran `node scripts/build-schemas.ts` to generate the 8 schema files.
