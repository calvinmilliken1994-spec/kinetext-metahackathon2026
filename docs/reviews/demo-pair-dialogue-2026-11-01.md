# Demo walk-through pair review — dialogue (append-only)

Participants: GPT-6.1 Sol (walks the demo, captures, comments) and Claude Opus 5.5 (reviews the screenshots, replies, asks for captures).
One block per message, appended at the end, never edited afterwards:

## [GPT D03] short title
screenshot: shots/D03-name-1920-dark.png
what I see / what I think ...

## [OPUS re D03] short title
agree / disagree / add ... ; REQUEST: (optional) a capture GPT should take next

End markers: GPT writes `## [GPT DONE]` after its last screen; Opus then writes the joint report and `## [OPUS DONE]`.

## [GPT D01] Tour opening
screenshot: shots/D01-tour-start-1920-dark.png
Clear copy and calm chrome. The popover is quite small for video. First visit retained the previously selected photosynthesis lesson behind the scrim, not a neutral start. Not broken, but the water-cycle story has not started yet.

## [OPUS re D01] Tour opening
Agree the card reads cleanly and the chrome is calm. Small disagreement on "retained the previously selected lesson": the lesson behind the scrim is the app's opening lesson (first library page via `resolveRunLink`, `App.tsx:132-145`), not memory of an earlier visit. It is the at-rest photosynthesis balance view, which is the right first impression. Last review's "tour over an empty Loading… app" is fixed and holds: source pane, checks line and Present are all loaded (`tourReady`, `lib/onboarding.ts:40`).
On size: the card is `min(380px, …)` with 16 px body and 14 px count/Skip (`styles/onboarding.css:15,20,23,29`). At 1920 in a 1080p video that is readable but small next to the 26 px lesson title. A cheap fix is a 420-440 px card with 18 px body at >=1600 px wide. Effort S. Not a blocker.
Missed: the header behind the card says "Teacher review pending" on the opening lesson. A judge's first frame then carries a caution word. Worth checking whether the demo should open on a reviewed lesson, or label this one neutrally. Also the welcome card sits right over the balance bars, so the hero is half-hidden for this step. That is fine for a centred welcome card.
REQUEST: none yet. Please keep going with the replay steps (reading → overview with shimmer → checking → ready), one capture per step at 1920.

## [GPT D02] Pick a page
screenshot: shots/D02-tour-picker-1920-dark.png
Agree with opening-state correction. The source picker and New lesson get a precise outline. Step copy explicitly says recorded and free, which is honest. Small text is still the video risk. One screenshot timed out; recovered with Page.bringToFront.

## [GPT D03] Reading replay
screenshot: shots/D03-tour-reading-1920-dark.png
Model name, replay label and 2× speed are explicit. Breathing dot and shimmer exist; no fake percentage. The scrim makes shimmer faint. Large black area while reading is the weakest build frame; the source fills the left pane while the main stage mostly waits.

## [GPT D04] Summary arrives
screenshot: shots/D04-tour-summary-1920-dark.png
This is much stronger than the empty reading stage. Four concise points arrive, source sentences underline, placeholders show planned diagram and sequence. Problem: the card cuts into the emerging diagram and the actual build sits below the fold. A 1080p viewer mostly sees summary text at this moment.

## [GPT D05] Check and repair
screenshot: shots/D05-tour-parts-1920-dark.png
Auto-scroll fixes my below-fold concern for this step. Excellent model attribution: Muse rewriting, SAM outlined 5/5. But the hero remains a blank rectangle labelled The page’s figure, so SAM’s contribution is text, not visible outlines during repair. Check wording is technical and awkward: each part point is valid and off its printed label.

## [GPT D06] Student activity (step 7)
screenshot: shots/D06-tour-ready-1920-dark.png
Replay completed and auto-advanced to step 6; my Next reached step 7. Strongest tour image so far: vivid real figure, blank labels, obvious matching interaction. SAM outlines are not visible at rest. I will Back to capture step 6 too.

## [GPT D07] Ready to teach (step 6)
screenshot: shots/D07-tour-checks-1920-dark.png
The strip cleanly closes the story: time, four Muse calls, two SAM calls, checked, cost, Present. Copy says ready to teach but the lesson still says teacher review pending. Keep the caution honest; do not remove it merely for a cleaner demo. Stronger wording could be Ready for teacher review.

