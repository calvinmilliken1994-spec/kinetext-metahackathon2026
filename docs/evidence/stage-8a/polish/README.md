# Stage 8a polish: explorer slide, tracer rhythm, data-table label column

Three presentation-level fixes in `apps/web`. Verified in a real browser (Vite on :5173, the live API on :8787 used GET-only)
at 1920×1080 and 1366×768, dark and light. Harnesses: `?engine-demo=a` (tracer), `?engine-demo=b` (data table), real
stored lessons through `?present=<jobId>&beat=N` (explorer).

## 1. Drag explorer slide (formula explorer, `presentation={{mode:'stage'}}`)

Before: the stage beat reused the lesson layout and could only fit 1366×768 by shrinking to zoom 0.61 (graph small in the
left half, large empty area): `before-explorer-stage-768-dark.png`, `before-explorer-stage-1080-dark.png`.

After: a slide layout of its own (`FormulaExplorerView` stage branch, `lib/explorer.ts STAGE_LAYOUT`/`STAGE_GRAPH_SIZE`,
`styles/sim.css` `.explorer-stage*`). The formula, its page line and the sliders sit in a 370 px column. The graph is drawn
at 770×385 design px, exactly its column's width, so its labels stay 1:1. The live equation, the result and Reset sit in
one row under the graph. The design width is 1180 px and the height budget about 450 px. `Beats.tsx` StageFit gets that
width; the explorer's 0.6 zoom floor and `.explorer-main` hero are removed, so it uses the normal 0.85 floor. The lesson
layout is unchanged: same markup, 520×300 graph, value table and cases.
Predict-then-reveal is kept: the result and y scale stay `?` until a slider moves. Hover-linking is kept on the formula,
the live equation and the example line. The example's words go to the quote zone, never into the slide body.

Zoom on the stage beat, every published explorer job checked at 1366×768 (`explorer-stage-1366.json`); none scroll:

| job | sliders | zoom 1366×768 |
|---|---|---|
| job-20261030104212-d509087a (drag) | 4 | **0.996** (was 0.612) |
| job-20261029201342-65f23571 (lift 1900s) | 4 | 1.004 |
| job-20261029202625-8a346f30 (Bernoulli) | 3 | 1.004 |
| job-20261029201508-0cb10404, -202711-c24406ab, -044438-5cd9a47f, -201358-e6938f6f | 2 | 1.004 |

At 1920×1080 the drag slide is zoom 1.415, width-limited at 1180 × 1.415 ≈ 1670 px of 1670 (was 0.902).
After every slider was set to its maximum, the zoom and fitted height did not change
(`after-explorer-stage-768-dark-sliders-max.png`).

R on the drag job (`explorer-R-deltas.json`), every element rect in the beat plus `.pz-zone`:
- Stage beat (5): Δy = Δh = 0 for all 179 elements, zoom unchanged, at both sizes and in both themes.
- Predict beat (4): Δy = Δh = 0 for every element matched before and after; SVG internals are excluded, because the graph draws the guess inside its own box. The only changes are in-place swaps (`?` chip → value, hint → verdict). This beat is unchanged by this work; it stays at zoom 0.795 (`contain`) at 1366×768.

Screens: `after-explorer-stage-{768,1080}-{dark,light}.png`, `after-explorer-stage-2var-{768,1080}-dark.png`,
`after-explorer-predict-{768,1080}-dark-{before,after}-R.png`.

## 2. Algorithm tracer: no empty band

Before (`before-tracer-merge-lesson-1080-dark.png`, `before-tracer-merge-stage-*.png`): every board reserved an 18 px
marker row and a 24 px swap-arc band. Merge sort never uses either, so about 56 px of empty space sat between the
positions and the halves tray.

After: `lib/algorithmView.ts boardRooms(spec, trace)` reads the whole trace once and reports which rooms it ever uses
(marker row: lo · mid · hi, key, min, pivot; swap arc: `swapPair`). The board sets `data-tags`/`data-arc`, and
`engines-a.css` drops the unused rows. The answer is the same on every frame, so stepping and revealing never move it.

| algorithm | marker row | swap arc |
|---|---|---|
| merge sort, linear search | no | no |
| bubble sort | no | yes (if any swap) |
| binary search, insertion sort | yes | no |
| quicksort, selection sort | yes | yes |

Merge sort lesson board height: 282 → 237 px; the tray moves up from 620 to 575 px at 1920×1080. Stage zoom (harness
"Present this part"): merge sort 0.956 → 1.055 at 1366×768 and 1.392 → 1.532 at 1920×1080.

R sweep (`tracer-R-deltas-1080.json`, `tracer-R-deltas-768-{dark,light}.json`): bubble, binary search, merge sort and
quicksort, presenter steps 1 and 2, both sizes and both themes; 32 reveals in total. No layout element moved (Δy = Δh = 0)
and the zoom did not change. The only changes are content: a bar's height when a value is written, and the ✓ mark inside
its reserved slot on the option.

Screens: `after-tracer-merge-lesson-1080-{dark,light}.png`, `after-tracer-merge-lesson-768-light.png`,
`after-tracer-merge-stage-768-{dark,light}.png`, `after-tracer-merge-stage-1080-dark-revealed.png`, and the controls
`after-tracer-binary-lesson-1080-dark.png` (lo · mid · hi row kept) and `after-tracer-bubble-lesson-1080-dark.png`
(swap arc kept).

## 3. Data table: redundant label column

Before: `../views-b/lesson-table-irs-tax-shown-dark.png`, where the Bracket column `12%` repeats Rate `12%`.

After: `lib/dataTableView.ts duplicateLabelColumn(spec)` returns the value column that repeats every row label. The match
ignores spacing and case, and also accepts the column unit written beside the number (`12` + `%`). It returns null for
an empty table, empty labels, or when a lookup question hides a cell of that column, because the row would lose its
name. `DataTableView` then drops the label column and marks that column's cells `role="rowheader"`. Each such cell
carries the row's and the cell's link keys (deduplicated) and the picked-row underline. Planets and the Fed table keep
their label column.

R on the IRS stage (`table-irs-R-deltas.json`): tax step, Q1 and Q2 at both sizes in both themes, 12 reveals; Δy = Δh = 0.
Screens: `after-table-irs-lesson-1080-{dark,light}.png`, `after-table-irs-stage-{768,1080}-{dark,light}.png`.

## Checks

- Tests written first, then the code: `explorer.stage.test.ts` (4), `algorithmView.rooms.test.ts` (5) and `dataTableView.labels.test.ts` (6). The full run `node --test apps/web/src/lib/*.test.ts` gives 798/798 passing.
- `npm --prefix apps/web run build` (tsc + vite) passes.
- `impeccable detect --json apps/web/src apps/web/index.html` exits 0 with `[]`.
- Δy measurements used `captureBeyondViewport: false`. Elements are matched by tag/class sequence, so an in-place swap is reported as a swap, not as movement.

## Open items (not changed here)

- None of the stored explorer jobs that publish an explorer has `hasSourceExample`, so the stage example line (`.explorer-stage-example`) has not been seen with real data.
- Content seen in passing: the glider explorer (job-20261029202711-c24406ab) names its output `result`, and its typeset formula shows only `h/d`, without `tan(a) =`. That is Muse wording or contracts, not a view problem.
- The explorer predict beat still sits at zoom 0.795 at 1366×768. It is `contain`ed: it fits without scrolling and shrinks a little. That layout belongs to Beats and was outside this brief.
