# Set B slides slice: presentation hook, deck order, one feedback voice

Built by Claude Opus 5.5 (web child, set B slice B3 + B4), 2026-11-01. GET-only against the local API on :8787 (stored
lessons, nothing generated), Vite on :5173, browser at 1920×1080 and 1366×768, dark theme.
Design source: `docs/reviews/ux-review-2026-11-01-part2.md` §3 (#8, #10) and part 1 #8, #10, P6, P11.

## What changed

| Item | Change | Where |
|---|---|---|
| B3 hook | Present (lesson button, rail, tour) and a `?present=<job>` link without `&beat=` open on the hook: the first beat of the most visual part. `?beat=N` still opens beat N (`beat=1` is the title). | `lib/presentation.ts` (`HOOK_BEAT`, `heroBeatIndex`, `presentRequest`, `initialPresent`); `App.tsx` one line (`onPresent` passes `HOOK_BEAT`) |
| B3 order | Deck = Title → (classic goals) → parts, most visual first (label diagram, simulation, formula, algorithm, ladder, threshold, table, timeline, balance, compare; then quizzes, sequences, sorts, maps in plan order) → In short → Key terms → Sources. Quizzes now come before the summary and terms that answer them (P6). | `lib/partOrder.ts` (new, `mostVisualFirst`), `lib/presentation.ts` `planBeats` |
| B3 credit | One line above the hook slide: page · publisher · licence · "AI-written, teacher review pending" (`creditLine`). 20 px at 1080p, 15 px at 768p, `--ink-3`, one line with ellipsis. The title sheet keeps the full credit and is one ← away. | `PresentationMode.tsx`, `present.css` `.pz-credit` |
| B3 summary | The AI summary slide is "In short" with a small "AI-written summary" line (P11); "What the page says" is left only for real quotes in the quote zone. | `Beats.tsx` OverviewBeat |
| B3 bar | "Where am I" line (`Diagram · step 1 of 7 · revealed`, `Question 2 of 4`, `In short · point 3 of 4`) with the count under it; Reveal and a labelled Next are 44 px targets, Back too; "Start from the beginning" on the hook slide (Home); quiz beats are `Q1…` on the track, and below 1600 px only the current beat's name shows (others are marks with tooltips) so nothing is cut to "Diag…". | `PresentationMode.tsx`, `present.css` |
| B4 voice | `lib/feedback.ts` (new): one compact line `18,000 N predicted · 18,375 N calculated · just outside the 2% target`, three levels (within the target / very close = outside it but within twice it / off), one next action, and a folded "How close counts" with the margin's numbers, the worked calculation and "worked out by code … not written by the AI". `ladderFeedback` keeps the answer out of the line until it is shown; `choiceFeedback` words pass/fail predictions the same way. | `lib/feedback.ts` |
| B4 lesson | Engine case cards and formula cases use `FeedbackLine`; the activity header's repeated `last-result` block and the explorer's second verdict under the graph are gone (the graph keeps its own guess/gap marks). Log ladder checks and threshold "It passes / It fails" predictions use the same voice. Learner-facing "engine says", "the calculator says", "Computed by our code", "worked out by code" are gone; that honesty sits in the disclosure. | `PredictionCards.tsx`, `ActivityView.tsx`, `FormulaExplorerView.tsx`, `LogLadderView.tsx`, `ThresholdView.tsx`, `lib/thresholdView.ts` (`thresholdFeedback`), `styles/engines-a.css` `.fb*` |
| B4 slides | Predict beats: headline + detail from the same lib (`Very close` / `just outside the 2% target · 375 N low`), slot label "Calculated · lift" instead of "Engine · …", fine print "Within 2% of the calculated value counts as right." The "computed by code" note moved to the presenter notes cue. Class-prediction slot no longer pushes its unit outside the box. | `Beats.tsx`, `lib/presentation.ts` `predictVerdict` |

## Present opening (no `&beat=`), R and ← on the opening slide

Element rects inside `.pz-beat`, `.pz-zone` and `.pz-credit`, sequence-matched by tag/class, before vs after R; `.pz-fit-zoom`
and `--pz-fit` read before and after. "← ×2" = state after pressing ← twice from the revealed hook: first hides the
answer, second reaches the title sheet. Rows in `measurements.jsonl`.

| Lesson | Job | Opens on | 1920×1080 moved / zoom | 1366×768 moved / zoom | ← ×2 |
|---|---|---|---|---|---|
| DNA | `job-20261031081105-21355f66` | beat 2, Diagram (engine) | 0 / 1.38288 = 1.38288 | 0 / 0.941441 = 0.941441 | unrevealed, then title |
| Binary search | `job-20261031105047-d97bab36` | beat 2, Algorithm (engine) | 0 / 1.38914 = 1.38914 | 0 / 0.945701 = 0.945701 | unrevealed, then title |
| pH | `job-20261031023145-7a1de630` | beat 2, Scale (engine) | 0 / 1.27386 = 1.27386 | 0 / 0.86722 = 0.86722 | unrevealed, then title |
| Electoral College | `job-20261031101734-fca565b7` | beat 2, Vote (engine) | 0 / 1.76437 = 1.76437 | 0 / 1.20115 = 1.20115 | unrevealed, then title |
| Lift (predict beat, class 18000) | `job-20261031103330-d6d68647` | beat 2, Predict | 0 / 1.33617 = 1.33617 | 0 / 0.933638 = 0.933638 | — |

New track orders: DNA `Title · Diagram · Q1–Q4 · In short · Key terms · Sources`; binary search `Title · Algorithm · Q1–Q4 ·
In short · Key terms · Sources`; pH `Title · Scale · Q1–Q3 · In short · Key terms · Sources`; Electoral College `Title ·
Vote · Which first? · Timeline · In short · Key terms · Sources`. Beat numbers in the part-2 video plan change: the DNA
diagram, binary search, pH scale and Electoral College vote are all beat 2 now (or open the link without `&beat=`); the
DNA Sources slide is still beat 9.

## Feedback line checks

| Where | Input | Shown |
|---|---|---|
| Lift lesson, case 1 card | 18000 | `18,000 N predicted · 18,375 N calculated · just outside the 2% target` · "Aim a little higher on the next case." · How close counts: "Within ±368 N counts as right here: 2% of the calculated value. Worked out: … → lift = 18,375 N. The calculated value is worked out by code from this case’s inputs, not written by the AI." |
| Lift slide, predict beat | class 18000, R | `Very close` / `just outside the 2% target · 375 N low` (aria-label: the full line) |
| Drag lesson (formula explorer) | 1000 | `1,000 predicted · 1,531.25 calculated · 531 too low`; no second verdict under the graph |
| pH lesson ladder | 1000, less acidic | `1,000 times less acidic predicted · too low` (answer still hidden) · "Count the whole steps: each one multiplies by 10." |
| pH lesson ladder | 100000, less acidic | `100,000 times less acidic predicted · 100,000 times less acidic calculated · within the 2% target` |
| Electoral College lesson | "It passes" on 269 | `Not this time` · `It passes predicted · it fails · 1 short of the 270 needed` |

`document.body.innerText` on the lift and pH lessons contains neither "Computed by our code" nor "engine says".

## Files

JPEG frames (all < 250 KB, folder ≈ 1.9 MB): `<lesson>-present-open-<w>.jpg` (bar shown) and `…-open-revealed-<w>.jpg`
for dna, binary-search, ph, electoral-college at 1920 and 1366; `dna-in-short-1920.jpg`; `lift-slide-feedback-1920.jpg`
and `-1366.jpg`; `lift-lesson-feedback-1920.jpg` (disclosure open); `electoral-lesson-feedback-1920.jpg`.
`measurements.jsonl`: one row per check (the first `slide-feedback` 1920 row was taken before the slot-width fix; the
later 1920 row and both frames are after it).

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 965 pass, 0 fail (new: `feedback.test.ts` 10, `presentation.order.test.ts` 6;
  updated: deck-order, deep-link and `predictVerdict` expectations in `presentation.test.ts` / `presentation.v2.test.ts`).
- `npm --prefix apps/web run build`: typecheck and Vite build pass.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

## Known limits

- Light theme was not re-measured for Δy in this slice (dark only, both sizes).
- The DNA/pH stage hero is not yet fitted to the height budget (part-2 P4); the bottom of those slides stays empty.
- Lift scene text "Lift L (engine)" lives in `LiftView.tsx`, outside this slice.
- `lib/partOrder.ts` is this slice's copy of the "most visual part" rule; the lesson slice may have its own, to merge.