## [GPT D08] Presentation handoff
screenshot: shots/D08-tour-present-1920-dark.png
Step 8 clearly explains the core teaching move. All eight steps reached. No misalignment or clipping in the popovers. Next I follow the actual handoff, not a direct URL.

## [GPT D09] Water-cycle hook
screenshot: shots/D09-water-hook-1920-dark.png
Presentation opens straight onto a useful question, not a title slide. Readable large question and good image scale. Actual faint SAM rectangles visible around regions now; not self-explanatory without narration. The upper attribution says AI-written but not Muse or SAM. Meta attribution is weaker in the strongest teaching frame than in the build.

## [OPUS re D02-D05] Picker, reading, summary, checking
Correction to my D01 note: "Teacher review pending" is on every lesson by design (`lessonStatusLine`, `lib/partOrder.lesson.test.ts:56`). It is an honesty line, not a defect. Drop it.

D02 agree. Both cut-outs are exact, the card sits clear of them, and "It costs nothing" is the right honesty line. No regression.

D03 agree it is the weakest build frame. What I see: strip at "0 s", "No call finished yet", three shimmer bars and ~700 px of black below. Missed: the card sits LEFT of the strip, on top of the source pane's title and first paragraph, which is the very thing Muse is "reading". Cause: the reading step targets only the strip (`lib/onboarding.ts:208`), so `placeCard` (`:349`) tries right (no room), then left (free), and lands on the source pane. Fix (S): add `[data-tour="source-text"]` as a second target on the reading step. Then left is blocked and the card drops "below" the strip into the empty lesson column, where it fills the dead space instead of hiding the page. For the video: this phase is ~10-25 s of wall time even at 2x. Film with `?tour=1&speed=4`, or cut it with the seconds counter in frame so the jump is honest.

D04 agree on both points. Adding: only 1 of the 12 lit source sentences is above the source pane's fold ("Evaporation is the change…" at y~780), so "those sentences light up in the page on the left" shows one underline. The card is placed "below" the overview cut-out and covers the diagram frame's header and reason text. Fixes: (a) S: when the overview lands in a replay, scroll the source pane so the first lit mark sits near its top (`revealInPanels`, `lib/scroll.ts`), so 3-4 lit lines show. (b) S: in `placeCard`, for side "below", align the card to the target's RIGHT edge (`clampX(target.x + target.w - card.w)`), so it covers the sketch's right column, not the frame title and Muse's reason.

D05: GPT has not written this block yet, but the shot is there, so a first read. This is the strongest build frame so far: "Written in 24.5 s · 5,434 tokens", "SAM 3.1 outlined 5 of 5 parts in 1.9 s", red x "1 check failed", "reworking it as revision 2", strip "1 min 1 s · 2 Muse Spark 1.3 calls done · 1 SAM 3.1 call". It tells the Meta story in one frame. Two problems:
1. The failed-check text is jargon: "each part point is valid and off its printed label" (`lib/lessonJob.ts:472`, LD-04). A judge cannot parse "part point" or "off". Fix (S): "Each number sits on its part, not on the printed label". Also check LD-06 "part point".
2. The sketch shows a grey box captioned "The page's figure" (`components/LiveBuild.tsx:225`) right after SAM outlined 5 parts. The real figure is the page's own image, not a generated one, so showing it here (dimmed, no labels) would make the SAM step visible. Effort M: the figure id must be known before the part passes. Worth checking if the plan or the source carries it.

REQUEST: the frame where the reworked label diagram ARRIVES (revision 2 passed, markers and SAM outlines drawing in), 1920 dark, taken in the same poll that sees "checks passed" (no sleep before capture). Plus one frame ~1 s later. This is the spec's best visual beat and the likely video hero.

## [GPT D10] Water reveal
screenshot: shots/D10-water-reveal-1920-dark.png
R reveals the label and one source sentence in a stable reserved bottom band. No visible jump. This is a strong teaching frame. The used label is struck through, which reads as unavailable rather than incorrect in this context.

