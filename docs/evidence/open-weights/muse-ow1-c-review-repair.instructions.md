# OW-1 call C — review repair: untested branch (explicit meta-api provider config)

Context: feature wave OW-1 (open-weights mode), not a review-of-defects fix; read the "Hard rules" and "Output format" above and ignore the sentence about reviewer defects. Your files from calls A and B are saved verbatim; `npm run check` is green for every `packages/meta` test (the only failing tests in the repo are timeline date-grounding tests that another engineer is changing in `packages/validation`, unrelated to this package).

Lead review of your `client.ts` found one branch with NO test: `createMetaClient({ …, providerConfig: { provider: 'meta-api' } })`. It is a separate code path (a duplicated block after the `isPlainObject` / provider checks), so the existing `client.test.ts` and `client.open-weights.test.ts` (which only use an ABSENT providerConfig for Meta) do not prove it behaves identically.

Write ONE NEW test file `packages/meta/client.meta-api-config.test.ts` (copy the helpers you need from `client.open-weights.test.ts`; do not import from test files) that proves, for an explicit `{ provider: 'meta-api' }` config versus an absent providerConfig, with fake fetch and fake/temporary ledgers only:
1. Same URL (default base and a custom top-level `baseUrl`), the exact header key set `{ Authorization, Content-Type }` with value `Bearer <synthetic key>`, no `Modal-Key`/`Modal-Secret`, and request bodies deep-equal to the absent-config client's body.
2. Missing or empty top-level `apiKey` → `MODEL_API_KEY_MISSING` (zero fetch calls, zero reservations); `allowLive: false` → `LIVE_CALLS_DISABLED` first.
3. Receipt fields `provider: 'meta-api'`, `model: 'muse-spark-1.3'`, `providerModel: 'muse-spark-1.3'`, `requestedModel: 'muse-spark-1.3'`, and the client getters, identical to the absent-config client; ledger reservation written with `provider: 'meta-api'` and model `muse-spark-1.3`.
4. Extra Modal-only fields smuggled onto a meta-api config object (cast through `unknown`, e.g. `proxyKey`, `proxySecret`, `baseUrl`, `modelString` set to synthetic markers) are IGNORED: no Modal headers, URL still from the top-level options, markers appear nowhere in the request headers, URL, body, receipt or ledger.
5. `providerConfig` values `null`, an array, a string, `{}` and `{ provider: 'META-API' }` → `PROVIDER_CONFIG_INVALID` (skip any already proven in `client.open-weights.test.ts` only if exactly identical; duplicates are acceptable).

Do NOT change `client.ts` unless a test reveals a real bug; if it does, output the complete fixed `client.ts` too and explain in NOTES. Output:
=== FILE: packages/meta/client.meta-api-config.test.ts ===
(and `=== FILE: packages/meta/client.ts ===` only if a real bug was found), then === NOTES ===.
