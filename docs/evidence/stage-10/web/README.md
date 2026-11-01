# Stage 10 slice B: sidebar, New lesson, All lessons, How it works, Demo, access footer (web)

Spec: `docs/specs/STAGE-10-navigation-and-access.md`, section B (frozen). Built by Opus 5.5 (web slice), 2026-11-02.
All frames are from the Vite dev server against the read-only local API (GET only, live generation off). No POST was
sent to the API: the gate-on frames come through a browser fetch shim (below), which also blocked every non-GET request.

## What changed on screen

- **Sidebar** (replaces the icon rail): always expanded, labelled, 232 px (260 px at 2200 px and wider, 212 px at
  1440 px and narrower). Sections with a small sentence-case heading: Create (New lesson) · Lessons (All lessons, then
  the open lesson marked by an accent dot) · This lesson (Lesson, Source page switch, Present, Checks and run details,
  Review and publish; only while a lesson is open) · Results · Help (Demo, How it works) · access status at the bottom.
  One filled row = the view on screen (`aria-current="page"`); Source page is a toggle (`aria-pressed`, small switch);
  Present without a finished lesson is `aria-disabled` with its reason. Up/Down/Home/End move between entries.
  Below 1100 px it folds into a Menu button that opens the same list over the page (Esc or a click outside closes it).
- **Every entry opens in the main area.** The right drawer now only holds "Checks and run details" of the open lesson.
  The view is in the URL (`?view=new|lessons|review|results|how`); entries push history, so Back returns to the previous
  view. `?job=`, `?present=`, `?replay=`, `?tour=` keep working; `?demo=` is the new alias of `?tour=`.
- **New lesson page**: two equal path tabs, "From the library" (search, subject chips, the 97 pages in subject groups,
  each with how many lessons exist) and "Your own source" (the existing paste form and its rules, plus the teacher's
  saved texts). A sticky panel on the right shows the chosen page (subject, publisher, original link, its opening lines,
  "16 lessons already built from this page · Open the newest") and the Build area (model choice, Build lesson, run
  options). Gate on without access: the Build area holds the access-code form with the spec sentence; the own-source
  path lists what the form will ask for. Never a dead Build button.
- **All lessons**: finished lessons newest first, "Newest per page" (default, 104 rows), "Every lesson" (669) or
  "All runs" (742, with failed and declined runs and their result), subject chips, search by page title, 60 rows at a
  time. The open lesson is marked "Open now".
- **How it works**: what the app does, the six pipeline steps (Muse Spark reads, writes each part, code checks,
  Muse repairs after a failed check, SAM 3.1 + Muse locate diagram parts, teacher review), the two models with their
  exact model strings, and what a visitor can do with and without the access code.
- **Review and publish / Results**: one calm sentence each ("Teacher review and publishing open here." /
  "Evaluation results for both models open here.") until their slice lands.
- **Demo**: every visible "Tour" now reads "Demo" (sidebar entry, "Skip demo", card copy).

## Files

| Frame | Size | What it shows |
|---|---|---|
| `00-before-1920.jpg` | 1920×1080 | Before: the icon rail |
| `01-lesson-sidebar-1920.jpg` | 1920×1080 | Lesson view with the sidebar, gate off (no footer) |
| `02-new-lesson-library-granted-1920.jpg` | 1920×1080 | New lesson, library path, judge access granted ($47.12 of $50 left), Build lesson enabled (shim: health live) |
| `03-new-lesson-library-locked-1920.jpg` | 1920×1080 | Read-only: access-code form in the Build area, focused from "Enter access code" |
| `04-new-lesson-own-locked-1920.jpg` | 1920×1080 | Read-only, own-source path: what the form asks for |
| `04b-new-lesson-own-open-1920.jpg` | 1920×1080 | Gate off, own-source path: saved texts + the paste form |
| `06-budget-reached-1920.jpg` | 1920×1080 | Judge budget used up: footer and Build area say so |
| `08-demo-replay-1920.jpg` | 1920×1080 | Demo started from the sidebar, recorded build playing ("Replay" on the open lesson) |
| `09-all-lessons-1920.jpg` | 1920×1080 | All lessons, newest per page |
| `10-lesson-sidebar-2560.jpg` … `13-how-it-works-2560.jpg` | 2560×1440, saved at 1920 wide | Lesson, New lesson, All lessons, How it works at QHD |
| `15-review-placeholder-1920.jpg` | 1920×1080 | Review and publish placeholder |
| `20-lesson-sidebar-1366.jpg` | 1366×768 | Lesson at 1366: diagram and its name slots side by side, first control above the fold |
| `21-new-lesson-1366.jpg` | 1366×768 | New lesson at 1366: Build lesson above the fold (bottom 647 px of 696 px) |
| `24-read-only-footer-1366.jpg` | 1366×768 | Read-only footer at 1366 with every section in view |
| `25-narrow-menu-1000.jpg` | 1000×700 | Narrow window: Menu button with the sections open |
| `30-new-lesson-light-1920.jpg` | 1920×1080 | Light theme, read-only New lesson |

## Measurements (browser, `Emulation.setDeviceMetricsOverride`)

- 1920×1080: sidebar 232 px; New lesson side panel 233–859 px, inside the page column (bottom 998 px); document never
  scrolls (`scrollHeight === innerHeight`) on any view.
- 2560×1440: sidebar 260 px, page column 1440 px wide; New lesson side panel bottom 890 of 1440.
- 1366×768: sidebar 212 px, lesson column 751 px, label-diagram body two columns (383 + 256 px, was one column at
  701 px before the laptop rule); New lesson Build button bottom 647 px (page column bottom 696 px); with the read-only
  footer the section list fits (555 of 555 px, "How it works" ends at 570 px, footer starts at 620 px).
- Focus: a sidebar view change focuses the new page's heading (`h1`, no ring); Lesson focuses the lesson title;
  "Enter access code" focuses `#access-code` without scrolling the page; Esc after Present returns to the lesson title.
- Demo: start from the sidebar → welcome → library step (cut-outs on the source header and the sidebar's New lesson)
  → "Watch a lesson being built" → reading step; "Skip demo" closes it, the live strip is gone 3 s later, the lesson
  shows at rest, the sidebar's "Replay" badge clears.
- A11y sweep on each main view: no duplicate ids, no unnamed buttons or tabs, no unlabelled fields, exactly one
  `aria-current="page"`.

## Gate-on states (browser fetch shim, not the API)

The API's `/api/access` route was not on the running server (404 = gate off, which the app treats as today's
behaviour). To see the gate-on states, a scratch script registered with `Page.addScriptToEvaluateOnNewDocument`
answered `GET/POST/DELETE /api/access` from a `sessionStorage` mode (locked / granted / budget / paused), accepted one
made-up code, optionally reported `/api/health` as live so the Build button could be seen enabled, and refused every
other non-GET request locally. Checked: footer texts for read-only, granted, budget used up, paused and live off; a
wrong code shows "That access code is not right. Check it and try again."; the right code swaps the form for the
Build button and the footer for "Judge access · $47.12 of $50 left"; Sign out returns to read-only.

## Checks

- `node --test apps/web/src/lib/*.test.ts`: 1092 pass, 0 fail (new: `navigation.test.ts`, `access.test.ts`,
  `browse.test.ts`, `onboarding.demo.test.ts`, 31 tests, written red first).
- `npm --prefix apps/web run build`: typecheck + Vite build pass.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]` (0 findings).
