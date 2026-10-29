// S6-W — small persistence/receipt helpers shared by the v1 activity flow (jobs.ts)
// and the Stage 6 lesson flow (lesson.ts). Moved verbatim out of jobs.ts so the lesson
// module can reuse them without a runtime import cycle (lesson.ts must not import
// jobs.ts values; jobs.ts imports lesson.ts). Behaviour is unchanged.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { MetaError } from '../../packages/meta/client.ts';
import { GeneratedOutputError } from '../../packages/meta/pipeline.ts';
import type { MetaReceipt, ValidationReport } from '../../packages/contracts/index.ts';
import type { LessonEventExtra } from './lesson.ts';

export function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Money stays readable in job.json: rounded to 1e-6 USD. */
export function roundCost(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * R-10: every JSON artifact is written atomically — a temp file in the same
 * directory, then rename — so a crash can never leave a half-written job.json.
 */
export function writeJsonAtomic(path: string, data: unknown): void {
  const tmpPath = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  renameSync(tmpPath, path);
}

export function receiptFields(receipt: MetaReceipt): LessonEventExtra {
  return {
    model: receipt.returnedModel,
    responseId: receipt.responseId,
    usage: receipt.usage,
    latencyMs: receipt.latencyMs,
    estCostUSD: receipt.estCostUSD,
  };
}

export function checksPassed(report: ValidationReport): number {
  return report.checks.filter(c => c.passed).length;
}

export function failedCheckIds(report: ValidationReport): string[] {
  return report.checks.filter(c => !c.passed).map(c => c.id);
}

export function readJsonFile(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/** N-04: the unknown-outcome portion is the explicit amount; a missing or invalid one counts as 0. */
export function reservedUnknownOf(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * F-01: recognise the pipeline's GeneratedOutputError (v1 or the v2 subclass) — via
 * instanceof, or via the duck-typed shape (code 'OUTPUT_INVALID' plus a receipt carrying
 * a finite estCostUSD) so a copy from another module instance is handled identically.
 * Returns the receipt whose cost must be accounted, or undefined.
 */
export function generatedOutputReceipt(err: unknown): MetaReceipt | undefined {
  let receipt: unknown;
  if (err instanceof GeneratedOutputError) {
    receipt = err.receipt;
  } else if (typeof err === 'object' && err !== null) {
    const candidate = err as { code?: unknown; receipt?: unknown };
    if (candidate.code !== 'OUTPUT_INVALID') {
      return undefined;
    }
    receipt = candidate.receipt;
  } else {
    return undefined;
  }
  if (typeof receipt !== 'object' || receipt === null) {
    return undefined;
  }
  const est: unknown = (receipt as { estCostUSD?: unknown }).estCostUSD;
  return typeof est === 'number' && Number.isFinite(est) ? (receipt as MetaReceipt) : undefined;
}

/**
 * S6R-07: what one caught error costs and how it fails, extracted ONCE so every catch
 * boundary (the v1 failFromError and each lesson-flow catch) accounts the same amounts:
 *   - GeneratedOutputError (F-01): its receipt, exactly like a successful call;
 *   - MetaError (R-09/N-04): chargedUSD when finite, else the receipt's estCostUSD; the
 *     unknown part is the EXPLICIT reservedUnknownUSD (on the error, else its receipt);
 *   - any other object that still carries a finite chargedUSD / reservedUnknownUSD /
 *     receipt.estCostUSD: the same amounts (money is never dropped), code INTERNAL.
 * The returned `extra` is the failed-event extras (fixed code detail, R-01: never
 * err.message or provider text). The caller accounts {chargedUSD, unknownUSD} through
 * the ONE accumulator BEFORE any fallible write, then fails with `code`/`extra` through a
 * NON-accounting path (so nothing is counted twice).
 */
export interface ErrorCharge {
  chargedUSD: number;
  unknownUSD: number;
  code: string;
  extra: LessonEventExtra;
}

function finiteOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function errorCharge(err: unknown, failExtra?: LessonEventExtra): ErrorCharge {
  const outputReceipt = generatedOutputReceipt(err);
  if (outputReceipt !== undefined) {
    return {
      chargedUSD: outputReceipt.estCostUSD,
      unknownUSD: reservedUnknownOf(outputReceipt.reservedUnknownUSD),
      code: 'OUTPUT_INVALID',
      extra: {
        ...failExtra,
        ...receiptFields(outputReceipt),
        detail:
          outputReceipt.costBasis === 'reservation'
            ? 'OUTPUT_INVALID; cost basis: reservation (outcome uncertain)'
            : 'OUTPUT_INVALID',
      },
    };
  }
  if (typeof err !== 'object' || err === null) {
    return { chargedUSD: 0, unknownUSD: 0, code: 'INTERNAL', extra: { ...failExtra, detail: 'INTERNAL' } };
  }
  const e = err as {
    code?: unknown;
    chargedUSD?: unknown;
    reservedUnknownUSD?: unknown;
    costBasis?: unknown;
    receipt?: unknown;
  };
  const receipt: MetaReceipt | undefined =
    typeof e.receipt === 'object' && e.receipt !== null && finiteOr((e.receipt as MetaReceipt).estCostUSD) !== undefined
      ? (e.receipt as MetaReceipt)
      : undefined;
  const charged = finiteOr(e.chargedUSD);
  const hasChargedUSD = charged !== undefined;
  const chargedUSD = charged ?? receipt?.estCostUSD ?? 0;
  const unknownUSD =
    e.reservedUnknownUSD !== undefined
      ? reservedUnknownOf(e.reservedUnknownUSD as number | undefined)
      : reservedUnknownOf(receipt?.reservedUnknownUSD);
  if (err instanceof MetaError) {
    const basis: unknown = err.costBasis ?? err.receipt?.costBasis;
    const reserved = basis === 'reservation';
    const extra: LessonEventExtra = {
      ...failExtra,
      detail: reserved ? `${err.code}; cost basis: reservation (outcome uncertain)` : `${err.code}`,
    };
    if (receipt !== undefined) {
      // A MetaError can carry a receipt for a call that was billed before it failed.
      Object.assign(extra, receiptFields(receipt));
    }
    if (hasChargedUSD || receipt !== undefined) {
      extra.estCostUSD = chargedUSD;
    }
    return { chargedUSD, unknownUSD, code: err.code, extra };
  }
  // Not a provider error: still never drop money an error object carries.
  const extra: LessonEventExtra = { ...failExtra, detail: 'INTERNAL' };
  if (hasChargedUSD || receipt !== undefined) {
    extra.estCostUSD = chargedUSD;
  }
  return { chargedUSD, unknownUSD, code: 'INTERNAL', extra };
}
