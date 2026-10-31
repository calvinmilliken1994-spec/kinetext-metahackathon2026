# Stage 8b live runs 1–2: Label the diagram (Muse Spark 1.3 + SAM 3.1), 2026-10-31

## Run 1 (prompts s6-v9): 9 lessons, one per figure page, USD 1.13
Every lesson published its other part.

| Page | Job | Parts |
|---|---|---|
| medlineplus-what-is-dna | job-20261031045623-2f409912 | sort-groups ✓, label-diagram ✗ |
| noaa-jetstream-hydrologic-cycle | job-20261031050013-fb80308a | label-diagram ✗, sequence ✓ |
| usgs-wss-ph-and-water | job-20261031050023-fbb9b82f | label-diagram ✗, log-ladder ✓ |
| 6 other figure pages | see `batch8b.jsonl` in scratch | label-diagram not planned |

Muse planned label-diagram on 3 of 9 pages. All 3 failed for two defects in Muse-authored code and prompts:
- **SAM HTTP 400 on every call.** `segmentPoints` sent an invented body. The fake-fetch tests only checked the code against itself, and the worker test asserted the same invented shape.
- **Invented figure IDs.** The generation message never stated the figure ID, so Muse made one up (e.g. `dna-double-helix`).

Fix: Muse s8b-m8 changed the request to the documented Responses shape (`input_text` + `input_image` data URL) and added the figure ID to the generation and repair messages. The lead corrected the worker test to assert the documented shape.

## Run 2 (after m8): 3 lessons, USD 0.50
SAM worked on all 9 calls (1.7–2.5 s, USD 0.0025 each). Every label-diagram still failed, for honest quality reasons; see the overlays (dots are Muse's points, thin boxes are its printed-label boxes, thick boxes are SAM regions):

| Figure | Job | Failure |
|---|---|---|
| Water cycle | job-20261031050706-c723eaba | LD-06: the evaporation point is 1 px outside a thin arrow's box. The precipitation point sits on the printed word, and its label box is about 35 units too low. |
| DNA | job-20261031050706-3121abfc | 'double helix' (the whole drawing) and 'nucleotide' (no single drawn shape): one region covers 67% of the image and one returns nothing. Label boxes drift downward. |
| pH scale | job-20261031050706-dc84cbe5 | Bands of one continuous colour bar, so regions overlap (LD-07 IoU 0.69–0.88). |

Changes after run 2:
- Lead: LD-06 now accepts a point within 2% of the image's longer side of its region (`KIT_LIMITS.labelDiagram.pointToleranceFraction`).
- Lead: the pH figure is removed from the label set.
- Muse s8b-m9: design text s6-v10 (separately drawn parts only, points at the visual centre on ink, one tight label box per printed label).

## Run 3 (prompts s6-v10, LD-06 tolerance): 4 lessons, USD 0.54
| Page | Job | Label the diagram |
|---|---|---|
| Water cycle | job-20261031051459-dbf3765c | ✓ first try (5 parts) |
| Water cycle | job-20261031051634-7731ba24 | ✓ first try (6 parts) |
| DNA | job-20261031051459-6bf49d3d | ✓ first try (6 parts) |
| DNA | job-20261031051459-cb750300 | ✗ LD-06: the 'base pairs' point gave a region covering 98% of the image; two repairs left the points unchanged |

3 of 4 published. Lead check of the DNA lesson in presentation mode:
- The flow works with real SAM regions.
- **Answer leak:** Muse's label boxes sit slightly off the printed text, so "Sugar phosphate" and the ends of "Guanine"/"Cytosine" stay readable beside their covers.
- Name tags collide on the reveal step (the 'Adenine' tag sits under 'Thymine').
- The figure renders small on the slide.
- Repairs of LD-06 do not move points: the r2/r3 revisions are identical, so 2 calls are wasted.

## Run 4 (stored label boxes `aa29e74`, view `99e34d2`, LD-04 against the stored boxes `f310d16`): 4 lessons, USD 0.58
| Page | Job | Label the diagram |
|---|---|---|
| Water cycle | job-20261031081105-910f3776 | ✓ after 1 repair: the 'Precipitation' point moved off the printed word (785,350 → 770,195) |
| DNA | job-20261031081105-7f36a25b | ✓ after 1 repair: the 'guanine'/'cytosine' points moved off the printed words |
| DNA | job-20261031081105-21355f66 | ✓ after 1 repair: the 'Adenine'/'Thymine'/'Guanine'/'Cytosine' points moved up onto the bars |
| Water cycle | job-20261031081231-13a0eceb | ✓ after 1 repair: the 'Precipitation' point moved off the word |

**4 of 4 published.** Each failed LD-04 on revision 1 (a point on a printed word, caught with the stored boxes) and was fixed by one natural repair, in which Muse moved only the flagged points. Every published spec carries its figure's stored `labelBoxes` (DNA 7, water cycle 8).

Lead check in presentation mode (`run4-dna-present-revealed.png`): before R, every printed label is covered. Reveals step part by part with SAM outlines and non-overlapping name tags.
