# Stage 5b live runs — timeline-v1 (2026-10-29 00:32–00:38 KST)

Purpose `test-live`, model `muse-spark-1.3`, Standard tier, reasoning High. Run with `node scripts/stage5-live-runs.ts --only <name>` against the live API on loopback, one job at a time. Job directories are copied unchanged from `storage/runs/`.

| Run | Job | Result | Revisions | Checks | Wall | Cost (USD) | Note |
|---|---|---|---|---|---|---|---|
| declaration (attempt 1) | `job-20261028153253-a27aeaaf` | failed `OUTPUT_TRUNCATED` at specify | 0 | — | 68.5 s | 0.090443 | Muse used 15,998 of 16,000 output tokens reasoning before writing any spec. Fix: `maxOutputTokens` 16,000 → 32,000 and `maxJobWallTimeMs` 240,000 → 420,000 (`config/resource-limits.json`). Reasoning stays High per project rule. |
| declaration | `job-20261028153510-c5e1a7da` | **published r1** | 1 | 11/11 | 60.4 s | 0.085619 | 7 events from the National Archives page, all dates grounded; 5 of them use the title-year rule ("on June 10", "July 5th", "July 19th") |
| articles | `job-20261028153624-4dc34853` | **published r1** | 1 | 11/11 | 38.2 s | 0.058306 | Articles of Confederation page |
| demo-fault-timeline | `job-20261028153711-fa7f9d4b` | **published r2** after repair | 2 | 12/12 | 68.5 s | 0.108119 | **System-injected** wrong answer (behavioralTests[0] `e1 -> e3` swapped to `e3 -> e1`), effective, caught by `timeline.case-order`, repaired by Muse; labelled, excluded from quality metrics |

Lead review of the published Declaration timeline: every event date matches the page text; "Congress revises draft" is dated July 3 from "took all of July 3rd and most of July 4th" (start of a stated span, defensible).

Natural repair: still none observed — both real history pages passed on the first try.

Stage 5b live spend: USD 0.342487 (4 jobs). Ledger total after these runs: USD 1.4477 of the USD 10 cap.

## Correction (2026-10-29, after the Stage 5b round-3 review fixes, commit bb56577)
Date grounding is now fail-closed: a date counts only when the source states it in a supported exact form with no qualifier or bound beside it (`docs/specs/STAGE-5b-plan.md`, round-3 decision). A negated "until" ("was not approved until September of 1776") still counts. Replayed under the current checks, **`job-20261028153624-4dc34853`** (NARA Articles of Confederation, published r1) no longer passes `timeline.date-grounded`: e5 1789 ("in force from March 1, 1781, until 1789 when the present-day Constitution went into effect"). These dates match the page, but an un-negated "until" names a deadline or a period end, not proof the event happened on that date, so the checks now reject them. This is an accepted false rejection. The stored files, the pre-registered score and the original verdict are unchanged. A re-run under the current checks is recorded separately.
