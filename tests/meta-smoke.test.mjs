import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Meta smoke fails closed before network when the direct API key is absent', () => {
  const result = spawnSync(process.execPath, ['scripts/meta-smoke.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8',
    env: { ...process.env, MODEL_API_KEY: '', META_APPROVED_JOB_BUDGET_USD: '0' },
  });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).reason, 'MODEL_API_KEY_MISSING');
});

function runWith(env) {
  return spawnSync(process.execPath, ['scripts/meta-smoke.mjs'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', env: { ...process.env, ...env },
  });
}

test('Meta smoke accepts the issued LLM_ key shape and still fails closed without budget approval', () => {
  // Fake value; real keys never appear in tests. Account-issued keys use an LLM_ prefix, not pipes.
  const result = runWith({ MODEL_API_KEY: 'LLM_' + 'x'.repeat(45), META_APPROVED_JOB_BUDGET_USD: '0' });
  assert.equal(result.status, 2);
  const out = JSON.parse(result.stdout);
  assert.equal(out.reason, 'SPENDING_NOT_APPROVED');
  assert.equal(out.networkAttempted, false);
});

test('Meta smoke rejects keys containing whitespace before any network call', () => {
  const result = runWith({ MODEL_API_KEY: 'LLM_abc def', META_APPROVED_JOB_BUDGET_USD: '1' });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).reason, 'MODEL_API_KEY_FORMAT_INVALID');
});
