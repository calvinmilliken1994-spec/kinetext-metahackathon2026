/// <reference types="node" />
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkName, groupChecks, validationBlurb, PROSE_CHECK_ID, proseScopeNotice, summarizeReport, TIMELINE_CHECK_NAMES } from './checks.ts';
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

test('summarizeReport: Machine checks passed · n/n (counts from the report) and Blocked', () => {
  const ok = Array.from({ length: 14 }, (_, i) => c(`k${i}`, 'semantic', true));
  const s14 = summarizeReport({ checks: ok, publishable: true });
  assert.equal(s14.label, 'Machine checks passed · 14/14');
  assert.equal(s14.allPassed, true);
  // an older 13-check report simply shows what it contains
  assert.equal(summarizeReport({ checks: ok.slice(0, 13), publishable: true }).label, 'Machine checks passed · 13/13');
  assert.ok(!/verified/i.test(s14.label));
  const bad = [...ok.slice(0, 12), c('x', 'grounding', false), c('y', 'behavioral', false)];
  const s = summarizeReport({ checks: bad, publishable: false });
  assert.equal(s.label, 'Blocked · 2 of 14 checks failed');
  assert.equal(s.allPassed, false);
  assert.equal(summarizeReport({ checks: [], publishable: false }).allPassed, false);
  assert.equal(summarizeReport({ checks: ok, publishable: false }).label, 'Blocked · not publishable');
});

test('proseScopeNotice uses the report check when present, else a fallback that still states the limit', () => {
  const msg = 'Explanation prose is AI-generated; quotes, numbers and ranges are machine-checked, the wording needs teacher review.';
  const withCheck = proseScopeNotice({ checks: [c('s', 'schema', true), { id: PROSE_CHECK_ID, kind: 'semantic', passed: true, message: 'custom text' }] });
  assert.deepEqual(withCheck, { message: 'custom text', fromReport: true });
  const without = proseScopeNotice({ checks: [c('s', 'schema', true)] });
  assert.equal(without.fromReport, false);
  assert.equal(without.message, msg);
  assert.match(without.message, /teacher review/);
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

test('timeline check ids have readable names; other ids have none (the raw id is shown)', () => {
  assert.equal(checkName('timeline.date-grounded'), 'Every date is stated in its quote');
  assert.equal(checkName('timeline.case-order'), 'Ordering answers match the dates');
  assert.equal(checkName('timeline.approximate-date'), 'No approximate dates');
  assert.equal(checkName('timeline.distinct-dates'), 'No two events share a date');
  assert.equal(checkName('timeline.unique-ids'), 'Events and questions are consistent');
  assert.equal(checkName('behavior.tests'), null);
  assert.equal(checkName('schema.full'), null);
  assert.deepEqual(Object.keys(TIMELINE_CHECK_NAMES).sort(), [
    'timeline.approximate-date', 'timeline.case-order', 'timeline.date-grounded', 'timeline.distinct-dates', 'timeline.unique-ids',
  ]);
});

test('validationBlurb describes dates and ordering for a timeline report and keeps the engine wording otherwise', () => {
  const tl = validationBlurb({ checks: [c('schema.full', 'schema', true), c('timeline.case-order', 'behavioral', true)] });
  assert.match(tl, /date/i);
  assert.match(tl, /order/i);
  assert.ok(!/physics engine/i.test(tl));
  assert.match(validationBlurb({ checks: [c('behavior.tests', 'behavioral', true)] }), /engine/i);
});
