# Stage 8a: four new subject engines (frozen 2026-10-31, lead: Claude Opus 5.5)

Calvin's decision (2026-10-31): build every engine proposed from the research page-style notes, fix the presentation sequence "Check order" movement, and make the Drag explorer slide fit at 1366×768 without scrolling. Label the diagram (SAM 3.1) is Stage 8b (`STAGE-8-photo-and-diagrams.md`) and starts when this wave lands.

Product split (unchanged): Muse writes **data** grounded in page quotes, our tested code **computes**, and the checks tie every value to the page. Muse never writes code, and no engine runs model text.

## 1. New kit components (gen = what Muse writes; spec = gen body + system fields, as for the existing kit)

All four are added to `KIT_COMPONENT_IDS`, `KIT_GEN_COMPONENT_IDS`, `KIT_GEN_SCHEMA_FILES`, `KIT_GEN_BODY_KEYS`, `KitGenByComponent`, `KitSpecByComponent`, `KitSpec`, `CHECK_PREFIX_BY_COMPONENT` and `STAGE6_CHECKS`. `KIT_SCHEMA_VERSION` stays `0.6.0`: existing shapes are unchanged, and stored lessons must keep validating. In every gen schema every key is required, and "absent" is a sentinel (constrained decoding).

### 1a. `algorithm-trace-v1`: computing (prefix `ALG`)
```ts
export const ALGORITHM_IDS = ['binary-search', 'linear-search', 'bubble-sort', 'insertion-sort', 'selection-sort', 'merge-sort', 'quicksort'] as const;
export type AlgorithmId = typeof ALGORITHM_IDS[number];
export const SEARCH_ALGORITHM_IDS = ['binary-search', 'linear-search'] as const;
export const ALGORITHM_CLAIM_KINDS = ['running-time', 'property'] as const;
export interface AlgorithmTraceGen {
  schemaVersion: 'algorithm-trace-v1';
  title: string;
  algorithm: AlgorithmId;
  algorithmName: string;      // the page's own name for it, e.g. "binary search"
  sourceId: string;
  quote: string;              // verbatim; names and/or describes the algorithm
  input: number[];            // 4..10 integers in 0..99 (a search needs ascending distinct values)
  hasTarget: boolean;         // true exactly for search algorithms
  target: number;             // integer 0..99; 0 when hasTarget is false
  claims: AlgorithmClaimGen[];// 0..3 page-stated facts, e.g. running time
}
export interface AlgorithmClaimGen { id: string; kind: 'running-time' | 'property'; text: string; sourceId: string; quote: string; }
```
Limits: `KIT_LIMITS.algorithm = { input: {min:4,max:10}, value: {min:0,max:99}, claims: {min:0,max:3}, claimText: {min:1,max:80}, name: {min:1,max:60}, maxFrames: 400 }`.
Checks:
- `ALG-01 quotes-verbatim`
- `ALG-02 algorithm-named-in-quote`: `algorithmName` is a whole phrase in the quote and matches the id's name pattern, e.g. binary-search ↔ "binary search"
- `ALG-03 input-valid`: count, integer range, search ⇒ ascending and distinct, `hasTarget` ⇔ search, `target` = 0 when there is no target
- `ALG-04 trace-runs`: our engine finishes within `maxFrames`, and the result is correct (sorted ascending, or found index / not-found correct)
- `ALG-05 claims-in-quote`: the claim text is in its quote, compared after whitespace normalisation
- `ALG-06 numbers-checkable`: the shared N-01 rule over the title, the name and the claim text
- `ALG-07 counts-valid`

### 1b. `log-ladder-v1`: chemistry, earth & space (prefix `LOG`)
```ts
export interface LogLadderGen {
  schemaVersion: 'log-ladder-v1';
  title: string;
  quantity: string;        // the scale's name as the page writes it, e.g. "pH", "magnitude"
  factor: number;          // per whole step, > 1 and <= 1000, e.g. 10 or 32
  factorText: string;      // the page's words for the factor, e.g. "ten times", "32 times", "tenfold"
  effectPhrase: string;    // what multiplies, in the page's words, e.g. "more acidic", "more energy release"
  increasing: boolean;     // true if a higher scale value means more of the effect (magnitude); false for pH
  sourceId: string;
  quote: string;           // verbatim; contains factorText and quantity
  rungs: LogRungGen[];     // 2..8 page-stated points on the scale
  cases: LogCaseGen[];     // 1..3 predict-the-ratio cases
}
export interface LogRungGen { id: string; label: string; value: number; sourceId: string; quote: string; }
export interface LogCaseGen { id: string; fromValue: number; toValue: number; }
```
Limits: `KIT_LIMITS.logLadder = { rungs: {min:2,max:8}, cases: {min:1,max:3}, factor: {min:1.000001,max:1000}, label: {min:1,max:60}, maxRatio: 1e12 }`.
Checks:
- `LOG-01 quotes-verbatim`
- `LOG-02 factor-stated`: `factorText` is in the quote and states `factor`: digits, number words (ten, hundred, thousand), "N times" or "N-fold"/"tenfold"
- `LOG-03 quantity-in-quote`
- `LOG-04 rung-values-in-quote`: each rung `value` is a whole numeric token in its quote
- `LOG-05 rungs-distinct`: distinct values
- `LOG-06 cases-valid`: `fromValue` ≠ `toValue`, both inside [min rung, max rung], and the ratio ≤ `maxRatio`
- `LOG-07 numbers-checkable`

