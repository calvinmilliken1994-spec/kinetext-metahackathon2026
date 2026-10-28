# Stage 5b evaluation — results summary

Sample: **29 of 29** planned evaluation pages have results (report generated 2026-10-28T17:17:34.469Z). Everything below is computed only from the 29 completed jobs in `docs/evidence/stage-5b/evaluation/results.jsonl`; pages without a result are simply absent, not failures.

## Outcome classes

| Class | Count | Share of sample |
|---|---|---|
| correct-first-try | 7 | 24.1% |
| correct-after-repair | 0 | 0.0% |
| correct-decline | 9 | 31.0% |
| wrong-engine | 1 | 3.4% |
| wrong-decline | 8 | 27.6% |
| false-accept | 1 | 3.4% |
| failed | 3 | 10.3% |
| unknown | 0 | 0.0% |

Correct decisions (first try + after repair + correct decline): **16 of 29** (55.2%).

Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; _unknown_ = anything else (never counted as correct).

## By subject

| subject | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| biology | 3 | 0 | 0 | 2 | 0 | 1 | 0 | 0 | 66.7% |
| chemistry-earth | 5 | 2 | 0 | 1 | 1 | 0 | 1 | 0 | 60.0% |
| finance | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| history | 5 | 1 | 0 | 0 | 0 | 4 | 0 | 0 | 20.0% |
| physics | 14 | 2 | 0 | 6 | 0 | 3 | 0 | 3 | 57.1% |

## By difficulty

| difficulty | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| easy | 10 | 3 | 0 | 2 | 0 | 3 | 1 | 1 | 50.0% |
| hard | 10 | 2 | 0 | 4 | 0 | 3 | 0 | 1 | 60.0% |
| medium | 9 | 2 | 0 | 3 | 1 | 2 | 0 | 1 | 55.6% |

## Natural repairs

No demo faults are injected in evaluation runs, so every repair below is a natural model failure repaired by Muse.

- Repair attempts: **0** across **0** job(s).
## Cost and timing

- Published lessons: **9**
- Mean cost per published lesson: **$0.06**; max: **$0.09**
- Total cost of all 29 recorded job(s): **$0.93** (includes declines and failures)
- Mean wall time per job: **37.2 s**

## Per-page outcomes

| # | Source | Subject | Difficulty | Expected | Class | Engine | Published rev | Cost | Wall |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `nasa-grc-newtons-laws-of-motion` | physics | easy | forces-1d-v1 | correct-first-try | forces-1d-v1 | 1 | $0.05 | 44.3s |
| 2 | `nasa-grc-simplified-aircraft-motion` | physics | medium | forces-1d-v1 | correct-first-try | forces-1d-v1 | 1 | $0.03 | 34.4s |
| 3 | `nasa-grc-weight-equation` | physics | hard | forces-1d-v1 | correct-decline | — | — | $0.02 | 22.2s |
| 4 | `nasa-grc-motion-of-free-falling-object` | physics | easy | forces-1d-v1 | failed | — | — | $0.02 | 16.1s |
| 5 | `nasa-grc-range-constant-velocity` | physics | easy | projectile-v1 | correct-decline | — | — | $0.02 | 18.1s |
| 6 | `nasa-grc-effect-of-size-on-lift` | physics | medium | lift-equation-v1 | wrong-decline | — | — | $0.03 | 24.2s |
| 7 | `nasa-grc-lift-equation-of-the-1900s` | physics | hard | lift-equation-v1 | failed | — | — | $0.03 | 32.2s |
| 8 | `nasa-grc-specific-heat-cp-cv` | physics | hard | speed-of-sound-v1 | wrong-decline | — | — | $0.02 | 16.1s |
| 9 | `nasa-grc-earth-atmosphere-equation-english` | physics | hard | speed-of-sound-v1 | wrong-decline | — | — | $0.02 | 16.1s |
| 10 | `nasa-grc-role-of-the-mach-number` | physics | hard | speed-of-sound-v1 | correct-decline | — | — | $0.02 | 18.1s |
| 11 | `cfpb-teenagers-and-saving` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.06 | 70.6s |
| 12 | `cfpb-saving-post-secondary-education` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.07 | 72.5s |
| 13 | `nrc-backgrounder-radioactive-waste` | chemistry-earth | hard | half-life-v1 | correct-decline | — | — | $0.03 | 26.2s |
| 14 | `nrc-backgrounder-plutonium` | chemistry-earth | medium | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.07 | 82.6s |
| 15 | `nrc-glossary-half-life` | chemistry-earth | easy | decline | false-accept | half-life-v1 | 1 | $0.04 | 64.5s |
| 16 | `usgs-powell-geologic-time` | chemistry-earth | medium | half-life-v1 | wrong-engine | timeline-v1 | 1 | $0.09 | 102.7s |
| 17 | `usgs-fossils-numeric-time-scale` | chemistry-earth | easy | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.05 | 62.4s |
| 18 | `nij-heterozygosity` | biology | easy | hardy-weinberg-v1 | wrong-decline | — | — | $0.02 | 30.2s |
| 19 | `nij-random-mating` | biology | medium | hardy-weinberg-v1 | correct-decline | — | — | $0.01 | 18.2s |
| 20 | `nij-population-genetics` | biology | easy | hardy-weinberg-v1 | correct-decline | — | — | $0.02 | 22.2s |
| 21 | `nara-louisiana-purchase-treaty` | history | hard | timeline-v1 | wrong-decline | — | — | $0.02 | 22.1s |
| 22 | `nara-constitution` | history | medium | timeline-v1 | wrong-decline | — | — | $0.02 | 20.1s |
| 23 | `nara-lee-resolution` | history | easy | timeline-v1 | correct-first-try | timeline-v1 | 1 | $0.08 | 108.7s |
| 24 | `nara-bill-of-rights` | history | easy | timeline-v1 | wrong-decline | — | — | $0.02 | 24.2s |
| 25 | `nara-emancipation-proclamation` | history | easy | timeline-v1 | wrong-decline | — | — | $0.02 | 18.1s |
| 26 | `nasa-grc-drag-equation` | physics | medium | decline | correct-decline | — | — | $0.02 | 22.2s |
| 27 | `nasa-grc-bernoullis-equation` | physics | medium | decline | correct-decline | — | — | $0.02 | 16.1s |
| 28 | `nasa-grc-re-living-the-wright-way` | physics | medium | decline | failed | — | — | $0.03 | 38.2s |
| 29 | `nasa-grc-glider-trajectory-problem` | physics | hard | decline | correct-decline | — | — | $0.02 | 16.1s |
