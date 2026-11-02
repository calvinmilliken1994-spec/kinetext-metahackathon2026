# Demo v2: follow the build

Agreed with Calvin on 2 Nov 2026 ("Go ahead"). Replaces the replay-driven middle of the Demo (steps `reading`,
`overview`, `figure`, `checking`, `ready`). Steps before (`welcome`, `library`) and after (`try`, `present`, `own`) stay
as they are, as do the dim backdrop with cut-outs, card placement (`placeStep`, `belowCover`) and the Welcome hand-off.

## What is wrong today

The Demo's steps wait on replay moments, but the replay does not wait on the Demo. Seen at 1920 on
`job-20261101234914-97ba271b` at 2×: the card still says step 4 "Muse writes the summary first" while the replay is
writing the label diagram; the summary it lights has scrolled out of view, so nothing is lit; Next is disabled for about
30 s because the `figure` step needs Muse's locate event (`stepReady('figure')`), and "Writing Label the diagram" comes
before it.

## Rules

1. **The replay leads, the card follows.** The build part is a list of *beats*, each tied to a real event of the
   recorded run (its `events.jsonl` via the replay feed): reading the page, summary written, each part started, Muse
   locating the figure's parts, SAM 3.1 confirming, each part checked (passed, or failed then revised), build done. The
   beat on screen is a pure function of replay time: the latest beat whose event time is at or before now. Card text and
   cut-out always match what is on screen.
2. **The view follows the work.** When a part starts, scroll it into view (the existing scroll rules: only the lesson
   column, at most a few moves, the sticky strip never covers the target) and light it; when it finishes, light it again
   for its checked moment, then move on to whatever is being worked on next. Reading/summary beats light the source pane
   and summary as today.
3. **Next and Back always work during the build.** Next seeks the replay to the next beat's event time; Back to the
   previous beat's. Nothing is greyed out. Left alone, the replay plays through and beats change by themselves (keep a
   short minimum dwell so a fast beat stays readable; the replay waits for it if needed, never the other way round).
   After the last beat ("Ready for your review"), Next goes to `try`.
4. **4× by default** (`TOUR_DEFAULT_SPEED = 4`). `&speed=N` still overrides. `CONFIRM_HOLD_MS` already keeps "SAM 3.1 is
   confirming" readable at 4×.
5. **Honest wording kept:** "Replay of a recorded run"; repair wording "Revised by Muse after a failed check" with the
   failed check's own name from the run's events; the SAM beat names Muse Spark locating and SAM 3.1 confirming with the
   run's own counts. Beats with no event in the run (a run without grounding or without a repair) are simply absent.
6. **Pure logic in `lib/`, tested first:** building the beat list from a recorded run, the beat at time t, Next/Back seek
   targets, which element each beat lights. Tests run on the real stored Demo run fixture.

## Done means

- Every beat test passes on the Demo run; the existing Demo tests are updated on purpose, not deleted for convenience.
- Watched end to end at 1920×1080 and 1366×768: at every beat something on screen is lit, the card matches the strip,
  Next is never disabled during the build. Screenshots of each beat in `docs/evidence/demo-v2/`.
- `impeccable detect` stays at 0.
