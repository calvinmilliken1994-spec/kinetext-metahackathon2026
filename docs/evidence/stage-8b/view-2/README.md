# Stage 8b view, pass 2: Label the diagram after live run 3

Web slice U (Claude Opus 5.5). Fixes the three problems the lead found on the live run-3 lessons: answers readable beside
the label covers, name tags colliding on reveal, and a small figure on the slide. Checked in Chrome (CDP) on Vite dev
(:5173) against the running API, GET only, on the three stored live jobs and on the dev harness `?engine-demo=c`.

## What changed

| Problem (live run 3) | Before | After |
|---|---|---|
| **Leak: covers off the printed words** | Covers came from Muse's per-part label boxes, padded. Muse's boxes sit off the text, so "Sugar phosphate" and the ends of "Guanine" and "Cytosine" showed beside the covers (`before-live-dna-768-dark-step1-ask.png`). | When `spec.figure.labelBoxes` holds at least one usable box, the view covers exactly those boxes (image pixels → % of the figure, 2 px pad, the pad dropped where it would hide a part's point). Muse's boxes are not used for covering. Specs without the boxes, or with an empty or unusable list, fall back to Muse's boxes (`lib/labelDiagramView.ts` `figureLabelMasks`, `coverMasks`, `coverSource`). Reveal (final slide step, or **Show the answers**) uncovers all. |
| **Tags collide on reveal** | Each name tag sat above its SAM outline. Two parts at one height 150 grid units apart ("Adenine" and "Thymine") put tags on each other. | Tags are placed in lib `placeTags`, deterministically. In spec order, each tag tries above its marker, then below, right and left. It then tries the same sides nudged sideways (at most half its length) and outwards. It takes the first spot clear of the figure's edges, the tags already placed, every cover and every marker. If no spot is clear, it takes the least-overlapping one inside the figure and flags it (`clear: false`). The view measures each name's width off-DOM (canvas, in the tag's font) and places every tag once per rendered size. A hidden tag therefore holds no answer text, and naming a part never moves another tag. |
| **Small figure on the slide** | Figure design 392 px tall + a two-line credit under it, beside a one-column number list. At 1366×768 it was 405 px (0.88 of the fitted stage area); at 1920×1080, 592 px (0.89). | Figure design 436 px tall (max 600 wide) = the part's whole height. The credit moves to the foot of the side column, and the number list uses two columns from five parts on. Now 445 px at 1366×768 (0.97 of the fit area, 0.88 of the stage) and 650 px at 1920×1080 (0.97 / 0.89). |
| Lesson figure size | Capped at 560 px and given 1.15fr of the body: **514.5 px** at 1920 with the source panel open. This was reproduced by re-applying the old two rules as an injected style on the same page. | Fills a 1.5fr column, up to 1.6× its natural width (`lessonFigureMaxWidth`): **577 px** at 1920 with the source panel open (0.96× natural for DNA, 1.01× for the water cycle). |
| Last reveal on a slide | Printed labels came back under the markers, outlines and tags. | On the labels step's R, outlines and tags fade out and markers dim to 35%. The figure's own words read cleanly, and the numbered list keeps every name. This changes opacity only, so nothing moves. |

"Fit area" is `.pz-fit`, the box StageFit scales the part into. "Stage" is `.pz-stage`, the heading plus the fit area.
The figure is 58% of the window height at both sizes. More would need a smaller quote zone or heading in `Beats.tsx`,
which this slice does not own: the figure already fills the whole fit area.

## Harness

`?engine-demo=c` has four tabs, all carrying the figures' stored label boxes (`data/figures/<id>.labels.json`) except
the bare layout check:

- golden (hand-made regions);
- **DNA (live run parts)**: Muse Spark 1.3 parts and SAM 3.1 regions of `job-20261031051459-6bf49d3d`, copied into
  `lib/labelDiagramDemoSpecs.ts`;
- **Water cycle (live run parts)**: the same for `job-20261031051634-7731ba24`;
- bare layout check.

A one-off script confirmed both copies `deepEqual` the stored `gen` and `regions`; a unit test pins the regions. With
these tabs the new covers can be checked on real model output. The stored live jobs themselves predate the label-box
fix, so they still show Muse-box covers.

## Measurements (`measurements.json`, raw sweeps in `present-sweeps.json`, `lesson-measurements.json`)

Presentation sweep over every step of each part. Each step reads every element rect in `.pz-beat` plus `.pz-zone`
before and after R, and after →, index-matched, with `captureBeyondViewport: false`. Before each R it also runs a leak
check: each unnamed name appears exactly once in the slide text (the word bank), never in the figure's DOM, never in an
aria-label.

| target | viewports × themes | steps | zoom 1366 / 1920 | figure px 1366 / 1920 | max Δy on R | max Δh on R | max Δy on → | tag overlaps | text leaks | scroll |
|---|---|---|---|---|---|---|---|---|---|---|
| harness DNA (live parts, stored boxes) | 2 × 2 | 7 | 1.020 / 1.491 | 445 / 650 | 0 | 0 | 0 | 0 | 0 | none |
| harness water cycle (live parts, stored boxes) | 2 × 2 | 7 | 1.020 / 1.491 | 445 / 650 | 0 | 0 | 0 | 0 | 0 | none |
| live `…6bf49d3d` DNA | 2 × 2 | 7 | 1.020 / 1.491 | 445 / 650 | 0 | 0 | 0 | 0 | 0 | none |
| live `…dbf3765c` water | 2 × 2 | 6 | 1.020 / 1.491 | 445 / 650 | 0 | 0 | 0 | 0 | 0 | none |
| live `…7731ba24` water | 2 × 2 | 7 | 1.020 / 1.491 | 445 / 650 | 0 | 0 | 0 | 0 | 0 | none |

Every sweep kept the zoom and element count on R. The document stayed at 768/768 and 1080/1080, and the fit area did
not scroll. No answer in the number list was cut off.

- **Lesson:** live jobs at 1920 (dark and light) and 1366, plus harness tabs at 1920. Figure width was 577 px at 1920
  and 423 px at 1366, with the source panel open in both. After **Show the answers**: 0 covers, 5–6 tags, 0 tag
  overlaps, and no page overflow.
- **Accessibility** (`lesson-a11y.json`): no duplicate ids and no unnamed buttons. The image has alt text. Hidden tags
  hold no text.

## Vision check (every kept frame, figure crops at full resolution)

- **Harness, stored boxes, before reveal** (step 1 and last-step ask, both sizes, both themes, DNA and water cycle):
  no printed word is readable. Covers hide all 7 DNA labels and all 8 water-cycle boxes, including "Snowmelt Runoff"
  and "Surface Runoff", which Muse never named.
- **Name tags** (last-step ask, all six named; lesson reveal): no tag overlaps another tag, a marker or a cover. No tag
  is cut at the figure edge. "Adenine" and "Thymine" sit side by side above markers 3 and 4.
- **Live jobs (no stored boxes, fallback): still leak, as expected.**
  - DNA: "Sugar phosphate", and the "ine" ends of Guanine and Cytosine.
  - Water: "Transpiration", "Precipitation", "Snowmelt Runoff", "Evaporation" and "Surface Runoff", readable beside or
    outside Muse's boxes.
  - In the lesson reveal of these jobs, a tag can sit on a printed word: it avoided Muse's offset box, not the word.

## Screens

- **Presentation:** `<target>-<768|1080>-<dark|light>-final-ask.png` for every target, size and theme.
  - Targets are `harness-dna-live`, `harness-water-live`, `live-dna`, `live-water1` and `live-water2`.
  - Each target also has `-768-dark-step1-ask.png`, `-768-dark-final-revealed.png` and `-1080-light-final-revealed.png`.
  - Before: `before-live-dna-768-dark-step1-ask.png`.
- **Lesson:**
  - `lesson-live-{dna,water1,water2}-1080-dark{,-revealed}.png`
  - `lesson-live-dna-1080-light{,-revealed}.png`
  - `lesson-live-dna-768-dark{,-revealed}.png`
  - `harness-lesson-dna-live-1080-light{,-revealed}.png`
  - `harness-lesson-water-live-1080-dark{,-revealed}.png`
- PNGs were quantised to 256 colours to keep the folder small (4.8 MB).

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 823 pass, 0 fail. `labelDiagramView.test.ts` has 25 tests; the 8 new ones
  cover:
  - pixel → % covers, padding, clamping and the point rule;
  - exact stored-box covers and never Muse's boxes;
  - fallback for missing, empty and unusable lists;
  - tag layout on the live DNA geometry at slide and lesson sizes, plus the golden and the water cycle;
  - the fixed side order, determinism and nudging when above-tags would collide;
  - the least-overlap fallback;
  - the lesson upscale cap;
  - the live copy pinned.
- `npm --prefix apps/web run build`: typecheck and build pass. Neither the harness text nor the figure files are in
  `dist/`.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]`.

## Remaining issues

1. **The three stored live jobs still leak**, because their specs predate `figure.labelBoxes`. Two fixes, both outside
   this slice: re-run the pages, or have the API fill `figure.labelBoxes` from `data/figures/<id>.labels.json` when it
   serves an older label-diagram spec (hash-bound like the worker). The view needs no change for either.
2. **Muse's points can sit on a printed word.** DNA Guanine (635, 527) lands inside the "Guanine" label box, and SAM's
   Guanine and Cytosine regions are the printed words, not the bars. Before the reveal the marker sits on the cover,
   which is harmless. After it, the marker hides part of the word: dimmed on the slide's last step, full strength in the
   lesson reveal. This needs a prompt rule or a check (a point inside a stored label box) — lead or Muse.
3. **The slide figure is 58% of the window height**, because the heading and the reserved quote zone in `Beats.tsx`
   take the rest. Within this slice the figure already fills about 97% of the fit area.
