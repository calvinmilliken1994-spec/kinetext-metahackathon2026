# S6-M call 4 — review-repair: tests for untested pipeline-v2 branches

Your call-3 files are saved verbatim and accepted: all 18 new tests pass, `tsc` is clean, v1 `pipeline.ts`/`prompts.ts` are byte-identical. The lead read `pipeline-v2.ts` and found branches no test exercises. Do NOT change `pipeline-v2.ts` or the existing test files. Return ONE NEW, self-contained test file (its own fake client, fixture loaders and helpers; copy what you need from `pipeline-v2.test.ts`), with this exact header and SIX-backtick fences (six backticks + `ts` to open, six backticks to close):

=== FILE: packages/meta/pipeline-v2.branches.test.ts ===

then `=== NOTES ===` (list each test name and the `pipeline-v2.ts` line(s) it covers; if a test reveals a real defect in `pipeline-v2.ts`, do not hide it — write the test for the specified behaviour and report the defect in NOTES).

Common rules hold (erasable TS, `import type`, node:test + node:assert/strict, no network). Assert error codes with regexes on the plain `Error` message, and for model-output errors assert `instanceof GeneratedOutputErrorV2`, `instanceof GeneratedOutputError`, `code`, `stage`, `v2Stage`, `receipt` deep-equal the fake receipt, and the exact number of requests made.

## Branches to cover (one or more tests each)
1. `analyzeSourceV2`: an injected `validate` that throws AFTER a schema-valid output → `GeneratedOutputErrorV2` (`v2Stage 'analyze-v2'`, `stage 'analyze'`), receipt kept, 1 request.
2. `generateKitComponent`: same for `validate` throwing (`'component'` / `'specify'`).
3. `repairAnalysisV2`:
   a. `validate` throws on the CANDIDATE only (succeeds on the revision-1 baseline) → `'analysis-v2-repair'` / `'analysis-repair'`, receipt kept, 1 request;
   b. `validate` returns `{ artifactId, revision, publishable }` WITHOUT a `checks` array for the candidate → same error;
   c. `compare` throws → same error;
   d. failing `compare` check is appended LAST and makes `publishable` false; passing one keeps `publishable` true and is last;
   e. `validate` throws on the baseline → `authorizedPaths` is `[]` in both the result and the request payload, and the model is still called once;
   f. baseline report whose `checks` is not an array (e.g. `'nope'`) → `authorizedPaths` `[]`;
   g. `signal` is forwarded (strictEqual) and absent (`'signal' in req === false`) without one.
4. `repairKitComponent`:
   a. `validate` returns no `checks` array for the candidate → `'component-repair'` / `'repair'` error with receipt;
   b. `compare` throws → same error;
   c. `COMPONENT_MISMATCH` when `previous.gen` and the plan entry are quiz but `previous.baseline.gen` is the sequence golden (attempt 2) → 0 requests;
   d. guard order and codes with 0 requests: `ANALYSIS_DECLINED` (declined analysis golden), `KIT_COMPONENT_REQUIRED` (`forces-1d-v1` plan entry present in the analysis), `PLAN_ENTRY_NOT_IN_ANALYSIS`, `MAX_OUTPUT_TOKENS_INVALID` (12001);
   e. `signal` forwarded and absent without one;
   f. a validator report on the baseline that lists the same affected path twice (and an empty-string path) yields it once (first-seen order) and no empty path.
5. `findingsFromReport` behaviour through the payload: passing checks are not sent as findings; a failing check without `path`/`affected` is sent as `{ id, kind, message }` exactly (no `path`/`affected` keys).
6. `GeneratedOutputErrorV2` directly: for each of the four stages, `new GeneratedOutputErrorV2(s, receipt)` has `name === 'GeneratedOutputError'`, the fixed v1 message, `code 'OUTPUT_INVALID'`, the mapped v1 `stage`, `v2Stage === s`, and the same receipt object.
