## REPAIR request (round 2, call 2, repair 2): `client.test.ts` — also retry on `LEDGER_LOCK_FAILED`

Your repair-1 `tempLedger` (retry with a fresh temp dir on `LEDGER_LOCKED`) was saved verbatim. In a 20-run stress loop of the full suite (`npm test`, 293 tests), 17 runs passed and 3 failed, each with a single client test failing like this:

```text
test at packages\meta\client.test.ts:930:1
✖ R-03: 503 then 200 success includes both charges (3.8509ms)
  Error: LEDGER_LOCK_FAILED
      at Server.onError (file:///C:/projects/meta-hackathon/packages/meta/ledger.ts:172:22)
```

(The other two: `N-03/N-04: post-reservation failures carry consistent cost metadata` and `R-11: abort during retry sleep gives DEADLINE_EXCEEDED with one fetch`, same error.)

Cause (diagnosed by the orchestrator with a probe that listened on every port 49152..65151 of 127.0.0.1): 15 975 ports were free, 10 gave `EADDRINUSE` and 15 gave `EACCES` (e.g. 49664–49676, 50128: Windows services that bind ports exclusively, and an OS-excluded port). `openLedger` correctly maps `EACCES` to `LEDGER_LOCK_FAILED` (fail closed). The test helper only retried on `LEDGER_LOCKED`.

Fix (test file only): in `tempLedger`, treat both `LEDGER_LOCKED` and `LEDGER_LOCK_FAILED` as "this random port is unusable, retry with a new temp dir" (same bound of 10 attempts; any other error is rethrown immediately). Change nothing else.

Output ONLY `packages/meta/client.test.ts` (complete file, same format: `=== FILE: packages/meta/client.test.ts ===` + one ```ts block), then `=== NOTES ===`.
