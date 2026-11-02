# Video capture: scene driver

Agreed with Calvin on 3 Nov 2026. He records with Tella's Windows app (screen + camera + mic) and reads
`docs/video/SCRIPT.md` from Tella's teleprompter. A Node script drives the real app in a clean Chrome window so every
click and pause is the same on every take. Option A: each scene plays when Calvin presses a key, timed to his lines.
Scene 3 (the live build) is the exception: it is recorded screen-only, sped up in the edit, and voiced afterwards.

## Shape

- `scripts/video/drive.mjs` (Node 24, no new dependencies: CDP over the built-in `WebSocket`).
  `node scripts/video/drive.mjs <scene|all> [--dry]`.
- Launches Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`) with its own throwaway profile under the
  scratch dir, `--app=<url>` (no tabs, no address bar), window exactly 1920×1080 at position 0,0, remote debugging on a
  fixed port (9333), no first-run prompts. Reuses the window if it is already open.
- The app runs as usual: Vite on 5173, API on 8787. For the live take the API on 8787 is the live one (the lead starts
  it); for rehearsals it is read-only and `--dry` skips the Build click and anything that writes.
- **Fake cursor:** a small injected arrow (an SVG in a fixed, pointer-events:none overlay at the top z-index) that eases
  to each target (about 450 ms, ease-in-out) before the click, with a brief press dip. The OS cursor is not used (Calvin
  parks his mouse off-screen). Clicks go through CDP `Input.dispatchMouseEvent` at the target's centre, so they are real
  clicks in the app. Typing through `Input.insertText`.
- **Scene trigger:** the driver injects a capture-phase key listener; F8 in the app window starts the next scene (and
  is swallowed, so the app never sees it). Before each scene the driver prints which scene is armed and its first line.
- **Timing:** every scene is a list of steps (`goto`, `wait for selector`, `move`, `click`, `scrollIntoView` with a
  smooth scroll, `pause ms`). Pauses are set from the word count of the voiceover lines they accompany (about 2.6 words
  per second), written next to each line in the scene file so they can be tuned.
- **Robust waits:** each step waits for its selector (timeout 20 s, live build 6 min) and fails loudly with the scene and
  step name; it never clicks blind.
- No secrets: the driver reads no `.env`, types no access code, and never touches the judge code.

## Scenes (`scripts/video/scenes.mjs`), matching SCRIPT.md draft 2

1. **Before and after:** `?welcome=1` with the Welcome's first-launch state cleared; hold for the montage (about 14 s).
2. **What it does:** keep the montage up about 10 s more, then move the cursor to New lesson's entry point and open
   `?view=new&welcome=0&tour=0` (a direct cut is fine).
3. **Live build (screen-only):** New lesson: pick the subject Earth & space, the page "What Are Volcano Hazards?",
   model Muse Spark 1.3, press Build; then keep the window still until "Lesson ready" (the strip) and hold 4 s. In
   `--dry` stop before Build.
4. **Use it:** scroll the diagram into view; put "Magma" on its number (choose the name, then the number: the app's
   click-to-place path), press Check; open "Checks and run details", scroll to the checks list (and the repair story
   when the run has one).
5. **Teacher signs off:** open Review and publish for this run, tick each part's "I've read the wording", press Publish
   (skipped in `--dry`), then All lessons with the Published shelf in view.
6. **Two models:** Results page, a slow scroll through the comparison and the parts funnel.
7. **Try it:** `?welcome=1`, cursor rests on the access code field, then on "Explore read-only"; hold 4 s.

Scene 4 and 5 act on the job scene 3 created; the driver keeps its id (from the URL after Build), or takes
`--job <id>` to rehearse on a stored run.

## As built (3 Nov 2026 rehearsal, `docs/evidence/video-capture/rehearsal.md`)

- Run: `node scripts/video/drive.mjs <all|N|N,M> [--dry] [--auto] [--job <id>] [--shots <dir>] [--close]`. `--auto`
  starts scenes without F8 (rehearsals); `--shots` saves CDP screenshots and timings; `--close` closes Chrome at the end.
- Window: on a screen larger than 1080p the page area is sized to exactly 1920×1080 and the window frame is slid
  off the top-left edge (frame at -8,-31), so the page sits at screen 0,0. Record the region 0,0–1920×1080 in Tella.
  On a 1920×1080 screen the window goes fullscreen instead. `--force-device-scale-factor=1` keeps CSS px = screen px.
- `--dry` also blocks every non-GET `/api` request inside the browser (Fetch domain), not only the Build/Publish steps.
- The job id comes from the `POST /api/jobs` response (Network domain), not the URL.
- Scene 2: the Welcome hides the sidebar, so the cursor goes to "Explore read-only" and the driver cuts to
  `?view=new&welcome=0&tour=0` (clicking it would start the first-run guide).
- Scene 3 in `--dry` stops after subject + page and only reports whether the model picker and Build exist; the model
  and Build selectors are unverified until the live take.
- Scene 4 finds Magma's number from `GET /api/jobs/<id>` (the app numbers parts in spec order) and clicks the name,
  then that number's marker on the diagram.
- Scene 5 ticks only boxes that exist: a run that is already published has none ("Read by a teacher").

## 1440p (Calvin, 3 Nov)

The take is recorded at 2560×1440 so more of the app fits in view; the edit still exports 1080p. `drive.mjs` now
defaults to a 2560×1440 page area (fullscreen on Calvin's 2560×1440 screen, so no taskbar or window frame);
`--size 1920x1080` restores the old size. Dry rehearsal of all seven scenes at 1440p:
`docs/evidence/video-capture/1440/` (scene times 16.2, 18.0, 4.2 dry, 25.8, 18.8, 33.7, 15.4 s). Record the whole
screen in Tella. The leftover airplane run was archived so the retired page no longer heads All lessons.
