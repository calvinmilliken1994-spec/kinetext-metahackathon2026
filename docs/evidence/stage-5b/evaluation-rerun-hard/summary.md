# Stage 5b evaluation — results summary

Sample: **12 of 29** planned evaluation pages have results (report generated 2026-10-28T18:33:07.865Z). Everything below is computed only from the 12 completed jobs in `docs/evidence/stage-5b/evaluation/results.jsonl`; pages without a result are simply absent, not failures.

## Outcome classes

| Class | Count | Share of sample |
|---|---|---|
| correct-first-try | 4 | 33.3% |
| correct-after-repair | 1 | 8.3% |
| correct-decline | 3 | 25.0% |
| wrong-engine | 0 | 0.0% |
| wrong-decline | 3 | 25.0% |
| false-accept | 1 | 8.3% |
| failed | 0 | 0.0% |
| unknown | 0 | 0.0% |

Correct decisions (first try + after repair + correct decline): **8 of 12** (66.7%).

Class meanings: _correct-first-try_ = published revision 1 with the expected or an acceptable engine; _correct-after-repair_ = published a later revision after natural (non-injected) repairs; _correct-decline_ = honestly declined when decline was expected or acceptable; _wrong-engine_ = published an engine outside expected/acceptable; _wrong-decline_ = declined a supported page; _false-accept_ = published a page that should have been declined; _failed_ = job ended with an error code; _unknown_ = anything else (never counted as correct).

## By subject

| subject | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| chemistry-earth | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| finance | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| history | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0.0% |
| physics | 8 | 1 | 1 | 3 | 0 | 2 | 1 | 0 | 62.5% |

## By difficulty

| difficulty | n | correct first try | correct after repair | correct decline | wrong engine | wrong decline | false accept | failed | accuracy |
|---|---|---|---|---|---|---|---|---|---|
| easy | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 100.0% |
| hard | 10 | 4 | 0 | 3 | 0 | 3 | 0 | 0 | 70.0% |
| medium | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0.0% |

## Natural repairs

No demo faults are injected in evaluation runs, so every repair below is a natural model failure repaired by Muse.

- Repair attempts: **2** across **2** job(s).
- Analysis repair attempts: **2** across **2** job(s) (source-analysis stage, TASK-024b; included in the totals above).
- Checks targeted by repairs:

| Check id | Repair attempts targeting it |
|---|---|
| `analysis.concept-ids` | 2 |

## Cost and timing

- Published lessons: **6**
- Mean cost per published lesson: **$0.07**; max: **$0.08**
- Total cost of all 12 recorded job(s): **$0.50** (includes declines and failures)
- Mean wall time per job: **40.0 s**

## Per-page outcomes

| # | Source | Subject | Difficulty | Expected | Class | Engine | Published rev | Cost | Wall |
|---|---|---|---|---|---|---|---|---|---|
| 3 | `nasa-grc-weight-equation` | physics | hard | forces-1d-v1 | correct-decline | — | — | $0.02 | 20.2s |
| 4 | `nasa-grc-motion-of-free-falling-object` | physics | easy | forces-1d-v1 | correct-after-repair | forces-1d-v1 | 1 | $0.06 | 56.5s |
| 7 | `nasa-grc-lift-equation-of-the-1900s` | physics | hard | lift-equation-v1 | correct-first-try | lift-equation-v1 | 1 | $0.07 | 66.5s |
| 8 | `nasa-grc-specific-heat-cp-cv` | physics | hard | speed-of-sound-v1 | wrong-decline | — | — | $0.01 | 12.2s |
| 9 | `nasa-grc-earth-atmosphere-equation-english` | physics | hard | speed-of-sound-v1 | wrong-decline | — | — | $0.01 | 12.1s |
| 10 | `nasa-grc-role-of-the-mach-number` | physics | hard | speed-of-sound-v1 | correct-decline | — | — | $0.03 | 26.2s |
| 11 | `cfpb-teenagers-and-saving` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.06 | 64.4s |
| 12 | `cfpb-saving-post-secondary-education` | finance | hard | compound-interest-v1 | correct-first-try | compound-interest-v1 | 1 | $0.08 | 76.5s |
| 13 | `nrc-backgrounder-radioactive-waste` | chemistry-earth | hard | half-life-v1 | correct-first-try | half-life-v1 | 1 | $0.06 | 56.4s |
| 21 | `nara-louisiana-purchase-treaty` | history | hard | timeline-v1 | wrong-decline | — | — | $0.01 | 12.1s |
| 28 | `nasa-grc-re-living-the-wright-way` | physics | medium | decline | false-accept | timeline-v1 | 1 | $0.06 | 62.5s |
| 29 | `nasa-grc-glider-trajectory-problem` | physics | hard | decline | correct-decline | — | — | $0.02 | 14.1s |
