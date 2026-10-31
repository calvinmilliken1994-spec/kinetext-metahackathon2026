# Stage 7–9 web review — part 2

Reviewer: GPT-6.1 Sol, High reasoning. Scope: presentation answer concealment not covered in part 1; Stage 7 teacher-polish state/correctness; accessibility; concrete performance issues. Read-only review except this report. Findings were recorded incrementally. Part 1’s W-01–W-11 findings and executed test/build gates were not repeated.

## Findings

| ID | Severity | File:line | Evidence | Suggested fix |
|---|---|---|---|---|
| W2-01 | Medium | `apps/web/src/components/presentation/PresentationMode.tsx:175–200,233–240`; `apps/web/src/lib/presentation.ts:706–711` | **Back leaves the quiz answer visible while its quote is hovered.** Browser: DNA `?present=job-20261031081105-21355f66&beat=5&tour=0`, R, move pointer over the revealed quote, then ←. The beat changed to `data-revealed=false`; the zone still printed “DNA, or deoxyribonucleic acid, is the hereditary material in humans and almost all other organisms.” The zone links itself, and `zoneQuote` prefers that active hover over concealment. An initial CDP mouse call timed out, but the subsequent DOM read confirmed the hover took effect and the Back reproduction succeeded. | On concealment, clear or suppress answer-bearing hovered/pinned quotes, including the zone’s own link. Test R→hover quote→← for every ask beat. |
| W2-02 | Medium | `apps/web/src/components/presentation/Beats.tsx:108–123` | **Hover answers the key-term question before its meaning is revealed.** Browser: DNA beat 3 opened with every meaning showing “What does it mean?” and an empty quote zone. Dispatching the normal mouseover event on the first `.pz-term` put “Most DNA is located in the cell nucleus (where it is called nuclear DNA)” in the zone while the meaning stayed hidden. `part2-terms-keyboard.json` records both states. `TermsBeat` links every term at step 0, including its hidden definition. | Keep a term’s definition-bearing links disabled until that meaning is shown. Cover initial hover and reveal→Back→hover in a composed test. |
| W2-03 | Low | `apps/web/src/components/LabelDiagramView.tsx:495–513`; `apps/web/src/components/EquationLine.tsx:25`; `apps/web/src/components/Linked.tsx:38–44` | **Some presentation citations are mouse-only.** In the DNA diagram beat, all six bank entries are hover-linked paragraphs with `tabIndex=-1` and no focusable descendants; the entire beat has no tab stops. A keyboard user cannot trigger those source quotes. The formula’s linked equation is also a paragraph with no tab stop. `Linked` supplies focus handlers but does not make its host focusable. Browser inventory: `part2-terms-keyboard.json`; the ladder’s linked rungs show the working `tabIndex=0` pattern. | Give noninteractive citation targets an intentional keyboard-focus path and visible focus styling, or provide a labelled citation button. Do not make unrevealed answers reachable when fixing this. |
| W2-04 | Medium | `apps/web/src/components/RunsDrawer.tsx:38–59`; `apps/web/src/styles.css:971–977` | **The overlay drawer lets keyboard focus escape behind it.** At 1264 px, open DNA’s Runs panel: the scrim is displayed and focus starts on “Runs and checks”. One real Shift+Tab focused a background quiz’s “Show hint” button. `elementFromPoint` at that button’s center returned the drawer’s run row, confirming the focused control was covered. Evidence: `part2-drawer-focus.json`. The drawer has neither a narrow-mode focus trap nor inert background handling. | Treat narrow-mode drawers as modal dialogs: contain focus, make the covered workspace inert, name the dialog, and restore the opener on close. Preserve the nonmodal behavior of the wide side-by-side layout. |
| W2-05 | Medium | `apps/web/src/lib/presets.ts:55–71,81–87`; `apps/web/src/components/ProjectileView.tsx:121–123,255–258` | **“Page-stated” gravity presets match numbers without their role or unit.** Executed `part2-presets-probe.mjs` with the unchanged stored Moon activity and an explicitly synthetic source: “The Moon has gravity 1.62 metres per second squared. The experiment lasts 9.8 seconds.” `pagePresets` returned a `9.8 m/s²` preset citing the duration sentence; `comparisonValues` returned `[9.8]`. The view calls those ghost gravities “the other values the page states”. No model call or stored artifact was changed; this demonstrates the helper’s role mismatch, not a defect in the existing Moon source. | Only create a gravity preset from a checked gravity/unit binding, not arbitrary numeric-token overlap. Otherwise label it a lesson-case value and do not assert that the page states that gravity. Add the duration-token negative test. |

## Verified correct

### Presentation coverage

`part2-beat-checks.json` records **12 initial→R→Back checks across six stored lessons**: four subject-engine beats (DNA diagram, pH ladder, IRS table, quicksort), six quiz beats, and two numeric predict beats (Drag formula and Moon projectile). Every Back state reported `data-revealed=false`. This state check alone does not prove concealment; W2-01 demonstrates why. The report does not repeat part 1’s comparison or threshold findings.

