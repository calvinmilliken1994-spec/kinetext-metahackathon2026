# Scene driver rehearsal (3 Nov 2026)

Driver: `scripts/video/drive.mjs` + `scenes.mjs` + `cdp.mjs` (docs/video/CAPTURE.md). Run against Vite on 5173 with the
**read-only** API on 8787 (`live:false`), `--dry --auto`, Chrome app window on a 2560×1440 screen.

Commands run:

```
node scripts/video/drive.mjs all --dry --auto --job job-20261102050029-1ebd79c6 --shots docs/evidence/video-capture
node scripts/video/drive.mjs 4,5 --dry --auto --job job-20261102045143-d9405202 --shots docs/evidence/video-capture/scene5-unpublished-run --close
```

Writes blocked by the dry guard (every non-GET `/api` request is failed in the browser): **none** in either run, so
nothing tried to write.

## Measured durations vs SCRIPT.md (draft 2)

| Scene | Script window | Script length | Measured (dry) | Notes |
|---|---|---|---|---|
| 1 Before and after | 0:00–0:14 | 14 s | 15.3 s | includes page load and waiting for the access check to settle |
| 2 What it does | 0:14–0:30 | 16 s | 16.9 s | ends on the cut to New lesson |
| 3 Live build | 0:30–1:30 | 60 s | 4.8 s (dry stop) | dry stops after subject + page; live length is the build (~2–3 min, sped up in the edit) |
| 4 Use it | 1:30–1:55 | 25 s | 23.3 s (23.2 s on the unpublished run) | Magma = number 3 on both volcano runs |
| 5 Teacher signs off | 1:55–2:15 | 20 s | 18.9 s (published run, nothing to tick) / 19.5 s (unpublished run, 2 ticks) | Publish skipped in dry; live adds the publish round trip (~1 s) |
| 6 Two models | 2:15–2:45 | 30 s | 30.2 s | |
| 7 Try it | 2:45–2:57 | 12 s | 14.9 s | 26 words (~10 s of speech) + the 4 s closing hold already exceed 12 s; the Welcome's access check adds ~2–3 s |

Pauses come from the voiceover word counts at 2.6 words/s (`say()` in scenes.mjs). Calvin starts each scene with F8,
so a scene running a second long shifts only that scene's cut, not the rest of the take.

## Screenshots (CDP `Page.captureScreenshot`, 1920×1080, viewed)

- `scene-1-welcome.png`: Welcome, montage running, fake cursor parked low right.
- `scene-2-new-lesson.png`: New lesson after the cut.
- `scene-3-page-chosen.png`: Earth & space chip on, "What Are Volcano Hazards?" chosen, preview shows it; model picker
  and "Build lesson" present but disabled (read-only server).
- `scene-4-checked.png`: Magma on number 3, Check pressed ("1 of 5 right"), cursor on Check.
- `scene-4-drawer.png`: Checks and run details open on the repair story ("Label the diagram · revised once by Muse",
  failed check, figure before/after).
- `scene-5-ticked.png` / `scene-5-shelf.png`: published run (no boxes, "Read by a teacher") then the Published shelf.
- `scene5-unpublished-run/scene-5-ticked.png`: both "I've read the wording" boxes ticked, cursor resting on
  "Publish lesson" ("All 2 parts read. Ready to publish."), not clicked.
- `scene-6-headline.png`, `scene-6-compare.png`, `scene-6-funnel.png`: Results, slow scroll stops.
- `scene-7-code.png` (cursor on the field: "No code needed here"), `scene-7-explore.png` (cursor on Explore read-only).
- `desktop-window.png`: real desktop capture: the page sits at screen 0,0–1920×1080, app-mode window with its title
  bar moved off-screen; no tabs or address bar.

## Not rehearsable here (read-only API)

- Scene 3 model click and Build (`label[for="model-muse-spark-1.3"]`, `.nl-go-btn:not(:disabled)`), the job-id capture
  from `POST /api/jobs`, and the wait for `[data-testid="live-bar"]` leaving `running`: selectors are from
  ModelPicker.tsx, NewLessonPage.tsx and LiveBuild.tsx, **unverified until the live take**.
- Scene 4 right after a live build (the "watched" live layout) and scene 5's real Publish click.

## Before a take

- A cold Chrome start made scene 7 take 17.0 s instead of 14.9 s (first Welcome load). Open the window first with a
  throwaway scene (`node scripts/video/drive.mjs 1 --dry --auto`), then start the take in the same window.
- `VIDEO_DEBUG=1` prints each click's coordinates and target.
