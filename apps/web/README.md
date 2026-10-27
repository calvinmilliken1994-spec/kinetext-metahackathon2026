# Teacher workspace (Vite + React + TypeScript)

Single-page tool for **Make knowledge interactive** (name provisional): pick a licensed source → watch the Muse Spark
pipeline → use the validated, interactive activity. It is a creative/verification workspace, not a chatbot — there is no
chat interface anywhere.

## Run

```bash
npm run api                    # API on :8787 (live Meta generation OFF unless META_LIVE=1, which costs credits)
npm --prefix apps/web run dev  # http://127.0.0.1:5173 (proxies /api -> 127.0.0.1:8787)
npm --prefix apps/web run build
npm --prefix apps/web run typecheck
npm test                       # includes src/lib/*.test.ts (pure logic)
```

## Principles

- **Same engine as the validator.** `Simulation` calls `accelerationOf`, `simulate` and `stateAt` from
  `packages/activities/forces-1d/engine.ts`. Physics is never re-implemented in the browser and the browser never calls a model.
- **Honest provenance.** A run is labelled `Live run` only if *this browser session* started it; every stored run shows
  `Recorded run · <local date time>`. The stage timeline is built only from real `StageEvent`s (no invented stages; unknown
  cost is shown as pending, never zero).
- **Evidence is visible.** Every evidence quote (activity explanations + Muse's concepts) is highlighted in the original
  source text using the validator's whitespace normalisation mapped back to the original character ranges; citation chips
  scroll to and flash the quote.
- **Predict-then-run.** The reference answer is the engine's acceleration, computed only after "Run it"; the spec's
  `expectedAccelerationMps2` is never displayed.
- **Disclosure** on every activity view: *AI-generated with Muse Spark 1.3 (Meta). Includes NASA source material; NASA has not
  reviewed or endorsed this activity.*

## Layout

```
src/main.tsx, App.tsx, api.ts, hooks.ts, styles.css
src/components/   Header, SourcePanel, PipelinePanel, Timeline, ActivityPanel, Simulation, Scene, Graph,
                  PredictionCards, Explanations, ValidationPanel, JobOutcome, Disclosure, useSimulation
src/lib/          pure logic + node:test tests: highlight, evidence, predictions, track, jobs, checks, format
```

Publishing is intentionally disabled (“Teacher approval & publishing arrive in Stage 6”).
