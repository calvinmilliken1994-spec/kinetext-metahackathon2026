## REPAIR request (round 2, call 1, repair 1): `ledger.test.ts`

Your call-1 files were saved verbatim. `node --test packages/meta/ledger.test.ts` passes (24/24, including the N-01 two-child test), but:

1. `tsc -p tsconfig.json` (TypeScript 7, strict) fails in your test file with exactly this error:

```text
packages/meta/ledger.test.ts(719,13): error TS18047: 'reopened' is possibly 'null'.
```

(Line 719 is inside `assert.throws(() => reopened.reserve(...))` in the N-01 test: the `let reopened: Ledger | null` narrowing does not carry into the arrow function.)

2. The N-01 test takes about 6.3 s because `waitExit` only checks `child.exitCode !== null` for an already-exited child. A child terminated by `child.kill()` has `exitCode === null` and `signalCode !== null`, so the cleanup `waitExit(child, 5000)` in `finally` waits for an `'exit'` event that already fired and times out. Make `waitExit` treat a child with `exitCode !== null || signalCode !== null` as already exited.

Fix both without changing what any test asserts. Output ONLY `packages/meta/ledger.test.ts` (complete file, same format: `=== FILE: packages/meta/ledger.test.ts ===` + one ```ts block), then `=== NOTES ===`. Do not output ledger.ts.
