# Set A, app shell: browser evidence

Built by Opus 5.5 (web child) on 2026-11-01 against the dev server (Vite :5173) and the read-only API (:8787, GET only, no
POST, no Generate clicked). Dark theme. Viewports set with `Emulation.setDeviceMetricsOverride`. Frames marked "shim" came
through a test `fetch` wrapper injected with `Page.addScriptToEvaluateOnNewDocument` (it hides or fails one request); no
stored artifact or server code was touched.

Findings covered: W-07, W-08, W-11 (stage-7-9-web-review), W2-04, W2-05 (part 2), UX review #1 (stale stored parts under a
checked badge) and the "Missing run" row, UX review part 2 section 2.6.

## 1. Missing lesson notice (`?job=`, `?present=`, `?replay=`)

| Link | 1920×1080 | 1366×768 | Result |
|---|---|---|---|
| `?job=ux-review-missing` | `01-missing-job-dark-1920.jpg` | `01-missing-job-dark-1366.jpg` | Notice "That saved lesson was not found"; no lesson, no presentation, no live bar; focus on the notice heading; no document scroll |
| `?present=ux-review-missing` | `01-missing-present-dark-1920.jpg` | `01-missing-present-dark-1366.jpg` | Same; presentation mode does not open |
| `?replay=ux-review-missing` | `01-missing-replay-dark-1920.jpg` | `01-missing-replay-dark-1366.jpg` | Same; nothing replays |
| "Choose a lesson" | | `02-missing-choose-lesson-drawer-1366.jpg` | Opens Runs with "All pages" selected |
| `?job=` / `?present=` of a listed run whose detail returns HTTP 500 (shim) | `14-unreadable-job-1920.jpg`, `14-unreadable-present-1920.jpg` | | Same title, body "its saved files could not be read"; no error wall, no other lesson |

## 2. Stale parts withheld (API `recheck`)

Real case from the live API: `job-20261031111156-12c77646` (pH lesson), `log-ladder-v1` stored as passed, `recheck =
{ publishable: false, failedChecks: ['LOG-06', 'LOG-07'] }`.

- `04-recheck-held-back-ph-1920.jpg`, `05-recheck-held-back-card-1920.jpg`: the ladder card reads "Held back"; message
  "Held back: this part no longer passes today’s checks."; teacher details list the two check names; ids only under
  technical details. No ladder drawing is mounted (only the status icon SVG in the card).
- `06-recheck-present-no-ladder-1920.jpg`: presentation mode has 4 beats (title, overview, key terms, sources); no ladder beat.
  No presentation code changed: the part reaches presentation as a failed component.

## 3. Replays (W-07)

| Link | Frames | Result |
|---|---|---|
| `?replay=job-20261030031842-18da8429` (classic Moon activity) | `03-classic-replay-rejected-1920.jpg` | Turned down: "This run can’t be replayed … Its stored result is shown instead." Polled every 0.3 s for 12 s: never "Not running", never a replay label on a non-replay |
| `?replay=job-20261031110030-f2914c08` (failed lesson, TIMEOUT) | `13-replay-failed-end-1366.jpg` | Replay label on every frame, including the final "Blocked" outcome card; never "Not running" |
| `?replay=job-20261031110053-cf4fe82c` (declined lesson) | `13-replay-declined-end-1366.jpg` | Label on every frame through the decline card |
| `?replay=job-20261030104333-c7083fa8` (lesson) | `13-replay-lesson-end-1366.jpg` | Label throughout, unchanged behaviour |

## 4. Tour (W-08, W-11)

- Recording missing from the runs list (shim): `09-tour-no-recording-1..4-*.jpg`. Steps welcome → library → try → present,
  every Next enabled, ends on "Open presentation mode"; outcome stored as `done`.
- Recording listed but its GET fails with HTTP 500 (shim): `10-tour-replay-failed-retry-continue.jpg`. The reading step says
  the recorded run could not be loaded and offers Retry and "Continue without it" (the disabled Next is hidden). Retry while
  still blocked keeps the message; Continue drops the replay steps, puts the opening lesson back and lands on "try"
  (`11-tour-after-continue.jpg`), then "present". Retry after unblocking (`12-tour-retry-succeeds.jpg`) plays the replay and
  the tour auto-advances to the overview step.
- Focus restore, `tour-focus-restore.json`: tour opened from the rail, closed with keyboard Enter on "Skip tour" → focus on
  the Tour rail button; closed with Esc → Tour rail button; auto-started tour on a plain visit closed with Esc → the lesson
  column (`main.activity-panel`).

## 5. Runs drawer focus (W2-04)

`drawer-focus-1264.json`, `08-drawer-trap-1264.jpg`, at 1264×800 on the Moon lesson: the drawer is `role="dialog"`
`aria-modal="true"`, `.rail` and `.workspace` are `inert`; 6 Shift+Tab and 68 Tab presses (60 controls) never left the drawer
and wrapped. Esc returns focus to the Runs rail button and clears every `inert`. At 1920×1080 the side-by-side drawer stays
non-modal (`role="complementary"`, nothing inert, Shift+Tab may leave it).

## 6. Gravity presets (W2-05)

`07-moon-presets-1920.jpg`, `job-20261030104333-c7083fa8`: chips "1.62 m/s²" and "9.8 m/s²" still offered (both written as
m/s^2 on the page); picking 9.8 draws the 1.62 arc with "the other value the page states". The reviewer's probe (9.8 seconds
duration) is a unit test: no 9.8 chip, no comparison arc.

## Checks run

- `node --test apps/web/src/lib/*.test.ts`: 931 tests, 931 pass.
- `npm --prefix apps/web run build`: typecheck and build pass.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

Known limits: the browser was shared with another web child, whose navigation took over this tab several times; affected
captures were redone, and every frame listed here was checked against its own URL before saving. On a first visit the
tour's step count can change from "of 3" to "of 4" once the open lesson has loaded (the try step appears).
