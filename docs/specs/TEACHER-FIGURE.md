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

## As built (backend)

Implemented as frozen above; the points below are what the spec left open, or the few additive choices made.

- **Store.** `packages/sources/index.ts`: `USER_FIGURE_ID_PATTERN`, `userFiguresDirOf`, `userFigureId(sourceId, imageSha256)`,
  `writeAtomic` (now exported, also takes bytes). `packages/sources/user-figures.ts`: `validateUserFigureInput`,
  `imageDimensions` (PNG IHDR, JPEG SOF0/SOF2 only), `normaliseFigureCaption`, `saveUserFigure`.
  `packages/sources/figures.ts`: `figureDirFor(id, userFiguresDir)`, `FigureMeta.provided?: 'teacher'`,
  `loadFigureLabelsFile` (the existing `readLabelsFile` rules, exported). `licenseEvidence` and `method` use the
  date only (`YYYY-MM-DD`); `retrievedAt` is the full ISO time. `pageUrl` is the source locator only when it is an
  http(s) URL. `created: false` never rewrites the sidecar (a new caption for the same image is not stored).
- **FIGURE_INVALID problems** (fixed order): `NOT_AN_OBJECT`, `RIGHTS_NOT_CONFIRMED`, `MIME_INVALID`, `BASE64_INVALID`
  (strict standard base64, whitespace ignored, no `data:` prefix), `IMAGE_TOO_LARGE`, `IMAGE_TYPE_MISMATCH` (magic
  vs mime), `IMAGE_DIMENSIONS` (unreadable header, another JPEG frame type, or a side outside 64..4096),
  `CAPTION_INVALID` (not a string), `CAPTION_LENGTH`. Caption normalising also drops zero-width and bidi controls.
- **Upload route order:** 405 (not POST) → 403 ORIGIN_NOT_ALLOWED → 403 ACCESS_REQUIRED → 400 FIGURE_SOURCE_NOT_USER
  (a library id) → 404 NOT_FOUND → 415 → 413 (over 6 MB) → 400 BAD_REQUEST (bad JSON) → 400 FIGURE_INVALID → 201/200.
  No per-source or global figure count limit (none was specified).
- **POST /api/jobs:** an unknown source keeps its 404 SOURCE_NOT_FOUND before the figure is looked at; every figureId
  problem is `400 {error: 'FIGURE_INVALID'}` (no problems list). The figure is loaded sha256-verified to check it.
  `startJob` options and `JobDeps` gain `figureId?`; `JobDeps` and `ApiOptions` gain `userFiguresDir?`. The worker
  boundary throws `FIGURE_ID_INVALID` for a malformed id or a non-user source.
- **Contracts:** `LabelFigureRef.provided?: 'teacher'` (kit.ts, additive) so the published spec's `figure` says it;
  `labelFigureRefOf` sets it from the sidecar. Library refs carry no such key.
- **Labels file:** a label's `text` sits on its FIRST line box only; its other lines carry the same `group` and no
  text (the library's two-line "Sugar phosphate backbone" is stored the same way, so `printedLabelsOf` and LD-02 join
  one text per group). `partLabelGroups` is written even when empty (`[]` reads as "not curated", like the library).
  Box pixels round OUTWARD (floor/ceil) before clamping to `0..width`/`0..height`. A stored file is reused only when
  it is valid AND has at least one box.
- **Events:** `labels started` carries `figureId`; every `labels` event carries `figureId`. A failed call's event
  keeps the charge fields (`estCostUSD`, and `model`/`responseId`/`latencyMs` when a receipt exists) with the spec's
  sentence as `detail`. The fixed code goes to a private run artifact `figure-labels.json`:
  `{ok: true, figureId, labels, nameParts, receipt}` or `{ok: false, figureId, code, chargedUSD, unknownUSD,
  receipt?}`, codes = the MetaError code, `OUTPUT_INVALID` (wrong shape), `NO_LABELS` (zero labels after the
  conversion), `INTERNAL` (labels.json could not be written; the call is still accounted).
