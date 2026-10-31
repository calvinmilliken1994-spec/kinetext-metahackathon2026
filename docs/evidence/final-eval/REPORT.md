# Final evaluation: results

Pre-registration: `PREREGISTRATION.md`. Raw data: `results-*.jsonl`, `jobs.csv`, `summary.json`. Charts: `charts/`.
Rates show the Wilson 95% interval in brackets.

## Overall

| Measure | Muse Spark 1.3 | Muse Spark Open |
|---|---|---|
| Jobs | 194 | 194 |
| Lesson with at least one interactive part | 97% (189/194) [94–99%] | 92% (178/194) [87–95%] |
| Same, among pages not declined | 98% (189/192) [96–99%] | 93% (178/192) [88–96%] |
| Honest declines | 1% (2/194) [0–4%] | 1% (2/194) [0–4%] |
| Failures (job failed or no part published) | 2% (3/194) [1–4%] | 7% (14/194) [4–12%] |
| Error codes | NETWORK_ERROR 1, TIMEOUT 1, ANALYSIS_INVALID 1 | TIMEOUT 11, ANALYSIS_INVALID 2 |
| Parts published / planned | 92% (348/379) [89–94%] | 91% (342/374) [88–94%] |
| Published parts per lesson | 1.794 | 1.763 |
| Parts passing first try | 80% (303/379) [76–84%] | 73% (272/374) [68–77%] |
| Natural repair (fixed / failed first try) | 59% (45/76) [48–70%] | 69% (70/102) [59–77%] |
| Analysis repairs | 22 | 86 |
| Time p50 / p90 | 75 s / 145 s | 128 s / 220 s |
| Cost total | USD 29.14 | USD 36.10 |
| Cost per lesson / per published part | USD 0.150 / 0.084 | USD 0.186 / 0.105 |
| Estimated spend on parts that failed | USD 4.21 | USD 4.44 |
| SAM 3.1 calls (cost) | 23 (USD 0.0575) | 0 (USD 0.0000) |

## Consistency (run 1 vs run 2, same page and model)

| Measure | Muse Spark 1.3 | Muse Spark Open |
|---|---|---|
| Same outcome | 97% (94/97) [91–99%] | 90% (87/97) [82–94%] |
| Same set of parts planned | 76% (74/97) [67–84%] | 57% (55/97) [47–66%] |
| Same number of parts published | 88% (85/97) [80–93%] | 76% (74/97) [67–84%] |

## By subject

| Subject | Muse Spark 1.3: lessons / parts | Muse Spark Open: lessons / parts |
|---|---|---|
| Biology | 100% (22/22) [85–100%] / 84% (37/44) [71–92%] | 95% (21/22) [78–99%] / 93% (41/44) [82–98%] |
| Chemistry | 90% (18/20) [70–97%] / 92% (33/36) [78–97%] | 85% (17/20) [64–95%] / 86% (31/36) [71–94%] |
| Civics | 100% (20/20) [84–100%] / 100% (40/40) [91–100%] | 100% (20/20) [84–100%] / 95% (38/40) [84–99%] |
| Computing & AI | 100% (20/20) [84–100%] / 98% (39/40) [87–100%] | 100% (20/20) [84–100%] / 100% (40/40) [91–100%] |
| Earth & space | 95% (21/22) [78–99%] / 88% (37/42) [75–95%] | 95% (21/22) [78–99%] / 90% (38/42) [78–96%] |
| Finance | 100% (22/22) [85–100%] / 93% (41/44) [82–98%] | 86% (19/22) [67–95%] / 86% (36/42) [72–93%] |
| History | 91% (20/22) [72–97%] / 85% (35/41) [72–93%] | 68% (15/22) [47–84%] / 92% (34/37) [79–97%] |
| Maths | 100% (20/20) [84–100%] / 90% (36/40) [77–96%] | 100% (20/20) [84–100%] / 83% (34/41) [69–91%] |
| Physics | 100% (26/26) [87–100%] / 96% (50/52) [87–99%] | 96% (25/26) [81–99%] / 96% (50/52) [87–99%] |

## Interactive parts chosen (published / planned)

| Part | Muse Spark 1.3 | Muse Spark Open |
|---|---|---|
| Quiz cards | 133/133 | 124/124 |
| Sequence | 58/58 | 81/81 |
| Compare table | 33/33 | 30/32 |
| Formula explorer | 18/29 | 18/28 |
| Data table | 22/25 | 17/22 |
| Sort | 18/18 | 23/25 |
| Timeline | 12/18 | 6/9 |
| Algorithm tracer | 8/8 | 8/9 |
| Vote threshold | 8/8 | 6/8 |
| Concept map | 6/10 | 2/4 |
| Half-life sim | 4/4 | 8/9 |
| Label the diagram | 4/11 | 0/0 |
| Compound interest sim | 6/6 | 3/5 |
| Log-scale ladder | 4/4 | 4/4 |
| Forces sim | 4/4 | 4/4 |
| Speed of sound sim | 4/4 | 2/3 |
| Balance equation | 2/2 | 2/3 |
| Hardy-Weinberg sim | 2/2 | 2/2 |
| Lift sim | 2/2 | 2/2 |

## Repairs: checks that repairs targeted

- Muse Spark 1.3: FE-08 20, LD-07 10, CM-03 10, schema.gen 10, LD-06 9, FE-05 6, DT-05 5, LD-04 5, DT-01 5, SEQ-03 4, DT-04 4, Q-06 3
- Muse Spark Open: DT-02 22, FE-08 21, schema.gen 14, ALG-02 10, DT-01 9, DT-05 9, DT-03 9, repair.no-weakening 7, FE-05 6, DT-04 5, Q-06 5, CM-03 5

## Page-paired model comparison (mean published parts over 2 runs)

97 pages: Muse Spark 1.3 ahead on 18, Spark Open ahead on 11, tied on 68.

