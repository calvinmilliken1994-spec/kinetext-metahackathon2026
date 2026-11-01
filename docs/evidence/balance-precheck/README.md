# Balance pre-check live check (2026-11-01)

After `8d0b36d` (A-08 fails a balance-equation-v1 plan whose focus quote has no single neutral reaction), six live jobs:

| Page | Model | Plan | Result | Time | Cost |
|---|---|---|---|---|---|
| usgs-wss-ph-and-water | muse-spark-open | log-ladder + quiz | 2/2 | 141 s | $0.157 |
| usgs-wss-ph-and-water | muse-spark-open | log-ladder + quiz | 2/2 | 216 s | $0.213 |
| usgs-wss-ph-and-water | muse-spark-open | log-ladder + quiz | 1/2 (ladder failed) | 241 s | $0.234 |
| usgs-wss-ph-and-water | muse-spark-open | quiz + log-ladder + sequence | 2/3 (ladder failed) | 231 s | $0.254 |
| noaa-oceanexplorer-fueling-life-on-earth | muse-spark-1.3 | balance + compare | 2/2 | 65 s | $0.170 |
| noaa-oceanexplorer-fueling-life-on-earth | muse-spark-open | balance + compare | 2/2 | 105 s | $0.126 |

- The pre-check was not triggered: Spark Open did not plan the equation in these 4 pH runs, so a live replan was not observed. Unit tests and the stored-plan replay cover the rule.
- No regression: the photosynthesis equation still plans and balances on both models.
- New finding: both failed pH ladders tried to use the page's sentence "Water with a pH of five is ten times more acidic than water having a pH of six." Our ladder checks (LOG-04, LOG-07 N-01) only recognise numbers written as digits in quotes, so honest rungs at 5 and 6 fail; Muse's repairs then reach for other printed numbers (6.3, 14) and fail the newer label checks. This is the same path that produced the BUG-013 lesson.
