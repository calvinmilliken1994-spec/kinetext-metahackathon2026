# Stage 8c: every printed label covered, confident SAM regions, traced outlines

Status: FROZEN by the lead, 2026-11-02 (Calvin: "Go ahead with all of it"). Builds on `STAGE-8b-label-diagram.md`.

## Why
1. A figure printed six labels and the lesson used five, so a sixth blank slot could never be filled
   ("it just seems like it doesn't work").
2. SAM's evaporation region was 28% sure and covered scattered land. Cause: Muse's single point sat
   between two arrows.
3. Regions are rectangles. SAM also returns each region's traced mask, which we discarded.

## Evidence (probes, 2026-11-02)
- `docs/evidence/sam-mask-probe/`: masks decode with Meta's `@meta-sam/parser` (`decodeMaskToRaster`,
  `decodeMaskToSVGPath`); confident regions trace the real shape.
- `docs/evidence/sam-prompt-probe/`: the same evaporation arrows prompted 5 ways.

  | Prompt | Confidence | Mask |
  |---|---|---|
  | One point between arrows (stored run) | 0.28 | Scattered land |
  | One point on one arrow | 0.79 | That one arrow |
  | Four points, one per arrow | 0.62 | Four arrows plus land between them |
  | Box around four arrows | 0.70 | Those arrows, clean |
  | **Box around all five arrows** | **0.74** | **All five arrows, clean** |
  | Same box plus one point | 0.62 | Same, less sure |

  Decision: SAM gets a **box prompt** per part (Muse's area box), falling back to the point when a part has no area.

## Frozen shapes (contracts, `packages/contracts/kit.ts`)
- `LabelPartGen` gains OPTIONAL `areaX1?`, `areaY1?`, `areaX2?`, `areaY2?`: number (normalised 0..1000). They give a box
  around ALL drawn pieces of the part (all five arrows, the whole cloud), never its printed label. They are optional in
  the TS type (stored lessons lack them) and REQUIRED in the gen schema Muse receives (`scripts/build-schemas.ts`).
- `LabelRegion` gains OPTIONAL `outline?: string`. It is an SVG path (`M x y L x y … Z`, absolute IMAGE pixels,
  coordinates rounded to 0.5 px, simplified at 1 px tolerance) tracing SAM's mask. It is at most 6000 characters and is
  omitted when decoding fails or the path is longer.
- `LabelFigureRef` gains OPTIONAL `partLabelGroups?: number[]`: the label `group` numbers that name drawn parts
  (lead-curated in `data/figures/<id>.labels.json` as `"partLabelGroups": [...]`). Absent means LD-10 is skipped for that
  figure.
- `KIT_LIMITS.labelDiagram.minRegionConfidence = 0.5`.
- New checks in `STAGE6_CHECKS`:
  - `'LD-10': 'labels-covered'`: every printed label in `partLabelGroups` whose words the page text names is claimed by a
    part, or as many as `parts.max` allows. The page names a label when its text, normalised, is a whole phrase of the
    normalised source text. Normalising lowercases, turns hyphens and other punctuation into spaces and collapses runs of
    spaces. A part claims a label when its label box overlaps that group's boxes, the same rule as LD-02. A label the page
    never names (e.g. "Snowmelt Runoff") is not required.
  - `'LD-11': 'regions-confident'`: every SAM region with a numeric `confidence` has confidence ≥ `minRegionConfidence`.
- LD-04 (`points-valid`) is extended: when a part has area fields, they are integers in 0..1000 with x1 < x2 and
  y1 < y2, and the part's point lies inside its area. Its teacher sentence is reworded to cover areas.
- Pipeline (`packages/meta/pipeline-v2.ts`): `V2ImageInput` gains OPTIONAL `printedLabels?: string[]` (one string per
  printed label group, lines joined with a space, in group order). When present, the generation and repair messages list
  them after the figureId line.
- LD-10 and LD-11 are NOT RETROACTIVE. Stored runs were never asked for areas or full coverage, so `apps/api/recheck.ts`
  and `scripts/recheck-stored.ts` ignore them when re-checking stored parts. They also join `CHECKS_NOT_RETROACTIVE` in
  the evidence e2e tests, with a reason comment. Old lessons are fixed on screen by the web rules below.

## Behaviour
- Muse prompt (`label_diagram` + repair): make one part for every listed printed label whose words the page text names,
  up to the maximum. Give each part an area box around all of its drawn pieces. Put the point on ink inside that area.
  The repair for LD-11 names the weak part, gives SAM's confidence and asks for a better point and area. The repair for
  LD-10 names the missing labels.
- Worker: SAM objects are `{id, box: area→pixels}` (plus nothing else). A part without an area uses its point, as before.
  Each region keeps its mask, which becomes `outline` through `maskToOutline` in `packages/meta/sam-outline.ts` (box-local
  mask, offset by x1/y1). `printedLabels` and `partLabelGroups` come from `loadFigureLabelBoxes`/labels.json.
- Web:
  - **Outline draw-in:** during the build, a region with an `outline` is drawn as an SVG path that traces itself, holds,
    then fades. Regions without one fall back to the current box animation. Nothing shows at rest. The confidence filter
    (`regionToDraw`) still applies.
  - **Unclaimed labels are not slots:** a printed-label group that no part claims is covered with a muted patch (no white
    slot, no border), so it never looks fillable. It uncovers with the rest when the figure's own labels are shown.
  - New check names: LD-10 "Every printed label the page names has a part"; LD-11 "SAM was sure of every part's region".

## Owners (no two children edit the same file)
| Slice | Owner | Files |
|---|---|---|
| M: contracts, schema, prompts, message | Muse Spark 1.3 via bridge (lead-driven) | `packages/contracts/kit.ts`, `scripts/build-schemas.ts` + generated schemas, `packages/meta/prompts-v2.ts`, `packages/meta/pipeline-v2.ts`, their tests |
| V: validators | Sonnet 5.5 | `packages/validation/kit/label-diagram.ts` (+ `label-identity.ts` if needed), new tests, `apps/api/recheck.ts` (not-retroactive filter), `scripts/recheck-stored.ts`, e2e `CHECKS_NOT_RETROACTIVE` |
| S: SAM client + worker | Sonnet 5.5 | `packages/meta/sam.ts`, new `packages/meta/sam-outline.ts`, `packages/sources/figures.ts`, `workers/generation/lesson.ts`, their tests |
| W: web | Opus 5.5 | `apps/web/src/**` (LabelDiagramView, labelDiagramView.ts, live.css, engines-c.css, lessonJob.ts check names) |
| Lead | Opus 5.5 | `data/figures/*.labels.json` `partLabelGroups`, `@meta-sam/parser` dependency + licence notice, count pins, live runs |

`@meta-sam/parser` 0.1.0 (Meta, SAM License: royalty-free use and redistribution with a copy of the licence) is a
runtime dependency, pinned exactly. The repo does not vendor it.

## Addendum A (2026-11-02, Calvin: "keep the box drawing to the models only... cleaner demo boxes")
Evidence: `docs/evidence/muse-grounding-probe/`. A dedicated Muse grounding call boxes the parts far more cleanly than
the area fields inside the generation call.

- **Grounding call (worker, every label-diagram revision, after the gen is validated far enough to have parts and
  before SAM):** one Muse Spark call through the job's own MetaClient (same model, ledger, accounting and receipts as
  the other Muse calls), using Meta's documented "object grounding expert" box prompt. The prompt is built in
  `packages/meta/grounding.ts` (`buildGroundingPrompt`), and the strict JSON schema is
  `{objects:[{object_name, bbox:[{x_min,y_min,x_max,y_max}]}]}` on the 0..1000 grid. Objects are listed in part order as
  `"the drawn <part name> that the printed label '<printed label text>' points to"`, with `"the drawn <part name>"` when
  the part claims no printed label. The prompt says to box the drawing and never the label text, and to give one box per
  piece. maxOutputTokens is 16000 (reasoning alone used ~4,000 tokens).
