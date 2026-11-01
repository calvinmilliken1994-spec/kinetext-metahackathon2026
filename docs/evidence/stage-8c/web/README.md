# Stage 8c slice W (web): outline draw-in, unclaimed labels muted, new check names

Spec: `docs/specs/STAGE-8c-label-coverage-and-outlines.md` (frozen). Checked 2026-11-02 against the read-only API (GET only)
and Vite on :5173, at 1920×1080 and 2560×1440 (1366×768 as the "still fits" check).

## What changed (apps/web/src only)
- **Outline draw-in.** A SAM region with a stored `outline` draws during the build as an SVG path on the figure's own pixel
  grid (`viewBox = 0 0 W H`, `xMidYMid meet`, like the image's `object-fit: contain`). The path traces itself
  (`pathLength=1`, dash offset 1 → 0), a light tint settles in, it holds, then fades: same 2.6 s timing and per-part stagger
  as the box (`lb-outline-hold`, `lb-trace`, `lb-outline-fill` in `styles/live.css`). Dark shade + white halo + strong blue
  line, stroke widths kept in screen px whatever the figure size (`--ld-u`). Regions without an outline keep the box
  animation. The 50% confidence filter applies to both (`regionDrawing` in `lib/labelDiagramView.ts`). The outline SVG is
  rendered only while a build plays; base style hidden; paused while the figure image loads; no draw-in under reduced motion.
- **Unclaimed printed labels are not slots.** A label group no part claims (same text claim rule as the slots) gets state
  `muted`: a patch filled from the figure's own pixels around the label (`patchFills`: band medians of a 3 px ring, upper and
  lower halves faded into each other), no border, soft edge. It uncovers with the others (lesson: Show the answers;
  slides: the labels step). Applies to stored lessons.
- **Check names.** `STAGE6_CHECK_NAMES`: LD-10 "Every printed label the page names has a part", LD-11 "SAM was sure of every
  part’s region", LD-04 "Each number sits on its part, inside its area, not on the printed label". `lib/failures.ts` gains
  teacher clauses for LD-01..LD-11 (they fell back to "failed one of our checks" before).
- Dev only: `?engine-demo=c&tab=water-demo&build=outline|box` plays the draw-in with SAM 3.1's real traced masks from the
  mask probe (`lib/labelOutline.fixtures.ts`: `docs/evidence/sam-mask-probe/decoded.json`, box-local paths offset by each box's
  x1/y1, simplified at 1 px). Not in the production bundle (checked: 0 hits in `dist/assets`).

## Measurements
| Check | Result |
|---|---|
| Water-cycle lesson at rest (job-20261031081105-910f3776), 1920 / 2560 / 1366 | 6 label groups: 5 `covered` slots + 1 `muted` patch ("Snowmelt Runoff", fill read from the figure); 0 visible regions or outlines; document overflow 0 |
| Hover each of the 5 markers at rest | 0 visible regions every time |
| DNA lesson (job-20261031081105-21355f66), 1920 / 2560 | 6 slots, all claimed, 0 muted |
| Replay `?replay=…910f3776&speed=4&tour=0` | diagram arrives at 22.5 s; 4 boxes (evaporation 0.28 filtered) run, last one fades by ~4 s; 0 outlines (stored run has none); 1 muted patch + 5 slots |
| Outline harness, water cycle with SAM masks | 4 outlines, 0 boxes (evaporation not drawn); dash offset 1 → 0 within ~0.7 s of each part's delay, hold, opacity 0 / hidden by ~3.9 s; `getAnimations()` empty afterwards |
| Outline stroke at the 2560 lesson size (plate 745 px) | `--ld-u` 0.77; line 3 px on screen, halo 6, shade 8 |
| Image still loading (`data-img="loading"`) | outline group and paths `paused`; `running` once ready |
| `prefers-reduced-motion: reduce` | 0 visible outlines over 3.6 s |
| Presentation `?present=…910f3776&tour=0`, label beat (1920 and 2560) | steps 1–5 and the labels step before R: slot 4 `muted`; after the labels step's R: all 6 `open` (the printed "Snowmelt Runoff" shows) |

Tests: `node --test apps/web/src/lib/*.test.ts` 1,041 pass, 0 fail (new: `labelDiagramView.outline.test.ts`, 11 tests;
check-name and failure-sentence pins). `npm --prefix apps/web run build` passes. `impeccable detect` → `[]`.

## Frames
01/02 water lesson at rest (1920, 2560 downscaled) · 03 figure at rest, muted patch (2× crop) · 04 replay boxes drawing ·
05–07 outline trace, hold, after fade (harness, figure at 745 px) · 08/09 slide before and after the labels step's R ·
10 slide at 2560 · 11 DNA lesson at 2560.

## Open
- Stored lessons have no outlines, so the outline draw-in is verified on the harness with real SAM masks from the probe, not
  in a stored lesson; the first live run after slice S lands is the end-to-end check.
- The muted patch over "Snowmelt Runoff" sits on a sky gradient and the edge of the pale arrow: it reads as background, but a
  faint rectangle is still visible on close inspection.
