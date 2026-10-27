## Your task in THIS call (call 1 of 3): `pricing.ts` + `ledger.ts` and their tests

Files to output (all four, complete):
- packages/meta/pricing.ts
- packages/meta/pricing.test.ts
- packages/meta/ledger.ts
- packages/meta/ledger.test.ts

Do NOT output client.ts or its tests in this call (call 2 will rewrite the client to use your new pricing helpers). `client.ts` and `client.test.ts` are shown below only so you know how pricing/ledger are consumed today. After this call `client.ts` still calls `reservationUSD(model, messageChars + schemaLen, maxOutputTokens)` and the client tests compute the expected reservation the same way, so they stay consistent; they must keep compiling, so keep `reservationUSD(model: 'muse-spark-1.3', inputTokens: number, maxOutputTokens: number): number` callable with three numbers.

Findings in scope: R-02, R-04 (pricing/ledger part), R-06 (pricing part).

### Interface decisions from the lead (follow exactly)
pricing.ts
- Keep `PRICES_PER_MTOK` and the exact rates.
- New export `inputTokenBound(messages: ReadonlyArray<{ content: string }>, jsonSchema: Record<string, unknown>): number` implementing the R-06 rule: UTF-8 byte length (`Buffer.byteLength(s, 'utf8')`) of every message content + UTF-8 byte length of `JSON.stringify(jsonSchema)` + 64 per message + 256 framing. Document the assumption in a code comment exactly as the spec states it (one token per byte for byte-level BPE; NOT verified against Meta's tokenizer; not a hard guarantee). Use a structural parameter type so pricing.ts does not import client.ts.
- `reservationUSD(model, inputTokens, maxOutputTokens)`: the second parameter is now an input-TOKEN count (the caller passes `inputTokenBound(...)`), priced at the full uncached input rate, plus `maxOutputTokens` at the output rate. Remove the `ceil(chars/3)` heuristic. Throw `Error('INVALID_AMOUNT')` if either argument is not a finite non-negative number.
- `costFromUsage(model, usage)`: fail closed — throw `Error('INVALID_USAGE')` unless all four counters are finite non-negative integers, cachedTokens <= promptTokens and reasoningTokens <= completionTokens. (The client will validate first; this is defence in depth so a negative cost can never be produced.)
- Optionally export a pure `isValidUsage(usage: Usage): boolean` helper that both costFromUsage and (later) the client can use.

ledger.ts
- Keep `LedgerEntry`, `Ledger`, `createLedger(opts)` names. Add `close(): void` to the `Ledger` interface.
- `createLedger`: validate `capUSD` (finite, >= 0, else throw `Error('INVALID_AMOUNT')`) BEFORE taking the lock. Then take the exclusive lock file `<path>.lock` per R-02: create parent directory if needed, `writeFileSync(lockPath, String(process.pid), { flag: 'wx' })`. If it already exists: read the PID; if the content is not a positive integer, fail closed with `Error('LEDGER_LOCKED')`; if `process.kill(pid, 0)` succeeds (or throws with code `EPERM`, which means the process exists) throw `Error('LEDGER_LOCKED')`; if it throws `ESRCH` the owner is dead: remove the stale lock and retake it with `wx` (if that retake fails with EEXIST, throw `LEDGER_LOCKED`). Note: the current process's own PID is alive, so a second instance in the same process on the same file must also throw `LEDGER_LOCKED`.
- Then replay the file. If replay throws (`LEDGER_CORRUPT`), release the lock before rethrowing.
- `close()`: idempotent; removes the lock file only if it still contains this instance's PID; after close, `reserve`/`reconcile` throw `Error('LEDGER_CLOSED')`. Release on process exit: use ONE module-level `process.on('exit', ...)` listener and a module-level Set of held lock paths (do not add one listener per ledger, that triggers MaxListenersExceeded warnings in test files that create many ledgers).
- Replay (R-04): throw `Error('LEDGER_CORRUPT')` on any malformed line (JSON.parse failure, non-object), unknown `kind`, missing/invalid `purpose` or `model`, `amountUSD` that is not a finite non-negative number, a reserve whose id is a duplicate, or a reconcile whose `reservationId` is unknown or already reconciled. A trailing empty line is fine.
- `reserve`/`reconcile` (R-04): throw `Error('INVALID_AMOUNT')` for non-finite or negative `estUSD` / `costUSD` before writing anything.
- `reserve` (R-02 defence in depth): re-read and re-replay the file from disk immediately before the cap check, so committed totals include anything another writer appended; then check `committed + estUSD > capUSD` → `Error('BUDGET_EXCEEDED')` writing nothing.
- `committedUSD()` keeps its meaning (reconciled actuals + unreconciled reservations at their reserved amount).

### Required tests (at least)
pricing.test.ts: keep the existing rate/exact-cost tests; replace the `ceil(chars/3)` test; add: inputTokenBound for ASCII equals bytes + 64·n + 256; Unicode-heavy input (e.g. CJK, emoji, combining marks) bound >= UTF-8 byte count and > JS string length; reservation covers costFromUsage for usage whose promptTokens equals the bound; reservationUSD rejects NaN/Infinity/negative; costFromUsage throws INVALID_USAGE for negative counters, non-integers, cached > prompt, reasoning > completion (and the review's -$0.00109875 counterexample: prompt 1, completion 0, cached 1000).
ledger.test.ts: update existing sequential-instance tests to `close()` the first instance before opening the second, and close every ledger in `finally`; add: second live instance on the same file throws LEDGER_LOCKED (the review's A/B $0.60+$0.60 on a $1 cap scenario can no longer happen); stale-lock takeover (obtain a dead PID by running `spawnSync(process.execPath, ['-e', ''])` and using its `pid` after it exits, write it into `<path>.lock`, then createLedger succeeds and the lock now holds `process.pid`); close/reopen keeps totals and removes the lock file; operations after close throw LEDGER_CLOSED; reserve re-reads the file (append a valid reserve line written by "another writer" via appendFileSync while holding the instance, then a reserve that would exceed the cap only with that line counted throws BUDGET_EXCEEDED); corrupt ledger line, truncated last line, unknown kind, negative amount, NaN amount via a raw line like `"amountUSD":null`, reconcile of unknown id → LEDGER_CORRUPT and the lock file is released afterwards; invalid capUSD (NaN, -1, Infinity) → INVALID_AMOUNT; reserve/reconcile with NaN/negative/Infinity → INVALID_AMOUNT and nothing written.
