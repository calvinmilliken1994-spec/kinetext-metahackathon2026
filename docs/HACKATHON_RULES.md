# Hackathon rules — verified against the official participant guide

## Authority
Canonical source: the Cerebral Valley participant guide (login-gated "Event Details" page), copied by Calvin and received 2026-10-27 06:02 KST. Private copy: `docs/official/PARTICIPANT_GUIDE.md` (gitignored by user decision). Section numbers below cite that guide (§n). Event page: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details. The user addendum and master prompt are project requirements, not contest rules. (History: before 2026-10-27 06:02 KST the guide was unrecovered — fetches hit a login wall.)

## Requirements that constrain this project
| Topic | Official rule | Project consequence |
|---|---|---|
| Problem statement (§1) | Build toward **Build for Your World** or **Push the Frontier**; must incorporate Meta models | Target "Build for Your World" (teachers/learners turning sources into verified interactive activities). Meta is the core intelligence layer, not decoration |
| Building window (§3) | Building period Oct 27 – Nov 4 (ET). Kickoff Mon Oct 26 12:00 ET = Oct 27 01:00 KST | See provenance note below |
| Deadline (§3, §7) | Submissions due **Wed Nov 4, 9:00 PM ET = Thu Nov 5, 11:00 KST** via CV platform. Nov 3 is the last full day for troubleshooting questions. Late submissions not considered | Freeze features well before; submission package is Stage 9 |
| Open source (§4) | Repositories must be public | Public at submission; user controls visibility timing |
| New work only (§4) | Demo must show only features built during the hackathon; judges must clearly identify what was created during the event, or disqualification | Keep `PROVENANCE.md` and the Git log precise; README must separate setup scaffold from event-built product work |
| Rights (§4) | Disqualified for code, data or assets without rights | Licensed sources only; record licenses per source and dependency |
| Anti-projects (§4) | Includes basic RAG apps, simple image analyzers, **simple "AI for Education" chatbots**, medical advice | The product must not read as an education chatbot: emphasis on executable, verified interactive artifacts, not chat |
| Team (§4) | Max 4; solo allowed | **Solo, Indie Developer track** (confirmed by Calvin 2026-10-27) |
| Deliverables (§7) | Public repo, **3-minute demo video**, live product; list everyone who worked on it | Stage 9 checklist |
| Credits (§5) | $150 Meta Model API credits, claim by Nov 4 9 PM ET; card required; optional Spend Limit notification | Claimed and applied (see `RESOURCE_POLICY.md`) |
| Baseten (§6) | Use `meta-models/muse-spark-open-1026` (not the docs' unsuffixed ID) | Exact ID confirmed by guide; access/credits still unverified |

## Judging (§8)
Stage 1 pass/fail: fits a theme and reasonably used Meta Model API and/or open-weight models during the hackathon. Stage 2 weighted 0–10: **Impact 30%**, **Use of Meta AI Tooling 25%** (creative, beyond basic integration), **Technical Depth & Execution 20%**, **Demo 25%** (working, holds up live, video worth watching). Stage 3: top 5 per track ranked live on the same rubric.

## Bonus prizes relevant to scope (§9)
- Best Agentic Use-Case ($5K): autonomy, effectiveness, practical usefulness — aligns with the Stage 5 verify-and-repair loop.
- Best Build on Meta Open Weight Models ($10K): Muse Glimmer or Muse Spark Open on own hardware or partner inference; partner verifies. Stage 7 option only if a real eligible runtime path exists.
- Best Creative Build ($5K): Muse Image or Muse Wonder. Wonder is excluded by user directive; Muse Image only for labeled illustrations, never scientific diagrams.
- Most Viral (X engagement) and Community Vote: post-submission, user's call.

## Working project constraints (user requirements, not official rules)
Meta-first core, permanent tagline, physics-first real interactive application, actual tests and repair evidence, public-repo provenance, licensed samples, no fabricated measurements. See `PROFILE_ADDENDUM.md` and `MASTER_PROMPT.md`.

## Provenance note
Setup commits `23ae633` and `b5f25da` were made 2026-10-27 05:44–05:47 KST (= Oct 26 ~16:45 ET): after kickoff, before the stated Oct 27 building-period start. They contain setup documentation, a draft schema, tests and a smoke probe — no product functionality. Treat them as setup scaffold and say so in the README and demo. All product features are built from 2026-10-27 onward.

## Demo video guidance (organizers on Discord, relayed by Calvin 2026-11-03)
Not in the guide; organizer answers in the event Discord, as Calvin copied them.
- AI tools are allowed for editing, voiceover and visuals. An English AI voiceover is acceptable, but organizers prefer a video made and presented by a person.
- AI visuals are extras: most of the video must be real screen footage of the working product, with **live Meta model calls visible**.
- No required structure. Suggested: open with one line on what existed before the event and what was built during it; show the working end-to-end flow with live Meta model calls; briefly show where and how Meta's models are used (Use of Meta AI Tooling = 25%).
- **3:00 at most, in English.**
- **No slides** (the video may show only features built during the event). Mockups and pre-recorded scenarios are fine if labeled and the core working product is shown; say clearly which parts are simulated and show real interactions wherever possible.

Project consequences: the recorded-run Demo stays labeled "Replay of a recorded run" and cannot carry the video alone; at least one real live build (Muse Spark + SAM 3.1 calls, with their run details) must be on screen, and any sped-up footage is labeled. Opening line per the provenance note: setup scaffold `23ae633`/`b5f25da` only (docs, draft schema, smoke probe, no product), everything shown built Oct 27 to Nov 4.
