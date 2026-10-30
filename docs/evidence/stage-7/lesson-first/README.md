# Stage 7 — lesson-first layout (slice L)

Opus 5.5 subagent, 2026-10-30. GET-only against the live API (no jobs created). Screenshots are 1920×1080 full-window
captures of the four stored demo lessons; `before/` was taken before any edit, `after/` after.

| Lesson | Job |
|---|---|
| Moon (projectile simulation) | job-20261030045435-d508f3be |
| NASA Drag (formula explorer) | job-20261030055141-b79a84e7 |
| NOAA chemosynthesis (balance equation) | job-20261030045545-d5b4e9b5 |
| NARA Constitution (sequence) | job-20261030045550-8266ebd8 |

Files: `before/<lesson>-<theme>-top.png`; `after/<lesson>-<theme>-top.png`, `after/<lesson>-<theme>-source-collapsed.png`,
`after/nara-<theme>-hover-link.png` (pointer on the second key point: the point is lit and its page sentence turns strong).

## What changed (critique point → result)

| # | Before | After |
|---|---|---|
| 1 | First interactive part started at y≈1270–1570 px (below the fold on every lesson) | Starts at y≈430–530 px (Moon 430, Drag 454, NOAA 430, NARA 526); the Moon scene, the Drag sliders + graph, the NOAA equation + atom bars and the NARA sequence are all on the first screen. The Moon predict card itself sits just below the fold (inside the engine view: scene 360 px + transport) |
| 2 | Overview card: coverage line, every point and term with a quote line and a "Show in source" button (≈1000–1250 px tall) | ≤4 short key points (≈160 px), "AI-written summary" note, key terms in a collapsed fold-out; hover/focus on a point lights its page sentence (points are focusable for keyboard users) |
| 2 | `analysis.pageCoverage` shown as the overview's first line | Not shown in the lesson; only in a "Technical details" fold of the decline card (presentation mode still shows it — not this slice's file) |
| 3 | Source panel 34 % wide, 6-line header (chips ×2 rows, cut-off select, licence, attribution, legend) | 29 % (min 300 px), 2-line header: page title with ellipsis + collapse button; one quiet line "licence · N of N quotes found · Original · Credit & key" (attribution, fingerprint, highlight key and concepts behind "Credit & key") |
| 3 | No collapse except the rail toggle (state lost on reload) | Collapse button → slim 44 px "Source page" tab with the quote count; state kept in `localStorage['mki.sourcePanel']`; "Show in source" re-opens it |
| 3 | Solid olive-brown highlight on every quote (dark) | Faint amber tint + thin underline at rest; strong amber fill only while a link is active (hover/focus on either side) |
| 4 | "Includes material from NOAA Office … (NOAA Ocean Exploration); NOAA Office … (NOAA Ocean Exploration) has not reviewed…" | "Includes material from NOAA Office … (NOAA Ocean Exploration), which has not reviewed or endorsed this lesson." |
| 5 | NOAA page: "TOPIC:" / blank / "Chemosynthesis" like a broken form | "**TOPIC:** Chemosynthesis", "**GRADE LEVEL:** 9th-12th (Chemistry)"; ALL-CAPS labels styled; runs of blank lines shown as one. Rendering only: `textContent` of the pane = 13,619 chars = stored text length |

## Tests (red → green)

New or changed tests were written first and run red:

- `lib/sourceText.layout.test.ts` (8 tests: label/value join, bullet values stay on their own line, inline labels, long
  values not joined, blank-line runs, a quote spanning a joined label keeps every character and its key, decorations
  superset, plain prose untouched) — red: `layoutDecorations` not exported.
- `lib/lessonLayout.test.ts` (4 tests: overview split, panel state persisted, blocked storage, quiet meta line) — red:
  module missing.
- `lib/sources.test.ts` (publisher named once, `shortTitle`) and `lib/provenance.test.ts` (NASA wording) — red on the
  old double-name sentence.

Green: `node --test apps/web/src/lib/*.test.ts` → 683 pass, 0 fail. `npm --prefix apps/web run build` (tsc + vite) passes.
`impeccable detect --json apps/web/src apps/web/index.html` → `[]`, exit 0.

## Checks in the browser

- Hover a key point → 1 source mark `.is-linked`; hover a source mark → the lesson element lit; keyboard focus on a key
  point → source mark lit. `document.scrollingElement.scrollHeight === innerHeight` after hover, collapse and "Show in
  source".
- Collapse → tab, `mki.sourcePanel = closed`, survives reload; a part's "Show in source" re-opens the panel and flashes
  the quote.
- `?present=<moon job>&beat=1` and `?present=<noaa job>&beat=0` render their beats (presentation mode unaffected).
- 1366×768 and 1000×800 (stacked): no document overflow, no duplicate ids, no unnamed buttons, no unlabeled inputs.
