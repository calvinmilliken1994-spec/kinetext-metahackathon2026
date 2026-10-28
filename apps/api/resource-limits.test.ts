// Stage 5 review S5-06 — the absolute ≤2 repair rule is enforced at startup:
// maxRepairAttempts must be an integer in [0, 2], else RESOURCE_LIMITS_INVALID
// (apps/api/main.ts exits 1 with that code). Also covers the other config
// bounds main.ts has always failed closed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_REPAIR_ATTEMPTS_BOUND, parseResourceLimits } from './resource-limits.ts';

const realConfig = JSON.parse(
  readFileSync(new URL('../../config/resource-limits.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...structuredClone(realConfig), ...overrides };
}

test('S5-06: the checked-in config parses, with maxRepairAttempts = 2', () => {
  const limits = parseResourceLimits(realConfig);
  assert.equal(limits.maxRepairAttempts, 2);
  assert.equal(MAX_REPAIR_ATTEMPTS_BOUND, 2);
  assert.equal(limits.capUSD, 10);
  assert.equal(limits.wallTimeMs, 420000);
  assert.equal(limits.maxOutputTokens, 32000);
  assert.equal(limits.maxInputTokens, 32000);
  assert.equal(limits.ledgerLockPort, 47853);
});

test('S5-06: integer maxRepairAttempts 0, 1 and 2 are accepted', () => {
  for (const valid of [0, 1, 2]) {
    assert.equal(parseResourceLimits(config({ maxRepairAttempts: valid })).maxRepairAttempts, valid);
  }
});

test('S5-06: 3, fractions, NaN, negatives and non-numbers are RESOURCE_LIMITS_INVALID', () => {
  for (const invalid of [3, 1.5, Number.NaN, -1, '2', null, undefined, Number.POSITIVE_INFINITY, 2.0000001]) {
    const raw = config({ maxRepairAttempts: invalid });
    if (invalid === undefined) {
      delete raw['maxRepairAttempts'];
    }
    assert.throws(
      () => parseResourceLimits(raw),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `maxRepairAttempts=${String(invalid)} must fail closed at startup`,
    );
  }
});

test('the other runtime bounds still fail closed (regression)', () => {
  for (const overrides of [
    { maxJobWallTimeMs: 0 },
    { maxJobWallTimeMs: '240000' },
    { maxOutputTokens: Number.NaN },
    { maxInputTokens: -5 },
    { ledgerLockPort: 70000 },
    { ledgerLockPort: 1.5 },
  ]) {
    assert.throws(
      () => parseResourceLimits(config(overrides)),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `${JSON.stringify(overrides)} must fail closed`,
    );
  }
  // A missing stage cap defaults to zero spend (never an error).
  const noCap = config();
  delete noCap['stageCapsUSD'];
  assert.equal(parseResourceLimits(noCap).capUSD, 0);
  // Junk input fails closed.
  assert.throws(() => parseResourceLimits(null), /RESOURCE_LIMITS_INVALID/);
  assert.throws(() => parseResourceLimits('limits'), /RESOURCE_LIMITS_INVALID/);
});
