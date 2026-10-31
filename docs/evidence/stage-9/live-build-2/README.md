# Stage 9b: live build view, pass 2, frame evidence

Design: `docs/specs/STAGE-9b-onboarding-and-live-build-2.md` (pass 1: `STAGE-9-live-build-view.md`). Code:
`apps/web/src/lib/liveBuild.ts` (preview shapes, reserve, preview phase, follow focus, progress facts, closing beat),
`apps/web/src/components/LiveBuild.tsx` (strip, frame sketches, `useFollowBuild`), `apps/web/src/styles/live.css`;
one hook call in `LessonView.tsx`. Frames are stored real runs played back with `?replay=<jobId>&speed=N` (labelled
"Replay of a recorded run"); GET only, no Meta call.

## What changed from pass 1

| Lead's note on pass 1 | Pass 2 |
|---|---|
| Mostly text | Each pending frame draws a faint, static sketch of its part's shape under its work log: quiz cards, sequence rungs, a table grid, sliders + graph, the figure plate + label column, bins + chip tray, map nodes, equation terms + bars, trace bars, ladder, meter, a scene for simulations. The label column shows one chip per part once SAM is asked to outline n parts. The plan names no figure id, so no image is guessed: the figure is a plain plate captioned "The page's figure". |
| Frames are tall empty dashed boxes | The sketch fills the reserve; its emphasis follows the part (waiting 0.55 → writing 0.8 → SAM outlining 1.0 opacity; the dashed border turns accent while written, red-toned while reworked). No shimmer or pulse. |
| Reserve sizes were guesses | Reserve = frame head (64 px) + sketch body, with body heights from the median rendered height of stored published parts (table below). |
| The diagram lands below the fold at 1080p, SAM outlines draw out of view | The lesson column follows the moment worth watching (an arrival, a SAM call, a rework), placing the part under the strip; plain writing never pulls the view off the overview. It stops for good on any user wheel, touch, scroll key or scrollbar drag. At 1920×1080 the diagram's plate sits at 331–840 px of a column ending at 998 px when its outlines draw (`burst-label-arrives-in-view-light-1920.jpg`). |
| Strip too small for a video | The strip is sticky at the top of the column and has three fixed rows: the replay label (replays only), the model + every open call + its elapsed time at 20 px (16 px in a column under 900 px wide), and what has finished so far ("1 Muse Spark 1.3 call done · 0 of 2 parts checked"). |
| No ending | Closing beat in the same box: a tick, "Lesson ready · built in 1 min 22 s", a Present button, and "4 Muse Spark 1.3 calls · 2 SAM 3.1 calls · every part checked · $0.144 est.". "Every part checked" only when every planned part passed; otherwise "2 of 3 parts checked · 1 left out"; a failed job says "The run stopped after …". The border turns green; nothing below moves (same row heights). |

## Reserve vs measured part heights (px, whole frame)

Measured on stored published lessons (median of 2 to 10 parts per kind at 1920×1080 and 1366×768) before choosing the
body heights:

| Part | Measured | Reserve now | Pass 1 |
|---|---|---|---|
| quiz cards | 1095–1396 | 1244 | 560 |
| formula explorer | 1223–1431 | 1364 | 520 |
| concept map | 825–960 | 904 | 460 |
| algorithm trace | 910–935 | 924 | 820 |
| balance equation | 796–817 | 804 | 400 |
| log ladder | 646–723 | 704 | 460 |
| sort groups | 684–939 | 704 | 440 |
| label diagram | 555–740 | 714 | 700 |
| sequence | 521–678 | 584 | 540 |
| data table | 513–771 | 544 | 420 |
| threshold | 465–507 | 484 | 440 |
| compare table | 246–595 | 304 | 360 |

Water-cycle run, every replay frame (from `docs/evidence/stage-9/onboarding/rects-*.json`): title, provenance,
overview and first part move 0 px; the second part moves once, 26 px at 1920 and 13 px at 1366, when the diagram
arrives (pass 1: 39.5 px).

## Files

| File | What it shows |
|---|---|
| `previews-all-kinds-dark-1920.jpg` | the sketch of 13 kinds, each from a real stored run planning that part (label diagram, sequence, quiz cards, data table, compare table / formula explorer, threshold, log ladder, algorithm trace, balance equation / sort groups, concept map, half-life simulation) |
| `frame-skeleton-dark-1920.jpg`, `frame-skeleton-light-1920.jpg` | the label diagram frame while Muse writes it, both themes |
| `frame-overview-lands-light-1920.jpg` | the moment the analysis lands: headline, key points arriving, the planned frames below |
| `strip-running-two-calls-dark-1920.jpg` | two parts written at once |
| `strip-reworking-sam-dark-1920.jpg`, `strip-reworking-light-1366.jpg` | the label diagram reworked after a failed check, the sequence still being written; 1366 shows the narrower size |
| `strip-closing-beat-dark-1920.jpg`, `strip-closing-beat-light-1920.jpg`, `strip-closing-beat-dark-1366.jpg` | the closing beat |
| `burst-label-arrives-in-view-light-1920.jpg` | 5 frames, about 0.4 s apart, of the diagram arriving fully in view under the strip while its part markers draw in |

## Other checks

- Follow: in a plain replay at 4×, the column scrolled 0 → 388 (SAM call on the diagram) → 973 (sequence arrives) →
  388 (SAM call on revision 2), and stayed on the diagram as it arrived. After one mouse-wheel step during the replay
  the column stayed at that position (120 px) to the end.
- A stored lesson opened normally (`?job=`): no `.is-live`, `.lb-bar`, `.lb-frame` or `.lb-pv` element (0 nodes).
- Reduced motion: no smooth scroll, no sketch transition, the strip and frames resolve to the app's near-zero duration.
- `node --test apps/web/src/lib/*.test.ts`: 874 pass, 0 fail (7 new in `liveBuild.preview.test.ts`: every kit kind has
  its own shape, reserve = head + body and within 15 % of the measured medians, SAM chip count, preview phase, follow
  focus, progress facts, closing beat wording). `npm --prefix apps/web run build`: passes. `impeccable detect`: `[]`.

## Known limits

- Shapes are per kind, not per spec: a 4-step sequence still sketches 6 rungs (the step count is unknown until the
  part arrives). Reserves are medians, so a part much taller or shorter than usual still moves the parts below it.
- The figure plate is generic. Showing the page's real figure while Muse writes would need the plan to name its figure
  id (it does not today: `componentPlan` carries only the component id, reason and focus quote).

Raw full-resolution frames stayed in a local scratch folder (not committed).
