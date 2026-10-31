# UX review 2026-11-01 — part 2

Reviewer: Claude Opus 5.5 (part 2, continuing the GPT-6.1 Sol review in `ux-review-2026-11-01.md`).
Status: complete (≈90 min box). Report-only: no code, git, config or installs. GET-only against :8787; no generation.

**Verdict in one paragraph.** The three untested decks are stable: R and → never move layout, and the fit zoom never oscillates (5 sizes × 3 subjects). The DNA diagram is the strongest slide in the product. The new problems are content truth and order: the IRS question mixes the single and married columns (P1), quiz options give answers away by form (P5), the overview answers the quizzes before they are asked (P6), and an AI summary is titled "What the page says" (P11). In the lesson, the DNA drag flow works by mouse, drag and keyboard, but loses its ✓ marks after any move (D1) and the written names cover the markers (D2). Section 3 turns part-1 #4, #7, #8 and #10 into file-level changes with exact copy and an annotated mock (26). Section 4 is an 8-shot video plan with URLs that were all opened here; shots 4 and 7 are blocked until #7 and part-1 #2 are fixed.

Scope: uncompleted screens from part 1 (DNA / IRS / pH presentation, DNA drag flow, keyboard, contrast, zoom, motion, empty and error states), concrete design direction for part-1 items #4, #7, #8, #10, and a shot-by-shot video plan.

Evidence: `docs/evidence/ux-review-2/` (JPEG, named `NN-…`). Measurements: `measurements.jsonl` in the same folder, cited as `M:<check>`. GET-only against :8787; no code, git or config changes.

## 1. Presentation mode: DNA, IRS, pH

Jobs: DNA `job-20261031081105-21355f66` (9 beats), IRS `job-20261031023421-facdad1d` (9 beats), pH `job-20261031023145-7a1de630` (8 beats). Deep links `?present=<id>&tour=0&beat=N`, → / R / ← via CDP key events.

### What works

- **R never moves anything.** DNA diagram, IRS table and pH scale: 0 moved elements and an unchanged `.pz-fit-zoom` before vs after R, at 1920×1080 and 1366×768, both themes where measured. [M:reveal-dy-seq, rows dna/irs/ph]
- **DNA diagram beat is the best slide in the three decks.** The real NLM figure, numbered markers, a word bank, and a 1–6 answer grid of dashed `?` chips. It asks one question at a time ("Which part is number 1? Part 1 of 6"). [01–06 from the first run, esp. 03, 04]
- **pH reveal is plain and correct.** "pH 2 → 7 · 100,000 times less acidic · 5 steps of ×10: 10⁵ = 100,000. Computed by our code from the page's factor." [11]
- **IRS reveal shows working.** Each band's line fills in (`12% on $76,000 = $9,120` …), then total and rate. [09]

### New problems (not in part 1)

