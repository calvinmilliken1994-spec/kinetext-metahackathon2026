# Model routing and availability

> Current authority: `PROFILE_ACTIVATION.md`. Opus 5.5 is the orchestrator; Meta and Qwen credentials/catalogs are now verified in the dedicated profile. Wonder is an account-verification candidate, not a regional blanket prohibition. The table below is the historical initial discovery snapshot and is superseded where it conflicts.

Checked 2026-10-27 KST. Evidence: `docs/evidence/profile-activation-verified.json`, official URLs in `REFERENCES.md`.

## Engineering vs product
Engineering orchestration uses `openai-codex / gpt-6.1-sol`; profile config verified with CLI readback and `auth status` reports logged in. This conversation itself uses that route. It is **not** a runtime product fallback. Task preferences below are role definitions, not an automatic router: use explicit per-process provider/model pins after authorization. Do not claim the default delegate tool chooses a provider per task.

| Task | Primary | Secondary | State |
|---|---|---|---|
| Orchestration/architecture | OpenAI `gpt-6.1-sol` | Anthropic | Main route configured |
| Complex frontend | Anthropic | OpenAI | Local auth source present; fresh inference not tested |
| Backend | Alibaba `qwen3.8-max` | Anthropic | Default-profile credential lists exact ID; dedicated profile reports logged out; inference untested |
| Routine testing/docs | Alibaba `qwen3.8-flash` | OpenAI | Default-profile credential lists exact ID; dedicated profile reports logged out; inference untested |
| Meta SDK/tools/schemas/source/repair/integration tests | Direct Meta `muse-spark-1.3` / Muse Code | Anthropic independent review | Blocked: direct Meta key and budget |
| Document understanding/activity generation | Direct Meta `muse-spark-1.3` | Muse Spark Open explicit experiment | No invisible fallback |
| Segmentation | Direct Meta `sam-3.1` | Labeled manual annotation | Account verified 2026-10-31 (`docs/evidence/sam-3.1-check/`); not built |
| Illustration | Direct Meta `muse-image-1.0` | Licensed curated assets | Docs verified, account not verified |
| Runtime repair | Direct Meta `muse-spark-1.3` | Deterministic stop/human review | Planned |
| Final independent review | Anthropic | OpenAI | Exact Anthropic model/account validation pending |

Dedicated-profile CLI auth checks: `openai-codex: logged in`, `anthropic: logged in`, `alibaba: logged out`. The Alibaba live catalog probe used the default profile credential only; it was not copied into the new profile. No broad secret/config cloning occurred. A bounded dedicated-profile OpenAI connectivity session returned `ready` with zero tool calls, exit 0 (session `20261027_025725_a3989d`). Anthropic authentication was detected but no inference was exercised.

Anthropic cached IDs include `claude-opus-5-5` and `claude-sonnet-5`, but the local cache is explicitly marked fallback. Do not equate it to a live account catalog. OpenAI cached IDs include `gpt-6.1-sol`, `gpt-6-astra`; only current OpenAI route is demonstrated here. Alibaba `qwen3.8-max` and `qwen3.8-flash` were listed by an authenticated live `/models` request at the configured token-plan endpoint.

## Meta documented identifiers (not account entitlements)
- `muse-spark-1.3`: recommended new work; text/image/video/PDF input, text output; tools, structured output, reasoning, 1,048,576-token context. Audio quality is not fully supported in 1.3; do not choose it for voice transcription.
- `sam-3.1`: image/video + prompts → boxes/masks.
- `muse-image-1.0`: image generation and editing.
- `muse-voice-transcribe-1.0`: optional transcription, not synthesis.
- `muse-wonder-1.0`: official docs explicitly exclude South Korea. Not a dependency.
- Muse Glimmer: investigate only with a measured local/cost use case.

API auth: `MODEL_API_KEY`, bearer auth, `https://api.meta.ai/v1`; official SDK examples use OpenAI SDK with explicit key. Do not substitute consumer subscription credentials. Muse Code supports browser sign-in or API key; install/auth state has not been established (`muse` not found on PATH). Before Muse Code use, check billing mode and switch off Contributor mode unless separately approved.

## Baseten discrepancy — preserve, do not normalize
User-specified candidate: `meta-models/muse-spark-open-1026`. The current official OSS cookbook and Baseten library instead document `meta-models/muse-spark-open`, endpoint `https://inference.baseten.co/v1`, `BASETEN_API_KEY`. The exact requested `-1026` identifier has **not** been account-validated. Do not silently replace it. Ask whether to evaluate the documented alternative after account catalog discovery. No Baseten key is configured.

OpenRouter's public catalog lists `meta/muse-spark-1.3`, `meta/muse-spark-open`, and `meta/muse-glimmer-30b`; this establishes public listings only. A credits request with the local `.env` credential returned 401. Pooled credentials were not exhaustively tested. No OpenRouter runtime fallback is configured.

## Routing execution
Current profile is a single OpenAI orchestrator, not a running multi-agent team. Role ownership and later explicit CLI pins are in `AGENT_ROLES.md`. Credential discovery and a bounded actual call must succeed before promoting another route from candidate to verified. No paid tests run during setup.
