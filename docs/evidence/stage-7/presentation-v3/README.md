# Presentation mode pass 3 — Calvin's design feedback

Date: 2026-10-31. Author: Opus 5.5 web child (presentation slice). Live API (GET only) and Vite on localhost; no jobs were
created. Frames are full-window captures at 1920×1080 unless the name says 1366.

Feedback (verbatim): key-term slides lack capitals; the hover "tooltip" on quiz slides repeats the words being hovered;
multiple-choice options move up when the answer is revealed; quote hovers need one dedicated, anchored, centred zone under
the slide, as consistent as possible.

## What changed

| Issue | Fix | Where |
| --- | --- | --- |
| Lower-case terms and meanings | One display helper, `aiLabel` = `aiText` + `capitalFirst`, used for every AI-written line a slide shows (terms, meanings, points, objectives, stems, options, compare cells/headers, prompts, pair events, beat titles in the bar/notes/screen-reader line). `capitalFirst` now also keeps subscripted symbols (`ymax`, `vmin`) and `rpm`. Page quotes stay verbatim. Shared lesson views: compare cells, sort labels and the formula graph's x-axis title are capitalised too. Concept-map node labels are left as they are (they are read mid-sentence: "drag increases with density"). | `lib/displayText.ts`, `lib/presentation.ts` (`shownTerms`, `shownPoints`, beat titles), `Beats.tsx`, `CompareView.tsx`, `SortView.tsx`, `FormulaGraph.tsx` |
| Hover strip echoed the hovered words; flipped top/bottom | Removed the floating strip and its pointer-avoiding flip. ONE quote zone (`.pz-zone`) sits centred under the slide on every beat, with its height reserved in the layout (`--pz-zone-h`), so a quote appearing or going never moves or covers anything. Hover, "Show in source" (pinned) and R (a quiz card's quote, the hidden compare cell's quote) all land there: `zoneQuote` picks hovered → pinned → revealed. A quote already printed in the slide's body (the which-came-first pair's two quotes, the closing list) is never echoed (`visibleQuotes`). Long quotes step their size down (`zoneQuoteSize`) to fit the same band. | `PresentationMode.tsx`, `lib/presentation.ts`, `present.css` |
| Options moved on R | Nothing is inserted on R any more: every option's possible marks are laid out in one stacked cell from the start (only the current one visible); the vote hint and the grade share one cell (`AskFoot`); the pair's dates/quotes are laid out hidden; the hidden compare cell holds its value invisibly under the "?"; term meanings are laid out hidden under "What does it mean?"; the projectile ask frame reserves the equation line the revealed scene shows. Compare options (narrow, side by side) put their mark on a reserved line under the text. | `Beats.tsx`, `present.css`, `ProjectileView.tsx`, `sim.css` |
| Tall slides vs the reserved band | A slide whose content is taller than its area is set smaller as a whole (`--pz-fit`, searched once per beat, never per step, so a reveal never rescales it). Stage parts may shrink to 85% before scrolling; once the class uses a part, its own growth (a sequence after "Check order") no longer rescales it. | `PresentationMode.tsx`, `Beats.tsx` (`StageFit`) |

## Tests (red → green)

- `lib/displayText.aiLabel.test.ts` (4 tests) and `lib/presentation.v3.test.ts` (10 tests) were written first and failed
  (missing exports; the Moon predict title carried `m/s^2`). Now `node --test apps/web/src/lib/*.test.ts`: 728/728 pass
  (714 before this pass + 14 new).
- The rule "never show the zone text equal to a quote printed on the slide" is tested over every combination of hovered,
  pinned, revealed and printed quotes, including whitespace variants.
