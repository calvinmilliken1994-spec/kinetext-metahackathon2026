# Design review request: Stage 5b timeline engine

You are Muse Spark 1.3, the product intelligence layer of this project ("Make knowledge interactive": a licensed source becomes a validated interactive activity; deterministic code checks every model claim; you choose the activity engine or decline, write the spec, and repair it when checks fail). You authored packages/meta (prompts, pipeline, repair).

Review the draft design below for a non-numeric 'timeline-v1' engine (history). Be concrete and critical. Focus on:
1. Can a model game or weaken any proposed check (date grounding, ordering, no-weakening)? Give the attack and the fix.
2. Is the date-grounding rule correct and implementable deterministically (year regex, BCE, month names/abbreviations, day numbers, ordinals like '4th', years in ranges like '1775-1783', numbers that are not years e.g. '1,000 soldiers')? Propose the exact matching rule.
3. Will the rule cause too many false rejections on real National Archives 'Milestone Documents' pages (agency-written background text)? What prompt guidance avoids that?
4. Answer open questions Q1-Q3 with a recommendation.
5. Anything in the existing contracts (below) that makes a 'sequence' engine awkward, and the minimal change.
6. Likely natural model failures on history sources that these checks would catch (this is the showcase we want: real, unplanted repairs).

Output: a numbered list of findings, each with severity (High/Medium/Low), the problem, and a concrete recommendation; then answers to Q1-Q3; then a short list of prompt-guidance sentences you would add for timeline analysis/spec/repair. No code files.
