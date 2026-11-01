# Stage 8c Addendum A: build glow = SAM's box, Muse grounding narration (web)

Calvin (2026-11-02): "keep the box drawing to the models only, no hand drawn by us boxes, do your best to have cleaner
demo boxes". Boxes around whole parts during the build only, no thin traced outlines.

## What changed (apps/web/src only)

- `lib/labelDiagramView.ts`: `regionDrawing` always returns SAM's region box (never the traced outline). The 0.5
  confidence rule (`regionToDraw`) is unchanged. Stored `outline` strings are still parsed onto `PartView.outline`
  (`isOutlinePath`, `outlineToDraw` kept), so no stored data breaks. New `glowStyle(box, pad = GLOW_PAD_PX = 4)` grows
  SAM's box by 4 layout px per side so the glow never cuts the drawing.
- `components/LabelDiagramView.tsx`: region spans are rendered only while a build plays (`build`), positioned with
  `glowStyle`. The outline SVG overlay and its stroke-unit hook are gone. At rest, on hover and on slides there is no
  region in the DOM (checked: lesson `?job=` 0, after hovering a marker 0, `?present=` slide 0).
- `styles/engines-c.css` + `styles/live.css`: the glow. Rounded 12 px box, 14% accent wash, 2 px line in a lighter
  accent (`color-mix(var(--accent) 78%, white)`), a faint white rim and an 18 px accent glow
  (`--ld-glow-*` tokens, all from `--accent`). Keyframes `lb-glow`: fades and settles in (scale 0.96 to 1, the glow grows),
  holds, fades out; same 2600 ms, the same per-part stagger (180 ms), image-load pause and reduced-motion rule
  (no animation, nothing shown). The old `lb-outline`, `lb-trace` and outline styles are removed.
- `lib/liveBuild.ts`: `parseGrounding(detail)` reads `; muse-spark-1.3 located K of N part(s) for SAM` (any note order)
  or `grounding failed`; `parseSegmentGot` is exported. A grounded SAM line reads
  `Muse Spark located 5 parts · SAM 3.1 confirmed 5 of 5 in 1.9 s` (`located 4 of 5 parts` when Muse found fewer;
  K = SAM's regions returned). A failed grounding call and older runs keep `SAM 3.1 outlined 5 of 5 parts in 1.9 s`.
  `figureNote` returns a `muse` part, and `components/LiveBuild.tsx` shows **Muse Spark** located 5 parts ·
  **SAM 3.1** confirmed 5 of 5 in 1.9 s in the figure frame.
- Dev harness: `?engine-demo=c&tab=water-demo&build=grounded` plays the water-cycle demo-set part with SAM's boxes from
  the Muse grounding probe (`lib/labelGrounding.fixtures.ts`, copied unchanged from
  `docs/evidence/muse-grounding-probe/result.json`, water cycle rep 2, 572 x 504). Not in the production bundle.

## Tests

- New: `lib/labelDiagramView.glow.test.ts` (box always, weak none, padding, probe boxes),
  `lib/liveBuild.grounding.test.ts` (exact Addendum A details incl. the appended retry text, notes in either order,
  1 part, failed grounding, old runs, figure note). Updated: `labelDiagramView.outline.test.ts` (outline no longer drawn).
- `node --test apps/web/src/lib/*.test.ts`: 1051 pass, 0 fail. `tsc -p apps/web --noEmit` clean.
  `npm --prefix apps/web run build` OK. impeccable `detect --json apps/web/src apps/web/index.html`: 0 findings.

## Screenshots (frozen at the hold moment with the Web Animations API: each glow's `currentTime = delay + 1100 ms`)

| File | What it shows |
|---|---|
| `grounded-water-1920-window.jpg`, `grounded-water-1920-figure.jpg` | Harness, probe boxes: five glows (rising arrows x2, the cloud, the rain, runoff) on sky and grass, 1920x1080 |
| `grounded-water-2560-window.jpg`, `grounded-water-2560-figure.jpg` | Same at 2560x1440 |
| `dna-demo-1920-figure.jpg` | DNA demo-set run on the white figure: backbone box and the adenine/thymine bar glow; weak guanine/cytosine draw nothing |
| `replay-water-{1920,2560}-hold-window.jpg`, `-hold-figure.jpg` | `?replay=job-20261031081105-910f3776&speed=4&tour=0` (old run, SAM boxes from points): 4 confident regions glow, evaporation (0.28) none |
| `replay-water-{1920,2560}-after-fade-figure.jpg` | Same figure after the fade: only numbers and slots |
| `narration-grounded-{1920,2560}-frame.jpg`, `narration-grounded-1920-figure-note.jpg` | The SAM line and figure note on the same replay with a page-side fetch shim that appended `; muse-spark-1.3 located 5 of 5 part(s) for SAM` to the stored SAM details (the stored run has no grounding call; GET only, nothing written) |

Natural playback log on the replay (1920, no freezing): paused while the image loaded, then each glow 0 to 1 within
~0.4 s in part order, held ~1.4 s, faded, and every region computed `visibility: hidden` ~4 s after arrival.
Reduced motion: `animation-name: none`, hidden.

## Open issues

- "confirmed K of N" counts SAM's returned regions; the detail has no confidences, so a weak region (< 0.5, not drawn)
  still counts. The glow can show fewer boxes than K.
- The old replay run still shows its point-based SAM boxes (thin transpiration box, precipitation on the cloud). Clean
  boxes need runs made with the grounding worker.
- Adenine and thymine on the DNA demo-set run share almost the same SAM box, so their glows stack into one.
