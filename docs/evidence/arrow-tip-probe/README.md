# Arrow-tip probe and five-part airplane builds (3 Nov 2026)

Calvin: "The models should be focusing on the tip of where the arrows are anyway." Question: does asking Muse Spark for
the end point of each label's arrow, and giving that point to SAM 3.1 with the box, stop SAM merging the touching tail
parts of the NASA Glenn airplane figure (insignia removed, `data/figures/nasa-grc-airplane-parts-1.jpg`)?

## Probe (`probe.ts`, 3 reps, `result.json`, `overlay-rep*-{box,box-tip}.jpg`)

Muse Spark 1.3 grounding with a "follow the arrow to its end, give that point as tip" instruction; SAM 3.1 prompted
(A) with Muse's box alone, as the app does, and (B) with the box plus the tip point.

- **Muse's arrow tips are accurate.** In all three reps every tip sits at the end of its label's arrow, including the
  arrows that point at the far wing and the far tailplane.
- **The tip does not help SAM.** Box plus tip scored the same or lower than box alone, twice returned no region for a
  part (jet engine rep 2, horizontal stabilizer rep 3), and in rep 2 still outlined both tail surfaces as one.
- Cockpit is not a separately drawn shape (windows on the nose); SAM's region for it varied from a thin strip to the
  whole nose. Not usable.

Box alone, SAM confidence per rep: wing 0.97/0.95/0.94, jet engine 0.92/0.29/0.94, fuselage 0.83/0.83/0.89,
vertical stabilizer 0.91/0.93/0.81, horizontal stabilizer 0.91/0.90/0.66.

## Builds (`plan-builds.json`, `results-builds.jsonl`), Muse Spark 1.3, parts: vertical stabilizer, horizontal stabilizer, wing, flaps, fuselage

Page temporarily un-retired with these five label groups, then restored (the commit keeps it retired, groups 1/3/5/6).

| Job | Result |
|---|---|
| `job-20261102194352-54e2ada9` | published first try (0.66 / 0.93 / 0.93 / 0.61 / 0.79), 75 s, USD 0.147 |
| `job-20261102194352-fbebea7f` | published after one repair (LD-02: Muse named the part "fuselage or body"), 155 s, USD 0.229 |
| `job-20261102194352-063eea64` | held back: r1 flaps 0.35 (LD-06/LD-11), r2 vertical stabilizer spilled past Muse's box (LD-06), 125 s, USD 0.199 |

2 of 3 published. The vertical stabilizer spilling into the tail is the same failure as on 2 Nov; flaps are weak
(0.35 to 0.61). Not demo-reliable, so the page stays retired.

Spend: probe about USD 0.08 (3 Muse grounding calls, 3 SAM calls), builds USD 0.576.

## Jet-engine version (Calvin: try it in the real app), Muse Spark 1.3, parts: horizontal stabilizer, wing, jet engine, fuselage

Validation change first (test-first): a singular printed label counts as named when the page uses its plural ("Jet
Engine" / "jet engines"), in `pageWordingOfLabel` and LD-02's name-in-quote rule (`phraseOrPluralOccurs`). Page
un-retired on trial; `partLabelGroups` [3, 5, 7, 11].

| Job | Result |
|---|---|
| `job-20261102195358-7694fc91` | published first try (0.90 / 0.94 / 0.67 / 0.66), 85 s, USD 0.141 |
| `job-20261102195358-9edc95fe` | published after one repair (LD-10: the first draft left out the jet engine), 155 s, USD 0.246 |
| `job-20261102195358-06dcd649` | held back: r1 jet engine 0.34 and outside Muse's box (LD-06/LD-11); r2 wings and body overlap, IoU 0.60 (LD-07), 140 s, USD 0.225 |

2 of 3 published again.
