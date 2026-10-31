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

## Parts 2–4 (frozen after the figure set exists)
- **Contracts and engine:** `label-diagram-v1` (Muse).
- **Meta and SAM:** image input for the generation call, a SAM 3.1 client with ledger accounting (Muse), and worker integration (Qwen).
- **Checks:** validators `LD-*` (Qwen).
- **View:** Opus.
- **Region display:** v1 draws SAM **boxes** and Muse's points (mask payloads are stored, not decoded).
