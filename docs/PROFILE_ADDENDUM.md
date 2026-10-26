# HACKATHON PROFILE ADDENDUM
## Meta-First Development, Model Integration and Competition Readiness

Incorporate these requirements into the `meta-hackathon-2026` Hermes profile and all associated agent workflows.

This addendum supplements the existing master project instructions. Preserve the project mission and the permanent tagline:

**Make knowledge interactive.**

The product name remains provisional.

## 1. Official reference material

Review and retain these references:

- Hackathon: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details
- Meta models: https://dev.meta.ai/docs/models
- Meta quickstart: https://dev.meta.ai/docs/quickstart
- Meta cookbook: https://github.com/meta-models/meta-model-cookbook
- Meta open-weight cookbook: https://github.com/meta-models/meta-oss-cookbook

The hackathon details page may require browser rendering or authentication. Do not fabricate inaccessible content.

Use the official participant FAQ already provided as the basis for competition requirements.

Before implementation, verify the currently available model IDs, capabilities, pricing, regional restrictions, and authentication methods.

## 2. Make Meta the primary product intelligence layer

Meta is the first-choice provider for the actual application.

The central workflow must operate as:

SOURCE MATERIAL
→ Meta multimodal understanding
→ Meta educational activity planning
→ Meta-driven executable specification generation
→ Sandboxed activity construction
→ Deterministic validation
→ Meta-assisted diagnosis and repair
→ Published interactive learning artifact.

Use `muse-spark-1.3` as the initial primary model, subject to actual account availability.

Do not merely include Meta models as interchangeable chat providers. Design demonstrable capabilities around their tool calling, multimodal understanding, structured generation and reasoning.

Prioritize these integrations:

**Muse Spark 1.3**
- Source-document interpretation.
- Learning objective extraction.
- Interaction architecture.
- Activity specification generation.
- Bounded tool-using agents.
- Repair planning.
- Educational source-grounding reviews.

**SAM 3.1**
- Textbook diagram segmentation.
- Identification of selectable visual regions.
- Region masks and bounding boxes.
- Mapping teacher-defined concepts to segmented elements.

**Muse Image**
- Educational illustrations and supporting visuals where necessary.
- Controlled visual asset editing.
- Never use generated imagery as a substitute for validated scientific diagrams.

**Muse Spark Open**
- Evaluate Baseten-hosted inference using `meta-models/muse-spark-open-1026`, if available.
- Benchmark compatible tasks against the hosted Muse Spark API.
- Investigate the best open-weight deployment strategy without committing to expensive infrastructure prematurely.

**Muse Voice Transcribe**
- Stretch feature: allow teachers to describe activity requirements verbally.
- Keep optional and avoid distracting from the core workflow.

**Muse Glimmer**
- Investigate only if lightweight deployment or cost-saving use cases justify its integration.

**Muse Wonder**
- Do not depend on it because current official documentation indicates geographic restrictions in South Korea.

Use exact model identifiers validated against the account, not guessed alternatives.

## 3. Use Muse in the engineering workflow

In addition to the runtime model pipeline, establish a development route for Muse Code or Muse Spark coding agents.

Assign Meta-based development work to:

- Implement the Meta SDK adapter.
- Develop prompt and tool-calling workflows.
- Create structured output schemas.
- Implement source analysis.
- Build an agentic repair prototype.
- Generate relevant integration tests.

Have OpenAI or Anthropic review important Meta-authored code independently.

Keep the choice of model tied to task performance rather than requiring Muse to perform poorly suited tasks simply for usage statistics.

Track which substantial code and functionality were created using Muse during the hackathon.

## 4. Revised engineering model assignments

Use the following initial routing preferences:

| Task | Primary | Secondary |
|---|---|---|
| Project orchestration | OpenAI | Anthropic |
| System architecture | OpenAI | Anthropic |
| Complex frontend implementation | Anthropic | OpenAI |
| Backend implementation | Qwen | Anthropic |
| Routine testing and documentation | Qwen | OpenAI |
| Meta API integration | Muse Spark / Muse Code | Anthropic |
| Educational document understanding | Muse Spark | Muse Spark Open |
| Activity design and generation | Muse Spark | Muse Spark Open |
| Diagram segmentation | SAM 3.1 | Manual annotation fallback |
| Educational image generation | Muse Image | Curated source assets |
| Runtime activity repair | Muse Spark | Deterministic fallback or human review |
| Final independent code review | Anthropic | OpenAI |

Discover actual available model IDs and provider authentication before implementing these assignments.

Do not assume that consumer subscriptions include metered API access.

Do not configure invisible external-model fallbacks for core Meta-powered product operations. A demo should clearly establish that Meta performed the relevant task.

## 5. Signature technical capability

