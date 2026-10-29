# Stage 6 lesson flow on the 29 evaluation pages — Muse Spark Open (Modal) vs Muse Spark 1.3 (Meta API), 2026-10-29

Same 29 pages, same lesson pipeline, same checks and caps (analysis v2 32k, components 24k, input 72k bytes), reasoning High. Spark Open runs on the Modal Shared Endpoint (`meta-models/Muse-Spark-Open-816B-A42B`), paid from hackathon Modal credits. Driver `scripts/evaluation-run.ts --flow lesson --model muse-spark-open --concurrency 3` (first run with 3 pages at once; one early interruption, the journal recovered the 3 in-flight pages). Not a pre-registered benchmark; pre-registered v1 results (`docs/evidence/stage-5b/evaluation/`) unchanged. Spark 1.3 run: `../evaluation-lesson-1.3/`.

| | Spark 1.3 (Meta API) | Spark Open (Modal) |
|---|---|---|
| Pages with a lesson (overview + ≥1 interactive part) | **28 / 29** | **27 / 29** |
| Correct decline of the 254-char glossary stub | yes (`too-short`) | no — analysis repair could not settle (A-10 / no-weakening alternated), job **failed ANALYSIS_INVALID** |
| Other failed pages | 1 (`nij-population-genetics`, whole-job truncation = BUG-006, since fixed in `a53c1f0`) | 1 (`cfpb-teenagers-and-saving`: analysis repair fixed A-05/A-07, then A-10, never all at once) |
| Pages with some parts left out | 3 | 14 |
| Parts published / planned | 63 / 67 (94%) | 61 / 77 (79%) |
| Natural analysis repairs | 5 (all passed) | 19 attempts |
| Natural component repairs | not recorded (reporting gap fixed in `a53c1f0`) | 26 attempts, 8 passed |
| Most common part failures | concept-map grounding, timeline date rule, unused formula variable | compare-table ran out of room (4), formula explorer FE-02/FE-08 (4), concept map ran out of room (2) |
| Median time per published page | 74 s | 139 s |
| Total cost | USD 4.53 (Meta credits) | USD 6.86 (Modal credits; same per-token price, more tokens and more repairs) |
| Run wall time | ~ sequential, chunked | **27 min with 3 at once** (incl. one interruption) |

Reading: the open-weights model produces a lesson for nearly every page and the checks keep its weaker parts out (BUG-006 fix means a part that runs out of room is dropped, not the lesson). It needs more repair, leaves out more parts and is about twice as slow. Component quality was not independently rated.
