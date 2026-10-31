# Stage 9: live build view, frame evidence

Design: `docs/specs/STAGE-9-live-build-view.md`. Every frame below is a stored, real Muse Spark 1.3 run played back
through the app. No live Meta call was made; the local API ran without `META_LIVE` (POST disabled), GET only.

## Runs used

| Run | Page | What it shows |
|---|---|---|
| `job-20261031081105-910f3776` | NOAA JetStream, hydrologic cycle | Label the diagram with two SAM 3.1 calls and one natural repair (LD-04, revision 1 → 2), plus a sequence |
| `job-20261031081105-21355f66` | MedlinePlus, what is DNA | Label the diagram (SAM, natural repair) and quiz cards |
| `job-20261031091833-a223f473` | NIST DADS, bubble sort | Algorithm tracer, and quiz cards with a natural repair (Q-06) |

No run here carries a system-made demo fault.

## How the frames were made

- Replay (`?replay=<jobId>&speed=N`): frames every ~0.8 s at 1920×1080 or 1366×768. The screen says
  "Replay of a recorded run · N× speed · recorded <date> UTC", and the strip says "Replay".
- Live path (`strip-bubble-live-path-light-1366.jpg`): the normal `?job=` view with its real 1.5 s polling, fed by a
  browser fetch shim that serves the stored run as if it were still running (events re-timed to now, artifacts released
  at the event that wrote them, via `lib/replay.ts`). This exercises the live code path (no replay code in the UI), so
  its strip says "Live"; it was not a live job.
- Element positions were read on every frame (`rects/*.json`).

## Frame strips (12 frames each, start → finish, left to right, top to bottom)

| File | Run | Theme, size, speed |
|---|---|---|
| `strip-water-dark-1920.jpg` | water cycle | dark, 1920×1080, 4× |
| `strip-water-light-1920.jpg` | water cycle | light, 1920×1080, 4× |
| `strip-bubble-dark-1920.jpg` | bubble sort | dark, 1920×1080, 3× |
| `strip-dna-light-1366.jpg` | DNA | light, 1366×768, 4× |
| `strip-bubble-live-path-light-1366.jpg` | bubble sort, live path | light, 1366×768, real time |
| `burst-analysis-beat-dna-dark-1920.jpg` | DNA, the moment the analysis lands | headline, key points one by one, cited sentences lighting up |
| `burst-label-diagram-sam-outlines.jpg` | water cycle, the label diagram arriving | markers pop in, SAM regions draw then fade |
| `frame-water-dark-1920-f12/f20/f28.jpg`, `frame-dna-light-1366-f20.jpg` | single full frames | overview + frames, SAM + repair log, finished |

## Layout shift (max movement of each element across all frames, px)

| Capture | Title | Provenance | Overview | First part | Second part |
|---|---|---|---|---|---|
| water dark 1920 | 0 | 0 | 0 | 0 | 39.5 (top 1290, below the fold) |
| water light 1920 | 0 | 0 | 0 | 0 | 39.5 (top 1290, below the fold) |
| bubble dark 1920 | 0 | 0 | 0 | 0 | 59.6 (top 1410, below the fold) |
| DNA light 1366 | 0 | 0 | 0 | 0 | 42.8 (top 1283, below the fold) |
| bubble live path 1366 | 0 | 0 | 0 | 0 | 59.6 (top 1401, below the fold) |

Nothing a teacher can be reading moves: the strip, title, provenance, overview and the first part hold their place from
the first frame to the finished lesson (finishing adds the Present button, the trust receipt and the repair phrase into
space reserved for them). A later part moves only by the error of its reserved height when the part above it arrives,
and in every capture that part was below the visible area. The document never overflows the window (`docOverflow` 0).

Fixed on the way (found from these measurements): the finish moved everything by 10 px (Present button + receipt) and,
on the bubble sort run, by 22 px more (the repair phrase wrapped the provenance to a third line); a 1366 headline
re-wrapped by 0.03 px when the Present button appeared; a shorter headline replacing a two-line page title pulled the
provenance up 26 px. All four now measure 0.

## Other checks

- Reduced motion (`prefers-reduced-motion: reduce` emulated): every live animation resolves to the app's global
  near-zero duration; source marks, SAM outlines and markers have no animation at all. Normal motion: arrive 380 ms,
  key points 320 ms staggered 90 ms, marks 900 ms staggered 70 ms, SAM outline 2.2 s per part staggered 150 ms.
- A stored lesson opened normally (`?job=`) has no live element or animation (0 `.is-live/.lb-*` nodes).
- `node --test apps/web/src/lib/*.test.ts`: 847 pass, 0 fail (24 new in `liveBuild.test.ts` and `replay.test.ts`).
- `npm --prefix apps/web run build`: passes. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

Raw full-resolution frames stayed in a local scratch folder (not committed).
