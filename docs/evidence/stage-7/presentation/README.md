# Stage 7c slice P4 — presentation mode (evidence)

Built by Claude Opus 5.5 (subagent, slice P4 of `docs/specs/STAGE-7c-demo-visuals.md`). All screenshots are real stored
runs read GET-only from the local API; nothing was generated for them.

| Shot | Run | What it shows |
|---|---|---|
| `00-workspace-entry-points-dark.png` | Moon lesson `job-20261030031842-3b2790f3` | "Present" in the lesson header and in the rail |
| `01-title-noaa-dark.png`, `13-title-noaa-light.png` | NOAA `job-20261029123057-ea478a2a` | Title beat: lesson title, page, publisher, licence, `Draft · needs teacher review` + AI disclosure |
| `02-overview-building-noaa-dark.png`, `03-overview-revealed-noaa-dark.png` | NOAA | Overview builds one key point per → (R shows all) |
| `04-predict-moon-dark.png` → `05-predict-revealed-moon-dark.png`, `14-predict-revealed-moon-light.png` | Moon | Predict beat (case 1, class estimate typed in) and its reveal: engine value, graded with the teaching margin |
| `06-component-physics-moon-simulation-dark.png` | Moon | Physics: the real projectile view at projector scale, playing |
| `07-component-chemistry-noaa-balance-dark.png`, `15-…-light.png` | NOAA | Chemistry: the real balance view (P2 atom bars) at projector scale |
| `08-predict-revealed-nara-which-first-dark.png` | NARA Lee Resolution `job-20261029202321-a8b6bdbf` | Which came first: class choice, dates and page sentences revealed |
| `09-component-history-nara-timeline-dark.png` | NARA | History: the timeline after "Reveal", zoomed to the axis (P3 time axis) |
| `10-quiz-vote-nara-dark.png` → `11-quiz-revealed-nara-dark.png` | NARA | Quiz: class choice marked, then R |
| `12-closing-nara-dark.png` | NARA | Closing beat: page, licence, link, page sentences, one calm checks line |
| `16-quiz-revealed-noaa-light-1280x720.png`, `17-overview-notes-hover-quote-moon-dark-1280x720.png` | NOAA, Moon | 1280×720; presenter notes (P) and a hovered point showing its page sentence |

Deep link: `http://127.0.0.1:5173/?present=<jobId>&beat=<n>` (beat 1-based). The address follows the beat while
presenting; leaving returns to `?job=<jobId>`.

## Keyboard map

| Keys | Does |
|---|---|
| → · Space · PgDn · ↓ | next build step, then next beat |
| ← · PgUp · ↑ | back (a previous beat comes back fully built) |
| R | reveal the current beat completely (never moves on) |
| 1–9, 0 | jump to beat 1–10 (starts it unrevealed, so a question can be asked again) |
| Home / End | first / last beat |
| B or . | black screen; the next key press only brings the picture back |
| P | presenter notes: a cue for the teacher + the page's words for this beat |
| F | full screen on/off (stays in presentation) |
| ? or H | key list |
| Esc | leave (in a field: let go of the field first); the browser's own Esc out of full screen also leaves |

Ctrl/Cmd/Alt combinations are never taken. Keys typed into a field or slider stay there. A mouse click on a bar button or
an answer hands the keys back to the deck, so Space never re-presses it.

## Verification

- `node --test apps/web/src/lib/presentation.test.ts`: red first (module missing), then 23/23 green. All of
  `apps/web/src/lib/*.test.ts`: 632/632 (includes the other slices' tests at the time of the run).
- `npm --prefix apps/web run build`: green. `impeccable detect --json apps/web/src apps/web/index.html`: `[]` (0 findings).
- In-browser checks (1920×1080 and 1280×720, dark and light): header and rail entry enter real full screen; `?present=`
  without a user gesture falls back to the whole window with an "F full screen" hint; F toggles full screen and stays;
  Esc leaves and focus returns to the Present button; `#root` is `inert` while presenting; no duplicate ids, unnamed
  buttons or unlabelled inputs inside the overlay; the document never scrolls; reduced motion swaps wipes and travel for
  short fades.

## Critique (in-thread; this subagent had no tool to spawn the dual-agent review)

| # | Heuristic | Score | Note |
|---|---|---|---|
| 1 | Visibility of status | 3 | Progress hairline, beat count, current beat in the bar, live region; the bar hides itself |
| 2 | Match with the real world | 4 | Slide-deck conventions (clicker keys, B black screen, build steps) |
| 3 | User control | 4 | Back, jump, Esc, F, B everywhere; answers kept per beat |
| 4 | Consistency | 3 | Ask beats share one choice pattern; stage beats are the lesson's own views at scale |
| 5 | Error prevention | 3 | Unverified parts are never presented; R never skips a beat |
| 6 | Recognition over recall | 3 | Key reminder on arrival, Reveal button in the bar on ask beats, ? list |
| 7 | Flexibility | 4 | Keyboard, clicker, mouse; deep link to a beat |
| 8 | Aesthetic / minimal | 3 | One type scale on a 16:9 unit; one authored moment (the answer fills in); see P2 items |
| 9 | Error recovery | 3 | A run that cannot be presented just shows the workspace |
| 10 | Help | 3 | ? key list and per-beat notes |

AI-slop tells checked and absent: gradient text, glow halos, side-stripe borders, eyebrow labels over headings,
numbered circles, icon-plus-heading card grids, emoji icons. Fixed during the pass: teacher instructions printed on the
projected slide (now class-facing lines, teacher cues moved to notes), a half-empty overview (now split
coverage | points), a small embedded simulation (now fitted to its scene and equation), the formula explorer stuck in
one column (container query restored inside the stage), the revealed timeline left below the fold (now zoomed to the
axis), the quote strip covering the pointed-at item (now placed away from the pointer), Space re-pressing a clicked
button.

## Known gaps

- Stage beats hide or follow a few class names inside other slices' views (`.predict-first`, `.activity-head > h2`,
  `section.card:has(> .predictions)`, `.explorer > section:has(.predictions)`, `.timeline-view`). If P1/P3 rename them,
  presentation still works but shows the extra cards. A `presentation` prop on those views would be cleaner (lead call).
- Hovering a value to show its page sentence needs a mouse; with a clicker only, the sentences are in the notes (P).
- No white-screen key (W); B is black in both themes.
- Formula-explorer predict beats show no output unit (the spec stores none for the output).
- Muse wording is shown as stored (e.g. `m/s^2`, quiz stems without a question mark); not edited here.
