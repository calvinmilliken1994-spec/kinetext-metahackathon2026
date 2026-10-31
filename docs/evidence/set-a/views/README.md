# Set A: presentation and engine views (evidence)

Opus 5.5 child, 2026-11-01. Browser checks ran on the Vite dev server (:5173) against the stored-runs API (:8787, GET only, live generation off). No POST, no credits. Files in this folder: JPEG frames (1920×1080 or 1366×768, clip of the viewport), `browser-checks.json` (hover, R, ← and keyboard probes) and `reveal-shift.json` (bounding boxes before and after R).

Another child was editing `App.tsx` and other shell files at the same time, so Vite reloaded the page several times during the run; every probe re-opened its deep link and re-ran until it finished on a loaded beat.

## What was checked

| Item | URL (`?present=` unless noted) | Result |
|---|---|---|
| W-04 compare hover | `job-20261031110323-8979fdcd&beat=4` | Before R, hovering “Are the members of the executive branch” leaves the quote zone empty; other cells still show their sentence. After R the zone shows the cabinet sentence. R, then pointer on the zone, then ←: zone empty, `data-revealed=false`. |
| W-04 lesson | `?job=job-20261031110323-8979fdcd` | The same cell has no link keys; hovering it lights no source mark (other cells light 1). |
| W2-01 quiz Back | `job-20261031081105-21355f66&beat=5` | R, pointer on the zone, ←: zone empty. |
| W2-02 key terms | `job-20261031081105-21355f66&beat=3` | Hovering each of the 5 terms on arrival: zone empty. → shows meaning 1: its term now shows its sentence, the rest stay empty. ← again: all empty. |
| W-05 threshold Back | `job-20261031101554-f4ba758e&beat=5` | R, slider to 40 (“It passes, 2 more than the 38 needed”), ←: “needs ?”, “Passes?”, “Will 27 of 50 States be enough?”, no verdict. |
| UX #2 case titles | `job-20261031023315-679e8e97&beat=5`, `job-20261031101734-fca565b7&beat=6` | Before R each chip reads “270 electors”, “269 electors”, “350 electors”. After R only the current step shows its written title (“Candidate falls just short of the threshold”); the others stay counts. Both texts are laid out in one stacked cell, so the chip never widens on R. |
| P1, P2, UX #3 IRS | `job-20261031023421-facdad1d&beat=4` | Question: “Using the Married column, how much tax is due on $640,600 of income?” Input label “Income ($), Married column”. Axis under the blocks: $24,800 · $100,800 · $211,400 · $403,550 · $512,450 · $640,600 (band edges, first not clipped). Result “Tax from the listed bands $159,268.50” with “The page lists no rate for income up to $24,800, so this is not the full tax.” beside it. Chart caption adds “Rows named by the Single column”. |
| W-10 income | `?job=job-20261031023421-facdad1d` | `1e308`, `-5`, `abc`, empty and `99999999999999999` each give an inline field error with `aria-invalid=true`; the last good result stays; no error boundary. `250,000` computes again. |
| D1–D4 DNA lesson | `?job=job-20261031081105-21355f66` | 4 of 6 right after Check; dragging Guanine onto the filled number 5 swaps the two names; the four ✓ marks stay (“4 of 6 still marked right. Check again for the numbers you moved.”); Check again: green “All six parts named. Every name sits on the figure’s own label.” at the top of the side column. Markers overlapping a name slot: 0. |
| D2 stage | `job-20261031081105-21355f66&beat=4` | Markers overlapping a printed label: 0 on step 1 and 0 on the last step (“Now the figure’s own labels.”); markers 5 and 6 sit on their coloured bars. |
| W2-03 keyboard | same beat | Tab stops: the 6 bank names before R (each shows its sentence in the zone on focus), plus each named row after R; unnamed rows have none. The formula equation line is a tab stop when it cites the page. |

## R moves nothing

Every element inside `.pz-beat` plus `.pz-zone`, before and after R (sequence-matched, so a ‘?’ that becomes a value counts as an in-place swap, not a move). Moved common elements:

| Beat | 1920×1080 | 1366×768 | StageFit zoom 1920 / 1366 |
|---|---|---|---|
| Compare (8979fdcd, 4) | 0 | 0 | none / none |
| Quiz (21355f66, 5) | 0 | 0 | none / none |
| Vote (679e8e97, 5) | 0 | 0 | 1.777 / 1.265 |
| Vote (fca565b7, 6) | 0 | 0 | 1.777 / 1.265 |
| Vote (f4ba758e, 5) | 0 | 0 | 1.724 / 1.180 |
| IRS table (facdad1d, 4) | 0 | 0 | 0.962 / 0.660 |
| pH scale (7a1de630, 7) | 0* | 0* | n/a / 0.940 |
| DNA diagram (21355f66, 4) | 0 | 0 | n/a / 1.020 |

\* The running-multiplier labels (hidden until R) slide 8 px sideways as their reveal animation; nothing that was visible before R moves.

## Known limits

- The IRS table slide fits 1366×768 at zoom 0.66, below the 0.85 floor. It was already near that before this change (the calculator sits beside the table); it needs its own stage layout, which is outside Set A.
- In the water-cycle lessons the figure prints “Surface Runoff” and “Snowmelt Runoff”, while Muse named the part “Runoff”. Matching by printed text gives that part a floating tag, not a slot. That is intended: equal text only, never the nearest label.
- Concealed values still sit in the DOM under `visibility:hidden` (the reserved ‘?’ cells). This hides them from the screen and `innerText`. It is not protection from DOM inspection.
