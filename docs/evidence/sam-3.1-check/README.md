# SAM 3.1 availability check (2026-10-31)

Approved by Calvin as a check only (no product build). Direct Meta Model API, Standard mode, key from the profile environment (not stored).

| Request | Result |
|---|---|
| `GET /v1/models/sam-3.1` | **200** `{"id":"sam-3.1","owned_by":"meta"}` — enabled on this account |
| concept "page" | 1 object, conf 0.92 — the rotated page on the desk |
| concept "diagram" | 1 object, conf 0.81 — the drawn cell only (labels and leader lines outside the box) |
| concept "table" | 1 object, conf 0.82 — the 5-row table |
| concept "paragraph" | **0 objects** — text blocks are not a SAM concept; text goes to Muse |
| concept "chloroplast" | **4 of 4** chloroplasts in the figure, conf 0.74–0.75 |
| concept "nucleus" | **0 objects** — the abstract purple circle is not recognised by name; needs a point prompt |

Latency 0.8–4.5 s per image (stream). Billing: 6 images processed (`usage.images_processed` = 1 each) × USD 2.50 / 1,000 images (dev.meta.ai pricing page, read 2026-10-31) = **USD 0.015**. Four first attempts returned HTTP 400 (`include_confidence` must be sent as `metadata.include_confidence: "true"`), with no images processed.

Image: `page-photo.jpg`, a project-authored synthetic textbook page (no third-party content). Overlays: `check-overlay.jpg` (page/diagram/table), `check-overlay-parts.jpg` (chloroplasts).

Findings for design (`docs/specs/STAGE-8-photo-and-diagrams.md`): SAM 3.1 is good at page/figure/table regions and at named concrete parts; it does not segment text blocks and misses abstract shapes by name, so the design pairs SAM with Muse Spark image understanding (transcription, part names, point locations) and SAM point prompts.
