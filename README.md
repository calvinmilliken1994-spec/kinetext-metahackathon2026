# Make knowledge interactive.

Product name provisional. Meta-first educational source → validated interactive learning artifact.

## Status
Setup scaffold only. No web application, runtime agent pipeline, sandbox, or publishing service is implemented yet. Local contracts and a direct Meta API smoke probe are prepared. Meta credentials and its authenticated catalog are now verified; metered inference still requires spending approval. See `docs/PROFILE_ACTIVATION.md`.

## Workspace and profile
- Workspace: `C:/projects/meta-hackathon` (existing user folder).
- Profile: `meta-hackathon-2026`.
- Run from this directory: `hermes -p meta-hackathon-2026 chat`.
- Main engineering orchestrator: `anthropic / claude-opus-5-5`; runtime intelligence: direct Meta `muse-spark-1.3`, not OpenAI.

## Verify setup
Node >=22; checked with Node 24.14.1.
```
npm ci --ignore-scripts
npm test
npm run smoke:meta
```
The smoke exits **2** with `MODEL_API_KEY_MISSING` before network when no key exists. This is a blocker, not a successful API integration. Put a genuine direct Meta key in ignored `.env.local` and obtain an explicit spending limit before enabling the probe. The probe uses native Node fetch against the officially documented OpenAI-compatible endpoint; the production SDK adapter remains a Muse-authored implementation task. It checks `/models`, sends one bounded request, and emits a sanitized receipt only after actual success. Zero automatic retries; 30-second shared deadline; no fallback.

The contract test fixture is human-authored setup data, **not Meta-generated output**. A schema pass establishes structural validity only, not source faithfulness, physical correctness, sandbox safety, or publishability.

## Mandatory context
Read `AGENTS.md`, `docs/PROFILE_ADDENDUM.md`, and `docs/HACKATHON_RULES.md` before work. Existing master instructions and participant FAQ have not been recovered; their absence must not be replaced with invented rules. Do not start product implementation until Calvin confirms readiness.
