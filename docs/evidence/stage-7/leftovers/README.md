# Stage 7e slice W — leftovers, featured/retired library, part-failure wording (evidence)

All frames 1920×1080 from the local web app (Vite) against the live API, GET only. No job was started.

| File | What it shows |
|---|---|
| `A-picker-featured-physics-dark.png` | New lesson picker: physics lists the 5 featured pages, then "Show all physics (13)". The select is drawn as a list box (a `size` attribute set for the capture only). |
| `A-picker-show-all-physics-dark.png` | The same picker after "Show all physics": featured pages first, then the rest A–Z. |
| `A-runs-retired-page-dark.png` | Runs of a retired page (Lift Equation of the 1900's) keep the page's title and say "Retired page". |
| `B-before-*` / `B-after-moon-lesson-{dark,light}.png` | Moon lesson first screen. Before: the predict card starts about 100 px below the fold. After: the card sits beside the scene, with the question, input and Run it on the first screen. |
| `B-after-moon-objectives-light.png`, `B-after-moon-sliders-light.png` | The objective reads `ymax = V₀² / (2 · g)`. The sliders read "Initial horizontal speed U₀" and "Initial vertical speed V₀". |
| `B-before/after-present-overview-moon.png` | Presentation overview. Before: Muse's internal page-coverage note was the lead. After: the lesson headline is the lead. |
| `B-before/after-present-compare-civics.png` | Compare beat. Headers and options are now in sentence case ("President"). The table no longer clips mid-row. |
| `B-after-present-quiz-moon.png` | Quiz beat options in sentence case, with U₀ typeset. |
| `C-before-failure-card-dark-reproduced.png` | The part-failure card as it used to render: raw check ids and validator text under "Details for the teacher". This frame was reproduced by re-inserting the old markup into the page, because the fix had already been applied. |
| `C-after-failure-card-dark.png`, `C-after-failure-card-technical-open-dark.png` | After: one plain sentence for the teacher. The check ids and validator text appear only under "Technical details", which is closed by default. |
| `sweep/`, `sweep-present/` | Sweep frames (4 demo lessons, partial, declined, civics, biology, maths; dark and light; presentation beats). They were captured before the sweep fixes, so they show the roughness that was then fixed. |

The live API had not been restarted with the new `/api/sources` code. The picker and runs frames were therefore served the answer of the NEW server code: it ran on an ephemeral loopback port with live generation off, and the browser read its `GET /api/sources?include=retired` output through a fetch shim.
