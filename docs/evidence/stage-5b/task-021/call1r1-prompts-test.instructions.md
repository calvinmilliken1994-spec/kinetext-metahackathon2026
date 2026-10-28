# TASK-021 call 1 repair 1 (prompts.timeline.test.ts)

The lead saved your two files from call 1 verbatim and ran `npm run check`. Typecheck passes and every existing test passes; one of your new tests fails (failure output below). All other assertions in that test hold (the lead evaluated each assertion of the file separately: only line 215 is false).

Cause: the timeline repair system prompt says "Never change the engine: it must stay timeline-v1." (capital N), while the test asserts the lower-case phrase with a case-sensitive `sys.includes('never change the engine')`. The formula-engine test in prompts.test.ts uses `lower.includes(...)` for the same phrase.

Fix the test (compare on `sys.toLowerCase()` for that phrase); do not change prompts.ts. Output only `packages/meta/prompts.timeline.test.ts` (complete file, one ts block), then `=== NOTES ===`. Change nothing else in the file.