| # | Problem | Evidence | Fix direction | Effort |
|---|---|---|---|---|
| P1 | **IRS question mixes the two filing columns.** The question asks for tax on **$640,600**, the *single* filer's 37% threshold. The worked answer uses the *married* column (starts at $24,800, last band 35% up to $768,700) and gives $159,268.50. A teacher cannot defend this number in class. | 08, 09 | Lead/content: generate the question from one column and say which ("Married filing jointly, income $640,600"). UI: print the column name next to "Income ($)". | S (copy) + lead |
| P2 | **IRS bracket axis shows band widths as if they were thresholds.** Labels read `$24,80 · $76,000 · $110,600 · $192,150 · $108,900 · $128,150`: not monotonic, and the first label is clipped into the second. | 08 (crop checked at full resolution) | Label the band edges ($24,800, $100,800, $211,400, $403,550, $512,450, $640,600) under the boundaries; put the width inside the bar only after R. Give the first label room or drop it under the hatched "No rate" block. | S |
| P3 | **Stage text is too small at laptop size.** Effective text sizes (font × fit zoom): IRS table 10.7 px at 1366×768 (zoom 0.765) and 15.7 px at 1920×1080; pH ×10 labels 13.2 px at 1366; DNA word bank 16.3 px at 1366. A projector at the back of a room needs ≥ 24 px at 1080p. | M:stage-text-sizes; 12, 13 | Give the IRS engine beat a stage layout like the formula explorer's (`STAGE_LAYOUT`): bracket chart full width, table collapsed to the one column in play, horizontal bars dropped on stage. | M |
| P4 | **Stages leave the bottom quarter empty.** DNA beat box 125,88 → 1670×734 in a 1080 frame; figure 648×648. IRS and pH also stop at y≈800–840. | M:dna-diagram-size; 03, 08, 10 | Fit the hero (figure, ladder, chart) to the height budget. DNA figure can grow to ~860 px tall at 1080p. | S–M |
| P5 | **Quiz options leak answers by form.** DNA Q2 D "Most DNA is located in the cell nucleus" and Q4 B "An important property of DNA is that it can replicate" are copied page sentences beside short invented distractors; pH Q3 C "Water with a pH of **five**" is the only spelled-out number. | 07; beat text dump | Lead/content: a lint in the quiz validator — options of one question must share form (all numerals, similar length ±40%, none a verbatim page sentence). | M (lead) |
| P6 | **Overview spoils the next quiz.** pH overview beat 2 says "on a range from 0 to 14"; Q1 beat 4 asks for the range. DNA overview says "Nucleotides arranged in two long strands" two beats before Q3 asks exactly that. | beat text dump | Order: activity → quiz → overview recap, or drop the overview beat from presentation (keep it in the lesson). | S |
| P7 | **Deck order buries the visual.** pH: Title, Overview, Key terms, Q1, Q2, Q3, **Scale (7/8)**, Sources. DNA diagram is 4/9; IRS table 4/9. | track button list | See section 5 (#8): start on the hero beat. | S |
| P8 | **Numbering clash.** IRS table beat says "Question 1 of 4"; the next track item is also "Question 1". | 08 | Call the engine steps "Case 1 of 4" (pH already says "Case 1 of 2"). | S |
| P9 | **Mixed money format.** `$44,852.50` beside whole dollars; total `$159,268.50`. | 09 | Round to whole dollars on stage unless the page gives cents. | S |
| P11 | **AI summary titled "What the page says".** The overview beat heads Muse's AI-written key points with "What the page says" (DNA beat 2, pH beat 2, IRS beat 2). In the lesson the same points are labelled "AI-written summary". On a slide this reads as a quotation. | 02 (first run); beat text dump | Title it "In short" with a small "AI-written summary" line, as in the lesson. Keep "the page says" for real quotes in `.pz-zone`. | S |
| P10 | **Presenter bar is laptop-sized on a projector.** Track labels 12 px, key hint and counter 13 px, at every viewport. | M (bar fonts); 03 | Fine for the presenter; never show it in the video. Hide with `B`-style toggle or crop. | — |

pH ladder clutter (×10 on every rung beside the cumulative ×10…×100,000 column) is part 1's point; it is worse on stage because both columns sit side by side at 13 px. [10, 11, 13]

Note on `measurements.jsonl` line 1 (`reveal-dy`, moved 10): that was an index-matched diff from the crashed run. R swaps a `?` chip for a value, which shifts indices. The sequence-matched rows (`reveal-dy-seq`) are the valid ones: 0 moved.

## 2. Lesson flows, keyboard, contrast, zoom, motion, error states

### 2.1 DNA label diagram, full manual flow (lesson view, 1920×1080 dark)

Driven through the DOM: real HTML5 drag events (chip → list slot, chip → figure marker, placed name → another slot) and the click path (name, then number). [M:dna-drag-flow]

| Step | Result | Evidence |
|---|---|---|
| Place six wrong names (3 by drag to list, 1 by drag to figure marker, 2 by click) | All paths fill the slot. Check → "0 of 6 right. Move the names marked wrong and check again." Red markers on the figure and red ✕ per row. | 15 |
| Four right, Guanine/Cytosine swapped | "4 of 6 right." The four right names are written into the figure's own printed label boxes. | 16 |
| Drag Guanine from row 6 onto row 5 | **Every row loses its ✓ and the markers go back to neutral**, although the four names stay drawn in the figure. Cytosine drops back to the bank (no swap). | 18 |
| Place Cytosine, Check | "All 6 right." Six names in the figure. | 17 |
| Keyboard: focus "Base pairs", Enter, focus marker 1, Enter | Works. Live region says "Base pairs chosen. Now choose its number on the diagram or in the list." then "Base pairs is on number 1." | M:dna-drag-flow |

Problems:

- **D1. Correct marks vanish after any move.** One drag clears all six results, so the class loses its progress. Keep `right` rows marked until their own name changes (the code comment on `confirmed` already promises this for the figure). [18] Effort S.
- **D2. Written names cover the numbered markers.** Markers 5 and 6 are half hidden behind "Guanine" and "Cytosine"; 3 and 4 touch their names. Checked on a full-resolution crop. The stage has the mirror problem: on the diagram beat's last step ("Now the figure's own labels."), translucent markers 5 and 6 sit on the printed words "Guanine" and "Cytosine". Put the marker above the name (`z-index`) or tuck it to the name box's left edge once named; on the last stage step, fade the markers out. [17, 27] Effort S.
- **D3. Dropping onto a filled slot does not swap.** The old name silently returns to the bank. A swap is what a teacher dragging on a smartboard expects. [M:dna-drag-flow] Effort S.
- **D4. "All 6 right." is a 14 px grey status line under the buttons.** The finish is quieter than the failure state (red markers). Use the same green as the ✓ marks and put it in the card head, e.g. "All six parts named — every name sits on the page's own label." Effort S.
- **D5. The figure is cut at the fold.** At 1920×1080 the figure runs 514→1089 inside a panel that ends ~1045. At 1366×768 only 194 px of the 423 px figure shows. [M:lesson-opening-stack, 24]

### 2.2 Keyboard-only pass (DNA lesson, 1920×1080)

70 Tab presses recorded. [M:keyboard-tab-order; no stop lacked a visible 2 px focus ring.]

- **K1. 33 Tab stops before the first activity control.** Order: theme toggle → 6 rail buttons → source picker → collapse → Original → Credit & key → the source text → **14 evidence `<mark>`s** → Present → receipt → Run details → 4 key points → Key terms → figure markers. Add a "Skip to the activity" link as the first stop, and make the source marks one roving-tabindex group (one Tab stop, arrow keys inside). Effort S.
- **K2. Figure markers come before the word bank.** Keyboard users must Shift+Tab back to choose a name first. Put the bank first in DOM order (the visual order already has it first on the right). Effort S.
- **K3. Good:** every button has a name, rings are visible in both themes, the hidden native `<select>` shows its ring on `.picker-face`, the diagram announces each step.

### 2.3 Contrast spot checks

Automated WCAG ratio over every visible text node, computed against its nearest opaque background. [M:contrast-fails-lesson, M:contrast-fails-stage]

- Lesson (DNA), dark and light: **0 failures**.
- Presentation title, DNA diagram, IRS table, dark: **0 failures**. Light: 3 flags on the presenter bar, all parser artefacts (the bar's background is a `color(srgb …)` value my script read as near-black). Manual re-check: `rgb(51,67,79)` and `rgb(78,96,111)` on ≈`#f1f2f4` are ≈10:1 and ≈6:1. Pass.
- Not covered: text over the figure image, the red/green result marks against the figure (colour is never the only cue there: ✓/✕ glyphs and the status line carry it).

### 2.4 200 % zoom (CSS viewport 960×540, DPR 2)

- **Lesson:** no document overflow, window still floats. But the stacked layout puts the **source page first**: it fills the whole first screen (panel 414 px with its own scroll), and the lesson starts at y=505, below the fold. Two nested scroll areas. [19, M:zoom200-lesson] Fix: in the stacked layout, put the lesson first and start the source collapsed (the collapse control already exists, `readSourceOpen`). Effort S.
- **Presentation:** StageFit cancels the user's zoom. At 200 % the DNA figure is 258 CSS px = 516 device px, **smaller than at 100 % (648 px)**, while the key-hint strip doubles. [20, M:zoom200-present] Fix: let StageFit's floor follow `devicePixelRatio`, or fit to device pixels. Effort M; low priority.

### 2.5 Motion stability

90 rAF frames of `.pz-fit-zoom` plus a layout checksum, per size (1280×720, 1366×768, 1500×820, 1592×815, 1920×1080), foreground tab. [M:zoom-oscillation]

- DNA diagram, IRS table, pH scale: **1 distinct value at every size. No oscillation.**
- Stepping inside an engine beat (R, then → to part/case 2): DNA and IRS 0 moved elements. pH 13 moved, all `ll-total` cumulative labels that belong to the new interval (content, not layout). [M:step-next-dy-seq]

### 2.6 Reachable empty and error states

| Link | Result | Evidence |
|---|---|---|
| `?present=ux-review-missing` | Silently opens the default radioactive-waste lesson in the workspace. No notice. | 21 |
| `?replay=ux-review-missing` | Same silent fallback. | 22 |
| `?present=<DNA>&beat=99` | Clamps to 9/9 (Sources) and rewrites the address. Fine. | 23 |
| Runs "This page" with zero runs, subject filter with zero runs | **Not reachable** with this data: every one of the 99 sources has at least one of the 724 runs (GET `/api/sources`, `/api/jobs`). The copy exists in `PipelinePanel.tsx` ("No runs for this page yet.", "No {subject} runs yet."). | M:empty-runs-reachability |

Part 1 found the same silent fallback for `?job=`. All three link kinds need one shared notice: **"That saved lesson was not found. Showing the library instead."** with a "Choose a lesson" button that opens Runs → All pages. For the video this matters: a typo in a deep link records the wrong lesson without warning.

## 3. Design direction for part-1 items #4, #7, #8, #10

Annotated mock: [`mock-design-direction.html`](../evidence/ux-review-2/mock-design-direction.html) (needs Vite on :5173 for the figure) and its capture **26**. It uses the app's dark tokens and the real NLM figure. The before/after dots in panel B are the stored points from `label-diagram-v1.r1.json` and `r2.json`, mapped onto the figure.

### #4 · A complete teaching action above the fold

Measured today at 1366×768 (lesson panel 614 px, top y=83): title 36 px, provenance 75 px, overview 157 px, first card at y=420. DNA figure 503→926, so 194 of 423 px show. The pH ladder starts at y=1639, behind a 1060 px quiz card. [M:lesson-opening-stack, 24]

| # | Change | Where | Copy / size |
|---|---|---|---|
| 4a | **Hero part first.** Stable reorder: the first part whose kind is premium, `formula-explorer`, `label-diagram`, `log-ladder`, `threshold`, `algorithm-trace`, `data-table`, `balance-equation` or `compare-table` moves to index 0; the rest keep plan order. Apply it in the deck too (#8). | New pure `heroFirst(items)` in `lib/lesson.ts`, called on `lessonItems(...)` output in `LessonView.tsx`. Test: pH plan `[quiz-cards, log-ladder]` → `[log-ladder, quiz-cards]`. | — |
| 4b | **Overview moves under the hero as "Lesson notes"**, open, linking unchanged. Nothing is hidden, only reordered. | `LessonView.tsx` line 200: render `OverviewView` after `items[0]`. In `OverviewView.tsx` the sr-only "Page overview" heading becomes a visible `h3` "Lesson notes" (16/600). | "Lesson notes" |
| 4c | **Provenance in one sentence.** Same facts: model, publisher non-endorsement, code check, repair. 2 lines at 1366 instead of 3. | `Provenance.tsx` `prov-line`; `CHECKED_SENTENCE` in `lib/provenance.ts`. | "Written by Muse Spark 1.3 (Meta) from MedlinePlus Genetics, which has not reviewed or endorsed it. Code checked its quotes and numbers against the page. 1 part revised after a failed check — **see how**." (link opens #7) |
| 4d | **The card asks first.** One 16 px ask line under the card's meta line. The how-to moves out of the grey status line, which then shows only results. | Each hero view's header: `LabelDiagramView` (`ld-status` text today), `LogLadderView`, `ThresholdView`, `AlgorithmTraceView` (question block moves above the controls). | Label diagram: "Name the six numbered parts." + 14 px muted "Drag a name onto a number, or pick a name, then a number." · Log ladder: "pH 2 → 7: how many times more or less acidic?" · Trace: its existing first question. |

Expected result at 1366×768: first card y≈234 (−186 px), DNA figure ≈314→737, about 380 of 423 px visible; pH ladder ≈y 330 instead of 1639. These are estimates from the measured heights, to be re-measured after the change. The mock shows the same order (panel A, fold line at 614 px). [26]

### #7 · The repair story, readable without the transcript

Today the DNA job's drawer says "Natural repair (Muse's own mistake)" and "Each part point is valid and off its printed label", twice, as red then green text. [25] The real story is better than that: Muse's first version put the Adenine, Thymine, Guanine and Cytosine points **on the figure's printed label boxes**; check LD-04 failed; the repair moved each point onto its bar (e.g. Guanine 630,515 → 640,502; its printed box is 590–712 × 507–540 in 0–1000 units); `repair.no-weakening` passed. [stored `label-diagram-v1.r1.json` / `r2.json` / component report; 26 panel B]

| Row | Copy (exact) | Source of the words |
|---|---|---|
| Heading | "Label the diagram · revised once by Muse" ("revised twice" for 2) | `componentRepairs[].attempt` |
| Sub-line | "A code check failed on Muse's first version. Muse fixed it; nothing was loosened." | `passed` + `repair.no-weakening` passed |
| What the check found | "4 of 6 points sat on the figure's printed labels, not on the parts." | Count r1 points inside `figure.labelBoxes` (LD-04). Other checks: their existing plain name. |
| What Muse changed | "Moved Adenine, Thymine, Guanine and Cytosine onto their coloured bars." + before/after crops (red = first version, green = after) | r1 vs r2 points. Text parts keep today's `diff-list`. |
| Result | "✓ All 11 diagram checks pass, and all 37 lesson checks pass." | component report + receipt |
| Footer | "The mistake was Muse's own, not a planted test fault. Muse Spark 1.3 · $0.025 est. · Technical details ▸" | existing fault-origin + cost |

- Rename the label in `lib/analysisRepairs.ts` (`ANALYSIS_REPAIR_LABEL`), `lib/provenance.ts` line 143 and `lib/lessonJob.ts` (`NATURAL_FAILURE_LABEL`): "Revised by Muse after a failed check" / "Muse's revision did not pass — this part is withheld". System-made faults keep their purple `--fault` wording. Fault-origin honesty stays as the footer sentence.
- Fix the part-1 leak: in `AnalysisRepairTimeline.tsx` line 73 and `ComponentRepairTimeline.tsx` line 60, the "Checker said" span has no `tech` class; neither has a bare `check-code` when `name === id` (lines 21, 71, 110). Add `tech` to both.
- **Blocker for the visual:** `GET /api/jobs/:id` returns only the latest spec per part (`kitSpecs` has `label-diagram-v1:r2` only). The before/after needs r1. Lead-owned API change: add the earlier revision of each repaired part (read-only, already on disk under `storage/runs/<job>/`). New pure `repairStory(r1, r2, report)` in `lib/` with tests; the view only draws it.

### #8 · Presentation opens on a hook

Today every deck opens on Title (headline + page/from/licence + disclosure) and the visual is beat 4 (DNA, IRS) or 7 (pH). [P7, 01 from the first run]

- **S, do before recording:** `heroBeatIndex(beats)` in `lib/presentation.ts` = first beat of kind `engine`, `predict`, `stage` or `compare`. The lesson's Present button, the rail's Present and a `?present=<id>` link **without** `&beat` start there (`App.tsx` `presenting.beat`). Title stays reachable with ← and Home. Add one `.pz-credit` line under the hero beat (20 px on stage): "Draft · needs teacher review · AI-written with Muse Spark 1.3 (Meta) · from What is DNA?, MedlinePlus Genetics (U.S. Government work)". The disclosure is then on the first slide shown.
- **M, the full deck:** `planBeats` order becomes Hook → hero steps → other parts (quizzes) → "In short" (the AI summary, P11) → Key terms → Sources. This also stops the overview answering the quizzes before they are asked (P6). The hook is the hero beat's step 0 with a kicker line ("What is DNA? · MedlinePlus Genetics") and one question in 34 px on stage; → goes to "Which part is number 1?" with the figure in the same box, so nothing jumps. [26 panel C]
- Hook copy is UI template text, not new AI text: label diagram "This figure has {n} numbered parts. Can the class name them?"; log ladder "pH {a} → {b}: how many times more or less acidic?"; trace, table, threshold, explorer reuse their first case question.
- Fit the hero to the height budget (P4): the DNA figure can grow from 648 to ≈860 px at 1080p.

### #10 · Prediction feedback in one plain voice

Three wordings exist for the same grade today: the lesson card ("Not close enough — your guess was too low · off by 375 N (allowed ±367.5 N)", `PredictionCards.tsx` 74–78), the activity header ("Prediction 1: not close enough / you guessed … the engine gives …", `ActivityView.tsx` 122–127), and the stage verdict ("Off by 375 N / Too low", `predictVerdict` in `lib/presentation.ts`). Part 1 saw the duplication. [part 1 E49]

One pure `feedbackCopy(grade, unit)` in `lib/` feeds all three. Three tiers; "near" means outside the margin but within twice it.

| Tier | Lesson headline | Lesson line | Stage headline | Stage detail |
|---|---|---|---|---|
| within | "✓ Within the margin" | "You said 18,300 N · the calculation gives 18,375 N." | "Within the margin" | "Class said 18,300 N" |
| near | "Very close" | "You said 18,000 N · the calculation gives 18,375 N · 375 N low, just outside ±368 N." | "Very close — 375 N low" | "Class said 18,000 N · margin ±368 N" |
| off | "375 N too low" | "You said 15,000 N · the calculation gives 18,375 N." | "3,375 N too low" | "Class said 15,000 N" |

- Delete the activity header's `last-result` block; the card's own line stays next to the input.
- Tolerance note (`PredictionCards.tsx` 71) becomes "Within 2% counts as right." with the "or ±X, whichever is larger" rule in a `title` or the hint.
- "Students learn…": strip a leading "Students learn (that|how)" from AI key points and slide titles in `aiLabel`/`displayText` (test-covered; meaning unchanged), and ask the lead to fix the prompt for new lessons. IRS overview shows it today ("Students learn the 2026 standard deduction amounts differ…"). [beat text dump, IRS beat 2]

## 4. Three-minute video, shot by shot

Recording setup for every shot: Chrome 1920×1080, dark theme, `?tour=0` on every link except shot 3, pointer parked off the presenter bar so it fades, `F` for full screen in presentation. GET-only stored runs; nothing generates live. All links below were opened in this review. [M:video-deck-beats]

| # | Time | URL and steps | On screen / voice-over | Fix first |
|---|---|---|---|---|
| 1 | 0:00–0:15 | `?present=job-20261031081105-21355f66&tour=0&beat=4`. Pause 2 s on "Which part is number 1?", press R, → , R. | The real NLM figure; names drop into the figure's own label boxes. VO: "This is a government page about DNA. The class is labelling its own figure." | **Must:** D2 (names cover markers — check on stage too). Nice: P4 bigger figure; #8-S credit line. |
| 2 | 0:15–0:35 | `?job=job-20261031081105-21355f66&tour=0`. Hover a key point, then a source mark. Scroll the lesson once. | Teacher view: page left, lesson right, a key point lights its sentence in the page. VO: "A teacher picks a licensed page. Muse Spark writes the lesson; code checks every quote and number against the page." | **Must:** #4 (figure above the fold, else this shot is all text). Nice: 4c one-sentence provenance. |
| 3 | 0:35–1:10 | `?replay=job-20261031081105-910f3776&speed=4&tour=0` (or the scripted `?tour=1&speed=4`, ≈35 s). Keep "Replay of a recorded run" in frame. | Water-cycle build: Muse reading → parts planned → SAM 3.1 outlining the figure → checks → "Lesson ready" with real counts (4 Muse calls, 2 SAM calls, 1 min 22 s per part 1). VO names both Meta models and says "recorded run". | Must: none (works today; verified replay label and "Lesson ready"). Record at 1920 (part 1: sketches fall below the fold at 1366). Do **not** call it live. |
| 4 | 1:10–1:35 | DNA lesson → Run details → the repair card. | Before/after dots on the figure: "4 of 6 points sat on the printed labels… moved onto their bars… nothing was loosened." VO: "When Muse gets something wrong, code catches it and Muse fixes it — with the evidence." | **Blocking:** #7 (needs r1 via GET + `repairStory`). Fallback: cut the shot; today's drawer (25) reads as a transcript. |
| 5 | 1:35–2:05 | `?present=job-20261031105047-d97bab36&tour=0&beat=4` (Algorithm). Ask, class votes, R, →. | Binary search: "The middle item is 19. Where does the search for 27 go next?" → the range halves. | Must: none. Nice: hide bar. |
| 6 | 2:05–2:25 | `?present=job-20261031023145-7a1de630&tour=0&beat=7` (Scale), R. | pH 2 → 7: "100,000 times less acidic", 10⁵ worked out. VO: "Chemistry…" | Nice: P3/P4 (ladder is small, bottom quarter empty); part-1 ladder clutter. |
| 7 | 2:25–2:45 | `?present=job-20261031101734-fca565b7&tour=0&beat=6` (Vote). Class picks, R. | Electoral College threshold: one vote decides. VO: "…and civics." | **Must:** part-1 #2. Confirmed on this job: the cases read "Just below required majority" and "Meets required majority" before R. [M:vote-leak] |
| 8 | 2:45–3:00 | `?present=job-20261031081105-21355f66&tour=0&beat=9`, then end card. | "All 37 checks passed · all 19 quotes found on the page · Draft · needs teacher review". End card: product name, "Muse Spark 1.3 · SAM 3.1", event name in text (no Meta logo). | Must: none. |

Leave out: IRS (P1 mixes filing columns, P2 axis), the creation drawer (part 1 #5), anything at 1366.

Fix order for the video, by shots unblocked: (1) part-1 #2 vote labels (S, shot 7); (2) D2 marker overlap (S, shots 1–2); (3) #8-S start on the hero + credit line (S, shot 1); (4) #4 hero-first + Lesson notes (M, shot 2); (5) #7 repair story incl. API r1 (M + lead, shot 4); (6) P4 hero fit (S–M, shots 1, 6).

## 5. Part-2 summary: the ten things to do, in order

1. Neutral vote-case titles (part 1 #2) — blocks shot 7. S.
2. Written names must not cover diagram markers (D2). S.
3. Present starts on the hero beat with a one-line credit (#8-S). S.
4. Hero part first + "Lesson notes" + one-sentence provenance (#4). M.
5. Repair story with before/after points; label "Revised by Muse"; tech-gate checker text (#7). M + lead API.
6. IRS question must use one filing column, and the axis must show band edges (P1, P2). S + lead.
7. One feedback voice (#10). S–M.
8. Keep ✓ marks after a move; swap on drop; louder finish (D1, D3, D4). S.
9. Missing-lesson notice for `?job`, `?present`, `?replay` (2.6). S.
10. Quiz option form lint and overview-after-quiz order (P5, P6), "In short" for the AI summary (P11). M (lead) + S.

## Evidence register (part 2)

All in `docs/evidence/ux-review-2/`. 01–06 come from the crashed first run of this review (not re-captured).

| ID | File | What |
|---|---|---|
| 01 | `01-dna-present-title-dark-1920.jpg` | DNA title slide |
| 02 | `02-dna-present-overview-dark-1920.jpg` | "What the page says" over AI summary (P11) |
| 03 | `03-dna-present-diagram-ask-dark-1920.jpg` | DNA diagram beat, ask |
| 04 | `04-dna-present-diagram-reveal1-dark-1920.jpg` | Part 1 revealed |
| 05 | `05-dna-present-diagram-step3-dark-1920.jpg` | Part 3 |
| 06 | `06-dna-present-diagram-reveal-light-1366.jpg` | Reveal, light laptop |
| 07 | `07-dna-present-quiz4-leak-dark-1920.jpg` | Option copied from the page (P5) |
| 08 | `08-irs-present-table-ask-dark-1920.jpg` | IRS table beat, ask (P1, P2) |
| 09 | `09-irs-present-table-reveal-dark-1920.jpg` | IRS reveal, $159,268.50 (P1, P9) |
| 10 | `10-ph-present-scale-ask-dark-1920.jpg` | pH scale, ask |
| 11 | `11-ph-present-scale-reveal-dark-1920.jpg` | pH reveal |
| 12 | `12-irs-present-table-ask-light-1366.jpg` | IRS at laptop size, 10.7 px text (P3) |
| 13 | `13-ph-present-scale-ask-light-1366.jpg` | pH at laptop size |
| 14 | `14-dna-lesson-placed-dark-1920.jpg` | Six names placed (drag + click) |
| 15 | `15-dna-lesson-checked-dark-1920.jpg` | 0 of 6 right |
| 16 | `16-dna-lesson-partial-dark-1920.jpg` | 4 of 6 right, names written into the figure |
| 17 | `17-dna-lesson-all-right-dark-1920.jpg` | All 6 right; markers 5/6 covered (D2) |
| 18 | `18-dna-lesson-after-move-dark-1920.jpg` | ✓ marks lost after one move (D1) |
| 19 | `19-zoom200-dna-lesson-light.jpg` | 200 %: source fills the first screen |
| 20 | `20-zoom200-dna-present-dark.jpg` | 200 %: stage figure shrinks |
| 21 | `21-present-missing-dark-1920.jpg` | `?present=` missing → silent default lesson |
| 22 | `22-replay-missing-dark-1920.jpg` | `?replay=` missing → same |
| 23 | `23-beat-99-dark-1920.jpg` | `&beat=99` clamps to Sources (closing slide) |
| 24 | `24-dna-lesson-opening-dark-1366.jpg` | DNA lesson opening at 1366 (fold) |
| 25 | `25-dna-repair-drawer-dark-1920.jpg` | Today's repair drawer for the DNA job |
| 26 | `26-mock-design-direction.jpg` | Annotated mock (from `mock-design-direction.html`) |
| 27 | `27-dna-present-final-labels-dark-1920.jpg` | Stage last step: markers 5/6 on the printed words (D2) |
| M | `measurements.jsonl` | All `M:<check>` rows |

## Not covered

- Screen reader pass (only DOM names and live-region text were read), touch/smartboard drag (synthetic HTML5 drag events only), and real projector viewing.
- Light theme for the DNA drag flow; IRS and pH lessons' own (non-presentation) flows beyond part 1.
- A truly empty library or a provider error: not reachable GET-only (2.6).
- Detector: `impeccable detect --json apps/web/src apps/web/index.html` re-run at the end: exit 0, `[]`. It does not cover the rendered issues above.
