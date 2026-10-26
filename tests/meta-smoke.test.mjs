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
