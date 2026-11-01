# SAM 3.1 mask probe (2026-11-02)

Calvin asked whether SAM can trace accurate outlines instead of boxes ("go ahead with the filter and the probe").

**Call:** ONE live `sam-3.1` request through the project ledger (`purpose: test-live`). It used the NOAA water-cycle figure
(`noaa-hydrologic-cycle-1`, 572×504) and the same five point prompts as the stored run `job-20261031081105-910f3776`
(revision 2). Cost: $0.0025 (1 image). Latency: 3.9 s. Script: `probe.ts`. The key was read from the environment and never printed.

**Result**
- SAM returned the same five boxes and confidences as the stored run (deterministic for the same prompt).
- Every record also carries a **mask**: `data=<H>,<W>,~<base85>`, a lossless raster of the box area. Our client keeps only the box.
- Meta publishes the decoder: `@meta-sam/parser` 0.1.0 (npm, zero dependencies, SAM License). `decodeMaskToRaster` gives a
  0/1 raster (H×W, row-major, box-local) and `decodeMaskToSVGPath` gives an SVG outline. Both decoded all five masks
  (tried in a scratch folder; not added to the repo).
- `overlay-masks.jpg`: the masks painted on the figure. Red: evaporation. Yellow: transpiration. Green: condensation.
  Blue: precipitation. Purple: runoff.

| Part | Confidence | What the mask covers |
|---|---|---|
| evaporation | 0.28 | Scattered patches of green land around the lake: not the arrows, not the water. Weak, as the score says. |
| transpiration | 0.82 | Exactly one rising red arrow beside the trees (traced shape). |
| condensation | 0.79 | The right half of the cloud, following its outline. |
| precipitation | 0.65 | The lower part of the rain cloud, following its outline. |
| runoff | 0.93 | Exactly the small pink arrow (traced shape). |

**Conclusion:** masks are real traced shapes and decode with Meta's own library, so drawing outlines is feasible. Weak
regions stay weak: confidence is a good guide to which ones to draw.

Files: `raw-output.txt` (SAM's raw text), `result.json` (boxes, cost, latency), `decoded.json` (pixel counts, fill
ratios and SVG paths per mask; box-local coordinates).
