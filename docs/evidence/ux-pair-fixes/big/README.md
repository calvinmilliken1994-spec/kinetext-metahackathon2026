# UX pair fixes: big screens (2026-11-01)

Slice of the fixes agreed in `docs/reviews/ux-pair-review-2026-11-01.md` (issues #1, #2, the Drag part of #5 and the Opus extras for the Drag predict slide, the balance surplus and fold, and the "In short" slide). Built by Claude Opus 5.5. Checked against the read-only API (GET only) on Vite :5173, at 2560×1440 and 1920×1080 first, with a 1366×768 spot check.

## What changed

| # | Change | Files |
|---|---|---|
| 1 | Slides fill the stage. StageFit's zoom cap is 2.6 (was 1.9). The quote band under a slide is now as tall as the longest quote that beat can show (every candidate is laid out hidden in one stacked cell, once per beat; the quote on show sits over it, absolutely positioned), and beats that cite nothing (title, goals, sources) keep no band. Frame padding trimmed to a 6% title-safe top and 80 px for the bar. Engine design widths re-chosen from a natural-height sweep so each part's shape matches the ~2.4 : 1 stage (label diagram 1040, binary search 1040, log ladder 1140, threshold 920). `settleZoom` (0.5% dead band) and every concealment rule are unchanged. | `components/presentation/Beats.tsx`, `PresentationMode.tsx` (zone markup only), `styles/present.css`, `styles/engines-a.css` |
| 1b | pH slide: the question column is set at heading size (case, question, rule and the answer), so the right half is no longer an empty column with lesson-size type. | `styles/engines-a.css` (stage-mode rules only) |
| 2 | QHD lesson: at ≥ 2200 px wide the window's font-size tokens step up one size (12/14/16/20/26 → 13/15/18/22/30) and the lesson column grows from 1040 to 1320 px. One media rule in `shell.css`, scoped to `.app-window` so presentation mode keeps its own scale. 1920 is unchanged. Prose blocks keep their `ch` caps (key points 78ch). | `styles/shell.css` |
| 3 | Drag lesson: the formula heads the slider column, and "Predict, then reveal" sits right under the graph (value table after it). First prediction input at y 828 at 1920 (was 1261, below the fold). Drag predict slide: a wider graph (600×260 drawn at 900 px design width, labels 1.5×) fills the scene column, so the cards sit beside the graph, and the worked formula line is set at heading size with its height reserved (the `?` chip and the revealed number no longer differ by 1 px). | `components/FormulaExplorerView.tsx`, `Beats.tsx`, `styles/present.css` |
| 4 | Balance: "Check my balance" at y 849 at 1920 (was 973, on the fold): rows tightened (131 → 113 px) and the "Show the counts as a table" toggle moved under the buttons. The surplus is a neutral hatch with a dark outline (`--chem-excess`, `--chem-excess-line` in both themes); red stays for failed checks only. | `components/BalanceView.tsx`, `styles/chem.css` |
| 5 | "In short": the heading top-aligns with the first point (`.pz-split` `align-items: start`, block still centred). Heading top 217 = first point top 217 at 1920. | `styles/present.css` |

## R moves nothing, the zoom is steady

Hook slide of each lesson, deep link `?present=<job>` (opens on the hook beat 2). Per row: 60 requestAnimationFrame samples of every `.pz-fit-zoom` before R and again after R (`Page.bringToFront` first), then a bounding-box diff of every element in `.pz-beat` plus `.pz-zone` and `.pz-credit` across R (matched by tag/class sequence). "Zoom before" is the same slide measured before these changes.

| Lesson | Size | Theme | Zoom before | Zoom after | Zoom values / 60 rAF (before R · after R) | Elements moved by R (Δy or Δh > 0.5 px) | Quote band top · height (before R = after R) |
|---|---|---|---|---|---|---|---|
| DNA | 2560x1440 | dark | 1.84685 | 2.14135 | 1 · 1 | 0 | 1239 · 114 |
| DNA | 1920x1080 | dark | 1.38288 | 1.57883 | 1 · 1 | 0 | 914 · 86 |
| Binary search | 2560x1440 | dark | 1.8552 | 2.14135 | 1 · 1 | 1: `SPAN.at-option-mark` (the step's mark) appears inside its option (0 → 34.3 px tall), nothing else moves | 1239 · 114 |
| Binary search | 1920x1080 | dark | 1.38914 | 1.58597 | 1 · 1 | 1: `SPAN.at-option-mark` (the step's mark) appears inside its option (0 → 25.4 px tall), nothing else moves | 914 · 86 |
| pH | 2560x1440 | dark | 1.70124 | 1.95351 | 1 · 1 | 0 | 1239 · 114 |
| pH | 1920x1080 | dark | 1.27386 | 1.45436 | 1 · 1 | 0 | 914 · 86 |
| Electoral College | 2560x1440 | dark | 1.9 | 2.42065 | 1 · 1 | 0 | 1239 · 114 |
| Electoral College | 1920x1080 | dark | 1.76437 | 1.81522 | 1 · 1 | 0 | 914 · 86 |
| Water cycle | 2560x1440 | dark | 1.84685 | 2.14135 | 1 · 1 | 0 | 1239 · 114 |
| Water cycle | 1920x1080 | dark | 1.38288 | 1.57883 | 1 · 1 | 0 | 914 · 86 |
| Drag (predict) | 2560x1440 | dark | 1.4347 | 1.86 | 1 · 1 | 0 | 1239 · 114 |
| Drag (predict) | 1920x1080 | dark | 1.07407 | 1.36617 | 1 · 1 | 0 | 914 · 86 |
| DNA | 1366x768 | dark | — | 1.06306 | 1 · 1 | 0 | 626 · 62 |
| Binary search | 1366x768 | dark | — | 1.06787 | 1 · 1 | 1: `SPAN.at-option-mark` (the step's mark) appears inside its option (0 → 17.1 px tall), nothing else moves | 626 · 62 |
| pH | 1366x768 | dark | — | 0.979253 | 1 · 1 | 0 | 626 · 62 |
| Electoral College | 1366x768 | dark | — | 1.29239 | 1 · 1 | 0 | 626 · 62 |
| Drag (predict) | 1366x768 | dark | — | 0.914347 | 1 · 1 | 0 | 626 · 62 |
| Water cycle | 1366x768 | dark | — | 1.06306 | 1 · 1 | 0 | 626 · 62 |
| DNA | 1920x1080 | light | — | 1.57883 | 1 · 1 | 0 | 914 · 86 |
| Drag (predict) | 1920x1080 | light | 1.07407 | 1.36617 | 1 · 1 | 0 | 914 · 86 |

Notes:
- Zoom gains on the hero slides: +14–16% (DNA, water cycle, binary) at both target sizes, +27% (vote, capped at 1.9 before) at 2560, +27–30% (Drag predict) and +15% (pH). Hover on an "In short" point fills the band and moves nothing (index-matched tops identical); → steps keep their final positions (the points' 0.3em rise is the existing entry animation).
- R → ← on the Drag predict slide: nothing moves, the answer is hidden again, the band empties.
- 1366×768: every hook slide fits without scrolling (`.pz-fit` scrollHeight = clientHeight, `--pz-fit` 1); the contained Drag scene is at 0.91.

## Lesson view

| Check | Before | After |
|---|---|---|
| Balance: "Check my balance" top at 1920 | 973 (bottom 1008, on the fold) | 849 (bottom 885) |
| Drag: first "Your prediction" input at 1920 | 1261 | 828 |
| QHD lesson column / title / key point size | 1040 px / 26 px / 16 px | 1320 px / 30 px / 18 px |
| 1920 and 1366 lesson column | 1040 / 783 px | unchanged |
| Document overflow (window floats) at 2560, 1920, 1366 | 0 | 0 |

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 990 pass, 0 fail. `npx tsc -p apps/web --noEmit`: clean.
- `npm --prefix apps/web run build`: built (only the existing >500 kB chunk warning).
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]` (0 findings).

## Known limits

- The quote band is sized per beat, so its top edge sits a line higher or lower from one beat to the next (it never moves within a beat, on R, hover or ←). This trades the old "same band height on every beat" for 1–2 more lines of slide.
- A quote outside the beat's own `quotes` list (none found on these lessons) would be clipped by the band rather than move the slide.
- The dev-only `?engine-demo=a` harness (`EngineDemoA.tsx`, not owned here) still renders the old flat zone markup without the sizer.
- pH: R shows no page sentence in the band on this lesson (the engine's reveal quote is empty for this step); unchanged by this slice.

## Files

`before-*.jpg` are the pre-change frames (half scale). `after-*.jpg` are 1920 wide (QHD frames downscaled), JPEG quality 70.
