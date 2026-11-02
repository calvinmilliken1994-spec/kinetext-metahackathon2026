# SAM figure candidates (2026-11-02)

Calvin asked for figures on which SAM 3.1 does a clean, accurate job, for Label the diagram and the video. An offline-reviewed live probe (`probe.ts`, one dedicated Muse Spark 1.3 grounding call + one SAM 3.1 box-prompt call per figure, `result.json`) scored three public-domain figures. Two of them were then added to the library as new source pages with figures. No live calls were made after the probe.

## Files

| File | What it is |
|---|---|
| `probe.ts` | The live probe (Muse grounding → SAM box prompts), run once by the lead. |
| `result.json` | Probe output: Muse boxes, SAM regions with confidence, receipts and cost per figure. |
| `raw-*.sam.txt` | Raw SAM 3.1 stream text per figure (boxes + masks). |
| `overlay-*.jpg` | Probe overlays (Muse boxes and SAM regions on the figure). |
| `nasa-grc-airplane-parts.jpg` | ORIGINAL NASA Glenn figure as served (1168×765, sha256 `4df708e4…2751bf3`), with the NASA insignia. Kept as evidence only; never served to a model by the product. |
| `usgs-volcano-hazards.png` | USGS figure as served (699×816, sha256 `68656464…652ee3cb4`); byte-identical to the stored library copy. |
| `nasa-grc-rocket-parts.png` | Third probe figure; not added (weaker scores). |
| `deinsignia.py` | The script that removed the NASA insignia (run on the original saved as `plane.jpg`; prints every measured number). |
| `build_text.py` | Builds the two `.txt` transcriptions from the fetched HTML (main article text only). |
| `ocr.ps1`, `merge_ocr.py` | Windows built-in OCR (copy of the lead's script) and the 1x + 2x merge that produced the printed-label boxes. |
| `labels-<figureId>.jpg` | The stored figure with every stored label box FILLED (dark blue = curated `partLabelGroups`, grey = muted), group numbers in white. |
| `labels-<figureId>-boxes.jpg` | 2× figure with box outlines and group numbers (`*` = a box that carries no `text`). |
| `labels-<figureId>-sheet.jpg` | Zoomed (3×) contact sheet of every covered box with a 12 px margin, used to check that no letter peeks out. |

## Probe result (SAM 3.1 confidence per part, Muse grounding box as the prompt)

| Airplane part | SAM | | Volcano part | SAM |
|---|---|---|---|---|
| wing | 0.96 | | magma | 0.96 |
| aileron | 0.89 | | lava dome | 0.88 |
| vertical stabilizer | 0.88 | | landslide | 0.81 |
| horizontal stabilizer | 0.86 | | ground water | 0.80 |
| fuselage | 0.78 (box = whole airplane) | | eruption cloud | 0.73 |
| flaps | 0.76 | | lava flow | 0.55 |
| jet engine | 0.73 | | eruption column | 0.48 |
| rudder | 0.67 | | bombs | 0.43 |
| elevator | 0.47 | | fumaroles | 0.37 |
| spoiler | 0.31 | | vent | 0.29 |
| cockpit | 0.30 | | | |
| slats | 0.26 | | | |

The probe ran on the ORIGINAL airplane image (with the tail meatball). The stored copy differs only in the meatball area on the vertical stabilizer and the bottom-right logo; live builds run on the stored copy.

## New library pages

| Source id | Subject | Figure id | Stored image |
|---|---|---|---|
| `nasa-grc-airplane-parts-function` | physics (as the other NASA Glenn aeronautics pages) | `nasa-grc-airplane-parts-1` | JPEG 1168×765, insignia removed |
| `usgs-volcano-hazards` | earth-science | `usgs-volcano-hazards-1` | PNG 699×816, exact served bytes |

The USGS page is the HTML edition of Fact Sheet 002-97 (revised March 2008) at `https://pubs.usgs.gov/fs/fs002-97/old%20html%20files/`; the root `/fs/fs002-97/` now serves a directory index. The fact sheet says it is superseded by Fact Sheet 2018-3075.

## NASA insignia removal (airplane figure)

NASA does not permit its insignia (meatball, worm, seal) with AI-generated imagery. The original prints the meatball on the airliner's tail and a meatball with "Glenn Research Center" at the bottom right. `deinsignia.py`:
1. Tail meatball: circle centre (775, 214.5), radius 16.5 px, painted with a 2 px rim (x 757..798, y 196..233, 1,156 px, including the red chevron's faint ends outside the circle). Filled with the vertical-stabilizer blue sampled from a ring around it (RGB 67,110,225). Chevron pixels outside the circle took the nearest untouched pixel. The dark rudder strip, which the meatball overlapped, ends with a straight cut at y = 199 (its visible end), so the fin's edges stay intact.
2. Bottom-right logo block (ink x 906..1151, y 715..757): filled with the background white (RGB 254,254,254) over x 900..1159, y 706..761. Nothing else is printed in those rows.
3. Same width and height, so every coordinate on the original (probe boxes) still applies. Re-saved as JPEG q95 4:4:4. The original's EXIF/XMP (XMP creator "NASA Glenn Research Center") was not carried over. No label, arrow or drawn part was changed.

The figure JSON records this in `modified`, and its `license`/`licenseEvidence` quote the NASA media guidelines including the "Super Intelligence (SI) Applications" (AI-use) section, re-fetched 2026-11-02. A by-eye check of the stored copy found no NASA insignia, logo or "Glenn Research Center" text left.

The volcano figure was checked the same way. It has no logo, insignia, visual identifier, signature or credit line, so it is stored unedited. The credit is "U.S. Geological Survey/graphic by Bobbie Myers" (USGS's requested pattern). The fact sheet prints "Graphics by Bobbie Myers, Sara Boore, and Susan Mayfield", the file is `volcBMeyers.png`, and the USGS Publications Warehouse lists Bobbie M. Myers as a USGS (Cascades Volcano Observatory) author.

## Printed-label boxes (`data/figures/<id>.labels.json`)

Method (as in `docs/evidence/stage-8b/label-boxes/README.md`, without SAM concept prompts because no live calls were allowed):
1. Windows built-in OCR on the STORED image at 1× and at a 2× LANCZOS upscale (coordinates halved).
2. OCR lines were split where the word gap exceeds 1.2× the text height. Boxes from both scales with IoU > 0.25 were unioned and padded by 3 px.
3. Both figures were rendered with filled covers and checked by eye, whole and as a zoomed per-box contact sheet. OCR had found every printed line at one scale or the other: "68" and the scale's "0" only at 2×; "Generate Li", "Fuselage Body)" and "Hold Things ogether" were misread, but their boxes already span the whole line. **No box was added by hand.** No letter is left readable on either overlay.
4. Text and group were read by eye against the numbered overlay, not copied from OCR.

| Figure | Boxes | Printed labels (groups) | Curated `partLabelGroups` |
|---|---|---|---|
| `nasa-grc-airplane-parts-1` | 29 | 12 (part name + its red function line(s) per group) | 1 Vertical Stabilizer, 3 Horizontal Stabilizer, 5 Wing, 6 Flaps, 8 Aileron |
| `usgs-volcano-hazards-1` | 33 | 29 (every hazard label, Prevailing Wind, Crack and the whole silica/magma-type scale: headings, 100% / 68 / 63 / 53 / 0 and the four rock names) | 1 Eruption Cloud, 5 Landslide, 11 Lava Dome, 16 Ground Water, 28 Magma |

**Boxes without `text` (lead to confirm).** A group's texts are joined into the one printed label that LD-02 and LD-10 check and that the worker sends to Muse. Giving the airplane's red function lines text would make, for example, "Wing Generate Lift". The page-wording rule then falls back to its last word ("lift"), so Muse would be told "Wing Generate Lift (the page calls it lift)". So these boxes keep their group (one slot covers the whole printed label, robust to Muse's low label boxes) but carry no `text`: the function lines, and the "(Debris Avalanche)" line of "Landslide (Debris Avalanche)" (joined, it would fall back to "avalanche"). Their words are listed in each sidecar's `method`. Checked with the real loaders: the curated printed labels sent to Muse are exactly `Vertical Stabilizer, Horizontal Stabilizer, Wing, Flaps, Aileron` and `Eruption Cloud, Landslide, Lava Dome, Ground Water, Magma`, each named whole by its page.

**Curation rule:** keep a label only if (a) the page text names it, whole or by its last word (`pageWordingOfLabel`), and (b) SAM was sure of the part in the probe (≥ 0.73).
- Airplane, dropped:
  - Jet Engine (0.73): the page says only "jet engines" / "turbine engines", and the page-wording rule has no plural folding, so it returns null.
  - Fuselage (0.78): SAM's box swallowed the whole plane.
  - Rudder, elevator, spoiler, cockpit, slats: below 0.73.
- Volcano: all five candidates are named whole by the page, so none was dropped.