| Type / surface | Verified result and limits |
|---|---|
| Quiz | The six sampled first-card beats did not mark the correct choice before R and removed the correctness mark on Back. `Choices` hides reserved marks/details from accessibility. The quote-zone exception is W2-01. |
| Sequence | Stored `job-20261031111125-16528ee3`, beat 4: all five reserved answer blocks had `visibility:hidden` and `aria-hidden=true` before Check, with zero linked cards. Check exposed five page positions and enabled five card links. Moving a card kept focus on its named move button. A sequence is an interactive **stage** beat, not an R-driven ask beat (`presentation.ts:284–285`); its Check button controls reveal. Evidence: `part2-sequence-controls.json`. |
| Formula explorer | Drag beat 4 returned to the same concealed scene on Back: graph title described the value as hidden; equation result and answer panel showed `?`. The y-axis text remains in SVG DOM but is visually suppressed by `sim.css:88`; the SVG’s accessible name is concealment-aware (`FormulaGraph.tsx:32–46`). This is not protection from DOM inspection. |
| Simulations | Moon’s scene, equation and answer panel re-concealed after the complete reveal animation, not just an early R→Back. The flight title did not disclose its height before R. Evidence: `part2-settled-back.json`. Reviewed the concealment branches in forces, projectile, lift, sound, compound-interest, Hardy–Weinberg and half-life views; only Moon was browser-exercised here. Numeric axis/curve geometry is still instructional information, not a secrecy boundary. |
| Algorithm tracer | After quicksort fully reached “Position 3” and `data-revealed=true`, Back restored the original list, zero counters and the open prediction. Evidence: `part2-settled-back.json`. |
| Log ladder | The pH answer returned to `?`. Running-multiplier items use `visibility:hidden`, not opacity alone (`engines-a.css:221–231`). The 250 ms Back snapshot differed by one transient ×10 gap; after checking the texts, no retained computed multiplier was established. |
| Data table | IRS tax totals and per-band tax values returned to `?` on Back. Tax input resets when presentation reveal changes (`DataTableView.tsx:52`). Lookup-target cells also suppress links and use hidden, aria-hidden reservations (`DataTableView.tsx:24–35,145,257–269`); lookup and extreme-row questions were source-reviewed, not separately browser-exercised. |
| Label diagram | DNA’s first named part returned to `?` on Back; the figure alt text contained the general caption, not a number-to-name answer. Source-reviewed final-label/step handling in `StageDiagram`. This does not revalidate the semantic label-to-slot mapping from W-01. |

### Stage 7 teacher polish and accessibility

- Reviewed current opening-case, hover-linking, preset/ghost, `RunsDrawer` and `PipelinePanel` code. Closed-form activities and forces open/reset from `defaultInputs`; formula explorer uses its first case. Predict-beat concealment overrides local reveal state in `ActivityView.tsx:73–89` and `FormulaExplorerView.tsx:85–102`.
- `PipelinePanel` disables generation when health or source selection disallows it, and locks model/run-option changes while busy. No further concrete state bug was established in the reviewed code. No generation or source write was attempted.
- Browser accessibility-tree inspection of the sequence presentation found **no unnamed exposed buttons**. A real Tab focused a sequence move button with a solid visible outline; the controls bar remained shown. The icon controls in `PresentationMode.tsx:279–300` have accessible labels. This is a targeted sweep, not a full accessibility audit.
- Reduced-motion CSS exists for presentation transitions, formula reveal, engine views and simulation decoration. The algorithm tracer also observes the media query and skips intermediate reveal frames (`AlgorithmTraceView.tsx:30–39,370–375`). The playback hooks do not consult reduced motion; these user-started scientific simulations were not classified as a demonstrated accessibility defect. Reduced-motion runtime behavior was not comprehensively tested.

### Performance

No new measured performance defect was established. The bundle-size warning and cleanup checks already recorded in part 1 are not repeated as new findings. A running-job render/polling profile was not possible within the GET-only scope; no job was created and no fake result is presented as a measurement.

## Could not verify

- The exact historical `c2c849a^`→`0b80d72` diff: this continuation explicitly prohibited Git commands. Stage 7 findings above concern current source and actual browser behavior, not attribution to a historical commit.
- Real running-job polling latency, request overlap or re-render cost. Read-only stored-run navigation cannot establish those measurements. No new production bundle/build measurement was made.
- Every stored lesson, every step/case, every tooltip/focus combination, all simulation types in a browser, screen-reader operation, high contrast, or all viewport/reduced-motion combinations. The coverage table separates browser evidence from source-only review.
- Live generation, model calls, POST routes, deployment or fixes. The review changed no application code and did not repeat part 1’s test/build gates.

## Review artifacts and boundaries

Local profile scratch `review/` (not committed): `part2-beat-checks.json`, `part2-terms-keyboard.json`, `part2-drawer-focus.json`, `part2-presets-probe.mjs`, `part2-presets-result.json`, `part2-sequence-controls.json`, `part2-settled-back.json`. The initial `part2-beats.json` contains an unsuccessful early-load inventory and is not used as evidence. The completed inventory is in `part2-beat-checks.json`.

Only this report was created/modified inside the repository. All browser navigation and API reads were GET-only, using isolated session `rev-web2`. No Git commands, installs, credential reads, model requests or implementation writes.

## Verdict

**Changes required: four Medium findings and one Low finding; no new measured performance blocker.**
