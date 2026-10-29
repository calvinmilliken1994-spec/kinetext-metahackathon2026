# S6-M call 3 — Stage 6 pipeline functions (analysis v2, per-component generation, repairs) + one test fix

Your call-2 prompt files are saved verbatim (current contents below). `prompts-v2.ts` is accepted. One test in `prompts-v2.test.ts` still fails because the lead's call-1 test brief was self-contradictory (lead error, not yours): see T1. Then write the pipeline.

Return COMPLETE files for exactly these four paths, in this order, with these exact header lines and SIX-backtick fences (a line of six backticks + `ts`/`md` to open, six backticks to close):

=== FILE: packages/meta/pipeline-v2.ts ===
=== FILE: packages/meta/pipeline-v2.test.ts ===
=== FILE: packages/meta/prompts-v2.test.ts ===
=== FILE: packages/meta/README.md ===

then `=== NOTES ===`. Do NOT return `prompts-v2.ts`, `pipeline.ts` or any contract file: v1 `pipeline.ts` stays byte-identical. Common rules hold (erasable TypeScript only, `import type` for types, relative imports ending `.ts`, no new packages, no network).

## T1 — fix `untrusted data escaping` in prompts-v2.test.ts (only this test changes)
`assert.equal(countOccurrences(componentUser, '</analysis>'), 1)` fails with 2 because the synthetic SOURCE text itself contains `</analysis>`; the source is protected by its unforgeable boundary, not by escaping, so it legitimately keeps raw tags. Keep the synthetic source text as is. Add a helper `withoutSourceBlock(user: string): string` that removes the whole wrapped source block (from `<source id=` to the end of the closing `</source boundary="...">` line, found via the boundary value in the opening tag), and do every raw closing-tag count (`</untrusted-source-metadata>`, `</analysis>`, `</plan-entry>`, `</untrusted-component-repair-data>`, `</untrusted-analysis-repair-data>`) on `withoutSourceBlock(user)`. Additionally assert that the source block itself still contains the raw text `</analysis>` (data unchanged inside the boundary). Everything else in the file stays byte-identical.