### 1c. `threshold-v1`: civics, "Does it pass?" (prefix `TH`)
```ts
export const THRESHOLD_RULES = ['majority', 'fraction', 'count'] as const;
export interface ThresholdGen {
  schemaVersion: 'threshold-v1';
  title: string;
  stages: ThresholdStageGen[];       // 1..3, all must pass
  scenarios: ThresholdScenarioGen[]; // 1..3 "try it" vote counts (engine inputs, not page claims)
}
export interface ThresholdStageGen {
  id: string;
  body: string;            // who votes, in the page's words, e.g. "States"
  total: number;           // integer 1..100000, page-stated
  rule: 'majority' | 'fraction' | 'count';
  numerator: number;       // fraction only, else 0
  denominator: number;     // fraction only, else 0
  statedCount: number;     // page-stated required count, 0 if the page states none (required for rule 'count')
  sourceId: string;
  quote: string;           // verbatim; states the rule words and/or statedCount
  totalQuote: string;      // verbatim; contains total (may equal quote)
}
export interface ThresholdScenarioGen { id: string; label: string; yes: number[]; } // one per stage
```
Limits: `KIT_LIMITS.threshold = { stages: {min:1,max:3}, scenarios: {min:1,max:3}, total: {min:1,max:100000}, body: {min:1,max:60}, label: {min:1,max:80} }`.
Required count (engine):
- majority: ⌊total/2⌋+1
- fraction: ⌈total·n/d⌉
- count: statedCount

Checks:
- `TH-01 quotes-verbatim`
- `TH-02 total-in-quote`
- `TH-03 rule-in-quote`: majority ⇒ "majority" in the quote; fraction ⇒ fraction words in the quote ("two-thirds", "three-fourths", "three-quarters", "half", or "n/d") equal to n/d; count ⇒ `statedCount` is a whole token in the quote
- `TH-04 stated-count-consistent`: `statedCount` > 0 and the rule is not count ⇒ the engine's required count equals `statedCount` (270 = majority of 538; 38 = ¾ of 50)
- `TH-05 scenarios-valid`: one integer per stage in [0, total]; scenarios distinct
- `TH-06 numbers-checkable`: title, body and labels
- `TH-07 counts-valid`

### 1d. `data-table-v1`: maths, finance, earth & space, civics (prefix `DT`)
```ts
export const DATA_TABLE_QUESTION_KINDS = ['lookup', 'largest', 'smallest'] as const;
export interface DataTableGen {
  schemaVersion: 'data-table-v1';
  title: string;
  labelHeader: string;           // header for the row-label column, e.g. "Planet"
  columns: DataColumnGen[];      // 2..6 value columns
  rows: DataRowGen[];            // 3..12
  questions: DataQuestionGen[];  // 1..4, answers computed by our code
  chartColumnIndex: number;      // numeric column to chart, -1 = no chart
  brackets: DataBracketsGen;     // progressive-rate calculator (tax brackets); enabled false otherwise
}
export interface DataColumnGen { header: string; unit: string; numeric: boolean; sourceId: string; quote: string; }
export interface DataRowGen { label: string; sourceId: string; quote: string; values: DataCellGen[]; } // one value per column
export interface DataCellGen { value: string; sourceId: string; quote: string; }
export interface DataQuestionGen { id: string; kind: 'lookup' | 'largest' | 'smallest'; rowIndex: number; columnIndex: number; } // rowIndex -1 unless lookup
export interface DataBracketsGen { enabled: boolean; rateColumnIndex: number; overColumnIndex: number; exampleIncome: number; } // -1/-1/0 when disabled
```
Limits: `KIT_LIMITS.dataTable = { columns: {min:2,max:6}, rows: {min:3,max:12}, questions: {min:1,max:4}, header: {min:1,max:40}, unit: {min:0,max:20}, label: {min:1,max:60}, value: {min:1,max:40} }`.
Checks:
- `DT-01 quotes-verbatim`
- `DT-02 headers-and-labels-in-quote`
- `DT-03 values-in-quote`: each value is a whole token in its quote
- `DT-04 shape-valid`: one value per column, numeric columns parse with `parseTableNumber`, distinct row labels
- `DT-05 questions-valid`: valid indices; largest/smallest only on numeric columns with a unique answer
- `DT-06 chart-valid`
- `DT-07 brackets-valid`: when enabled, rate and threshold columns are numeric, thresholds strictly ascending from the first row, rates ascending in [0,100], and `exampleIncome` > 0
- `DT-08 numbers-checkable`

