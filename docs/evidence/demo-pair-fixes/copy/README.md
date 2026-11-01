# Demo pair fixes: copy and tour slice (2026-11-01)

Source: `docs/reviews/demo-pair-review-2026-11-01.md`, items #2, #4, #5, #6, #8, #11, #14. Built by Claude Opus 5.5 (subagent).
Checks were GET-only against the read-only API (:8787, `live:false`) through Vite (:5173). Nothing was generated and no credits were spent.
JPEG q70 frames, 1.8 MB in total. QHD frames are scaled to 1920 wide.

## What changed

| # | Change | Files |
|---|---|---|
| 2 | Natural-repair wording no longer says "mistake" or "Muse's own". Repair story: "Found in Muse's draft by the checks; not a planted test fault." Tour checking step: "…so Muse revised it. Revision 2 passed every check. The checks found the issue in Muse's draft; it was not a planted fault." Analysis repair notes: "Muse's first analysis failed a deterministic check…". The comments in those files were changed to match. System-made fault labels are unchanged. | `lib/repairStory.ts`, `lib/onboarding.ts`, `lib/analysisRepairs.ts`, `lib/provenance.ts`, `lib/evidence.ts`, `components/AnalysisRepairTimeline.tsx`, `components/ComponentRepairTimeline.tsx` |
| 6b | Tour step 6 is now titled "Ready for your review" instead of "Ready to teach". | `lib/onboarding.ts` |
| 6c | Step 7 wording now fits the part being tried. A label diagram reads "Drag each name onto its number, then press Check. Nothing is marked until you do." Sequence, sort and map parts get "answers stay hidden until you check". Prediction parts keep the old line. | `lib/onboarding.ts` |
| 14 | `aiLabel` also strips these openers: "Students explain / describe / show / understand / see / discover / find out", with an optional "will" or "can", followed by "that …" or "how …". The edge rules match "Students learn": a bare opener, a bare "that.", past tense and object phrases all stay as written. This is display only and never touches page quotes. | `lib/displayText.ts` |
| 4 | Reading step: the page being read (`[data-tour="source-text"]`) is now lit as a second target. The card drops below the strip into the empty lesson column. | `lib/onboarding.ts` |
| 5 | Summary step: the part frames are lit as extras, and the card sits above the overview, clear of the overview, the page and the frames. If no clear place exists, the extras are dropped before a target is covered (`placeStep`). Below and above placements also try right alignment. On entering the step, the source pane scrolls to the first lit sentence. | `lib/onboarding.ts`, `components/Onboarding.tsx` |
| 11 | At ≥ 1600 px the card is 460 px wide (480 px at ≥ 2200 px). Body text is 18 px, the title 24 px, and the step count, Skip and buttons 16 px. Below 1600 px it is unchanged (380 px, 16 px). | `styles/onboarding.css` |
| 8 | The hook-slide credit names the job's model and SAM: "page · publisher · licence · AI-written with Muse Spark 1.3 (Meta), teacher review pending · diagram regions: SAM 3.1 (Meta)". SAM appears only when a presented label diagram has SAM regions. The model is read back from the job's disclosure (`madeWithOf`). Spark Open shows as "Muse Spark Open (Meta's open weights)". The title and Sources slides add "Diagram regions by SAM 3.1 (Meta)." to the deck disclosure (`withSamNote`). The credit keeps one line, and the full text is in its `title`. | `lib/presentation.ts`, `components/presentation/PresentationMode.tsx` |

## Measurements

The tour was run with `?tour=1&speed=4` after clearing `localStorage['mki.tour']`, on the dark theme. Overlap is the card's area that falls inside the drawn cut-outs, measured from live rects once each step settled.

| Step | 1920×1080 side / overlap | 2560×1440 side / overlap | 1366×768 side / overlap |
|---|---|---|---|
| 1 welcome | center / 0 | center / 0 | center / 0 |
| 2 library | right / 0 | right / 0 | right / 0 |
| 3 reading (strip + page) | below / 0 | below / 0 | below / 0 |
| 4 summary (overview + page + frames) | above / 0 | above / 0 | above / 0 (frames lit) |
| 5 checking | left / 0 | left / 0 | left / 0 |
| 6 ready | left / 0 | left / 0 | left / 0 |
| 7 try | left / 0 | left / 0 | left / 0 |
| 8 present | left / 0 | left / 0 | left / 0 |

The card stayed inside the viewport on every step at all three sizes. Card width was 460 / 480 / 380 px and body text 18 / 18 / 16 px.

Presentation hook slide. R was pressed with the identity-based rect diff over `.pz-stage *`, `.pz-zone` and `.pz-credit`:

| Lesson | Size | Credit overflow (px) | Elements moved by R |
|---|---|---|---|
| DNA `job-20261031081105-21355f66` | 1920 / 2560 / 1366 | 0 / 0 / 0 | 0 / 0 / 0 (98 tracked) |
| Water cycle `job-20261031081105-910f3776` | 1920 / 2560 / 1366 | 0 / 0 / 0 | 0 / 0 / 0 (87 tracked) |

Verification: `node --test apps/web/src/lib/*.test.ts` gave 1022/1022 passing. `npm --prefix apps/web run build` (tsc + vite) passed. `impeccable detect` reported 0 findings.

## Frames

- `tour-1920-3-reading.jpg`, `tour-2560-3-reading.jpg`, `tour-1366-3-reading.jpg`: the card sits below the strip and the page is lit.
- `tour-1920-4-overview.jpg`, `tour-2560-4-overview.jpg`, `tour-1366-4-overview.jpg`: the card sits above the overview, the frames are lit and the source pane is scrolled to the lit sentences.
- `tour-1920-5-checking.jpg`, `tour-1920-6-ready.jpg`, `tour-1920-7-try.jpg`: the later steps with the larger card.
- `repair-story-1920.jpg`: Run details on DNA, showing "Found in Muse's draft by the checks; not a planted test fault."
- `hook-dna-1920.jpg`, `hook-water-1920.jpg`, `hook-dna-2560.jpg`: the new one-line credit.
- `title-dna-1920.jpg`: the title slide disclosure with the SAM sentence.

## Open

- #6a (the jargon check name) is not done in this slice, because its text lives in the lead-owned `lib/lessonJob.ts` (`STAGE6_CHECK_NAMES`). The strip shows "1 check failed: Each part point is valid and off its printed label" (LD-04). Suggested display text, with ids unchanged: LD-04 "Each number sits on its part, not on the printed label". LD-05 "The printed labels' boxes are valid". LD-06 "SAM outlined one region around each numbered point". Changing these also changes the failure cards that use `lessonCheckName`.
- The title slide disclosure now wraps a little further. On a `&beat=1` deep link, the 7 s key hint above the bar sits over the end of its second line until it fades or a key is pressed. Present opens on the hook slide, so the normal path does not show this.
- Openers such as "Students learn the …", "Students learn why …" and "Students must …" stay as written: they have no "that/how" clause, so they are out of scope. A prompt change (lead) would remove them for new runs.
