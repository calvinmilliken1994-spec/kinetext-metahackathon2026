# Demo pair review fixes: SAM and build slice

Fixes for items #1a, #9, #10, #12 and #13 of `docs/reviews/demo-pair-review-2026-11-01.md`. Built by Claude Opus 5.5 (web child). Checked against the read-only live API with GET requests only, using stored runs. Nothing was generated.

Runs used: water cycle `job-20261031081105-910f3776` (Muse Spark 1.3, the tour run) and DNA `job-20261031081105-21355f66`. Frames saved at 2560×1440 were scaled to 1920 wide (JPEG q70, 10 files, 1.6 MB).

| Item | What changed | Checked in the browser |
|---|---|---|
| #1a SAM regions | Draw-in uses a 3 px Meta-blue line with white inner and outer lines, a dark outer shadow and a 14% tint. After about 1.8 s it settles to a quiet resting outline: 2 px dark blue with a white halo. In a lesson, every part keeps that resting outline, and the part in focus is drawn strong. Slides are unchanged: only the current part is outlined, and the outline now uses the strong style. Widths are whole pixels, because Chrome rounds 1.5 px borders down to 1 px. | The resting outline reads on the sky-blue water figure and on the white DNA figure (S02, S06, S07, S09, S11). Slot names stay hidden, and `.ld-slotname` count = 0 before any answer. On the DNA presentation beat, 1 region is visible and 5 are hidden. |
| #1a SAM working | Once the run records a SAM call, the grey "The page's figure" frame shows "**SAM 3.1** is outlining 5 parts of the figure", with a breathing ring and a light passing over the frame. After the call it shows "SAM 3.1 outlined 5 of 5 parts in 1.9 s" with no working cue. No region is drawn before the part arrives. Both cues are off under reduced motion. | The `::after` animation is `lb-shimmer` while the call is open and `none` once it closes (S01, S04, S10). At 1366×768 the caption stays inside the frame, and the document does not overflow. |
| #9 Skip / Esc focus | When the tour closes, focus goes to the lesson title (`tabIndex=-1`, no ring) after the lesson has rendered. Focus stays put if it went somewhere on purpose (the rail button, presentation mode). The rail's Lesson button also focuses the title. `.activity-panel:focus-visible` no longer draws a ring round the whole column. | `?tour=1&speed=4`, then Watch, then Esc. Active element: `H2.lesson-title`, outline none, column outline none. The lesson is at rest with no live bar (S08). |
| #10 Replay again | `useFollowBuild` now uses `arrivals()` (lib). When parts vanish, the replay has restarted, so the same parts count as arriving again, and the user-scroll stop is reset. | After the user scrolled the column with the wheel, "Replay again" (speed 4) scrolled to SAM outlining and then kept the diagram under the strip (top 226 px; S12). |
| #12 `?job=` follows the lesson | `lib/jobUrl.ts` `shownSearch` with `history.replaceState`. When another lesson opens, it replaces a stale `?job=`, `?replay=` or `?present=`. The page's first lesson keeps its URL, so `?tour=1` still works on reload. `?present=` is left to its own exit path. A `?replay=` of the shown lesson is kept. | Drag link, then Tour, then Watch: `?job=<water>&tour=0`. A pick from the runs list and a pick from the library both rewrite `?job=`, and a refresh opens the same lesson. `?present=` exits to `?job=<same>`. |
| #13 Pinned opening | `lib/demoPins.ts`: a plain visit opens the pinned water-cycle run, even when a newer run exists. If the pin is missing, unfinished or not a lesson, the app falls back to the newest lesson. The tour id is pinned to the same run, and a test asserts `TOUR_JOB_ID === DEMO_PINS.tour`. | `/?tour=0` and `/?tour=1&speed=4` open "Continuous circulation of water between ground and atmosphere". |

Not changed here: #7 (crop padding). The crop is computed in `lib/repairStory.ts` (`storyView`), which is the other child's file. It is reported to the lead.

## Frames

| File | What |
|---|---|
| S01-water-sam-working-1920-dark.jpg | The figure frame says SAM 3.1 is outlining 5 parts (working cue) |
| S02-water-draw-in-1920-dark.jpg | Diagram 0.9 s after arrival: strong regions drawing in (3 px) |
| S04-dna-sam-working-2560-light.jpg | DNA, SAM working, light theme, 2560 |
| S06-dna-settled-2560-light.jpg | DNA after the draw-in: quiet resting outlines, names hidden |
| S07-dna-rest-hover-1920-dark.jpg | Lesson at rest: resting outlines, hovered part strong |
| S08-after-esc-1920-dark.jpg | After Esc mid-tour: lesson at rest, no ring round the column |
| S09-water-draw-in-1920-light.jpg | Water draw-in, light theme |
| S10-water-sam-working-2560-dark.jpg | Water, SAM working, 2560 dark |
| S11-water-settled-1920-light.jpg | Water after the draw-in, light theme |
| S12-replay-again-follows-1920-dark.jpg | "Replay again": the diagram is followed into view |

Noticed: on a cold load at 2560 the DNA figure image arrived a little after the part, so the first draw-in frame showed the regions on an empty plate. That frame was discarded. Preloading the figure when SAM finishes would remove the gap (not done here).

Verification: `node --test apps/web/src/lib/*.test.ts` 1022/1022, `npm --prefix apps/web run build` OK, `impeccable detect` 0 findings.
