# Stage 10c slice B: lesson and slide fixes (evidence)

Spec: `docs/specs/STAGE-10c-first-launch-and-fixes.md` (slice B). Review items: `docs/reviews/ux-pair-review-2-2026-11-02.md`
H1 (+ Calvin's Q4), H5, M7 and the source-credit polish. All frames are from the local dev app (Vite :5173) against the
read-only API (:8787, GET only, live generation off). Jobs: water cycle `job-20261101200607-c65a20bb`, DNA
`job-20261101201240-cfd92cb9`, Declaration of Independence timeline `job-20261031153554-ff0c40bf`.

## H1 / Q4: a wrong order check reveals nothing
A wrong **Check order** now shows only the right/wrong mark on each card and the count line. The page's order (the
step track, each card's page quote, a timeline's dates and the timeline itself) appears when the order is right, or after
**Show the page's order**, offered from the first wrong check on. Same rule for the sequence (lesson and slide) and the
timeline order board. Rule in `lib/orderReveal.ts` (tested).

| Check (1920×1080 unless noted) | Result |
|---|---|
| Lesson sequence, wrong check | 2 of 5 marked; buttons: Check order · Back to the starting order · Show the page's order; step track: absent; card quotes: 0 |
| … then Show the page's order | step track shown; 5 card quotes; the button goes; focus moves to Check order |
| Lesson sequence, right order (cyclic) | "Correct — this is a cycle…"; track and quotes shown; no Show button |
| Same at 2560×1440 and 1366×768 | same states; no document overflow; action buttons on one row |
| Timeline, wrong check | 0 of 6 marked; timeline still hidden; dates 0; Show the page's order offered |
| … then Show the page's order | timeline and the 6 dates/quotes shown |
| Slide (sequence beat 3), wrong check / Show order, 1920 and 1366 | identity-based Δy: 0 moved elements, zoom unchanged (1.10783 / 0.75); the button's room is reserved hidden |

Frames: `20-lesson-sequence-wrong-check-1920.jpg`, `21-lesson-sequence-after-show-order-1920.jpg`,
`30-present-sequence-wrong-check-1920.jpg`, `31-present-sequence-after-show-order-1920.jpg`,
`40-timeline-wrong-check-1920.jpg`, `41-timeline-after-show-order-1920.jpg`.

## H5: the label-diagram slide
The slide's heading now sits over the side column inside the fitted part, so the figure runs the full stage height, and
the part is laid out at a design width whose shape matches the stage (`diagramStageWidth` in `lib/presentation.ts`), so it
is scaled by the height. A frozen engine part now takes its exact fit (no 0.5% dead band: it is fitted once per stage
size, so it cannot feed back into itself; the dead band kept a 6 px overflow at 2560 after a resize).

Figure (plate) height. "Stage" = `.pz-stage`, the slide's area between the credit line and the quote band; the rest of
the window is the credit line, the reserved quote band and the presenter-bar room that every slide keeps.

| Lesson | Size | Before: plate / stage · / window | After: plate / stage · / window | Zoom samples (distinct) | Clipped |
|---|---|---|---|---|---|
| Water cycle | 1920×1080 | 688 px: 0.89 · 0.64 | 754 px: 0.974 · 0.698 | 1 | no |
| Water cycle | 2560×1440 | 934 px: 0.89 · 0.65 | 1017 px: 0.968 · 0.706 | 1 | no |
| Water cycle | 1366×768 | 463 px: 0.88 · 0.60 | 510 px: 0.971 · 0.664 | 1 | no |
| DNA | 1920 / 2560 / 1366 | (same layout) | 0.974 / 0.976 / 0.971 of stage | 1 | no |

Sweep (water, resizing in one tab 1920 → 2560 → 1366 → 1592×815 → 1500×820 → 1440×900 → 1536×864 → 1280×720 → 1920):
one zoom value per size, nothing clipped (1440×900 is width-bound at 0.88 of the stage). R / → / R / ← on the slide at
1920 and 1366: identity-based Δy 0, zoom unchanged (← removes only the revealed name, as intended).

Frames: `09-before-diagram-slide-water-1920.jpg` (before), `10-diagram-slide-{water,dna}-{1920,2560,1366}.jpg` (2560
frames downscaled to 1920 wide), `11-diagram-slide-water-2560-labels-shown.jpg` (last step, the figure's own labels).

## M7: lesson cold start
`SourceSkeleton` replaces "Loading the page…" in the source pane (live in this slice). `LessonSkeleton` (title, status
line, the first part as a figure beside its controls, the notes; shimmering bars, static under reduced motion) is
exported from `PendingCard.tsx`; the lesson's loading branch lives in `App.tsx` (slice A), so the lead applies that line.
`01-cold-start-skeleton-1920.jpg` was taken with a fetch shim in this tab that delayed `/api/jobs/<id>` and
`/api/sources/<id>` by 9 s and with `LessonSkeleton` mounted where App shows "Loading the lesson…" (a preview of the lead's
App change, not the shipped App).

## Polish: source credit
The quote count moved to its own quiet line ("21 of 21 quotes found on the page"); the credit line keeps the publisher
whole and, on a narrow pane (1366), wraps the Original / Credit & key links under it instead of cutting the name.
Measured: no `scrollWidth > clientWidth` on the credit or the count at 1920, 2560 and 1366 for the water-cycle, DNA and
Declaration lessons. Frames: `50-source-credit-1920.jpg`, `50-source-credit-1366.jpg`.

## Checks
Web lib tests 1211/1211 pass (new: `orderReveal`, `sourceMeta`, `skeleton`, `presentation.diagram`); typecheck clean; web
build OK; `impeccable detect` 0 findings.