New Stage 6 check count: 63 + 7 + 7 + 7 + 8 = **92**.

## 2. Engines: `packages/kit-engines/` (pure, browser-safe, no `node:*`, imported by validation and web)
```ts
// algorithms.ts
export type AlgoOp = 'start' | 'compare' | 'swap' | 'write' | 'split' | 'merge' | 'pivot' | 'narrow' | 'found' | 'not-found' | 'done';
export interface AlgoFrame { array: number[]; op: AlgoOp; indices: number[]; range: [number, number] | null; note: string; comparisons: number; moves: number; }
export interface AlgoTrace { frames: AlgoFrame[]; truncated: boolean; sorted: number[] | null; foundIndex: number | null; }
export function traceAlgorithm(id: AlgorithmId, input: readonly number[], target: number | null, maxFrames?: number): AlgoTrace;
export function algorithmNamePattern(id: AlgorithmId): RegExp;
// logLadder.ts
export function ladderRatio(factor: number, fromValue: number, toValue: number): number;               // factor ** |to - from|
export function ladderDirection(increasing: boolean, fromValue: number, toValue: number): 'more' | 'less';
// threshold.ts
export function requiredCount(stage: Pick<ThresholdStageGen, 'total' | 'rule' | 'numerator' | 'denominator' | 'statedCount'>): number;
export function stagePasses(stage: ..., yes: number): boolean;
export function fractionWords(n: number, d: number): string[];                                         // e.g. 2/3 -> ['two-thirds', 'two thirds', '2/3']
// table.ts
export function parseTableNumber(text: string): number | null;                                           // "12,104", "$640,600", "37%", "-0.5", "−1.2", "1.4"
export function answerQuestion(gen: DataTableGen, q: DataQuestionGen): { rowIndex: number; value: string } | null;
export function progressiveTax(brackets: { rate: number; over: number }[], income: number): { total: number; parts: { rate: number; from: number; to: number; tax: number }[] };
```
Quicksort uses the last element as its pivot (Lomuto), and merge sort is top-down. The view says "our tracer shows one standard version" when the page does not fix the variant. Every note string is plain teacher English written by our code, never by the model.

## 3. Ownership (wave 1: after the Muse calls land and the lead commits the frozen contracts)
| Slice | Model | Owns |
|---|---|---|
| M1 contracts | Muse Spark 1.3 (bridge) | `packages/contracts/kit.ts`, `scripts/build-schemas.ts`, `schemas/*.gen.json` (generated), `tests/contracts.stage6.test.ts`, `tests/fixtures/stage6/{algorithm-trace,log-ladder,threshold,data-table}.gen.json` + synthetic sources |
| M2 engines | Muse Spark 1.3 (bridge) | `packages/kit-engines/**` |
| M3 prompts | Muse Spark 1.3 (bridge) | `packages/meta/prompts-v2.ts` (+ test): component design text, the "when" rows, subject guidance, repair names, version s6-v7 |
| Lead wiring | Claude Opus 5.5 | dispatch stubs in `packages/validation/kit/{index,policy}.ts`, `apps/web` dispatch (`LessonView`, `Beats`, `lib/lesson.ts`, `lib/presentation.ts`), per-slice CSS files |
| V-A validators | Qwen 3.8 Max | `packages/validation/kit/{algorithm,log-ladder}.ts` + tests |
| V-B validators | Qwen 3.8 Max | `packages/validation/kit/{threshold,data-table}.ts` + tests |
| W-A views | Claude Opus 5.5 | `components/{AlgorithmTraceView,LogLadderView}.tsx`, `components/presentation/beats/{algorithm,logLadder}.tsx`, `lib/{algorithmView,logLadderView}.ts` (+tests), `styles/engines-a.css` |
| W-B views + fixes | Claude Opus 5.5 | `components/{ThresholdView,DataTableView}.tsx`, `components/presentation/beats/{threshold,dataTable}.tsx`, `lib/{thresholdView,dataTableView}.ts` (+tests), `styles/engines-b.css`; plus the sequence "Check order" layout in presentation (`SequenceView`/`OrderBoard` presentation path) and the Drag explorer fit at 1366×768 |

Wave 2 is Stage 8b, Label the diagram with SAM 3.1, in its own spec.
