# Demo v2 evidence: follow the build

Spec: `docs/specs/DEMO-V2-follow-the-build.md`. Run: `job-20261101234914-97ba271b` (DEMO_PINS.tour), replayed read-only
from the local API. Opened with `?demo=1&welcome=0` (default 4x), `&speed=4` and `&speed=2`, at 1920x1080 and 1366x768.

## Beats of the Demo run

Job time is the replay's own timeline (SAM confirm holds included). Wall time is measured from "Watch a lesson being
built" when left alone at 4x (beats close together wait out the 2.6 s minimum dwell).

| # | Job time | Wall at 4x | Card title | Lit |
|---|---|---|---|---|
| 1 | 0.0 s | 0.3 s | Muse Spark 1.3 is reading the page | strip + source page |
| 2 | 39.3 s | 10.4 s | Muse writes the summary first | summary + source page (+ part frames when the card fits) |
| 3 | 39.3 s | 13.0 s | Muse writes “Sequence” | Sequence part |
| 4 | 39.4 s | 15.6 s | Muse writes “Label the diagram” | Label the diagram part |
| 5 | 55.4 s | 19.6 s | “Sequence” passed its checks | Sequence, then (after 8 s job time) Label the diagram, still being written |
| 6 | 75.7 s | 24.9 s | Muse Spark locates the parts on the figure | Label the diagram |
| 7 | 95.5 s | 29.7 s | SAM 3.1 confirms what Muse Spark located | Label the diagram |
| 8 | 101.5 s | 32.4 s | “Label the diagram” did not pass a check | Label the diagram |
| 9 | 107.3 s | 35.1 s | Muse Spark locates the parts again | Label the diagram |
| 10 | 124.8 s | 39.6 s | SAM 3.1 confirms what Muse Spark located | Label the diagram |
| 11 | 130.8 s | 42.2 s | Revised by Muse after a failed check | Label the diagram |
| 12 | 130.8 s | 44.9 s | Ready for your review | strip |

## Checked in the browser

- Every beat at 1920 and 1366: at least one cut-out, every ring inside the viewport, the card clear of every ring,
  Next enabled, no waiting sentence. Strip text matched the card at each beat ("Writing Sequence", "Locating 5 parts on
  the figure", "SAM 3.1 confirming 5 parts", "Reworking Label the diagram", "Lesson ready").
- Calvin's 2x screenshot moment ("Writing Label the diagram", 1 of 2 parts checked) is now beat 5, with Label the
  diagram lit after the checked moment: `1366-beat05-passed-then-handoff.png`.
- Next and Back mid-build seek the replay (Back twice from beat 5 to beat 3 took the strip from "1 of 2 parts checked"
  back to "0 of 2" and "Writing Sequence 0 s"); Back from beat 1 returns to the library card; Next after beat 12 opens the try step and Back returns to the
  finished build; Back from beat 12 reopens beat 11 with the replay running again.
- `&speed=2` shows "2× speed" in the strip (the reading card takes the same speed value).

Screenshots: `1920-beatNN-<kind>.png` (one per beat), `1366-*.png` (a selection and the try step).
