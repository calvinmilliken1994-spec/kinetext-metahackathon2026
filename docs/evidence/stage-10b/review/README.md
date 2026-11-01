# Stage 10b slice R: Review and publish, browser evidence

Built test-first. API: `apps/api/review.ts` + `POST /api/jobs/:id/review` (tests: `apps/api/review.test.ts`, 18). Web: `lib/reviewState.ts`,
`lib/review.ts`, `components/ReviewPage.tsx`, `styles/review.css` (tests: `lib/review.test.ts`, `lib/review.api.test.ts`).

## How these frames were made
The real `App.tsx` does not mount `ReviewPage` yet (the lead swaps it in), so the page was mounted in a dev-only harness
(`harness/`, copied here for reference, **not** left in the repo): the real hooks, the real `Sidebar`, `ReviewPage`, `LessonView`,
`AllLessonsPage`, `Provenance` and `PresentationMode`, wired the way `App.tsx` wires them. It talked to the **real API server code**
(`createApiServer`) on its own port, over a *copy* of three stored lessons in a local scratch folder, so every publish and unpublish
below is a real POST that wrote and deleted a real `review.json`. The read-only `:8787` server and the repo's `storage/` were never
written. Lessons: `job-20261101200607-c65a20bb` (label diagram + sequence), `job-20261029150146-6acd7991` (formula explorer, quiz
cards, sequence; one part revised by Muse), `job-20261029145041-58a3467e` (timeline premium part, used for the timeline tag check).
For the signed-in case the scratch server ran with the judge gate on; the session cookie came from a Node `POST /api/access` and was
set in the browser with CDP, so no code was typed into the page. Dark theme, 1920x1080 unless the name says otherwise.

| File | What it shows |
|---|---|
| `01-draft-1920.jpg` | Draft: one row per working part (title, kind, check status), "I've read the wording", "Hide from the lesson", Open; Publish disabled, "0 of 2 parts read". |
| `04-hide-a-part.jpg` | One part ticked, the other hidden: it moves to "Hidden from the lesson", Publish unlocks ("All 1 part read, 1 hidden"). |
| `05-published-with-hidden.jpg` | After Publish: state "Reviewed by a teacher · published 2 Nov 2026", the hidden part listed as not in the lesson or slides, Unpublish. |
| `02-published-review.jpg` | Published, nothing hidden. |
| `03-published-lesson.jpg` | The lesson itself: status line "Reviewed by a teacher · published 2 Nov 2026 · 2 parts ready", part tag "AI-written · teacher-reviewed". |
| `06-slides-hook.jpg` | Slides of a lesson with a hidden part: no sequence beat; credit line ends "reviewed by a teacher". |
| `07-all-lessons-published-mark.jpg` | All lessons: the "Published" mark after the page title. |
| `08-read-only.jpg` | Judge gate on, no session: checklist disabled, access form inline, Publish disabled with the reason. |
| `09-draft-2560.jpg`, `10-draft-light-1920.jpg`, `11-draft-1366.jpg` | 2560x1440 (resized to 1920 wide), light theme, 1366x768 (no horizontal overflow). |

## What was checked in the browser (values read from the DOM)
- Publish stays disabled until every visible part is ticked (`0 of 2` → `1 of 2` → `All 2 parts read. Ready to publish.`); hiding a part removes it from what must be ticked; ticks survive going to the lesson via **Open** and back.
- Publish wrote `review.json` (`hiddenParts: []`, `checkedParts` in lesson order); Unpublish deleted it and the lesson read "Teacher review pending · 2 parts ready" again with both parts back.
- **Open** switches to the lesson and scrolls the part into view (a ring that fades, `data-review-target`).
- Published lesson, status line: `Reviewed by a teacher · published 2 Nov 2026 · 2 parts ready`; tags `AI-written · teacher-reviewed`; no "needs teacher review" or "Teacher review pending" text left in the lesson. Timeline lesson: tags went from `AI-written · needs teacher review` to `AI-written · teacher-reviewed`.
- Hidden part: gone from the lesson DOM (`[data-component]` list = diagram only), no left-out notice, not a beat in the deck (track: Title, Diagram, In short, Key terms, Sources), title-slide line `Reviewed by a teacher · published 2 Nov 2026 · …`, closing line the same, hook credit `… reviewed by a teacher`.
- All lessons shows `Published` only on the published lesson.
- Gate on without a session: all six checkbox/switch inputs and Publish disabled, access form shown; with a session cookie the form is gone and publish worked.
- After a publish or unpublish the result sentence takes focus (`role=status`).

Not shown in a frame: the "Held back by the checks; not in the lesson" list (no stored lesson in the demo set has a re-check-withheld part; it is covered by `lib/review.test.ts`, "a draft review lists every working part…"), and an `ACCESS_REQUIRED` refusal inside the page (covered by `apps/api/review.test.ts` and the message test).