## [GPT D11] End and Back
screenshot: shots/D11-water-back-1920-dark.png
Walked all water beats and diagram substeps to Sources, then Left. Text log: water-slides.json. Back lands on Key terms with ALL meanings visible (screenshot), despite conceal-on-Back requirement. Needs checking: R on key terms then next/back may preserve the end-of-beat reveal. Request received: replay arrival captures next. Also supplied DNA job id is actually the water-cycle job; will locate DNA from GET /api/jobs, preserving the supplied token.

## [GPT D12-D13] Requested arrival and settled frame
screenshot: shots/D12-diagram-arrival-1920-dark.png
screenshot: shots/D13-diagram-settled-1920-dark.png
D12 captured in the poll that first saw revision 2 and 11/11. Markers are still absent while drawing in. D13 is settled (later than requested 1 s because tool round-trip intervened). Major video weakness: after Replay again outside the tour, the figure arrives mostly BELOW the viewport. The tour auto-scroll gave a much better frame. No generation used.

## [GPT correction] DNA identifier
The supplied DNA identifier IS correct. I incorrectly inferred it was water from the matching timestamp. GET /api/jobs confirms job-20261031081105-21355f66 is medlineplus-what-is-dna. Will use exactly the requested URL.

## [GPT D14-D15] DNA hook
screenshot: shots/D14-dna-hook-1920-dark.png
screenshot: shots/D15-dna-hook-1920-dark.png
D14 is transient Connecting after hard navigation, not the loaded view. Loading has no obvious continuous main-stage cue. D15 is loaded: excellent readable diagram and question. White figure against dark stage looks intentional, not AI-generated. All answers hidden.

## [GPT D16] DNA reveal and full walkthrough
screenshot: shots/D16-dna-reveal-1920-dark.png
R is clear and stable. Walked every diagram substep and all four quiz slides through Sources, then Left: Key terms again returns fully revealed (meaning 5 of 5). Text log dna-slides.json. No overflow seen in DOM, but only hook/reveal were screen-captured. Run details contains a natural revision story. It explicitly says The mistake was Muse’s own, not a planted test fault, contradicting the standing safer wording.

## [OPUS re D05-D11] Repair, ready, try, present, water slides
D05 agree on both points (my first read above has the causes: `lib/lessonJob.ts:472` LD-04 wording; `components/LiveBuild.tsx:225` plain plate). Note the plate is a deliberate choice (`lib/liveBuild.ts:121`: "the plan names no figure"). A cheap middle way: when the source page has exactly one figure, show it dimmed in the plate. The figure is the page's own, so nothing is simulated.

D06/D07 agree: the closing strip is the best Meta frame in the product. "Lesson ready · built in 1 min 22 s / 4 Muse Spark 1.3 calls · 2 SAM 3.1 calls · every part checked · $0.144 est." plus the part trace "Written 24.5 s — SAM 3.1 1.9 s — 1 check failed — Revision 2 · 20.9 s — SAM 3.1 0.8 s — 11/11 checks". On "Ready to teach" vs "Teacher review pending": agree there is a clash, and agree the caution stays. I would retitle the tour step, not the lesson: "Built and checked" (`lib/onboarding.ts:225`). "Ready for teacher review" is also fine. S.
D06 (step 7): agree it is the strongest still image. Small add: the body says "Parts ask for a prediction first", but this part is a drag-and-name task. Word it for the part on screen, e.g. "Name the numbered parts, then press Check. Answers stay hidden until you do." Same file, `:231`. S.

D08 agree. No issue.

D09 mostly agree. The fit is much better than last review (figure ~780x690 px of a ~1080 stage; the old 60% under-fill is fixed, no regression). On Meta attribution in slides: agree, and it is a real gap. There is no model name anywhere in presentation mode (grep of `components/presentation/*` and `lib/presentation.ts` finds none). The kicker says "AI-written, teacher review pending". Fix (S): name the model in the kicker on the title and Sources beats only ("Written by Muse Spark 1.3 · figure parts found by SAM 3.1"), not on every slide; students do not need it on each question. On the faint SAM rectangle around region 1: agree it reads as a selection box. It is the focused part's outline. Leave it.

D10 agree it is stable and strong (quote band reserved, nothing moved). Disagree on the strike-through: the chip is used, not wrong, and a struck word in the bank is the usual "already placed" signal. Low priority. If changed, dim it and drop the dashed border, keep it readable.

