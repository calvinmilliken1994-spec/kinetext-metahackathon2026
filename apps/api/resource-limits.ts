// Stage 5 review S5-06 — startup validation of config/resource-limits.json.
//
// The absolute ≤2 repair rule is enforced here as a hard bound: maxRepairAttempts
// must be an INTEGER in [0, MAX_REPAIR_ATTEMPTS_BOUND]; fractions, 3+, negatives
// and non-numbers all fail closed with RESOURCE_LIMITS_INVALID (apps/api/main.ts
// exits 1 with that code). The same bound is enforced again at the worker
// boundary (workers/generation/jobs.ts startJob), so no wiring can smuggle a
// larger count past startup. All other runtime bounds keep their TASK-009 R-11
// fail-closed rules (finite positive numbers; a valid TCP lock port).
//
// OW-2 additions (open-weights mode):
//   providerCapsUSD  REQUIRED per-provider soft caps for the spend ledger
//                    ({ 'meta-api', 'modal' }, both finite positive). The
//                    meta-api cap must equal stageCapsUSD.stage2 whenever that
//                    stage cap is present, so the ledger's two checks for
//                    Meta-API spend can never disagree.
//   modalBaseUrl     REQUIRED Modal Shared Endpoint base URL (NOT a secret —
//                    the dashboard-copyable endpoint address; auth comes from
//                    MODAL_PROXY_TOKEN in the environment). Validated as a
//                    plain https URL without credentials/query/fragment and
//                    normalised by stripping trailing slashes, mirroring the
//                    packages/meta client's own checks so a config the startup
//                    accepts can never fail later at client construction.

import { MAX_REPAIR_ATTEMPTS_BOUND } from '../../workers/generation/jobs.ts';
import type { MetaProvider } from '../../packages/meta/pricing.ts';

export { MAX_REPAIR_ATTEMPTS_BOUND };

export interface RuntimeLimits {
  /** Stage cap from stageCapsUSD.stage2; a missing cap defaults to zero spend. */
  capUSD: number;
  /**
   * OW-2: per-provider ledger caps, both keys required and finite positive;
   * providerCapsUSD['meta-api'] === capUSD whenever stageCapsUSD.stage2 exists.
   */
  providerCapsUSD: Readonly<Record<MetaProvider, number>>;
  /** OW-2: validated Modal endpoint base URL (trailing slashes stripped). */
  modalBaseUrl: string;
  wallTimeMs: number;
  maxOutputTokens: number;
  /** Output cap for the analysis call (reasoning + JSON); must not exceed maxOutputTokens. */
  analysisMaxOutputTokens: number;
  maxInputTokens: number;
  /**
   * S6-W (lead freeze addendum, 2026-10-29): the client input bound for Stage 6 lesson-flow
   * (v2) calls — the bound counts BYTES (DEBT-003) and the v2 analysis/repair prompt family
   * needs more headroom than v1's 32,000. REQUIRED, a positive integer, and never above the
   * provider context window (PROVIDER_CONTEXT_TOKENS); fail closed at startup like every
   * other bound. v1 activity calls keep maxInputTokens.
   */
  maxInputTokensV2: number;
  /** Integer in [0, MAX_REPAIR_ATTEMPTS_BOUND]. */
  maxRepairAttempts: number;
  /**
   * Concurrency (BUG-006 wave, part B): how many live jobs the API runs at once.
   * Integer in [1, MAX_CONCURRENT_JOBS_BOUND]; DEFAULT_MAX_CONCURRENT_JOBS (3) when the
   * field is absent (a pre-concurrency config still parses). Wired into createApiServer
   * by main.ts; POST /api/jobs answers the busy 409 only when that many jobs are running.
   */
  maxConcurrentJobs: number;
  ledgerLockPort: number;
  /**
   * Stage 10: the judging-period budget in USD for jobs started under a judge access
   * session. Explicit value: finite, > 0 and <= the smaller of the provider caps' sum and
   * the stage cap (else RESOURCE_LIMITS_INVALID). Absent: DEFAULT_JUDGE_CAP_USD (50), clamped
   * to that same bound so a pre-Stage-10 config (or one with smaller caps) still parses.
   */
  judgeCapUSD: number;
}

/** Stage 10: the default judge budget (USD) when judgeCapUSD is absent from the config. */
export const DEFAULT_JUDGE_CAP_USD = 50;

/**
 * The provider context window the v2 input bound is validated against: muse-spark-1.3 has a
 * 1,048,576-token context (docs/MODEL_ROUTING.md); the open-weights Spark Open endpoint is the
 * same model family. The client's bound counts bytes as a token upper bound (DEBT-003), so this
 * stays a conservative ceiling, not a tokenizer guarantee.
 */
export const PROVIDER_CONTEXT_TOKENS = 1048576;

/** S6-W: the v2 input bound must be a positive integer within the provider context window. */
export function validInputTokensV2(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v > 0 &&
    v <= PROVIDER_CONTEXT_TOKENS
  );
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

/** Concurrency (part B): the absolute bound on simultaneously running jobs. */
export const MAX_CONCURRENT_JOBS_BOUND = 8;
/** Concurrency (part B): the product default when the config predates the field. */
export const DEFAULT_MAX_CONCURRENT_JOBS = 3;

/** Concurrency (part B): a positive integer in [1, MAX_CONCURRENT_JOBS_BOUND] — fail closed. */
export function validMaxConcurrentJobs(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_CONCURRENT_JOBS_BOUND;
}

const PROVIDER_KEYS: readonly MetaProvider[] = ['meta-api', 'modal'];

