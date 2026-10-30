# Stage 7b slice N — new library sources for the thin subjects (2026-10-30)

Eight new licence-verified public pages added to `data/sources/` for the thin subjects: **maths 3, civics 3, biology 2** (frozen spec: `docs/specs/STAGE-7b-subjects.md`). Every page is a U.S. federal government work, fetched live today with Node fetch (all HTTP 200), transcribed as exact main text (LF, whitespace-normalised, no navigation/footer), hashed with sha256, and verified through the hash-checked `loadSource` (output at the bottom). No existing `data/sources/` file was modified; nothing outside `data/sources/` and this note was touched.

## New pages

| Id | Subject | Publisher | URL | Licence evidence (policy page, fetched 2026-10-30) | Chars | Suits components | Caveats |
|---|---|---|---|---|---|---|---|
| `nasa-grc-sine-cosine-tangent` | maths | NASA Glenn Research Center | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/sine-cosine-tangent/ | NASA Images and Media Usage Guidelines (NASA-1 below) | 6,401 | formula explorer (sin/cos/tan ratio formulas), quiz cards predict-then-reveal (8-ft ladder cases), compare table of the three ratios | display equations are MathJax LaTeX, rendered as plain-text lines (`sin(c) = o/h`); the three trig tables at the bottom are images — headings kept, tables not; page's own "75.5 degrees degrees" duplication kept |
| `nasa-grc-idea-of-functions` | maths | NASA Glenn Research Center | https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/idea-of-functions/ | NASA Images and Media Usage Guidelines (NASA-1 below) | 4,170 | quiz cards (predict ratio when sides double/triple), compare table (black/red/blue similar triangles), formula explorer for cos(b) = a/h | the nested-triangles figure is an image and removed; the text describing it is the page's own and kept |
| `census-computing-apportionment` | maths | U.S. Census Bureau | https://www.census.gov/topics/public-sector/congressional-apportionment/about/computing.html | Census DS027 policy (CENSUS-1 below) | 3,365 | step ordering (the seat-assignment procedure), quiz cards on the worked multipliers (0.70710678, 0.40824829, 0.288675134), formula explorer for the multiplier/priority value | the equations are GIF images; each replaced by its own alt text verbatim ("1 divided by the square root of n(n-1)") — fidelity checks must treat alt text as page text; embedded Art. 1 §2 quotation is public domain by age |
| `usagov-branches-of-government` | civics | USA.gov (GSA) | https://www.usa.gov/branches-of-government | GSA website policies, "Reuse and copyright" (GSA-1 below) | 2,612 | compare table (branch × composition/roles/checks), quiz cards, claim-evidence | none |
| `usagov-how-laws-are-made` | civics | USA.gov (GSA) | https://www.usa.gov/how-laws-are-made | GSA website policies (GSA-1 below) | 2,223 | step ordering (7-step bill-to-law process), compare table (House vs Senate procedures), quiz cards | nested "idea for a bill" list flattened to the same level |
| `usagov-presidential-election-process` | civics | USA.gov (GSA) | https://www.usa.gov/presidential-election-process | GSA website policies (GSA-1 below) | 1,909 | step ordering/timeline (season-dated election cycle), compare table of cycle stages, quiz cards on dates (next election November 7, 2028; inauguration January 20) | cycle table transcribed as pipe-separated lines incl. caption and header row; link text inside cells flattened into cells |
| `nhgri-pcr-fact-sheet` | biology | National Human Genome Research Institute (NIH), genome.gov | https://www.genome.gov/about-genomics/fact-sheets/Polymerase-Chain-Reaction-Fact-Sheet | NHGRI Copyright Policy (NHGRI-1 below) | 2,050 | step ordering (denature → Taq polymerase synthesis → repeat 30–40×), quiz cards predict-then-reveal on exponential copying (>1 billion copies), concept map of PCR uses | mobile-accordion duplicate of each section removed |
| `nhgri-dna-sequencing-fact-sheet` | biology | National Human Genome Research Institute (NIH), genome.gov | https://www.genome.gov/about-genomics/fact-sheets/DNA-Sequencing-Fact-Sheet | NHGRI Copyright Policy (NHGRI-1 below) | 5,765 | compare table (HGP-era vs now; methods/technologies), quiz cards on the numbers (~3 billion base pairs, 100,000 billion bases/year, under-$1,000 goal), concept map of sequencing applications | served desktop copy runs two paragraphs together ("…few thousand dollars.Many of these new technologies…") — kept exactly as served and noted in the transcription field |

Char counts are `loadSource(...).text.length` (main text only, all within the 1,500–12,000 window).

## Licence evidence (policy pages re-fetched 2026-10-30; quoted lines)

