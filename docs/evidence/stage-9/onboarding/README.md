# Stage 9b: first-run tour, frame evidence

Design: `docs/specs/STAGE-9b-onboarding-and-live-build-2.md`. Code: `apps/web/src/lib/onboarding.ts` (step machine,
wording, card placement; pure), `apps/web/src/components/Onboarding.tsx` (spotlight and card),
`apps/web/src/styles/onboarding.css`; anchors (`data-tour`) in `SourcePanel.tsx`, `IconRail.tsx`, `LiveBuild.tsx` and
the Present button in `App.tsx`.

Every replay frame below is the stored Muse Spark 1.3 run `job-20261031081105-910f3776` (NOAA JetStream, the water
cycle: label diagram with two SAM 3.1 calls and one natural repair, LD-04 revision 1 → 2, plus a sequence) played back
through the app, labelled "Replay of a recorded run" on screen. GET only: the runs list held 706 jobs before and after
the captures, so nothing was posted and no Meta call was made.

## The tour

| # | Step | Spotlight | Moves on |
|---|---|---|---|
| 1 | Turn a page into a lesson you can teach | none, centred card | Show me |
| 2 | Start from a page (97 licensed pages in 9 subjects, or paste) | library picker + rail New lesson | "Watch a lesson being built" starts the labelled replay |
| 3 | Muse Spark 1.3 is reading the page | the live strip | by itself when the analysis lands (min 2.6 s on screen) |
| 4 | The summary comes first | overview + source text (cited sentences light up) | by itself when a part does something visible (SAM call, checks) |
| 5 | Code checks every part | the part with the failed check | by itself when the run finishes; wording follows the run (no repair claimed before the failed check; "Revision 2 passed every check… not a planted fault" after) |
| 6 | Ready to teach | the strip's closing beat | Next |
| 7 | Try it as a student would | the first passed part; clicks reach it | Next |
| 8 | Run it with a class | the closing beat with its Present button | "Open presentation mode" opens it and ends the tour |

Counts, model name and the repair sentence are read from the live data, not hard-coded. If the stored run is missing
from the runs list, steps 3 to 6 drop out and step 2 just says Next.

### As the demo-video path

- `/?tour=1` forces the tour (whatever the stored flag); `/?tour=1&speed=N` sets the replay speed (0.25 to 16,
  default 2). The strip always says "Replay of a recorded run · N× speed · recorded 31 Oct 2026, 08:11 UTC".
- At speed 4 the whole tour takes about 35 s of clicking: 2 clicks to start, the middle four steps move by themselves,
  3 clicks to reach presentation mode.
- `?tour=0` keeps it closed (use it on deep links for other evidence).

## Frame strips (12 frames each, left to right, top to bottom)

welcome · library · reading · overview (2) · checking (3: SAM outlining, rework, sequence arriving) · ready · try ·
present · presentation mode.

| File | Theme, size |
|---|---|
| `strip-tour-dark-1920.jpg` | dark, 1920×1080, 4× |
| `strip-tour-light-1920.jpg` | light, 1920×1080, 4× |
| `strip-tour-dark-1366.jpg` | dark, 1366×768, 4× |
| `strip-tour-light-1366.jpg` | light, 1366×768, 4× |

`rects-*.json`: per frame, the step, card side, strip state and text, and content-relative tops/heights of the title,
provenance line, overview and both parts, the column scroll, and the overlap checks below.

## Measured on every frame (29 to 30 frames per run)

| Check | dark 1920 | light 1920 | dark 1366 | light 1366 |
|---|---|---|---|---|
| Card overlaps a cut-out | no | no | no | no |
| Card outside the viewport | no | no | no | no |
| Document overflows the window (px) | 0 | 0 | 0 | 0 |
| Strip line overflows (px) | 0 | 0 | 0 | 0 |
| Title / provenance / overview / first part move (px, in the column) | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| Second part moves (px) | 26 | 26 | 13 | 13 |

The second part moves once, by the error of the label diagram's reserve (714 px reserved, 740 rendered at 1920, 701 at
1366), when the diagram arrives; at that moment the column is scrolled to the diagram.

Vision checks of all four strips: card text legible in both themes, no card over a target, no glow, confetti, bounce or
gradient. One transitional frame per run shows the card moving with its target (the column follows the sequence for
about a second when it arrives, then returns to the diagram for its SAM call).

## Behaviour checks

- First visit on a plain URL (no `mki.tour` in localStorage): opens on step 1. Skip or Esc stores `skipped`, finishing
  stores `done`; a second visit stays closed. A deep link (`?job`, `?present`, `?replay`, dev harnesses) never opens it.
  The rail's Tour button reopens it (pressed while open).
- Keyboard: focus moves to the step heading on every step; Tab cycles Skip tour → Show me inside the card (trapped on
  every step but "Try it", whose part must be reachable); Enter activates; Esc closes before the drawer's own Esc.
- Clicks: outside a cut-out they are held; inside one only on "Try it" (a click on the diagram's number chip reached
  the part).
- Reduced motion (`prefers-reduced-motion: reduce` emulated): the card has no animation; the strip, frames and
  arrivals resolve to the app's near-zero duration; the column follow jumps instead of scrolling smoothly.
- a11y: the card is `role="dialog"` named by its heading and described by its body; no duplicate ids. Five unnamed
  buttons on the page are the log-ladder chips of another view (not part of this work).

## Tests and gates

- `node --test apps/web/src/lib/*.test.ts`: 874 pass, 0 fail (10 new in `onboarding.test.ts`: URL rules, first-run
  rule, step list and wording from real counts, signals replayed moment by moment from the recorded-run fixture,
  readiness, auto-advance with minimum dwell, card placement clear of every cut-out, rect clipping).
- `npm --prefix apps/web run build`: passes. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

Raw full-resolution frames stayed in a local scratch folder (not committed).
