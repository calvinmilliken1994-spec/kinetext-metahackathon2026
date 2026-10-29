# Generation worker (TASK-005)

`jobs.ts` is the bounded stage machine that turns a licensed source into a validated
activity spec. It is the only writer of `storage/runs/<jobId>/`.

## API

```ts
startJob(sourceId, deps, onEvent?) → { jobId, done: Promise<JobSummary> }
listJobs(storageDir) → JobSummary[]      // newest first by createdAt; skips unreadable dirs
readJob(storageDir, jobId) → { summary, events, analysis?, spec?, report?, revisions, analysisRevisions } | null
```

- `sourceId` must match `/^[a-z0-9][a-z0-9-]{0,63}$/`; anything else throws
  `SOURCE_ID_INVALID` **synchronously**, before any directory is created.
  `readJob` likewise throws `JOB_ID_INVALID` unless the id matches `/^[a-z0-9-]{1,80}$/`
  (both regexes block path traversal by construction).
- `startJob` synchronously creates `storage/runs/<jobId>/` and writes the initial
  `job.json` (`status: 'running'`) before returning. `done` **never rejects** —
  every failure becomes a terminal summary with `status: 'failed'` and an
  `error: {code, message}`.
- Default job id: `job-<UTC yyyyMMddHHmmss>-<8 hex>`; inject `deps.newJobId` /
  `deps.now` for deterministic tests.

## Stages and events

Every transition appends one `StageEvent` JSON line to `events.jsonl` (`seq`
contiguous from 0 per job) and calls the optional `onEvent` subscriber
(subscriber exceptions are swallowed — a broken listener cannot fail a job).

| Stage | Success | Failure |
|---|---|---|
| `ingest` | started → `loadSource` (hash-checked) → succeeded, detail `sha256 <first 12 hex>` | failed, job fails with `SOURCE_UNAVAILABLE` |
| `analyze` | started → `analyzeSource` → writes `analysis.json` `{analysis, report, receipt}` → succeeded with receipt fields + detail `supported; checks a/b passed` | report not publishable → bounded analysis repair loop (TASK-024b, below); if no attempt passes → failed, job fails `ANALYSIS_INVALID`; `MetaError` → failed detail `<code>: <message>` |
| `specify` | started → `generateSpec` (specId `<sourceId>-<jobId>` truncated to 64) → writes `spec.r1.json` (the assembled `ActivitySpec`) → succeeded with receipt fields | `MetaError` → failed, job fails with that code |
| `validate` | started → writes `report.r1.json` → succeeded detail `a/b checks passed` | not publishable → failed detail adds the failing check ids, job fails `VALIDATION_FAILED` |
| `done` | succeeded (`publishable` for a succeeded job; `unsupported` for an honest not-supported-yet analysis) | — |

An analysis with `supported: false` (and a publishable analysis report) ends the
job with status `unsupported` after a single `done:succeeded` event — no spec is
generated and no spend beyond the analysis call is incurred.

## Analysis check-then-repair (TASK-024b)

When the revision-1 analysis report is not publishable, the worker runs up to
`limits.maxRepairAttempts` (same config value as spec repairs, integer 0–2;
0 keeps the old fail-fast behaviour) calls to Muse's `repairAnalysis`:

- attempt 1 passes `previous = {analysis: <revision-1 analysis>, report, attempt: 1}`;
  attempt 2 passes the attempt-1 analysis/report plus the **immutable** revision-1
  `baseline` (S5-01 for analyses), so a rejected weakening can never become the baseline.
- The job deadline signal and `analysisMaxOutputTokens` cover every attempt; each
  receipt is accounted exactly like other calls (F-01/BUG-002 included:
  a `GeneratedOutputError` fails the job `OUTPUT_INVALID` with its receipt accounted).
- Events are `repair:started` / `repair:succeeded` (or `repair:failed`) carrying
  `target: 'analysis'` and the produced analysis revision (2 = attempt 1, 3 = attempt 2);
  spec-repair events carry no `target` (absent = spec).
- `summary.analysisRepairs` records `{attempt, revision, targeted, fixed, remaining, passed}`
  per attempt. The analysis and spec repair budgets are separate.
- A passing repaired analysis becomes the analysis of record (`analysis.json` is
  rewritten; the job then continues normally — decline → `unsupported`, supported →
  `specify`). A repair that flips to a decline to escape a finding is rejected by
  the pipeline's `repair.analysis-unchanged` check, so it can never end as `unsupported`.
- If no attempt passes, the job fails `ANALYSIS_INVALID` as before.

## Job statuses

`running` → `succeeded` (publishable spec; summary carries `specId`,
`publishable: true`, `checksPassed`/`checksTotal`) | `unsupported` | `failed`
(`SOURCE_UNAVAILABLE`, `ANALYSIS_INVALID`, `VALIDATION_FAILED`, any `MetaError`
code, or `INTERNAL` for unexpected crashes). `finishedAt` and the final
`totalCostUSD` are written when `job.json` is rewritten at the end.

## Spend accounting

`totalCostUSD` is the sum of `receipt.estCostUSD` over every Meta call the job
made, **including** a receipt attached to a failed `MetaError` (the call was
billed even though it errored). Costs are rounded to 1e-6 USD. Budget
enforcement itself lives in the ledger inside `packages/meta` (the client refuses
to reserve past the cap); the worker only reports what receipts say.

## Run directory layout