D11: I think this is by design, not a bug. `presentReducer` 'prev' (`lib/presentation.ts:551`) lands on the previous beat's LAST step, like slide software showing a build slide fully built when you go back. The conceal rule in the spec is for ← from a reveal WITHIN a beat (`:549-550`). For Key terms that is fine (it is a recap). Where it could hurt is ← into a quiz or predict beat from the next beat: the answer is already shown. Not a video issue. I would leave it and note it. The slide itself: big, readable terms; bottom ~25% empty above a divider rule that has no quote (the reserved zone). Minor.

D12 (no GPT block yet, first read): this is NOT the arrival frame I hoped for. The strip already says "Lesson ready", the figure has no markers yet, and the figure is cut by the fold at y~1000. So the part arrives at the very end of the run, and its draw-in (markers at 380 ms + 150 ms each, regions over 2.2 s, `styles/live.css:200-201`) plays while the figure is half below the fold; the follow-scroll comes after (D07 shows it scrolled). If that holds, the best motion beat of the build is missed in a recording.
REQUEST (replaces my earlier one): replay `?replay=job-20261031081105-910f3776&speed=2&tour=0` at 1920 dark. In the same poll that first sees "Lesson ready", capture, then capture again at +0.8 s and +1.6 s (no other waits). I want to see if the markers and SAM outlines draw in view or off-screen.

## [GPT D17] DNA repair story
screenshot: shots/D17-dna-repair-1920-dark.png
Best technical-depth moment: red/green before-after points on a real figure, four short stages, no raw ids. But the right drawer is only ~420 px and makes both the story and the teacher lesson tiny in video. Prefer a focused capture of this evidence, not a whole-screen long dwell.

## [GPT D18] Capture correction and request budget
screenshot: shots/D18-dna-lesson-1920-dark.png
D18 duplicates D17 because my close selector was wrong, not an app defect. Actual Close panel (Esc) discovered. Will capture your requested three completion offsets next, then reserve the remaining screenshot quota for balance, binary, drag, new lesson, Skip and QHD key frames. Disagree slightly on Back: standing product instruction explicitly says answers hidden again after Back; current recap behavior is understandable but narrower than that contract. Not a video priority.

## [GPT D19-D21] Precise direct-replay completion
screenshot: shots/D19-arrival-1920-dark.png
screenshot: shots/D20-plus08-1920-dark.png
screenshot: shots/D21-plus16-1920-dark.png
Direct URL behaves BETTER than Replay again. D19 already auto-scrolled diagram into view, temporarily vertically clipped by draw-in. D20 and D21 show the entire diagram, all five markers and blue outlines. No offscreen hero here. D12’s below-fold issue is specific to Replay again after exiting presentation, not direct replay. All three images inspected. Offsets include screenshot-tool latency, not frame-accurate timing.

## [GPT D22] Photosynthesis balanced
screenshot: shots/D22-balance-1920-dark.png
Pressed + five times each on CO2, H2O, O2. Correct 6:6:1:6, equal bars and green feedback fit above fold. Excellent video interaction. IMPORTANT content risk below fold: checked compare table says chemosynthesis products are Glucose and hydrogen sulfide. This matches the source’s own apparent discussion-answer error, but contradicts its reaction equation, where hydrogen sulfide is a reactant. A quote match cannot guarantee science. Do not show that table as an accuracy success.

## [GPT D23-D24] Binary search
screenshot: shots/D23-binary-1920-dark.png
screenshot: shots/D24-binary-loaded-1920-dark.png
D23 was another transient load; my readiness test matched hidden picker options too early. D24 is loaded and clear. Good bar heights and mid/lo/hi labels. Question and controls fit. The source excerpt under the ARRAY trace instead talks about a LINKED LIST, a weak explanatory match even though it is a true quote. No answer spoiler.

## [OPUS re D12-D21] Arrival, DNA slides, repair story
Thanks for D19-D21; they answer my question. Follow-scroll works: at the first "Lesson ready" poll (D19) the column has already moved the part under the strip and the content is mid-reveal (clip at y~760). At +0.8 s (D20) all five markers are in. So D12/D13 (after "Replay again" outside the tour) are the odd case. Likely cause: `useFollowBuild` (`components/LiveBuild.tsx:362-405`) stops for good on the first wheel/pointer in the column (`userMoved`), and the ref survives "Replay again" if the view does not remount. If GPT scrolled or clicked in the column before pressing Replay again, follow stays off. Fix (S): reset `userMoved`/`seen` when the replay restarts (key the hook on the replay start time). For the video it does not matter if Calvin films a fresh `?tour=1` load.

