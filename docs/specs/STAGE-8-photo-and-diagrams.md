# Stage 8 (design only, NOT built) — Photo upload and Label the diagram

Status: design proposal, 2026-10-31. Basis: SAM 3.1 check (`docs/evidence/sam-3.1-check/`). Build only after Calvin's go-ahead, after Stage 7e and the subject engines.

## 1. Photo upload: a textbook photo enters the same pipeline as pasted text

**Teacher flow**
1. "Add your own page" gains a "Photo of a page" tab. The teacher adds 1–4 photos (JPEG/PNG/HEIC→JPEG, ≤ 10 MB each) and ticks the same rights box as for pasted text: "I have the right to use this page, and the publisher allows AI processing".
2. **SAM 3.1** finds, per photo, the page (concept `page`), the figures (`diagram`) and the tables (`table`). Each call takes one image and costs USD 0.0025.
3. The server crops and deskews the page from the page mask. It runs locally with the existing image library, with no model call.
4. **Muse Spark 1.3** (image understanding) transcribes the page text in reading order and returns JSON: text blocks with box coordinates, tables as rows, and figure captions. Instruction: "transcribe exactly, mark unreadable words `[?]`, never complete or correct the text".
5. **Teacher confirms** on a review screen. The photo is on the left with region outlines, and the editable transcription is on the right. Unreadable `[?]` words must be fixed before continuing. This is the trust step: our checks prove quotes against the text, so the confirmed text becomes the source.
6. The confirmed text is stored as a user source like pasted text (`user-<hash>`, sha256 of the text). Two additions: `origin: "photo"` and the region boxes, so later hover links can point back to the photo region. The lesson pipeline then runs unchanged.

**Labels.** Source panel: "Transcribed from your photo · confirmed by you". The lesson provenance line says the same. We never show the transcription as the publisher's text.

**Checks (new, deterministic)**
- `photo.transcript-confirmed`: no lesson runs without teacher confirmation.
- `photo.no-unresolved`: no `[?]` remains.
- Region boxes must lie inside the image bounds.
- All existing quote and number checks run on the confirmed text.

**Failure paths.**
- No page found: ask for a retake, with tips (flat, bright, whole page).
- Transcription fails: offer manual typing. This is labelled and is not a silent fallback.

## 2. Label the diagram (`label-diagram-v1`): the first engine on a real picture

**Student view.**
- The page's own figure, cropped by SAM, with numbered dots on the parts.
- Students drag name chips onto the dots. Check reveals right and wrong.
- Presentation mode: the teacher reveals one label at a time.

**How parts are found (two Meta models)**
1. Muse reads the figure and the page text. For each part it returns its name, a verbatim quote from the page that names it, and an approximate point on the figure (the tip of the printed label's leader line, or the part itself).
2. SAM 3.1 segments each part. It tries a concept prompt with the part name first: "chloroplast" found 4 of 4 in the check. If that finds nothing, it uses Muse's point as a point prompt: "nucleus" by name found 0, so the point covers this. Up to 16 parts fit in one point-prompt call.
3. Printed labels on the figure are covered with masks drawn from the label-text boxes found by Muse transcription. The answers are therefore not visible on the image.

**Deterministic checks**
- Each part name occurs on the page (quote check).
- Each part has exactly one mask, and that mask lies inside the figure box.
- Masks do not overlap by more than 20%.
- At least 3 and at most 10 parts.
- Muse's point lies inside its SAM mask, which ties the two models' answers together.
- Distinct names.
- Any part that fails is dropped; fewer than 3 parts means the activity is declined.
- No generated illustration is ever used: only the teacher's or the licensed page's own figure.

**Fit.**
- Biology: cells, organs, flowers.
- Earth science: rock layers, volcano cross-sections, the water cycle.
- Chemistry: lab apparatus, atom diagrams.
- Physics: circuits, forces on a body.

Library pages with figures can use it too, when the figure's licence allows it. NASA and NOAA images are usually public domain, but credit lines can name third parties, so each image is checked one by one.

## 3. Costs, privacy, limits
- **Cost per photo:** SAM is about 3–5 images, about USD 0.01. The Muse transcription is one image call, about USD 0.02–0.05 (estimate; to be measured). Label the diagram adds 1–2 SAM calls and one Muse call.
- **Privacy:**
  - Meta Standard mode. Photos are stored only under `storage/` (gitignored) and never in evidence.
  - Demo photos are project-authored or public-domain pages only.
  - Commercial textbooks remain the teacher's responsibility. The rights box text names AI processing, and OpenStax-style no-AI terms are an explicit "no".
- **Known limits from the check:**
  - SAM does not segment text blocks; Muse does the text.
  - Abstract shapes need point prompts.
  - SAM returns axis-aligned boxes on rotated pages; we use the page mask for deskewing.

## 4. Build outline (when approved)
| Slice | Owner | Size |
|---|---|---|
| SAM client + output parser (tested on recorded responses) | Qwen Max | S |
| Muse transcription prompt + schema, image input in `packages/meta` | Muse via bridge | M |
| Upload, crop/deskew, confirm screen, `origin: photo` source | Opus (web) + Qwen (API) | M |
| `label-diagram-v1` contract, validators, view | Muse (contract) + Qwen (validators) + Opus (view) | L |
| Live evidence: 3 photos, 3 diagrams | lead | S, about USD 0.50 |
