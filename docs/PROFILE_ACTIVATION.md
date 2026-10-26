# Current profile activation — supersedes initial routing/readiness

## User decision
Anthropic Opus 5.5 (`anthropic / claude-opus-5-5`) is the orchestrator. Delegate task-specific work across existing plans. Meta must remain the primary product intelligence layer and a substantial engineering contributor. This supersedes the original addendum’s OpenAI lead assignment; the original addendum remains preserved verbatim.

## Verified configuration
- Workspace: `C:/projects/meta-hackathon`.
- Target profile: `meta-hackathon-2026`.
- Target-profile Project: Meta Hackathon, slug `meta-hackathon`, ID `p_0193ebd3`.
- Opus 5.5 default was read back and an actual response returned `ready`, exit 0, no tools, session `20261027_031730_bdd56b`.
- OpenAI Codex remains available for independent review/specialist tasks; previously verified real response.
- Qwen `qwen3.8-max` and `qwen3.8-flash` were listed by the dedicated profile’s authenticated catalog (HTTP 200). Alibaba and Alibaba token-plan auth report logged in. No Qwen inference performed in this change.
- Model aliases configured and read back: `orchestrator`, `openai-review`, `qwen-backend`, `qwen-routine`, `meta-generation`, `meta-repair`, `meta-wonder-candidate`.
- API keys/settings were retained or narrowly copied without exposing values. Bot tokens and unrelated service credentials were not copied; OAuth refresh grants were not cloned.
- No implicit provider fallback was configured. Task-specific routing is explicit, not a capability magically supplied by alias names or the default delegate tool.

## Meta account activation
The dedicated profile now has a real `MODEL_API_KEY`. Authenticated `GET https://api.meta.ai/v1/models` returned HTTP 200 with:

- `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.1`
- `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`
- `sam-3.1`
- `muse-image-1.0`
- `muse-voice-transcribe-1.0`

These are account catalog listings, not claims that generation/segmentation/transcription succeeded. Standard Spark 1.3 remains the default. Contributor mode requires separate privacy approval. SAM/Image/Voice are product API models, not general-purpose chat orchestrators. The built-in Hermes provider is `meta-ai` (aliases include meta/muse); it supports Meta coding-agent use through the Responses API. No Muse CLI installation is necessary for that route.

The prior missing-key blocker is resolved. Positive metered spend and account credit balances remain unverified; no paid Meta completion was sent during activation. The prepared smoke must receive the profile secret securely through process environment when authorized; the standalone npm command does not automatically load Hermes profile secrets.

## Muse Wonder correction
The controlling geographic policy was retrieved directly: https://dev.meta.ai/legal/geographic-use-policy (last updated October 12, 2026). Section 2.2 lists only Muse Image in India as a model-specific restriction; Section 3 does not list South Korea as a restricted territory. Therefore this policy contains no express South Korea prohibition on Muse Wonder or Muse Wonder Full. The earlier blanket project claim that Wonder is unavailable in South Korea was not supported by this policy and is withdrawn. Section 2.1 separately says access must actually be enabled by Meta; informational availability pages are nonbinding and may not reflect real-time availability. Treat account enablement as a separate technical check, not a geographic-policy conclusion. Do not circumvent access controls.

Section 1 also states that Coding Harness Subscriptions default to Contributor Services regardless of selected model. To use Standard Services through such a subscription, explicitly change the applicable account setting; choosing a non-Contributor model ID alone is insufficient. Verify this setting before sending private source material.

However, this account key currently does not list `muse-wonder-1.0`, and exact `GET /v1/models/muse-wonder-1.0` returned HTTP 404. `meta-wonder-candidate` is a selectable candidate alias, not proof it is active. A different key, entitlement, endpoint or account-visible exact ID must be verified if intended. Do not infer universal Korean unavailability from this result, and do not claim an alias activates an unavailable model.

## Role routing
**Current reasoning policy: High everywhere a reasoning setting exists.** Agent default, delegation override, all auxiliary reasoning slots, direct Meta smoke and Muse CLI bridge are set to High. Explicit launches must use `--reasoning high` (Muse: `--reasoning-effort high`). Non-reasoning segmentation/image/transcription endpoints do not acquire an invented reasoning parameter. Earlier smoke receipts remain historical and were not rerun/relabelled at High.

