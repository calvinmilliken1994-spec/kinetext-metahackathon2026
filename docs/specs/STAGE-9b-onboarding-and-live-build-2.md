# Stage 9b: first-run tour and live build pass 2

Builds on `STAGE-9-live-build-view.md`. Two asks from Calvin: an onboarding tour for a first-time teacher that doubles as
the scripted path of the 3-minute video, and a live build view that visibly takes shape. Every beat is still driven by a
recorded event or a served artifact; the tour costs no credits because it plays a stored run, always labelled as a
replay. Nothing here posts to `/api/jobs`.

## A. Live build, pass 2

| Change | Driven by | Rule |
|---|---|---|
| Skeleton preview inside each pending frame (quiz cards, sequence rungs, table grid, sliders + graph, figure + label column, bins, map nodes, bars, ladder; generic lines otherwise) | the plan (`componentPlan[].componentId`); the label-diagram label column shows n chips once a SAM call names n parts | Faint, static (no shimmer). Phase changes only its opacity: waiting < writing. A figure is drawn as a plain frame: the plan does not name a figure id, so no image is guessed. |
| Reserve sized from the preview | `lib/liveBuild.ts previewOf(id)` = per-kind skeleton geometry; `reserveHeight = head + body` | Body heights re-measured from stored lessons at 1920 and 1366 (pass 1 under-reserved quiz cards by ~700 px, explorers by ~850 px). |
| Follow the build | the part whose call is open, else the part that just arrived | Gentle container scroll of the lesson column only (`lib/scroll.ts`, smooth unless reduced motion). Stops for good once the user wheels, drags, touches or keys in the column. |
| Bigger strip, sticky at the top of the lesson column | open calls, job clock | Three fixed rows: replay label (replays only), model + current step + elapsed at 20 px, counts so far. Same height running and done. |
| Closing beat | `done` event / final summary | Strip becomes `Lesson ready · built in 1 min 23 s`, `4 Muse Spark 1.3 calls · 2 SAM 3.1 calls · every part checked · $0.14 est.` and a Present button. "Every part checked" only when all planned parts passed, else "2 of 3 parts checked". |

## B. First-run tour

Pure step machine in `lib/onboarding.ts` (steps, readiness from signals, auto-advance after a minimum dwell, card
placement, storage flag); overlay in `components/Onboarding.tsx`; styles in `styles/onboarding.css`.

| # | Step | Spotlight | Ready when | Leaves when |
|---|---|---|---|---|
| 1 | What this is, one sentence | none (centred card) | always | Next |
| 2 | Pick a page or paste text | library picker + rail New lesson | always | "Watch a lesson being built" starts the replay |
| 3 | Muse Spark is reading the page | live strip | replay running | analysis landed (auto) |
| 4 | Key points light up their sentences | overview + source text | overview shown | a part is being written (auto) |
| 5 | A part is checked (and repaired) | the part with a failed check, else the first part | a part has a log | job finished (auto) |
| 6 | Lesson ready | the strip's closing beat | finished | Next |
| 7 | Try the part | first passed part, clicks pass through | finished | Next |
| 8 | Presentation mode | Present buttons | deck ready | "Open presentation mode" or Finish |

- Shown once on a plain visit (`localStorage['mki.tour']` = `done`/`skipped`); never auto-shown on a deep link
  (`?job`, `?present`, `?replay`); `?tour=1` forces it, `?tour=0` suppresses it, `?tour=1&speed=N` sets the replay
  speed (default 2). The rail's "Tour" button reopens it.
- Skippable at every step (Skip tour, Esc). Keyboard: focus moves to the card heading on each step; buttons in tab
  order. Reduced motion: no card or hole movement.
- Spotlight: one SVG scrim with even-odd holes around the targets (clipped to their panel), a compact card beside
  them. Clicks outside the hole are blocked; inside it only on step 7. No confetti, no bounce, no glow.
- Default run: `job-20261031081105-910f3776` (NOAA water cycle: label diagram with two SAM calls and one natural
  repair, plus a sequence). Step texts read real counts (pages and subjects from `/api/sources`, model from the run,
  repair only if the run has one).

## Files

`lib/onboarding.ts` (+ test), `components/Onboarding.tsx`, `styles/onboarding.css`; `lib/liveBuild.ts` (+ test),
`components/LiveBuild.tsx`, `styles/live.css`; anchors and mounts in `App.tsx`, `main.tsx`, `IconRail.tsx`,
`SourcePanel.tsx`, `LessonView.tsx`. Not touched: `LabelDiagramView.tsx`, `lib/labelDiagramView.ts`,
`styles/engines-c.css` (another child). Evidence: `docs/evidence/stage-9/onboarding/`,
`docs/evidence/stage-9/live-build-2/`.
