# Stage 7 — teacher-facing polish (frozen 2026-10-30, lead: Claude Opus 5.5)

Origin: Calvin's design critique of the Moon lesson screenshot (external Claude reply) and the lead's assessment. Calvin approved items 1–4 in order, with Claude Opus 5.5 (High) replacing Sonnet for all web work.

## Root cause of the Moon bug
`packages/meta/prompts.ts` (v9) tells Muse "gravityMps2 … (default 9.8)" for every projectile spec, and each engine's guidance gives similar fixed example defaults. Muse followed it: the Moon lesson (`job-20261027181336-572d603f`) opens at g = 9.8 under the label "Moon surface with no air", while its own prediction case uses 1.62 → 69.44 m. No check compared the opening scene with the lesson's cases.

## Items and frozen rules
1. **Opening case.** The first prediction (`predictions[0]`) is the lesson's opening scenario.
   - Web: every engine view and the formula explorer open on the first case's inputs (clamped to the slider range), and Reset returns there. Fallback to the spec defaults only when there is no case. (`lib/engines.ts` `defaultInputs` and `lib/explorer.ts` `defaultInputs` keep their names and change meaning to "opening inputs"; add tests.)
   - Validator: new semantic check `semantic.opening-case` for slider engines (not timeline): each `simulation.<input>.default` equals `predictions[0].<input>` within 1e-9 relative. Failure message names the inputs; `affected` = `/simulation/<input>/default` only (repair may change those defaults and nothing else). Counts toward the semantic group.
   - Prompts (Muse, bridge): v1 prompt v10 — slider defaults must equal the first prediction's inputs, and the first prediction must describe the page's own main scenario (e.g. the Moon on a Moon page); remove the fixed example defaults that contradict a page (keep ranges). v2 formula-explorer guidance: variable defaults = the first case's inputs.
2. **Shell and copy.** Status line "Draft · needs teacher review" said once; a collapsed **trust receipt** ("N/N checks · N/N quotes · $X", expands to the checks) replaces the always-open check list; technical details OFF by default; no duplicated navigation between the rail and the drawer; the app opens on a chosen lesson (most recent lesson-flow run, else "New lesson"), never on an old v1 test run.
3. **Provenance as interaction** (wave 2, after item 4 lands). Hovering a highlighted source quote highlights every lesson element that cites it and vice versa; for engine views and the formula explorer, a live substituted equation (e.g. `y_max = 15² / (2 × 1.62) = 69.4 m`) rendered from code-owned engine templates / the explorer's parsed expression — no new runtime dependency (no KaTeX).
4. **Comparison ghost and page presets** (projectile first). Preset chips for gravity values that appear BOTH in the spec's cases and as whole numbers in the source text (label = value + unit, tooltip = the page sentence); a faint ghost trajectory at the same launch speeds for the other page-stated value, labelled with its g; "lands at" / peak labels pinned to the landing point and peak without colliding with the curve. Schematic styling only: horizon line allowed; no astronaut, stars or clip-art. Other engines: chips only if trivial, otherwise later.

## Ownership (wave 1 in parallel, wave 2 after C)
| Slice | Model | Owns |
|---|---|---|
| A validator | Qwen 3.8 Max | `packages/validation/validate.ts`, new tests in `packages/validation/` |
| M prompts | Muse Spark 1.3 via bridge (lead) | `packages/meta/prompts.ts`, `prompts-v2.ts` + their tests |
| B shell | Claude Opus 5.5 | `App.tsx`, `IconRail`, `RunsDrawer`, `PipelinePanel`, `ValidationPanel`, `ActivityHeader`, `Provenance`, `JobOutcome`, `LessonView`, new `TrustReceipt.tsx`, `lib/{checks,cost,jobs,provenance}.ts`, `styles/shell.css` |
| C simulations | Claude Opus 5.5 | `lib/{engines,explorer,geometry,charts}.ts`, `ActivityView`, `useSimulation`, `Simulation`, `ProjectileView`, `Scene`, `Graph`, `PredictionCards`, the other engine views, `FormulaExplorerView`, `FormulaGraph`, `controls.tsx`, `styles/sim.css` |
| D linking (wave 2) | Claude Opus 5.5 | `SourcePanel`, `QuoteBlock`, `Explanations`, `KitCard`, `OverviewView`, `lib/highlight.ts`, new `lib/linking.ts` / `lib/equation.ts`, readout areas of C's views, `styles/linking.css` |

`styles.css` is frozen during the waves: each slice adds its CSS only to its own `styles/<slice>.css` (already imported by `main.tsx`). Tests under `tests/` (e2e check counts) are updated by the lead.
