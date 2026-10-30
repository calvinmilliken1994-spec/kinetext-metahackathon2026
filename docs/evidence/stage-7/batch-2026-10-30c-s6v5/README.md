# Demo pages on prompts s6-v5 (teacher wording), 2026-10-30

Spark 1.3, lesson flow, 4 demo pages × 2: **8/8 lessons, 16/16 parts, 0 repairs**, 65–121 s, USD 1.08.

| Before (s6-v4) | After (s6-v5) |
|---|---|
| "Moon throws fly ballistic without drag under low gravity" | "How balls fly higher in lunar gravity without drag" / "Ballistic flight on the Moon without air drag" |
| "How air density speed shape and reference area set aerodynamic drag" | "How air density, speed and shape create drag force" |
| key point "drag depends on…" (lowercase), summary "Page covers…" | "Students learn that drag increases with air density and the square of velocity." |
| explorer slider "drag coefficient that collects shape and flow effects into one factor" | "drag coefficient", "air density", "flow velocity", "reference area" |
| compare headers "energy" / "Water" | "Energy source", "Reaction products" |

Still weak: NARA sequence step labels remain copied fragments ("Through discussion and debate", "Among the chief points at issue"). Cause: the frozen validator rule SEQ labels-in-quotes requires every label to occur in its own quote, which outranks the new prompt sentence; the prompt sentence "never a copied fragment" now contradicts that rule and should be reworded.

Demo jobs on s6-v5: Moon `job-20261030104333-c7083fa8` (quiz stem "Compared with Earth, how high does the same throw rise on the Moon?"), Drag explorer `job-20261030104212-d509087a`, NOAA `job-20261030104438-2b9cc4b8`, NARA `job-20261030104322-609ad85d`.