New finding from D20, zoomed (figure crop 740-1340 x 330-850): the SAM regions are thin 1.5 px blue boxes at 45% opacity (`styles/engines-c.css:72-73`, `--ld-region` `:19`), peaking at Meta blue `#0064e0` during the draw (`styles/live.css:201,216`). On a sky-blue figure they almost vanish; region 2 is a sliver. In a 1080p video the SAM step is effectively invisible, which is half of the Meta story on this frame. Fix (S): during the build draw only, stroke 2.5-3 px with a white inner line and a dark outer shadow (reads on any figure), plus a 12-15% fill tint, then fade as now. No layout change, so no Δy risk.

D14 agree: a cold `?present=` load shows "Loading pages… / Select a page. / Loading…" with no cue. Not a video problem if Calvin opens Present from the button. Low priority.

D15/D16 agree: strong, readable, stable, answers hidden before R. Adds: (a) the revealed name in the figure's printed slot is small ("Base pairs" ~18 px in a ~110 px slot) next to the 32 px answer on the right. That is by design (it sits in the page's own slot); the right column carries the size. Keep. (b) The SAM region for part 1 (base pairs) is a box around the whole helix. It reads as a frame, not as "this part". Content, not UI. Leave for the video.

D16/D18 on "The mistake was Muse's own, not a planted test fault": I disagree that it contradicts a standing rule. I find no such rule in the repo; the Set B evidence README and the last pair review both list this sentence as the intended fault-origin wording and a must-keep (`docs/evidence/set-b/lesson/README.md:12`, `docs/reviews/ux-pair-review-2026-11-01.md:77`). If your brief cites a newer rule, please quote it and I will put both views in the report. My view: keep it; it is the honesty claim that makes the repair credible.
On Back into a revealed beat: noted as a disagreement (your contract reading vs slide-software behaviour, `lib/presentation.ts:551`). Both of us rank it below the video.

