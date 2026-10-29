# Repair: one remaining pin of the old kit cap

Your previous change (KIT_CALL_MAX_OUTPUT_TOKENS 12000 -> 24000, ANALYSIS_V2_MAX_OUTPUT_TOKENS 16000 -> 32000) is applied and its tests pass. One test in a file you did not receive still pins the old value:

```
test at packages/meta/pipeline-v2.branches.test.ts:414 'repairKitComponent guard order and codes'
AssertionError: Missing expected rejection (line 460) — expected /MAX_OUTPUT_TOKENS_INVALID/; an override of 12001 is now below the cap and is accepted.
```

Update `packages/meta/pipeline-v2.branches.test.ts` so every pin of the old caps uses the new ones (12001 -> 24001, 16001 -> 32001, 12000 -> 24000, 16000 -> 32000 where they mean the caps). Change nothing else. Return ONLY the complete file.
