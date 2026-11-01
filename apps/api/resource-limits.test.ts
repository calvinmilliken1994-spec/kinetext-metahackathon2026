// Stage 5 review S5-06 — the absolute ≤2 repair rule is enforced at startup:
// maxRepairAttempts must be an integer in [0, 2], else RESOURCE_LIMITS_INVALID
// (apps/api/main.ts exits 1 with that code). Also covers the other config
// bounds main.ts has always failed closed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_JUDGE_CAP_USD,
  DEFAULT_MAX_CONCURRENT_JOBS,
  MAX_CONCURRENT_JOBS_BOUND,
  MAX_REPAIR_ATTEMPTS_BOUND,
  parseResourceLimits,
} from './resource-limits.ts';
import { openLedger } from '../../packages/meta/ledger.ts';
import { MODAL_MUSE_SPARK_OPEN_MODEL } from '../../packages/meta/client.ts';

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
  assert.equal(limits.capUSD, 100);
  assert.equal(limits.analysisMaxOutputTokens, 16000, 'analysis may think as hard as the spec step (Stage 5b evaluation: two truncations at 6000)');
  assert.equal(limits.wallTimeMs, 420000);
  assert.equal(limits.maxOutputTokens, 32000);
  assert.equal(limits.maxInputTokens, 32000);
  assert.equal(limits.maxInputTokensV2, 72000, 'S6-W: the lesson-flow (v2) input bound from the freeze addendum');
  assert.equal(limits.ledgerLockPort, 47853);
});

test('S6-W: maxInputTokensV2 fails closed on anything but a positive integer within the provider context', () => {
  for (const invalid of [0, -72000, 1.5, Number.NaN, '72000', null, undefined, 1048577, Number.POSITIVE_INFINITY]) {
    const raw = config({ maxInputTokensV2: invalid });
    if (invalid === undefined) {
      delete raw['maxInputTokensV2'];
    }
    assert.throws(
      () => parseResourceLimits(raw),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `maxInputTokensV2=${String(invalid)} must fail closed at startup`,
    );
  }
  assert.equal(parseResourceLimits(config({ maxInputTokensV2: 1048576 })).maxInputTokensV2, 1048576, 'the provider context window itself is allowed');
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
    { analysisMaxOutputTokens: 0 },
    { analysisMaxOutputTokens: 64000 },
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
  // A missing stage cap defaults to zero spend (never an error). Stage 10: a judge budget would
  // exceed that zero cap, so the same config drops judgeCapUSD (absent clamps to 0).
  const noCap = config();
  delete noCap['stageCapsUSD'];
  delete noCap['judgeCapUSD'];
  assert.equal(parseResourceLimits(noCap).capUSD, 0);
  assert.throws(() => parseResourceLimits({ ...noCap, judgeCapUSD: 50 }), /RESOURCE_LIMITS_INVALID/, 'an explicit judge cap above zero spend fails closed');
  // Junk input fails closed.
  assert.throws(() => parseResourceLimits(null), /RESOURCE_LIMITS_INVALID/);
  assert.throws(() => parseResourceLimits('limits'), /RESOURCE_LIMITS_INVALID/);
});

/* ------------------------------------------------------------------ */
/* OW-2: per-provider caps and the Modal endpoint base URL              */
/* ------------------------------------------------------------------ */

test('OW-2: the checked-in config carries providerCapsUSD and a validated modalBaseUrl', () => {
  const limits = parseResourceLimits(realConfig);
  assert.deepEqual(limits.providerCapsUSD, { 'meta-api': 100, 'modal': 80 });
  assert.equal(
    limits.modalBaseUrl,
    'https://calvinmilliken1994--ep-mki-muse-spark-open-server.us-west.modal.direct/v1',
  );
  // The meta-api provider cap is consistent with the stage-2 cap the ledger also enforces.
  assert.equal(limits.providerCapsUSD['meta-api'], limits.capUSD);
});

test('OW-2: providerCapsUSD must be present, complete, finite and positive', () => {
  const missing = config();
  delete missing['providerCapsUSD'];
  assert.throws(() => parseResourceLimits(missing), /RESOURCE_LIMITS_INVALID/, 'a live server must never run without per-provider caps');
  for (const bad of [
    { 'meta-api': 50 }, // modal cap missing
    { modal: 50 }, // meta-api cap missing
    { 'meta-api': 50, modal: 0 },
    { 'meta-api': 50, modal: -5 },
    { 'meta-api': 50, modal: Number.NaN },
    { 'meta-api': 50, modal: Number.POSITIVE_INFINITY },
    { 'meta-api': 50, modal: '50' },
    { 'meta-api': 0, modal: 50 },
    { 'meta-api': 50, modal: 50, baseten: 10 }, // unknown provider key
    [], // not an object
    null,
  ]) {
    assert.throws(
      () => parseResourceLimits(config({ providerCapsUSD: bad })),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `providerCapsUSD=${JSON.stringify(bad)} must fail closed`,
    );
  }
});

