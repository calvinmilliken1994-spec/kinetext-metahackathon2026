# Final evaluation — pre-registration (2026-10-31)

Calvin approved this run on 2026-10-31: "go ahead with those page runs, 2 runs on both models, all details noted for comparison graphs and stats for demo video". The Meta live-run cap was raised to USD 100 at the same time.

This file, `manifest.json` and both plan files are committed **before** the first job starts. After that they are never edited. Corrections go in a separate dated note beside them.

## What runs
- **Pages:** every active library page, 97 in total (physics 13, finance 11, history 11, biology 11, earth-science 11, maths 10, civics 10, computing 10, chemistry 10). The list and source hashes are in `manifest.json`. Retired pages are excluded.
- **Runs:** 2 per page per model, 388 jobs in all.
- **Models:**
  - Muse Spark 1.3, Meta API (`muse-spark-1.3`).
  - Muse Spark Open, Modal Shared Endpoint (`meta-models/Muse-Spark-Open-816B-A42B`).
- **Flow:** lesson. Analysis v2, then overview, then 1–3 checked kit parts, with bounded repair (at most 2 attempts per part).
- **Prompts:** s6-v10. The code is the commit that adds this file. The API is restarted on that commit before the run.
- **Order:** the plan files list run 1 for every page, then run 2. The two models run at the same time, 3 jobs each (`maxConcurrentJobs` 6).
- **Label the diagram:** only Muse Spark 1.3 jobs on the 8 pages with a library figure get the figure list (SAM 3.1). Spark Open jobs get no figures, by design.
- **Budget:** Meta cap USD 100 (USD 22.3 committed before the run; estimated cost ≈ USD 30). Modal cap USD 80 (USD 18.2 committed; estimated ≈ USD 30).

## What is recorded per job
Stored run directory (`storage/runs/<jobId>`), plus one line per job in `results-<model>.jsonl` written by the driver. From the run directories, after the run:
- Job status, wall time (createdAt → finishedAt), total cost, any reserved-unknown cost.
- Analysis outcome: usable, declined, or failed. Analysis repairs and the checks they targeted.
- The component plan (ids), and each part's status (passed or failed), revision count, failing check ids and plain reason.
- Component repairs: attempt, targeted checks, fixed, passed. A **natural repair** is one that published after starting from a failing revision 1 with no injected fault (none are injected in this run).
- Per-stage latency and token usage from `events.jsonl`. SAM calls, images and cost.

## Measures (defined before seeing results)
1. **Lesson with ≥1 interactive part:** the share of jobs whose lesson published at least one kit part beyond the overview, per model and per subject.
2. **Parts:** published ÷ planned parts, per model and subject, with published parts per page shown alongside. Each model writes its own plan, so totals are planned counts and are never called "publishable".
3. **Honest declines** (analysis marks the page unusable for activities) are counted separately from **failures** (a job or part error, or failed checks).
4. **Repairs:** the natural repair rate (parts fixed by repair ÷ parts that failed revision 1), and the checks those repairs targeted.
5. **Consistency:** whether run 1 and run 2 of the same page and model agree on lesson status, the component plan, and the number of parts published.
6. **Time:** wall time p50/p90 per model. **Cost:** per job, per published part, and spend on failed parts.
7. **Engine use:** how often each component id is planned and published (incl. the four Stage 8a engines and Label the diagram).
8. **Model comparison:** Muse Spark 1.3 vs Spark Open on all of the above, page-paired.

Error bars: a Wilson 95% interval for every rate. Reported per subject and overall. Nothing is dropped. A job that crashes counts as a failure, with its cause.

## Not claimed
This is not the Stage 5b benchmark (`docs/evidence/stage-5b/evaluation/` stays unchanged). The library pages were curated by the project, so the results describe this library, not arbitrary web pages.
