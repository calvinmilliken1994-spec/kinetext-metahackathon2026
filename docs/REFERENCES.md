# Reference register

Reviewed 2026-10-27 KST. These are sources of technical information, not substitutes for official contest rules.

| Reference | Retrieval / retained finding |
|---|---|
| https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details | Login wall. Event details inaccessible; not fabricated. |
| https://dev.meta.ai/docs/models | Initial extractor failed; direct HTTP 200 text recovered. Exact Spark/SAM/Image/Voice IDs verified. Its South Korea Wonder note was later superseded by the Geographic Use Policy review in `PROFILE_ACTIVATION.md`. Copied page text is not retained in the repository. |
| https://dev.meta.ai/docs/quickstart | Direct HTTP 200 text recovered. OpenAI-compatible SDK/API and Windows Muse Code installer documented. No installation executed. |
| https://dev.meta.ai/docs/getting-started/pricing-rate-limits | Direct HTTP 200. Spark Standard USD/1M: input 1.25, cached 0.15, output 4.25. SAM USD 2.50/1000 images; video 0.20/1000 frames, minimum 50 frames. Image USD 0.01/image. Voice USD 0.18/hour. Verify again before production spend. |
| https://github.com/meta-models/meta-model-cookbook | Reviewed repository and raw API fundamentals; OpenAI SDK, MODEL_API_KEY, api.meta.ai/v1, muse-spark-1.3. |
| https://github.com/meta-models/meta-oss-cookbook | Reviewed open-model hosting guidance and raw Baseten guide; documents unsuffixed meta-models/muse-spark-open. |
| https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/equations-of-motion/ | Retrieved 2026-10-26T22:22Z; stored as `data/sources/nasa-grc-equations-of-motion` (supported demo source). |
| https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/speed-of-sound-interactive/ | Retrieved 2026-10-26T22:22Z; stored as `data/sources/nasa-grc-speed-of-sound` (unsupported-path source). |
| https://www.nasa.gov/nasa-brand-center/images-and-media/ | NASA usage guidelines incl. AI-applications conditions; summary in `data/sources/README.md`. |
| https://openstax.org/books/college-physics-2e/pages/4-3-newtons-second-law-of-motion-concept-of-a-system | **Rejected**: CC BY-NC-SA 4.0 and no LLM/generative-AI ingestion without written permission. |
| https://www.baseten.co/library/muse-spark-open | Documented unsuffixed model string; Standard pricing matches Spark above; account entitlement unknown. |
| https://hermes-agent.nousresearch.com/docs/ | Authoritative Hermes documentation; profile/config/auth syntax additionally checked against live CLI help. Guessed profile-specific docs paths returned 404; no capability claim based on those paths. |

Credits and model enablement must come from an authenticated account, not public pricing or partner marketing. Cookbook rate limits may be stale relative to live docs: current Spark Standard page lists 3000 RPM/4M TPM per team; these are published maxima, not verified account limits.
