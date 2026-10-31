# Stage 8b view: Label the diagram (`label-diagram-v1`)

Web slice U (Claude Opus 5.5), per `docs/specs/STAGE-8b-label-diagram.md`. Verified in a real browser on the dev
harness `?engine-demo=c` (Vite on :5173, no API calls: the harness serves the committed figure file through Vite).

**Fixture, not model output.** The parts are the committed golden `tests/fixtures/stage6/label-diagram.gen.json`; the
region boxes are hand-made around each point on the 600×600 NLM DNA figure (`lib/labelDiagramDemoSpecs.ts DNA_REGIONS`),
standing in for SAM 3.1. A test checks they satisfy the LD-06/LD-07 rules (contain the point, area fraction, IoU ≤ 0.6).
The second tab ("No label boxes") is a synthetic layout check: label boxes zeroed and one region missing.

## What a teacher sees

- **Lesson:** the page's own figure (white plate in both themes, ≤ 560 px) with every printed label covered by a plain
  grey block, a numbered marker on each part's point, and a word bank of the page's part names in a seeded order that is
  never the marker order. Drag a name onto a marker or a numbered row, or click a name and then a number (keyboard
  works the same way; names, markers and rows are buttons with spoken labels and a polite live region). A filled row
  has its own × to take the name off; dropping a name on a filled number sends the old name back to the bank.
  **Check** marks each number right or wrong (marker colour, row badge and ✓/× mark with a text label) and says
  "3 of 6 right. Some numbers have no name yet." **Hint** shows the spec's hint in a reserved line. **Show the answers**
  uncovers the printed labels, outlines each SAM region softly with its name tag, and shows each answer
  ("Adenine · you had Thymine"). The figure's caption and the credit line (`credit · license`) sit under the image.
  "Where the page names each part" folds out one QuoteBlock per page sentence (shared sentences merged) with
  "Show in source"; word-bank names and revealed rows hover-link to the source.
- **Presentation (engine beat):** one presenter step per part plus a last step for the printed labels (7 steps for the
  DNA figure; 6 when there are no label boxes). Step k asks "Which part is number k?" with the current marker in blue;
  the parts before it are named. R names part k (row, outline, name tag; its name in the bank is struck through) and
  puts that part's page sentence in the quote zone. The last step's R uncovers the figure's printed labels.

## Measurements

R and → sweep over all 7 steps (`present-R-deltas.json`): every element rect inside `.pz-beat` plus the `.pz-zone`
box, index-matched before/after (screenshots taken with `captureBeyondViewport: false`).

| viewport | theme | zoom | steps | max Δy on R | max Δh on R | max Δy on → | element count same | zoom same | scroll |
|---|---|---|---|---|---|---|---|---|---|
| 1366×768 | dark | 1.034 | 7 | 0 | 0 | 0 | yes | yes | none (459/459, doc 768/768) |
| 1366×768 | light | 1.034 | 7 | 0 | 0 | 0 | yes | yes | none |
| 1920×1080 | dark | 1.511 | 7 | 0 | 0 | 0 | yes | yes | none (668/668, doc 1080/1080) |
| 1920×1080 | light | 1.511 | 7 | 0 | 0 | 0 | yes | yes | none |

Two shifts the first sweep found, both fixed before the table above: a hidden answer cell rendered empty (0 px tall)
grew to one line on R (Δh 31 px inside the row; the row itself held), and the current outline's thicker border moved its
name tag by 1 px. Hidden answers now hold a no-break space, and the current outline uses a box-shadow.

Leak check before each R (`present-leak-check.json`): the slide's innerText contains each still-unnamed name exactly
once (the word bank, by design), no visible aria-label names a hidden part, and the quote zone is empty.
Lesson a11y sweep (`lesson-a11y.json`): no duplicate ids, no unnamed buttons, the image has alt text, no document
overflow. Production build: neither the harness text nor the figure jpg is in `dist/`.

## Screens

- Presentation: `present-768-dark-step1-ask.png`, `present-768-dark-step4-revealed.png`, `present-768-dark-step7-{ask,revealed}.png`,
  `present-768-light-step2-ask.png`, `present-768-light-step7-revealed.png`, `present-1080-dark-step1-ask.png`,
  `present-1080-dark-step3-revealed.png`, `present-1080-dark-step7-revealed.png`, `present-1080-light-step1-ask.png`,
  `present-1080-light-step5-revealed.png`, `present-768-dark-bare-step6-revealed.png` (no label boxes, backbone without a region).
- Lesson: `lesson-1080-{dark,light}-{window,open,checked,revealed}.png`, `lesson-768-light-window.png`.

## Verification

- `node --test apps/web/src/lib/*.test.ts`: 815 pass, 0 fail (17 in `labelDiagramView.test.ts`).
- `npm --prefix apps/web run build`: typecheck and build pass.
- `impeccable detect --json apps/web/src apps/web/index.html`: `[]` (0 findings).

## Open issues

1. **The golden's backbone label box stops short.** It ends at x = 697/1000, but "Sugar phosphate" is printed out to
   about 743, so "te" shows beside the cover. The view pads covers by 16 units left/right and 8 up/down (dropping the
   padding if it would hide a part point), which is not enough here. Muse's label boxes need to cover the whole printed
   word (prompt wording), or the worker could also segment the printed labels.
2. On small thin parts (the DNA colour key) the region name tags sit right above the marker and can overlap a
   neighbour's covered label or tag. Tags are raised past the marker (`pointDepth`), but nothing stops two tags from
   colliding.
3. The view reads the image from `GET /api/figures/<id>/image` (`FigureSrcContext`, the default). That endpoint is
   slice W's, and it was not exercised here: the harness overrides the source with the committed file.
4. These are hand-made regions, not real SAM output. Re-check the outlines on a stored live run once segmentation runs.
