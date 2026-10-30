# Batch 2026-10-30: new subject pages + demo pages (prompts v10 / s6-v4)

Driver: a scratch batch script posting lesson jobs to the live API, 3 at a time; plan in `plan.json`, one line per job in `results.jsonl`, job folders in `jobs/` (private truncated text excluded). Not a pre-registered benchmark.

| Set | Jobs | Lessons with ≥1 published part | Parts published / planned | Median time | Cost |
|---|---|---|---|---|---|
| New pages, Spark 1.3 (8 pages × 3) | 24 | 24/24 | 47/47 | 85 s | USD 3.04 |
| New pages, Spark Open (8 × 1) | 8 | 6/8 | 12/14 | 117.5 s | USD 1.47 |
| Demo pages, Spark 1.3 (5 × 2) | 10 | 10/10 | 19/19 | 75 s | USD 1.21 |

Spark 1.3: every one of 34 jobs published every planned part (66/66). 12 Spark 1.3 jobs (13 repairs) and 3 Spark Open jobs needed an analysis repair, all of which passed. **Lead finding:** 12 of the 13 Spark 1.3 repairs targeted A-09 (publisher-claim check, 11 together with OV-03). The ones inspected (census, PCR, DNA sequencing, election process) are FALSE ALARMS from the analysis-side publisher token builder, which still matches single words of the attribution (incl. the page title words) — e.g. the headline "How census counts apportion House seats" was 'repaired' to "How population counts…" and "PCR copies small DNA segments" to "Copying small DNA segments". The kit-side builder was narrowed on 2026-10-30 (acronyms + full publisher name); the analysis side was kept unchanged then to preserve stored verdicts. The remaining ones are likely the same (not yet inspected one by one). Fix queued. Spark Open: `census-computing-apportionment` timed out in analysis at 120 s (Modal, charged at reservation); `nasa-grc-sine-cosine-tangent` published only the overview (sequence SEQ-03 page order; explorer FE-05 result number not in the quoted example).

Components seen: maths — sine/cosine/tangent formula explorer, functions sequence, apportionment sequence (the Census formula is an image on the page, so no explorer); civics — branches compare table, how-laws-are-made sequence + compare, election-process sequence; biology — PCR sequence, DNA sequencing sort-groups. History demo pages produced sequence + quiz (no timeline-v1 in this batch).

Demo candidates: Moon `job-20261030045435-d508f3be` / `job-20261030045700-654c4d96` (projectile + quiz); NASA Drag `job-20261030045525-4039fec5` (formula explorer + quiz); NOAA `job-20261030045545-d5b4e9b5` (balance + compare); NARA Constitution `job-20261030045550-8266ebd8` (sequence + quiz).