```
storage/runs/<jobId>/
  job.json        JobSummary (running → terminal)
  events.jsonl    one StageEvent per line, append-only
  analysis.json   {analysis, report, receipt} from analyzeSource; rewritten with the
                  repaired analysis when an analysis repair passes (TASK-024b)
  analysis.r1.json  ONLY when an analysis repair was attempted: the immutable
  analysis.r2.json  revision-1 analysis (r1) and each attempt's {analysis, report,
  …                receipt} (r<n> = attempt n-1), mirroring spec.r<n>/report.r<n>
  spec.r1.json    assembled ActivitySpec (revision 1)
  report.r1.json  ValidationReport for spec.r1
```

`r1` anticipates the Stage-5 repair loop (`spec.r2.json`, …); the repair stage is
out of scope for Stage 2.

## Tests

`jobs.test.ts` runs entirely against a **fake MetaClient** and the recorded real
Muse fixtures in `tests/fixtures/` — no network, no credits. Cover: full
succeeded pipeline (files, event order, seq contiguity, cost 0.02), unsupported
source, `MetaError` timeout, `MetaError` receipt cost accounting, corrupted
evidence quote → `VALIDATION_FAILED` naming `grounding.quotes`, unknown source,
invalid ids, listing/reading/skipping.

## Stage 6 lesson flow (S6-W)

`deps.flow: 'lesson' | 'activity'` selects the pipeline (worker default
`'activity'`; the API server defaults to `'lesson'` per the frozen lesson-flow
contract in `docs/specs/STAGE-6-design.md`). The lesson flow lives in
`lesson.ts`; `job-support.ts` holds the persistence/receipt helpers shared by
both flows and `demo-faults.ts` the labelled demo-fault helpers.

One lesson job: `analyzeSourceV2` (validator injected = `validateAnalysisV2`;
16,000-token Muse cap) → bounded analysis repair loop (revision-1 baseline,
`compareAnalysisV2Revisions`) → decline (`usable=false` → `unsupported`,
`lesson.json` with a null overview) or **overview publish** (`overview:succeeded`
event + `lesson.json` written BEFORE any component call) → the planned components
in plan order, **at most 2 concurrently** → partial publish. Per kit component:
`generateKitComponent` (12,000-token cap) → `validateKitComponent` → the
validator-owned prune helper (drop bad items while the minimum remains; the
dropped-items note becomes the passed entry's `reason`; skipped on a revision
carrying an injected demo fault so the catch is always demonstrated through
repair) → bounded repair loop (`repairKitComponent` + `compareKitRevisions`
against the immutable revision 1) → `assembleKitSpec` → persisted as
`<componentId>.r<N>.json` `{gen, spec, report, receipt}`. Premium engines: the v2
analysis is adapted to the v1 `SourceAnalysis` (concepts from key terms with
their quotes, objectives from key points), validated with v1 `validateAnalysis`
BEFORE any paid call (failure → entry `skipped`, plain reason, zero spend), then
the unchanged v1 `generateSpec`/`repairSpec` loop with the v1 file names
(`spec.r<N>.json`/`report.r<N>.json`) and summary fields (`engine`, `repairs`,
`publishedRevision`, …).

Failure policy: only the analysis/overview stage can fail the lesson
(`ANALYSIS_INVALID`, `OUTPUT_INVALID`, `MetaError` codes). A component whose
output fails its checks (or is schema-invalid) fails ALONE — the lesson still
succeeds with the overview plus every passed component (`partialPublish` when
anything failed/was skipped). A provider `MetaError` inside a component call is
fatal for the job, exactly like v1. Every charge — analysis, components,
repairs, premium, `GeneratedOutputError(V2)` receipts — goes through the SAME
single cost accumulator in `jobs.ts` before any fallible write.

Events extend the frozen contracts locally (contracts are not edited): stages
`overview` and `component` (`componentId`, `revision`, `status`), repair events
with `target: 'analysis'` or `target: 'component'` + `componentId`, and the
demo-fault `inject` event carries the `componentId` it was planted in (absent —
with status `failed` and a plain reason — when the fault could not be injected,
so a natural repair is never labelled system-made). The summary carries `flow`,
`lesson` progress (kept current for the list view), `componentRepairs`, and
`demoFaultComponentId`.

Lesson demo faults (labelled, system-made, excluded from metrics):
`fabricated-quote` → the first quiz card's quote (must fail Q-01);
`wrong-answer` → the formula explorer's expression `(expr) + 1` (must fail
FE-08, else FE-05/FE-04; the inject detail names the catching check). The
`effective` flag records whether re-validating the faulty revision actually
failed the intended check.

`readJob` serves the frozen lesson detail for `flow: 'lesson'` jobs only
(activity/legacy details are byte-identical to before): `analysisV2` (null when
the analysis never became publishable), `analysisV2Report`,
`analysisV2Revisions`, `lesson` (`lesson.json`), `kitSpecs` (PASSED specs only,
keyed by `kitSpecId`), `componentReports` (latest revision per component, keyed
by `kitSpecId`) and `componentRepairs`.

Lesson tests: `lesson.test.ts` (happy path on the drag golden, decline,
unrepairable analysis, component repair/prune/partial publish, OUTPUT_INVALID,
fatal MetaError, concurrency-2 ordering, v1 default unchanged),
`lesson.premium.test.ts` (adapter pass + skip with no paid call),
`lesson.demo-faults.test.ts` (both families effective + labelled, prune-skip,
not-injectable honesty), `lesson.cost.test.ts` (real client + real ledger +
fake transport: job.json totals equal the ledger's committed spend even when
the event write fails), and `apps/api/server.lesson.test.ts` (flow parameter,
FLOW_INVALID, detail/list shapes).
