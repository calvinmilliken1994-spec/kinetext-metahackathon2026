# Spark Open vision probe (2026-11-02)

Calvin: "It's not possible for Spark Open to build Label the diagram? Double check if it's text-only." His example was
`job-20261031105714-1dd230e7` (water cycle on Spark Open: sequence + quiz, no diagram).

**Finding: it is not text-only.** The limit was ours. `packages/meta/client.ts` refuses images on non-Meta providers
(`IMAGES_NOT_SUPPORTED`), so the planner never offered Label the diagram to Spark Open. That was a design choice, never
tested.
- Meta's docs (dev.meta.ai/docs/muse-spark-open): "multimodal (text, image, audio, and video input; text output)", with
  images sent as `image_url` content parts.
- Our Modal shared endpoint, `GET /v1/models` (`models.json`): `input_modalities: ["text","image","video","audio"]`.

**Live test** (`probe.ts`, raw HTTP to the Modal endpoint, Meta's documented grounding box prompt, strict JSON schema,
reasoning high): both figures were accepted (360 and 441 image tokens), and both returned `finish: stop` with valid JSON.
The answers are in `result.json`; `sheet.jpg` shows the boxes.

| Part | Spark Open's box |
|---|---|
| Water: transpiration | 5 boxes, one per arrow: correct |
| Water: evaporation | 4 boxes on the arrows: correct |
| Water: condensation | the two small clouds: correct |
| Water: runoff | the red arrow at the stream: correct |
| Water: precipitation | the rain under the cloud, but also the mountain top (weaker than Spark 1.3) |
| DNA: adenine / thymine / guanine / cytosine | the colour bars: correct |
| DNA: base pairs | two rungs: correct |
| DNA: backbone | the whole helix: acceptable (SAM tightens it) |

Time: 41 s and 13 s (Spark 1.3 on the Meta API: 14 to 20 s). Usage: 740 in / 5,895 out and 843 in / 2,292 out tokens,
about USD 0.04 of Modal credit.
