# Stage 8b view pass 3: names in the figure's own label slots

Calvin's feedback on the DNA slide ("some of the original boxes seem to be misplaced or could be in place of the
pre-existing boxes?"): the grey covers sat on the printed words but read as empty floating boxes, the revealed names
floated elsewhere as tags, and two large SAM outlines (base pairs, backbone) covered most of the helix.

## What changed (apps/web only)

| Area | Before | Now |
|---|---|---|
| Covers | Grey blocks, one per stored box | Worksheet label slots: the printed label's footprint, light paper fill, thin rule, 3 px radius. Stored boxes that are one printed label (a word box inside its line box, or stacked lines such as "Sugar phosphate / backbone") form one slot. |
| Revealed names | Floating blue tags near the markers | Written INTO the part's own slot, one shared font size per figure, shrunk to fit, at most 2 lines. A floating tag is used only for a part with no matched slot (e.g. "clouds" in the older water run). |
| Part to slot | (none) | Muse's own label box per part (0..1000) matched to the stored slots: any overlap first, else nearest centre within 10% of the figure's longer side, best pair first, one part per slot. |
| SAM outlines | Every named part's outline, all at once | Slide: only the current part's outline (ask and reveal), none on the labels step. Lesson: only the hovered or focused part (marker, row, named slot). Faint. |
| Lesson | Show the answers uncovered every printed label and showed tags | Show the answers writes each name into its slot; slots no part names are uncovered. A name the class placed right is written in after Check and stays until that number's name changes. |
| Older lessons (no stored boxes) | Muse-box covers + tags | Unchanged (fallback covers + floating tags). |

Stacking: a part still to be named keeps its marker above the slots; once named, its slot sits above the markers, so a
marker drawn close to a printed label never hides the name.

Files: `apps/web/src/lib/labelDiagramView.ts` (`groupLabelBoxes`, `labelSlots`, `slotOfPart`, `slotStates`,
`fitSlotText`, `fitSlotTexts`, `stageOutline`), `apps/web/src/lib/labelDiagramView.test.ts`,
`apps/web/src/components/LabelDiagramView.tsx`, `apps/web/src/styles/engines-c.css`,
`apps/web/src/lib/labelDiagramDemoSpecs.ts` (the two demo-set runs added as fixtures and harness tabs),
`apps/web/src/components/EngineDemoC.tsx` (wording).

## Matching on the real demo runs (tested)

| Run | Slot (stored boxes) | Part written in |
|---|---|---|
| DNA `job-20261031081105-21355f66` | 0 "Base pairs" / 1 "Thymine" / 2 "Adenine" / 3 "Guanine" / 4 "Cytosine" / 5+6 "Sugar phosphate backbone" | Base pairs / Thymine / Adenine / Guanine / Cytosine / Sugar-phosphate backbone |
| Water `job-20261031081105-910f3776` | 0 "Condensation" / 1 "Precipitation" / 2+3 "Transpiration" / 4 "Snowmelt Runoff" / 5 "Evaporation" / 6+7 "Surface Runoff" | Condensation / Precipitation / Transpiration / (none: blank until the last step) / Evaporation / Runoff |

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 873 pass, 0 fail (label diagram file: 34 tests, 9 new).
- `npm --prefix apps/web run build`: OK.
- impeccable detect on the files of this pass: `[]`. A whole-tree run shows 1 finding in `apps/web/src/styles/live.css`
  line 171, a file another agent was editing at the time (not part of this pass).
- R moves nothing: every element rect in `.pz-beat` and `.pz-zone`, before and after R on every step, with the name
  spans written inside fixed slots excluded as in-place content. Δ = 0 on all 7 DNA steps and all 6 water steps at
  1920×1080 and 1366×768, dark and light (`dy-dna.json`, `dy-water.json`; rows are `[step, moved elements, fits without
  scroll]`). Slide zoom 1.491 at 1920×1080, 1.020 at 1366×768.
- Nothing early: on every DNA ask step, the asked part's name is absent from the figure's text and aria-labels, the
  numbered list and the question (the word bank is the only place names appear). In the lesson, no part name is in the
  figure's text or aria-labels before Show the answers (both runs, both sizes).
- Lesson flow (DNA): Adenine on 3, Guanine on 4 (wrong), Base pairs on 1, Check: "2 of 6 right", Base pairs and
  Adenine written in their slots, the Thymine slot stays blank; hovering marker 2 shows only the backbone outline;
  moving a name off a number keeps the other confirmed names; leaving clears the outline.
- Older run without stored boxes (`job-20261031051459-6bf49d3d`): 0 slots, 6 fallback covers, floating tags shown on
  reveal, one outline (`fallback-older-dna-run-3-revealed-1920.jpg`).
- Every frame was looked at (vision check): names sit inside their slots, one outline at a time, final step shows the
  figure's printed labels clean.

Frames (JPEG, 22 files, 2.6 MB), live API GET-only on the running dev server, own browser session:
`present-dna-*` (step 1 ask, step 4 revealed, step 6 ask and revealed, final; 1920 dark, 1366 dark and light),
`present-water-*` (step 1 ask, step 3 revealed, final; 1920 dark, 1366 dark and light), `lesson-dna-*` and
`lesson-water-*` (before and after Show the answers, 1920 and 1366, plus a checked-with-hover frame),
`fallback-older-dna-run-3-revealed-1920.jpg`. Raw captures stay in a local scratch folder (not committed).

## Open issues

1. Names in slots are about the printed labels' size: on a 1366×768 slide that is roughly 12 px for the DNA figure. The
   numbered list beside the figure carries the large names; a bigger figure on the slide would need a layout change in
   Beats (not this slice).
2. In the DNA demo run Muse put the Guanine and Cytosine points 1 px above their printed labels, so once named the slot
   covers the lower half of markers 5 and 6 (by design: the name wins over a named marker).
3. Older lessons without stored boxes keep Muse's drifting covers, which leave parts of printed words readable (known;
   fixed by re-running those pages, as the demo-set runs were).
4. The figure `<img>` alt text carries the page's caption, which on the DNA page names "base pairs" and
   "sugar-phosphate backbone" (screen readers only; unchanged by this pass).
5. On a blue sky (water cycle) the accent border on the just-revealed slot is low contrast; the blue marker and the
   numbered list still show the current part.
