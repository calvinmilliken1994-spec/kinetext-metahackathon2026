# Stage 10b slice S: Results page

Spec: `docs/specs/STAGE-10b-review-and-results.md`, section S (frozen). Checked 2026-11-02 in Chrome through Vite on :5173,
with the read-only API on :8787 (GET only), at 1920×1080 and 2560×1440 (1366×768 as the "still fits" check), dark and
light. The page was mounted in a temporary dev-only preview inside the real window shell (`AppWindow` + `Sidebar`),
because `App.tsx` still routes `?view=results` to the placeholder until the lead swaps it in. The preview file was
deleted afterwards.

## What the page shows (all from `apps/web/src/data/results.json`)
`scripts/build-results.ts` builds the JSON from committed files only (final-eval `summary.json`, `jobs.csv`,
`manifest.json`, `PREREGISTRATION.md`, the timeout-retest files, the Stage 8c/8d `results*.jsonl`, the 8d README and the
8c spec). Each section names its files and dates; the last section lists every file.

1. **Headline:** lessons with at least one working interactive part: Muse Spark 1.3 97% (189/194, 95% interval 94–99%),
   Muse Spark Open 92% (178/194, 87–95%), with the plain cause of most of the gap (11 of Spark Open's 16 misses ran out
   of time on the shared endpoint).
2. **Side-by-side table:** lessons, declines, failed builds with causes, parts published/planned (348/379 vs 342/374),
   first try (303/379 vs 272/374), fixed by repair (45/76 vs 70/102), time p50/p90 (75/145 s vs 128/220 s), cost per
   lesson ($0.150 vs $0.186), and the run-twice consistency rows.
3. **What reaches the live lesson:** one table row per part type and model, with a horizontal stacked bar (first try,
   after repair, left out) and the exact counts in columns. Order: most planned / most left out / A to Z. Bars: counts
   or share of planned. Label the diagram on Spark Open reads "Not given figures in this evaluation", with a note that
   this was pre-registered and a link to the diagram runs.
4. **Pass rate by subject:** both models per subject with a dot plot of the rate and its Wilson interval (axis 40–100%,
   stated), plus parts published per model.
5. **Spark Open's timeouts, run again:** labelled "not part of the pre-registered evaluation"; 7 → 18 lessons of 18,
   11 → 0 timeouts, and the honest reading from the retest README (slowest call 113.9 s).
6. **Diagram lessons today:** the 12 Stage 8c/8d runs, newest first, with model, result, parts, SAM confidence where a
   committed note states it, time, cost and *Open lesson* (`?job=`); "Not stored here" if the server lacks the run.
7. **How these numbers were made:** pre-registration, 97 × 2 × 2, models, counting rules, what is not claimed, files.

## Screens
| File | What it shows |
|---|---|
| `01-top-1920-dark.jpg` | Title, headline comparison, start of the table |
| `02-compare-1920-dark.jpg` | The side-by-side table |
| `03-funnel-1920-dark.jpg` | Part types by most planned, count scale, legend and controls |
| `04-subjects-1920-dark.jpg` | Subject table with the dot plot |
| `05-retest-1920-dark.jpg` | Timeout retest, labelled not pre-registered |
| `06-diagrams-1920-dark.jpg` | Diagram runs with Open lesson links |
| `07-method-1920-dark.jpg` | Method notes and the file list |
| `08-top-2560-dark.jpg`, `09-funnel-2560-dark.jpg` | QHD: the page column at 1440 px with the stepped-up type |
| `10-top-1366-dark.jpg`, `11-diagrams-1366-dark.jpg` | 1366×768: every table fits its column (no horizontal scroll) |
| `12-funnel-1920-light.jpg`, `13-subjects-1920-light.jpg` | Light theme |
| `14-funnel-left-out-share-1920-dark.jpg` | Sorted by most left out, share-of-planned bars (Label the diagram first) |

## Checks
| Check | Result |
|---|---|
| Document overflow at 1920 / 2560 / 1366 | none (`scrollHeight === innerHeight`) |
| Table width vs column at 1366 | all six tables fit (scrollWidth = clientWidth = 963 px) |
| Sort and scale controls | order and `aria-pressed` follow the click; share bars all full width |
| "Diagram lessons today" link in the funnel note | container-scoped scroll (`revealInPanels`), heading focused, window not moved |
| Open lesson (newest Spark Open water-cycle run) | opens `?job=job-20261101212123-3e4734fe` on the lesson |
| Open lesson availability on the local server | 12 of 12 runs stored here |
| impeccable detect (`apps/web/src`, `index.html`) | 0 findings |
