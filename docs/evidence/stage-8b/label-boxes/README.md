# Stored printed-label boxes (Stage 8b, 2026-10-31)

**Why.** In live run 3, Muse's own label boxes sat slightly off the printed words, so parts of answers ("Sugar phosphate", the ends of "Guanine" and "Cytosine") stayed readable beside the covers. The covers now come from boxes measured once per figure and stored next to it (`data/figures/<id>.labels.json`). Every printed label is hidden whatever Muse writes. Muse's boxes still have to pass LD-05.

**How the boxes were measured** (one-off, lead):
1. Windows' built-in OCR (`Windows.Media.Ocr`) ran on each figure at original size and at 2× upscale. Words on one baseline were split when the gap exceeded 1.2× the text height.
2. SAM 3.1 concept prompts `word` and `label` ran on each figure: 16 images, USD 0.04, outside the ledger. SAM's text recall was uneven (0–16 boxes per figure). It found "Sugar phosphate backbone" where `word` missed it, and both concepts returned nothing on three figures.
3. The boxes were merged (IoU > 0.25) and padded by 3 px. Credit lines ("U.S. National Library of Medicine") were left uncovered.
4. Every figure was rendered with filled covers and checked by eye. The lead added 9 boxes by hand for coloured or italic words OCR missed ("Lift", "Drag" and "Accelerates" in the flight table; "Large" and "Macro"; "h"; "Stage" ×2; "Exhaust").

Overlays: `medlineplus-dna-structure-1.png`, `noaa-hydrologic-cycle-1.png`, `cov-sheet2.png` (four NASA figures).

`noaa-global-circulation-cells-1` has no printed words (its labels are the digits 1–3; `labelsInImage` false), so it has no boxes.

Each sidecar carries the image sha256, so a changed image yields no boxes. The loader is `loadFigureLabelBoxes` in `packages/sources/figures.ts`, and its test is `figures.labels.test.ts`.

**Repair waste fix (same change):** a label-diagram repair that returns the same gen now ends the loop, because it cannot change SAM's result. In live run 3, two repairs returned identical revisions.