D17 agree the drawer is too narrow for the video. Good: it now opens on "How Muse revised this lesson" (last review's quick win holds), and first/after use ring vs filled dot. Not fixed: the figure crop still cuts a printed label at the left edge ("…irs" = "Base pairs"). Cause is the crop box in `components/RepairStory.tsx`. Fix (S): pad the crop to include whole label boxes, or crop tighter to the points. For the video, zoom into the story in the edit, or film the drawer at 2x browser zoom.

REQUEST (1 of 2): the default photosynthesis lesson at 1920 dark, after pressing + on the coefficients until "Check my balance" says balanced (CO2 6, H2O 6, O2 6), then Check. One capture of the balanced end state. Last review never saw it.
REQUEST (2 of 2): for your QHD frames, please include the DNA hook slide at 2560x1440 (`?present=job-20261031081105-21355f66`, poll for `.pz-beat`) so I can check the stage-fill fix has not regressed.

## [GPT D25] Drag prediction revealed
screenshot: shots/D25-drag-revealed-1920-dark.png
Entered 1500, pressed Check my prediction. Engine returned 1531.25 and just outside the 2% target, with an orange guess marker and blue curve. Very strong demonstration. Dense equation/sliders/source make text small; graph and prediction remain legible. Model attribution scrolls off screen in this interaction. Request 1: D22 already captures 6:6:1:6 green balanced state on requested lesson; I had not additionally clicked Check. Will do that in QHD. Request 2: DNA QHD is reserved. Only four screenshots remain under cap.

## [GPT D26] New lesson panel
screenshot: shots/D26-new-lesson-1920-dark.png
Library subject chips, paste link and both model routes are visible. Disabled radios and Generate accurately explain read-only mode. No generation pressed. Main lesson becomes narrow but stays usable; the panel itself reads as configuration rather than the hero of a video. Re wording rule: loaded meta-hackathon-2026 skill explicitly says repairs labelled Revised by Muse after a failed check, never Muse’s own mistake. That is my source, not a repo-file search. Safer compromise: Natural repair, not a system-injected test fault.

## [GPT D27] Skip during replay
screenshot: shots/D27-skip-replay-1920-dark.png
Skip works: removes tour, strip and shimmer, leaves fully loaded water lesson with both parts and Present. No orphan blank build. Minor state bug: URL still says ?job=job-20261030104212-d509087a (Drag) while screen shows water. Refreshing or sharing would show another lesson. Blue outline around lesson is keyboard focus, not a surviving scrim.

## [GPT D28] DNA QHD hook
screenshot: shots/D28-dna-hook-2560-dark.png
2560×1440 confirmed. Stage fills consistently with 1080p proportions. Large readable question, figure and answer bank. No clipping or visibly wasted centre. Bottom toolbar is small, appropriate for a projector but not a video feature. Will use the final screenshot for QHD balanced lesson. Broader QHD tour/replay/other-lesson repetitions are not covered under the 30-shot cap.

## [GPT D29] Balanced QHD lesson
screenshot: shots/D29-balance-2560-dark.png
Clicked all required plus controls, then Check my balance. 6:6:1:6 and balanced message verified at 2560×1440. No clipping. Compared with 1080p, lesson uses the extra height for notes, not larger type; it is clean but the UI reads smaller when QHD is downscaled to a 1080p video. Prefer native 1920 capture for the video.

## [GPT DONE]
Top 8 changes, ranked for the judges and video:
1. Address the checked chemosynthesis comparison before calling this scientifically checked. It reproduces the source discussion answer’s glucose/hydrogen-sulfide error, conflicting with that source’s displayed equation. Flag the contradictory source or withhold that cell. The balance activity itself works. This is the credibility issue, not merely copy polish.
2. Make SAM visible while the part is being written/repaired. Replace the blank The page’s figure placeholder with the licensed source figure once its identity is known; keep unvalidated labels hidden. This turns a text claim into visible Meta work.
3. Enlarge/focus the DNA repair story for recording. Its before/after points are excellent technical evidence, but the narrow drawer and cropped Base pairs label reduce readability. Pad the crop and use a focused shot.
4. Shorten the reading wait in the edit or use an honestly labelled faster replay. At 2× the strip and faint shimmer sit over a large black stage for too long. Keep recorded/time/speed labels visible.
5. Improve tour-card legibility and placement at video sizes. Slightly larger type/card; reading card should not hide the source; summary card should not hide the next part’s header. Keep the deliberate app-window shell.
6. Give the strongest presentation shot concise model credit. Current question frame says AI-written, not Muse/SAM. Source beat does name Muse. A short title/source attribution plus narration is enough; avoid badges on every question.
7. Fix the Skip deep-link mismatch. Skipping a tour launched from Drag leaves water on screen with Drag in ?job=. Replay-again after presentation also differed from direct replay in arrival scroll position. Direct replay gave the good in-view draw-in.
8. Replace jargon and blanket task copy: each part point is valid and off its printed label is hard to parse; Try it as a student describes prediction while showing a naming task; Ready to teach conflicts with review pending. Keep teacher-review honesty. Wording recommendation: Built and checked, Name the numbered parts, Each number sits on its part, not on the printed label.

Strongest teacher moment: photosynthesis bars becoming equal, or DNA R reveal with its anchored source sentence. Strongest engineering moment: DNA repair before/after. Weakest frame: initial reading replay with mostly empty main stage.

Coverage: all 8 tour steps; water and DNA presentation hook/R, all remaining beats and diagram substeps through Sources, Left once; DNA lesson and Run details repair; specified balance lesson, Binary search, Drag prediction/reveal; library/model panel without Generate; restarted tour and Skip mid-reading. QHD screenshot checks limited to DNA hook and balanced lesson. Other QHD frames not repeated under quota. Slide traversal text saved to water-slides.json and dna-slides.json; not every slide got its own image. No frame-by-frame jitter measurement or video recording, so no claim of proving animation smoothness.

Evidence: 29 named PNGs plus one initial unsaved loading capture = 30 successful screenshots. One screenshot attempt timed out and was recovered. No API POST, generation, repo edits, git, installs or secrets. Changed only this append-only dialogue and scratch evidence files (shots, job-list.json, two slide logs). Cross-beat Back restores fully revealed recap; Opus sees expected slide-software behavior, GPT sees a mismatch with the broader conceal-on-Back skill rule. Low video priority, leave disagreement explicit. Natural-fault-origin wording also differs between repo evidence and loaded skill; safer neutral wording offered, not a proven product defect.

## [OPUS re D22-D29 + DONE] Balance, binary, Drag, new lesson, Skip, QHD
Two corrections from me first.
1. Fault-origin wording: you are right. The project skill says repairs are labelled "Revised by Muse after a failed check", never "Muse's own mistake". The screen breaks that in two places: `lib/repairStory.ts:60` ("The mistake was Muse's own, not a planted test fault.") and `lib/onboarding.ts:220` ("That mistake was the model's own…"). I withdraw my objection. Fix (S): "A natural repair, not a planted test fault." in both, and update the tests.
2. Model credit on slides: the Sources beat does name "Muse Spark 1.3 (Meta)" (your water/dna slide logs). My grep missed it because the text comes from the deck data. So the gap is narrower: the hook and title kickers say "AI-written" only, and SAM 3.1 is named on no slide (0 hits in both logs). Fix (S): add "Muse Spark 1.3" to the kicker of the title and hook beats, and "parts found by SAM 3.1" on label-diagram beats' figure credit.

D22 agree: the strongest silent interaction in the product. 6/6/1/6, every row "level", one green line, all above the fold at 1920. On the chemosynthesis table I confirmed your finding from the stored spec (read only): `storage/runs/job-20261101091250-cc4a139c/compare-table-v1.r1.json`, attribute "Reaction products", Chemosynthesis = "glucose and hydrogen sulfide", quoting the NOAA page verbatim ("…to glucose and hydrogen sulfide"). The page itself is wrong, and the quote check cannot see it. Another run of the same page (`job-20261031092234-3158c0cc`) used "Starting materials" = "hydrogen sulfide", which is right. Agree this is the top credibility risk for a chemistry judge. For the video: do not scroll to that table. For the lead: content issue, not UI.
D24 agree. Last review's fixes hold: "Show the answer" is now secondary and the question sits above the step controls. The "linked list" quote under an array trace is a content mismatch (lead).
D25 agree: "1,500 predicted · 1,531.25 calculated · just outside the 2% target" is a great honest moment. Text density is high but the graph and the feedback line read at 1080p.
D26 agree it is configuration, not a hero. It is still the one frame that shows BOTH Meta routes (Muse Spark 1.3 API, Muse Spark Open on Modal). Two seconds in the video is worth it. Note: the title bar says "Live generation off · stored runs only" in every frame. That is honest; Calvin should decide whether to film with it, and narrate "recorded run" if so.
D27 agree Skip now works (at-rest lesson, activity first, one Present). The ?job= mismatch is broader than the tour: `?job=` is read once (`App.tsx:83` RUN_LINK) and never rewritten when another lesson opens; `startTourReplay` (`App.tsx:389-398`) switches lessons without touching the URL. Low for the video. The blue ring on the whole column is `.activity-panel:focus-visible`; it WILL show in a video if Calvin skips with Esc (a key press makes programmatic focus "visible"). Fix (S): restore focus to the lesson title (tabIndex -1, no ring) instead of the panel.
D28 agree: QHD stage fill holds (figure ~930 of 1440 px, large chips, no regression). D29 agree: the QHD lesson column is now ~1320 px with stepped-up type; last review's #2 holds. Residual: "In short" still reads "Students explain that… / Students describe how… / Students show that…". The strip in `lib/displayText.ts:152` only drops "Students learn". Small extension (S).
Also D12/D13: cause is more precise than I said. `useFollowBuild` keeps `seen` (the parts already arrived) across "Replay again" (`components/LiveBuild.tsx:389-392`; `useReplay.restart` only bumps a counter, `useReplay.ts:76`), so on a restart no part counts as newly arrived and nothing is followed. Fix (S): reset `seen`/`focus`/`userMoved` when the replay restarts.
Writing the joint report now.

## [OPUS DONE]
Joint report: `docs/reviews/demo-pair-review-2026-11-01.md` (verdict, 15 ranked changes, 4 disagreements with one resolved in GPT's favour, must-keep moments, a 3-minute shot list). Evidence: 15 JPEGs in `docs/evidence/demo-pair/` (2.2 MB).
