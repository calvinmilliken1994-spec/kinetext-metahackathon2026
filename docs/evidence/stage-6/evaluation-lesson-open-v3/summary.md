# Stage 5b evaluation — results summary

Sample: **29 of 29** planned evaluation pages have results (report generated 2026-10-29T20:28:28.337Z). Everything below is computed only from the 29 completed jobs in `docs/evidence/stage-5b/evaluation/results.jsonl`; pages without a result are simply absent, not failures.

## Outcome classes

| Class | Count | Share of sample |
|---|---|---|
| correct-first-try | 3 | 10.3% |
| correct-after-repair | 4 | 13.8% |
| correct-decline | 1 | 3.4% |
| wrong-engine | 1 | 3.4% |
| wrong-decline | 0 | 0.0% |
| false-accept | 0 | 0.0% |
| failed | 3 | 10.3% |
| unknown | 17 | 58.6% |

Correct decisions (first try + after repair + correct decline): **8 of 29** (27.6%).

Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; _unknown_ = anything else (never counted as correct).

## By subject

| subject | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| biology | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0% |
| chemistry-earth | 5 | 1 | 1 | 0 | 1 | 0 | 0 | 1 | 40.0% |
| finance | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 50.0% |
| history | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 20.0% |
| physics | 14 | 1 | 2 | 1 | 0 | 0 | 0 | 0 | 28.6% |

## By difficulty

| difficulty | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| easy | 10 | 1 | 3 | 0 | 0 | 0 | 0 | 1 | 40.0% |
| hard | 10 | 1 | 0 | 0 | 0 | 0 | 0 | 2 | 10.0% |
| medium | 9 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 33.3% |

## Natural repairs

No demo faults are injected in evaluation runs, so every repair below is a natural model failure repaired by Muse.

- Repair attempts: **25** across **17** job(s).
- Analysis repair attempts: **18** across **15** job(s) (source-analysis stage, TASK-024b; included in the totals above).
- Checks targeted by repairs:

| Check id | Repair attempts targeting it |
|---|---|
| `A-10` | 10 |
| `A-05` | 7 |
| `A-07` | 7 |
| `A-04` | 3 |
| `schema.full` | 3 |
| `repair.no-weakening` | 2 |
| `A-09` | 1 |
| `behavior.tests` | 1 |
| `policy.no-publisher-attribution` | 1 |
| `timeline.date-grounded` | 1 |

- Checks that failed on revision 1 (per job, the natural trigger):

| Check id | Jobs where it failed on revision 1 |
|---|---|
| `schema.full` | 3 |
| `timeline.date-grounded` | 1 |

## Lesson flow (Stage 6)

Lesson-flow jobs in this results file: **29** (the classes above still apply to every line; this section adds the Stage 6 lesson outcomes).

- Pages that got an overview: **25 of 29** (86.2%)
- Pages that got an overview plus at least one interactive component: **25 of 29** (86.2%)
- Components: **49 published**, **2 failed/skipped**, of **51 planned**
- Partial publishes (some components published, some not): **2**
- Declined pages: **1**; failed jobs (overview never published): **3**
- Decline codes: `no-teachable-content` ×1

## Cost and timing

- Published lessons: **8**
- Mean cost per published lesson: **$0.17**; max: **$0.30**
- Total cost of all 29 recorded job(s): **$4.40** (includes declines and failures)
- Mean wall time per job: **104.5 s**

## Per-page outcomes