test('OW-2: the meta-api provider cap must equal stageCapsUSD.stage2', () => {
  assert.throws(
    () => parseResourceLimits(config({ providerCapsUSD: { 'meta-api': 40, modal: 50 } })),
    (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
    'an inconsistent meta-api cap fails closed at startup',
  );
  // Changing BOTH together stays valid (the caps remain consistent).
  const both = parseResourceLimits(
    config({ stageCapsUSD: { stage2: 30 }, providerCapsUSD: { 'meta-api': 30, modal: 50 }, judgeCapUSD: 25 }),
  );
  assert.equal(both.capUSD, 30);
  assert.deepEqual(both.providerCapsUSD, { 'meta-api': 30, modal: 50 });
});

test('OW-2: modalBaseUrl is required and validated as a plain https URL (not a secret)', () => {
  const missing = config();
  delete missing['modalBaseUrl'];
  assert.throws(() => parseResourceLimits(missing), /RESOURCE_LIMITS_INVALID/);
  for (const bad of [
    '',
    'not a url',
    'http://insecure.example/v1',
    'https://onlyuser@host.example/v1',
    'https://host.example/v1?key=secret',
    'https://host.example/v1#frag',
    42,
    null,
  ]) {
    assert.throws(
      () => parseResourceLimits(config({ modalBaseUrl: bad })),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `modalBaseUrl=${JSON.stringify(bad)} must fail closed`,
    );
  }
  // Trailing slashes are normalised away so the client's URL checks always see one form.
  assert.equal(
    parseResourceLimits(config({ modalBaseUrl: 'https://host.example/v1///' })).modalBaseUrl,
    'https://host.example/v1',
  );
});

test('OW-2: the config caps, handed to openLedger, cap each provider independently', async () => {
  const limits = parseResourceLimits(realConfig);
  const dir = mkdtempSync(join(tmpdir(), 'ow2-ledger-'));
  // Exactly what apps/api/main.ts passes to the ledger in live mode.
  const ledger = await openLedger({
    path: join(dir, 'ledger.jsonl'),
    capUSD: limits.capUSD,
    providerCapsUSD: limits.providerCapsUSD,
  });
  const modalCap = limits.providerCapsUSD['modal']!;
  const metaCap = limits.providerCapsUSD['meta-api']!;
  try {
    // Modal spend up to its own cap is admitted...
    const r1 = ledger.reserve({
      purpose: 'test-live',
      model: MODAL_MUSE_SPARK_OPEN_MODEL,
      estUSD: modalCap - 0.1,
      provider: 'modal',
    });
    ledger.reconcile(r1, { costUSD: modalCap - 0.1 });
    // ...past it, refused — even though the meta-api stage cap is untouched.
    assert.throws(
      () => ledger.reserve({ purpose: 'test-live', model: MODAL_MUSE_SPARK_OPEN_MODEL, estUSD: 0.2, provider: 'modal' }),
      (err: unknown) => err instanceof Error && err.message === 'BUDGET_EXCEEDED',
      'modal spend above its provider cap is refused',
    );
    // Meta-API spend is capped by BOTH its provider cap and the stage cap...
    const r2 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: metaCap - 0.01, provider: 'meta-api' });
    ledger.reconcile(r2, { costUSD: metaCap - 0.01 });
    assert.throws(
      () => ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 0.02, provider: 'meta-api' }),
      (err: unknown) => err instanceof Error && err.message === 'BUDGET_EXCEEDED',
      'meta-api spend above its cap is refused',
    );
    // ...and near-full caps on BOTH providers still leave each independent:
    // a small modal reservation fits although meta-api is at its cap, and
    // vice versa (committedUSD filters per provider).
    const r3 = ledger.reserve({ purpose: 'test-live', model: MODAL_MUSE_SPARK_OPEN_MODEL, estUSD: 0.05, provider: 'modal' });
    ledger.reconcile(r3, { costUSD: 0.05 });
    assert.ok(Math.abs(ledger.committedUSD('modal') - (modalCap - 0.05)) < 1e-9);
    assert.ok(Math.abs(ledger.committedUSD('meta-api') - (metaCap - 0.01)) < 1e-9);
  } finally {
    ledger.close();
  }
});

