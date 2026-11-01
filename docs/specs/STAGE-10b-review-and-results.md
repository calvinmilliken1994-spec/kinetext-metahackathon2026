# Stage 10b: Review and publish, Results page

Status: FROZEN by the lead, 2026-11-02. Builds on `STAGE-10-navigation-and-access.md`. Sidebar entries already route
to `?view=review` and `?view=results`; the placeholders live in `apps/web/src/components/HowItWorksPage.tsx`. **The lead
swaps in the real pages** (one import plus one line each in `App.tsx`): the children export components and never edit
`App.tsx`.

## R. Review and publish (Sonnet: API + web)
Calvin: "The teacher review > publish section never got completed. Once published, will 'Needs teacher review' texts
also be changed on that specific completed lesson?" Answer, frozen: yes, on that lesson only. "AI-written" stays.

- **Storage:** `storage/runs/<jobId>/review.json` holds `{ status: 'published', publishedAt: ISO, hiddenParts:
  string[] /* component ids */, checkedParts: string[] }`. It is written atomically (temp file plus rename). No file
  means not reviewed.
- **API (`apps/api/**`):**
  - `GET /api/jobs/:id` adds `review` when the file exists.
  - `POST /api/jobs/:id/review` with body `{ action: 'publish', checkedParts: string[], hiddenParts: string[] }` or
    `{ action: 'unpublish' }`:
    - It uses the same Origin check, and the same access gate as other POSTs (Stage 10 A: 403 `ACCESS_REQUIRED` when
      the gate is on and there is no session). Publishing costs nothing, so the judge budget does not apply.
    - It is only for a succeeded lesson job, otherwise `409 NOT_REVIEWABLE`.
    - `publish` requires every published part, apart from the hidden ones, to be in `checkedParts`; otherwise
      `400 REVIEW_INCOMPLETE`. At least one part must stay visible (`400 NOTHING_TO_PUBLISH`).
    - Unknown part ids give `400 BAD_REQUEST`.
    - `unpublish` deletes the file.
    - It returns `200 { review | null }`.
  - Tests in `apps/api/review.test.ts`.
- **Web (new `components/ReviewPage.tsx` and `lib/review.ts` plus tests; edits to `Provenance.tsx`, `Explanations.tsx`,
  `TimelineView.tsx`, the `lib/lessonJob.ts` status text, `api.ts`, and the lesson/slide part filters as needed):**
  - **Review page** for the open lesson: one row per published part, with its title, kind and check status, an
    *Open* link that scrolls to the part in the lesson, an "I've read the wording" checkbox and a *Hide from the lesson*
    switch. Parts held back by checks are listed separately and read-only ("Held back by the checks; not in the
    lesson").
  - **Publish lesson** is enabled once every visible part is ticked. A short note says what publishing does.
  - **After publishing:**
    - the lesson's status line reads "Reviewed by a teacher · published 2 Nov 2026" in place of "Teacher review
      pending";
    - per-part tags read "AI-written · teacher-reviewed" in place of "needs teacher review";
    - hidden parts disappear from the lesson and the slides;
    - the review page shows the published state with *Unpublish*.
  - **Read-only visitors** see the checklist disabled, with the access form (`AccessForm.tsx`) inline.
  - **All lessons** shows a small "Published" mark on published lessons (`lib/browse.ts` may expose it).

## S. Results page (Opus: web + a data script)
Calvin: "Having some visualised data would also be good, comparison tables and pass rate when building lessons and what
specific parts pass and make it to live lesson."
- **Data:** a new `scripts/build-results.ts` writes `apps/web/src/data/results.json` from committed evidence only:
  - the pre-registered final evaluation: `docs/evidence/final-eval/summary.json`, `jobs.csv` (components carry
    `engine:passed@rN` / `failed`), `REPORT.md` as the reference;
  - the timeout retest: `docs/evidence/timeout-retest/results.jsonl`;
  - the diagram runs: `docs/evidence/stage-8c/live/results*.jsonl`, `docs/evidence/stage-8d/live/results*.jsonl`.

  Every number keeps its source path and date. Nothing is computed from `storage/`, which is not committed. A test
  checks that the script's output equals the committed JSON and that key totals match `REPORT.md` (189/194, 178/194,
  348/379, 342/374, the first-try 303/379 and 272/374).
- **Page (`components/ResultsPage.tsx`, `lib/results.ts`, `styles/results.css`):**
  1. **Headline:** lessons with at least one working interactive part, per model, as a big number with its Wilson
     interval in small text.
  2. **Comparison table** for Spark 1.3 vs Spark Open: lessons, parts published/planned, passed first try, fixed by
     repair, failures, time p50/p90, cost per lesson, and the same result when run twice.
  3. **"What reaches the live lesson":** for each part type and model, planned → passed first try → passed after
     repair → published, as horizontal stacked bars with exact counts, sortable by type.
  4. **Pass rate by subject**, per model.
  5. **Diagram lessons today:** the Stage 8c/8d runs, each with its model, result, SAM confidence range and a link to
     open the lesson (`?job=`).
  6. **Method notes:** pre-registered, 97 pages × 2 runs × 2 models, the dates, and where the raw data lives. The
     timeout retest is labelled "not part of the pre-registered evaluation".
- **Charts are inline SVG or CSS** (no chart library), accessible (table equivalents, `aria` labels), matching the app's
  tokens and readable at 1920 and 2560. Impeccable detect stays 0.

## Ownership
| Slice | Owner | Files |
|---|---|---|
| R | Sonnet 5.5 | `apps/api/**` (review route), `apps/web/src/components/ReviewPage.tsx`, `lib/review.ts`, `Provenance.tsx`, `Explanations.tsx`, `TimelineView.tsx`, `lib/lessonJob.ts`, `api.ts`, `lib/browse.ts`, lesson/slide part-filter code |
| S | Opus 5.5 | `scripts/build-results.ts`, `apps/web/src/data/results.json`, `components/ResultsPage.tsx`, `lib/results.ts` (+ tests), `styles/results.css` |
| Lead | Opus 5.5 | `App.tsx` swap of the two placeholders, the API restart, browser checks |
