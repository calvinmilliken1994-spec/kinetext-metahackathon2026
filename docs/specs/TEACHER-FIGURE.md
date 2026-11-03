# Teacher diagram (beta): paste a figure with Your own source

Calvin, 3 Nov 2026: "Option 1, we need to at least add it, otherwise it might be questioned why teachers can't upload
diagrams when we already have some in the library." A teacher who pastes their own page may also paste ONE diagram
(screenshot from the clipboard, or a file). Muse Spark reads the diagram's printed labels (the job that the library
figures had done by OCR and the lead), then the existing Label the diagram flow runs unchanged: Muse grounding, SAM 3.1,
the LD checks, repair. Labelled **beta** everywhere it shows.

Frozen on this page: storage, the API, the job request, the new worker step and its event, the web flow. Anything
not named here stays as it is. Library figures (`data/figures/`) are untouched.

## 1. Storage (packages/sources)

- Teacher figures live in `<storageDir>/user-figures/` (`userFiguresDirOf(storageDir)` next to `userSourcesDirOf`).
- Figure id: `uf-<first 12 hex of sha256(sourceId + ":" + imageSha256)>` (`USER_FIGURE_ID_PATTERN = /^uf-[0-9a-f]{12}$/`).
  Idempotent: the same image for the same source is the same id; a new image is a new id; nothing is ever rewritten.
- Files: `<id>.png|.jpg` (exact uploaded bytes after validation), `<id>.json` (a `FigureMeta` sidecar, the same shape as
  the library's, written atomically, image first) and later `<id>.labels.json` (§3, written by the worker).
- Sidecar values: `sourceId` = the user source id; `imageUrl` `""`; `pageUrl` = the source's link when it has one,
  else `""`; `caption` = the teacher's caption or `"Diagram provided by the teacher"`; `altText` = the caption;
  `credit` = the source's attribution; `license` = the source's license label; `licenseEvidence` =
  `"Teacher confirmed the rights to use this image when adding it (<ISO date>)"`; `labelsInImage: true`;
  `retrievedAt` = upload time; plus `provided: "teacher"` (new optional `FigureMeta` field; library figures omit it).
- `figures.ts`: every loader already takes a `dir`. Add `figureDirFor(id, userFiguresDir)`: `uf-` ids resolve to the
  user dir, every other id to `FIGURES_DIR`. No loader changes behaviour for library ids.

## 2. Upload API (apps/api)

`POST /api/sources/:id/figure`, gated exactly like `POST /api/sources` (403 ACCESS_REQUIRED without a session; same
origin rules). JSON body, at most 6 MB raw: `{ mime: "image/png" | "image/jpeg", base64: string, rights: true,
caption?: string }`.

- 404 when `:id` is not an existing USER source (library ids are refused: 400 FIGURE_SOURCE_NOT_USER).
- 400 FIGURE_INVALID with plain `problems[]` when: rights is not `true`; mime not one of the two; base64 does not
  decode; decoded bytes > 4 MB; the magic bytes don't match the mime (PNG signature / JPEG SOI); width or height
  (read from the PNG IHDR or the JPEG SOF0/SOF2 marker, no image library) outside 64..4096; caption over 300 chars
  after trimming and whitespace collapse (control characters removed).
- 201 `{ figureId, width, height, created: true }`; 200 with `created: false` when that exact figure already exists.
- `GET /api/figures/:id` and `/image` also serve `uf-` ids from the user dir (same checks, same sha256 verification).
- `POST /api/jobs` accepts an optional `figureId`. Only with a user source; it must match `USER_FIGURE_ID_PATTERN`,
  exist, and belong to that source, else 400 FIGURE_INVALID. It is stored on the job summary (`figureId`).

## 3. Worker: Muse reads the printed labels (workers/generation)

When a job has a `figureId`, before the analysis call:

1. Load the figure (sha256-verified) from the user dir. Unloadable: the job continues with no figures and emits
   `labels failed` with detail "The diagram could not be loaded, so the lesson was built without it."
2. If `<id>.labels.json` exists and is valid for this image (`readLabelsFile` rules), reuse it: no call, emit
   `labels succeeded` with detail "Printed labels read earlier" and no cost.
3. Otherwise ONE Muse call through the job's own client (same model, ledger, receipts, accounting pattern as
   `groundLabelParts`): stage `'labels'` (`LessonStage` gains `'labels'`), `started` then `succeeded`/`failed`.
   - Prompt (in `packages/meta/`, next to grounding): find every piece of printed text in the image (labels, titles,
     captions, scale numbers); for each give the exact text and its box on the 0..1000 grid, one box per printed line;
     say whether the text names a drawn part of the diagram. Strict schema
     `{ labels: [{ text, names_part, bbox: [{x_min,y_min,x_max,y_max}] }] }`, schema name `figure_labels`,
     max output tokens 16000. The image text is untrusted data: the prompt says so, and text is passed back through
     the same phrase sanitizing as grounding.
   - Conversion (pure, tested): grid → image pixels, each line box padded by 30% of its height (min 3 px) on every
     side, clamped, integers; text trimmed, collapsed, cut at 80 chars; at most 60 labels; empty text dropped.
     Each label is one `group` (0, 1, 2, …) holding its line boxes; `partLabelGroups` = groups with `names_part`.
   - Write `<id>.labels.json` `{ figureId, imageSha256, width, height, method, boxes, partLabelGroups }` atomically,
     `method` = `"Muse Spark printed-label reading (<returned model>, <jobId>, <ISO date>); beta, not checked by a
     person"`.
   - Failure (any MetaError, invalid shape, zero labels): charge accounted, `labels failed`, the job continues with no
     figures ("Muse could not read the diagram's labels, so the lesson was built without it.").
