# Stage 10c slice C (H2): the Muse grounding step is visible and correctly labelled

Review item: `docs/reviews/ux-pair-review-2-2026-11-02.md` H2. Frames are from `?replay=<job>&speed=4&tour=0` at 1920×1080
(one at 1366×768), dark theme unless the file name says `light`, read-only API on :8787, no live calls.
These are replays of stored runs; the live worker path (`locate` event) is covered by unit tests with the worker's own event
shapes, not by a live run.

## What changed

| Layer | Change |
|---|---|
| Worker (`workers/generation/lesson.ts`) | New stage `locate` (added to `LessonStage`; contracts' `StageStatus` is unchanged, so no `progress` status was needed). One event per revision, emitted when Muse's grounding call has returned (success or failure) and before SAM is called. Detail `<model> located K of N part(s) for SAM` (status `succeeded`) or `<model> grounding failed (<CODE>)` (status `failed`); `latencyMs` = the grounding call's latency (absent when the call threw); no `estCostUSD`, so summing events never double-counts the grounding charge (it stays on the `segment` event). `segment started` gains `figureId` (the figure the part is built on). Every existing event and string is unchanged. |
| Replay (`lib/replay.ts`) | Runs recorded before the `locate` event: `segment started` gains `grounded` and `figureId` (from the published spec); a grounded run with `groundingLatencyMs` gets a `synthetic: true` `locate` event at started + that latency. A run that has its own `locate` event is untouched. |
| Lib (`lib/liveBuild.ts`) | While the segment call is open: Muse locating until `locate`, then SAM confirming; no grounding (or located 0 / failed) keeps "SAM 3.1 is outlining N parts of the figure". The grounded line goes into the part's trace (meta row) for good, with Muse's time and the retry. |
| View (`LiveBuild.tsx`, `live.css`) | The figure frame shows the source figure dimmed with the working shimmer and a caption on a scrim; strip op reads "Locating 5 parts on the figure" then "SAM 3.1 confirming 5 parts". |

Wording shown: `Muse Spark is locating 5 parts on the figure` → `Muse Spark located 5 parts` + `SAM 3.1 is confirming 5 parts` →
(part arrives) meta row `Written 28.7 s — Muse Spark located 5 parts in 16.6 s — SAM 3.1 confirmed 5 of 5 in 4.4 s — SAM retried 1 weak part — 12/12 checks`.
Spark Open says `Muse Spark Open`. The older run keeps `SAM 3.1 is outlining 5 parts of the figure` → `SAM 3.1 outlined 5 of 5 parts in 1.9 s`.

## Frames

| Run | Locating | Confirming | Glow (1.3 s in) | Finished card |
|---|---|---|---|---|
| Spark 1.3, grounded (`job-20261101200607-c65a20bb`) | `spark13-1-locating.jpg` | `spark13-2-confirming.jpg` | `spark13-3-glow.jpg` | `spark13-4-final-card.jpg` (1366: `spark13-1366-final-card.jpg`) |
| Spark Open (`job-20261101212123-3e4734fe`) | `sparkopen-1-locating.jpg` | `sparkopen-2-confirming.jpg` | `sparkopen-3-glow.jpg` | `sparkopen-4-final-card.jpg` |
| Older run, no grounding (`job-20261031081105-910f3776`) | `old-nogrounding-1-outlining.jpg` (SAM only, revision 2 shown) | none | `old-nogrounding-3-glow.jpg` | `old-nogrounding-4-final-card.jpg` |
| Light theme, Spark 1.3 | `spark13-light-locating.jpg` | `spark13-light-confirming.jpg` | | |

## Time on screen at 4× (0.08 s polling of the DOM, wall clock)

| Run | Muse locating | SAM confirming | Glow animation | Grounded line on the meta row |
|---|---|---|---|---|
| Spark 1.3 grounded | 4.04 s | **1.03 s** | 3.86 s | stays (still there when polling stopped, 5.0 s after arrival) |
| Spark Open | 7.53 s | **0.49 s** | 3.86 s | stays |
| Older run, no grounding | SAM outlining 5.2 s (revision 2), 1.9 s call shown per revision | n/a | 3.83 s | stays (`SAM 3.1 1.9 s` step) |

Not met: "each line on screen ≥ 1.5 s at 4×" fails for the **confirming** line (1.03 s, 0.49 s). The cause is the recording, not the
view: SAM's recorded calls took 4.4 s (Spark 1.3) and 2.3 s (Spark Open), which is 1.1 s and 0.6 s at 4×; the next event is the part
arriving, which replaces the frame. At 1× the lines are 16.6 s and 4.4 s. Fixing it needs a hold the replay layer or the lesson
view owns (see the report), not a change to the recorded times. The locating line (4.0 s, 7.5 s), the glow (3.9 s) and the
permanent meta-row line all clear 1.5 s.

## (c) the glow

The glow plays when the part arrives (`.ld-region` animation: 5 regions, running 3.86 s). In `job-20261101200607-c65a20bb` the
label diagram is the last part, so it arrives 12 ms before the job ends and the strip says "Lesson ready" at the same moment;
the regions exist only in the checked part (a revision that fails its checks is never served), so they cannot play earlier than
the part. After the glow the meta row still carries the Muse/SAM line. In all three replays the first poll that saw the regions already saw the glow animation running.

## Checks run

`npm test` 3241 pass / 0 fail (whole tree, with the other slices' work present); `npx tsc -p . --noEmit` 0; web `tsc` + `vite build` (scratch outDir) OK;
`impeccable detect --json apps/web/src apps/web/index.html` → `[]`.
