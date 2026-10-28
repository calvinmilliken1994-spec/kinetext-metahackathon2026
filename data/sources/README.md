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
