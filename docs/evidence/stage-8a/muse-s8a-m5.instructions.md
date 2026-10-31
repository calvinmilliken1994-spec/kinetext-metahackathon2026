# Task S8A-M5: the plan never picks two of the new engines (prompt s6-v8)
First live run of s6-v7 on the engine pages (2026-10-31, 8 lessons, all succeeded). The log ladder, threshold and data table were chosen and passed; but the analysis never planned algorithm-trace-v1, and planned no threshold on the amendment page. Your real plans:
- nist-dads-binary-search: subject computing; plan sequence-v1 (Models the ordered narrowing steps from full interval to found or empty in page order.); quiz-cards-v1 (Checks checkable facts about logarithmic run time and safe middle calculation.)
- nist-dads-bubble-sort: subject computing; plan sequence-v1 (Introduces the ordered compare and swap loop before checking factual details.); quiz-cards-v1 (Reinforces aliases, sort properties and complexity after the process is clear.)
- nara-constitutional-amendment-process: subject civics; plan sequence-v1 (Models the multi-step amendment process in taught order from proposal to certification.); quiz-cards-v1 (Checks recall of proposal methods, ratification rule, and official roles.)
Root cause found by the lead: the 'when' row for algorithm-trace-v1 says "fits pages naming or describing a supported algorithm with a runnable example; not for prose-only mentions without a concrete input, use sequence-v1 instead" — but the component design text tells the generator to CHOOSE a small teaching input itself (NIST dictionary pages describe the algorithm and never print an input). The two instructions contradict, so the planner falls back to sequence-v1. The amendment page states 'three-fourths of the States (38 of 50 States)', a full threshold-v1 fit, yet quiz-cards-v1 was preferred.
Change `packages/meta/prompts-v2.ts`:
1. `STAGE6_PROMPT_VERSION` 's6-v7' -> 's6-v8'.
2. algorithm-trace-v1 'when' row: fits pages that name or describe one of the supported algorithms (ALGORITHM_IDS) even without a printed example, because the generator chooses the small teaching input; not for algorithms outside that list or pages that only mention an algorithm in passing (use sequence-v1 then).
3. Plan guidance (computing and civics subject rows, and/or plan rules, in the existing style): when a page describes a supported algorithm, plan algorithm-trace-v1 first (a sequence-v1 of the same steps is then a duplicate; pair it with quiz-cards-v1 or compare-table-v1 instead); when a civics page states a vote or ratification rule with its total, plan threshold-v1 alongside the process (e.g. sequence-v1 + threshold-v1) in preference to quiz-cards-v1.
4. Keep everything else byte-identical.
Change `packages/meta/prompts-v2.test.ts`: version pin; tests that the algorithm-trace 'when' row no longer requires a printed example and that the computing guidance says to plan algorithm-trace-v1 first for a supported algorithm; civics prefers threshold-v1 alongside the process when a rule and total are stated.
Return the two complete files.

(Followed by the two current files in full; omitted here.)
