# Open-weights mode — live evidence (Muse Spark Open on Modal)

Model `meta-models/Muse-Spark-Open-816B-A42B` (Muse Spark Open), Modal Shared Endpoint `ep-MLCNvmXXXhpE1DOD6Ya2RA` (us-west), same prompts (v9), checks and repair loop as the hosted Muse Spark 1.3. Purpose `test-live`, reasoning High. Modal hackathon credit.

| Run | Job | Result | Cost | Notes |
|---|---|---|---|---|
| `modal-smoke.json` | — | strict JSON correct (19.62 m) | USD 0.0019 | endpoint smoke, 1.9 s |
| `smoke-live/` | (see results.jsonl) | **failed `AUTH_FAILED`**, USD 0, 2 s | 0 | Real bug found live: the server's token splitter did not strip a `.` separator between the key and secret halves of the stored proxy token, so Modal rejected the key. Fixed test-first in `apps/api/model-clients.ts` (keep only token characters in the key half). |
| `smoke-live-2/` | `job-20261029091120-b37f3ef2` | **published r1, 15/15 checks**, 67 s | USD 0.078051 | NASA Glenn *Newton's Laws of Motion* → `forces-1d-v1`. **Natural analysis repair:** Muse Spark Open's first analysis failed `analysis.concept-ids` (a 42-character id `newtons-second-law-force-mass-acceleration`) and `grounding.quotes` (concepts without a verbatim evidence quote); analysis repair 1 fixed both, then the lesson published first try. Receipts record `provider: modal`, `cachedUnknown: true` (Modal reports no cached-token count, so input is charged at full price). |

Hosted Muse Spark 1.3 on the same page (pre-registered evaluation, `job-20261028165718-f22b8f76`): published r1 without repair, 44 s, USD 0.046.