Routine tests now use Alibaba `deepseek-v4.1-flash-1017` (exact ID present in authenticated live catalog). Complex frontend now uses Anthropic `claude-sonnet-5-5` (actual High-reasoning connectivity succeeded: SONNET_55_HIGH_READY, session `20261027_045158_da5f6c`). Aliases: `routine-tests`, `complex-frontend`, `qwen-docs`; obsolete `qwen-routine` removed.
| Role | Primary route |
|---|---|
| Orchestration / architecture / contract ownership | Anthropic Opus 5.5 |
| Meta SDK, prompts/tools, source understanding, activity specs and repair | Meta Muse Spark 1.3; Wonder if account-enabled |
| Deterministic backend / physics engine | Qwen Max |
| Routine tests | DeepSeek v4.1 Flash 1017 |
| Documentation | Qwen Flash |
| Complex frontend | Anthropic Sonnet 5.5 |
| Independent review | OpenAI when reviewing Opus-authored code; Anthropic/OpenAI for Meta-authored code |

Retain the interface/ownership gate before parallel implementation. Use explicit pinned subprocess routes; the available delegate tool does not provide a per-task provider/model field. No unattended multi-agent dispatcher has been installed.

## Project and session handoff
The target-profile Project is registered against the same existing physical folder; no source files moved. The source chat `default/20261027_024057_ff43c6` is live. Do not rewrite or delete its ownership rows underneath an active writer. A redacted transcript backup and Opus continuation in the target profile preserve continuity without falsely claiming a live in-place profile transfer. Exact handoff outcome is recorded in the final response and target session title.

## Muse CLI subscription route (verified separately from API key)
The logged-in Muse CLI reports `Muse Code High Usage`, OAuth login and an active subscription. A bounded CLI delegation route is installed at `scripts/muse-subscription.py`, documented by the dedicated profile’s `muse-subscription` skill. It removes environment API-key overrides and leaves authentication inside Muse; no OAuth credentials are copied. This is CLI delegation through Hermes terminal, not a new native inference provider/picker entry. Opus remains the orchestrator.

Actual tests: Spark 1.3 returned `MUSE_SUBSCRIPTION_OK` with one completed subscription call. Wonder 1.0 returned HTTP 404 in both Standard and Contributor modes. A separate real Opus-led Hermes session invoked the bridge for Wonder and confirmed the same failure (session `20261027_041635_c2ddeb`; receipt `docs/evidence/muse-subscription-wonder-hermes-smoke.json`). No fallback was used. No project/private context was sent; Contributor mode was used only for a fixed harmless diagnostic marker. The user’s saved CLI preference remains unchanged. Standard mode is the bridge default.

See `docs/MUSE_SUBSCRIPTION.md` for limits and usage. This resolves subscription routing, not Wonder entitlement.

## Remaining gates
> **Update 2026-10-27 (routing):** building is subscription-only. Removed `meta-generation`/`meta-repair` aliases (they billed participant credits via `meta-ai`). `qwen-backend`, `routine-tests`, `qwen-docs` now use provider `alibaba-token-plan` with `key_env: ALIBABA_TOKEN_PLAN_API_KEY` (that variable held an invalid non-key value until 2026-10-27, when Calvin approved copying the working Token Plan key into it; `DASHSCOPE_API_KEY` holds the same Token Plan key). All six building routes answered live; see `docs/evidence/building-routes-subscription-check.json`. Config backup in the profile `backups/`.
>
> **Update 2026-10-27:** official participant guide recovered (`HACKATHON_RULES.md`); Meta credits confirmed (USD 150) and the direct API smoke passed; master prompt preserved at `docs/MASTER_PROMPT.md`. Muse Wonder is excluded by the latest user directive (supersedes "permitted" wording above). Remaining: user confirmation before product implementation; Baseten enablement (Stage 7 only).

Official participant FAQ/master instructions, verified credits and approved metered budget, exact Wonder/Baseten enablement, and user confirmation before product implementation. No product agents/build/deployment launched. Original setup provenance remains OpenAI-authored; Opus is the new lead from this user decision onward.
