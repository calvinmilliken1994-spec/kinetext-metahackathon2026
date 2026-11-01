# Demo pair review 2026-11-01 (joint report)

Reviewers: GPT-6.1 Sol (walked the demo path, 29 captures) and Claude Opus 5.5 (reviewed each capture, read the code, wrote this report). The full exchange is in the scratch dialogue (`cache/scratch/ux-pair-demo/dialogue.md`, profile `meta-hackathon-2026`), with slide-by-slide text logs (`water-slides.json`, `dna-slides.json`).
Method: GET-only on the live API, no generation, no code edits. Sizes: 1920×1080 (all of the path) and 2560×1440 (DNA hook slide, balance lesson).
Path walked: first-run tour with the recorded water-cycle build (all 8 steps), water and DNA presentation (every beat to Sources and back), DNA lesson and Run details, photosynthesis balance, binary search, Drag, the New lesson panel, Skip mid-tour, and a direct replay timed on the part's arrival.
Earlier review: `ux-pair-review-2026-11-01.md`. Its fixes are checked below under "Fixes that held"; only regressions or leftovers are repeated as issues.

Evidence: `docs/evidence/demo-pair/` (15 JPEGs, quality 70, 2.2 MB; the 2560 frame scaled to 1920 wide). **Dxx** refers to the capture IDs.

## Verdict

**Ready to film, with about half a day of small fixes first.** The full path works end to end with no broken state. The tour waits for a loaded app. Skip lands on the finished lesson. Slides fill the stage at 1920 and 2560. R moves nothing. The closing strip ("Lesson ready · built in 1 min 22 s · 4 Muse Spark 1.3 calls · 2 SAM 3.1 calls · every part checked · $0.144 est.") is the clearest Meta frame in the product.

There are three gaps for judges. **SAM is close to invisible** during the build. **The repair wording breaks Calvin's own rule.** **One checked lesson repeats a science error from its source page.** All three have small, known causes. The rest is tour placement and copy.

## Agreed changes, ranked by impact on the video and judges

