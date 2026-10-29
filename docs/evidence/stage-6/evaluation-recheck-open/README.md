# Re-check of the pages that failed in the s6-v3 re-runs, after the fix wave `b758973` (2026-10-30)

Single-page runs (`--only`), same pages, same prompts (s6-v3), validators after the Stage 6 review fixes (numbers compared by value: "828,000" = 828000, "$23,000" = 23000).

| Page | Model | s6-v3 run | After fix wave |
|---|---|---|---|
| `cfpb-teenagers-and-saving` | Spark 1.3 (`../evaluation-recheck-1.3/`) | failed ANALYSIS_INVALID (A-10 false rejection) | **lesson, 2/2 parts**, 87 s, USD 0.13 |
| `cfpb-teenagers-and-saving` | Spark Open | failed ANALYSIS_INVALID (A-10 false rejection) | **lesson, 1/2 parts** (one part left out), 169 s, USD 0.23 |
| `nara-louisiana-purchase-treaty` | Spark Open | failed ANALYSIS_INVALID (A-10: "828,000") | **lesson, 2/2 parts**, 97 s, USD 0.11 |
| `nrc-glossary-half-life` (254 chars) | Spark Open | failed ANALYSIS_INVALID | **correctly declined** (`too-short`), 22 s, USD 0.02 |

With these, every page in the s6-v3 runs except one model-judgement decline (`nasa-grc-re-living-the-wright-way` on Spark Open) gets a lesson or the correct decline: Spark 1.3 28/29 lessons + 1 correct decline; Spark Open 27/29 + 1 correct decline + 1 model decline. Single-page re-checks, not a new full run.
