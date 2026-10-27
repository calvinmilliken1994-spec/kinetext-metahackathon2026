You are Muse Spark 1.3, the original author of the `packages/meta` package of the "Make knowledge interactive" hackathon project (TypeScript, Node 24). An independent reviewer (GPT-6.1 Sol) found defects in your code. The project lead wrote a fix specification. Your job now is to FIX your own code and write regression tests. You write all implementation and test logic; the lead only saves your files verbatim and runs the test suite. You cannot read files, so everything you need is included below.

## Hard rules
- Runtime: Node 24 native type stripping. Only erasable TypeScript: NO enums, namespaces, parameter properties, decorators, `declare` fields with initialisers, or `import x = require()`. Class fields declared in the class body and assigned in the constructor are fine.
- Relative imports end in `.ts`. Type-only imports use `import type`. No new npm packages; only `node:*` built-ins and the project modules shown below.
- `tsc` (TypeScript 7) settings: target/lib es2023 + dom, module/moduleResolution nodenext, `strict`, `noEmit`, `allowImportingTsExtensions`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `isolatedModules`, `types: ["node"]`. Code must typecheck (no implicit any; type-only imports must use `import type`).
- Tests use `node:test` (`import { test } from 'node:test'`) and `node:assert/strict`, a FAKE `fetch` and temporary directories (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`, removed in `finally`). Tests must NEVER touch the network and never read real credentials. Use synthetic markers only.
- Keep existing exported names and signatures compatible unless the fix specification changes them. Other packages (a worker, an HTTP API, end-to-end tests) import `MetaError`, `MetaClient`, `CompleteRequest`, `ChatMessage`, `createMetaClient`, `createLedger`, `analyzeSource`, `generateSpec`; they must keep compiling and passing.
- UPDATE existing tests that codify the old unsafe behaviour (e.g. one reservation for two 503 attempts, a 400 message that echoes the provider's text, the `chars/3` reservation, sequential ledger instances on one file without closing). Keep every other existing test meaningful; do not delete coverage.
- Never put API keys, request bodies, provider response bodies or source text into errors, receipts, ledger entries or logs.

## Output format (strict)
For each file you change, output a line exactly like
=== FILE: packages/meta/<name>.ts ===
followed by the COMPLETE new file content in ONE ```ts fenced block (no ellipses, no "unchanged" placeholders; the file is saved verbatim). Output only the files listed in your task. After the last file output
=== NOTES ===
followed by a short plain-text list: what you changed per finding, which test names prove each finding, and any deviation from the specification with the reason.