- **NASA-1** — NASA Images and Media Usage Guidelines, https://www.nasa.gov/nasa-brand-center/images-and-media/ (HTTP 200): "NASA content – images, audio, video, and media files … generally are not subject to copyright in the United States." Its SI/AI section (renamed "Super Intelligence (SI) Applications" per the Sept. 29, 2026 Executive Order 14434; conditions unchanged from the "AI applications" section quoted in `data/sources/README.md`): "you can acknowledge your SI tool includes NASA source material, but do not imply any review or permission was granted by NASA"; "All outputs from the SI model should be attributed to the SI product itself, not NASA. References like 'according to NASA' or similar are prohibited"; "NASA strongly encourages SI-generated products maintain a marking indicating the product is SI generated"; "Use of NASA content to train SI models does not constitute endorsement by NASA." The project's existing NASA disclosure/AI-labelling already satisfies these; no new UI line needed for the two NASA pages.
- **GSA-1** — GSA website policies, "Reuse and copyright", https://www.gsa.gov/website-information/website-policies (HTTP 200): "Most material on our site is free of copyright and may be copied and distributed without permission. Works produced by federal government employees in the course of their employment are generally not protected by copyright and are in the public domain in the U.S. Citation of the GSA site and a link back is much appreciated." USA.gov's own footer states it is "An official website of the U.S. General Services Administration", so this policy covers USA.gov pages. Caveat: the same page notes GSA "sometimes use[s] photos or graphics that we licensed or that are restricted" — no such credit appears on the three USA.gov pages stored here and only agency text is stored. No AI/LLM-ingestion clause anywhere on the page.
- **CENSUS-1** — U.S. Census Bureau Data Stewardship policy DS027 "Research Transparency and Public Access", https://www2.census.gov/foia/ds_policies/ds027.pdf (HTTP 200, p. 8): "Data/works created by Census Bureau employees generally are not subject to copyright protection within the United States." Supporting: Census Multimedia Usage Policy, https://www.census.gov/library/multimedia-usage-policy.html (HTTP 200): "U.S. Census Bureau media assets … are free to use in news media and public information products. Media assets may not be used to imply the U.S. Census Bureau's endorsement of a product, service, organization or individual." (we store no media); Census citation policy, https://www.census.gov/about/policies/citation.html, asks for source citation — carried as "Credit: U.S. Census Bureau" in the attribution. No AI/LLM-ingestion clause found on any of the three. The `computing.html` page itself shows no third-party copyright notice; its only embedded third-party-era text is the U.S. Constitution quotation (public domain by age).
- **NHGRI-1** — NHGRI Copyright Policy, https://www.genome.gov/about-nhgri/Policies-Guidance/Copyright (HTTP 200): "Text, graphics, videos, illustrations and other information on National Human Genome Research Institute (NHGRI) websites are in the public domain, unless otherwise indicated. You may freely use and distribute this information; however, we request acknowledgement, such as: 'Courtesy: National Human Genome Research Institute' with a link back to genome.gov." Same page: "Using a graphic, photo or illustration from genome.gov does not explicitly or implicitly convey NHGRI's endorsement of the site where it is used." The two fact sheets carry no contrary credit line (checked: no contractor/grantee author line, no © notice); the "Courtesy: NHGRI" acknowledgement is carried in each attribution. No AI/LLM-ingestion clause. (This closes the README's "Unverified before use: NHGRI/NIH pages" flag for genome.gov fact sheets.)

This resolves the README's previously-unverified NHGRI entry; the lead may want to move NHGRI into the verified agency list in `data/sources/README.md` and add licence-basis lines for GSA/USA.gov and Census there (I did not touch the README — slice N creates only the new source files and this note).

## UI disclosure lines

`apps/web/src/lib/sources.ts` derives the disclosure publisher from the attribution's "Source material: <publisher>," prefix, and all eight attributions follow that convention, so the existing generic line already renders correctly (e.g. "AI-generated with Muse Spark 1.3 (Meta). Includes material from U.S. Census Bureau; U.S. Census Bureau has not reviewed or endorsed this lesson."). **No code change is required.** If the lead nonetheless wants publisher-specific lines for the new agencies, suggested exact texts:

- USA.gov/GSA: "Includes material from USA.gov, an official website of the U.S. General Services Administration. GSA has not reviewed, approved or endorsed this activity."
- Census: "Includes material from the U.S. Census Bureau. Credit: U.S. Census Bureau. The U.S. Census Bureau has not reviewed, approved or endorsed this activity."
- NHGRI: "Includes material from the National Human Genome Research Institute (genome.gov). Courtesy: National Human Genome Research Institute. NHGRI has not reviewed, approved or endorsed this activity."

