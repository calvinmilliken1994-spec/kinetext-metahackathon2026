# Task: Stage 6 prompt tuning after the open-weights comparison (s6-v2)

Live evidence (2026-10-29, 29 pages, lesson flow; docs/evidence/stage-6/evaluation-lesson-open/README.md): Muse Spark Open planned 77 parts and lost 16; Spark 1.3 planned 67 and lost 4. Failure classes:
- compare-table-v1 and concept-map-v1 calls hit the 24,000-token output cap (6 parts) with only 7-12k tokens of reasoning, i.e. 12-17k tokens of visible output for a component that normally needs 2-3k: runaway/oversized JSON.
- formula-explorer-v1 wrote the whole equation as `expression` (`v = a * t`, `t = 59 - .00356 * h`), once rewrote the page formula into a different one (`cp - (cv + r)` for the printed `cv + R`), once left `title` empty; repairs did not fix it.
- compare-table-v1 cells held composed text not on the page ("Lift > Weight = Aircraft Rises") and even a JSON field name ("id") as an entity name.
- concept-map-v1 used the same label at both ends of links.
- Spark Open planned 3 parts on 23 of 27 pages (Spark 1.3: 11 of 28); the extra parts are the ones that fail most.

Change `packages/meta/prompts-v2.ts` (prompt text only; contracts, limits and schemas are frozen and unchanged):
1. `STAGE6_PROMPT_VERSION` 's6-v1' -> 's6-v2'.
2. Analysis plan rules: plan TWO components by default (a premium plus one kit component, or two kit components). Plan a third kit component only when the source text is long (more than about 5,000 characters) AND the third covers a clearly different part of the page. Keep every existing plan rule.
3. compare-table-v1 guidance: keep the table small — prefer 2 or 3 entities and 2 or 3 attributes (at most 9 cells) even though more are allowed; every value is a short phrase copied verbatim from its quote; entity and attribute names are short labels written as the page writes them; never put formulas, comparisons such as 'A > B', JSON field names or ids into names or values.
4. concept-map-v1 guidance: stay near the minimum allowed node and link counts; every node label is distinct; a link joins two different nodes.
5. formula-explorer-v1 guidance: `expression` is the right-hand side only — never include the result name or '='; for the printed formula `v = a * t` write `a * t`. Transcribe the page formula itself; never substitute, rearrange or combine it into a different formula. `title` is a short non-empty title.
6. In every kit component instruction (generation AND repair), add one sentence: write compact JSON with no extra whitespace or repeated content, and stop after the final closing brace.
Keep all other text byte-identical.

Change `packages/meta/prompts-v2.test.ts`: version assertion -> 's6-v2'; add tests that the built messages contain each new rule (plan default two, compare-table small-table and no-formulas rule, concept-map distinct labels, formula right-hand-side rule with the `v = a * t` example, compact-JSON sentence in both a generation and a repair message for a kit component).

Return ONLY the two complete files.
