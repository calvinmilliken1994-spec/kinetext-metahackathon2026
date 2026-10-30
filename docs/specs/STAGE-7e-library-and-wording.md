# Stage 7e — balanced library, computing subject, sequence names, leftovers (frozen 2026-10-31, lead: Claude Opus 5.5)

Calvin's decisions (2026-10-31): (1) sequence step names = option (a); (2) 5 featured physics pages, 10–13 pages per subject, retire the least impressive physics pages, add a computing / AI-ML subject; (3) live runs of new pages later, after more pages exist; (4) fix the small leftovers and sweep for others. Subject-engine building (chemistry, physics, biology, maths, computing) comes after the page research, which must record page styles our components do not yet serve.

## Frozen data fields (library source metadata)
- `subject` gains the value `computing` (computing, algorithms, data, AI and machine learning). `SUBJECTS` in `packages/contracts/kit.ts` adds it; the analysis prompt gets a `computing` subject-guidance row.
- `"featured": true` — shown first in the picker for its subject (physics: exactly 5).
- `"retired": true` — hidden from the library list (`GET /api/sources`) and the picker; still loadable by id, so stored runs and evidence keep working. Never delete a library file.
- Physics after this stage: 13 active, 6 retired. Retired (superseded by better pages, or off-subject): `nasa-grc-re-living-the-wright-way`, `nasa-grc-lift-equation-of-the-1900s`, `nasa-grc-flight-equations-with-drag`, `nasa-grc-equations-of-motion`, `nasa-grc-ballistic-flight-equations`, `nrc-unit-1-radiation`. Featured: `nasa-grc-drag-equation`, `nasa-grc-newtons-laws-of-motion`, `nasa-grc-glider-trajectory-problem`, `nasa-grc-bernoullis-equation`, `nasa-grc-motion-of-free-falling-object`.

## Sequence step names (option a)
The sequence check `labels-in-quotes` is retired: a step label is Muse's own short event name (≤ 8 words). Each step keeps its verbatim quote as evidence; the numbers rule, publisher/plain-text sweep, distinct-labels and length checks still apply to labels. The prompt states the label is a short event name and the quote is the evidence.

## Ownership
| Slice | Model | Owns |
|---|---|---|
| W web + API leftovers | Claude Opus 5.5 | `apps/web/**`, `apps/api` sources endpoint, `packages/sources/index.ts` (+tests), the `featured`/`retired` keys in existing physics `data/sources/*.json` |
| V sequence validator | Qwen 3.8 Max | `packages/validation/kit/sequence.ts` + tests |
| M contracts + prompts | Muse Spark 1.3 via bridge (lead) | `packages/contracts/kit.ts` (SUBJECTS), `packages/meta/prompts-v2.ts` (+tests); lead regenerates schemas |
| R1 research | Qwen 3.8 Max | NEW `data/sources/` pages: computing/AI-ML 10–13, maths to 10–13 |
| R2 research | Qwen 3.8 Max | NEW pages: chemistry, biology, earth-science to 10–13 each |
| R3 research (later) | Qwen 3.8 Max | NEW pages: finance, civics, history to 10–13 each |
