# Stage 5b — Evaluation candidate sources (not transcribed)

Candidate pages for evaluating the source → activity pipeline. **None of these were transcribed or stored**; this is a verified shortlist only. The six transcribed Stage 5b core sources (a seventh, a CFPB podcast transcript, was excluded by the lead for licence reasons) live in `data/sources/` (see its README).

- Compiled and URL-checked: 2026-10-28 (UTC). Every URL below was fetched during compilation and returned **HTTP 200** unless a note says otherwise.
- Licence policy per agency (all re-fetched and quoted in `data/sources/README.md` on 2026-10-28):
  - NASA: https://www.nasa.gov/nasa-brand-center/images-and-media/ (US government work; AI-use conditions apply — AI outputs attributed to the AI product, never "according to NASA", no insignia, no implied endorsement)
  - CFPB: https://www.consumerfinance.gov/privacy/website-privacy-policy/ ("Information created by the CFPB is in the public domain…")
  - NRC: https://www.nrc.gov/site-help/disclaimer.html ("…a U.S. Government Work under federal copyright law and as such, it is not subject to copyright.")
  - USGS: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits ("USGS-authored or produced data and information are considered to be in the U.S. Public Domain.")
  - NIJ/OJP: https://nij.ojp.gov/reuse-policy ("In general, NIJ's content — text, imagery, video and audio — is not copyrighted."; the course states no third-party/grantee copyright)
  - NARA: https://www.archives.gov/global-pages/privacy.html ("Works of the U.S. Government that have been produced by the National Archives and Records Administration are in the public domain…")
- **OpenStax is excluded everywhere**: CC BY-NC-SA 4.0 plus an explicit ban on LLM ingestion/training (see `data/sources/README.md`, "Rejected candidate").
- Word counts are approximate main-content estimates (HTML tag-stripped, script/style/nav removed); they include some residual page furniture and exclude images. The PDF count is estimated from its extracted text layer.
- "Hard" = likely to provoke a model error: imperial/customary units, unit conversion, multi-step worked examples, long or noisy pages, many equations, ambiguous applicability, or ambiguous dates.
- Engines referenced: `forces-1d-v1` (a = F/m), `projectile-v1` (ymax = V0²/(2g)), `lift-equation-v1`, `speed-of-sound-v1` (a = √(γ·R·T)), `compound-interest-v1` (A = P·(1+r/(100n))^(nt)), `hardy-weinberg-v1` (2pq), `half-life-v1` (N = N0·(1/2)^(t/T)), planned `timeline-v1`.

## Physics / aeronautics — NASA Glenn, Beginner's Guide to Aeronautics (10 supported/hard)

| # | Title | URL | Expected engine | Difficulty | ≈ words |
|---|---|---|---|---|---|
| 1 | Newton's Laws of Motion | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/newtons-laws-of-motion/ | forces-1d-v1 | Easy: all three laws stated plainly, F = m·a with metric examples; short | 1,230 |
| 2 | Simplified Motion (aircraft) | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/simplified-aircraft-motion/ | forces-1d-v1 | Medium: balanced-vs-unbalanced forces on an aircraft, explicit Newton's-second-law computation | 390 |
| 3 | Weight Equation | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/weight-equation/ | forces-1d-v1 (borderline) | **Hard**: teaches W = m·g and F = G·m1·m2/d², g varying with altitude, mass-vs-weight units — not F_net = m·a; tests applicability judgment, mass/weight confusion likely | 480 |
| 4 | Motion of Free Falling Object | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/motion-of-free-falling-object/ | forces-1d-v1 / projectile-v1 (vertical) | Easy: constant g, table of acceleration/velocity/displacement at 1-second intervals, metric | 490 |
| 5 | Range — Constant Velocity | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/range-constant-velocity/ | projectile-v1 (horizontal x = U0·t part) | Easy but partial: only the horizontal component of the engine; tests whether the model over-claims | 580 |
| 6 | Effect of Size on Lift | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/effect-of-size-on-lift/ | lift-equation-v1 | Medium: reference-area choice for the lift equation, wing-area computation for odd shapes, scaling | 510 |
| 7 | Lift Equation of the 1900's | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation-of-the-1900s/ | lift-equation-v1 | **Hard**: historical form L = k·V²·A·cl with the Smeaton coefficient in imperial units (lb/ft²), several quoted k values — unit conversion and ambiguous constant likely to trip the model | 860 |
| 8 | Specific Heat — Cp & Cv | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-heat-cp-cv/ | speed-of-sound-v1 (γ and R inputs) | **Hard**: derivation-heavy thermodynamics (enthalpy, internal energy, γ = cp/cv, R = cp − cv) with many equations around the two numbers the engine needs | 960 |
| 9 | Earth Atmosphere Equation — English | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/earth-atmosphere-equation-english/ | speed-of-sound-v1 | **Hard**: customary units throughout (°F, feet, lb/ft²), three atmospheric zones with separate curve fits (T = 59 − .00356h; p = 2116·((T+459.7)/518.6)^5.256), multi-step substitution to reach a = √(γRT) | 640 |
| 10 | Role of the Mach Number | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/role-of-the-mach-number/ | speed-of-sound-v1 (borderline) | **Hard**: derives a = √(γ·p/ρ) but is mostly flight-regime classification, which the engine's appliesWhen explicitly excludes; ambiguous mapping by design | 790 |

