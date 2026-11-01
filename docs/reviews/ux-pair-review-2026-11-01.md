# UX pair review 2026-11-01 (joint report)

Reviewers: GPT-6.1 Terra (browsed the app, took 31 captures) and Claude Opus 5.5 (reviewed each capture, read the code, wrote this report). The full exchange is in the scratch dialogue (`cache/scratch/ux-pair/dialogue.md`, profile `meta-hackathon-2026`).
Method: GET-only on the live API, no generation, no code edits. Calvin's priority sizes are **2560×1440 and 1920×1080**; S01–S04 were taken at 1366×768 before that switch and count as secondary.
Earlier reviews: `ux-review-2026-11-01.md` (part 1) and `-part2.md`. Points fixed since then are listed in "What must be preserved", not repeated as issues.

Evidence: `docs/evidence/ux-pair/` (15 JPEGs, quality 70, 2.07 MB in total). QHD frames are downscaled to 1920 wide for size; the type-size remarks come from the full-size PNGs. Refs like **S13** refer to the capture IDs below.

## Verdict

The product now opens on teaching, not on reading. The default lesson leads with the photosynthesis balance bars. DNA leads with its real figure. Present opens on the hook question. Vote cases no longer give away the answer. The repair story is plain and shows real before/after points. These were the top items of both earlier reviews, and they hold up at 1920.

The new weak spot is **big screens**. At 2560×1440 the lesson sits in a 1040 px column with ~300 px gutters, and the type stays at 12–16 px. Every hero slide leaves the bottom 25–40% of the stage empty, at 1920 too. Both have small, known causes in the code. After that, the main issues are findability (the repair story is two screens down in Run details) and a few predict-then-reveal affordances in lesson view.

## Where we agree (ranked by impact on judges)

| # | Issue | Evidence | Cause | Fix | Effort |
|---|---|---|---|---|---|
| 1 | **Slides under-fill the stage.** DNA, binary, pH, vote, water-cycle and Drag slides stop at ~60–75% of the height. Some (pH, vote, Drag) also leave the right third empty. On a projector the hero is smaller than it needs to be. | S11, S14, S15, S29 (also S07b, S12, S27) | `StageFit` (`components/presentation/Beats.tsx` ~l.430) caps zoom at **1.9** and fits a 980 px design width. At 2560 the width ratio is ~2.2, so the cap applies. At 1920 the wide side-by-side hero (≈2.3:1) is limited by width. Every beat also reserves the quote zone (`--pz-zone-h`, `styles/present.css:22`; `PresentationMode.tsx:244`), even beats that never show a quote. | (a) Raise the cap to ~2.6, or drop it on stages ≥2200 px. (b) Give side-by-side heroes (label diagram, predict) a narrower design width so height sets the fit. (c) Reserve the zone only on beats that can show a quote, decided once per beat so R still moves nothing. Then re-run the Δy=0 and zoom-oscillation sweeps at 1920 and 2560. | M |
| 2 | **QHD lesson view is a narrow column with small type.** At 2560 the lesson column is 1040 px inside ~1650 px, with ~300 px gutters. Meta lines are 12 px, the title is 26 px, and the activity looks small. | S13, S23 | `.main-inner { max-width: 1040px }` (`styles/shell.css:69`). The type tokens are fixed px (`--fs-12…26`, `styles.css:147–151`), and so is the SVG text (`.tick-label`, `.graph-tick`, `styles.css:486–549`). | One `@media (min-width: 2200px)` block: raise each token one step (12→13, 14→15, 16→18, 20→22, 26→30), the SVG label sizes with them, and `.main-inner` to ~1240 px. Measured label rows adapt on their own; check the formula graph and the balance bars. | S–M |
| 3 | **The repair story is buried.** "Run details" opens on "Runs for this page" (12 runs, including "Failed" and "Some parts left out"). The four-step story with real before/after dots is two screens down, in a 440 px drawer. | S09, S10 | The drawer opens at the top (`App.tsx:413` `openDrawer('runs')`). | Open the drawer scrolled to the current lesson's story (`lib/scroll.ts` `revealInPanels`), or put "How Muse revised this lesson" first and move the run list under "Other runs of this page". Add a ring vs filled dot (not colour alone) for first/after, and stop the crop cutting through a printed label ("…irs"). | S |
| 4 | **Skip during the tour replay lands on the build-order view.** The summary comes first, the figure is cut at the fold, and two Present buttons show. | S28 | `LessonView.tsx:202–203` applies `activityFirst` only when `live === null`. After Skip the app keeps the replay's last frame (live bar "Lesson ready"), so the order stays as built. | On Skip, open the at-rest lesson (no live bar). Keep build order at the natural end of a replay, since re-ordering at "Lesson ready" would jump. The blue frame is likely `.activity-panel:focus-visible` (`styles.css:310`) after focus is restored; re-check with a real mouse click. | S |
| 5 | **Lesson view sometimes puts the answer before the ask.** Binary search: the one solid blue button, "Show the answer", sits above the question. Drag: the prediction box is below the 1920 fold. DNA: the how-to is grey 14 px text under the buttons, so the card never asks in its own voice. | S21, S17, S08 | `AlgorithmTraceView.tsx:337–338`: the step button is always `btn-primary` and reads "Show the answer" while a question is open; the question block renders below the controls; the explorer's prediction sits after the table; `LabelDiagramView` status line. | Make "Show the answer" a secondary button and move the question above the step controls. Add one 16 px ask line under each hero card title (e.g. "Name the six numbered parts."), as part 2 #4d proposed. Drag: lift the prediction beside the readout. | S (button) / M (moves) |
| 6 | **pH "×100" labels contradict "each step is ×10".** Ticks are every 2 units with ×100 between them. One ×100 sits on the "Neutral water" row, so the eye pairs them. The light theme's 1 px grey ladder fades out. | S15, S19 | Ladder tick spacing in `LogLadderView.tsx`; copy in the case panel. | Show every integer tick (there is room at 1920/2560). Drop the between-tick labels before R. Change the copy to "Each pH unit is ×10". | S |
| 7 | **A notes-only lesson does not say so.** Both parts of the old pH lesson are out ("Could not be verified", "Held back"), yet Present is enabled and the header only says "2 held back" in red. | S16 | `LeftOutNotice` shows each part but no summary line. | Put one sentence at the top of the box: "No activity in this lesson passed today's checks. The notes below are still checked against the page." Link to the newer pH lesson. Present hint: "notes only". | S |
| 8 | **Hash is a weak demo subject.** It opens on a long quiz. Options still give answers away by their form ("Having the keys of more than one item" beside short invented options; part 2 P5). | (S18, not exported) | Content: no visual engine for this page; quiz validator has no option-form lint. | Leave it out of the video. Lead: quiz option lint (part 2 P5). | — / M (lead) |

