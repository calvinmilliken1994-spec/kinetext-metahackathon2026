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
