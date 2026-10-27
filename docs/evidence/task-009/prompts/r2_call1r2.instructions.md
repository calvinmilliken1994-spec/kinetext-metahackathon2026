## REPAIR request (round 2, call 1, repair 2): `ledger.test.ts` — lock-port collisions make tests flaky

Your call-1 files (and repair 1) were saved verbatim. `tsc` passes and `node --test packages/meta/ledger.test.ts` passes 24/24 (three consecutive runs). However, the full repository suite (`npm test`, test files run in parallel processes) is intermittently failing in the client tests with `Error: LEDGER_LOCKED` thrown from `openLedger` on a fresh random temp path:

```text
test at packages\meta\client.test.ts:428:1
✖ timeout gives TIMEOUT and ledger at reservation (3.5155ms)
  Error: LEDGER_LOCKED
      at Server.onError (file:///C:/projects/meta-hackathon/packages/meta/ledger.ts:170:22)
```

Cause (diagnosed by the orchestrator): `defaultLockPort(<random temp path>)` is a pseudo-random port in 49152..65151, which lies inside Windows' dynamic (ephemeral) port range 49152..65535. On this machine `netstat` shows about 500 distinct ports of that range in use by other sockets at any moment, so a random lock port is occasionally already taken and `openLedger` correctly fails closed. `ledger.ts` behaviour is right and stays unchanged; tests must not assume a random port is free. The same latent flake exists in `ledger.test.ts`: every test that opens a fresh path on its default port — including the `LEDGER_CORRUPT` tests (the lock is taken before replay, so a taken port gives `LEDGER_LOCKED` instead of `LEDGER_CORRUPT`, and the post-failure probe `listenOn` would also fail), the explicit-`lockPort` tests, the foreign-server test, the invalid-capUSD test and both child-process tests.

Fix (test file only): add a helper (e.g. `async function freshLedgerPath(prefix): Promise<{ dir, ledgerPath, port }>`) that creates a new temp dir, computes `defaultLockPort(ledgerPath)`, checks the port is free right now by listening a probe server on 127.0.0.1 at that port and closing it, and on `EADDRINUSE` removes the dir and retries with a NEW temp dir (bounded, e.g. 10 attempts, then throw). Use it for every test whose correctness depends on the default (or a chosen explicit) port being free at the start, including the child-process tests (probe in the parent before spawning) — the remaining window between probe and open is milliseconds; mention it in NOTES. Keep `ledger.ts` unchanged and keep every assertion (only how paths/ports are chosen changes). The `defaultLockPort` formula test needs no probing.

Output ONLY `packages/meta/ledger.test.ts` (complete file, same format: `=== FILE: packages/meta/ledger.test.ts ===` + one ```ts block), then `=== NOTES ===`.
