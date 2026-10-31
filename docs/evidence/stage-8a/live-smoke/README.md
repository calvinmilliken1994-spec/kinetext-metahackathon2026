# Stage 8a live smoke run, 2026-10-31 (Muse Spark 1.3, prompts s6-v7)

This was the first end-to-end run of the four new engines on the library pages they were built for. Batch driver: 8 lessons, 3 at a time, API restarted on commit `9d9695d`. Total cost **USD 1.21**, with 85–210 s per lesson. Job folders are in `jobs/`, and the per-job lines are in `results.jsonl`.

| Page | Job | Muse's plan → result |
|---|---|---|
| NIST binary search | `job-20261031023020-b4783aec` | sequence ✓, quiz ✓ (no algorithm trace planned) |
| NIST bubble sort | `job-20261031023020-2c9b11c2` | sequence ✓, quiz ✓ (no algorithm trace planned) |
| USGS pH and water | `job-20261031023145-7a1de630` | quiz ✓, **log ladder ✓** first try |
| USGS earthquake magnitude | `job-20261031023020-a07a5fd2` | **log ladder ✓** first try, compare ✓, formula explorer ✗ (FE-08: the page's formula line does not parse in the calculator grammar; left out after 2 repairs) |
| NARA amendment process | `job-20261031023155-c1bc7e42` | sequence ✓, quiz ✓ (no threshold planned) |
| NARA Electoral College | `job-20261031023315-679e8e97` | sequence ✓, **threshold ✓** first try |
| NASA planetary fact sheet | `job-20261031023350-aebc18d5` | **data table ✓ after one natural repair**, sort ✓ |
| IRS 2026 tax brackets | `job-20261031023421-facdad1d` | **data table ✓** first try, quiz ✓ |

The run produced 8/8 lessons and 16 of 17 planned parts. The new engines appeared on 5 pages, and all 5 were published.

- **Natural repair (planetary sheet).** Revision 1 quoted bare table cells such as `| 9.8 |`. The shared evidence rule rejects these (DT-01: a quote needs at least 8 characters with at least 3 letters or digits), because a lone cell does not show which row or column it belongs to. The repair widened each quote to the full printed table line, e.g. `| Gravity (m/s^2) | 3.7 | 8.9 | 9.8 | 1.6 | 3.7 | 23.1 |`, which is better evidence. No fault was injected.
- **Planning gap found.** The algorithm trace was never planned. Its plan "when" row asked for "a runnable example", while its design text tells Muse to choose the small teaching input itself, and the NIST dictionary pages never print an input. The amendment page also preferred a quiz over a threshold. A prompt fix (s6-v8, Muse) followed this run.