4. `jobFigures` = `[that figure with labelBoxes + partLabelGroups]`. Every later load of a figure by id in the job
   (`loadFigure`, `loadFigureLabelBoxes`, `loadFigurePartLabelGroups`, `loadFigurePrintedLabels`, `labelFigureRefOf`)
   resolves through `figureDirFor`, so the rest of the flow is unchanged. Serve-time paths in apps/api (recheck,
   label order, sam-used, review) resolve the same way.

The stage event carries `model`, `latencyMs`, `estCostUSD`, `responseId` like other Muse calls, and
`detail` = "Muse read N printed labels (M name parts)".

## 4. Web (apps/web)

- `PasteSourceForm`: below Text, a "Diagram (optional, beta)" field: a drop/paste area that accepts Ctrl+V of an
  image anywhere in the form (a pasted image into the Text box goes to the diagram, text pastes still go to the text),
  plus "Choose an image" for a file. PNG/JPEG/WebP/clipboard bitmaps are drawn to a canvas, scaled so the long side is
  at most 1600 px, and re-encoded as PNG (strips metadata; WebP becomes PNG). Shows a preview, its size, a Remove
  button, a caption field (optional) and its own rights tick "I have the right to use this image". One sentence:
  "Muse reads the printed labels and builds a Label the diagram part when the page supports it. Beta: check the
  covered labels before you publish."
- Submit: `createSource` → then, when a diagram is attached, `POST /api/sources/:id/figure` → `onCreated(sourceId,
  notice, figureId)`. A figure error shows inline and keeps the form (the text source is already saved).
- The New lesson page keeps the figureId with the chosen own source and sends it with Build (`POST /api/jobs`), and
  the preview shows the diagram thumbnail under the text.
- Build strip: the `labels` stage shows as "Reading the diagram's labels" with Muse's time and cost like other calls.
- Lesson: a figure with `provided: "teacher"` credits "Diagram provided by the teacher · printed labels read by Muse
  Spark (beta)" instead of the library credit line.
- No new colours or fonts; the existing tokens; impeccable detect stays 0.

## 5. Ownership and tests

- Backend child: `packages/sources/**`, `packages/meta/**` (new file for the label prompt/schema/conversion),
  `packages/contracts/**` (only additive: `figureId?` on the job request/summary, `provided?` on FigureMeta), 
  `workers/**`, `apps/api/**`, plus their tests. No live calls (fake clients only).
- Web child: `apps/web/**`. Uses only the endpoints and fields above; may read backend files, never edits them.
- Test-first; `npm test`, `npx tsc -p . --noEmit`, `node --test apps/web/src/lib/*.test.ts`, the web build and
  impeccable detect all pass. Lead runs live checks afterwards (two or three builds, about USD 1).