- `npm --prefix apps/web run build` (tsc + vite) passes. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`, exit 0.

## Reveal measurements (Δ of every option / question / table / slot / zone box, before vs 2–4.5 s after R)

Before (1920×1080 dark, old code): Moon quiz Q1 **Δy 43.3 px**, Drag quiz Q1 **23.4 px**, NARA quiz Q1 **23.4 px**
(question and every option moved up as the page quote was inserted and the hint removed). Predict slots Δy 0. The NOAA
compare beat has no hidden cell (no reveal). Compare-with-a-hidden-cell and which-came-first were not measured before.

After: **32 measurements, all Δy = 0 px and Δh = 0 px** — 8 beats × {1920×1080, 1366×768} × {dark, light}
(`reveal-shift-after.json`):

| Beat | Run | Options | max Δy | max Δh |
| --- | --- | --- | --- | --- |
| Quiz Q1 | Moon job-20261030104333-c7083fa8 | 3 | 0 | 0 |
| Predict (projectile, incl. scene zoom box) | Moon | — | 0 | 0 |
| Quiz Q1 | Drag job-20261030104212-d509087a | 3 | 0 | 0 |
| Predict (formula graph) | Drag | — | 0 | 0 |
| Quiz Q1 | NARA job-20261030104322-609ad85d | 4 | 0 | 0 |
| Compare (no hidden cell) | NOAA job-20261030104438-2b9cc4b8 | — | 0 | 0 |
| Compare, hidden cell (table cells too) | job-20261030055141-467490d5 | 3 | 0 | 0 |
| Which came first (pair) | job-20261029202321-a8b6bdbf | 2 | 0 | 0 |

Found and fixed during the pass: R on the Moon predict beat rescaled the whole scene (the revealed scene adds its equation
line; zoom box Δh 24 px, Δw 107 px) — the ask frame now reserves that line. Key terms: → / R showing meanings moved the
terms below; now Δ 0 (`terms-and-leak-checks.json`).

Sequence (NARA, stage beat, "Check order"): before, the whole part rescaled (zoom 1.46 → 1.0, steps Δy up to 181 px).
Now the zoom stays (1.46 → 1.46) and the first steps keep their place; the view's own per-step answers (verdict, date,
quote) still push later steps down by the inserted height (175–460 px), and the stage scrolls. See remaining issues.

## Quote zone checks

- Same box on every beat kind at 1920×1080: x 125, y 846, 1670 × 150 for title, overview, terms, predict, stage, quiz,
  compare, closing (`zone-checks.json`).
- Quiz after R, hovering the zone's quote: one copy on screen, no strip. Pair after R, hovering a printed event quote: the
  zone stays empty (no echo), the quote lights up in place.
- Hover sweep: 112 hovers over every linked element of every beat of the four demo runs and the compare run at both sizes;
  0 quotes overflow the band (longest real quote 141 chars, 2 lines). Synthetic 230/360/560/900-char quotes fit at both
  sizes (`zone-longer-quote-1366-synthetic.png`, DOM text swapped for one measurement, then reloaded).
- Leak checks before R (innerText + aria-labels): no answer mark, no hidden cell value, no pair dates, no quiz quote.

## Capitalisation audit (every beat, revealed, DOM text that starts with a lower-case word)

Before (`cap-audit-before.json`): Moon terms (`drag`, `ballistic`, `horizontal speed`, `gravity`, meaning `highest
position…`), Drag terms (4), NARA terms (`quorum`, `central government`), NOAA compare cells (4), the explorer graph's
axis title `flow velocity (m/s)`. After (`cap-audit-after.json`, plus a timeline run and a sort run): only the closing
slide's source URLs, which stay as they are. `ymax` stays a symbol.

## Frames

before/after pairs: `before-moon-terms.png` → `after-moon-terms-{dark,light}.png`; `before-moon-quiz-hover-echo.png` →
`after-moon-quiz-hover-no-echo.png`; `before-moon-overview-hover.png` (strip bottom-left) → `after-moon-overview-hover.png`
(zone centred under the slide); `before-{moon,drag,nara}-quiz-{ask,revealed}.png` → `after-moon-quiz-{ask,revealed}-{dark,light}.png`,
`after-nara-quiz-revealed.png`; `before-noaa-compare-revealed.png` → `after-noaa-compare.png`; compare with a hidden cell
`after-compare-ask.png` / `after-compare-revealed-{1920,1366}.png`; pair `after-pair-{ask,revealed}.png`; predict
`after-moon-predict-{ask,revealed}.png`; sequence `after-nara-sequence{,-checked}.png`; 1366 spot checks
`after-*-1366.png`.

## Remaining issues

- Sequence "Check order" inserts each step's answer under it, so later steps move down (the zoom no longer jumps). Zero
  movement there needs a presentation variant of `SequenceView` that reserves each step's answer space; not done here.
- The reserved band takes ~150 px at 1920×1080. Dense stage parts (the drag formula explorer) now fit at 92% instead of
  scrolling; at 1366×768 the explorer sits at the 85% floor and its last row scrolls.
- The `longest` zone size (quotes over 560 chars, none in the demo runs) is small on a 1366×768 projector (10.5 px) and is
  clamped to five lines.
- Reserving space means hidden answers now exist in the DOM before R (visibility: hidden + aria-hidden: the compare cell's
  value, the pair's dates and quotes, term meanings). They are not in `innerText`, the accessibility tree or on screen, but
  a DOM inspector would show them.