## Found by Opus, not raised by GPT (GPT did not object)

| Issue | Evidence | Cause / file | Fix | Effort |
|---|---|---|---|---|
| **First frame is the tour over an empty, loading app.** Empty source pane ("Select a page."), "Loading…", disabled Present. Every first-time judge sees this. GPT called it weak "if captured immediately"; I rank it higher. S06 shows the same loading frame at 1920. | S01 | Tour auto-starts at mount (`App.tsx:362`) while the job list is still loading (`App.tsx:483`). | Open step 1 only after the default lesson has rendered, so the card sits over the balance bars. | S |
| **"Students learn that…" opens almost every AI key point** (water cycle, pH, vote, photosynthesis). It is the most machine-written voice on screen, and it shows in the tour too. | S16, S28 (also S04, S22, S23) | No rule in `apps/web/src` strips it (grep finds nothing). Part 1 #10 and part 2 #10 asked for it. | Strip a leading "Students learn (that\|how)" in `aiLabel`/`aiText` (`lib/displayText.ts`) with a test; ask the lead to fix the prompt. | S |
| **Credit lines repeat themselves or print raw policy text.** "U.S. National Library of Medicine · U.S. Government work (U.S. National Library of Medicine), public domain"; water cycle: "…credit NOAA; AI edits must be disclosed". Slides also carry two credit lines (top kicker and bottom). | S08, S14 (also S07b, S27) | `figureCredit` joins `credit` + `license` (`LabelDiagramView.tsx:202`); stored licence strings repeat the name. | Drop the licence part when it repeats the credit, and use the short licence ("U.S. Government work, public domain", `lib/sources.ts:172`). On slides, keep only the top kicker. | S |
| **"In short" slide looks unfinished.** One point shows top right while the heading is centred on the left. | S30 | `.pz-split { align-items: center }` (`styles/present.css:98`) centres the heading against the full reserved list; points step in one per →. | Top-align the heading with the list (`align-items: start`). For a recap with nothing to predict, consider showing all points at once. | S |
| **Two page quotes side by side in the binary zone:** "Run time is O(ln n). It only performs O(log n) comparisons". The class sees ln vs log as a typo. The line under the chart repeats the question beside it. | S11 | Zone shows several quotes for the beat. | One quote per zone. Drop the "Compare target 27 with 19…" line on the stage (the question says it). | S |
| **Formula is tiny on the Drag predict slide**, and there is a ~650 px gap between the graph and the prediction cards. | S29 | Predict beat layout (`pz-predict-side`). | Typeset formula under the question at heading size; pull the cards next to the graph. | S–M |
| "Passes?" floats ~900 px right of the vote rule it belongs to. | S12, S22 (not exported) | `ThresholdView.tsx:76` (`th-open`). | Put it beside "needs ? of 538". | S |
| Disabled primary buttons look live: dim blue "Next" and "Generate lesson". | S03, S04 (not exported) | `.btn:disabled { opacity: 0.5 }` (`styles.css:323`). | Grey surface + muted text for `.btn-primary:disabled`. | S |
| Tour step 4 says "The summary comes first", but the finished lesson now puts the summary below the activity. | S25 (not exported) | `lib/onboarding.ts:193`. | "Muse writes the summary first". | S |
| The surplus on the balance bars is drawn as a red dashed outline. It reads as an error, more so in light. | S05, S23 | Surplus style, `styles/chem.css:107`. | Neutral hatch with a dark outline. Keep red for failed checks. | S |
| The source pane underlines nearly every sentence in gold (19 quotes on DNA), so the active link loses its signal. | S08 | Part 1 #9, still open. | Faint passive marks; strong colour only for the linked passage. | M |
| The balance activity's "Check my balance" sits on the 1920 fold. | S05 | Row spacing in the balance view. | Tighten the C/O/H row gaps so the buttons land at ~y 900. | S |

