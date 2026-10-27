// Group validator checks for display. Pure.

import type { CheckKind, ValidationCheck, ValidationReport } from '../../../../packages/contracts/index.ts';

export const KIND_ORDER: readonly CheckKind[] = ['schema', 'semantic', 'grounding', 'behavioral'];

export const KIND_LABEL: Record<CheckKind, string> = {
  schema: 'Schema',
  semantic: 'Semantic',
  grounding: 'Grounding',
  behavioral: 'Behavioural',
};

export const KIND_BLURB: Record<CheckKind, string> = {
  schema: 'Spec matches the JSON schema',
  semantic: 'Ranges, ids, budgets and policy',
  grounding: 'Sources exist, hashes match, quotes appear in the text',
  behavioral: 'Real engine reproduces every number',
};

export interface CheckGroup {
  kind: CheckKind;
  label: string;
  checks: ValidationCheck[];
  passed: number;
  failed: number;
}

export function groupChecks(report: Pick<ValidationReport, 'checks'>): CheckGroup[] {
  const groups: CheckGroup[] = [];
  for (const kind of KIND_ORDER) {
    const checks = report.checks.filter((c) => c.kind === kind);
    if (checks.length === 0) continue;
    const passed = checks.filter((c) => c.passed).length;
    groups.push({ kind, label: KIND_LABEL[kind], checks, passed, failed: checks.length - passed });
  }
  return groups;
}

export interface ReportSummary {
  total: number;
  passed: number;
  failed: number;
  /** Every machine check passed AND the report is publishable. Says nothing about explanation wording. */
  allPassed: boolean;
  /** 'Machine checks passed · 14/14' or 'Blocked · 2 of 14 checks failed'. Counts come from the report. */
  label: string;
}

export function summarizeReport(report: Pick<ValidationReport, 'checks' | 'publishable'>): ReportSummary {
  const total = report.checks.length;
  const passed = report.checks.filter((c) => c.passed).length;
  const failed = total - passed;
  const allPassed = failed === 0 && total > 0 && report.publishable;
  let label: string;
  if (allPassed) label = `Machine checks passed · ${passed}/${total}`;
  else if (failed > 0) label = `Blocked · ${failed} of ${total} checks failed`;
  else label = 'Blocked · not publishable';
  return { total, passed, failed, allPassed, label };
}

/** Always-passing scope check added by the validator (R-08): prose is not machine-verified. */
export const PROSE_CHECK_ID = 'scope.prose-unverified';

/** Shown when the report predates that check, because the limitation holds regardless. */
export const PROSE_FALLBACK_MESSAGE =
  'Explanation prose is AI-generated; quotes, numbers and ranges are machine-checked, the wording needs teacher review.';

export interface ScopeNotice {
  message: string;
  /** True when the message comes from the report's own scope.prose-unverified check. */
  fromReport: boolean;
}

export function proseScopeNotice(report: Pick<ValidationReport, 'checks'>): ScopeNotice {
  const c = report.checks.find((k) => k.id === PROSE_CHECK_ID);
  return c !== undefined ? { message: c.message, fromReport: true } : { message: PROSE_FALLBACK_MESSAGE, fromReport: false };
}
