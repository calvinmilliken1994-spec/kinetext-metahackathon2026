# Figure-label reading eval (teacher diagram beta)

Muse Spark reads the printed labels of a teacher's diagram and returns line boxes on a 0..1000 grid
(`packages/meta/figure-labels.ts`). Those boxes become the covers that hide the answer labels in Label the diagram, so
a cover that misses part of a word gives the answer away. This folder scores Muse's real answers for the 10 library
figures against their lead-verified OCR boxes, offline (no calls).

- `raw/<id>.json`: Muse Spark 1.3's saved answers (same prompt and schema as the worker; `probe.ts` made them).
- `png/<id>.png`: lossless PNG copies of the library figures (the web app re-encodes every teacher upload as PNG, so
  the snap step only ever sees PNG).
- `score.ts`: `node docs/evidence/figure-labels-eval/score.ts` scores the converted Muse boxes (`score.json`);
  `--refine` runs `refineLabelBoxes` (`packages/meta/figure-label-refine.ts`) first (`score-refined.json`).

## Measures

- **Fully covered**: an OCR text box with at least 98% of its pixels inside the union of the boxes. "Part" boxes are
  the labels of curated `partLabelGroups` (the ones that can become hidden answers).
- **Area ratio**: for each OCR text box, the box overlapping it most; mean of that box's area / the OCR box's area
  (also for part boxes alone).
- **Cross-label overlaps**: boxes whose own label is the OCR group they overlap most and that also cover at least 10%
  of an OCR box of another group ("any pixel": any shared pixel at all).
- **Duplicate boxes**: pairs of boxes of different labels sharing at least half of the smaller one.

## Results (2026-11-03)

| | Muse boxes as converted | Snapped (`--refine`) |
|---|---|---|
| Part boxes fully covered | 12/21 | **20/21** |
| All text boxes fully covered | 53/172 | **117/172** |
| Mean box / OCR box area (154 matched) | x1.87 | x1.93 |
| ... part boxes only | x1.43 | x1.29 |
| Cross-label overlaps (>= 10% of another label) | 19 | 16 |
| ... any shared pixel | 33 | 26 |
| Duplicate boxes (two labels on one text) | 0 | 5 |

Per figure (part boxes, all boxes):

| Figure | Before | After | Part misses after |
|---|---|---|---|
| medlineplus-dna-structure-1 | 5/6, 5/6 | 5/6, 5/6 | Sugar phosphate backbone 85% (see below) |
| medlineplus-protein-production-1 | -, 2/11 | -, 11/11 | |
| nasa-grc-airplane-parts-1 | 1/4, 5/12 | 4/4, 11/12 | |
| nasa-grc-forces-of-flight-1 | -, 11/25 | -, 16/25 | |
| nasa-grc-gas-properties-1 | -, 4/19 | -, 10/19 | |
| nasa-grc-glide-trajectory-1 | -, 1/19 | -, 14/19 | |
| nasa-grc-wright-engine-combustion-1 | -, 8/42 | -, 18/42 | |
| noaa-global-circulation-cells-1 | (no OCR text) | (no OCR text) | |
| noaa-hydrologic-cycle-1 | 2/5, 2/6 | 5/5, 5/6 | |
| usgs-volcano-hazards-1 | 4/6, 15/32 | 6/6, 27/32 | |

**The one part miss.** The DNA figure's OCR box for "Sugar phosphate backbone" is ONE block over both printed lines
(304..448 x 401..441); the second line ("backbone") ends at x 387, so the block's lower-right corner is blank paper.
Muse gives one box per line, the snap covers both lines' ink, and the 15% left uncovered is that blank corner (before:
92%, because Muse's first-line box ran 30 px past the end of the text). No word of the label shows. Widening a
multi-line label's boxes to a block would score 21/21 but was not done: the volcano figure's curated multi-line labels
are per line, so that would be tuning to one figure's curation.

