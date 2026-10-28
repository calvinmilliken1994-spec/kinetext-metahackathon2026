# Stage 5b plan — subjects beyond physics

Status: design reviewed by Muse, dispositions below (2026-10-28). Approved scope (Calvin, 2026-10-28): all four subjects — finance, biology, chemistry/earth science, history — then the evaluation run (20–30 real pages incl. deliberately hard ones).

## Done so far
- `compound-interest-v1`, `hardy-weinberg-v1`, `half-life-v1`: descriptors, types, schemas, engines (test-first), registry dispatch, Muse-authored spec guidance (PROMPT_VERSION v6). Commit `1aa1df2`, 621 tests.
- Sources for all four subjects: being gathered (licence-verified US federal public-domain pages: CFPB, NRC, USGS, National Archives).

## Remaining work
| ID | Work | Owner (route) |
|---|---|---|
| TASK-019 | Timeline contracts (this design) + schemas | Lead |
| TASK-020 | Timeline validation checks + no-weakening rules | Qwen Max |
| TASK-021 | Timeline analysis/spec/repair prompt guidance | Muse (subscription bridge) |
| TASK-022 | UI views: compound-interest growth chart, Hardy-Weinberg genotype bars, half-life decay curve, timeline ordering activity | Sonnet 5.5 |
| TASK-023 | Evaluation run (20–30 pages, report every outcome) | Lead (live, `test-live`, cap USD 10) |
| TASK-024 | Independent review | gpt-6-astra |
| TASK-025 | Docs + vault | Qwen Flash |

Order: 019 → 020 → 021 → 022 → 023 → 024 → 025. Serial; one delegate at a time.

## Timeline design (TASK-019)

### Principle
Physics, finance, biology and chemistry are checked by recomputing a formula. A timeline has no formula, so **the source text itself is the deterministic oracle**: every date must be visibly stated in a verbatim quote from the source, and every ordering answer is recomputed by code from those dates. The model may choose events and wording; it may never supply a date the source does not state.

### Engine id
`timeline-v1` joins `ENGINE_IDS`, so the analysis step can choose it or decline exactly as for the other engines. It is a *non-numeric* engine: its descriptor has no `inputs`/`output`; the registry's `computeOutput` is not used for it. Code that iterates numeric descriptors must branch on `kind: 'formula' | 'sequence'` (new descriptor field; existing seven engines are `formula`).

### Spec shape (generated part)
```ts
interface TimelineEvent {
  id: string;                 // e.g. 'e1'
  label: string;              // short learner-facing name, <= 80 chars
  year: number;               // integer, -3000..2100 (negative = BCE)
  month?: number;             // 1..12, only if the quote states it
  day?: number;               // 1..31, only if the quote states it (requires month)
  evidence: Evidence[];       // 1..2 verbatim quotes; the date must appear in one of them
}
interface TimelineSimulation {
  engine: 'timeline-v1';
  events: TimelineEvent[];    // 5..10
  scenario: { objectLabel: string; settingLabel: string };
}
interface TimelineCase {      // behavioural tests and predictions
  earlierEventId: string;     // "which happened first?" — expected answer
  laterEventId: string;
  // expected answer is implied: earlierEventId; code recomputes from the dates
}
```
Behavioural tests: 3–5 ordering pairs. Predictions: 2–3 ordering pairs the learner answers before seeing the timeline. The UI also offers a full drag-to-order activity, graded by code against the date order.

### Deterministic checks (TASK-020)
1. `schema.full` — per-engine schema (shape, counts, integer/ranges, `day` requires `month`).
2. `timeline.unique-ids` — event ids unique; case ids reference existing events.
3. `timeline.date-grounded` — for each event, one of its quotes (already verified verbatim by the existing quote check) contains the year as a standalone number (`\b1776\b`; BCE written as e.g. `500 B.C.`/`500 BCE`); if month is given the month name (or abbreviation) appears in the same quote; if day is given, the day number appears in the same quote. Failure message names the event, the date and the quote — this is the most likely *natural* repair trigger (model supplies a year from its own knowledge, or reads a year from the wrong sentence).
4. `timeline.distinct-dates` — no two events with an identical full date unless the source quote for both is the same sentence (ties make ordering questions ambiguous); ties are rejected for any event used in a case.
5. `timeline.case-order` — for each test/prediction, code compares the two events' dates; `earlierEventId` must be strictly earlier. Mismatch is a wrong answer (same category as a wrong formula output).
6. Existing checks apply unchanged: quotes verbatim, explanations evidenced, publisher policy, scope labels.

