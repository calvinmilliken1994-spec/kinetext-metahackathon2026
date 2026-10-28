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