**Remaining non-part misses (55).** 23 are at most 10% covered after the snap, 22 of them also before: text Muse
never boxed or boxed far away (the volcano scale ticks 68/63/53/0, rows Muse put half a line off in the
forces-of-flight table, the engine figure's split labels). The rest are partial: Muse's box sat between two printed lines so the snap chose
one of them (forces-of-flight "Plane Falls" 100% -> 72%, airplane "Cockpit" 51% -> 21%), or the OCR box keeps a wider
margin than the 30%-of-line-height pad (volcano "Lava Dome Collapse" 100% -> 95%, gas "Macro" 86% -> 71%). Two boxes
that were fully covered are not after the snap (Plane Falls, Lava Dome Collapse); 66 were not and are.

**Size and overlaps.** Snapped boxes are trimmed to the ink and re-padded, so part covers got smaller (x1.43 ->
x1.29); the all-box mean rises slightly (x1.87 -> x1.93) because a few boxes on cluttered figures grow over a whole
formula or two-word row (glide trajectory x1.25 -> x2.35). Cross-label overlaps fall 19 -> 16 (any-pixel 33 -> 26); per
figure they rise on the volcano (0 -> 2: the OCR boxes of "Rhyolite" and "Dacite" already overlap each other, so any
correctly padded cover touches both) and the glide figure (2 -> 3). The 5 duplicate pairs are all a snapped box on its
own text next to a Muse box left unsnapped between two lines (the de-duplication rule below keeps Muse's box when the
snapped place is taken; it does not move the other one).

## Method (`packages/meta/figure-label-refine.ts`)

Deterministic, no calls, no new dependency (`png-decode.ts`: node:zlib, 8-bit colour types 0/2/3/4/6, all five
filters, alpha composited on white; interlaced, 16-bit and malformed files return null and every box stays as read).
Per box:

1. Undo the conversion padding to get Muse's line box (w x h).
2. Search window: +/-60% of w sideways (at most 60 px), +/-50% of h vertically, plus the growth margins.
3. Lettering ink: a pixel differs from its LOCAL background (per-channel median of h-sized tiles, then the median over
   each 3 x 3 tile block) by at least half the 90th-percentile contrast inside Muse's own box, kept within 24..80 (pale
   white-on-sky labels still count; a label on a coloured blob is measured against the blob). Of the 4-connected ink
   pieces only letter-like ones stay: at most 1.8 h tall; not long and thin (> 3 h wide and < h/3 tall); not wide and
   solid (> 2 h wide and > 85% filled); a piece wider than 1.5 h must cross at least 2.5 strokes per row (joined or
   outlined letters do; leader lines, edges, outlines and bars do not).
4. Placement (Muse's size): maximise stroke starts inside the box (lettering is many narrow strokes per row) minus the
   ink columns the box's top and bottom edges cut through; ties go to the smallest shift.
5. Extent: only pieces centred on the placed rows count. Columns are trimmed to the first/last inked column inside the
   box, then grown across gaps up to 0.4 h, both sides sharing a budget of 2 x max(40% of w, 2 h); rows are the inked
   run around the inkiest row (at least 2% of its ink), at most 30% of h beyond the box.
6. Pad with the figure-labels.ts rule (30% of the line height, at least 3 px, outward, clamped), the line height being
   the taller of the inked rows and Muse's own line.
7. Keep Muse's box when no lettering is in reach or the lettering found spans under 40% of Muse's width or height.
8. Two labels never share their printed text: boxes settle from the least moved to the most moved; a box landing on at
   least half of a settled box is searched again with that lettering removed, else stays as Muse placed it.

Speed (this machine): a 1600 x 1600 RGBA PNG with 60 label boxes takes about 0.5-0.7 s including the decode (about
0.2 s); the 10 library figures take about 0.35-0.55 s in total. Every run gives the same boxes.

Wired in `workers/generation/lesson.ts` (labels step): a PNG teacher figure's boxes are snapped before
`<id>.labels.json` is written; a JPEG's are not. The `method` line ends with "; boxes snapped to the printed text",
"; boxes as Muse placed them (JPEG, not snapped)" or "; boxes as Muse placed them (PNG not decodable, not snapped)".
