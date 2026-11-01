# Muse grounding probe (2026-11-02)

Question (Calvin: "keep the box drawing to the models only... cleaner demo boxes"): Muse's area boxes, written
inside the long label-diagram generation call, were noisy run to run. In round 2 they sat low, clipped the arrow tips and
put precipitation on the mountain. On DNA they boxed the printed words "Guanine"/"Cytosine" instead of the bars. Meta's
image-understanding docs say Muse "grounds best from an uncluttered prompt", with the documented "object grounding
expert" box prompt.

Probe (`probe.ts`): one dedicated Muse Spark 1.3 grounding call per figure, with Meta's documented box prompt. It lists
each part as "the drawn <name> that the printed label '<label>' points to", says to box the drawing not the label text,
and asks for one box per piece. SAM 3.1 then gets the union of Muse's boxes (4% margin) as a box prompt. Two repeats
each on the water cycle and DNA. The first attempt hit the 4,000-token output cap on reasoning alone ($0.018, no
result), so the cap was raised to 16,000. Total cost of the four runs: USD 0.0905 (ledger).

Result (`sheet.jpg`: red = Muse boxes, blue = SAM box with confidence):

| Part | Run 1 | Run 2 |
|---|---|---|
| Evaporation | 5 boxes, one per arrow; SAM 0.77 on all five | same, 0.77 |
| Transpiration | 5 boxes; SAM 0.82 | same, 0.82 |
| Condensation | the cloud (slightly wide); 0.75 | the cloud; 0.62 |
| Precipitation | the rain under the cloud; 0.68 | same; 0.76 |
| Runoff | red arrow + stream; 0.34 | same; 0.92 |
| DNA guanine / cytosine | the colour bars; 0.92 / 0.92 | same |
| DNA adenine / thymine | the bars; 0.91 / 0.91 | slightly above the bars; 0.45 / 0.56 |
| DNA base pairs | one rung; 0.83 | one rung; 0.71 |
| DNA backbone | the helix; 0.75 | the helix; 0.81 |

Decision: add a dedicated Muse grounding call to the label-diagram build (STAGE-8c addendum). SAM is prompted with its
boxes, the build glow shows SAM's box, and weak regions are still caught by LD-11.
