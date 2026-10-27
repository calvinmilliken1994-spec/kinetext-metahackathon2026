# Round 3 — fix F-01 in packages/meta/pipeline.ts (TASK-009, final review)

You (Muse Spark 1.3) authored packages/meta. The final independent review (OpenAI gpt-6-astra) found F-01:

| **F-01** still leaves a logically completed null-analysis job persisted as running, and the correctly conservative owner check will not recover it while that process lives. PID reuse, fsync/power-loss durability and persistence failures remain limitations. |

## Your scope: packages/meta/pipeline.ts and packages/meta/pipeline.test.ts only
The worker (workers/generation/jobs.ts) is fixed separately by another engineer against the contract below, so implement the contract EXACTLY.

### Contract
```ts
export class GeneratedOutputError extends Error {
  readonly code: 'OUTPUT_INVALID';
  readonly stage: 'analyze' | 'specify';
  readonly receipt: MetaReceipt;   // the receipt of the completed (and already ledger-reconciled) call
  constructor(stage: 'analyze' | 'specify', receipt: MetaReceipt)
}
```
- `message` is the fixed public sentence 'The model returned output that does not match the required structure.' and must never contain model output, schema error text or source text. `name` = 'GeneratedOutputError'. Fields declared and assigned in the constructor (no parameter properties).
- `analyzeSource`: after `client.complete`, validate `result.data` against `sourceAnalysisGenSchema` with Ajv (`import { Ajv } from 'ajv'; import type { AnySchemaObject, ValidateFunction } from 'ajv';` — `new Ajv({ allErrors: true, strict: false })`, compile once at module load). If the data is not a plain object or fails the schema → throw `new GeneratedOutputError('analyze', result.receipt)`. Only then call `validateAnalysis`. Never dereference fields of unvalidated data.
- `generateSpec`: validate `result.data` against `activitySpecGenSchema` the same way; failure → `GeneratedOutputError('specify', result.receipt)`. Wrap `assembleSpec(...)` so ANY exception from it also becomes `GeneratedOutputError('specify', result.receipt)` (do not leak the original message). `validateSpec` failures are NOT errors (the report says publishable=false, as today).
- `MetaError` from the client still propagates unchanged. Signatures, defaults (6000/8000), signal forwarding and return shapes are unchanged.

### Required tests (pipeline.test.ts, add; keep all existing tests passing)
- analysis data `null`, `42`, `[]`, `{}` and an object missing `supported` → GeneratedOutputError with code OUTPUT_INVALID, stage 'analyze', `receipt` strictly equal to the fake client's receipt, fixed message; the message/JSON.stringify(err) contain none of a synthetic marker string placed in the model output.
- spec data `null`, `{}`, `{ simulation: null }`, and a valid recorded spec with one required field removed → GeneratedOutputError stage 'specify' with the receipt.
- a schema-valid spec whose assembleSpec would throw (simulate by stubbing is not possible — instead assert that a schema-valid recorded spec still returns normally, and that the wrapper exists by testing the error class directly: `new GeneratedOutputError('specify', r)` has code/stage/receipt/name/message and `instanceof Error`).
- valid recorded analysis/spec still succeed unchanged (existing tests).