| # | Issue | Evidence | Cause / file | Fix | Effort |
|---|---|---|---|---|---|
| 1 | **SAM's work does not show.** During the build the figure frame is a grey box captioned "The page's figure", even after "SAM 3.1 outlined 5 of 5 parts". When the part arrives, the SAM regions draw as 1.5 px blue boxes at 45% opacity, which vanish on the sky-blue figure. Region 2 is a sliver. In a 1080p video the SAM step is text only. | D05, D20 | Plain plate `components/LiveBuild.tsx:225` (deliberate: "the plan names no figure", `lib/liveBuild.ts:121`). Region style `styles/engines-c.css:19-21,72-73`; draw-in `styles/live.css:201,216`. | (a) S: during the build draw only, stroke 2.5–3 px with a white inner line and a dark outer shadow, plus a 12–15% fill tint, then fade as now. No layout change, so no Δy risk. (b) M: when the page has exactly one figure, show it dimmed in the plate (it is the page's own image, so nothing is simulated). | S / M |
| 2 | **Repair wording breaks Calvin's rule.** The project skill says repairs are labelled "Revised by Muse after a failed check", never "Muse's own mistake". The drawer says "The mistake was Muse's own, not a planted test fault." The tour says "That mistake was the model's own, caught by code, not a planted fault." | D05 (tour), D17 (drawer) | `lib/repairStory.ts:60` (`NATURAL_ORIGIN`), `lib/onboarding.ts:220`. | "A natural repair, not a planted test fault." in both. Update `lib/repairStory.test.ts`, which pins the old text. | S |
| 3 | **A checked compare table repeats the source's chemistry error.** "Reaction products" for chemosynthesis = "glucose and hydrogen sulfide", quoted word for word from the NOAA page. The page's own wording is wrong (H₂S is a reactant), and the quote check cannot catch it. A chemistry judge would. | GPT D22 (DOM read, below the fold); confirmed read-only in `storage/runs/job-20261101091250-cc4a139c/compare-table-v1.r1.json`. Another run of the page (`job-20261031092234-3158c0cc`) chose "Starting materials" = "hydrogen sulfide", which is right. | Content, not UI. | For the video, do not scroll to that table, and pin the opening lesson (see #13). For the lead: flag the source sentence as a known error in the page record, or add a cross-check between a page's balance equation and its compare cells. | — / M (lead) |
| 4 | **The reading phase is dead air, and its card hides the page being read.** The strip shows "0 s · No call finished yet", then three shimmer bars over ~700 px of black. The card sits on top of the source pane's title. | D03 | The reading step targets only the strip (`lib/onboarding.ts:208`), so `placeCard` (`:349`) cannot fit it to the right and places it left, over the source. | Add `[data-tour="source-text"]` as a second target on the reading step. The card then drops below the strip into the empty lesson column. For the video, film `?tour=1&speed=4`, or cut the wait with the seconds counter in frame. | S |
| 5 | **The summary step hides the next part and shows one lit sentence.** The card sits below the overview, over the diagram frame's title and Muse's reason. Only 1 of 12 lit source sentences is above the source pane's fold. | D04 | `placeCard` "below" aligns to the target's left edge. The source pane does not scroll to the lit marks. | Align a "below" card to the target's right edge. When the overview lands in a replay, scroll the source pane to the first lit mark (`revealInPanels`, `lib/scroll.ts`). | S |
| 6 | **Tour and check copy.** (a) "1 check failed: each part point is valid and off its printed label" is jargon. (b) Step 6 "Ready to teach" clashes with "Teacher review pending" (keep the caution). (c) Step 7 says "Parts ask for a prediction first" over a drag-and-name task. | D05, D07, D06 | (a) `lib/lessonJob.ts:472` (LD-04; check LD-06 too). (b) `lib/onboarding.ts:225`. (c) `:231`. | (a) "Each number sits on its part, not on the printed label". (b) "Built and checked". (c) "Name the numbered parts, then press Check. Answers stay hidden until you do." | S |
| 7 | **The repair story is too small to read in a video.** It is the best technical-depth frame (four plain steps, ring vs dot before/after on the real figure). But it sits in a ~420 px drawer, and the crop still cuts a printed label ("…irs" = "Base pairs"). | D17 | Crop box `storyView(moves, pad = 120, min = 340)`, `lib/repairStory.ts:97`. | Pad the crop out to whole label boxes, or crop tighter to the points. Film it zoomed (edit zoom or 150% browser zoom), not as a whole-screen dwell. | S |
| 8 | **Slides credit the model only on the last beat.** The hook and title kickers say "AI-written, teacher review pending". The Sources beat names "Muse Spark 1.3 (Meta)". SAM 3.1 appears on no slide. | D09, D15, D16; slide logs | Kicker text from the deck credit (`lib/presentation.ts`). | Name Muse Spark 1.3 in the title and hook kickers. Add "parts found by SAM 3.1" to the label-diagram figure credit. Not on every question slide. | S |
| 9 | **Skip with Esc leaves a focus ring round the whole column.** Skip itself works (finished lesson, activity first, one Present). The blue ring is `.activity-panel:focus-visible`, and it shows after a key press. | D27 | Focus is restored to the panel after the tour closes. | Restore focus to the lesson title (`tabIndex=-1`, no ring) with `preventScroll`. | S |
| 10 | **"Replay again" does not follow the arriving part.** A direct replay scrolls the diagram into view as it arrives (D19–D21 are good). "Replay again" leaves it below the fold (D12–D13). | D12, D13 vs D19–D21 | `useFollowBuild` keeps `seen` (and `userMoved`) across a restart (`components/LiveBuild.tsx:389-392`). `useReplay.restart` only bumps a counter (`useReplay.ts:76`), so no part counts as newly arrived. | Reset `seen`/`focus`/`userMoved` when the replay restarts. Key the hook on the replay run. | S |
| 11 | **The tour card is small for 1080p.** 380 px wide, 16 px body, 14 px step count and Skip, next to a 26 px lesson title. | D01–D08 | `styles/onboarding.css:15,20,23,29`. | At ≥1600 px wide: 420–440 px card, 18 px body, 16 px count and Skip. Re-run the card-vs-cut-out overlap check. | S |
| 12 | **The URL keeps the old `?job=`.** After a tour started from Drag, the water lesson shows with Drag's id in the URL. A refresh or a shared link opens another lesson. | D27 | `?job=` is read once (`App.tsx:83` `RUN_LINK`). Picking a lesson or `startTourReplay` (`App.tsx:389-398`) never rewrites it. | `history.replaceState` on lesson change (the present-exit path already does this, `App.tsx:354`). | S |
| 13 | **The opening lesson is "the most recent run", so it can change before filming.** D01 opened a Muse Spark Open run; D22 shows a Muse Spark 1.3 run of the same page. A new run before filming would change the first frame. | D01, D22 | `resolveRunLink` (`App.tsx:132-145`). | Film from an explicit `?job=` (or `?tour=1` after a check of what opens). Choose a run without the table in #3. | — |
| 14 | **"Students explain/describe/show that…" still opens the "In short" points.** The last review's fix strips only "Students learn". | D29 | `lib/displayText.ts:152`. | Extend the opener rule to explain/describe/show/understand + that/how, with tests; ask the lead to fix the prompt. | S |
| 15 | Binary search: the quote under the array trace is about a linked list ("Binary search may be effective with an ordered linked list."). It is a true quote but a weak match. | D24 (not exported) | Content. | Lead. Fine to film; frame above it. | — |

## Disagreements

| Topic | GPT | Opus | Recommendation |
|---|---|---|---|
| ← from the next beat lands on Key terms (or a quiz) fully revealed (D11, D16) | Breaks the contract that answers are hidden again after Back. | Slide-software behaviour: `presentReducer` 'prev' lands on the previous beat's last step (`lib/presentation.ts:551`). The conceal rule in the spec is for ← within a beat (`:549-550`), which works. | Not a video issue; leave it. If changed later, do it only for quiz/predict beats (land on step 0). Keep recap beats (terms, In short) built. |
| Struck-through used chip after R (D10, D16) | Reads as "unavailable", maybe "wrong". | It is the usual "already placed" mark in a word bank. | Keep. If touched, dim it and drop the dashed border, but keep it readable. |
| Fault-origin wording (D16, D17) | Breaks the skill rule (never "Muse's own mistake"). | First said it was a must-keep from the last review, then conceded: the skill rule is explicit. | **Resolved: GPT is right.** Change #2. Note that the last review listed the old sentence under "must keep"; this report supersedes that line. |
| Showing the New lesson panel in the video (D26) | Configuration, not a hero. | Agree it is not a hero, but it is the only frame with both Meta routes (Muse Spark 1.3 API and Muse Spark Open on Modal). | Show it for 3–4 s. |

## Fixes that held (no regressions)

- The tour waits for the loaded app: no "Loading…" behind step 1 (D01).
- Skip mid-replay stops the build and shows the finished lesson, activity first, one Present button (D27).
- Present opens on the hook question. Slides fill the stage at 1920 (D09, D15) and at 2560 (D28): the DNA figure takes ~930 of 1440 px.
- At 2560 the lesson column is ~1320 px with stepped-up type (D29).
- R moves nothing. The "The page says" band is reserved (D10, D16).
- Run details opens on "How Muse revised this lesson", with ring vs filled dot (D17).
- Binary: "Show the answer" is secondary and the question sits above the controls (D24).
- Disabled primary buttons are grey. The balance surplus is a neutral hatch, not red (D01, D26).
- Working cues: breathing dot, sweep and shimmer appear while calls are open, with no percentages (D03–D05).

## Must-keep moments

1. **The closing strip** (D07): built time, 4 Muse Spark 1.3 calls, 2 SAM 3.1 calls, every part checked, cost, Present.
2. **The part trace** under the diagram title: "Written 24.5 s — SAM 3.1 1.9 s — 1 check failed — Revision 2 · 20.9 s — SAM 3.1 0.8 s — 11/11 checks" (D06, D07).
3. **The check-and-rework frame** (D05): red ✕ check, "reworking it as revision 2", strip counting calls (after the copy fix in #6).
4. **Hook slide → R**: the name lands in the figure's printed slot, and the page sentence appears in the band (water D09→D10, DNA D16).
5. **Balance bars levelling** to 6/6/1/6 with one green line (D22).
6. **The Drag prediction line**: "1,500 predicted · 1,531.25 calculated · just outside the 2% target" (D25).
7. **The repair story** with before/after points on the real figure (D17), filmed zoomed.
8. The macOS-style window and the "Replay of a recorded run · 2× speed · recorded …" label in the build.

## Suggested 3-minute shot list

Record at 1920×1080 CSS px (not a downscaled QHD window). Use `?tour=1&speed=4` for the build. Pin the opening lesson (#13). Times are in the cut.

| Time | Shot | Source frame | Notes |
|---|---|---|---|
| 0:00–0:10 | Cold open: DNA hook slide, class predicts, R → "Base pairs" drops into the figure's slot, page sentence in the band. | D16 | The payoff first. Voice: "A teacher made this from a public-domain page in about a minute." |
| 0:10–0:20 | New lesson panel: 97 licensed pages in 9 subjects, paste your own, two Meta models. | D26 | 3–4 s on the model list. Decide on the "Live generation off" label (keep it and say "recorded run"). |
| 0:20–0:32 | Tour steps 2→3: "Watch a lesson being built"; strip "Muse Spark 1.3 · Reading the page", sweep moving. | D03 | Cut the wait. Keep the seconds counter in frame so the jump is honest. |
| 0:32–0:47 | Summary lands: four key points, cited sentences light up in the page, part frames shimmer. | D04 | Best after fix #5 (more lit lines, card off the frame). |
| 0:47–1:07 | SAM outlines 5 parts → 1 check failed → "reworking as revision 2" → 11/11 checks. | D05 | Voice: "Code checks every part against the page. This draft failed one check; Muse revised it." Needs #2 and #6a. |
| 1:07–1:17 | The diagram arrives: markers pop in, SAM regions draw. | D19→D20 | Needs fix #1a or the SAM step is invisible. Use a direct replay or a fresh tour (not "Replay again", #10). |
| 1:17–1:27 | Closing strip: "Lesson ready · 4 Muse Spark 1.3 calls · 2 SAM 3.1 calls · every part checked · $0.144". | D07 | Hold 3 s on the numbers. |
| 1:27–1:45 | Repair story, zoomed: check found an issue → revised by Muse → rechecked → published, before/after points. | D17 | Zoom in the edit. Voice uses "revised by Muse after a failed check". |
| 1:45–2:05 | Try it as a student: photosynthesis balance, press + until the bars level; green "Balanced". | D22 | Keep the compare table below off screen (#3). |
| 2:05–2:20 | Drag: type 1,500, Check → "just outside the 2% target", guess vs curve. | D25 | Shows a formula engine, not only quizzes. |
| 2:20–2:45 | Present the water cycle: "Which part is number 1?" → class answers → R → "Evaporation" in its slot; → next part. | D09→D10 | Show the key hint once, then hide the bar. |
| 2:45–3:00 | Close on the Sources slide ("AI-generated with Muse Spark 1.3 (Meta)… needs teacher review"), or back on the closing strip. | slide logs / D07 | End on honesty plus Meta credit. |

Leave out: the reading wait beyond a few seconds (D03), the Key terms back-navigation (D11), the chemosynthesis compare table (#3), the binary linked-list quote (D24), cold `?present=` loads ("Connecting…", D14).

## Order of work before filming

1. #2, #6, #14 (copy, about 30 min with tests).
2. #1a (SAM draw-in contrast), then a visual check on the water-cycle and DNA arrivals.
3. #4, #5, #11 (tour placement and size), then the card-vs-cut-out overlap check at 1920 and 1366.
4. #8, #9, #10, #12 (credit, focus, replay follow, URL).
5. #7 crop padding. Then pin the filming lesson (#13) and do a dry run of the shot list.
6. #1b and #3 (lead) if time allows.

## Evidence register (`docs/evidence/demo-pair/`)

| ID | File | What |
|---|---|---|
| D03 | `D03-tour-reading-1920-dark.jpg` | Reading step: card over the source pane, empty lesson column |
| D04 | `D04-tour-summary-1920-dark.jpg` | Summary lands: card over the diagram frame; one lit sentence visible |
| D05 | `D05-tour-parts-1920-dark.jpg` | Check failed → reworking; LD-04 jargon; grey "page's figure" plate |
| D06 | `D06-tour-ready-1920-dark.jpg` | Try step over the finished label diagram; part trace line |
| D07 | `D07-tour-checks-1920-dark.jpg` | Closing strip: calls, checks, cost, Present |
| D09 | `D09-water-hook-1920-dark.jpg` | Water hook slide: fills the stage; kicker says "AI-written" only |
| D10 | `D10-water-reveal-1920-dark.jpg` | R: name in the slot, page quote in the band, used chip struck through |
| D16 | `D16-dna-reveal-1920-dark.jpg` | DNA reveal: "Base pairs" in the printed slot, page sentence |
| D17 | `D17-dna-repair-1920-dark.jpg` | Repair story in the 420 px drawer; crop cuts "…irs"; old fault wording |
| D20 | `D20-plus08-1920-dark.jpg` | Diagram 0.8 s after arrival: markers in, SAM boxes barely visible |
| D22 | `D22-balance-1920-dark.jpg` | Balance levelled 6/6/1/6, green line |
| D25 | `D25-drag-revealed-1920-dark.jpg` | Drag prediction feedback against the curve |
| D26 | `D26-new-lesson-1920-dark.jpg` | New lesson: library, both Meta models, live generation off |
| D27 | `D27-skip-replay-1920-dark.jpg` | After Skip: at-rest lesson; focus ring round the column |
| D28 | `D28-dna-hook-2560-dark.jpg` | DNA hook at 2560×1440 (scaled to 1920): stage fill holds |

Not exported but cited (scratch `shots/`): D01, D02, D08, D11–D15, D18, D19, D21, D23, D24, D29.

## Not covered

- Light theme (the whole walk was dark).
- 1366×768, and 2560 beyond two frames (tour, replay and the other lessons at QHD).
- Frame-by-frame motion: zoom steadiness, sweep smoothness and a Δy re-measure were not repeated. Timing offsets in D19–D21 include screenshot latency.
- Keyboard, screen reader and reduced-motion checks.