## Rejected candidates (with reasons)

| Candidate | Reason |
|---|---|
| Ben's Guide to U.S. Government, "How Laws Are Made" (benguide.gov) | Unreachable from this host: DNS resolution failed for both Node fetch and curl ("Could not resolve host"); the page extractor also refused it. The GPO mirror https://www.govinfo.gov/benguide/how-laws-are-made serves a JS app shell whose HTML contains none of the article text, so neither content nor licence could be verified. |
| Congress.gov "How Our Laws Are Made" and /legal | HTTP 403 (bot protection) on both; could not read the page or its terms. |
| House.gov "The Legislative Process" | Reachable, and its terms of use are clean (https://www.house.gov/terms-of-use: "Pursuant to federal law, government-produced materials appearing on this site are not copyright protected."), but the main text is only ~1,042 chars — below the 1,500-char floor. |
| genome.gov Talking Glossary entries (Mendelian-Inheritance, Meiosis, Mitosis) | Public domain per NHGRI-1 and excellent process/ratio topics, but each entry is ~1.3–1.6k chars including the spoken "Narration" transcript — below the floor. |
| NHGRI Cloning Fact Sheet | Main text 28,835 chars — above the 12,000-char ceiling. |
| NHGRI "A Brief Guide to Genomics" | ~16,050 chars main text — above the ceiling. |
| USA.gov /vote and /election | Hub pages (~1.1–1.2k chars) — below the floor; used their deeper subpages instead. |
| NASA old k-12 maths pages (slope.html, interp.html, rearrange.html, orderop.html, scinot.html, logdef.html, solvequa.html under /www/k-12/airplane/) | All 404; the current Beginner's Guide site map no longer lists them. |
| NASA GRC "Angle of Attack" (incline), "Mass Ratios", "Relative Velocity", "Lift to Drag Ratio" | Live and licence-clean, but physics-flavoured — the lead would curate them as physics, which is not a thin subject; skipped in favour of the two clearly-maths pages plus Census. |
| CDC as a biology publisher | Reuse policy verified (https://www.cdc.gov/other/agencymaterials.html: "Most of the information on the CDC and ATSDR websites is not subject to copyright, is in the public domain, and may be freely used or reproduced without obtaining copyright permission", with attribution + no-endorsement conditions; the old /other/reuse.html is 404), but the two NHGRI biology pages filled the slot first. Kept as the next biology publisher if the lead wants a third. |
| OpenStax (any subject) | Already project-rejected: licence bans AI/LLM ingestion. |

## Hash verification (loadSource is hash-checked)

`node -e "import('file:///C:/projects/meta-hackathon/packages/sources/index.ts').then(m=>{for(const id of process.argv.slice(1)) {const d=m.loadSource(id); console.log('ok',id,'| subject:',m.sourceSubject(m.loadSourceMeta(id)),'| chars:',d.text.length)}})" <ids>` run from the repo root, 2026-10-30:

```text
ok nasa-grc-sine-cosine-tangent | subject: maths | chars: 6401
ok nasa-grc-idea-of-functions | subject: maths | chars: 4170
ok census-computing-apportionment | subject: maths | chars: 3365
ok usagov-branches-of-government | subject: civics | chars: 2612
ok usagov-how-laws-are-made | subject: civics | chars: 2223
ok usagov-presidential-election-process | subject: civics | chars: 1909
ok nhgri-pcr-fact-sheet | subject: biology | chars: 2050
ok nhgri-dna-sequencing-fact-sheet | subject: biology | chars: 5765
```

Independent sha256 recomputation (`node -e …createHash('sha256')…`) matched every `sha256` field before the JSON files were written. Fidelity spot-check: every 8-word window of every stored line was matched against the live page text (tags stripped, entities decoded, LaTeX and image alt text converted identically); the only misses were whitespace artifacts at tag boundaries in the checker itself (e.g. "trigonometry , the" vs the page's non-breaking-space rendering), which were each confirmed against the raw HTML.

## Retrieval details

- All eight pages fetched 2026-10-30 between 03:44Z and 04:00Z with Node fetch (desktop UA), HTTP 200 each; `retrievedAt` per JSON is the actual fetch minute.
- Transcription conventions copied from the existing pairs (H1 title line; headings as plain lines; paragraphs one per line; lists flattened one item per line with `•`/`1.` markers; tables as pipe-separated lines; inline links flattened to their text; curly/straight quote mix and source typos kept as printed; whitespace normalised; LF endings; single trailing newline).
- Scratch artifacts (fetched HTML, extractor scripts, drafts, fidelity checker): the lead's local scratch folder (not committed).
