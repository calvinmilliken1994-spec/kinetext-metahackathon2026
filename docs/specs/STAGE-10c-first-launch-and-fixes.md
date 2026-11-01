# Stage 10c: first launch, onboarding, Demo, try your own, UX review fixes

Status: FROZEN by the lead, 2026-11-02. Sources: `docs/reviews/ux-pair-review-2-2026-11-02.md` (H1-H5, M1-M8, L1-L7,
polish) and Calvin's decisions:

> "Go ahead with the recommended, and also a better 'on first launch' experience instead of just landing on a lesson page
> that has already been generated with the source text loaded, this may be quite confusing, firstly met with an access code
> entry button or a read only entry button, then an easy to follow onboarding which gives a quick easy to follow tutorial
> around the different pages. At the end of the on-boarding, a demo prompt should also follow, and then at the end of the
> demo, a try your own would follow next."

Decisions (recommended, accepted):
- **Q1:** the welcome flow below replaces landing cold on a lesson. "Try your own page" is offered at the end.
- **Q2:** the Demo keeps the 31 Oct run, which has a real repair. The lead tries up to 4 fresh water-cycle runs for a
  natural repair that also has Muse grounding; if one appears, the lead re-pins it. Repairs are never staged.
- **Q3:** the prompt-injection text is kept, renamed "Safety example: a page that tries to give the AI instructions"
  (done in local storage; the deploy curation keeps it). "Throwing a ball on the Moon (project-authored test text)" is
  left out of the deployed storage.
- **Q4:** a wrong sequence check shows only which steps are out of place. The page's order is revealed when right, or
  on "Show the page's order".

## 1. First launch (slice A)
A visitor's first visit (no `mki.welcome` key in localStorage), or `?welcome=1`, shows a full-window **Welcome** screen
before the app:
- One line on what the app does, then two equal choices:
  - **Enter access code**: the inline `AccessForm`, for judges, which unlocks building.
  - **Continue read-only**: browse, recorded builds, presenting.
- When the gate is off (local), the access choice reads "Builds are open on this server" and Continue is the only button.
- `?welcome=0`, `?job=`, `?present=` and `?replay=` links skip the Welcome (deep links keep working).

Then the **onboarding**: a short guided walk around the pages, about 6 steps, with one card per step and Next / Back /
Skip and "Step N of M". It moves the main view itself:
1. **New lesson:** pick a library page, or paste your own source.
2. **A finished lesson:** the overview and the interactive parts, each tied to the sentence it came from; the
   AI-written note.
3. **Present:** what the button does; the view is not entered.
4. **Checks and run details:** what was checked and repaired.
5. **Review and publish:** the teacher's step.
6. **Results:** how the two models did.

It ends with a **Demo prompt** card: "Watch a lesson being built (recorded, about 1 minute)" with **Watch the demo** and
**Not now**. Watch starts the existing Demo (the recorded build replay with its steps).

**End of the Demo:** a final card, **Try your own page**, opens New lesson on the *Your own source* path (locked: the
inline access form at the top of that panel, per H4). Its second choice, *Browse the lessons*, opens All lessons.

- **Help:** the sidebar's Help section gains *Show the welcome again*. The Demo entry stays.
- **Storage keys:** `mki.welcome` (`'done'`); the existing Demo outcome key keeps its meaning.
- **Dead time:** no card covers its target. The flow never waits on a lesson that is still loading without saying so.

## 2. Review fixes
| Fix | Slice |
|---|---|
| H1 sequence reveal (+ `OrderBoard`), Q4 | B |
| H2 grounding step visible: the worker emits a grounding-done event; the web shows "Muse Spark is locating N parts" then "SAM 3.1 is confirming"; the grounded line stays on the part's meta row (with the retry line when present); the figure shows dimmed while the stage runs | C |
| H3 checks drawer copy | D |
| H4 own-source path when locked (inline access form at the top of Your own source) | A |
| H5 diagram slide fills about 85% of the stage height | B |
| M1 library search (stale preview, scroll the selected row into view, match subject and summary) | A |
| M2 "AI-written summary" wording: App first-run hint and New lesson (A); How it works (D) | A, D |
| M3 Review page shows each part's wording; "Show in lesson"; status line | D |
| M4 Demo step for Muse locating + SAM confirming (only when the pinned demo run has grounding; otherwise one honest line that newer lessons add this step) | A |
| M5 All lessons counts, units, singular "part" | D |
| M7 lesson cold-start skeleton | B |
| M8 How it works step-4 wording; polish: link steps to pages, say where publishing happens | D |
| L3 single-item sidebar sections (`lib/navigation.ts`) | A |
| L4 replay badge wrap, L6 chip and meta sizes | D |
| L5 Demo Next debounce | A |
| Polish: source credit cut-off at 1920 | B |
| Polish: Results in-page index and bar wording | D |

## Ownership (no overlaps)
| Slice | Owner | Files |
|---|---|---|
| A | Opus | `App.tsx`, `Onboarding.tsx`, `lib/onboarding.ts`, new `WelcomeScreen.tsx` (+ lib + tests), `NewLessonPage.tsx`, `lib/navigation.ts` (Help entry), `styles/onboarding.css`, new `styles/welcome.css` |
| B | Opus | `SequenceView.tsx`, `OrderBoard.tsx`, `OrderActivity.tsx`, `components/presentation/**`, `lib/presentation.ts`, `styles/present.css`, `PendingCard.tsx`, `LessonView.tsx`, `SourcePanel.tsx` (credit), their tests |
| C | Sonnet | `workers/generation/lesson.ts` (grounding event), `lib/liveBuild.ts`, `LiveBuild.tsx`, `LabelDiagramView.tsx` (dimmed figure during the stage), `styles/live.css`, their tests |
| D | Sonnet | `LessonChecksPanel.tsx`, `ReviewPage.tsx`, `lib/review.ts`, `AllLessonsPage.tsx`, `lib/browse.ts`, `HowItWorksPage.tsx`, `ResultsPage.tsx`, `styles/results.css`, `styles/nav.css`, `Sidebar.tsx`, `styles/review.css` |

If a slice truly needs a file it does not own, it records the exact change in its report and the lead applies it.
