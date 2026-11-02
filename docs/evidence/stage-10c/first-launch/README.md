# Stage 10c slice A: first launch, page guide, Demo prompt, Try your own page

Spec: `docs/specs/STAGE-10c-first-launch-and-fixes.md` section 1, plus H4, M1, M2, M4, L3, L5 from
`docs/reviews/ux-pair-review-2-2026-11-02.md`. Built and checked by Opus 5.5 (slice A), 2 Nov 2026.

How these frames were made: Vite dev server on :5173 against the local read-only API on :8787 (gate off, live
generation off). The judge-locked and judge-granted states were shown with a GET-only fetch shim on `/api/access` in
this agent's own browser tab (registered with `Page.addScriptToEvaluateOnNewDocument`, gated on a sessionStorage flag;
any non-GET to `/api/access` was answered 403 by the shim). Nothing was POSTed, built, saved, published or submitted.
localStorage was cleared before each first-launch walk. JPEG q72, 2560 frames downscaled to 1920 wide.

## The flow, step by step

| # | Frame | What it shows |
|---|---|---|
| 1 | `1920-01-welcome-locked.jpg` | First visit (no `mki.welcome`): the Welcome inside the app window. One statement, the lede, three facts from the data (97 pages in 9 subjects, the two models, SAM 3.1), then two equal choices: Enter access code (inline form) and Continue read-only. |
| 1b | `1920-01b-welcome-gate-off-local.jpg` | Gate off on this local server with live generation off: the access side says "Live builds are off on this server" (never "builds are open" when they are not) and Continue is the only button. With the gate off and live on it reads "Builds are open on this server". |
| 1c | `1920-02-welcome-light.jpg` | The same screen in the light theme. |
| 2 | `1920-03-guide-1-new-lesson.jpg` | Guide step 1 of 6: the main view moves to New lesson; the two paths are lit (and the sidebar entry). The library list scrolls in its own box with the chosen page in view (M1). |
| 3 | `1920-04-guide-2-lesson.jpg` | Step 2: the opening lesson; the lesson column is lit, card beside it. Wording says "AI-written summary, each point tied to the sentence it came from" (M2). |
| 4 | `1920-06-guide-4-checks.jpg` | Step 4: the guide opens Checks and run details and brings its checks section into view. Step 3 (Present) points at the Present button without entering it. |
| 5 | `1920-08-guide-6-results.jpg` | Step 6: Results, with the headline numbers lit. Step 5 (Review and publish) lights the page header. |
| 6 | `1920-09-guide-demo-prompt.jpg` | The Demo prompt: "Watch a lesson being built", "Recorded, about 1 minute" (computed from the pinned run's recorded length at 2x), Watch the demo / Not now. |
| 7 | `1920-12-demo-figure-grounding.jpg` | M4, new Demo step on the pinned grounded run `job-20261101234914-97ba271b`: "Muse Spark finds the parts, SAM 3.1 confirms them", shown while the strip says "Muse Spark is locating 5 parts". Whether the run was grounded is read from its full record, so the card is right from the first moment. |
| 8 | `1366-13-demo-repair.jpg` | The repair step names the check that failed from the run's own events (LD-06's teacher name), not hard-coded wording. |
| 9 | `1920-17-demo-try-your-own.jpg` | End of the Demo: "Try your own page" with "Browse the lessons". The present step before it keeps Next and offers "Open presentation mode" as a side action; the Demo stays mounted (hidden) during presentation and comes back on exit (checked: Esc out of the slides returns to Step 9 of 9). |
| 10 | `1920-18-own-source-locked.jpg`, `1366-18-own-source-locked.jpg` | H4: Try your own page opens New lesson on Your own source (`?view=new&path=own`). Locked, the access form sits at the top of that panel and the paste form shows greyed below (`inert`, not usable); the build area says where to enter the code, so there is one access field on the page. |
| 11 | `1920-19-new-lesson-search-hides-choice.jpg` | M1: a search that hides the chosen page says so above the preview ("Chosen page, not in these results. Clear the search"). Search reads titles, publisher, subject name and the curated page summary: "water" finds The Hydrologic Cycle. |
| 12 | `2560-01-welcome-locked.jpg`, `2560-12-demo-figure-grounding.jpg`, `1366-01-welcome-locked.jpg` | The same frames at QHD and at 1366x768. |

## Measured checks
- Card placement, per step, at 1920x1080, 2560x1440 and 1366x768: the card never overlaps a lit target, stays inside the
  viewport, and the document never scrolls (`scrollHeight === innerHeight`). Guide sides at 1920: right, left, left,
  left, right, below, centre. Demo at 1366: below, above, left, left, left, left, left, centre.
- The Welcome fits without scrolling at all three sizes.
- Deep links skip the Welcome on a cleared browser: `?job=`, `?present=`, `?view=`, `?welcome=0` (and `?replay=`,
  `?demo=`/`?tour=`, dev harnesses, by unit test). `?welcome=1` forces it. A returning visitor (`mki.welcome=done`) lands
  on the app with no Demo opening by itself. Sidebar "Show the welcome again" (Results and help) reopens it.
- Esc on the guide skips it back to the lesson; Not now closes it on the lesson; Browse the lessons opens All lessons and
  records the Demo outcome `done` (the existing key keeps its meaning).
- The Demo replay runs about 65 s of build at 2x (reading 20 s, summary 18 s, figure 12 s, repair 13 s).

## Verification
- `node --test apps/web/src/lib/*.test.ts`: 1212 pass, 0 fail (whole web suite, all slices present).
- `npm --prefix apps/web run build`: passes (tsc + vite).
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.
