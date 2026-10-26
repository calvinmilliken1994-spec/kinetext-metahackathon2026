# Muse subscription routing through Hermes

The dedicated `meta-hackathon-2026` profile has a `muse-subscription` skill pointing to `scripts/muse-subscription.py`. Opus 5.5 stays the orchestrator and delegates bounded text-in/text-out tasks through the installed Muse CLI. **This is not a new native inference-provider/picker entry**, and it does not convert a Muse subscription into application API access.

## Commands
Current project policy fixes the bridge to **High reasoning**, including smoke tests. Older recorded receipts were generated before this policy and are not evidence of a High-reasoning run.
Run from C:/projects/meta-hackathon:
```
python scripts/muse-subscription.py --model muse-wonder-1.0
python scripts/muse-subscription.py --model muse-spark-1.3 --prompt-file <task-file>
python -m unittest discover -s tests -p test_muse_subscription.py -v
```

The first is a fixed smoke prompt. The second is an explicit separate model/task, never an automatic fallback. Filesystem/shell/web/reminder tools and foreign personal context are disabled; the CLI runs in an empty isolated scratch workspace with one model step and a 90-second wrapper deadline. This route cannot autonomously edit the repository. Use returned source/specification/code with approved Hermes editing and validation tools. The CLI’s internal retry/token behavior is not overridden by unverified settings; do not mistake a model-step cap for a hard per-token budget.

Authentication stays in Muse. API-key/base-URL environment overrides are stripped; OAuth login metadata and subscription allowance are checked before running. No OAuth token or minted key is exported into Hermes credentials/config. The installer’s active version marker resolves the executable even when Muse is absent from bash PATH. Current CLI version: 1.4.13-R6996.1.

Standard mode is enforced per run (`--contributor-mode off`) without changing saved account settings. Existing saved CLI Contributor mode was on; it was tested only with a harmless fixed prompt. Prompt-file tasks cannot enable Contributor mode through this bridge. No project source was sent during smoke tests.

## Actual results
| Test | Outcome | Evidence |
|---|---|---|
| Muse usage | Logged-in Muse Code High Usage subscription | CLI usage + OAuth/subscription metadata |
| Wonder 1.0, Standard | HTTP 404; no answer | Direct CLI test and real Hermes→CLI test |
| Wonder 1.0, Contributor | HTTP 404; no answer | Separate harmless diagnostic; no fallback |
| Spark 1.3, Standard | MUSE_SUBSCRIPTION_OK; exact model reported in usage | docs/evidence/muse-subscription-spark-smoke.json |

Actual Wonder error: `model muse-wonder-1.0 does not exist or you lack access`. Real Hermes route test session: `20261027_041635_c2ddeb`; exact receipt is `docs/evidence/muse-subscription-wonder-hermes-smoke.json`. This is an account/endpoint/model availability failure, not a South Korea policy conclusion. No model/credential substitution was used to manufacture success.

Spark usage: 17,263 input tokens, 29 output tokens including 14 reasoning tokens, zero cached tokens, one completed call. The sizable input includes Muse’s own harness context. Do not apply PAYG prices or claim zero subscription consumption based on a rounded 0% allowance display.

No product implementation or deployment was started. Wonder requires account-side clarification/enablement before it can be marked active.
