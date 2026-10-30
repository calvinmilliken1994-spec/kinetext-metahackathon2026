# Stage 7b — source library grouped by subject + thin subjects filled (frozen 2026-10-30, lead: Claude Opus 5.5)

Calvin approved: group the source library by subject and add a few licensed pages to the thin subjects.

## Frozen field
- Library source metadata (`data/sources/<id>.json`) gains `"subject": <Subject>`, where `Subject` is `SUBJECTS` from `packages/contracts/kit.ts` (`physics | maths | history | finance | chemistry | biology | earth-science | civics | language-reading | other`). Curated by us, one per page, stable; the source `.txt` bytes and `sha256` never change.
- `SourceMeta` (`packages/sources/index.ts`) gets `subject?: Subject` (optional so a page without one still loads; the UI shows it under "Other / unsorted"). `GET /api/sources` returns it.
- Teacher-pasted (`user-…`) sources have no curated subject; the UI may show the subject from the latest Muse page analysis of that source, labelled "detected by Muse".
- The pre-registered evaluation set (`data/evaluation/manifest.json`) does not change.

## Ownership (parallel)
| Slice | Model | Owns |
|---|---|---|
| S library grouping | Claude Opus 5.5 | `packages/sources/index.ts` (+ tests), `apps/api` sources endpoint (+ tests), `apps/web` (source picker grouped by subject, subject chips with counts, subject on lesson and runs list, filter in runs list; CSS in `styles/shell.css`), the `subject` field in the EXISTING 41 `data/sources/*.json` |
| N new pages | Qwen 3.8 Max | NEW `data/sources/<id>.{json,txt}` only, with the `subject` field; a summary table in `docs/evidence/stage-7/new-sources.md` |

New-page rules: public-domain or openly licensed for AI ingestion (read the page's own licence/terms incl. any AI/LLM clause; US federal works preferred), exact transcription of the main text, sha256 of the stored text, attribution that implies no endorsement, numerical/structured teaching content that our components can use (formula, worked example, dates, comparable categories, a process). Targets: maths 3, civics 2–3, biology 1–2. If a new publisher needs its own disclosure line in `apps/web/src/lib/sources.ts`, the N slice reports the text and the lead adds it.
