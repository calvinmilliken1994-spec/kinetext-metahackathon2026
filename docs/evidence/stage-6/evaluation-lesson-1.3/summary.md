# Stage 5b evaluation — results summary

Sample: **29 of 29** planned evaluation pages have results (report generated 2026-10-29T13:19:55.556Z). Everything below is computed only from the 29 completed jobs in `docs/evidence/stage-5b/evaluation/results.jsonl`; pages without a result are simply absent, not failures.

## Outcome classes

| Class | Count | Share of sample |
|---|---|---|
| correct-first-try | 5 | 17.2% |
| correct-after-repair | 2 | 6.9% |
| correct-decline | 1 | 3.4% |
| wrong-engine | 1 | 3.4% |
| wrong-decline | 0 | 0.0% |
| false-accept | 0 | 0.0% |
| failed | 1 | 3.4% |
| unknown | 19 | 65.5% |

Correct decisions (first try + after repair + correct decline): **8 of 29** (27.6%).

Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; _unknown_ = anything else (never counted as correct).

## By subject

| subject | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| biology | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0.0% |
| chemistry-earth | 5 | 2 | 1 | 1 | 1 | 0 | 0 | 0 | 80.0% |
| finance | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 50.0% |
| history | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| physics | 14 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 21.4% |

## By difficulty

| difficulty | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| easy | 10 | 1 | 1 | 1 | 0 | 0 | 0 | 1 | 30.0% |
| hard | 10 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 30.0% |
| medium | 9 | 2 | 0 | 0 | 1 | 0 | 0 | 0 | 22.2% |

## Natural repairs

No demo faults are injected in evaluation runs, so every repair below is a natural model failure repaired by Muse.

- Repair attempts: **7** across **6** job(s).
- Analysis repair attempts: **5** across **5** job(s) (source-analysis stage, TASK-024b; included in the totals above).
- Checks targeted by repairs:

| Check id | Repair attempts targeting it |
|---|---|
| `A-10` | 3 |
| `timeline.date-grounded` | 2 |
| `A-05` | 1 |
| `A-07` | 1 |
| `A-09` | 1 |

- Checks that failed on revision 1 (per job, the natural trigger):

| Check id | Jobs where it failed on revision 1 |
|---|---|
| `timeline.date-grounded` | 1 |

## Lesson flow (Stage 6)

Lesson-flow jobs in this results file: **29** (the classes above still apply to every line; this section adds the Stage 6 lesson outcomes).

- Pages that got an overview: **28 of 29** (96.6%)
- Pages that got an overview plus at least one interactive component: **28 of 29** (96.6%)
- Components: **63 published**, **3 failed/skipped**, of **67 planned**
- Partial publishes (some components published, some not): **3**
- Declined pages: **1**; failed jobs (overview never published): **1**
- Decline codes: `too-short` ×1

## Cost and timing

- Published lessons: **8**
- Mean cost per published lesson: **$0.16**; max: **$0.24**
- Total cost of all 29 recorded job(s): **$4.53** (includes declines and failures)
- Mean wall time per job: **81.7 s**

## Per-page outcomes

| # | Source | Subject | Difficulty | Expected | Class | Engine | Published rev | Cost | Wall |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `nasa-grc-newtons-laws-of-motion` | physics | easy | forces-1d-v1 | correct-after-repair | forces-1d-v1 | 1 | $0.13 | 70.6s |
| 2 | `nasa-grc-simplified-aircraft-motion` | physics | medium | forces-1d-v1 | correct-first-try | forces-1d-v1 | 1 | $0.11 | 64.5s |
| 3 | `nasa-grc-weight-equation` | physics | hard | forces-1d-v1 | unknown | — | — | $0.15 | 78.6s |
| 4 | `nasa-grc-motion-of-free-falling-object` | physics | easy | forces-1d-v1 | unknown | — | — | $0.12 | 64.5s |
| 5 | `nasa-grc-range-constant-velocity` | physics | easy | projectile-v1 | unknown | — | — | $0.14 | 70.5s |
| 6 | `nasa-grc-effect-of-size-on-lift` | physics | medium | lift-equation-v1 | unknown | — | — | $0.27 | 141.1s |
| 7 | `nasa-grc-lift-equation-of-the-1900s` | physics | hard | lift-equation-v1 | unknown | — | — | $0.21 | n/a |
| 8 | `nasa-grc-specific-heat-cp-cv` | physics | hard | speed-of-sound-v1 | unknown | — | — | $0.18 | 94.8s |
| 9 | `nasa-grc-earth-atmosphere-equation-english` | physics | hard | speed-of-sound-v1 | unknown | — | — | $0.13 | 68.6s |
| 10 | `nasa-grc-role-of-the-mach-number` | physics | hard | speed-of-sound-v1 | correct-first-try | speed-of-sound-v1 | 1 | $0.18 | n/a |
| 11 | `cfpb-teenagers-and-saving` | finance | hard | compound-interest-v1 | unknown | — | — | $0.20 | 108.9s |
| 12 | `cfpb-saving-post-secondary-education` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.13 | 70.6s |
| 13 | `nrc-backgrounder-radioactive-waste` | chemistry-earth | hard | half-life-v1 | correct-after-repair | half-life-v1 | 1 | $0.19 | 104.8s |
| 14 | `nrc-backgrounder-plutonium` | chemistry-earth | medium | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.11 | 54.4s |
| 15 | `nrc-glossary-half-life` | chemistry-earth | easy | decline | correct-decline | — | — | $0.01 | 8.1s |
| 16 | `usgs-powell-geologic-time` | chemistry-earth | medium | half-life-v1 | wrong-engine | timeline-v1 | 1 | $0.19 | n/a |
| 17 | `usgs-fossils-numeric-time-scale` | chemistry-earth | easy | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.24 | 141.2s |
| 18 | `nij-heterozygosity` | biology | easy | hardy-weinberg-v1 | unknown | — | — | $0.13 | 98.8s |
| 19 | `nij-random-mating` | biology | medium | hardy-weinberg-v1 | unknown | — | — | $0.20 | n/a |
| 20 | `nij-population-genetics` | biology | easy | hardy-weinberg-v1 | failed | — | — | $0.23 | 135.2s |
| 21 | `nara-louisiana-purchase-treaty` | history | hard | timeline-v1 | unknown | — | — | $0.11 | 58.4s |
| 22 | `nara-constitution` | history | medium | timeline-v1 | unknown | — | — | $0.13 | 76.6s |
| 23 | `nara-lee-resolution` | history | easy | timeline-v1 | unknown | timeline-v1 | — | $0.21 | n/a |
| 24 | `nara-bill-of-rights` | history | easy | timeline-v1 | unknown | — | — | $0.14 | 80.6s |
| 25 | `nara-emancipation-proclamation` | history | easy | timeline-v1 | unknown | — | — | $0.13 | 70.5s |
| 26 | `nasa-grc-drag-equation` | physics | medium | decline | unknown | — | — | $0.11 | 60.4s |
| 27 | `nasa-grc-bernoullis-equation` | physics | medium | decline | unknown | — | — | $0.18 | 102.8s |
| 28 | `nasa-grc-re-living-the-wright-way` | physics | medium | decline | unknown | — | — | $0.13 | n/a |
| 29 | `nasa-grc-glider-trajectory-problem` | physics | hard | decline | unknown | — | — | $0.10 | 54.4s |
