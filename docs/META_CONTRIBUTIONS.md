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
| Architecture/contract design review (2026-10-27, engineering) | `muse-spark-1.3` via Muse Code subscription, Standard (contributor off), High | ARCHITECTURE.md v0.2 + VERTICAL_SLICE_PLAN.md (public project docs) | 10 numbered findings | none (1 model step) | Yes for engineering: 7 findings adopted into the v0.2 contracts (gen/full schema split, tolerance rule, quote normalisation, analysis invariants, typed events, text-only display strings, quote prompting); 1 rejected as a misread | 15.2 s; 20,383 input / 2,648 output (1,829 reasoning) / 0 cached tokens; subscription usage, no PAYG charge; window/weekly display 0% | Opus reviewed each finding against the docs; adopted list in `ARCHITECTURE.md` § "Muse design review incorporated"; receipt `docs/evidence/muse-architecture-review.json` | Engineering contribution, not runtime |
| Direct API smoke (2026-10-27, participant credits) | requested and returned `muse-spark-1.3`, reasoning_effort high | fixed text prompt "Reply with the single word: ready" | `ready`, finish_reason stop | none | No, setup only | 3,133 ms; 15 prompt / 39 completion (29 reasoning) / 0 cached tokens; est. USD 0.0001845 | exact output, exact model, usage present; response `chatcmpl-01a17a12-beb0-7197-9279-ff40a8217fd2`; receipt `docs/evidence/meta-api-spark-smoke.json` | Connectivity only |
| Direct API smoke preparation | requested `muse-spark-1.3`; not invoked | fixed text prompt; not sent | local blocked result | no network/tool calls | No, setup only | No inference executed; no billed inference from this attempt | `MODEL_API_KEY_MISSING`, exit 2 | Connectivity only; not a product demonstration |

## Required per major feature/run
Feature; provider; exact requested and returned model/version; selection rationale; input modality; output artifact/revision/hash; tool call names/arguments redacted/results; essential-to-product boolean; start/end and wall time; input/output/cached/reasoning tokens or segmented frames/images/audio seconds; estimated incremental USD and price source/date; actual receipt ID; validation commands/results; independent reviewer; demo relevance; engineering author model and event-origin classification.

Use `unknown` for missing measurements, not guessed values. Keep metadata and sanitized receipts; do not publish credentials, private source text, hidden reasoning, or raw user files. Logs remain ignored until scrubbed for inclusion. On successful smoke, logs/meta-smoke-*.json contains a real receipt; transfer sanitized summary here after review. Runtime features must record essential=true only when the actual Meta call affects behavior.
