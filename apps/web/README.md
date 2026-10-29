# Teacher workspace (Vite + React + TypeScript)

Single-page tool for **Make knowledge interactive** (name provisional): pick a licensed source → watch the Muse Spark
pipeline → use the machine-checked, interactive activity. It is a creative/verification workspace, not a chatbot — there is no
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
  `Recorded run · <local date time>`. The stage timeline is built only from real `StageEvent`s (no invented stages).
- **Cost is never silently zero (R-09).** `null`/missing cost renders as `unknown`. A job with `reservedUnknownUSD > 0` shows
  e.g. `$0.0276 (includes $0.0276 reserved for an uncertain outcome)`; a failed stage shows its recorded amount (tagged
  *reserved*) or `cost unknown`; an interrupted job is tagged `may be incomplete`. A missing `reservedUnknownUSD`
  (job recorded before the fix) counts as 0. Logic: `src/lib/cost.ts`.
- **Say exactly what is checked (R-08).** Deterministic code machine-checks schema, ranges, source hashes, quotes found in
  the source, and numbers re-run on the physics engine. Explanation *wording* is AI-generated and not verified: each
  explanation card and the section carry an `AI-generated · needs teacher review` tag, the validation badge reads
  `Machine checks passed · n/n` (counts from the report), and the `scope.prose-unverified` message is shown in an info
  callout (a fallback with the same meaning is shown for reports that predate that check).
- **Busy state is the server's (R-10).** The Generate button is driven by `GET /api/health` `busy` (polled every 3 s, and
  re-read right after POSTing a job), never by scanning job history, so a stale `running` record cannot lock the UI. Jobs
  the server marked `INTERRUPTED` show as *Interrupted — the server stopped before this job finished.* Logic: `src/lib/health.ts`.
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
src/lib/          pure logic + node:test tests: highlight, evidence, predictions, track, jobs, checks, cost, health, format
```

Publishing is intentionally disabled (“Teacher approval & publishing arrive in Stage 6”).

## Stage 6 lesson UI (S6-U)

`LessonView` shows one lesson: the **overview first** (headline, numbered key points, key terms, each with its quote), then the
components **in plan order** as a vertical stack. Each component sits in a `KitCard` with its title, the single `Disclosure`
“AI-written” badge, a quiet status (✓ checked / ✓ checked, some items left out / ✗ could not be verified / not built) and its
quotes on reveal. A component that did not pass shows only its plain message, never its content. A declined page shows the
decline card (coverage, reason, attribution). A premium `ActivitySpec` mounts through the existing `ActivityPanel`.

Views: `QuizCardsView`, `SequenceView` (shared `OrderBoard`, also used by the timeline `OrderActivity`), `SortView`
(keys 1-4 or click), `ConceptMapView` (SVG, read-only plus an optional hide-one-word mode), `CompareView` (predict a hidden
cell, or reveal-only), `FormulaExplorerView` (sliders, live result, SVG graph of the result against the x variable, value table,
predict-then-reveal), `BalanceView` (coefficient steppers, live atom table, check, reveal).

Pure logic (all in `src/lib`, tested with `node:test`): `seeded`, `quiz`, `sequence`, `sort`, `conceptMap` (layout),
`compare`, `formula` (safe evaluator for the frozen grammar, no eval/Function), `explorer` (curve sampling, axes, graph
geometry, case grading), `balance` (formula parser, atom counter, exact solver), `lesson` (cards, messages, quote keys).

Demo harness (development only): `npm --prefix apps/web run dev`, then open `/?lesson-demo=1` (optional `&lesson=drag|gallery|partial|declined|premium`).
It renders hand-written fixtures from `tests/fixtures/stage6` and is marked as a demo; it is behind `import.meta.env.DEV`, so a
production build contains neither the harness nor the fixtures.

What the views read from the stored specs (nothing else): see `packages/contracts/kit.ts`. Outputs, curve samples and the balance
solution are computed in the browser from the spec's inputs; none are stored. `LessonView` props: `lesson` (`LessonSpec`), `specs`
(stored kit specs by spec id), `analysis` (`SourceAnalysisV2`, drives the decline card), `sources` (`SourceRef[]`), `cite`, `disclosure`,
optional `premium` spec. `collectLessonQuotes()` returns the quotes to highlight in the source panel (kind `lesson`).
