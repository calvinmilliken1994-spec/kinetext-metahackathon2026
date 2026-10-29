// Stage 5 review S5-06 — the absolute ≤2 repair rule is enforced at startup:
// maxRepairAttempts must be an integer in [0, 2], else RESOURCE_LIMITS_INVALID
// (apps/api/main.ts exits 1 with that code). Also covers the other config
// bounds main.ts has always failed closed on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_REPAIR_ATTEMPTS_BOUND, parseResourceLimits } from './resource-limits.ts';
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
  assert.equal(limits.capUSD, 50);
  assert.equal(limits.analysisMaxOutputTokens, 16000, 'analysis may think as hard as the spec step (Stage 5b evaluation: two truncations at 6000)');
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
  // A missing stage cap defaults to zero spend (never an error).
  const noCap = config();
  delete noCap['stageCapsUSD'];
  assert.equal(parseResourceLimits(noCap).capUSD, 0);
  // Junk input fails closed.
  assert.throws(() => parseResourceLimits(null), /RESOURCE_LIMITS_INVALID/);
  assert.throws(() => parseResourceLimits('limits'), /RESOURCE_LIMITS_INVALID/);
});

/* ------------------------------------------------------------------ */
/* OW-2: per-provider caps and the Modal endpoint base URL              */
/* ------------------------------------------------------------------ */

test('OW-2: the checked-in config carries providerCapsUSD and a validated modalBaseUrl', () => {
  const limits = parseResourceLimits(realConfig);
  assert.deepEqual(limits.providerCapsUSD, { 'meta-api': 50, 'modal': 50 });
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
    config({ stageCapsUSD: { stage2: 30 }, providerCapsUSD: { 'meta-api': 30, modal: 50 } }),
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
  try {
    // Modal spend up to its own cap is admitted...
    const r1 = ledger.reserve({
      purpose: 'test-live',
      model: MODAL_MUSE_SPARK_OPEN_MODEL,
      estUSD: 49.9,
      provider: 'modal',
    });
    ledger.reconcile(r1, { costUSD: 49.9 });
    // ...past it, refused — even though the meta-api stage cap is untouched.
    assert.throws(
      () => ledger.reserve({ purpose: 'test-live', model: MODAL_MUSE_SPARK_OPEN_MODEL, estUSD: 0.2, provider: 'modal' }),
      (err: unknown) => err instanceof Error && err.message === 'BUDGET_EXCEEDED',
      'modal spend above its provider cap is refused',
    );
    // Meta-API spend is capped by BOTH its provider cap and the stage cap...
    const r2 = ledger.reserve({ purpose: 'test-live', model: 'muse-spark-1.3', estUSD: 49.99, provider: 'meta-api' });
    ledger.reconcile(r2, { costUSD: 49.99 });
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
    assert.ok(Math.abs(ledger.committedUSD('modal') - 49.95) < 1e-9);
    assert.ok(Math.abs(ledger.committedUSD('meta-api') - 49.99) < 1e-9);
  } finally {
    ledger.close();
  }
});
