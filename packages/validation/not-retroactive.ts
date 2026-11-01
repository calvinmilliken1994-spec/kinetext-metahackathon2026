// Checks that were added AFTER lessons were stored and that stored lessons fail by construction.
// Stage 8c: LD-10 (labels-covered) and LD-11 (regions-confident). The runs stored before Stage 8c were never asked
// for area boxes, for a part per printed label the page names, or for confident SAM regions, so judging them by these
// rules would withdraw lessons that were published under the rules in force then. New runs ARE held to both.
// Stored verdicts stay as recorded: `apps/api/recheck.ts`, `scripts/recheck-stored.ts` and the evidence e2e tests
// ignore these ids when re-checking STORED parts (docs/specs/STAGE-8c-label-coverage-and-outlines.md).

export const NOT_RETROACTIVE_CHECK_IDS: ReadonlySet<string> = new Set<string>(['LD-10', 'LD-11']);

/** The ids of the failed checks that count against a stored part (the not-retroactive ones are dropped). */
export function retroactiveFailedIds(checks: readonly { id: string; passed: boolean }[]): string[] {
  return checks.filter(c => !c.passed && !NOT_RETROACTIVE_CHECK_IDS.has(c.id)).map(c => c.id);
}
