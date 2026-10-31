# Stage 8a slice W-A: algorithm tracer and log ladder views (evidence)

Author: Claude Opus 5.5 (web slice W-A, `docs/specs/STAGE-8a-subject-engines.md` §1a, §1b, §4).
Captured 2026-10-31 from the dev-only harness `http://127.0.0.1:5173/?engine-demo=a` (Vite dev server, no API calls,
no model calls). The specs shown are **fixture data, not model output**:

| Harness tab | Spec | Source page (verbatim quotes, checked by `lib/algorithmDemoSpecs.test.ts`) |
|---|---|---|
| Bubble sort | hand-written `BUBBLE_SORT_GEN` | `nist-dads-bubble-sort` |
| Binary search | hand-written `BINARY_SEARCH_GEN` (target 15: left → right → found) | `nist-dads-binary-search` |
| Binary search (golden) | `tests/fixtures/stage6/algorithm-trace.gen.json` | `nist-dads-binary-search` |
| Merge sort | hand-written `MERGE_SORT_GEN` | `nist-dads-merge-sort` |
| Quicksort | hand-written `QUICKSORT_GEN` | `nist-dads-quicksort` |
| pH ladder | hand-written `PH_LADDER_GEN` (7 → 2 and 7 → 5.6) | `usgs-wss-ph-and-water` |
| Magnitude ladder (golden) | `tests/fixtures/stage6/log-ladder.gen.json` | `usgs-earthquake-magnitude-energy-intensity` |

URL parameters: `spec=<tab id>`, `mode=lesson|stage`, `step=N`, `revealed=1`. In stage mode → / ← / R / Esc drive the
view exactly as the §4 contract does (`presentation = { mode: 'stage', step, revealed }`).

## What the views do

- **Algorithm tracer.** Value bars per item; our engine's frames (`traceAlgorithm`) mark compare (blue), swap/write
  (orange arc under swapped pairs), pivot/min/key (teal), settled (green), found, and the eliminated part of a search
  (dimmed) with a bracketed range and lo / mid / hi markers. Merge sort shows its two sorted halves in a tray, the slot
  the next item goes to, and hides the stale copies still waiting to be overwritten. Insertion sort lifts the key out of
  the list while larger items shift. Counters (comparisons, swaps/moves/writes) and the engine's plain note for every
  frame. Predict points, all read from the engine's next frames: bubble "Will these two swap?", insertion "Where will
  12 land?", selection "Which value ends up at position i?", merge "Which goes down next?", quicksort "Where will the
  pivot settle?", binary "left half, right half, or found?", linear "Is this the target?". Capped at the first 8 points
  (`ALGORITHM_PRESENT_MAX`). Lesson controls: Back, Show the answer / Next step, Play/Pause (stops at the next unanswered
  question; frames between a prediction and its answer play out unless reduced motion is set), Reset. Quicksort, merge
  sort and bubble sort carry a quiet "Our tracer shows one standard version" note.
- **Log ladder.** A vertical scale with every whole step marked ×factor (hover-linked to the factor quote), the page's
  rungs at their values (hover-linked to their quotes), the case's from → to span highlighted. The class predicts "how
  many times more or less?"; the reveal grows the running multiplier step by step (×10, ×100 … ×100,000; a fractional
  case ends with a part step, e.g. ×25.1) and states the engine value (`ladderRatio`). Lesson grading uses the teaching
  margin (2% of the engine value) and the direction words come from `effectPhrase` / `increasing`.
- Both views open on the first question with its answer hidden, never move on reveal (space reserved with visibility),
  and route model-written text through `aiLabel`/`aiText`; page quotes stay verbatim.

## Reveal movement (Δy / Δh = 0 rule)

`reveal-movement.json`: bounding boxes of the question, options, result line, board/ladder, status, lede, the quote
zone and `.pz-fit-zoom`, read before and after R in the harness stage. Every row moved 0 boxes.

| Spec / step | 1920×1080 dark | 1920×1080 light | 1366×768 dark | 1366×768 light | stage zoom 1920 / 1366 |
|---|---|---|---|---|---|
| bubble, step 0 | 0 of 9 moved | 0 of 9 | 0 of 9 | 0 of 9 | 1.41 / 0.97 |
| binary, step 1 | 0 of 10 | 0 of 10 | 0 of 10 | 0 of 10 | 1.39 / 0.95 |
| merge, step 2 | 0 of 9 | 0 of 9 | 0 of 9 | 0 of 9 | 1.39 / 0.96 |
| quicksort, step 1 (multi-frame reveal) | 0 of 9 | 0 of 9 | 0 of 9 | 0 of 9 | 1.34 / 0.93 |
| pH ladder, case 1 | 0 of 7 | 0 of 7 | 0 of 7 | 0 of 7 | 1.34 / 0.92 |
| pH ladder, case 2 | 0 of 7 | — | — | 0 of 7 | 1.34 / 0.92 |

Lesson view: picking an answer (bubble) and checking a ladder prediction moved 0 boxes. Leak check on the pH stage before
R: neither the beat's innerText nor any `aria-label` contained "100,000".

## Files

- `lesson-1920-*`: lesson column in the app window next to the page text (dark and light; bubble ask and picked,
  binary question 2, merge question 3, quicksort question 2, pH revealed and ask, magnitude golden).
- `lesson-1920-dark-bubble-hover-claim.png`: hovering a page fact lights its paragraph in the page text.
- `stage-<size>-<theme>-<spec>-step<N>-ask.png` / `-revealed.png`: the harness presentation stage (a copy of the deck's
  stage fit at the 980 px design width; the real deck is wired by slice W-B).
- `stage-1920-dark-ph-hover-rung.png`: hovering a rung puts its page sentence in the quote zone.

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 783 / 783 pass (slice files: `algorithmView.test.ts`,
  `algorithmView.random.test.ts`, `logLadderView.test.ts`, `algorithmDemoSpecs.test.ts`, 27 tests).
- `npm --prefix apps/web run build`: passes; the harness banner text is absent from `dist/assets/*.js`.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.
