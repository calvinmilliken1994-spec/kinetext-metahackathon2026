# Set B, lesson slice: activity first, repair story, lesson fixes

Built by Claude Opus 5.5 (lesson slice child), 2026-11-01. GET-only against the read-only API on :8787; Vite on :5173. No generation, no POST.
Design source: `docs/reviews/ux-review-2026-11-01-part2.md` §3 (#4, #7) and part 1 quick wins.

## What changed

| Item | Change |
|---|---|
| B1 activity first | A lesson at rest opens on its most visual checked part (shared rule `lib/partOrder.ts`, the same one the slides use: label diagram, simulation, formula, algorithm, ladder, threshold, table, timeline, balance, compare, then quiz/sequence/sort/concept map; plan order among equals). The overview follows it as **Lesson notes** with an **In short** summary heading (open, hover-linking unchanged). Parts that are not shown (held back today, could not be verified, not built) go into ONE compact notice after the working parts. While a build is watched the old plan order is kept, so nothing jumps. |
| B1 status + provenance | One status line `Teacher review pending · N parts ready · N held back` (counts from the lesson, via a small context). Provenance is one sentence (`AI-generated with Muse Spark 1.3 (Meta) from MedlinePlus Genetics, which has not reviewed or endorsed this lesson.`), at 12 px; what code checked and Muse's revisions sit behind **How it was checked**, with **See how** opening the runs drawer at the repair story. A system-made fault phrase is never folded away. |
| B2 repair story | Runs drawer: one story per repaired part, *Check found an issue → Revised by Muse → Rechecked → Published* (or *Withheld*), one plain sentence each, built by pure `lib/repairStory.ts` from `componentHistory` (frozen contract, parsed in `lib/lessonJob.ts`). For the DNA label diagram it draws the stored r1 (open red rings) and r2 (green dots) points with arrows on a crop of the real figure: positions only, no names or text of the failed version. Footer keeps fault origin (`The mistake was Muse’s own, not a planted test fault.` / planted-fault wording). The per-attempt record (check ids, checker text, model string, response id) shows only with technical details on. |
| B2 rename | `Natural repair (Muse’s own mistake)` → `Revised by Muse after a failed check` (analysis badge, component badge, steps); failure: `Muse’s revision did not pass — this part is withheld`; provenance phrase `1 revision by Muse after a failed check`. System-made labels unchanged. |
| B2 leak fix | `Checker said …` and bare check ids now carry `tech` in the analysis and component repair timelines; the checks list shows checker text only under technical details (a failed check shows a plain line). Verified on Electoral College and DNA with the toggle off: no `Checker said`, check id, `R-SUB`, JSON path, `Natural repair`. With the toggle on, `LD-04` appears. |
| B5 library | The New lesson chips count active licensed library pages only: **All 97** (matches the tour's 97), teacher/test texts counted apart (`+ 2 teacher texts`). The single `Show all <subject> (N)` toggle follows the subject chip that is on, else the selected page's subject (DNA selected, no filter: no physics link; Physics chip: `Show all physics (13)`). |
| Lead request | `LiftView.tsx` readout `Lift L (engine)` → `Lift L (calculated)`. |

## Measurements (lesson panel, CSS px, from `measurements.json`)

First part top / first activity control top (`firstControlY`: first button, input, chip or slider inside the first part, links excluded).

| Lesson | Opens on | 1920×1080 part / control | 1366×768 part / control | Before (reviews) |
|---|---|---|---|---|
| DNA `job-20261031081105-21355f66` | Label the diagram | 234 / 379 (word bank) | 224 / 369 | 1366: first card 420, figure 503→926 |
| Drag `job-20261030104212-d509087a` | Formula explorer | 234 / 556 (slider) | 224 / 546 | 1366: sliders 702, card 465 |
| Binary search `job-20261031023947-3171fbc9` | Algorithm trace | 234 / 693 (step buttons) | 251 / 710 | 1920: question 1049 |
| Electoral College `job-20261031023315-679e8e97` | Threshold (Vote) | 234 / 387 (case chip) | 224 / 377 | 1920: threshold 1049 (sequence first) |
| Held back `job-20261031111156-12c77646` | nothing shown (both parts left out) | notes, then the notice | same | withheld card before the scale |

The part itself now starts at y≈224 at 1366×768 (target ≈234 in the review). The first control inside the part is at 369–377 for DNA and Electoral College; it misses the ≤300 target because the part's own header (title, meta line) and the view's internal layout come first. Drag (sliders under the typeset formula) and binary search (controls below the bar chart) are further down: that is inside `FormulaExplorerView` / `AlgorithmTraceView`, outside this slice.

## Checks

- `node --test apps/web/src/lib/*.test.ts`: 965 pass, 0 fail (new: `repairStory.test.ts` incl. the real DNA r1/r2 points and figure boxes, `partOrder.lesson.test.ts`, `libraryCounts.test.ts`).
- `npm --prefix apps/web run build`: ok. `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.
- Hover-linking: hovering a Lesson notes key point lights its page sentence; hovering that page mark lights the key point.

## Frames (JPEG, 2.76 MB total)

`<lesson>-<w>x<h>-<theme>.jpg` for dna, drag, binary, electoral, heldback at 1920×1080 and 1366×768, dark and light (20 frames), plus `dna-repair-story-1920x1080-dark.jpg` and `dna-repair-story-1366x768-light.jpg` (drawer opened from How it was checked → See how).