## Pipeline design (v1-consistent; S6-W, the job runner, depends on these exact exports)
Pattern decision (record it in a top-of-file comment): like v1, every function returns the model output plus its receipt and, where a checker is available, a `ValidationReport`. Unlike v1, the Stage 6 checkers live in `packages/validation` and are being written concurrently, so `pipeline-v2.ts` imports NOTHING from `packages/validation`; the caller INJECTS the checker functions (typed against the contracts' `ValidationReport` / `ValidationCheck`). Analysis and component generation take an OPTIONAL validator (no report without it); repairs REQUIRE a validator, because repair authorization must be recomputed from revision 1.

Imports allowed: `ajv` (as v1: `import { Ajv } from 'ajv'`, `type { AnySchemaObject, ValidateFunction }`, `new Ajv({ allErrors: true, strict: false })`), `node:util` (`isDeepStrictEqual`), `../contracts/index.ts` (types), `../contracts/kit.ts`, `../contracts/schemas.ts` (`sourceAnalysisV2GenSchema`, `kitGenSchemaFor`), `./prompts-v2.ts`, `./pipeline.ts` (`GeneratedOutputError` only), `./client.ts` (types).

```ts
export const ANALYSIS_V2_MAX_OUTPUT_TOKENS: 16000 = 16000;   // hard cap, call 1
export const KIT_CALL_MAX_OUTPUT_TOKENS: 12000 = 12000;      // hard cap, component and every repair call
export type V2Purpose = 'test-live' | 'demo';
export type V2Validator<T> = (value: T, sources: SourceDocument[]) => ValidationReport;
export type V2RevisionComparator<T> = (baseline: T, candidate: T, sources: SourceDocument[]) => ValidationCheck;
export interface V2CallOptions { signal?: AbortSignal; maxOutputTokens?: number }
export type V2GeneratedOutputStage = 'analyze-v2' | 'component' | 'component-repair' | 'analysis-v2-repair';
export class GeneratedOutputErrorV2 extends GeneratedOutputError {
  readonly v2Stage: V2GeneratedOutputStage;
  constructor(v2Stage: V2GeneratedOutputStage, receipt: MetaReceipt);
}
export async function analyzeSourceV2(
  client: MetaClient, source: SourceDocument, purpose: V2Purpose,
  opts?: V2CallOptions & { validate?: V2Validator<SourceAnalysisV2> },
): Promise<{ analysis: SourceAnalysisV2; report?: ValidationReport; receipt: MetaReceipt }>;
export async function generateKitComponent<C extends KitGenComponentId>(
  client: MetaClient, source: SourceDocument, analysis: SourceAnalysisV2,
  planEntry: ComponentPlanEntry & { componentId: C }, purpose: V2Purpose,
  opts?: V2CallOptions & { validate?: V2Validator<KitGenByComponent[C]> },
): Promise<{ gen: KitGenByComponent[C]; report?: ValidationReport; receipt: MetaReceipt }>;
export async function repairKitComponent<C extends KitGenComponentId>(
  client: MetaClient, source: SourceDocument, analysis: SourceAnalysisV2,
  planEntry: ComponentPlanEntry & { componentId: C },
  previous: { gen: KitGenByComponent[C]; report: ValidationReport; attempt: number; baseline?: { gen: KitGenByComponent[C] } },
  purpose: V2Purpose,
  opts: V2CallOptions & { validate: V2Validator<KitGenByComponent[C]>; compare?: V2RevisionComparator<KitGenByComponent[C]> },
): Promise<{ gen: KitGenByComponent[C]; report: ValidationReport; receipt: MetaReceipt; authorizedPaths: string[] }>;
export async function repairAnalysisV2(
  client: MetaClient, source: SourceDocument,
  previous: { analysis: SourceAnalysisV2; report: ValidationReport; attempt: number; baseline?: { analysis: SourceAnalysisV2 } },
  purpose: V2Purpose,
  opts: V2CallOptions & { validate: V2Validator<SourceAnalysisV2>; compare?: V2RevisionComparator<SourceAnalysisV2> },
): Promise<{ analysis: SourceAnalysisV2; report: ValidationReport; receipt: MetaReceipt; authorizedPaths: string[] }>;
```

### `GeneratedOutputErrorV2`
Subclass of the v1 `GeneratedOutputError` (so `instanceof GeneratedOutputError`, `code === 'OUTPUT_INVALID'`, the fixed message and `receipt` all hold and the existing job-runner cost accounting recognises it). Pass the matching v1 stage to `super`: `analyze-v2`→`analyze`, `component`→`specify`, `component-repair`→`repair`, `analysis-v2-repair`→`analysis-repair` (a `const` map); set `this.name = 'GeneratedOutputError'` and `this.v2Stage`.

### Guards (all thrown as plain `Error(<CODE>)` BEFORE any model call; no request is made)
- `MAX_OUTPUT_TOKENS_INVALID`: `opts.maxOutputTokens` present and not an integer in [1, cap] (cap = 16000 for analysis, 12000 otherwise). Default = the cap.
- Component/repair-component: `ANALYSIS_DECLINED` (analysis.usable !== true), then `KIT_COMPONENT_REQUIRED` (planEntry.componentId not a `KitGenComponentId`), then `PLAN_ENTRY_NOT_IN_ANALYSIS` (no entry of `analysis.componentPlan` is `isDeepStrictEqual` to `planEntry`).
- Repairs: `REPAIR_ATTEMPT_INVALID` (attempt not an integer 1 or 2); `REPAIR_BASELINE_REQUIRED` (attempt 2 without `previous.baseline` — the immutable revision 1 must be passed explicitly on attempt 2); `NOTHING_TO_REPAIR` (`previous.report.checks` not an array or has no failing check); repair-component also `COMPONENT_MISMATCH` when `previous.gen.schemaVersion` (or `previous.baseline.gen.schemaVersion`) differs from `planEntry.componentId`.

### Requests (exactly like v1: build a `CompleteRequest`, add `signal` only when provided — no `signal` key otherwise)
- analysis: `schemaName: ANALYSIS_V2_SCHEMA_NAME`, `jsonSchema: sourceAnalysisV2GenSchema` (the same object), `messages: buildAnalysisV2Messages(source)`.
- component: `schemaName: KIT_SCHEMA_NAMES[c]`, `jsonSchema: kitGenSchemaFor(c)`, `messages: buildKitComponentMessages(source, analysis, planEntry)`.
- repair-component: `schemaName: KIT_REPAIR_SCHEMA_NAMES[c]`, `jsonSchema: kitGenSchemaFor(c)`, `messages: buildKitComponentRepairMessages(source, analysis, planEntry, { original: baseline, previous: previous.gen, findings, authorizedPaths })`.
- repair-analysis: `schemaName: ANALYSIS_V2_REPAIR_SCHEMA_NAME`, `jsonSchema: sourceAnalysisV2GenSchema`, `messages: buildAnalysisV2RepairMessages(source, { original: baseline, previous: previous.analysis, findings, authorizedPaths })`.

### Output check
`result.data` must be a plain object (v1 `isPlainObject`) that passes the ajv-compiled schema (compile the analysis schema once at module load; compile kit schemas lazily per component and cache them in a Map), and for kit outputs `schemaVersion === componentId`; otherwise throw `new GeneratedOutputErrorV2(<stage>, result.receipt)`.

### Reports and the immutable revision-1 baseline (repair integrity — read carefully)
- Never pass caller objects to injected functions: every value given to `validate`/`compare` is a `structuredClone`, and the returned `analysis`/`gen` is the model's object (not shared with what validators saw). The functions never mutate `analysis`, `planEntry`, `previous` or `baseline`.
- `analyzeSourceV2`/`generateKitComponent`: with `opts.validate`, `report = validate(clone(output), [source])`; without it the result has NO `report` key.
- Repairs: `baseline = previous.baseline?.analysis|gen ?? previous.analysis|gen` (revision 1). `authorizedPaths` is recomputed ONLY from `opts.validate(clone(baseline), [source])`: the de-duplicated `affected` strings (non-empty, first-seen order) of its failing checks, skipping checks whose id starts with `repair.`; if that call throws or returns no `checks` array, `authorizedPaths = []` (fail closed). Never derive paths from `previous.report`, findings or message text.
- `findings` (shown to the model) come from `previous.report`'s failing checks, one `RepairFinding` each, copying only `id`, `kind`, `message`, and `path`/`affected` when present (no other keys).
- After a schema-valid repair output: `base = validate(clone(candidate), [source])`; `checks = [...base.checks]` plus, when `opts.compare` is given, `compare(clone(baseline), clone(candidate), [source])` appended; `report = { artifactId: base.artifactId, revision: previous.attempt + 1, checks, publishable: checks.every((c) => c.passed) }`. Return `authorizedPaths` too.
- If an injected `validate`/`compare` throws AFTER the model call (any function), throw `new GeneratedOutputErrorV2(<stage>, result.receipt)` so the billed receipt is never lost.

## Tests — `packages/meta/pipeline-v2.test.ts` (node:test + node:assert/strict; fake `MetaClient` only; no network)
A fake client is `{ async complete<U>(req) { requests.push(req); return { data: <next queued value> as U, receipt: fakeReceipt }; } }` (see the v1 test pattern; `MetaReceipt` fields: purpose, requestedModel, returnedModel, responseId, usage, latencyMs, estCostUSD, finishReason, attempts). Goldens: `tests/fixtures/stage6/*.json` (README below lists which source each quotes; load real sources with `loadSource(id)` from `../sources/index.ts`; for `balance-equation.gen.json` build a `SourceDocument` `{ id: 'synthetic-balance', title: 'Synthetic balance source', locator: 'tests/fixtures/stage6/balance.synthetic-source.txt', license: 'project-authored synthetic', attribution: 'Project-authored synthetic text', sha256: <sha256 hex of the text via node:crypto>, text }`). For a component test, use the usable analysis with `componentPlan` replaced by one entry `{ componentId: c, pedagogicalReason: 'Practise the key ideas of this page.', focusQuote: <the golden's first quote>, focusSourceId: <its source id> }`, and `subject: 'chemistry'` for balance. Every schema in this project has `additionalProperties: false` and all keys required. Cover at least:
1. `analyzeSourceV2` happy path (usable AND declined goldens): one request with `schemaName === 'source_analysis_v2'`, `jsonSchema === sourceAnalysisV2GenSchema` (strictEqual), `maxOutputTokens === 16000`, messages deep-equal `buildAnalysisV2Messages(source)`, `purpose` passed, no `signal` key; with an `AbortController` signal the request carries that exact signal; result deep-equals the golden; no `report` key without `validate`; with a validator that MUTATES its argument, the returned analysis still deep-equals the golden and `report` is the validator's report.
2. `maxOutputTokens`: 8000 is used as given; 16001, 0, 1.5 (analysis) and 12001 (component, repair) throw `MAX_OUTPUT_TOKENS_INVALID` with zero requests.
3. Malformed output for every function (missing required key, an extra key, an array, `null`, a string; for a component also the golden of ANOTHER component): rejects with an error that is `instanceof GeneratedOutputError` and `instanceof GeneratedOutputErrorV2`, `code === 'OUTPUT_INVALID'`, the fixed v1 message, the mapped v1 `stage`, the `v2Stage`, and `receipt` deep-equal to the fake receipt.
4. `generateKitComponent` for EVERY `KIT_GEN_COMPONENT_IDS` id with its golden and source: `schemaName === KIT_SCHEMA_NAMES[c]`, `jsonSchema === kitGenSchemaFor(c)`, `maxOutputTokens === 12000`, messages deep-equal `buildKitComponentMessages(...)`, gen deep-equals the golden; guards `ANALYSIS_DECLINED`, `KIT_COMPONENT_REQUIRED` (`forces-1d-v1`, `timeline-v1`), `PLAN_ENTRY_NOT_IN_ANALYSIS` each with zero requests.
5. Repair baseline immutability (component, quiz golden as revision 1, deep-frozen with a recursive `Object.freeze`): a fake validator that, for revision 1, fails check `Q-01` with `affected: ['/cards/1/quote']` (and a passing check), and for any other object fails `Q-04` with `affected: ['/cards/2/stem']`; attempt 1 with `previous = { gen: rev1, report: validator(rev1), attempt: 1 }` → the request payload (JSON.parse of the text between the repair tags) has `originalSpec` deep-equal rev1 and `authorizedPaths` `['/cards/1/quote']`; the fake returns rev2 (rev1 with a changed `cards[2].stem`); attempt 2 with `previous = { gen: rev2, report: validator(rev2), attempt: 2, baseline: { gen: rev1 } }` → payload `originalSpec` deep-equals rev1 (NOT rev2), `previousSpec` deep-equals rev2, `authorizedPaths` still `['/cards/1/quote']`, findings contain `Q-04`; rev1 is still frozen and `JSON.stringify(rev1)` equals the snapshot taken before; a validator that mutates its argument does not change rev1/rev2/analysis/planEntry; `REPAIR_BASELINE_REQUIRED` for attempt 2 without baseline; `REPAIR_ATTEMPT_INVALID` for 0, 3, 1.5; `NOTHING_TO_REPAIR` for an all-passing report; `COMPONENT_MISMATCH` for a sequence gen with a quiz plan entry; a validator that throws on the baseline gives `authorizedPaths` `[]` and still calls the model; checks with id `repair.x` never contribute paths; `report.revision === attempt + 1`; a failing `compare` check is appended and makes `publishable` false; a passing one keeps it true; a validator that throws after the call rejects with `GeneratedOutputErrorV2` (`v2Stage 'component-repair'`) carrying the receipt; `schemaName === KIT_REPAIR_SCHEMA_NAMES['quiz-cards-v1']` and `maxOutputTokens === 12000`.
6. The same core set for `repairAnalysisV2` on the usable analysis golden (affected e.g. `['/overview/keyPoints/0/point']`): payload `originalAnalysis` = revision 1 on attempt 2, `authorizedPaths` from revision 1 only, `schemaName === 'source_analysis_v2_repair'`, guards, malformed output → `stage 'analysis-repair'`, `v2Stage 'analysis-v2-repair'`.
7. Findings copy only `id`, `kind`, `message`, `path`, `affected` (a check carrying an extra property does not leak it into the payload).
8. v1 untouched: `analyzeSource` (v1) with a fake client still sends `schemaName 'source_analysis'` and `maxOutputTokens 6000` (no further v1 assertions; the v1 suites cover the rest).

## README.md
Keep the existing text; add table rows for `prompts-v2.ts` (Stage 6 prompts: analysis v2, `SUBJECT_GUIDANCE`, per-component and repair prompts, `STAGE6_PROMPT_VERSION`) and `pipeline-v2.ts` (the four functions, caps 16,000/12,000, injected validators, `GeneratedOutputErrorV2`), and update the heading to mention S6-M.

## NOTES
Exported names; any deviation and why; how injected validators are typed for S6-W.
