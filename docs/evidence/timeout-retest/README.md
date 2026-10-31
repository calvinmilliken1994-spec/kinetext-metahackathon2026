# Spark Open timeout retest (2026-10-31)

This is a targeted re-run of the 9 library pages whose Muse Spark Open jobs hit TIMEOUT in the pre-registered final evaluation (11 jobs). Each page ran twice on Muse Spark Open, 18 jobs in all, after `22c2982` (a timeout keeps passed parts) and `ba79bdc` (a dropped connection keeps passed parts; Modal per-call limit 120 s → 180 s).

It is **not** part of the pre-registered evaluation. The final-eval results are unchanged.

| | Final evaluation (same 9 pages, 18 jobs) | Retest (18 jobs) |
|---|---|---|
| Jobs that delivered a lesson | 7 | **18** |
| Jobs ended by TIMEOUT | 11 | **0** |
| Parts delivered | 14 | 30 of 37 planned |
| Median job time | 170 s | 135 s |
| Longest job | 296 s | 271 s |
| Cost | $4.72 | $4.14 |

**Honest reading:**
- No call in the retest ran past 120 s. The slowest was 113.9 s, and 4 calls took over 100 s. So neither the 180 s limit nor timeout partial publishing was triggered by a real slow call here; both are covered by unit tests (`workers/generation/lesson.timeout-partial.test.ts`).
- The retest shows these pages are not inherently failing. The evaluation timeouts were tail latency on the shared Modal endpoint.
- Median call latency was similar: 36.4 s against 39.5 s for completed calls in the evaluation.

**The 7 parts that did not publish** (each lesson still kept its other parts):
- 3 ran out of output room (formula explorer on BLS CPI ×2, timeline on Apollo 11).
- 3 timelines had a date not grounded in a quote.
- 1 concept map had a relation check fail.

| page | run | job | parts | time s | cost USD |
|---|---|---|---|---|---|
| bls-cpi-escalation | 1 | `job-20261031152738-573474f3` | 1/2 | 271 | 0.323 |
| bls-cpi-escalation | 2 | `job-20261031152738-96fad246` | 1/2 | 236 | 0.313 |
| cfpb-saving-post-secondary-education | 1 | `job-20261031152738-71ed9022` | 2/2 | 140 | 0.204 |
| cfpb-saving-post-secondary-education | 2 | `job-20261031152958-aa411e2f` | 2/2 | 125 | 0.149 |
| dos-alaska-purchase | 1 | `job-20261031153133-33ff0d08` | 2/2 | 130 | 0.209 |
| dos-alaska-purchase | 2 | `job-20261031153203-57738128` | 2/2 | 115 | 0.169 |
| investorgov-what-is-compound-interest | 1 | `job-20261031153208-8c188ec0` | 2/2 | 130 | 0.205 |
| investorgov-what-is-compound-interest | 2 | `job-20261031153343-38bae64d` | 2/2 | 115 | 0.193 |
| medlineplus-what-is-dna | 1 | `job-20261031153359-27512e73` | 1/2 | 225 | 0.315 |
| medlineplus-what-is-dna | 2 | `job-20261031153418-def1b10a` | 2/2 | 95 | 0.140 |
| nara-declaration-of-independence | 1 | `job-20261031153539-5fc0fbd1` | 2/2 | 155 | 0.211 |
| nara-declaration-of-independence | 2 | `job-20261031153554-ff0c40bf` | 2/2 | 130 | 0.191 |
| nara-lee-resolution | 1 | `job-20261031153744-60091275` | 1/2 | 230 | 0.320 |
| nara-lee-resolution | 2 | `job-20261031153804-539302d0` | 1/2 | 215 | 0.321 |
| nasa-apollo-11-mission-overview | 1 | `job-20261031153814-216c66c1` | 1/2 | 195 | 0.281 |
| nasa-apollo-11-mission-overview | 2 | `job-20261031154129-67bdf09c` | 1/2 | 215 | 0.297 |
| nrc-backgrounder-radioactive-waste | 1 | `job-20261031154134-a8ebbe41` | 2/2 | 75 | 0.117 |
| nrc-backgrounder-radioactive-waste | 2 | `job-20261031154139-c6facfdb` | 3/3 | 125 | 0.188 |