## Where we disagree

| Topic | GPT | Opus | Recommendation |
|---|---|---|---|
| Replay after Skip (S04, S28) | First suspected the replay kept running; later corrected this itself (S26, S28: the replay stops). Ranks the after-skip view #1. | Not a timer bug; the issue is the order (#4 above). Rank it below the QHD fill: a judge who skips at step 1 never starts a replay and lands on the at-rest default lesson. | Fix #4 (S effort), but after #1–#3. |
| Drag graph shape visible before the prediction (S17) | A possible leak. | Fine: the class predicts a number and the values are hidden. The shape is the lesson. | Keep. |
| "270" visible in the source pane and Lesson notes under a hidden "needs ? of 538" (S22) | A caution for teachers using lesson view. | Low: lesson view is for preparation, and Present hides it correctly. | Do nothing before the video. Later, maybe collapse Lesson notes while an activity above is unanswered. |
| Source pane takes a third of the width (S05) | Noted as a cost. | Keep it: it is the evidence story. At QHD the problem is the lesson column's cap, not the source share. | Keep the 34% split; fix #2. |

## Quick wins (< 30 min each)

1. Run details opens scrolled to "How Muse revised this lesson" (#3).
2. Skip → at-rest lesson, so hero-first applies (#4).
3. Binary "Show the answer" becomes a secondary button (#5, button part only).
4. pH copy "Each pH unit is ×10" (#6, copy part).
5. Notes-only sentence on held-back lessons (#7).
6. Strip "Students learn that…" in `aiLabel` with a test.
7. Credit dedupe (`figureCredit`); one credit line per slide.
8. `.pz-split` top alignment on "In short".
9. Grey disabled primary buttons.
10. Tour step 4 title.
11. Raise the StageFit cap from 1.9 to ~2.6. The constant is one line, but budget the Δy/oscillation sweep at 1920 and 2560 on top.

## What must be preserved

- **The macOS-style window** in both themes. It floats correctly at 1920 and 2560 (S13, S23).
- **Hero-first lessons** with "Lesson notes" below (S05, S08). Only the after-skip path misses it (#4).
- **Present opens on the hook question** with a one-line credit (S14, S27).
- **The DNA and water-cycle label diagrams** on the page's own figure, with names landing in the printed label slots (S08, S14, S27).
- **R never moves anything**, and → / ← reset revealed answers. GPT confirmed this in the DOM on DNA, pH and vote.
- **Neutral vote cases** ("270 / 269 / 350 electors"): part 1 #2 fixed (S12).
- **The replay strip**: "Replay of a recorded run · 2×/4× speed", the model name, what it is doing and the seconds (S03, S20). This is the clearest Meta contribution on screen.
- **The four-step repair story** with real r1/r2 points and "The mistake was Muse's own, not a planted test fault." (S10).
- **"In short" + "AI-written summary"** on the recap slide: part 2 P11 fixed (S30).
- **"Each step, in the page's words: 'ten times'"** with the page sentence and Show in source (S19). It is the honesty story in one line.
- **Source linking**: a key point lights its sentence in the page (S25).

## Video-moment notes

1. **Record at 1920×1080 CSS pixels.** Do not record a 2560 window and downscale: the 12–14 px UI text drops to ~9 px in a 1080p video. If Calvin films on his QHD monitor, set the browser window (or device emulation) to 1920×1080.
2. **Tour handoff (S26 → S27)** is the best ten seconds: "Lesson ready · 4 Muse Spark 1.3 calls · 2 SAM 3.1 calls" → "Open presentation mode" → "Which part is number 1?" on the water-cycle figure. Keep "Replay of a recorded run" in frame and cut the ~13 s reading phase (S20).
3. **DNA hook slide, then R** (S14): names drop into the figure's own label slots. Fix #1 first, or the figure fills only ~60% of the frame.
4. **Repair story (S10)** after quick win 1. In the drawer it is small, so zoom in during the edit, or show it larger. Say "Muse's own mistake, caught by code, fixed and rechecked".
5. **Balance bars (S05)**: press + on the coefficients and let the C/O/H bars line up. It is a strong silent visual for chemistry. Only the opening frame was captured in this review, so check the balanced end state before filming. Leave out hash (S18) and the held-back pH lesson (S16).

## Evidence register (`docs/evidence/ux-pair/`)

| ID | File | What |
|---|---|---|
| S01 | `S01-first-1366-dark.jpg` | First visit: tour over the loading app (1366, secondary) |
| S05 | `S05-default-1920-dark.jpg` | Default lesson: balance bars first; button on the fold |
| S08 | `S08-dna-1920-dark.jpg` | DNA lesson: full teaching action; how-to below buttons; dense source marks |
| S09 | `S09-repair-1920-dark.jpg` | Run details opens on the run list |
| S10 | `S10-repair-story-1920-dark.jpg` | Repair story with before/after points (two screens down) |
| S11 | `S11-binary-present-2560-dark.jpg` | Binary slide at QHD: empty lower stage; two quotes, ln vs log |
| S13 | `S13-dna-lesson-2560-dark.jpg` | DNA lesson at QHD: 1040 px column, wide gutters |
| S14 | `S14-dna-slide-2560-dark.jpg` | DNA slide at QHD: bottom quarter empty; spread answer grid |
| S15 | `S15-ph-present-2560-dark.jpg` | pH slide at QHD: ×100 labels vs "each step ×10"; empty right and bottom |
| S16 | `S16-heldback-1920-dark.jpg` | Held-back lesson: notes only, not stated |
| S21 | `S21-binary-1920-dark.jpg` | Binary lesson: primary "Show the answer" above the question |
| S23 | `S23-default-2560-light.jpg` | Default lesson at QHD, light: capped column, small type |
| S28 | `S28-skip-1920-dark.jpg` | After Skip: build order, summary first, figure at the fold |
| S29 | `S29-drag-slide-2560-dark.jpg` | Drag predict slide at QHD: tiny formula, gap, empty bottom |
| S30 | `S30-dna-short-1920-dark.jpg` | "In short" slide: AI label right; one point, misaligned |

Not exported but cited (in the scratch `shots/` folder): S02–S04, S06–S07b, S12, S17–S20, S22, S24–S27.

## Not covered

- Keyboard, screen reader, console and motion audits (part 2 covered keyboard and motion on earlier builds).
- Light theme beyond S19 and S23.
- The balance activity's balanced end state, and the Drag reveal at QHD.
- A Δy re-measure at 2560: the stability claims come from GPT's DOM checks at 1920 and part 2's sweeps.
