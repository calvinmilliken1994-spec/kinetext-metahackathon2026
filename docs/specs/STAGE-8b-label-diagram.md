# Stage 8b: Label the diagram (SAM 3.1). Frozen in parts, 2026-10-31 (lead: Claude Opus 5.5)

Calvin approved building every proposed engine, which includes this one. The design is in `docs/specs/STAGE-8-photo-and-diagrams.md` §2, and the SAM account check is in `docs/evidence/sam-3.1-check/`. Photo upload (§1 of that spec) is NOT part of this stage.

## Part 1: figure library (frozen now; the research child starts first)
Library pages are stored as text only, so Label the diagram needs the page's own figures as separate, licence-checked files.

- **Files:**
  - `data/figures/<figureId>.<png|jpg|gif>` holds the exact bytes as downloaded. Never re-encode, resize or crop.
  - `data/figures/<figureId>.json`:
```json
{
  "id": "medlineplus-cell-parts-1",
  "sourceId": "medlineplus-what-is-a-cell",
  "file": "medlineplus-cell-parts-1.jpg",
  "mime": "image/jpeg",
  "sha256": "<hex of the image bytes>",
  "width": 0, "height": 0,
  "imageUrl": "<exact URL the bytes came from>",
  "pageUrl": "<the library page's locator>",
  "caption": "<the figure's caption or title exactly as printed on the page, '' if none>",
  "altText": "<the img alt attribute exactly, '' if none>",
  "credit": "<credit line exactly as printed, '' if none>",
  "license": "<licence statement summary, e.g. 'U.S. Government work (NLM), public domain'>",
  "licenseEvidence": "<URL of the policy page + the quoted sentence>",
  "labelsInImage": true,
  "retrievedAt": "<ISO time>"
}
```
- **`labelsInImage`:** true when the picture itself prints part names, so the view must cover them.
- **Eligible figures:** a labelled or labellable diagram of parts, such as a cell, DNA, a chromosome, atmosphere layers, a volcano or Earth cross-section, the water cycle, an engine or wing diagram, or lab apparatus. Exclude photos of people, logos, charts of data over time and decorative images.
- **Licence:** each image's own credit is checked. A credit naming a third party (e.g. "Image courtesy of …", "© …", "Getty", "Shutterstock", "Adobe Stock") is excluded unless that party's licence is verified to allow reuse including AI processing.
- **Target:** 8–12 figures across biology, earth & space, chemistry and physics. Each figure belongs to an active library page in `data/sources/` whose text names at least 3 of the figure's parts (verify by grep).

## Parts 2–4: frozen 2026-10-31 after the figure set landed (9 figures, commit `01361c0`)

### Flow (Muse Spark 1.3 jobs only)
1. **Analysis.** For a library source with figures, the analysis message lists them as `figureId — caption — labelsInImage`. `label-diagram-v1` may be planned only when at least one figure is listed. Spark Open jobs get no figure list, so they never plan it. A-08 enforces this: `label-diagram-v1` in a plan whose source has no figures fails.
2. **Generation.** The generation call for `label-diagram-v1` sends the chosen figure image as a base64 data URL with the page text. Muse Spark reads the image and writes the gen. Coordinates use Meta's normalised 0–1000 grid (perception grounding).
3. **Segmentation.** The worker sends ONE SAM 3.1 request per revision, using point prompts. Each part becomes an object id: index + 1, one positive point at the part's (x,y) converted to image pixels. The request uses `metadata.include_confidence: "true"`. The response is parsed into boxes; masks are stored raw but not decoded. Cost is USD 0.0025 per image, reserved and reconciled through the ledger (provider `meta-api`, kind of usage `images_processed`).
4. **Checks and repair.** Validation runs on the gen plus the regions. Repair goes through the existing kit repair loop: the repair call also carries the image, and segmentation re-runs on the repaired revision.
5. **Spec.** The spec is the gen body plus the system fields `figure` and `regions` (below).

### Contracts (`packages/contracts/kit.ts`)
```ts
export interface LabelDiagramGen {
  schemaVersion: 'label-diagram-v1';
  title: string;
  figureId: string;            // one of the figures listed for the source
  parts: LabelPartGen[];       // 3..8
  hint: string;
}
export interface LabelPartGen {
  id: string;
  name: string;                // the part's name as the page text words it (1..40)
  sourceId: string;
  quote: string;               // verbatim page-TEXT span naming the part
  x: number; y: number;        // a point ON the part, normalised 0..1000 (integers)
  labelX1: number; labelY1: number; labelX2: number; labelY2: number; // box around the part's PRINTED label in the image, 0..1000; all 0 = no printed label
}
export interface LabelFigureRef { id: string; width: number; height: number; caption: string; credit: string; license: string; labelsInImage: boolean }
export interface LabelRegion { partId: string; x1: number; y1: number; x2: number; y2: number; confidence: number | null } // image pixels
export interface LabelDiagramSpec extends KitSpecBase<'label-diagram-v1'> {
  figureId: string; parts: LabelPartGen[]; hint: string;
  figure: LabelFigureRef; regions: LabelRegion[];
}
```
Limits: `KIT_LIMITS.labelDiagram = { parts: {min:3,max:8}, name: {min:1,max:40}, coordMax: 1000, maxRegionAreaFraction: 0.5, minRegionAreaFraction: 0.0005, maxRegionOverlapIoU: 0.6 }`. Prefix `LD`. Body keys are `figureId`, `parts` and `hint`. `assembleKitSpec` keeps copying the gen body; `figure` and `regions` are added by the worker through a new exported helper `attachLabelRegions(spec, figure, regions)`.

