# SAM 3.1 prompt-style probe (2026-11-02)

Question: how do we get SAM to be sure of the water cycle's EVAPORATION part? In the stored run
`job-20261031081105-910f3776`, Muse's single point sat between two of the five rising arrows. SAM returned a 0.28 region
of scattered land.

Five live `sam-3.1` calls on `noaa-hydrologic-cycle-1` (572×504), through `packages/meta/sam.ts` and the project ledger.
A fetch wrapper swapped in each prompt; the grammar comes from Meta's `@meta-sam/parser` `buildObjectPrompt`. Cost: 5 ×
USD 0.0025 = USD 0.0125. Script: `probe.ts` (round 2 via `PROBE_ROUND=2`). The key was never printed.

| Prompt | Confidence | Box (px) | Mask (see `variants.jpg`, left to right) |
|---|---|---|---|
| One point on one arrow (166,375) | 0.79 | 162–171 × 323–426 | Exactly that arrow |
| Four points, one per arrow | 0.62 | 137–197 × 309–426 | Four arrows plus green land between them |
| Box around four arrows (147–200) | 0.70 | 150–197 × 309–426 | Those four arrows, clean |
| **Box around all five arrows (135–200)** | **0.74** | 136–197 × 310–426 | **All five arrows, clean** |
| Same box plus one point | 0.62 | 136–197 × 309–426 | Same mask, lower confidence |

**Decision (STAGE-8c):** prompt SAM with a box around all of a part's drawn pieces (Muse's new area box), and fall back to
the point when there is no area. Weak regions are caught by the new LD-11 confidence check and repaired.

Files: `raw-*.txt` (SAM's raw output per variant), `result.json` / `result-round2.json`, `variants.jpg` (masks painted on
a crop of the figure).
