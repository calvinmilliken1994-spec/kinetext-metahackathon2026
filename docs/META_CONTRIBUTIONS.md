# Meta contributions ledger

**No Muse-authored product code exists yet.** Initial setup was OpenAI-authored. Subsequently a real Muse Spark 1.3 subscription connectivity call completed; this establishes access, not a meaningful product contribution.

## Muse subscription activation
- Route: Hermes → installed Muse CLI → logged-in OAuth subscription (`Muse Code High Usage`), not the project PAYG credential. Standard mode by default; no private source context.
- Spark diagnostic: exact `muse-spark-1.3`, fixed text marker prompt → `MUSE_SUBSCRIPTION_OK`; one completed call, no model tool calls, 4.719 s; input 17,263, output 29, reasoning 14, cached 0 tokens. Incremental USD charge unknown/not inferred from API pricing because this is subscription usage. Receipt: `docs/evidence/muse-subscription-spark-smoke.json`. Essential to product: no; demo relevance: connectivity only.
- Wonder requested exact `muse-wonder-1.0`: HTTP 404 in Standard and Contributor diagnostic modes. Real Opus-led Hermes invocation repeated the Standard test once, 4.453 s, 1 failed call/0 completed, no answer, no fallback. Receipt: `docs/evidence/muse-subscription-wonder-hermes-smoke.json`; request ID `f5525e8f-e2bc-49b4-bf57-7c4fda51fd79`. No output tokens reported; do not invent token/cost measurements. Essential to product: no. Contributor test contained only a harmless diagnostic marker.
- CLI allowance displayed 0% window/weekly usage; rounded display is not proof of zero cost or zero consumed allowance.

A blocked smoke attempt is not a meaningful Meta product contribution.

## Actual attempts
| Feature | Model / version | Input | Output | Tools | Essential | Time / usage / cost | Validation | Demo relevance |
|---|---|---|---|---|---|---|---|---|
| Direct API smoke preparation | requested `muse-spark-1.3`; not invoked | fixed text prompt; not sent | local blocked result | no network/tool calls | No, setup only | No inference executed; no billed inference from this attempt | `MODEL_API_KEY_MISSING`, exit 2 | Connectivity only; not a product demonstration |

## Required per major feature/run
Feature; provider; exact requested and returned model/version; selection rationale; input modality; output artifact/revision/hash; tool call names/arguments redacted/results; essential-to-product boolean; start/end and wall time; input/output/cached/reasoning tokens or segmented frames/images/audio seconds; estimated incremental USD and price source/date; actual receipt ID; validation commands/results; independent reviewer; demo relevance; engineering author model and event-origin classification.

Use `unknown` for missing measurements, not guessed values. Keep metadata and sanitized receipts; do not publish credentials, private source text, hidden reasoning, or raw user files. Logs remain ignored until scrubbed for inclusion. On successful smoke, logs/meta-smoke-*.json contains a real receipt; transfer sanitized summary here after review. Runtime features must record essential=true only when the actual Meta call affects behavior.
