# Stage 8a re-run on prompts s6-v8, 2026-10-31 (Muse Spark 1.3)

This re-ran the pages where s6-v7 never planned the new engines (`../live-smoke/`). It was 4 lessons for **USD 0.47**, at 90–120 s each.

| Page | Job | Plan → result |
|---|---|---|
| NIST binary search | `job-20261031023947-3171fbc9` | **algorithm trace ✓** first try, quiz ✓ |
| NIST bubble sort | `job-20261031023947-4ddddd11` | **algorithm trace ✓** first try, quiz ✓ after 1 repair |
| NIST quicksort | `job-20261031024127-4b9b54d5` | **algorithm trace ✓** first try, quiz ✓ |
| NARA amendment process | `job-20261031023947-5ee5858d` | sequence ✓ after 1 repair, **threshold ✓** first try |

The planning fix worked: the tracer was chosen on all 3 algorithm pages, and the threshold was planned alongside the amendment process. Every new-engine part passed on its first revision. The two repairs were in existing components:

- **Quiz (bubble sort).** Q-06 caught two distractor options stating "1", a number that appears nowhere on the page. The repair replaced them.
- **Sequence (amendment).** The publisher-claim sweep flagged the step label "Certification published as official notice" because of the word "official". The repair reworded it. This rule is strict by design: "official" is one of the words that can imply endorsement. It is not a model error worth showing in the demo.
