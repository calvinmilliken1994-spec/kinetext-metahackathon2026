# Licensed sources

Each source is a `<id>.txt` (exact bytes, hashed) plus `<id>.json` metadata (license, attribution, sha256, retrieval time, transcription notes). `packages/sources` refuses to load a text whose hash no longer matches. Line endings are protected by `.gitattributes`.

| Id | Page | Use |
|---|---|---|
| `nasa-grc-equations-of-motion` | NASA Glenn, Beginner's Guide to Aeronautics — Equations of Motion | Supported demo source: constant force and mass, a = F/m, V = a·t + Vo, x = a·t²/2 + Vo·t + xo |
| `nasa-grc-speed-of-sound` | NASA Glenn — Speed of Sound Interactive (article sections only) | Stage 2: deliberately unsupported. Stage 5: supported by `speed-of-sound-v1` (a = sqrt(gamma * R * T)) |
| `nasa-grc-lift-equation` | NASA Glenn — Lift Equation | Stage 5 supported source for `lift-equation-v1` (L = Cl * (rho * V^2 / 2) * A) |
| `nasa-grc-ballistic-flight-equations` | NASA Glenn — Ballistic Flight Equations | Stage 5 supported source for `projectile-v1` (y = V0 * t - g * t^2 / 2, ymax = V0^2 / (2 * g)) |
| `nasa-grc-flight-equations-with-drag` | NASA Glenn — Flight Equations with Drag | Stage 5 deliberately unsupported: real physics (drag, terminal velocity) that no tested engine models; the pipeline should decline rather than force projectile-v1 |
| `cfpb-compound-interest` | CFPB, Ask CFPB — How does compound interest work? | Stage 5b supported source for `compound-interest-v1` (A = P*(1+r/(100*n))^(n*t)); canonical $1,000 at 5% worked example as a plain-text table |
| `nrc-unit-1-radiation` | NRC, The Student Corner — Unit 1: Radiation | Stage 5b supported, noisy: half-life with numbers (10-year half-life halving sequence, U-238 decay chain) inside a 2,300-word classroom lesson plan; targets `half-life-v1` |
| `usgs-geologic-age` | USGS — Geologic Age: Using Radioactive Decay to Determine Geologic Age | Stage 5b deliberately unsupported: age equation solved for t (t=1/delta ln(1 + D/P)) and decay constant (t 1/2 = ln2/delta) are outside `half-life-v1`; the pipeline should decline |
| `nij-hardy-weinberg-principle` | NIJ — Population Genetics and Statistics for Forensic Analysts: Hardy-Weinberg Principle | Stage 5b supported source for `hardy-weinberg-v1` (p^2 + 2pq + q^2 = 1; MN blood group p=0.547, 2pq=0.496); includes a multi-step fly example and a chi-squared extension no engine models |
| `nara-declaration-of-independence` | National Archives, Milestone Documents — Declaration of Independence (1776), agency-written introduction | Stage 5b supported source for planned `timeline-v1`; dense 1776 date sequence (June 10 → August 2) with verbatim quotes |
| `nara-articles-of-confederation` | National Archives, Milestone Documents — Articles of Confederation (1777), agency-written introduction | Stage 5b supported source for planned `timeline-v1`; multi-year sequence 1776–1789 (adoption, ratification, Constitutional Convention) |

## Stage 5b evaluation set (TASK-023b, retrieved 2026-10-28)

Pages Muse has never seen during development, transcribed from the verified shortlist in `docs/evidence/stage-5b/evaluation-candidates.md`; the evaluation plan with expected outcomes lives in `data/evaluation/manifest.json`. Same transcription rules as above; every page was re-fetched live (all HTTP 200) and transcribed from what the page served that day. Page quirks — truncated or duplicated paragraphs, missing words, imperial units, cross-source half-life conflicts — are deliberate test conditions and are kept exactly as printed.

