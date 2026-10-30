# Stage 7c — demo visuals and presentation mode (frozen 2026-10-30, lead: Claude Opus 5.5)

Calvin's decisions: demo subjects physics (hero: Moon page or NASA Drag, both made ready), chemistry (NOAA balance), history (NARA); build the chemistry atom bars and the history timeline axis; build a top-tier presentation mode; run the new pages several times for statistics.

| Slice | Model | Owns |
|---|---|---|
| P1 physics heroes | Claude Opus 5.5 | `ProjectileView`, `Scene`, `Simulation`, `FormulaExplorerView`, `FormulaGraph`, `lib/{geometry,explorer,presets}.ts`, `styles/sim.css` |
| P2 chemistry | Claude Opus 5.5 | `BalanceView`, `lib/balance.ts`, `styles/chem.css` |
| P3 history | Claude Opus 5.5 | `TimelineView`, `TimelineActivity`, `Timeline`, `SequenceView`, `OrderBoard`, `OrderActivity`, `EventEvidence`, their `lib/` helpers, `styles/history.css` |
| P4 presentation mode | Claude Opus 5.5 | new `components/presentation/**`, new `lib/presentation.ts`, the entry points in `App.tsx` and `IconRail.tsx`, `styles/present.css` |
| Batch runs | lead | `cache/scratch/s7-runs/` driver; evidence under `docs/evidence/stage-7/` |

Rules: `styles.css` frozen; each slice adds CSS only to its own file. Presentation mode reuses the lesson views read-only; if it needs a prop or hook in another slice's file it reports to the lead. No validator, worker, API or prompt changes. Schematic visuals only (no clip-art). Every visual is driven by the stored lesson data and engine functions, never by invented numbers.