- **Using it:** each part's grounding box is the union of its pieces (0..1000), matched by order; a malformed entry
  (non-integers, x_min >= x_max, outside 0..1000) is ignored. SAM's box prompt for a part is that union plus 4% margin,
  converted to pixels. With no grounding box the part falls back to the gen area, then to the point (Stage 8c). The best-of
  retry is unchanged: its E variant widens the box the first pass actually used.
- **Stored:** `LabelRegion.ground?: { x1: number; y1: number; x2: number; y2: number }` holds the image-pixel union box
  Muse gave for that part. It is optional, and absent on older runs or when grounding failed.
- **Failure:** a grounding call that fails (any MetaError, a truncated output, bad JSON) is accounted like any Muse call.
  The build continues with the gen areas, so it never fails the component on its own. Events: within the existing
  segment events, the `segment started` detail stays `sam-3.1 point segmentation of N part(s)`. The `segment succeeded`
  detail appends `; muse-spark-1.3 located K of N part(s) for SAM` (or `; muse-spark-1.3 grounding failed (<CODE>); used
  the generation areas`).
- **Web build glow:** during the build, each region is drawn as a BOX: SAM's region box, which already sits tight on the
  drawing Muse located. It shows only when SAM's confidence is at least 0.5, and draws in, holds, then fades as now; it
  is a soft glow in the app's accent colour, never a hard border. Traced outlines stay stored but are no longer drawn.
  The narration reads "Muse Spark located N parts · SAM 3.1 confirmed K".

## Addendum B (2026-11-02): numbers sit on the part the models located
Live round 3 (`docs/evidence/stage-8c/live/results-r3.jsonl`): with grounding, SAM was 0.59-0.95 sure of EVERY part on
both figures, and the boxes are right. Both diagrams still failed only on the number position from the generation call:
LD-06 (water cycle runoff point 15 px left of the stream) and LD-04/LD-06 (DNA guanine/cytosine points on the printed
words). Repairs move them inconsistently.

- **Placement (worker, after SAM and the best-of retry, before validation of the revision):** a part is placed when its
  region has `ground` (Muse grounding), a numeric confidence ≥ `minRegionConfidence`, and a decodable mask. Its
  published `x`/`y` (0..1000) become the mask's ink pixel nearest the mask's centroid, and its `areaX1..areaY2` become
  the grounding union (0..1000). A part that is not placed keeps Muse's generation values unchanged. Muse's own
  generation values are kept in the revision artifact as `genPositions: { partId, x, y, areaX1, areaY1, areaX2, areaY2 }[]`
  for the placed parts (audit). Event: the `segment succeeded` detail appends `; placed K number(s) on the located parts`.
- **Agreement check, a new criterion inside LD-06 (no new id):** for a region with `ground`, SAM's box must lie inside the
  grounding box expanded by 25% of its width/height on each side. Otherwise it fails with a message naming the part
  (SAM's region spilled outside what Muse located), and the affected paths are that part's x/y/area. This is the
  cross-model check that replaces "Muse's point lies in SAM's box" for placed parts. That point check still runs, and
  holds by construction once the number is placed.
- LD-04 (point not on printed text, point inside area) runs on the placed values as before. A placed point that still
  lands on printed text fails LD-04 honestly.
- Repairs: the repair input is the published (placed) revision as today. Fields the worker places are re-placed on every
  revision, so a repair cannot "fix" them by hand.
- Stored runs: unchanged (no `ground`, so nothing is placed and the new LD-06 criterion is skipped).
