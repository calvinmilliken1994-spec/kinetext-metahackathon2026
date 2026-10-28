// Stage 5 review S5-06 — startup validation of config/resource-limits.json.
//
// The absolute ≤2 repair rule is enforced here as a hard bound: maxRepairAttempts
// must be an INTEGER in [0, MAX_REPAIR_ATTEMPTS_BOUND]; fractions, 3+, negatives
// and non-numbers all fail closed with RESOURCE_LIMITS_INVALID (apps/api/main.ts
// exits 1 with that code). The same bound is enforced again at the worker
// boundary (workers/generation/jobs.ts startJob), so no wiring can smuggle a
// larger count past startup. All other runtime bounds keep their TASK-009 R-11
// fail-closed rules (finite positive numbers; a valid TCP lock port).

import { MAX_REPAIR_ATTEMPTS_BOUND } from '../../workers/generation/jobs.ts';

export { MAX_REPAIR_ATTEMPTS_BOUND };

export interface RuntimeLimits {
  /** Stage cap from stageCapsUSD.stage2; a missing cap defaults to zero spend. */
  capUSD: number;
  wallTimeMs: number;
  maxOutputTokens: number;
  maxInputTokens: number;
  /** Integer in [0, MAX_REPAIR_ATTEMPTS_BOUND]. */
  maxRepairAttempts: number;
  ledgerLockPort: number;
}

/** R-11: config budgets must be finite positive numbers — fail closed at startup. */
function finitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** N-01/R-11: the ledger lock port must be a valid TCP port — fail closed at startup. */
function validLockPort(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;
}

/** S5-06: the repair bound must be an integer in [0, 2] — never a fraction, never larger. */
export function validRepairAttempts(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_REPAIR_ATTEMPTS_BOUND;
}

/**
 * Parse and validate the raw resource-limits config. Throws
 * Error('RESOURCE_LIMITS_INVALID') for any invalid bound (main.ts exits 1).
 */
export function parseResourceLimits(raw: unknown): RuntimeLimits {
  const limits = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    stageCapsUSD?: { stage2?: number };
    maxJobWallTimeMs?: unknown;
    maxOutputTokens?: unknown;
    maxInputTokens?: unknown;
    maxRepairAttempts?: unknown;
    ledgerLockPort?: unknown;
  };
  const capUSD: number = limits.stageCapsUSD?.stage2 ?? 0; // default zero spend
  const wallTimeMs: unknown = limits.maxJobWallTimeMs;
  const maxOutputTokens: unknown = limits.maxOutputTokens;
  const maxInputTokens: unknown = limits.maxInputTokens;
  const maxRepairAttempts: unknown = limits.maxRepairAttempts;
  const lockPort: unknown = limits.ledgerLockPort;
  if (
    !finitePositive(wallTimeMs) ||
    !finitePositive(maxOutputTokens) ||
    !finitePositive(maxInputTokens) ||
    !validRepairAttempts(maxRepairAttempts) ||
    !validLockPort(lockPort)
  ) {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  return {
    capUSD,
    wallTimeMs,
    maxOutputTokens,
    maxInputTokens,
    maxRepairAttempts,
    ledgerLockPort: lockPort,
  };
}