/* ------------------------------------------------------------------ */
/* Concurrency (BUG-006 wave, part B): maxConcurrentJobs                 */
/* ------------------------------------------------------------------ */

test('concurrency: the checked-in config carries maxConcurrentJobs = 6 (3 per model for the final evaluation; product default stays 3)', () => {
  const limits = parseResourceLimits(realConfig);
  assert.equal(limits.maxConcurrentJobs, 6);
  assert.equal(DEFAULT_MAX_CONCURRENT_JOBS, 3);
  assert.equal(MAX_CONCURRENT_JOBS_BOUND, 8);
});

test('concurrency: maxConcurrentJobs accepts integers 1..8 and defaults to 3 when absent', () => {
  for (const valid of [1, 2, 3, 8]) {
    assert.equal(parseResourceLimits(config({ maxConcurrentJobs: valid })).maxConcurrentJobs, valid);
  }
  const missing = config();
  delete missing['maxConcurrentJobs'];
  assert.equal(
    parseResourceLimits(missing).maxConcurrentJobs,
    DEFAULT_MAX_CONCURRENT_JOBS,
    'a pre-concurrency config still parses, at the documented default',
  );
});

test('concurrency: maxConcurrentJobs 0, 9, negatives, fractions and non-numbers fail closed', () => {
  for (const invalid of [0, 9, -1, 1.5, Number.NaN, '3', null, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => parseResourceLimits(config({ maxConcurrentJobs: invalid })),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `maxConcurrentJobs=${String(invalid)} must fail closed at startup`,
    );
  }
});

/* ------------------------------------------------------------------ */
/* Stage 10 slice A: judgeCapUSD                                        */
/* ------------------------------------------------------------------ */

test('Stage 10: the checked-in config carries judgeCapUSD = 50 and it parses', () => {
  assert.equal((realConfig as { judgeCapUSD?: unknown }).judgeCapUSD, 50);
  assert.equal(parseResourceLimits(realConfig).judgeCapUSD, 50);
  assert.equal(DEFAULT_JUDGE_CAP_USD, 50);
});

test('Stage 10: judgeCapUSD absent means 50 (clamped to the available budget so older configs still parse)', () => {
  const missing = config();
  delete missing['judgeCapUSD'];
  assert.equal(parseResourceLimits(missing).judgeCapUSD, 50);
  // a config whose stage cap is below 50 and has no judge cap parses, with the default clamped to what exists
  const small = config({ stageCapsUSD: { stage2: 30 }, providerCapsUSD: { 'meta-api': 30, modal: 5 } });
  delete small['judgeCapUSD'];
  assert.equal(parseResourceLimits(small).judgeCapUSD, 30, 'min(50, min(30 + 5, 30)) = 30');
  // no stage cap at all (zero spend by default) leaves no judge budget
  const noStage = config();
  delete noStage['judgeCapUSD'];
  delete noStage['stageCapsUSD'];
  assert.equal(parseResourceLimits(noStage).judgeCapUSD, 0);
});

test('Stage 10: judgeCapUSD accepts finite values > 0 up to the smaller of the provider caps sum and the stage cap', () => {
  // real config: stage cap 100, providers 100 + 80 = 180, so the bound is 100
  for (const valid of [0.01, 1, 25, 50, 99.99, 100]) {
    assert.equal(parseResourceLimits(config({ judgeCapUSD: valid })).judgeCapUSD, valid);
  }
  // providers' sum below the stage cap is the binding bound
  const lowProviders = { stageCapsUSD: { stage2: 40 }, providerCapsUSD: { 'meta-api': 40, modal: 5 } };
  assert.equal(parseResourceLimits(config({ ...lowProviders, judgeCapUSD: 40 })).judgeCapUSD, 40, 'the stage cap (40) binds, not the sum (45)');
  assert.throws(() => parseResourceLimits(config({ ...lowProviders, judgeCapUSD: 40.01 })), /RESOURCE_LIMITS_INVALID/);
});

test('Stage 10: judgeCapUSD 0, negatives, NaN, Infinity, strings, null and values above the bound fail closed', () => {
  for (const invalid of [0, -1, -50, Number.NaN, Number.POSITIVE_INFINITY, '50', null, true, [], {}, 100.01, 1000]) {
    assert.throws(
      () => parseResourceLimits(config({ judgeCapUSD: invalid })),
      (err: unknown) => err instanceof Error && err.message === 'RESOURCE_LIMITS_INVALID',
      `judgeCapUSD=${JSON.stringify(invalid)} must fail closed at startup`,
    );
  }
});
