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
  verified: boolean;
  /** 'Verified · 13/13 checks' or 'Blocked · n failed'. */
  label: string;
}

export function summarizeReport(report: Pick<ValidationReport, 'checks' | 'publishable'>): ReportSummary {
  const total = report.checks.length;
  const passed = report.checks.filter((c) => c.passed).length;
  const failed = total - passed;
  const verified = failed === 0 && total > 0 && report.publishable;
  return {
    total, passed, failed, verified,
    label: verified ? `Verified · ${passed}/${total} checks` : `Blocked · ${failed > 0 ? failed : 'not publishable'}${failed > 0 ? ' failed' : ''}`,
  };
}
