# Task: raise the Stage 6 output-token caps (live truncation)

Live evidence (2026-10-29): the first live Stage 6 lesson on the NOAA educator guide `noaa-oceanexplorer-fueling-life-on-earth` (13,741 chars) failed with OUTPUT_TRUNCATED in the analysis-v2 call: completionTokens 16000, reasoningTokens 15998 — reasoning (effort High, which the project never lowers) consumed the whole 16,000 cap before any JSON was written. The project's rule is to raise output caps rather than lower reasoning effort (the v1 spec cap was raised to 32,000 for the same reason).

Change in `packages/meta/pipeline-v2.ts`:
- `ANALYSIS_V2_MAX_OUTPUT_TOKENS` 16000 -> **32000** (literal type too).
- `KIT_CALL_MAX_OUTPUT_TOKENS` 12000 -> **24000** (literal type too) — component and repair calls reason over the same page and would hit the same wall.
- Keep `resolveMaxTokens` semantics (an override above the cap still throws MAX_OUTPUT_TOKENS_INVALID before any call; overrides below the cap are allowed).
- Update any doc comments that state the old numbers.

Change in `packages/meta/pipeline-v2.test.ts`: update the assertions that pin 16000/12000 to the new values, and add one test that an override of 32001 (analysis) / 24001 (kit) throws before any client call while 32000 / 24000 are accepted.

Return ONLY the two complete files. Do not change anything else.
