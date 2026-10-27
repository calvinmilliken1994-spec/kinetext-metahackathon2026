## REPAIR request (call 2, repair 1): `client.ts` fails the TypeScript check

Your call-2 files were saved verbatim. `npm test` passes (213/213 tests, including all your new client tests), but `tsc -p tsconfig.json` (TypeScript 7, strict) fails with exactly these errors:

```text
packages/meta/client.ts(298,11): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
packages/meta/client.ts(340,13): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
packages/meta/client.ts(354,15): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
packages/meta/client.ts(361,13): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
packages/meta/client.ts(442,13): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
packages/meta/client.ts(448,11): error TS2367: This comparison appears to be unintentional because the types 'false | undefined' and 'true' have no overlap.
```

Cause: control-flow narrowing. After the early `if (req.signal?.aborted === true) throw ...` check, TypeScript narrows `req.signal.aborted` to `false` for the rest of the function and does not know that `await` can change it. Fix it without changing behaviour, e.g. read the flag through a small helper function such as `function jobAborted(signal: AbortSignal | undefined): boolean { return signal !== undefined && signal.aborted; }` (a function call result is not narrowed), and use it at every check.

Output ONLY `packages/meta/client.ts` (complete file, same format: `=== FILE: packages/meta/client.ts ===` + one ```ts block), then `=== NOTES ===`. Do not change client.test.ts or any behaviour; the existing tests must keep passing.