### No-weakening for repair (extends `compareRevisions`)
Against the immutable revision-1 baseline: an event whose date check passed on r1 keeps its id and date (label/quote wording may change only if a finding names it); events may not be removed unless a finding names them; tests/predictions keep (id, occurrence) identity and may only change the pair a finding names. The event count may not drop below 5.

### Out of scope
Durations, BCE/CE calendar conversion, approximate dates ("circa", "the 1770s") — events with only approximate dates are excluded by the prompt and rejected by `timeline.date-grounded` (decade forms do not match a standalone year).

### Open questions for review
- Q1: Is "the year must appear in the quote" too strict for sources that state the year once in a heading and then refer to "that summer"? (Proposal: yes, strict; the model must quote the sentence that states the date. Strictness is what makes it checkable.)
- Q2: Should the full drag-to-order activity be part of the spec (graded) or UI-only? (Proposal: UI-only, graded from event dates; the spec's tests/predictions are the checked contract.)
- Q3: Should `kind: 'sequence'` engines reuse `behavioralTests`/`predictions` field names? (Proposal: yes, so job/repair/UI plumbing stays shared.)

## Muse design review — dispositions (2026-10-28)
Review: `docs/evidence/stage-5b/muse-timeline-design-review.json` (Muse Spark 1.3 via subscription, 42 s, 27,202 in / 7,410 out). 12 findings + Q1–Q3; 11 adopted in full, 1 adopted in simplified form.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | High | `\bYEAR\b` matches inside "1,000"/ranges and misses ordinals | **Adopted.** Mask `\d{1,3}(,\d{3})+` first; year = `(^|[^0-9])YEAR($|[^0-9])`; range endpoints (`-`, `–`, `/`) ground only the endpoints; day = `\b0?DAY(st|nd|rd|th)?\b` (i) |
| 2 | High | "same quote" lets a paragraph pair July (event A) with 1776 (event B) | **Adopted.** Year, month and day must all be in one *sentence unit* (split on `[.!?;\n]+`; a heading line is one unit) |
| 3 | High | stray day numbers ("4 delegates") | **Adopted** via #2: day and month in the same unit |
| 4 | High | BCE sign and year 0 unspecified | **Adopted.** Negative year requires a BCE/B.C. marker after `abs(year)` in the unit; positive year must not have one; schema forbids 0; no calendar conversion |
| 5 | High | ties / year-only ordering undefined; array order would decide | **Adopted.** No two events may share the same specified date tuple; a test/prediction pair must be strictly ordered at the precision both events state; never grade by array position |
| 6 | High | no-weakening unenforceable (cases had no id; label rewrite; padding; date shopping) | **Adopted, simplified.** Cases get `name`, predictions `id` + `prompt` (mirroring numeric engines). An event that passed date grounding on r1 keeps id, label, date and quotes unchanged unless a finding names it. A failing event may be re-grounded (new date + quote, re-checked by the same rule) or removed. No new events in repair; event count never exceeds r1 and never drops below 5. (Edit-distance label rule not adopted: unchanged-unless-named is simpler and stricter.) |
| 7 | Med | same-sentence tie exception is gameable | **Adopted.** Exception dropped |
| 8 | Med | strict rule false-rejects heading/caption dates | **Adopted.** A heading or caption line is a valid date unit; 1–2 quotes = one date unit + optional description; relative dates never ground |
| 9 | Med | month list must be exact | **Adopted.** Fixed case-insensitive list incl. `sep(t)?(ember)?`, period optional, in code only |
| 10 | Med | decade/circa must be detected, not just fail to match | **Adopted.** `timeline.approximate-date` fires first with message "approximate date — remove this event" |
| 11 | Low | scenario keys and fake equation | **Adopted.** Scenario `{ subjectLabel, settingLabel }`; sequence descriptors have no equation |
| 12 | Med | descriptor assumes numeric engines | **Adopted.** `EngineDescriptor = FormulaDescriptor | SequenceDescriptor` discriminated by `kind`; the seven existing engines unchanged; numeric code paths narrow on `kind` |
| Q1 | | heading year + "that summer" | Strict; heading counts as a date unit |
| Q2 | | drag-to-order in spec? | UI-only, graded from event dates |
| Q3 | | reuse field names? | Yes, with stable `name`/`id` |

Muse's prompt-guidance sentences go into TASK-021 verbatim as input.

### Revised checks (supersede the draft list above)
`schema.full` → `timeline.unique-ids` → `timeline.approximate-date` → `timeline.date-grounded` (sentence unit, rules #1–#4, #8, #9) → `timeline.distinct-dates` (no exception) → `timeline.case-order` (strict at shared precision) → existing quote/explanation/publisher/scope checks. Repair: `repair.no-weakening` timeline rules per #6.

Sequencing: TASK-019 contracts start after the source-gathering task finishes (avoids breaking its test run mid-edit).

## Direction decision (Calvin, 2026-10-28)
Considered: a general formula block (Muse writes the equation in a restricted, parsed maths language; code checks it is quoted in the source, unit-consistent, and reproduces the source's worked examples) with one general chart view, to move toward "any source". **Decision: keep the fixed, hand-built activity types** for this hackathon — screens for the three new subjects (TASK-022), then the timeline (TASK-019..021), then the evaluation run (TASK-023). The general formula block is recorded as the post-hackathon path to arbitrary sources and may be named as such in the submission.

## Finding from the real sources (lead, 2026-10-28) — input to TASK-019
`nara-declaration-of-independence` states the year once ("on July 4, 1776" in the first sentence; title "Declaration of Independence (1776)") and then gives most dates without a year ("on June 10", "between June 11 and 28", "on July 19th", "On August 2nd"). Under the strict sentence-unit rule most events on the page could not be grounded, which would push the model toward a decline or a thin timeline. Proposed resolution for TASK-019 (to confirm with Muse in TASK-021): an event's year may come from the page **title line** when the title contains exactly one year; month and day must still be in one sentence unit of the event's quote. No other cross-sentence year inheritance.

## Findings from the first live runs of the new subjects (lead, 2026-10-28)
Jobs 18:27–20:41 KST (purpose `test-live`): Hardy-Weinberg (NIJ), half-life (NRC) and compound interest (CFPB, twice) all published on revision 1 with every check passing; the lead recomputed the compound-interest cases (1,647.01 / 1,643.62 / 3,277.23 USD) by hand. USGS geologic age was declined correctly (age solved for t is not the half-life engine). Both National Archives pages were declined, correctly until timeline-v1 exists. Still no natural repair.

- **BUG-002 (Medium, FIXED in part (b) and made diagnosable; root cause of (a) not reproduced):** `job-20261028093358-32686a4c` (CFPB) failed with `INTERNAL` right after the spec call returned, and its `job.json` reports `totalCostUSD: 0` although the ledger reconciled USD 0.0496 for its two calls (cap accounting is correct; the job summary is not). Two problems: (a) an unhandled exception after specify for a compound-interest spec — cause unknown because the model output was not persisted; (b) INTERNAL failures after a model call drop the cost from the job summary (the Stage 2 F-01 fix covered OUTPUT_INVALID only). Fix test-first: persist the raw spec output (sanitised) before assembly/validation, and carry recorded receipts into INTERNAL failures.
- **Prompt wording (fold into TASK-021, Muse):** the analysis and spec system prompts still say "physics curriculum analyst" / "describe only the physics"; decline reasons now say "teaches no physics equation" for history pages. Make them subject-neutral.
- **Scenario label mismatch (Low):** the CFPB spec labels the setting "Interest compounded yearly" while its slider default is quarterly. Not checked by code; candidate for a light consistency check or prompt guidance.

### BUG-002 fix (lead, test-first, 2026-10-28)
- Red: `workers/generation/jobs.internal.test.ts` reproduces the live symptom (an exception after both billed calls → job.json `totalCostUSD: 0`, bare `INTERNAL`).
- Fix (`workers/generation/jobs.ts`): `accountReceipt` keeps `summary.totalCostUSD`/`reservedUnknownUSD` current, so the last-resort path persists every billed call; the last-resort event now reads `INTERNAL; during <stage>; cause <code-or-class>` from a fixed vocabulary (errno code such as `EPERM` or error class such as `TypeError`; never the message, R-01); the full error goes to server stderr only.
- Root cause of the live crash not reproduced: 20,000 fuzzed compound-interest specs never made `validateSpec` throw, and no temp file was left behind (rules out a failed atomic rename). The next occurrence will name its stage and cause.
- Tests 676/676; web build ok.
