# Teacher diagram (beta): web evidence

Spec: `docs/specs/TEACHER-FIGURE.md` section 4. Captured on a throwaway Vite dev server (port 5191) against the local
API with the access gate off. **Every POST was answered by an in-page fetch shim** (`/api/sources` → 201 mock
`user-mock-0001`, `/api/sources/:id/figure` → 201 `uf-0123456789ab` or 400 FIGURE_INVALID, anything else blocked), and a
GET shim served that mock source, so nothing was written to storage and no build was started. The preview thumbnail
shows the uploaded PNG through the same shim (the mock figure id does not exist on the server).

The test image is a synthetic 2400 × 1500 "cell" drawing made in the page (canvas), pasted as PNG into the Text box and
dropped as JPEG on the paste area; both came out as a 1600 × 1000 PNG.

| File | What it shows |
| --- | --- |
| `own-source-empty-1920.png`, `own-source-empty-2560.png` | The Diagram field before an image: label with the quiet `beta` tag, the one-sentence note, the focused paste area (keyboard Tab) with its instructions and Choose an image. |
| `own-source-diagram-errors-1920.png` | Image attached (preview, size, "scaled down from"), caption filled, submit without the image rights tick: role=alert under the tick, nothing sent. |
| `diagram-refused-1920.png` | Text saved, figure refused by the server (400 FIGURE_INVALID): inline alert keeps the form and offers "Use the text without the diagram". |
| `own-source-diagram-1920.png`, `-2560.png`, `-1366.png` | Saved with the diagram: the preview on the right shows the thumbnail under the text, "Used in the next build", "Leave it out". |

Checks run in the page: a paste with an image and no text was prevented and went to the diagram; a paste with text plus
an image was NOT prevented (stays text); dragover/drop on the form are prevented (the browser never opens the file);
no duplicate ids, no unnamed buttons, no unlabelled inputs in the form; the paste area is `role=region`, `tabindex=0`,
labelled "Diagram (optional) beta" and described by its instructions and the note; the file input has
`accept="image/png,image/jpeg,image/webp"` and is hidden behind the real button; document never overflows at 1366, 1920
and 2560.

Not exercised in the browser: Build with a diagram (forbidden here; `createJobBody` is unit-tested), the labels stage in
the build strip and the teacher credit in a lesson (unit-tested in `apps/web/src/lib/liveBuild.labels.test.ts`), because
no real run with a teacher diagram exists yet.
