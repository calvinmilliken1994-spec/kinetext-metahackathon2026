# Stage 6 — first live lessons (2026-10-29, Muse Spark 1.3 via Meta API, purpose test-live, reasoning High)

Flow `lesson` (analysis v2 → page overview → components → checks/repair). Pages previously **declined** by the v1 flow (pre-registered evaluation) now produce a lesson.

| Page | Job | v1 evaluation result | Lesson result | Components (all passed r1) | Time | Cost (USD) |
|---|---|---|---|---|---|---|
| NARA *Constitution of the United States* | `job-20261029122338-61b5ee12` | declined (correct per expectations: fewer than 5 dates) | subject history; overview with 4 key points, 4 key terms | sequence (convention steps), quiz cards (4) | 57 s | 0.10 |
| NASA Glenn *Drag Equation* | `job-20261029122502-af74462a` | declined (no premium engine models drag) | subject physics | **formula explorer** D = Cd·(ρ·V²·A)/2, sliders Cd, ρ (kg/m³), V (m/s), A (m²), graph over V; quiz cards (4) | 55 s | 0.10 |
| NOAA *Fueling Life on Earth* educator guide (13.7k chars) | `job-20261029122556-0fff5ca7` | (new source) | **failed `OUTPUT_TRUNCATED`** — analysis spent 15,998 of 16,000 tokens reasoning | — | 50 s | 0.077 |
| same, after raising caps (545d34a: analysis 32k, components 24k) | `job-20261029123057-ea478a2a` | — | subject chemistry | quiz cards, sequence, **balance the equation** 6CO2 + 6H2O → C6H12O6 + 6O2 | ~75 s | 0.15 |

Notes:
- No repairs were needed on these runs (no natural repairs to show here).
- Observed quality issue for prompt tuning: sequence step labels on the Constitution page are copied phrases ("chief points at issue") rather than short descriptive labels.
- OV-02/OV-06 overview checks do not gate publishing yet (S6-W note); analysis v2 checks (incl. verbatim overview quotes, A-05) do.
- `results.jsonl` here covers the two evaluation-driver runs; the NOAA runs were submitted directly through the API (the source is not in the pre-registered manifest).
