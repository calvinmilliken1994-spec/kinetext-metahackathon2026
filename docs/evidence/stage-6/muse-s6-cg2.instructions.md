# Task S6-CG-2: compare-table prompts for the code-built grid (prompt version s6-v3)

Frozen design:

# Stage 6 — compare-table grid built by code (step 1, frozen 2026-10-30)

**Why:** in the Spark Open re-run (`docs/evidence/stage-6/evaluation-lesson-open-v2/`) compare tables published 0/5. Two failure classes:
- wrong cell counts (CT-03): the flat `cells[]` list with `entityIndex`/`attributeIndex` let the model skip or duplicate pairs (4 cells for a 4×4 table; pair (1,0) twice);
- id-like names (CT-02): entities written as `this-equation`, `constant-pressure-process`, `starting-at-age-14`, which never occur on the page.

**Decision (Calvin, 2026-10-30):** our code builds the grid; Muse only names rows and columns and gives one value + quote per row × column slot; stricter page-wording rule for names.

## Frozen gen shape (`compare-table-v1`, what Muse writes)
```ts
interface CompareTableGen {
  schemaVersion: 'compare-table-v1';
  title: string;
  attributes: string[];          // column names, 2..5 (KIT_LIMITS.compare.attributes)
  rows: CompareRowGen[];         // 2..4 (KIT_LIMITS.compare.entities)
}
interface CompareRowGen {
  entity: string;                // row name, words as the page writes them
  values: CompareValueGen[];     // exactly one per attribute, in attribute order
}
interface CompareValueGen {
  value: string;                 // 1..80 chars (KIT_LIMITS.compare.value), occurs in quote
  sourceId: string;
  quote: string;                 // verbatim, <= KIT_LIMITS.common.quote.max
}
```
No cell ids, no indexes: the model cannot write a wrong index or a duplicate pair.

## Spec shape — UNCHANGED
`CompareTableSpec` keeps `entities: string[]`, `attributes: string[]`, `cells: CompareCellGen[]` (`id`, `entityIndex`, `attributeIndex`, `value`, `sourceId`, `quote`), so the web view, stored lessons and the UI are untouched.

## Code builds the grid
- New pure export in `packages/contracts/kit.ts`: `compareGridFromRows(gen): { entities: string[]; cells: CompareCellGen[] }` — `entities[i] = rows[i].entity`; for every row i and attribute j **that has a value**, `cells.push({ id: 'cell-' + i + '-' + j, entityIndex: i, attributeIndex: j, value, sourceId, quote })`. It never invents, pads or drops content.
- `assembleKitSpec` for `compare-table-v1` uses it (`entities`, `attributes`, `cells` in the spec are built by code). `KIT_GEN_BODY_KEYS['compare-table-v1']` becomes `['attributes', 'rows']` for the gen; the spec body is built by the special case.
- A row whose `values.length !== attributes.length` fails CT-03 with a precise message (`rows[2] has 3 values; it needs one per column (4)`), `affected: /rows/2/values`. The JSON schema already guides the structure; the check makes a miss repairable instead of silently padded.

## Stricter page wording for names (no new check id)
- `schema.gen` structural problems add: an entity or attribute name that looks like an id — matches `^[a-z0-9]+(-[a-z0-9]+)+$` (kebab-case) or contains `_` with no space — fails with `"rows[0].entity \"constant-pressure-process\" looks like an id; use the words the page uses"`, `affected: /rows/0/entity` (or `/attributes/j`).
- CT-02 stays: each value occurs in its quote; the entity name occurs in the quote or the same paragraph. Affected paths become `/rows/i/values/j/{value|quote|sourceId}` and `/rows/i/entity`.

## Who changes what
| Part | Owner | Files |
|---|---|---|
| Contracts + gen schema + fixtures | Muse (bridge, lead-verified byte-for-byte) | `packages/contracts/kit.ts`, `scripts/build-schemas.ts`, `tests/fixtures/stage6/compare-table.gen.json`, `tests/contracts.stage6.test.ts`; lead regenerates `schemas/*.gen.json` with the script |
| Prompts (generation + repair guidance) | Muse (bridge) | `packages/meta/prompts-v2.ts`, `packages/meta/prompts-v2.test.ts` |
| Validator CT-01..05 on the new shape, affected paths, id-like names, golden fixtures, prune/compare helpers if any | Qwen 3.8 Max subagent | `packages/validation/**` (compare.ts, shared fixtures, tests), plus web fixtures that hold compare **gen** objects only if typecheck requires |


Change `packages/meta/prompts-v2.ts`:
1. `STAGE6_PROMPT_VERSION` 's6-v2' -> 's6-v3'.
2. Rewrite the `compare-table-v1` entry of `KIT_COMPONENT_GUIDANCE` for the new gen shape: write `attributes` (column names) and `rows`; each row has `entity` and `values` with exactly one value per attribute in attribute order; there are no cell ids and no indexes — the system builds the grid. Keep the existing small-table preference (2 or 3 entities and 2 or 3 attributes), the limits interpolated from KIT_LIMITS.compare (entities count is the rows count), value length, value appears in its quote, entity name appears in the quote or the same paragraph, quote limit, no formulas / 'A > B' / JSON field names in names or values, compact JSON sentence. Add the page-wording rule: row and column names are written with the words the page uses (for example 'Troposphere', not 'troposphere-zone' or 'this-equation'); never kebab-case or ids.
3. If any other text in the file mentions compare-table `cells`, `entityIndex` or `attributeIndex` for generation or repair, update it to the new shape. Keep everything else byte-identical.
Change `packages/meta/prompts-v2.test.ts`: version 's6-v3'; tests that the compare guidance mentions rows/values/one value per column in attribute order, has no 'entityIndex', and includes the page-wording rule with the kebab-case example.
Return ONLY the two complete files.
