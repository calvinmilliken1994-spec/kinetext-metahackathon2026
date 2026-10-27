# TASK-009 Wave A evidence — `packages/meta` fixes authored by Muse Spark 1.3

Route: `scripts/muse-subscription.py --model muse-spark-1.3 --timeout-seconds 600` (Muse Code subscription, High reasoning, one model step, contributor mode off). Orchestrator: Anthropic Opus 5.5 (prompt assembly, saving returned files verbatim, running `npm run check`). All implementation and test logic in `packages/meta/*.ts` comes from the receipts' `answer` fields.

Prompt = `prompts/common_rules.md` + the call's `prompts/call*.instructions.md` + verbatim review rows (from `docs/reviews/stage-2-independent-review.md`) + the fix-spec Contract/Wave A sections (from `docs/specs/TASK-009-review-fixes.md`) + the full current source of each listed file, read raw from disk.

| Receipt | Purpose | Status | Elapsed s | Input / cached / output / reasoning tokens |
|---|---|---|---|---|
| `muse-A1-pricing-ledger.json` | R-02, R-04, R-06: pricing.ts, ledger.ts + tests | passed | 91.234 | 36796 / 36721 / 21279 / 10454 |
| `muse-A2-client.json` | R-01, R-03, R-04, R-06, R-09, R-11: client.ts + client.test.ts | passed | 138.359 | 36649 / 36593 / 29672 / 13792 |
| `muse-A2r1-client-tsc-repair.json` | Repair 1: tsc TS2367 narrowing errors (tests already 213/213) | passed | 13.437 | 31024 / 0 / 5045 / 878 |
| `muse-A3-prompts-pipeline.json` | R-13, R-11: prompts.ts, pipeline.ts + tests | passed | 30.984 | 31232 / 0 / 13236 / 5830 |
| `muse-window-prime.json` | Fixed smoke prompt to start a new usage window (see below) | completed (`MUSE_SUBSCRIPTION_OK`) | 8.563 | 17272 / 0 / 86 / 71 |

Window priming: the first call-1 attempt (2026-10-27T04:56:32Z) failed in 2.95 s with `SUBSCRIPTION_ALLOWANCE_NOT_VERIFIED` before any model turn, because `muse usage --json` returned `allowance: null, reason: server_sent_no_usage` ("can happen before your first use in a new window"; the 5-hour window had reset at 2026-10-26T23:59:52Z). That failed receipt was overwritten by the successful rerun at the same path. `muse-window-prime.json` records the one-off fixed smoke prompt run with the wrapper's own helpers (OAuth metadata check, API-key-stripped env, identical locked-down `muse exec` command, contributor mode off); afterwards the allowance was reported again and the wrapper was used for all code calls.

Final `npm run check`: `tsc -p tsconfig.json` passed; 227 tests, 227 pass, 0 fail (baseline before Wave A: 177).