/**
 * OW-2: parse providerCapsUSD. REQUIRED, exactly the two known provider keys,
 * each a finite positive number; the meta-api cap must equal the stage-2 cap
 * when that cap is configured. Any other shape throws RESOURCE_LIMITS_INVALID.
 */
function parseProviderCaps(raw: unknown, stage2: unknown): Record<MetaProvider, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!(PROVIDER_KEYS as readonly string[]).includes(key)) {
      throw new Error('RESOURCE_LIMITS_INVALID'); // unknown provider key: fail closed
    }
  }
  const out = {} as Record<MetaProvider, number>;
  for (const key of PROVIDER_KEYS) {
    const v: unknown = rec[key];
    if (!finitePositive(v)) {
      throw new Error('RESOURCE_LIMITS_INVALID');
    }
    out[key] = v;
  }
  if (stage2 !== undefined && out['meta-api'] !== stage2) {
    // The ledger enforces BOTH the stage cap and the provider cap for meta-api
    // spend; a config where they disagree is an operator error, not a runtime
    // surprise — fail closed at startup.
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  return out;
}

/**
 * OW-2: parse the Modal endpoint base URL — a plain https URL without embedded
 * credentials, query or fragment (the same checks the packages/meta client
 * applies), normalised by stripping trailing slashes. Not a secret; the proxy
 * token never comes from config.
 */
function parseModalBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  const stripped = raw.replace(/\/+$/, '');
  if (stripped === '') {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  return stripped;
}

/**
 * Parse and validate the raw resource-limits config. Throws
 * Error('RESOURCE_LIMITS_INVALID') for any invalid bound (main.ts exits 1).
 */
export function parseResourceLimits(raw: unknown): RuntimeLimits {
  const limits = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    stageCapsUSD?: { stage2?: unknown };
    providerCapsUSD?: unknown;
    modalBaseUrl?: unknown;
    maxJobWallTimeMs?: unknown;
    maxOutputTokens?: unknown;
    analysisMaxOutputTokens?: unknown;
    maxInputTokens?: unknown;
    maxInputTokensV2?: unknown;
    maxRepairAttempts?: unknown;
    maxConcurrentJobs?: unknown;
    ledgerLockPort?: unknown;
    judgeCapUSD?: unknown;
  };
  const stage2: unknown = limits.stageCapsUSD?.stage2;
  const capUSD: number = typeof stage2 === 'number' ? stage2 : 0; // default zero spend
  const wallTimeMs: unknown = limits.maxJobWallTimeMs;
  const maxOutputTokens: unknown = limits.maxOutputTokens;
  const analysisMaxOutputTokens: unknown = limits.analysisMaxOutputTokens;
  const maxInputTokens: unknown = limits.maxInputTokens;
  const maxInputTokensV2: unknown = limits.maxInputTokensV2;
  const maxRepairAttempts: unknown = limits.maxRepairAttempts;
  const maxConcurrentJobsRaw: unknown = limits.maxConcurrentJobs;
  // Concurrency (part B): absent → the documented product default; present but not an
  // integer in [1, MAX_CONCURRENT_JOBS_BOUND] → fail closed like every other bound.
  let maxConcurrentJobs: number = DEFAULT_MAX_CONCURRENT_JOBS;
  if (maxConcurrentJobsRaw !== undefined) {
    if (!validMaxConcurrentJobs(maxConcurrentJobsRaw)) {
      throw new Error('RESOURCE_LIMITS_INVALID');
    }
    maxConcurrentJobs = maxConcurrentJobsRaw;
  }
  const lockPort: unknown = limits.ledgerLockPort;
  if (
    !finitePositive(wallTimeMs) ||
    !finitePositive(maxOutputTokens) ||
    !finitePositive(analysisMaxOutputTokens) ||
    (analysisMaxOutputTokens as number) > (maxOutputTokens as number) ||
    !finitePositive(maxInputTokens) ||
    // S6-W: the lesson-flow input bound fails closed like every other bound, and must
    // stay within the provider context window (lead freeze addendum, 2026-10-29).
    !validInputTokensV2(maxInputTokensV2) ||
    !validRepairAttempts(maxRepairAttempts) ||
    !validLockPort(lockPort)
  ) {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  // OW-2: per-provider caps and the Modal endpoint base URL fail closed too.
  const providerCapsUSD = parseProviderCaps(limits.providerCapsUSD, stage2);
  const modalBaseUrl = parseModalBaseUrl(limits.modalBaseUrl);
  // Stage 10: the judge budget cannot exceed what the ledger could ever let through.
  const judgeBound: number = Math.min(providerCapsUSD['meta-api'] + providerCapsUSD.modal, capUSD);
  let judgeCapUSD: number;
  if (limits.judgeCapUSD === undefined) {
    judgeCapUSD = Math.min(DEFAULT_JUDGE_CAP_USD, judgeBound);
  } else if (finitePositive(limits.judgeCapUSD) && limits.judgeCapUSD <= judgeBound) {
    judgeCapUSD = limits.judgeCapUSD;
  } else {
    throw new Error('RESOURCE_LIMITS_INVALID');
  }
  return {
    capUSD,
    providerCapsUSD,
    modalBaseUrl,
    wallTimeMs,
    maxOutputTokens,
    analysisMaxOutputTokens: analysisMaxOutputTokens as number,
    maxInputTokens,
    maxInputTokensV2,
    maxRepairAttempts,
    maxConcurrentJobs,
    ledgerLockPort: lockPort,
    judgeCapUSD,
  };
}
