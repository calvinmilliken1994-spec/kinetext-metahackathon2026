# Live check: does Muse follow the opening-case rule (prompt v10)? (2026-10-30)

Same teacher-provided page as the original bug ("Throwing a ball on the Moon", `user-accf5f60ebed`, project-authored). Before (prompt v9, `job-20261027181336-572d603f`): sliders opened at **g = 9.8** under the label "Moon surface with no air" while the first prediction used 1.62.

| Job | Model / flow | Scenario label | Slider defaults (U0, V0, g) | First prediction | `semantic.opening-case` | Revisions | Cost |
|---|---|---|---|---|---|---|---|
| `job-20261030031842-6dafdf06` | Spark 1.3 · single activity | Airless Moon surface | 12, 8, **1.62** | `moon-opening`: 12, 8, 1.62 → 19.7531 m | pass | 1 | USD 0.0581 (Meta) |
| `job-20261030031842-3b2790f3` | Spark 1.3 · lesson (premium projectile + quiz) | Level field on the Moon | 10, 8, **1.62** | `moon-opening`: 10, 8, 1.62 → 19.7531 m | pass | 1 | USD 0.1113 (Meta) |
| `job-20261030031842-18da8429` | Spark Open (Modal) · single activity | Airless surface of the Moon | 10, 8, **1.62** | `pred-opening`: 10, 8, 1.62 → 19.7531 m | pass | 1 | USD 0.0598 (Modal) |

3/3 open on the Moon, pass 15/15 checks on the first revision (no repair needed), and each also includes the page's Earth value (9.8) in a later prediction, so the app's page-value chips and comparison arc appear. Three runs on one page: evidence that the rule is followed, not a rate.