## Finance — CFPB (2)

| # | Title | URL | Expected engine | Difficulty | ≈ words |
|---|---|---|---|---|---|
| 11 | Teenagers and saving (Money as You Grow) | https://www.consumerfinance.gov/consumer-tools/money-as-you-grow/teen-young-adult/explore-saving/ | compound-interest-v1 | **Hard**: defines compound interest but its worked example is yearly deposits ($100/yr at 5% from age 14 ≈ $23,000 at 65 vs from age 35 ≈ $7,000) — an annuity the lump-sum engine does not model; tests whether cases stay within A = P·(1+r/(100n))^(nt) | 570 |
| 12 | Building Blocks teacher guide — Saving for post-secondary education (PDF) | https://files.consumerfinance.gov/f/documents/cfpb_building_block_activities_saving-post-secondary-education_guide.pdf | compound-interest-v1 | **Hard**: 6-page lesson plan; contains the canonical lump-sum example ($1,000 → $1,050 → $1,102.50 at 5% yearly) plus answer-key totals ($8,974.70 / $9,330.16 / $24,315.19) whose inputs live in a separate worksheet PDF — dangling numbers likely to be misused | ≈2,200 (est.) |

## Chemistry / earth science — NRC & USGS (5)

| # | Title | URL | Expected engine | Difficulty | ≈ words |
|---|---|---|---|---|---|
| 13 | Backgrounder on Radioactive Waste | https://www.nrc.gov/regulations-legislation/fact-sheets-brochures/backgrounder-on-radioactive-waste | half-life-v1 (borderline) | **Hard**: half-life numbers given (Sr-90/Cs-137 ≈ 30 yr; Pu-239 = 24,000 yr) inside ~1,900 words of waste-policy text; no decay computation — may legitimately decline or produce a thin activity | 1,900 |
| 14 | Backgrounder on Plutonium | https://www.nrc.gov/regulations-legislation/fact-sheets-brochures/backgrounder-on-plutonium | half-life-v1 (borderline) | Medium: Pu-239 = 24,100 yr, Pu-241 = 14.4 yr half-lives with the "time to lose half its radioactivity" definition; values conflict in print with #13 (24,000 vs 24,100) — cross-source consistency trap | 560 |
| 15 | Half-life (NRC glossary) | https://www.nrc.gov/education-regulatory-research/glossary/half-life | half-life-v1 | Easy but very thin: one-sentence definition ("millionths of a second to billions of years"), no numbers to build cases from; a strict pipeline should decline for insufficient content | 130 |
| 16 | Powell Expedition — Geologic Time. Then and Now. | https://www.usgs.gov/news/powell-expedition-geologic-time-then-and-now | half-life-v1 | Medium/hard: cake-eating halving analogy (half-life = 1 day; 1/8 left → 3 half-lives) plus a U-235→Pb-207 worked example (7/8 daughter → 3 half-lives → 2.13 billion yr) buried in a narrative news feature; note U-235 half-life quoted as 710 Myr here vs 704 Myr on the core USGS geologic-age source | 1,770 |
| 17 | Fossils, Rocks, and Time — The Numeric Time Scale | https://pubs.usgs.gov/gip/fossils/numeric.html | half-life-v1 | Easy: clean definition of half-life (time for exactly one-half of parent atoms to decay), parent/daughter reasoning; 1990s-era USGS publication HTML | 660 |

## Biology — NIJ, Population Genetics and Statistics for Forensic Analysts (3)

All three are pages of the same NIJ-hosted archived course as the core `nij-hardy-weinberg-principle` source; licence basis verified via the NIJ Reuse Policy and the absence of any third-party/grantee copyright statement on the course (checked 2026-10-28).

| # | Title | URL | Expected engine | Difficulty | ≈ words |
|---|---|---|---|---|---|
| 18 | Heterozygosity | https://nij.ojp.gov/nij-hosted-online-training-courses/population-genetics-and-statistics-forensic-analysts/population-theory/population-genetics/heterozygosity | hardy-weinberg-v1 | Easy/medium: heterozygote frequency 2pq as the direct teaching target of the engine | 670 |
| 19 | Random Mating | https://nij.ojp.gov/nij-hosted-online-training-courses/population-genetics-and-statistics-forensic-analysts/population-theory/hardy-weinberg-principle/random-mating | hardy-weinberg-v1 | Medium: derives p², 2pq, q² genotype frequencies from random union of gametes; assumption-focused | 430 |
| 20 | Population Genetics | https://nij.ojp.gov/nij-hosted-online-training-courses/population-genetics-and-statistics-forensic-analysts/population-theory/population-genetics | hardy-weinberg-v1 (allele-frequency groundwork) | Easy: allele frequency, p + q = 1, gene-pool basics; thin for full equilibrium cases | 540 |

## History — National Archives Milestone Documents, agency-written introductions (5)

