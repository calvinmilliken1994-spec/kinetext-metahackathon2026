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

## Round 2 — Wave A2 (`docs/reviews/stage-2-re-review.md`: N-01/R-02, N-02, N-03, N-04, R-11 retry sleep)

Same route and orchestrator role. Prompt = `prompts/r2_common_rules.md` + the call's `prompts/r2_call*.instructions.md` + verbatim re-review rows (R-02, R-09, R-11, N-01…N-04) + the fix-spec Wave A and Round 2 / Wave A2 sections + the full current source of each listed file, read raw from disk (builder script kept in the profile scratch dir). Each repair prompt also re-sent the current file it repairs.

| Receipt | Purpose | Status | Elapsed s | Input / cached / output / reasoning tokens |
|---|---|---|---|---|
| `muse-A2r2-1-ledger.json` | N-01, R-02: `openLedger` with loopback-port lock; ledger.ts + ledger.test.ts | passed | 80.656 | 37759 / 0 / 29717 / 18346 |
| `muse-A2r2-1r1-ledger-test-repair.json` | Repair 1: TS18047 in a test closure; `waitExit` ignored `signalCode` (6.3 s cleanup wait) | passed | 24.187 | 33632 / 0 / 10942 / 2287 |
| `muse-A2r2-2-client.json` | N-02, N-03, N-04, R-11 sleep: client.ts + client.test.ts (tests moved to `await openLedger`) | passed | 85.797 | 45698 / 0 / 39925 / 15440 |
| `muse-A2r2-2r1-client-test-port-flake.json` | Repair 1: test `tempLedger` retries a fresh dir on `LEDGER_LOCKED` (random lock port occasionally in use) | passed | 44.875 | 46168 / 0 / 20503 / 1119 |
| `muse-A2r2-1r2-ledger-test-port-flake.json` | Repair 2: ledger tests probe that the derived port is free before relying on it | passed | 35.329 | 33983 / 0 / 13830 / 4774 |
| `muse-A2r2-2r2-client-test-lock-failed.json` | Repair 2: `tempLedger` also retries on `LEDGER_LOCK_FAILED` (`EACCES` ports) | passed | 39.281 | 46072 / 0 / 19970 / 574 |

Orchestrator mechanical edit (one): Muse's call-2 test file declared an unused no-op stub `function assertCost triple(` (syntax error TS1005); it was renamed `assertCostTriple` so the file parsed, and Muse deleted the stub in repair 1.

Port diagnosis behind the two flake repairs: an orchestrator probe listened on every 127.0.0.1 port 49152..65151 — 15 975 free, 10 `EADDRINUSE`, 15 `EACCES` (Windows services binding exclusively, e.g. 49664–49676, plus OS-excluded 50128). The default lock range lies in Windows' dynamic port range, so `openLedger` can fail closed spuriously on a path whose derived port is taken; that is safe, but the lead may want to make the port configurable in `main.ts` or move the range.

After the repairs: `tsc -p tsconfig.json` reports only the two expected errors outside `packages/meta` (`apps/api/main.ts`, `scripts/live-spike.ts` still import the removed `createLedger`; lead/Qwen will move them to `openLedger`); `npm test` 293/293 pass in 25 of 25 consecutive full-suite runs (baseline before Wave A2: 275).