| # | Source | Subject | Difficulty | Expected | Class | Engine | Published rev | Cost | Wall |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `nasa-grc-newtons-laws-of-motion` | physics | easy | forces-1d-v1 | correct-after-repair | forces-1d-v1 | 1 | $0.11 | 68.5s |
| 2 | `nasa-grc-simplified-aircraft-motion` | physics | medium | forces-1d-v1 | correct-first-try | forces-1d-v1 | 1 | $0.13 | 80.6s |
| 3 | `nasa-grc-weight-equation` | physics | hard | forces-1d-v1 | unknown | — | — | $0.21 | 165.3s |
| 4 | `nasa-grc-motion-of-free-falling-object` | physics | easy | forces-1d-v1 | correct-after-repair | forces-1d-v1 | 1 | $0.13 | 80.8s |
| 5 | `nasa-grc-range-constant-velocity` | physics | easy | projectile-v1 | unknown | — | — | $0.10 | n/a |
| 6 | `nasa-grc-effect-of-size-on-lift` | physics | medium | lift-equation-v1 | unknown | — | — | $0.15 | 92.6s |
| 7 | `nasa-grc-lift-equation-of-the-1900s` | physics | hard | lift-equation-v1 | unknown | — | — | $0.21 | 143s |
| 8 | `nasa-grc-specific-heat-cp-cv` | physics | hard | speed-of-sound-v1 | unknown | — | — | $0.11 | 70.5s |
| 9 | `nasa-grc-earth-atmosphere-equation-english` | physics | hard | speed-of-sound-v1 | unknown | — | — | $0.15 | 117s |
| 10 | `nasa-grc-role-of-the-mach-number` | physics | hard | speed-of-sound-v1 | unknown | speed-of-sound-v1 | — | $0.28 | 208.1s |
| 11 | `cfpb-teenagers-and-saving` | finance | hard | compound-interest-v1 | failed | — | — | $0.12 | 96.9s |
| 12 | `cfpb-saving-post-secondary-education` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.13 | 84.9s |
| 13 | `nrc-backgrounder-radioactive-waste` | chemistry-earth | hard | half-life-v1 | unknown | half-life-v1 | — | $0.26 | 147.4s |
| 14 | `nrc-backgrounder-plutonium` | chemistry-earth | medium | half-life-v1 | wrong-engine | compound-interest-v1 | 3 | $0.23 | 159.5s |
| 15 | `nrc-glossary-half-life` | chemistry-earth | easy | decline | failed | — | — | $0.11 | 98.8s |
| 16 | `usgs-powell-geologic-time` | chemistry-earth | medium | half-life-v1 | correct-after-repair | half-life-v1 | 1 | $0.17 | 127.2s |
| 17 | `usgs-fossils-numeric-time-scale` | chemistry-earth | easy | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.13 | 84.9s |
| 18 | `nij-heterozygosity` | biology | easy | hardy-weinberg-v1 | unknown | — | — | $0.16 | 106.9s |
| 19 | `nij-random-mating` | biology | medium | hardy-weinberg-v1 | unknown | — | — | $0.10 | 66.5s |
| 20 | `nij-population-genetics` | biology | easy | hardy-weinberg-v1 | unknown | — | — | $0.10 | 64.5s |
| 21 | `nara-louisiana-purchase-treaty` | history | hard | timeline-v1 | failed | — | — | $0.09 | 64.4s |
| 22 | `nara-constitution` | history | medium | timeline-v1 | unknown | — | — | $0.19 | 116.8s |
| 23 | `nara-lee-resolution` | history | easy | timeline-v1 | correct-after-repair | timeline-v1 | 2 | $0.30 | 230.2s |
| 24 | `nara-bill-of-rights` | history | easy | timeline-v1 | unknown | — | — | $0.14 | 92.8s |
| 25 | `nara-emancipation-proclamation` | history | easy | timeline-v1 | unknown | — | — | $0.14 | 90.9s |
| 26 | `nasa-grc-drag-equation` | physics | medium | decline | unknown | — | — | $0.12 | 78.8s |
| 27 | `nasa-grc-bernoullis-equation` | physics | medium | decline | unknown | — | — | $0.15 | 90.9s |
| 28 | `nasa-grc-re-living-the-wright-way` | physics | medium | decline | correct-decline | — | — | $0.04 | 28.4s |
| 29 | `nasa-grc-glider-trajectory-problem` | physics | hard | decline | unknown | — | — | $0.12 | 68.6s |