| Id | Page | Expected |
|---|---|---|
| `nasa-grc-newtons-laws-of-motion` | NASA Glenn, Beginner's Guide to Aeronautics — Newton's Laws of Motion | `forces-1d-v1` (easy) |
| `nasa-grc-simplified-aircraft-motion` | NASA Glenn — Simplified Aircraft Motion | `forces-1d-v1` (medium) |
| `nasa-grc-weight-equation` | NASA Glenn — Weight Equation | `forces-1d-v1` (hard, borderline: W = m·g / gravitation, decline acceptable) |
| `nasa-grc-motion-of-free-falling-object` | NASA Glenn — Motion of Free Falling Object | `forces-1d-v1` or `projectile-v1` (easy) |
| `nasa-grc-range-constant-velocity` | NASA Glenn — Range – Constant Velocity | `projectile-v1` horizontal part (easy but partial) |
| `nasa-grc-effect-of-size-on-lift` | NASA Glenn — Effect of Size on Lift | `lift-equation-v1` (medium) |
| `nasa-grc-lift-equation-of-the-1900s` | NASA Glenn — Lift Equation of the 1900's | `lift-equation-v1` (hard: Smeaton coefficient, imperial units) |
| `nasa-grc-specific-heat-cp-cv` | NASA Glenn — Specific Heat – Cp & Cv | `speed-of-sound-v1` γ/R inputs (hard, derivation-heavy) |
| `nasa-grc-earth-atmosphere-equation-english` | NASA Glenn — Earth Atmosphere Equation – English | `speed-of-sound-v1` (hard: customary units, three zones) |
| `nasa-grc-role-of-the-mach-number` | NASA Glenn — Role of the Mach Number | `speed-of-sound-v1` (hard, borderline: mostly flight-regime classification) |
| `cfpb-teenagers-and-saving` | CFPB, Money as You Grow — Teenagers and saving | `compound-interest-v1` (hard: annuity example outside the lump-sum engine) |
| `cfpb-saving-post-secondary-education` | CFPB, Building Blocks — Saving for post-secondary education (teacher guide PDF) | `compound-interest-v1` (hard: dangling answer-key totals) |
| `nrc-backgrounder-radioactive-waste` | NRC — Backgrounder on Radioactive Waste | `half-life-v1` (hard, borderline: policy text with half-life numbers, no computation) |
| `nrc-backgrounder-plutonium` | NRC — Backgrounder on Plutonium | `half-life-v1` (medium, borderline; Pu-239 24,100 yr conflicts with the waste backgrounder's 24,000 yr by design) |
| `nrc-glossary-half-life` | NRC glossary — Half-life | decline (one-sentence definition, no numbers) |
| `usgs-powell-geologic-time` | USGS — Powell Expedition—Geologic Time. Then and Now. | `half-life-v1` (medium/hard: cake analogy + U-235 example; 710 Myr conflicts with the core source's 704 Myr by design) |
| `usgs-fossils-numeric-time-scale` | USGS — Fossils, Rocks, and Time: The Numeric Time Scale | `half-life-v1` (easy, clean definition) |
| `nij-heterozygosity` | NIJ course — Heterozygosity | `hardy-weinberg-v1` (easy/medium) |
| `nij-random-mating` | NIJ course — Random Mating | `hardy-weinberg-v1` (medium, assumption-focused, no numbers; decline acceptable) |
| `nij-population-genetics` | NIJ course — Population Genetics | `hardy-weinberg-v1` groundwork (easy, thin; decline acceptable) |
| `nara-louisiana-purchase-treaty` | National Archives — Louisiana Purchase Treaty (1803), agency-written introduction | `timeline-v1` (hard: ambiguous event selection) |
| `nara-constitution` | National Archives — Constitution of the United States (1787), agency-written introduction | `timeline-v1` (medium) |
| `nara-lee-resolution` | National Archives — Lee Resolution (1776), agency-written introduction | `timeline-v1` (easy, dense 1776 sequence) |
| `nara-bill-of-rights` | National Archives — Bill of Rights (1791), agency-written introduction | `timeline-v1` (easy/medium) |
| `nara-emancipation-proclamation` | National Archives — Emancipation Proclamation (1863), agency-written introduction | `timeline-v1` (easy/medium, two-date core) |
| `nasa-grc-drag-equation` | NASA Glenn — Drag Equation | decline (real drag physics, no engine) |
| `nasa-grc-bernoullis-equation` | NASA Glenn — Bernoulli's Equation | decline (no engine; lift appliesWhen excludes it) |
| `nasa-grc-re-living-the-wright-way` | NASA Glenn — Guide to Reliving the Wright Way (index) | decline (narrative index page) |
| `nasa-grc-glider-trajectory-problem` | NASA Glenn — Glider Trajectory Problem | decline (ballistic-looking trap; steady-descent force equilibrium) |

## License basis (checked 2026-10-27)
NASA Images and Media Usage Guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/): NASA content is generally not subject to US copyright and may be used for educational purposes with NASA acknowledged as the source. Its **AI applications** section permits use in AI tools on conditions this project follows:
- Disclose that the tool includes NASA source material, without implying NASA review or permission.
- Attribute AI outputs to the AI product, never "according to NASA".
- No NASA insignia with AI-generated content; mark AI-generated products as such.
- NASA is not responsible for the accuracy of AI outputs.

No NASA images, logos or third-party copyrighted figures are stored; text only.

## License basis for Stage 5b agencies (policy pages re-fetched and quoted 2026-10-28)
- **CFPB** — Website Privacy Policy and Legal Notices (https://www.consumerfinance.gov/privacy/website-privacy-policy/): "Information created by the CFPB is in the public domain and you may reproduce, publish, or otherwise use it without the Bureau’s permission." The Financial Intuition episode transcript is CFPB-produced content (the episode opens with the standard CFPB disclaimer read on air). CFPB trademarks are not used.
- **NRC** — Site Disclaimer (https://www.nrc.gov/site-help/disclaimer.html): "NRC's website constitutes a U.S. Government Work under federal copyright law and as such, it is not subject to copyright." The same page notes permission is still required for third-party photos/graphics; only NRC-authored text is transcribed.
- **USGS** — Copyrights and Credits (https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits): "USGS-authored or produced data and information are considered to be in the U.S. Public Domain." The same page warns that some non-USGS photographs/graphics on USGS sites are copyrighted; none are stored. USGS asks for credit, included in the attribution field ("Credit: U.S. Geological Survey").
- **National Archives** — Privacy and Use Policies (https://www.archives.gov/global-pages/privacy.html): "Works of the U.S. Government that have been produced by the National Archives and Records Administration are in the public domain and may be copied and distributed without permission." Only the agency-written introductions are transcribed; the underlying 18th-century documents are public domain by age but were deliberately left out.
- **NIJ (OJP)** — NIJ Reuse Policy (https://nij.ojp.gov/reuse-policy): "In general, NIJ's content — text, imagery, video and audio — is not copyrighted." The policy asks users to acknowledge NIJ as the source and not imply endorsement; both are carried in the attribution field. The course pages state no third-party or grantee copyright (the Hardy/Weinberg photographs are credited to NIJ itself); only text is stored.

Third-party material embedded on any of these sites (others' photos, quoted copyrighted text) is not covered by these policies; only agency-authored text was transcribed.

## Rejected candidate
OpenStax *College Physics 2e* §4.3 (planned originally): the page now states the book is **CC BY-NC-SA 4.0** and "may not be used in the training of large language models or otherwise be ingested into large language models or generative AI offerings without OpenStax's prior written permission." Not used.

Stage 5 sources were retrieved 2026-10-27 with the same transcription rules (equations transcribed as printed, including any typos in the original page). Stage 5b sources (CFPB, NRC, USGS, NIJ, NARA) were retrieved 2026-10-28 with the same rules; www.usgs.gov returned intermittent 504s during retrieval and was re-fetched until it served HTTP 200 from the live URL. The Stage 5b evaluation set (29 pages: NASA Glenn, CFPB including the teacher-guide PDF's text layer, NRC, USGS, NIJ, NARA) was retrieved later on 2026-10-28; every URL returned HTTP 200 at retrieval time.

### Excluded after lead review (2026-10-28)
- CFPB *Financial Intuition* podcast, "Managing Your Money, Part 2" transcript — excluded: most of the text is spoken by a non-federal guest (a university staff member), so CFPB's public-domain statement ("Information created by the CFPB…") does not clearly cover it.

## Stage 6 chemistry sources (balance-the-equation, retrieved 2026-10-29)

Two agency pages that **print** a complete reaction equation in their own text — not inside an image — for the planned "balance the chemical equation" activity. Both were re-fetched live (HTTP 200) and transcribed from the PDF text layer; formulas print with subscripts and are stored as plain digits, the page's reaction arrow is stored as `→`, and original typos are kept exactly as printed.

| Id | Page | Equation(s) printed |
|---|---|---|
| `noaa-oceanexplorer-fueling-life-on-earth` | NOAA Office of Ocean Exploration and Research — *Fueling Life on Earth: Chemosynthesis versus Photosynthesis* educator guide and teacher key (grades 9–12 chemistry) | `6CO2 + 6H2O → C6H12O6 + 6O2` (photosynthesis) and `CO2 + 4H2S + O2 → CH2O + 4S + 3H2O` (chemosynthesis), each printed twice with the compound names under the species, plus the balancing rule ("the law of conservation of matter states that matter cannot be created or destroyed. So, all the reactant components on the left must be used to create the products on the right…"), the coefficient note ("6CO2 means they need six copies of the CO2 molecule") and the materials inventory 7 Carbon / 20 Hydrogen / 22 Oxygen / 4 Sulfur cubes — the atom total of both equations |

### License basis for the Stage 6 chemistry agencies (policy pages re-fetched 2026-10-29)

- **NOAA** — NOAA Education and Outreach FAQ (https://www.noaa.gov/office-education/outreach-communication/faq): "Nearly all of NOAA content, including images, videos, data products, educational materials, and more, is in the public domain and can be used without express permission." The same page requires crediting NOAA, forbids claiming federal content as one's own or implying endorsement, and adds: "Modify the content or misrepresent the content, and then present it as official government material. (If you make any edits, including using a generative AI program, make it clear that you edited it.)" — carried into the activity UI beside the generated lesson, together with the document's own request "If reproducing this activity, please cite NOAA as the source". NOAA's Central Library (https://library.noaa.gov/blogs/news-research-highlights/question-of-the-quarter-noaacopyright) confirms 17 U.S.C. § 105 public-domain status for agency-owned works and warns that co-authored items (cooperative institutes, universities) are **not** automatically public domain — the screen below.
- **NASA** — unchanged basis: NASA Images and Media Usage Guidelines (https://www.nasa.gov/nasa-brand-center/images-and-media/), re-fetched 2026-10-29: "NASA content – images, audio, video, and media files … generally are not subject to copyright in the United States. You may use this material for educational or informational purposes … NASA should be acknowledged as the source of the material", with the project's AI conditions from the Stage 5 note applying unchanged. *Flag for the lead:* the *Astrobiology Math* PDF is a NASA publication (cover "National Aeronautics and Space Administration"; author line "Dr. Sten Odenwald NASA / ADNET Corp."; "Created under an Education and Public Outreach grant, NNH08CD59C administered through the NASA Science Mission Directorate"), i.e. NASA-published but with a contractor named beside NASA on the author line. Only that agency-published problem text is stored and none of the book's third-party image credits; if the lead wants contractor authorship excluded outright, drop this id and keep the NOAA page plus one of the runner-ups below.

### Rejected chemistry candidates (licence-first screen, 2026-10-29)

- **EPA AirKnowledge APTI 427 *Combustion Source Evaluation* student manual** §4.1.1 "Chemical Balance" (https://airknowledge.gov/ILT/TOXC332/Current/08TOXC332_StudentManual.pdf) — the best content found: `CH4 + 2O2 → HEAT + CO2 + 2H2O (4-1)` with "Conservation of mass requires that the mass of fuel and air equal the mass of exhaust products… There are the same number of atoms on each side of the equation", and `CH4 + 2O2 → CO2 + 2H2O` again later. **Excluded on licence**: the front matter names an individual author (Brian W. Doyle, Doyle Engineering Inc), "Developed by ICES Ltd. EPA Contract No. 68D99022", states "The opinions and selections are those of the author and not necessarily those of the Environmental Protection Agency", and its availability notice grants copying for course use but withholds it "for any other purpose, such as for advertising or promotional purposes, for creating a new collective work, for resale, or for information storage and retrieval systems". airknowledge.gov's own disclaimer (https://airknowledge.gov/disclaimer.html) says nothing about copyright.
- **NASA Glenn *The Process of Combustion*** (https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/combustion/) — defines combustion, fuel, oxidizer and exhaust in words but prints no equation.
- **NASA *Conservation of Mass* middle-school Classroom Connection** (https://www.nasa.gov/wp-content/uploads/2023/04/conservation-of-mass-cc-ms-version1e.pdf) — explains subscripts versus coefficients and asks students to balance, but every equation on the page (respiration, and the vinegar/baking-soda answer) is a graphic: the PDF text layer contains the headings and the CO2/H2SO4/NaOH counting examples but no reaction line, so there is nothing verifiable to transcribe.
- **NOAA *Changing Ocean Chemistry*** (https://repository.library.noaa.gov/view/noaa/40601/noaa_40601_DS1.pdf) — has exactly the wanted passage ("have students count the number of atoms of each element written on each side of the equations… to help emphasize that the equations are balanced"), but it is "© 2019 by Oregon State University", its carbon-cycle section is "modified from a longer lesson by Earth Labs", and it is a NOAA Sea Grant award product. Hosted by NOAA, not a NOAA work.
- **NOAA Ocean Exploration *Investigation: Life on a Hydrothermal Vent*** and the ***Chemosynthesis*** fact sheet — both carry "Created in cooperation with the National Marine Sanctuary Foundation under federal award NA19OAR0110405", and the vent investigation's equation lines are scrambled in the text layer by subscript positioning.
- **NASA JPL lesson plans** *The Air Up There: Making Space Breathable* (`2 LiOH(s) + CO2(g) → Li2CO3(s) + H2O(g)`, plus an unbalanced `CO2(g) → O2(g) + CO(g)` for students) and *Mars Chemistry Coding Challenge* (`2CO2 → 2CO + O2`) — ideal balancing content, but JPL is managed by Caltech and no public-domain statement was found for its education pages.
- **EPA *Basic Ozone Layer Science*** (https://www.epa.gov/ozone-layer-protection/basic-ozone-layer-science) — the served page text prints no reaction arrow; the chlorine/ozone cycles live in the diagrams.
- **USGS *pH and Water*** (https://www.usgs.gov/water-science-school/science/ph-and-water) — prints `H2O = H+ + OH-` (atoms balance; charges do not appear in the engine's model) and is agency-authored under the verified USGS statement above: kept as the runner-up if a third chemistry page is wanted.

- `nasa-spacemath-miller-urey` (NASA Space Math, *Astrobiology Math*) was considered and **dropped by the lead**: the author line names a contractor (ADNET) under a NASA grant, so public-domain status is uncertain. Only clearly public-domain pages are used.