All target the planned `timeline-v1` (events with dates in order, each tied to a verbatim quote). Only the NARA-written introduction/background sections are usable; the 18th/19th-century transcripts are public domain by age but are separate from the agency text.

| # | Title | URL | Expected engine | Difficulty | ≈ words |
|---|---|---|---|---|---|
| 21 | Louisiana Purchase Treaty (1803) | https://www.archives.gov/milestone-documents/louisiana-purchase-treaty | timeline-v1 | **Hard**: long page (~4,000 words incl. treaty transcript), negotiation dated April 30, 1803 with treaty/ratification/exchange dates and a French-English document history — many candidate events, ambiguous selection and ordering | 3,960 |
| 22 | Constitution of the United States (1787) | https://www.archives.gov/milestone-documents/constitution | timeline-v1 | Medium: convention convened May 14, 1787; mid-June decision to redesign; signed September 17, 1787; ratification sequence into 1788–1789 | 360 |
| 23 | Lee Resolution (1776) | https://www.archives.gov/milestone-documents/lee-resolution | timeline-v1 | Easy: June 7 motion, June 10 committee of five, June 11 committee, July 2 adoption — short dense sequence that pairs with the core Declaration source | 650 |
| 24 | Bill of Rights (1791) | https://www.archives.gov/milestone-documents/bill-of-rights | timeline-v1 | Easy/medium: June 8, 1789 Madison amendments; September 25, 1789 Congress proposes twelve; December 15, 1791 Virginia ratifies ten | 1,240 |
| 25 | Emancipation Proclamation (1863) | https://www.archives.gov/milestone-documents/emancipation-proclamation | timeline-v1 | Easy/medium: Preliminary Proclamation September 22, 1862; final January 1, 1863; two-date core with surrounding context | 1,230 |

## Should be declined — related topics no engine models (4)

| # | Title | URL | Expected outcome | Why | ≈ words |
|---|---|---|---|---|---|
| 26 | Drag Equation | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/drag-equation/ | Decline | Real, quantitative physics (D = Cd·ρV²A/2) but no tested engine models drag; closest engines (lift, projectile) explicitly exclude it | 580 |
| 27 | Bernoulli's Equation | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/bernoullis-equation/ | Decline | Pressure/energy conservation along a streamline; no engine; lift-equation-v1 appliesWhen excludes Bernoulli pressure distributions alone | 1,420 |
| 28 | Re-Living the Wright Way (guide index) | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/re-living-the-wright-way/ | Decline | Narrative history-of-flight index page; no single quantitative model; forcing an engine here would fabricate physics | 870 |
| 29 | Glider Trajectory Problem | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/glider-trajectory-problem/ | Decline | **Trap**: looks ballistic (trajectory, glide angle tan(a) = h/d) but the physics is steady descent in lift/drag equilibrium (L·cos a + D·sin a = W); projectile-v1 explicitly excludes drag — the most likely forced-mapping error in the physics set | 400 |

## Counts

- Total candidates: **29** = 25 subject pages + 4 declines.
- By subject: physics/aeronautics 14 (10 supported/hard pages + 4 declines: drag equation, Bernoulli, Wright-way narrative, glider-trajectory trap), finance 2, chemistry/earth 5, biology 3, history 5.
- Marked **hard**: 10 — #3, 7, 8, 9, 10, 11, 12, 13, 21, 29 (#16 medium/hard). Hard axes: imperial units (#7, 9), multi-step worked examples (#9, 12, 16), long/noisy pages (#11, 12, 13, 21), ambiguous applicability (#3, 10, 13, 15), ambiguous dates (#21).
- Declines: 4 (#26–29), covering the requested drag / Bernoulli / narrative-history examples plus the ballistic-looking glider trap.

## Notes and anomalies found during verification

- The USGS FAQ "What does half-life mean?" (https://www.usgs.gov/faqs/what-does-half-life-mean) returned HTTP 504 repeatedly on 2026-10-27/28 and then **HTTP 404** — the page appears to have been removed or moved. It is excluded; #16/#17 replace it. www.usgs.gov itself was intermittently 504 during compilation; every USGS URL listed above returned 200 on its final check.
- NRC has reorganised its site (old /reading-rm/basic-ref/… URLs 404 and redirect); the URLs above are the current ones verified 200.
- The NIJ course pages carry an "Archived — no longer being updated" notice; content is stable and licence-verified, but a future link-rot risk exists.
- Cross-source numeric conflict kept deliberately: Pu-239 half-life 24,000 yr (#13) vs 24,100 yr (#14); U-235 half-life 704 Myr (core USGS geologic-age source) vs 710 Myr (#16). Useful for checking that generated activities quote their own source, not a blend.
- The core transcribed sources (already in `data/sources/`, not repeated here): nasa-grc-equations-of-motion, nasa-grc-speed-of-sound, nasa-grc-lift-equation, nasa-grc-ballistic-flight-equations, nasa-grc-flight-equations-with-drag (decline control), cfpb-compound-interest, nrc-unit-1-radiation, usgs-geologic-age (decline control), nij-hardy-weinberg-principle, nara-declaration-of-independence, nara-articles-of-confederation.
