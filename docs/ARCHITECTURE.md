# Proposed architecture (not yet implemented)

**Make knowledge interactive.**

## Journey
UPLOAD → GENERATE → PREVIEW → VERIFY → EDIT → PUBLISH.

## Core execution
Source upload → direct Meta multimodal analysis → Meta objective/activity planning → Meta executable specification → schema plus semantic validation → allowlisted activity construction → deterministic tests → bounded Meta repair plan → revalidation → teacher-approved immutable publication.

Proposed stack, subject to user confirmation: TypeScript throughout; Next.js/React teacher and student surfaces; server-only OpenAI SDK configured for Meta; JSON Schema/Ajv contracts; Node worker and file-backed local repository initially. No database or paid queue required for first slice. Hosted deployment is undecided and unprovisioned.

## Modules and interfaces
- `packages/contracts`: versioned learning specification, stage events, model receipts. Schema is initially in `schemas/learning-artifact.schema.json`; moving it requires contract owner review.
- `packages/meta`: `analyzeSource(sourceRef)`, `planActivity(analysis)`, `generateSpec(plan)`, `diagnoseRepair(spec, validationReport)`; server-only, exact model selection and explicit unavailable errors.
- `packages/activities`: allowlisted `forces-1d-v1`; positive mass, SI units, net force sign, bounded fixed timesteps; no eval or arbitrary expressions.
- `packages/validation`: schema, unique IDs, source hash/page/reference existence, slider min/default/max ordering, equation consistency, deterministic expected accelerations, finite state, resource bounds, accessibility checks.
- `apps/web`: upload, progress, preview, verify, edit and publish. Technical panel consumes real stage events, not staged agent animations.
- `workers/generation`: cancellable stage machine, idempotent cache keyed by source hash + model + prompt/schema version + teacher edits; no cross-user source cache leakage.

Stage envelope (design): `{jobId, stage, status, provider, requestedModel, actualModel, startedAt, finishedAt, toolCalls, receiptId, validationReportId}`. Source reference: `{id, sha256, page, locator, license}`. Validation report: `{artifactId, revision, checks:[{name,passed,evidence}], publishable}`. Finalization requires all mandatory checks and human publication approval. Interfaces are design-only until frozen with tests.

## Safety and trust boundaries
Validate upload type/size/page count, do not fetch arbitrary model-supplied URLs (SSRF). Strip document active content. Treat source text/diagrams as data and reject embedded tool instructions. Manual concept annotation is visible if SAM fails. Explanations carry source IDs/page anchors; missing grounding blocks publish.

Baseline activities contain data only and run on tested components in a restricted browser frame. Later generated code builds in a separate no-network disposable process/container with unprivileged identity, filesystem/CPU/memory/output/time caps, bounded tool allowlist, and no credentials; browser CSP/iframe restrictions are additional defense, not a replacement for execution isolation. Advanced generated-code path is disabled in the v0.1 contract.

SAM `sam-3.1`: selectable regions/masks/boxes with teacher concept mapping, after core slice. Muse Image `muse-image-1.0`: optional labeled illustrations, never scientific truth. Voice optional later. Muse Spark Open: explicit benchmark job only, never silent fallback; no GPU provisioning.

## Missing implementation
No production SDK adapter, simulation renderer/engine, semantic validator, repair tool loop, persistent stage stream, upload service, or published student experience exists in this setup checkpoint.