The flagship demonstration should involve transforming a real educational source into a working interactive simulation.

Preferred initial domain: physics.

Example:

Upload an instructional page on forces and acceleration.

The system should:

1. Extract the relevant concepts and equations.
2. Identify diagrams or explanatory figures.
3. Determine appropriate interactions.
4. Generate a machine-readable simulation specification.
5. Build a working interactive activity.
6. Execute behavioral tests.
7. Detect and repair a deliberately introduced or naturally occurring defect, if feasible.
8. Produce a usable student-facing experience.
9. Link important explanations to their source.
10. Permit a teacher to edit and reuse the result.

Prioritize genuine software functionality over decorative AI content.

Use a tested component library as the reliable baseline and isolated generated-code execution as an advanced capability.

## 6. Meta contribution ledger

Create `docs/META_CONTRIBUTIONS.md`.

For every major feature, record:

- Feature name.
- Meta model used.
- Model identifier and version.
- Why that model was selected.
- Input modality.
- Output artifact.
- Tool calls involved.
- Whether the call is essential to product behavior.
- Execution time.
- Token or inference usage.
- Estimated incremental cost.
- Validation results.
- Demo relevance.

Instrument actual model usage where practical.

Never invent measurements or claim that tests passed without evidence.

Create `docs/MODEL_BENCHMARKS.md` to compare representative tasks across providers.

Preserve metadata and sanitized execution logs where they help establish Meta's meaningful contribution, without exposing credentials or private source material.

## 7. Product workflow and demonstration

The core user journey must remain simple:

UPLOAD → GENERATE → PREVIEW → VERIFY → EDIT → PUBLISH

The interface may expose an optional technical inspection panel showing:

- Which Meta agents were involved.
- What stage is currently running.
- Generated specifications.
- Tool execution steps.
- Validation checks.
- Repairs made.
- Final artifact status.

This must be backed by actual execution data, not simulated agent activity.

Prepare a three-minute demo structured approximately as follows:

0:00–0:25 — The educator's problem.

0:25–0:55 — Upload and multimodal document interpretation.

0:55–1:40 — Meta-powered generation of a functioning interactive application.

1:40–2:20 — Validation, detected failure and repair.

2:20–2:45 — Teacher editing and student interaction.

2:45–3:00 — Measured results, Meta technology and product impact.

Use real output and real tests. Precompute safe demo examples if live inference is unreliable, but do not misrepresent recordings as live execution.

## 8. Spending and resource management

Verify the account's available Meta credits and any approved partner credits.

Maintain a separate usage record for:

- Meta Model API.
- Baseten.
- Modal.
- Fireworks, if available.
- Other metered development APIs.

Implement:

- Configurable spending thresholds.
- Maximum retries.
- Token and time budgets.
- Per-job execution limits.
- Cached intermediate artifacts.
- Strict generation-loop termination.
- Clear errors when a provider is unavailable.

Do not assume a subscription includes unlimited requests.

Do not incur unapproved charges or provision paid infrastructure without permission.

Keep sensitive credentials outside Git and browser-exposed application code.

## 9. Competition readiness

Maintain:

`docs/HACKATHON_RULES.md`
`docs/META_CONTRIBUTIONS.md`
`docs/ARCHITECTURE.md`
`docs/MODEL_ROUTING.md`
`docs/MODEL_BENCHMARKS.md`
`docs/SPRINT_PLAN.md`
`docs/DEMO_SCRIPT.md`
`docs/SUBMISSION_CHECKLIST.md`

Record development start dates and the origin of project components.

The final public repository must clearly distinguish work created during this event from preexisting assets or code.

Ensure that uploaded educational samples and supporting assets are licensed for the intended use.

## 10. Execution instructions

Your first action is to inspect the existing Hermes environment and list current provider and model availability.

Then:

1. Create or configure the dedicated hackathon profile.
2. Establish provider routing without exposing credentials.
3. Create the project workspace and documentation.
4. Prepare the initial repository structure.
5. Create agent role definitions.
6. Establish task ownership and Git worktree conventions.
7. Define the executable learning artifact schema.
8. Prepare one real Muse Spark API integration smoke test.
9. Establish baseline test infrastructure.
10. Produce a dependency-aware ten-day engineering plan.

Do not launch multiple implementation agents before the interfaces, schemas and ownership boundaries are established.

Return an initial readiness report containing:

- Working profile and workspace paths.
- Available and unavailable models.
- Authentication blockers.
- Provider routing decisions.
- Available credits, where verifiable.
- Proposed architecture.
- Project milestone plan.
- Identified critical risks.
- First three implementation tasks.
- Any decisions that require my approval.

Once setup is complete, recommend the first vertical slice and begin implementation only when the workspace is confirmed ready.

**Permanent project identity: Make knowledge interactive.**