Checks (92 + 9 = 101 Stage 6 checks after this stage):
- `LD-01 quotes-verbatim`
- `LD-02 name-in-quote`: the name is a whole phrase in its quote, case-insensitive
- `LD-03 figure-valid`: the figureId is one of the source's figures
- `LD-04 points-valid`: integers in 0..1000, and each point lies outside every printed-label box
- `LD-05 label-boxes-valid`: either all 0 or well-formed (x1 < x2, y1 < y2) inside 0..1000; boxes do not overlap each other; when the figure has `labelsInImage` true, at least 3 parts carry a box
- `LD-06 regions-found`: SAM returned exactly one region per part; the region contains the part's point; its area fraction lies in [min, max]
- `LD-07 regions-distinct`: the pairwise IoU of regions is at most the maximum overlap
- `LD-08 numbers-checkable`: the title and hint, by N-01
- `LD-09 counts-valid`

`validateKitComponent('label-diagram-v1', gen, sources, { regions, figures })`: the options carry the regions and the source's figure list. Without regions, LD-06 and LD-07 fail with the message "segmentation did not run".

### Figures access (`packages/sources/figures.ts`)
- `listFigures(sourceId): FigureMeta[]`
- `loadFigure(figureId): { meta: FigureMeta; bytes: Uint8Array }`, which verifies the sha256 and throws `FIGURE_HASH_MISMATCH` otherwise.

`FigureMeta` is the Part 1 JSON.

API:
- `GET /api/figures/:id` returns the meta.
- `GET /api/figures/:id/image` returns the exact bytes with the stored mime type and long cache headers.

### Meta package (`packages/meta`)
- **Image content.** `ChatMessage.content` becomes `string | ChatContentPart[]`, where `ChatContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }`. Images go in user messages only. Token bounds count an image as 1,600 tokens.
- **SAM client.** `sam.ts` exports:
  - `segmentPoints(opts: { apiKey, baseUrl?, fetch?, ledger, purpose, image: { bytes, mime, width, height }, points: { id: number; x: number; y: number }[], signal? }): Promise<{ boxes: { id: number; x1: number; y1: number; x2: number; y2: number; confidence: number | null }[]; raw: string; imagesProcessed: number; costUSD: number; latencyMs: number }>`
  - **Request:** POST `/responses` with model `sam-3.1`, `stream: true`, `metadata.include_confidence: "true"`. The input_text is the object prompt in SAM's grammar, `<0f>1<|point;x=..;y=..;w=W;h=H|>,2<…|>`. Pixel coordinates are integers clamped inside the image, and there are at most 16 objects.
  - **Response:** parse the `output_text` deltas and the `<0f>` records into boxes. A missing object is simply absent.
  - **Ledger:** reserve USD 0.0025 before the call, then reconcile with `usage.images_processed` × 0.0025.
  - **Errors:** non-200 responses throw `MetaError` with a fixed code (`SAM_HTTP_<status>`), never the provider's text.
  - **Exported helpers:** `buildPointPrompt` and `parseSamOutput`.
- **Prompts s6-v9:**
  - A `label-diagram-v1` design text: names from the page text, a point on the part itself (never on its printed label), label boxes around printed labels, and normalised 0–1000 coordinates.
  - A "when" row: only when a figure is listed for the page.
  - Subject guidance: biology, earth-science, chemistry and physics may plan it when a listed figure shows parts the page names.
  - The analysis message builder takes an optional figure list.

### Ownership
| Slice | Model | Owns |
|---|---|---|
| M6 contracts + figures | Muse Spark 1.3 (bridge) | `packages/contracts/kit.ts`, `scripts/build-schemas.ts`, `tests/contracts.stage8b.test.ts`, `tests/fixtures/stage6/label-diagram.gen.json` (DNA figure), `packages/sources/figures.ts` (+test) |
| M7 meta | Muse Spark 1.3 (bridge) | `packages/meta/{client,sam,pipeline-v2,prompts-v2}.ts` (+tests) |
| V validators | Qwen 3.8 Max | `packages/validation/kit/label-diagram.ts`, A-08 figure rule in `analysis-v2.ts`, kit/index dispatch options (+tests) |
| W worker + API | Qwen 3.8 Max | `workers/generation/lesson.ts` segmentation step, `apps/api` figure endpoints (+tests) |
| U view | Claude Opus 5.5 | `LabelDiagramView.tsx`, `lib/labelDiagramView.ts` (+tests), presentation steps, `styles/engines-c.css` |
