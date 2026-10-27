/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupChecks, summarizeReport } from './checks.ts';
import { fixed, stepDigits, trimmed } from './format.ts';
import type { ValidationCheck } from '../../../../packages/contracts/index.ts';

const c = (id: string, kind: ValidationCheck['kind'], passed: boolean): ValidationCheck => ({ id, kind, passed, message: id });

test('groupChecks orders by kind and counts pass/fail', () => {
  const groups = groupChecks({
    checks: [c('b1', 'behavioral', true), c('s1', 'schema', true), c('g1', 'grounding', false), c('m1', 'semantic', true), c('m2', 'semantic', true), c('g2', 'grounding', true)],
  });
  assert.deepEqual(groups.map((g) => g.kind), ['schema', 'semantic', 'grounding', 'behavioral']);
  assert.deepEqual(groups.map((g) => [g.passed, g.failed]), [[1, 0], [2, 0], [1, 1], [1, 0]]);
});

test('groupChecks omits empty kinds', () => {
  assert.deepEqual(groupChecks({ checks: [c('s', 'schema', true)] }).map((g) => g.kind), ['schema']);
});

test('summarizeReport: Verified · 13/13 and Blocked · n failed', () => {
  const ok = Array.from({ length: 13 }, (_, i) => c(`k${i}`, 'semantic', true));
  assert.equal(summarizeReport({ checks: ok, publishable: true }).label, 'Verified · 13/13 checks');
  const bad = [...ok.slice(0, 11), c('x', 'grounding', false), c('y', 'behavioral', false)];
  const s = summarizeReport({ checks: bad, publishable: false });
  assert.equal(s.label, 'Blocked · 2 failed');
  assert.equal(s.verified, false);
  assert.equal(summarizeReport({ checks: [], publishable: false }).verified, false);
  assert.equal(summarizeReport({ checks: ok, publishable: false }).label, 'Blocked · not publishable');
});

test('fixed / trimmed / stepDigits', () => {
  assert.equal(fixed(-0.0001, 2), '0.00');
  assert.equal(fixed(-1.234, 2), '-1.23');
  assert.equal(trimmed(1.6667), '1.6667');
  assert.equal(trimmed(3), '3');
  assert.equal(trimmed(-0.00001), '0');
  assert.equal(stepDigits(1), 0);
  assert.equal(stepDigits(0.1), 1);
  assert.equal(stepDigits(0.02), 2);
  assert.equal(stepDigits(5), 0);
});