- **Prompt:** fixed text, nothing interpolated (no caption, no page text), so there is no untrusted input to sanitise
  on the way in; the returned text goes through grounding's `phrase()` (now exported). Text is cut at 80 chars by it.
- **Serve time:** only `recheck.ts` loads figures (label-order, sam-used and review do not). A user job with a
  `figureId` rechecks against that one teacher figure from the teacher store; `enrichLabelBoxes` resolves through
  `figureDirFor`. `scripts/recheck-stored.ts` (outside the backend paths) still lists library figures only.

## As built (web)

Implemented as section 4 says; the open points and the few additive choices:

- **Pure lib** `apps/web/src/lib/teacherFigure.ts` (tests `teacherFigure.test.ts`): `fitLongSide` (long side at most
  1600, never enlarged, whole pixels), `encodeSizes` (1600, then 1280/1024/800 only when the PNG would exceed the
  server's 4 MB; still PNG), `sizeProblem` (64 px per side after scaling), `figureInputProblem` (PNG, JPEG, WebP and
  clipboard BMP decoded; 40 MB input cap), `figurePayload` (`{mime: 'image/png', base64, rights: true, caption?}`,
  caption cleaned like the server), `pastedImageIndex` (an image file AND no text/plain, else the paste stays text),
  `figureErrorMessage` (every backend FIGURE_INVALID code in plain words, never a raw code; FIGURE_SOURCE_NOT_USER,
  NOT_FOUND, 413 too), `isTeacherFigure` (`provided: 'teacher'` OR a `uf-` id), `teacherFigureCaption` (the default
  caption is not repeated above the teacher credit), `parseAddedFigure` / `parseFigureMap`.
- **Canvas** `components/figureImage.ts` (createImageBitmap, `<img>` fallback, `imageSmoothingQuality: 'high'`,
  `toDataURL('image/png')`). The field is `components/FigureField.tsx`, between Text and License in
  `PasteSourceForm`. Paste and drop are handled on the whole form; a dropped file never opens in the tab.
- **Submit:** both rights ticks and the caption are checked BEFORE `createSource`, so a missing image tick sends
  nothing. A figure refusal after the text was saved shows one role=alert line with "Use the text without the
  diagram"; submitting again retries (the text answers 200 reused, the figure is idempotent).
- **New lesson page:** `App.tsx` keeps `{figureId, width, height, caption}` per own source in sessionStorage
  (`mki.figures`), so a reload keeps it; the latest save of a text decides (saved without a diagram drops the old
  one). Build sends `figureId` only for a user source AND the lesson flow (the classic single activity never makes a
  diagram part). The preview shows the thumbnail (`GET /api/figures/<id>/image`), its size, "Used in the next build"
  and "Leave it out". POST /api/jobs FIGURE_INVALID reads "The diagram kept with this text could not be used…".
- **Build strip** (`lib/liveBuild.ts`): stage `labels` open → op "Reading the diagram’s labels" (Muse, own timer);
  it counts as a Muse call and its `estCostUSD` is in the running sum, except a reuse ("Printed labels read earlier",
  no call). Facts add "diagram labels read in N s" while running; a failed read adds "built without the diagram"
  while running and at the end. Steps list (`lib/lessonJob.ts`): first step "Read the diagram’s labels (beta)" with
  model, time, cost, response id and the worker's own detail. Demo beats (`lib/demoBeats.ts`): a `labels` beat before
  "reading" when a recorded run has the stage (none of the pinned runs do).
- **Lesson credit:** `figureCredit` (lib/presentation.ts, used by the lesson and the slide) returns "Diagram provided
  by the teacher · printed labels read by Muse Spark (beta)" for a teacher figure, so slides get it too.
- **Not done:** no `uf-` handling in `config/pinned-runs.json` or the Welcome montage (no teacher runs exist yet).
