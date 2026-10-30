# Presentation mode, pass 2 — visual predict beats (evidence)

Built by Claude Opus 5.5 (subagent). Every screenshot is a real stored run read GET-only from the local API; nothing was
generated. Demo lessons: Moon `job-20261030045435-d508f3be` (projectile + quiz), NASA Drag `job-20261029122502-af74462a`
(formula explorer + quiz), NOAA `job-20261030045545-d5b4e9b5` (balance + compare), NARA Constitution
`job-20261030045550-8266ebd8` (sequence + quiz).

## What changed

| Area | Before | After |
|---|---|---|
| Predict beat, projectile | Prompt + two number boxes, lower half empty (`before-moon-*`) | The scene at projector scale. Before R: only the launch (ball, speed arrow, g), a height scale chosen **from the class's guess alone** and the class guess line — no arc, peak or range. On R the scale glides to the engine's, the ball flies, the peak settles onto/away from the guess with the margin band and gap; the numbers on the right land when the ball reaches the top (`04`–`07`, `10`) |
| Predict beat, formula explorer | Same two boxes (`before-drag-*`) | The explorer's graph (y scale hidden) with the live equation (`= ?`). On R: class guess line, margin band, the point settles, gap label. The x range is narrowed so case 1 sits mid-graph (`lib/explorer.ts predictSpec`), otherwise the reveal was squeezed into a corner (`08`, `09`) |
| Predict beat, other engines | — | Their own scene + equation (variant `scene`), answer hidden until R |
| Number entry | Click into a field | Digits / `.` / `-` / Backspace type the class number directly on an open number question; R, →, PgDn, B still work (a clicker never gets stuck in a field). Enter in the field hands keys back |
| Hiding | CSS selectors into other views (`.predict-first`, `.activity-head > h2`, `section.card:has(> .predictions)`, `.explorer > section:has(.predictions)`, `.timeline-view`) | Explicit props: `ActivityPanel presentation={{mode:'stage'}} / {{mode:'predict',revealed,guess}}`, `FormulaExplorerView presentation`, `TimelineActivity presentation`, views' `variant: 'lesson' \| 'scene'`; the stage follows `[data-pz-follow]` |
| ProjectileView | Guess line only for case 1 | `outcome={last}` from ActivityView, so cases 2–n get it too |
| Formatting | `±0.395` (no unit), `too low by 7.753 m`, `1040000`, `m/s^2` | `±0.395 m`, `Off by 7.75 m`, `1,040,000`, `m/s²` via `lib/displayText.ts` (`prettyExponents`, `amountText`, `groupThousands`); page quotes untouched |
| Keys | B black | W (or `,`) white screen as well; B/W swap colour, the same key again brings the picture back (`25`, `24`) |
| Ask beats | Pinned to the top, lower half empty | Question + answers centred as one block; larger choices and compare table (`15`, `16`, `23`) |

## Verification

- Test-first: `displayText.test.ts`, `equation.grouping.test.ts`, `presentation.v2.test.ts`, `explorer.predict.test.ts`
  were run red first (missing module/exports, `1200` not grouped), then green. All web lib tests: 653/653
  (`node --test apps/web/src/lib/*.test.ts`).
- `npm --prefix apps/web run build`: green. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.
- Leak check in the browser (Moon and Drag): before R no engine value, gap or margin appears anywhere in the beat (text,
  `aria-label`, SVG `<title>`); after ← from the revealed state it is hidden again. Mid-flight the right-hand numbers still
  read `?` (`06`).
- 1920×1080 and 1280×720, dark and light (`17`–`21`, `23`).

## Critique (design-judge pass, Nielsen 0–4)

| Heuristic | Before | After | Note |
|---|---|---|---|
| Visibility of status | 3 | 4 | The reveal is sequenced: scene answers first, then the numbers land |
| Match with the real world | 4 | 4 | Clicker keys, B/W screens |
| User control | 4 | 4 | ← re-hides a reveal |
| Consistency | 3 | 4 | One predict pattern (scene + class/engine column) for every numeric part; explicit props |
| Error prevention | 3 | 3 | |
| Recognition over recall | 3 | 3 | |
| Flexibility | 3 | 4 | Type the class number with no field focus; Enter hands keys back |
| Aesthetic / minimal | 2 | 3 | No half-empty predict or quiz slides; see gaps |
| Error recovery | 3 | 3 | |
| Help | 3 | 3 | W in the key list and the arrival hint |
| **Total** | **31/40** | **36/40** | |

AI-slop tells checked and absent: gradient text, glow, side-stripe borders, eyebrow labels, numbered circles, icon card
grids, emoji.

## Remaining gaps

- Formula-explorer **stage** beat is still dense (sliders with long Muse meanings + formula block): zoom stays near 1 at
  1920 (`12`). The predict beat before it carries the visual moment.
- Muse wording shown as stored: the Drag case prompt uses long variable meanings ("drag coefficient that collects shape
  and flow effects into one factor = 0.5 …"); headline "Moon throws fly ballistic…"; inconsistent compare column case
  (`energy` / `Water`). Content for the lead, not changed here.
- No demo lesson has a timeline, so the which-came-first predict beat was not re-shot (unchanged apart from exponents).
- The class number typed on the beat shows as typed (`9000`), the engine value grouped (`6,250`).
