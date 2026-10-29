# Stage 5b evaluation — lead adjudication (post-hoc, 2026-10-29)

The pre-registered scoring (`summary.md`, expectations committed in `32ca75e` before any run) stays unchanged. This note records the lead's after-the-fact review of every non-correct outcome, so readers can see which misses were Muse errors, which were system limits, and which were wrong expectations. It does not replace the scores.

| # | Source | Pre-registered class | Lead review | Category |
|---|---|---|---|---|
| 4 | nasa-grc-motion-of-free-falling-object | failed `ANALYSIS_INVALID` | Muse chose the right engine but wrote a 51-character concept id (limit 40); `analysis.concept-ids` caught it. The analysis stage has no repair loop, so the job ended. | **Genuine Muse error, caught, not repairable today** |
| 7 | nasa-grc-lift-equation-of-the-1900s | failed `OUTPUT_TRUNCATED` | Analysis reasoning used all 6,000 analysis output tokens (5,706 reasoning). | System limit |
| 28 | nasa-grc-re-living-the-wright-way | failed `OUTPUT_TRUNCATED` | Same analysis cap. | System limit |
| 21, 22, 24, 25 | NARA Louisiana, Constitution, Bill of Rights, Emancipation | wrong-decline | The transcribed agency introductions state fewer than five groundable dates (counts: 1–4 month-day mentions, 1–3 distinct years); `timeline-v1` requires 5. Muse's reasons say so explicitly (e.g. "gives fewer than five explicitly dated events"). | **Expectation wrong; decline correct** |
| 8 | nasa-grc-specific-heat-cp-cv | wrong-decline | Page teaches cp, cv, enthalpy, γ = cp/cv, R = cp − cv, not a = √(γRT). Decline defensible. | Expectation optimistic |
| 9 | nasa-grc-earth-atmosphere-equation-english | wrong-decline | Page teaches the three-zone atmosphere model (T, p, ρ vs altitude), not the speed of sound. Decline defensible. | Expectation optimistic |
| 6 | nasa-grc-effect-of-size-on-lift | wrong-decline | Page is about reference area and flaps/slats; Muse: "does not teach the full lift equation". Borderline. | Borderline |
| 18 | nij-heterozygosity | wrong-decline | Muse listed heterozygosity, allele frequencies, Punnett squares and diversity but no 2pq calculation. Not yet re-read by the lead. | Open |
| 15 | nrc-glossary-half-life | false-accept | 39-word definition; the published lesson quotes the definition verbatim and uses illustrative numbers computed by code from it. Faithful, but thin source. | Expectation conservative |
| 16 | usgs-powell-geologic-time | wrong-engine | Muse built a 7-event history-of-geology timeline (Steno 1669 … Patterson 1956), every date quoted. A strong lesson; not the half-life lesson we expected. | Expectation narrow |

## What this means
- **Muse's published lessons were all correct first time** (9 of 9, every check passing); no natural spec repair occurred.
- **Muse's real errors happened in the analysis step**, where there is no repair loop: one format error (#4). Two more jobs hit the analysis output cap (#7, #28).
- Most "wrong declines" are honest declines on pages our activities do not fit; the pre-registered expectations were too optimistic.

## Follow-ups (not applied during the evaluation)
1. Analysis output cap 6,000 → raise (two truncations).
2. Give the analysis stage the same bounded check → repair loop as the spec stage. #4 would then have been a genuine, natural, visible repair.
3. Consider whether `timeline-v1`'s minimum of 5 events is too strict for short primary-source introductions.

## Correction (2026-10-29, after independent review S5B-09)
- "Muse's published lessons were all correct first time" overstates what was measured. Supported statement: **all nine published specs passed the implemented deterministic checks on revision 1.** The checks do not establish prose entailment, applicability or event-label correctness, and the review (S5B-01/S5B-02) showed the timeline date check could accept dates not stated in the source; those holes are being fixed. Content correctness was not independently assessed.
- #4's concept id was **53** characters, not 51.
- The 16/29 score is an expectation-matching decision score, not a measure of content correctness. The pre-registered scores above are unchanged.

## Correction (2026-10-29, after the Stage 5b round-3 review fixes, commit bb56577)
Date grounding is now fail-closed: a date counts only when the source states it in a supported exact form with no qualifier or bound beside it (`docs/specs/STAGE-5b-plan.md`, round-3 decision). A negated "until" ("was not approved until September of 1776") still counts. Replayed under the current checks, **`job-20261028171315-79068df8`** (NARA Lee Resolution, published r1) no longer passes `timeline.date-grounded`: e4 1776-07-02 ("approval was deferred until July 2") and e7 1777-11 ("the plan of confederation was delayed until November of 1777"). These dates match the page, but an un-negated "until" names a deadline or a period end, not proof the event happened on that date, so the checks now reject them. This is an accepted false rejection. The stored files, the pre-registered score and the original verdict are unchanged. A re-run under the current checks is recorded separately.
- Update (commit 0c5d51f, negated-until exception removed after review S5B-22): Lee Resolution **e6** 1776-09 ("The plan for making treaties was not approved until September of 1776") now also fails `timeline.date-grounded`. Same accepted-false-rejection reasoning; originals unchanged.
