# UX pair review fixes: quick-wins slice (2026-11-01)

Source: `docs/reviews/ux-pair-review-2026-11-01.md` (items #3, #4, #5 button part, #6 copy part, #7, plus the Opus-only rows: tour over a loading app, "Students learn that…", credit lines, binary quotes, disabled buttons, step 4 title, "Passes?").
Built by Claude Opus 5.5 (web slice). Checked against the read-only API on :8787 (GET only) and Vite on :5173. Frames are JPEG q70; QHD frames are downscaled to 1920 wide.

## What changed

| # | Fix | Where |
|---|---|---|
| 1 | Run details opens scrolled to "How Muse revised this lesson" when the lesson had a repair (component story, else the analysis story); otherwise at the top as before. | `RunsDrawer.tsx` (`openAt`), `App.tsx` |
| 2 | Skip during the tour replay drops the replay AND the build view, so the lesson shows at rest: activity first, notes below, no live strip. While a build is watched, the header no longer adds a second Present (the strip's closing beat has it; the invisible twin keeps the title from rewrapping). | `lib/onboarding.ts` `watchAfterTourClose`, `App.tsx` |
| 3 | Binary search lesson: the question block comes first, then the step controls; "Show the answer" is a secondary button (Next step stays primary). LogLadder, Threshold and LabelDiagram already had Check as primary and the answer button secondary: no change. | `AlgorithmTraceView.tsx` |
| 4 | pH ladder: one unit wording, "Each pH unit is ×10." in lesson and slide; answer line "5 pH units of ×10"; caption "Each pH unit, in the page's words: …". A 0–14 scale now marks every whole unit (`MAX_TICKS` 12 → 14), so every gap reads ×10 instead of ×100. A long quantity name falls back to "step". | `lib/logLadderView.ts` (`unitWords`, `unitRule`, `unitsText`), `LogLadderView.tsx` |
| 5 | A lesson with no working part says "**Notes only:** no activity passed today's checks." under its provenance; Present reads "Present notes" (tooltip has the line) and the deck's title slide starts its disclosure line with the same sentence. | `lib/presentation.ts` (`NOTES_ONLY_LINE`, `Deck.notesOnly`), `LessonView.tsx`, `App.tsx` |
| 6 | `aiLabel` drops a leading "Students (will) learn that …" and turns "Students learn how …" into "How …", capitalising what follows (keeps pH, mRNA, DNA, symbols). "Students learn", "Students learn that.", "Students learn about …" stay. Lesson key points and key terms now go through `aiLabel` too (they used `prettyExponents` only). | `lib/displayText.ts`, `OverviewView.tsx` |
| 7 | `figureCredit` in lib: the licence bracket that repeats the credit is dropped, only the licence's first clause is printed (no "credit NOAA; AI edits must be disclosed"), "Credit:" prefix removed. DNA now reads "U.S. National Library of Medicine · U.S. Government work, public domain". On the hook slide the figure's own credit is hidden (the slide's top credit line covers it): one credit line per slide. | `lib/presentation.ts`, `LabelDiagramView.tsx`, `styles.css` |
| 8 | The first-run tour waits for the runs list, the page list, the source text and the opening lesson (latched once shown, so the tour's own replay never hides it). | `lib/onboarding.ts` `tourReady`, `App.tsx` |
| 9 | Tour step 4 title: "Muse writes the summary first". | `lib/onboarding.ts` |
| 10 | Binary-search slide prints ONE page claim (`stageClaim`: the comparisons claim the trace counts, else the running time, else the first), not "O(ln n)" beside "O(log n)". | `lib/presentation.ts`, `AlgorithmTraceView.tsx` |
| 11 | Disabled primary buttons: grey surface (`--panel-3`), muted text (`--ink-3`), full opacity, both themes. | `styles.css` |
| 12 | Vote: "Passes?" sits inline after "needs ? of 538" in the rule line (lesson and slide). | `ThresholdView.tsx`, `styles/lesson-b.css` |

## Tests

- New: `lib/presentation.quickwins.test.ts` (credit dedupe, policy text, one claim, notes-only deck), `lib/logLadderView.units.test.ts`, `lib/onboarding.ready.test.ts` (tour waits, skip → at rest, step 4 title); extended `lib/displayText.aiLabel.test.ts` (opener edge cases); `presentation.v3.test.ts` key-point expectation updated.
- `node --test apps/web/src/lib/*.test.ts`: 990 pass, 0 fail (972 before). `npm --prefix apps/web run build` (tsc + vite): green. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

## Browser checks (1920×1080 and 2560×1440, dark; light where noted)

| Check | Result | Frame |
|---|---|---|
| DNA `job-20261031081105-21355f66` Run details | Drawer body scrolled 1086 px (1920) / 1169 px (2560); story heading 12 / 21 px below the drawer top; document never scrolls | Q01, Q02 |
| Binary `job-20261031023947-3171fbc9` lesson | Question top 693, controls 878; "Show the answer" is `btn at-next` (grey) | Q03 |
| Binary slide | One claim: "It only performs O(log n) comparisons". R: options, question, claim, zone unchanged; only the ✓ fills the reserved mark slot | Q04 |
| pH `job-20261031023145-7a1de630` | Ticks 0–14 every unit, all gaps ×10, rule "Each pH unit is ×10." (lesson + slide). Slide R: 120/120 elements, 0 moved, 1920 and 2560 | Q05, Q06 |
| Held back `job-20261031111156-12c77646` | Notes-only line shown; "Present notes" opens the title slide with the line | Q07, Q08 |
| Electoral College `job-20261031023315-679e8e97` | "Passes?" 19 px right of "of 538" (lesson), same line; slide R: 0 moved (only `linkable` class added) at 1920 dark, 1920 light, 2560 dark | Q09, Q10 |
| DNA hook slide | Visible credits in the stage frame: `pz-credit` only. R: 0 moved, in-place slot-name insert only, 1920 and 2560 | Q11 |
| Disabled primary | "Check", "Lock in answer", "Generate lesson": `rgb(51,51,56)` / `rgb(163,168,175)` dark, `rgb(223,226,229)` / `rgb(78,96,111)` light, opacity 1 | Q12 ×2 |
| Tour `?tour=1&speed=4` first card | Sampled every 100 ms from navigation, two runs: card first shown at 4.2 s and 7.8 s, never while "Loading…" or "Select a page." showed, always over the loaded lesson | Q13 |
| Tour step 4 | Title "Muse writes the summary first" | Q14 |
| Skip mid-replay (at step 4) | No live bar, lesson children: head → activity → notes → activity; unchanged 4 s later; one Present in the lesson column. A real mouse click on Skip leaves no focus ring on the lesson column | Q15 |
| Natural end of the replay | One Present (the strip's), header keeps only the invisible twin | (no frame) |

## Open items for the lead

- `styles.css` carries one presentation rule (`.pz-stage-frame:has(> .pz-credit) .ld-stage-credit { display: none }`) because `present.css` belongs to the other web child; move it there when that slice lands.
- The binary slide still prints "Compare target 27 with 19 at position 2" under the chart beside the question (review #36, second half); not in this slice.
- `.th-stage-state` keeps its old grid rules in `engines-b.css` (now overridden from `lesson-b.css`); they can be deleted in a CSS tidy.
- Repair story dots: ring vs filled and the crop through printed labels (review #3, second half) not done here.
- The "Students learn" prompt fix (Muse wording) is still the lead's; this slice only strips it at display time.
