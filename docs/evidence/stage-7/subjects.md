# Stage 7b — curated subjects of the 41 existing library pages (slice S)

Spec: `docs/specs/STAGE-7b-subjects.md`. Each `data/sources/<id>.json` gained one line, `"subject": "<Subject>"`, inserted after `"title"`; no other byte changed (LF endings kept) and every `.txt` sha256 is unchanged (`packages/sources/subjects.test.ts`, `tests/sources.test.ts`).

Each subject was chosen from the page itself (title, purpose, text) and cross-checked against Muse's own page classification: `analysis.subject` in `storage/runs/*/analysis-v2.r1.json`, matched to the page through `job.json` `sourceId` (152 lesson analyses on 30 of these pages; the other 11 pages only ran the classic activity flow, which records no subject).

## Counts

| Subject | Pages |
|---|---:|
| physics | 19 |
| chemistry | 4 |
| biology | 4 |
| earth-science | 4 |
| finance | 3 |
| history | 7 |
| **total** | **41** |

Maths, civics and language & reading have no existing page; slice N adds maths and civics pages.

## Overrides of Muse

None. Where Muse's runs disagreed with each other, the chosen subject is the majority one (see notes). The table lists every page.

## Table

| id | chosen subject | Muse classifications (analysis-v2 r1) | note |
|---|---|---|---|
| `nasa-grc-ballistic-flight-equations` | physics | — (no lesson run) |  |
| `nasa-grc-bernoullis-equation` | physics | physics ×5 |  |
| `nasa-grc-drag-equation` | physics | physics ×6 |  |
| `nasa-grc-effect-of-size-on-lift` | physics | physics ×5 |  |
| `nasa-grc-equations-of-motion` | physics | — (no lesson run) |  |
| `nasa-grc-flight-equations-with-drag` | physics | — (no lesson run) |  |
| `nasa-grc-glider-trajectory-problem` | physics | physics ×5 |  |
| `nasa-grc-lift-equation` | physics | — (no lesson run) |  |
| `nasa-grc-lift-equation-of-the-1900s` | physics | physics ×5 |  |
| `nasa-grc-motion-of-free-falling-object` | physics | physics ×5 |  |
| `nasa-grc-newtons-laws-of-motion` | physics | physics ×5 |  |
| `nasa-grc-range-constant-velocity` | physics | physics ×5 |  |
| `nasa-grc-re-living-the-wright-way` | physics | physics ×5 | Agree. A history-of-flight index page, but it says it teaches "the basic math and physics that led to the invention of the airplane"; its links are physics topics. |
| `nasa-grc-role-of-the-mach-number` | physics | physics ×5 |  |
| `nasa-grc-simplified-aircraft-motion` | physics | physics ×5 |  |
| `nasa-grc-specific-heat-cp-cv` | physics | physics ×5 | Agree. Thermodynamics (cp, cv, gamma) — physics. |
| `nasa-grc-speed-of-sound` | physics | — (no lesson run) |  |
| `nasa-grc-weight-equation` | physics | physics ×5 |  |
| `nrc-unit-1-radiation` | physics | — (no lesson run) | No Muse classification. Chosen from the page: a radiation teaching unit (natural vs man-made radiation, Geiger counter, cloud chamber, types of radiation, half-life) — taught as physics in most secondary curricula. Judgement call; the other NRC pages are chemistry. |
| `noaa-oceanexplorer-fueling-life-on-earth` | chemistry | chemistry ×1 | Agree (1 run). Borderline biology/chemistry: the topic is life processes, but the page is used for its two balanced equations (balance-the-equation component). |
| `nrc-backgrounder-plutonium` | chemistry | chemistry ×5 |  |
| `nrc-backgrounder-radioactive-waste` | chemistry | chemistry ×4, other ×1 | Agree with the majority (4 of 5); one run said other. Half-life and isotope numbers, grouped with the other NRC half-life pages. |
| `nrc-glossary-half-life` | chemistry | chemistry ×6 |  |
| `nij-hardy-weinberg-principle` | biology | — (no lesson run) |  |
| `nij-heterozygosity` | biology | biology ×5 |  |
| `nij-population-genetics` | biology | biology ×5 |  |
| `nij-random-mating` | biology | biology ×5 |  |
| `nasa-grc-earth-atmosphere-equation-english` | earth-science | earth-science ×5 | Agree. NASA aeronautics page, but its content is the atmosphere model (temperature and pressure by altitude zone) — Earth & space, not flight physics. |
| `usgs-fossils-numeric-time-scale` | earth-science | earth-science ×5 |  |
| `usgs-geologic-age` | earth-science | — (no lesson run) |  |
| `usgs-powell-geologic-time` | earth-science | earth-science ×5 |  |
| `cfpb-compound-interest` | finance | — (no lesson run) |  |
| `cfpb-saving-post-secondary-education` | finance | finance ×5 |  |
| `cfpb-teenagers-and-saving` | finance | finance ×7 |  |
| `nara-articles-of-confederation` | history | — (no lesson run) |  |
| `nara-bill-of-rights` | history | history ×4, civics ×1 | Agree with the majority (4 of 5). The page is a dated founding-document history (proposal 1789 → ratification 1791); one run said civics. Civics pages are being added separately (slice N). |
| `nara-constitution` | history | history ×6 |  |
| `nara-declaration-of-independence` | history | — (no lesson run) |  |
| `nara-emancipation-proclamation` | history | history ×5 |  |
| `nara-lee-resolution` | history | history ×5 |  |
| `nara-louisiana-purchase-treaty` | history | history ×6 |  |

## Screenshots (`subjects/`)

1920×1080, dark and light, taken from a throwaway Vite (port 5199) against an OFFLINE API on port 8788 running this slice's code over the real `storage/` (live generation off, GET only). The running API on 8787 still serves the old code until it is restarted. In the two `picker-*` shots the native select was given a `size` attribute for the capture only, so its subject groups show as an open list (a closed native select cannot be screenshotted open).

- `picker-grouped-{dark,light}.png` — the source page picker grouped by subject (library pages A–Z per subject, teacher pages in their own group), chips with page counts; the lesson header shows the quiet subject label ("Biology").
- `picker-chip-chemistry-{dark,light}.png` — the Chemistry chip active: the picker lists only the 4 chemistry pages and shows "Choose one of 4 Chemistry pages" while the open lesson (a biology page) is outside the filter.
- `runs-filtered-chemistry-{dark,light}.png` — runs drawer, "All pages", filtered by the same Chemistry chip: 22 of 230 runs, each with its subject and page title.
