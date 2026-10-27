## REPAIR request (round 2, call 2, repair 1): flaky `client.test.ts` — lock-port collisions

Your call-2 files were saved verbatim, with one mechanical orchestrator edit: the no-op stub `function assertCost triple(` (a syntax error, TS1005) was renamed to `function assertCostTriple(`; nothing else was changed. `tsc` now passes for all of `packages/meta`, and `node --test packages/meta/client.test.ts` passes 43/43. The full repository suite (`npm test`, 293 tests, test files run in parallel processes) passed in most runs, but failed intermittently, e.g. run 8 of 15:

```text
test at packages\meta\client.test.ts:428:1
✖ timeout gives TIMEOUT and ledger at reservation (3.5155ms)
  Error: LEDGER_LOCKED
      at Server.onError (file:///C:/projects/meta-hackathon/packages/meta/ledger.ts:170:22)
      at Object.onceWrapper (node:events:623:26)
      at Server.emit (node:events:508:28)
      at emitErrorNT (node:net:1984:8)
      at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
```

and in another run `N-03: malformed 200 envelopes give SERVER_ERROR at reservation` and `N-03/N-04: post-reservation failures carry consistent cost metadata` failed (both open many ledgers in a loop).

Cause (diagnosed by the orchestrator): `tempLedger()` opens each ledger on `defaultLockPort(<random temp path>)`, a pseudo-random port in 49152..65151. That is inside Windows' dynamic (ephemeral) port range 49152..65535; on this machine `netstat` shows about 500 distinct ports of that range in use by other sockets at any moment, so a random lock port is occasionally already taken and `openLedger` correctly fails closed with `LEDGER_LOCKED`. The ledger behaviour is right (fail closed); the client tests are wrong to assume a random port is always free. Client tests do not test locking.

Fix (test file only): make `tempLedger(capUSD)` robust — if `openLedger` rejects with `LEDGER_LOCKED`, remove that temp dir and retry with a NEW temp dir (bounded, e.g. up to 10 attempts; after that rethrow). Any other error is rethrown immediately. Every place in client.test.ts that opens a ledger must go through this helper (or an equivalent bounded fresh-dir retry); do not reopen one path after a collision. Do not change any assertion, and do not change `client.ts`. You may also delete the unused `assertCostTriple` no-op stub.

Output ONLY `packages/meta/client.test.ts` (complete file, same format: `=== FILE: packages/meta/client.test.ts ===` + one ```ts block), then `=== NOTES ===`.
