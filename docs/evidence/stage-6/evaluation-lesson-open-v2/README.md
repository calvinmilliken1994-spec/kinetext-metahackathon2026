# Spark Open re-run after the s6-v2 fixes (2026-10-30)

Same 29 pages, Muse Spark Open on Modal, 3 pages at once, after `a6d98bb` (prompts s6-v2: two parts by default, small compare tables, distinct concept-map labels, formula right-hand side only, compact JSON; client keeps cut-off text) and `ef2dee2` (worker tidies a leading `<name> =` in formula expressions; truncated text saved privately — `*.truncated.txt` excluded from this evidence copy). Not a pre-registered benchmark. Earlier run: `../evaluation-lesson-open/`.

| | Spark Open before (s6-v1) | Spark Open after (s6-v2) |
|---|---|---|
| Pages with a lesson | 27 / 29 | **28 / 29** |
| Glossary stub (254 chars) | failed ANALYSIS_INVALID | **correctly declined** |
| Failed pages | 2 | **0** |
| Pages missing some parts | 14 | **8** |
| Parts published / planned | 61 / 77 (79%) | **48 / 56 (86%)** |
| Parts planned per page | 3 on 23 pages | 2 on all 28 |
| Parts lost to running out of room | 6 | **0** (no truncated text saved) |
| Formula explorers published | 4 of 8 failed | **7 / 7** (the worker's `=` tidy-up never needed: the prompt fix alone worked) |
| Median time per published page | 139 s | **100 s** |
| Cost | USD 6.86 | **USD 4.95** (Modal credits) |
| Run wall time (3 at once) | 27 min (incl. interruption) | **19 min** |

Remaining part failures (8): **compare tables 0 / 5** — Spark Open writes kebab-case ids as entity names (`this-equation`, `constant-pressure-process`, `starting-at-age-14`), so names are not found on the page (CT-02), and writes the wrong number of cells (CT-03); quiz cards 2 (Q-06/N-01: options with numbers not on the page — e.g. plutonium's atomic number 94, from background knowledge); Lee Resolution timeline 1 (a repair changed a passed event's quotes; no-weakening). Every other part type published every time (sequence 11/11, formula explorer 7/7, sort 5/5, half-life 3/3, forces 2/2, compound interest 1/1, speed of sound 1/1).

Trade-off: fewer parts per page (1.7 published vs 2.1) in exchange for no failed pages, faster and cheaper runs. Driver log note: in `--concurrency` mode the driver prints its own in-flight jobs as "OUTSTANDING LIABILITY" lines while waiting (cosmetic; each page recorded once).
