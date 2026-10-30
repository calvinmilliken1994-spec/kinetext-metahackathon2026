# Stage 7 — slice F: small fixes in the interactive views

Screenshots at 1920×1080, GET-only against the stored demo lessons (Moon `job-20261030045435-d508f3be`, NASA Drag
`job-20261030055141-b79a84e7`, NOAA `job-20261030045545-d5b4e9b5`, NARA Constitution `job-20261030045550-8266ebd8`).
`before-*` were taken before any change; `after-*` in dark and light; `present-*` are presentation-mode beats
(`?present=<job>&beat=N`).

| Fix | Before | After |
|---|---|---|
| Drag explorer: the formula is typeset from the parsed expression (validator parser) with the page symbols — D = C<sub>d</sub> · ρ · V² · A over 2; the page's line stays underneath as a quiet quote ("As the page writes it"). The live equation, slider symbols and value table use the same symbols; slider labels are short ("drag coefficient (C<sub>d</sub>)") with the full meaning as tooltip + `aria-describedby`; the "Now" row sits in order in the value table; the case prompt uses the short labels. | `before-drag-explorer-dark.png` | `after-drag-explorer-{dark,light}.png`, `present-drag-{predict,formula}-dark.png`, `present-drag-formula-light.png` |
| Hidden answers: one treatment for every engine — the label's words stay and a dashed "?" chip replaces the number and unit ("max height [?]" instead of "max height ? m"); the same chip in readouts, live equations and value tables. | `before-moon-scene-dark.png` | `after-moon-scene-{dark,light}.png`, `present-moon-{predict,simulation}-dark.png` |
| Sequence board: the AI-written order note is joined as its own sentence (full stop added); step labels in sentence case; Up/Down are quiet icon buttons (named "Move “…” up/down", keyboard-operable, focus kept on the moved card). | `before-nara-sequence-dark.png` | `after-nara-sequence-{dark,light}.png`, `present-nara-sequence-dark.png` |
| Compare table and quiz options: sentence case for AI-written headers and options ("energy" → "Energy"). | `before-noaa-compare-dark.png` | `after-noaa-compare-{dark,light}.png` |

Checks: `node --test apps/web/src/lib/*.test.ts` 683/683; `npm --prefix apps/web run build` ok; impeccable detect `[]`;
no document scroll; no unnamed buttons, duplicate ids or untitled `svg[role=img]` on the lesson pages; the Drag predict
beat's text, labels and titles do not contain the answer (750) before R.
