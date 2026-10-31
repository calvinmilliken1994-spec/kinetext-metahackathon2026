# Stage 8a slice W-B: threshold and data-table views, engine presentation core, sequence and explorer fixes

Author: Claude Opus 5.5 (slice W-B child), 2026-10-31. Spec: `docs/specs/STAGE-8a-subject-engines.md` §1c, §1d, §2, §4.
All frames were taken in the dev server against fixture data (`?engine-demo=b`) or stored runs on the live API (GET only:
`?present=<jobId>`). The harness fixtures quote real library pages exactly (tests check every quote against
`data/sources/*.txt`); one threshold spec is a labelled synthetic two-stage layout check. Nothing here is model output.

## What is shown

| Frames | What |
|---|---|
| `lesson-threshold-*` | "Does it pass?": per-stage vote meter (units ≤ 100 seats, filled column by column; a bar above), required line from `requiredCount` ("needs 270 of 538", hidden until the reveal), slider and stepper, try-it chips, predict buttons, verdict |
| `lesson-table-*` | Data table: page values as printed, numeric columns right-aligned and sortable by `parseTableNumber`, units in headers, bar chart linked to rows on hover, questions answered by `answerQuestion`, IRS brackets calculator (`progressiveTax`) with slice blocks (width = slice, height = rate, area = tax), total and effective rate, honest note |
| `present-threshold-*`, `present-table-*` | The same views as engine beats in presentation mode at 1920×1080 and 1366×768, dark and light: one step per question, R reveals the current step, the page sentence lands in the quote zone |
| `present-seq-*` | NARA job `job-20261030104322-609ad85d`, beat 4 (sequence) before and after "Check order"; `present-seq-1080-before-fix-halfscale.png` is the old layout |
| `present-drag-explorer-*` | Drag job `job-20261030104212-d509087a`, beat 5 (formula explorer) at 1366×768 and 1920×1080; `present-drag-explorer-768-before-fix.png` is the old frame (last row scrolled) |

## Measurements

Method: bounding boxes of every element inside `.pz-beat` plus the quote zone, before and after R (CDP key event), and
`.pz-fit-zoom` before/after. Screenshots are taken with `captureBeyondViewport: false` (with `true` CDP resizes the
viewport for the capture, StageFit refits, and a fake Δ of 0.5–3 px appears).

| Check | Result | File |
|---|---|---|
| R on every engine step (7 parts, 16 steps) × 1920×1080 / 1366×768 × dark / light | max Δy = 0, max Δh = 0, zoom unchanged, every slide fits without scrolling | `engine-sweep-{1080,768}-{dark,light}.json` |
| Sequence "Check order" (4 step cards) × both sizes × both themes, plus a real mouse click | Δy = 0 and Δh = 0 for every card, zoom unchanged, no scroll (before: cards pushed down by 175–460 px) | `seq-measure.json` |
| Drag explorer stage | 1366×768: zoom 0.612, `scrollHeight == clientHeight` (459), no scrollbar; 1920×1080: zoom 0.902, no scroll | `drag-explorer-fit.json` |
| Existing quiz beats after the reducer change | Δy = Δh = 0 on R (NARA beats 5, 6; Drag beat 6) | `regression-existing-beats.json` |
| Leak check before R | amendment beat: no visible "38", no linked quote containing "38 of 50"; planets lookup: no visible or linked "5.97" | (inline in the run log) |

The Drag predict beat (beat 4) inserts its verdict nodes on R as before (the pass-3 harness measures options, slots and
the zone there, not every node); not changed by this slice.

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 783 pass, 0 fail (new: `thresholdView.test.ts` 10, `dataTableView.test.ts` 11,
  `presentation.engines.test.ts` 7; written first and run red before the code).
- `npm --prefix apps/web run build`: green; the production bundle contains no harness text.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`, exit 0.

## Known limits

- The IRS page gives the lowest bracket as "10% … $12,400 or less", which has no "over" threshold, so a schedule that must
  quote every threshold starts at 12%; the calculator says "Income up to $12,400 has no rate in this table" rather than
  inventing a $0 row. The contract has no way to express the bottom bracket (lead decision: allow an "or less" first row).
- The Drag explorer fits 1366×768 only at zoom ≈ 0.61, because its own layout stacks the formula block above a tall
  slider column. A tighter stage layout inside `FormulaExplorerView` (owned elsewhere) would allow ≈ 0.75.
