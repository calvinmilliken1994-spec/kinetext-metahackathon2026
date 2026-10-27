# TASK-014 evidence — engine-aware Meta pipeline and agentic repair

Author of all code in `packages/meta/prompts.ts`, `prompts.test.ts`, `pipeline.ts`, `pipeline.test.ts`: **Muse Spark 1.3** (`muse-spark-1.3`) via the Muse Code subscription bridge (`scripts/muse-subscription.py`, contributor mode off, no API-key fallback). The orchestrator (Opus 5.5) built prompts from raw repository files, saved the returned `=== FILE:` blocks verbatim and ran `npm run check`; it wrote no implementation or test logic. Each file on disk is byte-identical to its block in the latest receipt that returned it (checked by script).

| Receipt | Prompt | Purpose | Status | Elapsed s | Input | Cached | Output | Reasoning |
|---|---|---|---|---|---|---|---|---|
| `call1-prompts.json` | `call1-prompt.md` | prompts.ts + prompts.test.ts (engine list, engine-specific spec prompt, `buildRepairMessages`, PROMPT_VERSION v3) | passed | 56.3 | 41,376 | 0 | 21,783 | 14,275 |
| `call2-pipeline.json` | `call2-prompt.md` | pipeline.ts + pipeline.test.ts (`genSchemaFor`, `initialProvenance`, `repairSpec`, stage `repair`) | passed | 63.4 | 61,113 | 0 | 25,631 | 14,874 |
| `call2-repair1.json` | `call2-repair1-prompt.md` | lead review fixes: R1 no model call when the engine is missing; R2/R3 test gaps | passed | 38.1 | 67,480 | 0 | 17,666 | 6,001 |

Cost: subscription allowance (no Meta Model API credits used). Monetary cost per call unknown.

Lead decision in repair 1 (R1): `generateSpec` with `analysis.activity` `'none'` or a non-engine throws a plain `Error('ENGINE_REQUIRED')` **before** any model call, matching `repairSpec`. Call 2 had made a model request only to obtain a receipt for `GeneratedOutputError('specify')`, which would spend credits on a caller bug. `GeneratedOutputError('specify'|'repair', receipt)` still covers schema-invalid output after a real call.

Known breakage outside `packages/meta` (not edited, owned elsewhere): `apps/api/output-invalid.test.ts` reservation constants depend on prompt size. With PROMPT_VERSION v3 the ledger commits `ANALYSIS_RESERVATION = 0.0348575` (was 0.0328425) and `BOTH_RESERVATIONS = 0.08174875` (was 0.0789675). Four tests fail until the lead updates those constants.
