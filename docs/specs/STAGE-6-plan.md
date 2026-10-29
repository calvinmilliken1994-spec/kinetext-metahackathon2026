# Stage 6 — subject engines and the component kit (DRAFT, pending Calvin's confirmation of subjects)

## Why
Calvin, 2026-10-29: the product must not become a fact checker. It should **summarise any page quickly and accurately** and turn it into **demonstrational visuals and interactive components**. The evaluation showed the gap: 9/29 real pages became a lesson; **17/29 were declined** because no hand-built activity fitted. Checks stay as the quiet trust layer underneath.

## Design: Muse designs, tested components run it
- **Layer 1: shared component kit** (works on any page). Each component is a tested React view with a JSON schema; Muse fills it in; deterministic checks verify what can be verified.
- **Layer 2: subject engines.** A subject engine is a curated bundle: shared kit + subject-specific components + subject-specific guidance for Muse (what a good activity looks like in that subject) + subject-specific checks.
- **Flow:** source → Muse analysis (subject, key points, which components fit) → **page overview shown first** → Muse designs 1–3 components → checks → repair → interactive lesson. A page with no simulation still gets an overview and at least one interactive component; a decline becomes rare and is reserved for unusable sources.
- AI-written code is **not** executed (rules require real isolation first). Muse authors data, not code.

## Shared component kit
| Component | What the student does | What is checked deterministically |
|---|---|---|
| **Page overview** | Reads 3–6 key points and key terms | Every point has a verbatim quote from the page |
| **Quiz cards (predict, then reveal)** | Commits to an answer, then sees the page's answer and quote | Answer quote verbatim; one correct option; options distinct |
| **Sequence / process** | Puts steps in order (generalises the timeline ordering activity) | Steps quoted; order supported by the source wording or numbering |
| **Sort into groups** | Drags items into categories | Each item–group link quoted |
| **Concept map** | Explores how ideas connect, then fills a gap | Each link quoted |
| **Compare table** | Predicts a cell, then reveals it | Each cell quoted |
| **Formula explorer** | Moves sliders and watches a graph/value; predicts before revealing | Formula quoted; expression parsed by a safe evaluator (no code execution); test cases computed by our code; units and ranges checked |

## Subject engines (proposal)
| Subject | Existing | Adds |
|---|---|---|
| Physics | forces, projectile, lift, drag sims | formula explorer, quiz, sequence |
| Maths | — | formula explorer with function graph, worked-example stepper (sequence) |
| History | timeline | cause-and-effect chain (sequence), primary-source quiz, compare |
| Finance | compound interest | formula explorer (loans, savings, inflation), compare options |
| Chemistry | half-life | formula explorer (gas laws, concentration), **balance the equation** (atom counts checked exactly) |
| Biology | Hardy–Weinberg | process cycles (sequence), classification (sort), concept map |
| Earth & space science | (timeline, half-life) | cycles (sequence), sort, formula explorer |
| Civics & government | — | process ("how a bill becomes law"), compare, quiz |
| Language & reading | — | comprehension quiz cards, vocabulary cards, claim-and-evidence map |

## Build order (deadline Nov 5 11:00 KST; demo prep from Nov 2)
1. Kit core: page overview, quiz cards, sequence (from timeline), sort; analysis outputs subject + components.
2. Formula explorer (safe expression evaluator) → unlocks Maths, Finance, Chemistry, Physics breadth.
3. Balance-the-equation (Chemistry), concept map, compare table as time allows.
4. Re-run the 29-page evaluation: target "no dead-end declines".

## Open decisions
- Calvin confirms the subject list and priority.
- Interfaces (component schemas, analysis contract changes) are frozen before parallel implementation; Muse drafts the component schemas (product intelligence layer), lead freezes.
